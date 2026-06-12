import { UseCaseHttpError } from '../utils/useCaseErrors'
import { mapChannel, mapsChannel, sheetChannel, sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AbilityAutomationCategory } from '~/types/abilityAutomation'
import { campaignPathLabel } from '../utils/campaignPaths'
import { findMapFile, readMapFile, writeMapFile } from '../utils/mapStorage'
import { summarizeMap } from '../utils/mapSummaries'
import { canSaveMap } from '../policies/mapPolicy'
import { actorCanControlMapPlacement } from '../policies/playerProfileTokenControlPolicy'
import {
  readSheetFile,
  stripDerivedSheetFields,
  writeSheetFile,
} from '../utils/sheetStorage'
import {
  applyAbilityActivationToSheet,
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import { toNextRevisionSheetPayload } from '~/utils/sheets/persistence'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import {
  abilityEntriesForPlacement,
  buildTokenAbilityMenuOptions,
  type TokenAbilityMenuOption,
} from '~/utils/mapTokenAbilities'
import {
  referenceManeuverOptions,
  trainerManeuverOptionsForSheet,
  type TokenManeuverMenuOption,
} from '~/utils/mapTokenManeuvers'
import {
  trainerOrderOptionsForSheet,
  type TokenOrderMenuOption,
} from '~/utils/mapTokenOrders'
import {
  getMapAbilityAutomation,
  resolveMapAbilityAutomationTransaction,
} from '~/utils/abilityAutomation'
import { appendAbilityAutomationLogEntry } from '~/utils/abilityAutomationLog'
import {
  appendActiveOrderEffect,
  createActiveOrderEffect,
} from '~/utils/activeOrderEffects'
import {
  appendManeuverLogEntry,
  buildManeuverUseLogLines,
} from '~/utils/maneuverLog'
import {
  appendOrderLogEntry,
  buildOrderUseLogLines,
} from '~/utils/orderLog'
import { toPersistedMap } from './saveMap'

export class MapTokenTableActionUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface UseMapTokenManeuverInput {
  role: AuthRole
  slug: string
  placementId: string
  maneuverName: string
  targetPlacementId?: string
  clientId?: string
  playerProfile?: PlayerProfile | null
}

export interface UseMapTokenAbilityInput {
  role: AuthRole
  slug: string
  placementId: string
  abilityName: string
  targetPlacementId?: string
  clientId?: string
  playerProfile?: PlayerProfile | null
}

export interface UseMapTokenOrderInput {
  role: AuthRole
  slug: string
  placementId: string
  orderName: string
  targetPlacementId?: string
  clientId?: string
  playerProfile?: PlayerProfile | null
}

type MapTokenTableActionInput = UseMapTokenManeuverInput | UseMapTokenAbilityInput | UseMapTokenOrderInput

interface SheetFileRecord {
  path: string
  sheet: AnyLiveSheet
}

interface SheetWritePlan {
  kind: SheetKind
  slug: string
  path: string
  original: AnyLiveSheet
  next: AnyLiveSheet
}

export interface MapTokenTableActionDependencies {
  findMapPath?: (slug: string) => string | null
  readMap?: (path: string) => TabletopMap
  writeMap?: (path: string, map: TabletopMap) => void
  readSheet?: (kind: SheetKind, slug: string) => SheetFileRecord | null
  writeSheet?: (path: string, sheet: Record<string, unknown>) => void
  now?: () => number
  idFactory?: () => string
  relativePath?: (path: string) => string
}

export interface MapTokenTableActionSheetUpdate {
  kind: SheetKind
  slug: string
  path: string
  sheet: Record<string, unknown>
}

export interface MapTokenTableActionResult {
  ok: true
  path: string
  map: TabletopMap
  action: {
    type: 'maneuver' | 'ability' | 'order'
    placementId: string
    targetPlacementId?: string
    name: string
    category?: AbilityAutomationCategory
  }
  sheetUpdates: MapTokenTableActionSheetUpdate[]
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

interface ResolvedActionContext {
  mapPath: string
  relativePath: string
  map: TabletopMap
  actorPlacement: SheetPlacement
  targetPlacement?: SheetPlacement
}

interface ActionToken extends Pick<SpawnedPokemon,
  'id' | 'species' | 'position' | 'sheetKind' | 'sheetSlug' | 'combatStages' | 'conditions'
> {}

const mapEvents = (
  map: TabletopMap,
  clientId: string | undefined,
): Array<Omit<RealtimeEvent, 'timestamp'>> => [
  {
    channel: mapChannel(map.slug),
    type: 'updated',
    clientId,
    data: map,
  },
  {
    channel: mapsChannel,
    type: 'updated',
    clientId,
    data: summarizeMap(map),
  },
]

const sheetEvents = (
  updates: readonly MapTokenTableActionSheetUpdate[],
  clientId: string | undefined,
): Array<Omit<RealtimeEvent, 'timestamp'>> => updates.flatMap((update) => {
  const data = { kind: update.kind, slug: update.slug, sheet: update.sheet }
  return [
    { channel: sheetChannel(update.kind, update.slug), type: 'updated' as const, clientId, data },
    { channel: sheetsChannel, type: 'updated' as const, clientId, data },
  ]
})

const defaultReadSheet = (kind: SheetKind, slug: string): SheetFileRecord | null => {
  const result = readSheetFile<AnyLiveSheet>(kind, slug)
  if (!result) return null
  return { path: result.path, sheet: result.sheet }
}

const actionDependencies = (dependencies: MapTokenTableActionDependencies) => ({
  findMapPath: dependencies.findMapPath ?? findMapFile,
  readMap: dependencies.readMap ?? readMapFile,
  writeMap: dependencies.writeMap ?? writeMapFile,
  readSheet: dependencies.readSheet ?? defaultReadSheet,
  writeSheet: dependencies.writeSheet ?? writeSheetFile,
  now: dependencies.now ?? Date.now,
  idFactory: dependencies.idFactory,
  relativePath: dependencies.relativePath ?? campaignPathLabel,
})

const findPlacement = (map: TabletopMap, placementId: string): SheetPlacement | null =>
  map.placements.find((placement) => placement.id === placementId) ?? null

const controlDeniedMessage = (role: AuthRole, profile: PlayerProfile | null | undefined): string => (
  role === 'player' && !profile
    ? 'Select a player profile to control linked map tokens'
    : 'Token is not linked to selected player profile'
)

const resolveActionContext = (
  input: Pick<MapTokenTableActionInput, 'role' | 'slug' | 'placementId' | 'targetPlacementId' | 'playerProfile'>,
  dependencies: Required<Pick<ReturnType<typeof actionDependencies>, 'findMapPath' | 'readMap' | 'relativePath'>>,
): ResolvedActionContext => {
  const mapPath = dependencies.findMapPath(input.slug)
  if (!mapPath) throw new MapTokenTableActionUseCaseError(404, `Map ${input.slug}.json not found`)

  const map = dependencies.readMap(mapPath)
  if (!canSaveMap(input.role, map)) {
    throw new MapTokenTableActionUseCaseError(403, 'Map is not player visible')
  }

  const actorPlacement = findPlacement(map, input.placementId)
  if (!actorPlacement) {
    throw new MapTokenTableActionUseCaseError(404, `Placement ${input.placementId} not found`)
  }

  if (!actorCanControlMapPlacement({
    role: input.role,
    profile: input.playerProfile,
    placement: actorPlacement,
  })) {
    throw new MapTokenTableActionUseCaseError(
      403,
      controlDeniedMessage(input.role, input.playerProfile),
    )
  }

  const targetPlacement = input.targetPlacementId === undefined
    ? undefined
    : findPlacement(map, input.targetPlacementId)
  if (input.targetPlacementId !== undefined && !targetPlacement) {
    throw new MapTokenTableActionUseCaseError(404, `Placement ${input.targetPlacementId} not found`)
  }

  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
    actorPlacement,
    ...(targetPlacement ? { targetPlacement } : {}),
  }
}

const optionalText = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

const sheetDisplayName = (kind: SheetKind, sheet: AnyLiveSheet): string => {
  if (kind === 'pokemon') {
    const pokemon = sheet as CharacterSheet
    return optionalText(pokemon.nickname)
      ?? optionalText(pokemon.species)
      ?? optionalText(pokemon.slug)
      ?? 'Pokémon'
  }

  const trainer = sheet as TrainerSheet
  return optionalText(trainer.name)
    ?? optionalText(trainer.slug)
    ?? 'Trainer'
}

const tokenFromSheet = (
  placement: SheetPlacement,
  sheet: SheetFileRecord,
): ActionToken => {
  if (placement.sheetKind === 'pokemon') {
    const snapshot = pokemonHpSnapshot(sheet.sheet as CharacterSheet)
    return {
      id: placement.id,
      species: sheetDisplayName('pokemon', sheet.sheet),
      position: placement.position,
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      combatStages: snapshot.combatStages,
      conditions: snapshot.conditions,
    }
  }

  const snapshot = trainerHpSnapshot(sheet.sheet as TrainerSheet)
  return {
    id: placement.id,
    species: sheetDisplayName('trainer', sheet.sheet),
    position: placement.position,
    sheetKind: placement.sheetKind,
    sheetSlug: placement.sheetSlug,
    combatStages: snapshot.combatStages,
    conditions: snapshot.conditions,
  }
}

const readRequiredSheet = (
  placement: SheetPlacement,
  readSheet: NonNullable<MapTokenTableActionDependencies['readSheet']>,
  actionLabel: string,
): SheetFileRecord => {
  const sheet = readSheet(placement.sheetKind, placement.sheetSlug)
  if (!sheet) {
    throw new MapTokenTableActionUseCaseError(
      404,
      `Sheet ${placement.sheetKind}/${placement.sheetSlug} could not be loaded for ${actionLabel}`,
    )
  }
  return sheet
}

const optionMatchesName = (optionName: string, requestedName: string): boolean =>
  optionName.trim().toLocaleLowerCase() === requestedName.trim().toLocaleLowerCase()

const resolveManeuverOption = (
  placement: SheetPlacement,
  sheet: SheetFileRecord,
  requestedName: string,
): TokenManeuverMenuOption | null => {
  const options = placement.sheetKind === 'trainer'
    ? trainerManeuverOptionsForSheet(sheet.sheet as TrainerSheet)
    : referenceManeuverOptions()
  return options.find((option) => optionMatchesName(option.name, requestedName)) ?? null
}

const resolveOrderOption = (
  placement: SheetPlacement,
  sheet: SheetFileRecord,
  requestedName: string,
): TokenOrderMenuOption | null => {
  if (placement.sheetKind !== 'trainer') return null
  return trainerOrderOptionsForSheet(sheet.sheet as TrainerSheet)
    .find((option) => optionMatchesName(option.name, requestedName)) ?? null
}

const sheetMapsForMap = (
  map: TabletopMap,
  readSheet: NonNullable<MapTokenTableActionDependencies['readSheet']>,
): { pokemon: Map<string, CharacterSheet>; trainer: Map<string, TrainerSheet> } => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const placement of map.placements) {
    const sheet = readSheet(placement.sheetKind, placement.sheetSlug)
    if (!sheet) continue
    if (placement.sheetKind === 'pokemon') pokemon.set(placement.sheetSlug, sheet.sheet as CharacterSheet)
    else trainer.set(placement.sheetSlug, sheet.sheet as TrainerSheet)
  }
  return { pokemon, trainer }
}

const resolveAbilityOption = (
  placement: SheetPlacement,
  sheets: { pokemon: Map<string, CharacterSheet>; trainer: Map<string, TrainerSheet> },
  requestedName: string,
): TokenAbilityMenuOption | null => {
  const options = buildTokenAbilityMenuOptions(abilityEntriesForPlacement(placement, sheets))
  return options.find((option) => optionMatchesName(option.name, requestedName)) ?? null
}

const addOrUpdateWritePlan = (
  plans: Map<string, SheetWritePlan>,
  kind: SheetKind,
  slug: string,
  sheet: SheetFileRecord,
  update: (kind: SheetKind, sheet: AnyLiveSheet) => AnyLiveSheet,
): void => {
  const key = `${kind}:${slug}`
  const existing = plans.get(key)
  if (existing) {
    existing.next = update(kind, existing.next)
    return
  }
  plans.set(key, {
    kind,
    slug,
    path: sheet.path,
    original: sheet.sheet,
    next: update(kind, sheet.sheet),
  })
}

const persistSheetPlan = (
  plan: SheetWritePlan,
  writeSheet: NonNullable<MapTokenTableActionDependencies['writeSheet']>,
  relativePath: (path: string) => string,
): MapTokenTableActionSheetUpdate => {
  const sheet = toNextRevisionSheetPayload(stripDerivedSheetFields(plan.next as unknown as Record<string, unknown>))
  writeSheet(plan.path, sheet)
  return {
    kind: plan.kind,
    slug: plan.slug,
    path: relativePath(plan.path),
    sheet,
  }
}

const writeResult = (
  input: Pick<MapTokenTableActionInput, 'clientId'>,
  context: ResolvedActionContext,
  nextMap: TabletopMap,
  action: MapTokenTableActionResult['action'],
  writePlans: readonly SheetWritePlan[],
  dependencies: Required<Pick<ReturnType<typeof actionDependencies>, 'writeMap' | 'writeSheet' | 'now' | 'relativePath'>>,
): MapTokenTableActionResult => {
  const timestamp = dependencies.now()
  const persistedMap = toPersistedMap(nextMap, context.mapPath, timestamp, { advanceRevision: true })
  const sheetUpdates = writePlans.map((plan) => persistSheetPlan(plan, dependencies.writeSheet, dependencies.relativePath))
  dependencies.writeMap(context.mapPath, persistedMap)
  return {
    ok: true,
    path: context.relativePath,
    map: persistedMap,
    action,
    sheetUpdates,
    events: [
      ...mapEvents(persistedMap, input.clientId),
      ...sheetEvents(sheetUpdates, input.clientId),
    ],
  }
}

const currentOrderTimeline = (map: TabletopMap): { activeId: string | null; round: number } => {
  const round = Math.floor(Number(map.initiative?.round ?? 1))
  return {
    activeId: map.initiative?.activeId ?? null,
    round: Number.isFinite(round) && round > 0 ? round : 1,
  }
}

const orderTargetLabel = (order: TokenOrderMenuOption): string | null => {
  const explicit = order.target?.trim()
  if (explicit) return explicit
  if (order.tags.some((tag) => /^training$/i.test(tag))) return 'Your Pokémon'
  return null
}

export const useMapTokenManeuverUseCase = (
  input: UseMapTokenManeuverInput,
  dependencies: MapTokenTableActionDependencies = {},
): MapTokenTableActionResult => {
  const deps = actionDependencies(dependencies)
  const context = resolveActionContext(input, deps)
  const actorSheet = readRequiredSheet(context.actorPlacement, deps.readSheet, 'maneuver use')
  const actor = tokenFromSheet(context.actorPlacement, actorSheet)
  const targetSheet = context.targetPlacement
    ? readRequiredSheet(context.targetPlacement, deps.readSheet, 'maneuver target')
    : null
  const target = context.targetPlacement && targetSheet
    ? tokenFromSheet(context.targetPlacement, targetSheet)
    : null
  const maneuver = resolveManeuverOption(context.actorPlacement, actorSheet, input.maneuverName)
  if (!maneuver) {
    throw new MapTokenTableActionUseCaseError(
      404,
      `Maneuver ${input.maneuverName} is not available to token ${input.placementId}`,
    )
  }

  const metadata = appendManeuverLogEntry(context.map.metadata, {
    userId: actor.id,
    userName: actor.species,
    maneuverName: maneuver.name,
    lines: buildManeuverUseLogLines(actor as SpawnedPokemon, maneuver, { target: target as SpawnedPokemon | null }),
  }, { now: deps.now })

  return writeResult(input, context, {
    ...context.map,
    metadata,
  }, {
    type: 'maneuver',
    placementId: context.actorPlacement.id,
    ...(context.targetPlacement ? { targetPlacementId: context.targetPlacement.id } : {}),
    name: maneuver.name,
  }, [], deps)
}

export const useMapTokenOrderUseCase = (
  input: UseMapTokenOrderInput,
  dependencies: MapTokenTableActionDependencies = {},
): MapTokenTableActionResult => {
  const deps = actionDependencies(dependencies)
  const context = resolveActionContext(input, deps)
  const actorSheet = readRequiredSheet(context.actorPlacement, deps.readSheet, 'order use')
  const actor = tokenFromSheet(context.actorPlacement, actorSheet)
  const targetSheet = context.targetPlacement
    ? readRequiredSheet(context.targetPlacement, deps.readSheet, 'order target')
    : null
  const target = context.targetPlacement && targetSheet
    ? tokenFromSheet(context.targetPlacement, targetSheet)
    : null

  const order = resolveOrderOption(context.actorPlacement, actorSheet, input.orderName)
  if (!order) {
    throw new MapTokenTableActionUseCaseError(
      context.actorPlacement.sheetKind === 'trainer' ? 404 : 400,
      context.actorPlacement.sheetKind === 'trainer'
        ? `Order ${input.orderName} is not available to token ${input.placementId}`
        : `Order ${input.orderName} can only be used by trainer tokens`,
    )
  }
  if (orderTargetLabel(order) !== null && !target) {
    throw new MapTokenTableActionUseCaseError(400, `Order ${order.name} requires a target token`)
  }

  const activeEffect = createActiveOrderEffect({
    user: actor,
    order,
    target,
    timeline: currentOrderTimeline(context.map),
    ...(deps.idFactory ? { idFactory: deps.idFactory } : {}),
  })
  const lines = buildOrderUseLogLines(actor as SpawnedPokemon, order, {
    target: target as SpawnedPokemon | null,
    activeEffect,
  })
  let metadata = context.map.metadata
  if (activeEffect) metadata = appendActiveOrderEffect(metadata, activeEffect)
  metadata = appendOrderLogEntry(metadata, {
    userId: actor.id,
    userName: actor.species,
    orderName: order.name,
    lines,
  }, { now: deps.now })

  return writeResult(input, context, {
    ...context.map,
    metadata,
  }, {
    type: 'order',
    placementId: context.actorPlacement.id,
    ...(context.targetPlacement ? { targetPlacementId: context.targetPlacement.id } : {}),
    name: order.name,
  }, [], deps)
}

export const useMapTokenAbilityUseCase = (
  input: UseMapTokenAbilityInput,
  dependencies: MapTokenTableActionDependencies = {},
): MapTokenTableActionResult => {
  const deps = actionDependencies(dependencies)
  const context = resolveActionContext(input, deps)
  const actorSheet = readRequiredSheet(context.actorPlacement, deps.readSheet, 'ability use')
  const actor = tokenFromSheet(context.actorPlacement, actorSheet)
  const targetSheet = context.targetPlacement
    ? readRequiredSheet(context.targetPlacement, deps.readSheet, 'ability target')
    : null
  const target = context.targetPlacement && targetSheet
    ? tokenFromSheet(context.targetPlacement, targetSheet)
    : null
  const sheetMaps = sheetMapsForMap(context.map, deps.readSheet)
  const option = resolveAbilityOption(context.actorPlacement, sheetMaps, input.abilityName)
  if (!option) {
    throw new MapTokenTableActionUseCaseError(
      404,
      `Ability ${input.abilityName} is not present on token ${input.placementId}'s sheet`,
    )
  }
  if (!option.automation) {
    throw new MapTokenTableActionUseCaseError(400, `Ability ${option.name} does not have map automation`)
  }
  if (option.automation.category === 'passive') {
    throw new MapTokenTableActionUseCaseError(400, `Ability ${option.name} is passive and cannot be used as an active map action`)
  }

  const writePlans = new Map<string, SheetWritePlan>()
  let logLines: readonly string[]
  let category: AbilityAutomationCategory = option.automation.category
  const combatStageUpdates: Array<{ id: string; stages: CombatStageMap }> = []
  const conditionUpdates: Array<{ id: string; conditions: string[] }> = []

  if (option.automation.category === 'sheet') {
    if (option.activated) {
      throw new MapTokenTableActionUseCaseError(409, `Ability ${option.name} is already active on token ${input.placementId}`)
    }
    addOrUpdateWritePlan(writePlans, context.actorPlacement.sheetKind, context.actorPlacement.sheetSlug, actorSheet, (kind, sheet) =>
      applyAbilityActivationToSheet(kind, sheet, option.name),
    )
    logLines = [`${actor.species} activated ${option.name}.`]
  } else {
    const mapAutomation = getMapAbilityAutomation(option.name)
    if (mapAutomation?.targetMode === 'target' && !target) {
      throw new MapTokenTableActionUseCaseError(400, `Ability ${option.name} requires a target token`)
    }

    const transaction = resolveMapAbilityAutomationTransaction({
      abilityName: option.name,
      user: actor as SpawnedPokemon,
      ...(target ? { target: target as SpawnedPokemon } : {}),
      fieldEffects: context.map.fieldEffects,
    })
    if (!transaction) {
      throw new MapTokenTableActionUseCaseError(409, `Ability ${option.name} could not produce an automation transaction`)
    }

    category = transaction.category
    logLines = transaction.logLines
    for (const update of transaction.combatStageUpdates) {
      const updatePlacement = update.id === actor.id
        ? context.actorPlacement
        : update.id === target?.id
          ? context.targetPlacement
          : undefined
      const updateSheet = update.id === actor.id
        ? actorSheet
        : update.id === target?.id
          ? targetSheet
          : undefined
      if (!updatePlacement || !updateSheet) {
        throw new MapTokenTableActionUseCaseError(409, `Ability ${option.name} references unavailable combat-stage target ${update.id}`)
      }
      addOrUpdateWritePlan(writePlans, updatePlacement.sheetKind, updatePlacement.sheetSlug, updateSheet, (kind, sheet) =>
        applyCombatStagesToSheet(kind, sheet, update.stages as CombatStageMap),
      )
      combatStageUpdates.push({ id: update.id, stages: update.stages as CombatStageMap })
    }
    for (const update of transaction.conditionUpdates) {
      const updatePlacement = update.id === actor.id
        ? context.actorPlacement
        : update.id === target?.id
          ? context.targetPlacement
          : undefined
      const updateSheet = update.id === actor.id
        ? actorSheet
        : update.id === target?.id
          ? targetSheet
          : undefined
      if (!updatePlacement || !updateSheet) {
        throw new MapTokenTableActionUseCaseError(409, `Ability ${option.name} references unavailable condition target ${update.id}`)
      }
      addOrUpdateWritePlan(writePlans, updatePlacement.sheetKind, updatePlacement.sheetSlug, updateSheet, (kind, sheet) =>
        applyConditionsToSheet(kind, sheet, [...update.conditions]),
      )
      conditionUpdates.push({ id: update.id, conditions: [...update.conditions] })
    }
  }

  const metadata = appendAbilityAutomationLogEntry(context.map.metadata, {
    userId: actor.id,
    userName: actor.species,
    abilityName: option.name,
    category,
    combatStageUpdates,
    conditionUpdates,
    logLines: [...logLines],
  }, { now: deps.now })

  return writeResult(input, context, {
    ...context.map,
    metadata,
  }, {
    type: 'ability',
    placementId: context.actorPlacement.id,
    ...(context.targetPlacement ? { targetPlacementId: context.targetPlacement.id } : {}),
    name: option.name,
    category,
  }, [...writePlans.values()], deps)
}
