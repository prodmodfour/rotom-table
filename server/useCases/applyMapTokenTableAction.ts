import { randomInt } from 'node:crypto'
import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayPatch,
  type LivePlayScope,
  type LivePlaySheetScope,
  type LivePlayTableActionCommand,
  type LivePlayTokenScope,
  type UseManeuverPayload,
  type UseOrderPayload,
} from '#shared/livePlayCommands'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AuthRole } from '#shared/auth'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import { referenceManeuverOptions, trainerManeuverOptionsForSheet, type TokenManeuverMenuOption } from '~/utils/mapTokenManeuvers'
import { trainerOrderOptionsForSheet, type TokenOrderMenuOption } from '~/utils/mapTokenOrders'
import {
  toPersistableSheetPayload,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import { sameJsonValue } from '~/utils/serialization'
import { applyAa065CrushTrapGrappleTrigger } from '../domain/abilityAutomation/mechanics/aa065ManeuverIntegration'
import { cleanupAa065CrueltyHealingBlockForBreather } from '../domain/abilityAutomation/mechanics/aa065StaticIntegration'
import { applyAa081NaturalCureForBreather } from '../domain/abilityAutomation/mechanics/aa081LifecycleIntegration'
import { applyAa085to100RegeneratorTrigger } from '../domain/abilityAutomation/mechanics/aa085to100LifecycleIntegration'
import { cleanupAa085to100CurledUpForBreather } from '../domain/abilityAutomation/mechanics/aa085to100ActionIntegration'
import {
  capabilityHpSheetKey,
  reconcileCapabilityHpState,
  type CapabilityHpStateSheet,
} from '../domain/capabilityAutomation/reconcileHpState'
import { clearAa083PerishCountForBreather } from '../domain/abilityAutomation/mechanics/aa083LifecycleIntegration'
import { resolveAuthoritativeDisarm } from '../domain/maneuverAutomation/disarm'
import { spendEncounterMoveResourceCosts } from '../domain/moveAutomation/reduceEncounterResources'
import {
  aa077HasAuthoritativeDisengageWindow,
  applyAa077DisengageResourceEvidence,
} from '../domain/abilityAutomation/mechanics/aa077StaticIntegration'
import { appendActiveOrderEffect, createActiveOrderEffect } from '~/utils/activeOrderEffects'
import { appendManeuverLogEntry, buildManeuverUseLogLines } from '~/utils/maneuverLog'
import { appendOrderLogEntry, buildOrderUseLogLines } from '~/utils/orderLog'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import { livePlaySheetUpdateRealtimeAppendInputs } from '../livePlay/sheetUpdateRealtime'
import { canAccessMapForRole } from '../policies/mapPolicy'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControlAsync,
  type ServerTokenControlLinkedTrainerSheet,
} from '../policies/playerProfileTokenControlPolicy'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { sqliteSheetRepository, type PersistedSheet, type SheetRepository } from '../storage/sheetRepository'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { redactSheetUpdatesForPlayer } from '../utils/sheetPrivacy'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'
import { resolveEffectiveCapabilities } from '../domain/capabilityAutomation/effectiveCapabilities'
import {
  physicalPowerSourceValues,
  resolvePhysicalPowerLoad,
} from '../domain/capabilityAutomation/physicalPower'

export class MapTokenTableActionUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409 | 410> {}

export const LEGACY_USE_ABILITY_RETIRED_MESSAGE =
  'Legacy useAbility execution is retired; use the native Ability declaration and resolution routes.'

export type LivePlayTableActionCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER
  | typeof LIVE_PLAY_COMMAND_TYPES.USE_ABILITY
  | typeof LIVE_PLAY_COMMAND_TYPES.USE_ORDER

export interface LivePlayTableActionActor {
  readonly role: AuthRole
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
}

export interface ExecuteLivePlayTableActionCommandInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
  readonly expectedType?: LivePlayTableActionCommandType
}

export interface LivePlayTableActionSheetUpdate {
  readonly kind: SheetKind
  readonly slug: string
  readonly sheet: Record<string, unknown>
}

export interface LivePlayTableActionSummary {
  readonly type: 'maneuver' | 'order'
  readonly placementId: string
  readonly targetPlacementId?: string
  readonly name: string
}

export interface LivePlayTableActionCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly placement?: SheetPlacement
  readonly action?: LivePlayTableActionSummary
  readonly sheetUpdates?: LivePlayTableActionSheetUpdate[]
}

export interface LivePlayTableActionCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'applyLivePlayUpdate'>
  readonly database?: Pick<RotomDatabase, 'withTransaction'>
  readonly now?: () => number
  readonly idFactory?: () => string
  readonly rollDie?: (label: string, sides: number) => number
  readonly relativePath?: (path: string) => string
}

interface ResolvedActionContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly targetPlacement?: SheetPlacement
  readonly actorSheet: PersistedSheet
  readonly targetSheet?: PersistedSheet
  readonly linkedTrainerSheets: readonly ServerTokenControlLinkedTrainerSheet[]
  readonly mapSheets: ReadonlyMap<string, PersistedSheet>
  readonly consultedHpSheetRevisions?: readonly { kind: SheetKind; slug: string; revision: number }[]
  readonly nextSheets?: readonly SheetWritePlan[]
  readonly sheetUpdates?: readonly LivePlayTableActionSheetUpdate[]
  readonly action?: LivePlayTableActionSummary
}

interface SheetWritePlan {
  kind: SheetKind
  slug: string
  original: PersistedSheet
  next: Record<string, unknown>
  field: string
}

interface ActionToken extends Pick<SpawnedPokemon,
  | 'id'
  | 'species'
  | 'position'
  | 'sheetKind'
  | 'sheetSlug'
  | 'combatStages'
  | 'conditions'
> {
  readonly currentHp: number
  readonly maxHp: number
  readonly fullMaxHp: number
  readonly injuries: number
}

type UnknownRecord = Record<string, unknown>
type TableActionPayload = UseManeuverPayload | UseOrderPayload

const livePlayTableActionCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const tableActionCommandTypes = new Set<string>([
  LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
  LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
])

const actionDependencies = (dependencies: LivePlayTableActionCommandDependencies) => ({
  commandExecutor: dependencies.commandExecutor ?? livePlayTableActionCommandExecutor,
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  sheetRepository: dependencies.sheetRepository ?? sqliteSheetRepository,
  database: dependencies.database ?? getRotomDatabase(),
  now: dependencies.now ?? Date.now,
  idFactory: dependencies.idFactory,
  rollDie: dependencies.rollDie ?? ((_label: string, sides: number) => randomInt(1, sides + 1)),
  relativePath: dependencies.relativePath ?? ((path: string) => path),
})

type LivePlayTableActionDependencySet = ReturnType<typeof actionDependencies>

const tokenControlTrainerSheet = (sheet: PersistedSheet): ServerTokenControlLinkedTrainerSheet => ({
  slug: sheet.slug,
  ...(Array.isArray(sheet.sheet.currentTeam) ? { currentTeam: sheet.sheet.currentTeam } : {}),
  ...(Array.isArray(sheet.sheet.boxedPokemon) ? { boxedPokemon: sheet.sheet.boxedPokemon } : {}),
})

const linkedTrainerSheetsForActor = async (
  actor: LivePlayTableActionActor,
  dependencies: LivePlayTableActionDependencySet,
) => playerProfileLinkedTrainerSheetsForTokenControlAsync(
  actor.playerProfile,
  async (slug) => {
    const sheet = await dependencies.sheetRepository.getByRef('trainer', slug)
    return sheet ? tokenControlTrainerSheet(sheet) : null
  },
)

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => logicalMapResourcePath(map)

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
  sheet: PersistedSheet,
): ActionToken => {
  if (placement.sheetKind === 'pokemon') {
    const snapshot = pokemonHpSnapshot(sheet.sheet as unknown as CharacterSheet)
    return {
      id: placement.id,
      species: sheetDisplayName('pokemon', sheet.sheet as unknown as AnyLiveSheet),
      position: placement.position,
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      currentHp: snapshot.currentHp,
      maxHp: snapshot.maxHp,
      fullMaxHp: snapshot.fullMaxHp,
      injuries: snapshot.injuries,
      combatStages: snapshot.combatStages,
      conditions: snapshot.conditions,
    }
  }

  const snapshot = trainerHpSnapshot(sheet.sheet as unknown as TrainerSheet)
  return {
    id: placement.id,
    species: sheetDisplayName('trainer', sheet.sheet as unknown as AnyLiveSheet),
    position: placement.position,
    sheetKind: placement.sheetKind,
    sheetSlug: placement.sheetSlug,
    currentHp: snapshot.currentHp,
    maxHp: snapshot.maxHp,
    fullMaxHp: snapshot.fullMaxHp,
    injuries: snapshot.injuries,
    combatStages: snapshot.combatStages,
    conditions: snapshot.conditions,
  }
}

const controlDeniedMessage = (role: AuthRole, profile: PlayerProfile | null | undefined): string => (
  role === 'player' && !profile
    ? 'Select a player profile to control linked map tokens'
    : 'Token is not linked to selected player profile'
)

const expectOptionalPlacementId = (record: UnknownRecord, field: string): string | undefined => {
  const value = record[field]
  if (value === undefined || value === null || value === '') return undefined
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) rejectLivePlayCommand('invalid', `${field} must be a non-empty string when provided`)
  return text
}

const expectBasePayload = (payload: unknown, commandName: string, nameField: string): { placementId: string; name: string; targetPlacementId?: string } => {
  if (!isRecord(payload)) rejectLivePlayCommand('invalid', `${commandName} payload must be an object`)
  const record = payload as UnknownRecord
  const placementId = typeof record.placementId === 'string' ? record.placementId.trim() : ''
  const name = typeof record[nameField] === 'string' ? record[nameField].trim() : ''
  if (!placementId) rejectLivePlayCommand('invalid', `${commandName} payload.placementId is required`)
  if (!name) rejectLivePlayCommand('invalid', `${commandName} payload.${nameField} is required`)
  const targetPlacementId = expectOptionalPlacementId(record, 'targetPlacementId')
  return {
    placementId,
    name,
    ...(targetPlacementId ? { targetPlacementId } : {}),
  }
}

const expectUseManeuverPayload = (payload: unknown): UseManeuverPayload => {
  const base = expectBasePayload(payload, 'useManeuver', 'maneuverName')
  return {
    placementId: base.placementId,
    maneuverName: base.name,
    ...(base.targetPlacementId ? { targetPlacementId: base.targetPlacementId } : {}),
  }
}

const expectUseOrderPayload = (payload: unknown): UseOrderPayload => {
  const base = expectBasePayload(payload, 'useOrder', 'orderName')
  return {
    placementId: base.placementId,
    orderName: base.name,
    ...(base.targetPlacementId ? { targetPlacementId: base.targetPlacementId } : {}),
  }
}

const commandPayload = (command: LivePlayTableActionCommand): TableActionPayload => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER) return expectUseManeuverPayload(command.payload)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.USE_ORDER) return expectUseOrderPayload(command.payload)
  throw new MapTokenTableActionUseCaseError(410, LEGACY_USE_ABILITY_RETIRED_MESSAGE)
}

const commandPlacementId = (command: LivePlayTableActionCommand): string => commandPayload(command).placementId

const commandTargetPlacementId = (command: LivePlayTableActionCommand): string | undefined => commandPayload(command).targetPlacementId

const tokenActionScopeMatches = (
  scopes: readonly LivePlayScope[],
  placementId: string,
): boolean => scopes.some((scope) => (
  scope.kind === 'token' && scope.placementId === placementId && scope.field === 'action'
))

const metadataScopeMatches = (scopes: readonly LivePlayScope[]): boolean => scopes.some((scope) => (
  scope.kind === 'map' && scope.lane === 'metadata'
))

const assertTableActionCommandType = (command: LivePlayTableActionCommand, expectedType?: LivePlayTableActionCommandType): void => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.USE_ABILITY) {
    throw new MapTokenTableActionUseCaseError(410, LEGACY_USE_ABILITY_RETIRED_MESSAGE)
  }
  if (expectedType && command.type !== expectedType) {
    rejectLivePlayCommand('invalid', `This route only accepts ${expectedType} commands`)
  }
  if (!tableActionCommandTypes.has(command.type)) {
    rejectLivePlayCommand('invalid', 'Table-action live-play routes support useManeuver and useOrder commands only')
  }
}

const validateCommandPayloadAndScopes = (
  command: LivePlayTableActionCommand,
): TableActionPayload => {
  const payload = commandPayload(command)
  if (!tokenActionScopeMatches(command.scopes, payload.placementId)) {
    rejectLivePlayCommand('invalid', `${command.type} scopes must include the token action scope for payload.placementId`)
  }
  if (!metadataScopeMatches(command.scopes)) {
    rejectLivePlayCommand('invalid', `${command.type} scopes must include the map metadata scope`)
  }

  return payload
}

const readRequiredSheetSync = (
  placement: SheetPlacement,
  dependencies: Pick<LivePlayTableActionDependencySet, 'sheetRepository'>,
  actionLabel: string,
): PersistedSheet => {
  const sheet = dependencies.sheetRepository.getByRef(placement.sheetKind, placement.sheetSlug)
  if (!sheet) {
    throw new MapTokenTableActionUseCaseError(
      404,
      `Sheet ${placement.sheetKind}/${placement.sheetSlug} could not be loaded for ${actionLabel}`,
    )
  }
  return sheet
}

const readRequiredSheet = async (
  placement: SheetPlacement,
  dependencies: Pick<LivePlayTableActionDependencySet, 'sheetRepository'>,
  actionLabel: string,
): Promise<PersistedSheet> => readRequiredSheetSync(placement, dependencies, actionLabel)

const resolveContext = async (
  command: LivePlayTableActionCommand,
  actor: LivePlayTableActionActor,
  dependencies: LivePlayTableActionDependencySet,
): Promise<ResolvedActionContext> => {
  const placementId = commandPlacementId(command)
  const targetPlacementId = commandTargetPlacementId(command)
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw new MapTokenTableActionUseCaseError(404, `Map ${command.mapSlug}.json not found`)

  if (!canAccessMapForRole(actor.role, map)) {
    throw new MapTokenTableActionUseCaseError(403, 'Map is not player visible')
  }

  const actorPlacement = map.placements.find((placement) => placement.id === placementId)
  if (!actorPlacement) throw new MapTokenTableActionUseCaseError(404, `Placement ${placementId} not found`)

  const targetPlacement = targetPlacementId === undefined
    ? undefined
    : map.placements.find((placement) => placement.id === targetPlacementId)
  if (targetPlacementId !== undefined && !targetPlacement) {
    throw new MapTokenTableActionUseCaseError(404, `Placement ${targetPlacementId} not found`)
  }

  const mapSheets = new Map<string, PersistedSheet>()
  for (const placement of map.placements) {
    const key = capabilityHpSheetKey(placement.sheetKind, placement.sheetSlug)
    if (!mapSheets.has(key)) {
      mapSheets.set(key, await readRequiredSheet(placement, dependencies, command.type))
    }
  }
  const actorSheet = mapSheets.get(capabilityHpSheetKey(actorPlacement.sheetKind, actorPlacement.sheetSlug))!
  const targetSheet = targetPlacement
    ? mapSheets.get(capabilityHpSheetKey(targetPlacement.sheetKind, targetPlacement.sheetSlug))
    : undefined

  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
    actorPlacement,
    ...(targetPlacement ? { targetPlacement } : {}),
    actorSheet,
    ...(targetSheet ? { targetSheet } : {}),
    linkedTrainerSheets: await linkedTrainerSheetsForActor(actor, dependencies),
    mapSheets,
  }
}

const optionMatchesName = (optionName: string, requestedName: string): boolean =>
  optionName.trim().toLocaleLowerCase() === requestedName.trim().toLocaleLowerCase()

const resolveManeuverOption = (
  placement: SheetPlacement,
  sheet: PersistedSheet,
  requestedName: string,
): TokenManeuverMenuOption | null => {
  const options = placement.sheetKind === 'trainer'
    ? trainerManeuverOptionsForSheet(sheet.sheet as unknown as TrainerSheet)
    : referenceManeuverOptions()
  return options.find((option) => optionMatchesName(option.name, requestedName)) ?? null
}

const resolveOrderOption = (
  placement: SheetPlacement,
  sheet: PersistedSheet,
  requestedName: string,
): TokenOrderMenuOption | null => {
  if (placement.sheetKind !== 'trainer') return null
  return trainerOrderOptionsForSheet(sheet.sheet as unknown as TrainerSheet)
    .find((option) => optionMatchesName(option.name, requestedName)) ?? null
}

const addOrUpdateWritePlan = (
  plans: Map<string, SheetWritePlan>,
  sheet: PersistedSheet,
  field: string,
  update: (kind: SheetKind, sheet: AnyLiveSheet) => AnyLiveSheet,
): void => {
  const key = `${sheet.kind}:${sheet.slug}`
  const existing = plans.get(key)

  if (existing) {
    existing.next = sheetPayloadForPersistence(
      update(sheet.kind, existing.next as unknown as AnyLiveSheet),
      sheet.slug,
      typeof existing.next.updatedAt === 'number' ? existing.next.updatedAt : undefined,
    )
    return
  }

  plans.set(key, {
    kind: sheet.kind,
    slug: sheet.slug,
    original: sheet,
    next: sheetPayloadForPersistence(update(sheet.kind, sheet.sheet as unknown as AnyLiveSheet), sheet.slug, sheet.updatedAt),
    field,
  })
}

const sheetPayloadForPersistence = (
  sheet: AnyLiveSheet,
  slug: string,
  updatedAt: number | undefined,
): Record<string, unknown> => ({
  ...toPersistableSheetPayload(sheet as unknown as Record<string, unknown>),
  slug,
  ...(updatedAt === undefined ? {} : { updatedAt }),
})

const currentOrderTimeline = (map: TabletopMap): { activeId: string | null; round: number } => {
  const round = Math.floor(Number(map.initiative?.round ?? 1))
  return {
    activeId: map.initiative?.activeId ?? null,
    round: Number.isFinite(round) && round > 0 ? round : 1,
  }
}

const physicalPowerLoadForActionContext = (context: ResolvedActionContext) => {
  const pokemonSheets = new Map<string, CharacterSheet>()
  const trainerSheets = new Map<string, TrainerSheet>()
  for (const stored of context.mapSheets.values()) {
    if (stored.kind === 'pokemon') pokemonSheets.set(stored.slug, stored.sheet as unknown as CharacterSheet)
    else trainerSheets.set(stored.slug, stored.sheet as unknown as TrainerSheet)
  }
  const sheet = context.actorSheet.sheet as unknown as CharacterSheet | TrainerSheet
  const effective = resolveEffectiveCapabilities({
    map: context.map,
    placement: context.actorPlacement,
    sheet,
    sheets: { pokemon: pokemonSheets, trainer: trainerSheets },
  }).instances.filter(instance => instance.effective)
  return resolvePhysicalPowerLoad({
    map: context.map,
    placementId: context.actorPlacement.id,
    powerByCapabilityInstanceId: physicalPowerSourceValues(effective),
  })
}

const orderTargetLabel = (order: TokenOrderMenuOption): string | null => {
  const explicit = order.target?.trim()
  if (explicit) return explicit
  if (order.tags.some((tag) => /^training$/i.test(tag))) return 'Your Pokémon'
  return null
}

const sheetUpdateFromPlan = (plan: SheetWritePlan): LivePlayTableActionSheetUpdate => ({
  kind: plan.kind,
  slug: plan.slug,
  sheet: {
    ...plan.next,
    revision: nextRevision(plan.original.revision),
  },
})

const sheetUpdateFromPersisted = (sheet: PersistedSheet): LivePlayTableActionSheetUpdate => ({
  kind: sheet.kind,
  slug: sheet.slug,
  sheet: sheet.sheet,
})

const spendDisarmStandardAction = (
  map: TabletopMap,
  placementId: string,
  operationId: string,
): TabletopMap => {
  if (map.initiative?.activeId && map.initiative.activeId !== placementId) {
    rejectLivePlayCommand('invalid', 'Disarm may only be declared during the actor’s Initiative turn.')
  }
  const encounter = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  const round = map.initiative?.round ?? encounter.history.currentRound ?? null
  const turn = encounter.history.currentTurn?.turn ?? round
  const spent = spendEncounterMoveResourceCosts(encounter.turnResources, {
    placementId,
    canonicalMoveId: 'Disarm',
    resolutionId: operationId,
    sourceOperationId: operationId,
    costs: [{
      id: 'maneuver.disarm.cost.standard-action',
      phase: 'pay',
      cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
    }],
    movementBudget: null,
    movementDistance: 0,
    round,
    turn,
    actedThisRound: false,
  })
  return {
    ...map,
    encounterState: parseEncounterState({ ...encounter, turnResources: spent.resources }),
  }
}

const requiresStandardAction = (value: string | null | undefined): boolean => (
  /\b(?:Standard|Full)(?:\s+Action)?\b/i.test(value ?? '')
)

const applyManeuverCommand = (
  command: LivePlayTableActionCommand,
  context: ResolvedActionContext,
  currentRevision: number,
  dependencies: LivePlayTableActionDependencySet,
): ResolvedActionContext => {
  const payload = expectUseManeuverPayload(command.payload)
  const actor = tokenFromSheet(context.actorPlacement, context.actorSheet)
  const target = context.targetPlacement && context.targetSheet
    ? tokenFromSheet(context.targetPlacement, context.targetSheet)
    : null
  const maneuver = resolveManeuverOption(context.actorPlacement, context.actorSheet, payload.maneuverName)
  if (!maneuver) {
    throw new MapTokenTableActionUseCaseError(
      404,
      `Maneuver ${payload.maneuverName} is not available to token ${payload.placementId}`,
    )
  }
  if (requiresStandardAction(maneuver.action)
    && physicalPowerLoadForActionContext(context)?.standardActionsAllowed === false) {
    rejectLivePlayCommand('invalid', 'Staggering Weight prevents the actor from taking this Standard Action.')
  }
  if (maneuver.name === 'Disengage' && !aa077HasAuthoritativeDisengageWindow({
    map: context.map,
    placementId: context.actorPlacement.id,
  })) {
    rejectLivePlayCommand('invalid', 'Disengage requires the actor’s authoritative current-turn resource ledger.')
  }

  let maneuverMap = context.map
  let disarmResult: ReturnType<typeof resolveAuthoritativeDisarm> | null = null
  if (maneuver.name === 'Disarm') {
    const targetPlacement = context.targetPlacement
    const targetSheet = context.targetSheet
    if (!targetPlacement || !targetSheet) {
      throw new MapTokenTableActionUseCaseError(400, 'Disarm requires one authoritative target placement.')
    }
    if (targetPlacement.id === context.actorPlacement.id) {
      throw new MapTokenTableActionUseCaseError(400, 'Disarm cannot target the acting placement.')
    }
    maneuverMap = spendDisarmStandardAction(maneuverMap, context.actorPlacement.id, command.opId)
    const pokemonSheets = new Map<string, CharacterSheet>()
    const trainerSheets = new Map<string, TrainerSheet>()
    const addSheet = (sheet: PersistedSheet): void => {
      if (sheet.kind === 'pokemon') pokemonSheets.set(sheet.slug, sheet.sheet as unknown as CharacterSheet)
      else trainerSheets.set(sheet.slug, sheet.sheet as unknown as TrainerSheet)
    }
    for (const mapSheet of context.mapSheets.values()) addSheet(mapSheet)
    addSheet(context.actorSheet)
    addSheet(targetSheet)
    try {
      const resolvedDisarm = resolveAuthoritativeDisarm({
        map: maneuverMap,
        actorPlacement: context.actorPlacement,
        targetPlacement,
        actorSheet: context.actorSheet.sheet as unknown as CharacterSheet | TrainerSheet,
        targetSheet: targetSheet.sheet as unknown as CharacterSheet | TrainerSheet,
        pokemonSheets,
        trainerSheets,
        operationId: command.opId,
        rollDie: dependencies.rollDie,
      })
      disarmResult = resolvedDisarm
      maneuverMap = resolvedDisarm.map
    }
    catch (error) {
      rejectLivePlayCommand('invalid', error instanceof Error ? error.message : 'Disarm could not be resolved.')
    }
  }

  const maneuverLines = buildManeuverUseLogLines(actor as SpawnedPokemon, maneuver, {
    target: target as SpawnedPokemon | null,
  })
  const metadata = appendManeuverLogEntry(maneuverMap.metadata, {
    userId: actor.id,
    userName: actor.species,
    maneuverName: maneuver.name,
    lines: [...maneuverLines, ...(disarmResult?.lines ?? [])],
  }, { now: dependencies.now })
  const withMetadata = { ...maneuverMap, metadata }
  const afterBreather = maneuver.name === 'Take a Breather'
    ? cleanupAa065CrueltyHealingBlockForBreather({
        map: withMetadata,
        placementId: context.actorPlacement.id,
      })
    : withMetadata
  const afterPerishCount = maneuver.name === 'Take a Breather'
    ? clearAa083PerishCountForBreather(afterBreather, context.actorPlacement.id)
    : afterBreather
  const afterCurledUp = maneuver.name === 'Take a Breather'
    ? cleanupAa085to100CurledUpForBreather(afterPerishCount, context.actorPlacement.id)
    : afterPerishCount
  const naturalCure = maneuver.name === 'Take a Breather'
    ? applyAa081NaturalCureForBreather({
        map: afterCurledUp,
        placement: context.actorPlacement,
        sheet: context.actorSheet.sheet as unknown as AnyLiveSheet,
        operationId: command.opId,
      })
    : { map: afterCurledUp, sheet: context.actorSheet.sheet as unknown as AnyLiveSheet, applied: false }
  const regenerator = maneuver.name === 'Take a Breather'
    ? applyAa085to100RegeneratorTrigger({
        map: naturalCure.map,
        placement: context.actorPlacement,
        sheet: naturalCure.sheet,
        operationId: command.opId,
        trigger: 'take-a-breather',
        maximumHp: actor.fullMaxHp,
      })
    : { map: naturalCure.map, sheet: naturalCure.sheet, applied: false }
  let capabilityHpMap = regenerator.map
  let capabilityHpSheets: ReadonlyMap<string, CapabilityHpStateSheet> | null = null
  let consultedHpSheetRevisions: ResolvedActionContext['consultedHpSheetRevisions']
  if (regenerator.applied) {
    const previousSheets = new Map<string, CapabilityHpStateSheet>([...context.mapSheets].map(([key, stored]) => [key, {
      kind: stored.kind,
      slug: stored.slug,
      revision: normalizeRevision(stored.revision),
      sheet: stored.sheet as unknown as CharacterSheet | TrainerSheet,
    }]))
    const actorKey = capabilityHpSheetKey(context.actorPlacement.sheetKind, context.actorPlacement.sheetSlug)
    const nextSheets = new Map(previousSheets)
    nextSheets.set(actorKey, {
      ...previousSheets.get(actorKey)!,
      sheet: regenerator.sheet as CharacterSheet | TrainerSheet,
    })
    const reconciled = reconcileCapabilityHpState({
      previousMap: naturalCure.map,
      nextMap: regenerator.map,
      previousSheets,
      sheets: nextSheets,
      touchedPlacementIds: new Set([context.actorPlacement.id]),
    })
    capabilityHpMap = reconciled.nextMap
    capabilityHpSheets = reconciled.sheets
    consultedHpSheetRevisions = [...reconciled.consultedSheetKeys].map((key) => {
      const stored = context.mapSheets.get(key)!
      return { kind: stored.kind, slug: stored.slug, revision: normalizeRevision(stored.revision) }
    })
  }
  const withAbilityTrigger = maneuver.name === 'Grapple' && target
    ? applyAa065CrushTrapGrappleTrigger({
        map: capabilityHpMap,
        actorPlacement: context.actorPlacement,
        actorToken: actor as SpawnedPokemon,
        actorSheet: context.actorSheet.sheet as unknown as CharacterSheet,
        targetToken: target as SpawnedPokemon,
        operationId: command.opId,
      })
    : capabilityHpMap
  const withDisengageEvidence = maneuver.name === 'Disengage'
    ? applyAa077DisengageResourceEvidence({
        map: withAbilityTrigger,
        placementId: context.actorPlacement.id,
        operationId: command.opId,
      })
    : withAbilityTrigger
  const revision = nextRevision(currentRevision)
  const updatedAt = dependencies.now()

  const writePlans = new Map<string, SheetWritePlan>()
  if (naturalCure.applied || regenerator.applied) {
    const actorKey = capabilityHpSheetKey(context.actorPlacement.sheetKind, context.actorPlacement.sheetSlug)
    const actorResult = capabilityHpSheets?.get(actorKey)?.sheet ?? regenerator.sheet
    addOrUpdateWritePlan(writePlans, context.actorSheet, 'ability-lifecycle', () => actorResult as AnyLiveSheet)
  }
  if (capabilityHpSheets) {
    for (const [key, snapshot] of capabilityHpSheets) {
      const original = context.mapSheets.get(key)
      if (!original || key === capabilityHpSheetKey(context.actorPlacement.sheetKind, context.actorPlacement.sheetSlug)) continue
      if (sameJsonValue(original.sheet, snapshot.sheet)) continue
      addOrUpdateWritePlan(writePlans, original, 'capability-hp-reconciliation', () => snapshot.sheet as AnyLiveSheet)
    }
  }
  if (disarmResult?.changedTargetSheet && context.targetSheet) {
    addOrUpdateWritePlan(writePlans, context.targetSheet, 'equipment', () => disarmResult.targetSheet)
  }
  const nextSheets = [...writePlans.values()]
  return {
    ...context,
    map: { ...withDisengageEvidence, revision, updatedAt },
    ...(consultedHpSheetRevisions ? { consultedHpSheetRevisions } : {}),
    ...(nextSheets.length > 0 ? {
      nextSheets,
      sheetUpdates: nextSheets.map(sheetUpdateFromPlan),
    } : {}),
    action: {
      type: 'maneuver',
      placementId: context.actorPlacement.id,
      ...(context.targetPlacement ? { targetPlacementId: context.targetPlacement.id } : {}),
      name: maneuver.name,
    },
  }
}

const applyOrderCommand = (
  command: LivePlayTableActionCommand,
  context: ResolvedActionContext,
  currentRevision: number,
  dependencies: LivePlayTableActionDependencySet,
): ResolvedActionContext => {
  const payload = expectUseOrderPayload(command.payload)
  const actor = tokenFromSheet(context.actorPlacement, context.actorSheet)
  const target = context.targetPlacement && context.targetSheet
    ? tokenFromSheet(context.targetPlacement, context.targetSheet)
    : null
  const order = resolveOrderOption(context.actorPlacement, context.actorSheet, payload.orderName)
  if (!order) {
    throw new MapTokenTableActionUseCaseError(
      context.actorPlacement.sheetKind === 'trainer' ? 404 : 400,
      context.actorPlacement.sheetKind === 'trainer'
        ? `Order ${payload.orderName} is not available to token ${payload.placementId}`
        : `Order ${payload.orderName} can only be used by trainer tokens`,
    )
  }
  if (requiresStandardAction(order.frequency)
    && physicalPowerLoadForActionContext(context)?.standardActionsAllowed === false) {
    rejectLivePlayCommand('invalid', 'Staggering Weight prevents the actor from taking this Standard Action.')
  }
  if (orderTargetLabel(order) !== null && !target) {
    throw new MapTokenTableActionUseCaseError(400, `Order ${order.name} requires a target token`)
  }

  const activeEffect = createActiveOrderEffect({
    user: actor,
    order,
    target,
    timeline: currentOrderTimeline(context.map),
    ...(dependencies.idFactory ? { idFactory: dependencies.idFactory } : {}),
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
  }, { now: dependencies.now })
  const revision = nextRevision(currentRevision)
  const updatedAt = dependencies.now()

  return {
    ...context,
    map: { ...context.map, metadata, revision, updatedAt },
    action: {
      type: 'order',
      placementId: context.actorPlacement.id,
      ...(context.targetPlacement ? { targetPlacementId: context.targetPlacement.id } : {}),
      name: order.name,
    },
  }
}

const applyTableActionCommand = (
  command: LivePlayTableActionCommand,
  context: ResolvedActionContext,
  currentRevision: number,
  dependencies: LivePlayTableActionDependencySet,
): ResolvedActionContext => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER) {
    return applyManeuverCommand(command, context, currentRevision, dependencies)
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.USE_ORDER) {
    return applyOrderCommand(command, context, currentRevision, dependencies)
  }
  throw new MapTokenTableActionUseCaseError(410, LEGACY_USE_ABILITY_RETIRED_MESSAGE)
}

const metadataPatch = (
  command: LivePlayTableActionCommand,
  revision: number,
  previousContext: ResolvedActionContext,
  nextContext: ResolvedActionContext,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_METADATA> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
  mapSlug: command.mapSlug,
  revision,
  scopes: command.scopes,
  payload: {
    action: nextContext.action,
    previous: previousContext.map.metadata ?? {},
    current: nextContext.map.metadata ?? {},
  },
})

const sheetFieldPatch = (
  command: LivePlayTableActionCommand,
  revision: number,
  plan: SheetWritePlan,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.SHEET_FIELD> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.SHEET_FIELD,
  mapSlug: command.mapSlug,
  revision,
  scopes: [{ kind: 'sheet', sheetKind: plan.kind, sheetSlug: plan.slug, field: plan.field }],
  payload: {
    action: command.type,
    sheetKind: plan.kind,
    sheetSlug: plan.slug,
    field: plan.field,
    previousRevision: plan.original.revision,
    sheetRevision: nextRevision(plan.original.revision),
  },
})

const patchesForAcceptedTableActionCommand = (
  command: LivePlayTableActionCommand,
  revision: number,
  previousContext: ResolvedActionContext,
  nextContext: ResolvedActionContext,
): LivePlayPatch[] => [
  metadataPatch(command, revision, previousContext, nextContext),
  ...(nextContext.nextSheets ?? []).map((plan) => sheetFieldPatch(command, revision, plan)),
]

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const placementIdFromAcceptedResult = (result: LivePlayCommandAccepted): string | null => (
  result.patches[0]?.scopes.find((scope): scope is LivePlayTokenScope => scope.kind === 'token')?.placementId ?? null
)

const actionFromAcceptedResult = (result: LivePlayCommandAccepted): LivePlayTableActionSummary | undefined => {
  const metadata = result.patches.find((patch) => patch.type === LIVE_PLAY_PATCH_TYPES.MAP_METADATA)
  const payload = isRecord(metadata?.payload) ? metadata.payload : null
  const action = isRecord(payload?.action) ? payload.action : null
  if (!action || typeof action.type !== 'string' || typeof action.placementId !== 'string' || typeof action.name !== 'string') return undefined
  return {
    type: action.type as LivePlayTableActionSummary['type'],
    placementId: action.placementId,
    ...(typeof action.targetPlacementId === 'string' ? { targetPlacementId: action.targetPlacementId } : {}),
    name: action.name,
  }
}

const sheetRefsFromAcceptedResult = (result: LivePlayCommandAccepted): readonly LivePlaySheetScope[] => {
  const refs = new Map<string, LivePlaySheetScope>()
  for (const patch of result.patches) {
    for (const scope of patch.scopes) {
      if (scope.kind !== 'sheet') continue
      refs.set(`${scope.sheetKind}:${scope.sheetSlug}`, scope)
    }
  }
  return [...refs.values()]
}

const responseFromContext = (
  result: LivePlayCommandResult,
  context: ResolvedActionContext | null,
  role: AuthRole,
): LivePlayTableActionCommandResponse => ({
  result,
  ...(context ? {
    path: context.relativePath,
    map: context.map,
    placement: context.actorPlacement,
    ...(context.action ? { action: context.action } : {}),
    sheetUpdates: role === 'player'
      ? (redactSheetUpdatesForPlayer([...(context.sheetUpdates ?? [])]) ?? [])
      : [...(context.sheetUpdates ?? [])],
  } : {}),
})

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  role: AuthRole,
  playerProfile: PlayerProfile | null | undefined,
  dependencies: LivePlayTableActionDependencySet,
): Promise<ResolvedActionContext | null> => {
  const placementId = placementIdFromAcceptedResult(result)
  if (!placementId) return null

  try {
    const map = await dependencies.mapRepository.getBySlug(result.mapSlug)
    if (!map) return null
    const actorPlacement = map.placements.find((placement) => placement.id === placementId)
    if (!actorPlacement) return null
    if (!canAccessMapForRole(role, map)) return null
    const linkedTrainerSheets = await playerProfileLinkedTrainerSheetsForTokenControlAsync(
      playerProfile,
      async (slug) => {
        const sheet = await dependencies.sheetRepository.getByRef('trainer', slug)
        return sheet ? tokenControlTrainerSheet(sheet) : null
      },
    )
    if (!actorCanControlMapPlacement({ role, profile: playerProfile, placement: actorPlacement, linkedTrainerSheets })) return null
    const actorSheet = await readRequiredSheet(actorPlacement, dependencies, 'accepted table action replay')
    const sheetUpdates: LivePlayTableActionSheetUpdate[] = []
    for (const ref of sheetRefsFromAcceptedResult(result)) {
      const sheet = await dependencies.sheetRepository.getByRef(ref.sheetKind, ref.sheetSlug)
      if (sheet) sheetUpdates.push(sheetUpdateFromPersisted(sheet))
    }
    const mapPath = mapPathForDocument(map)
    return {
      mapPath,
      relativePath: dependencies.relativePath(mapPath),
      map,
      actorPlacement,
      actorSheet,
      linkedTrainerSheets,
      mapSheets: new Map([[capabilityHpSheetKey(actorPlacement.sheetKind, actorPlacement.sheetSlug), actorSheet]]),
      action: actionFromAcceptedResult(result),
      sheetUpdates,
    }
  } catch {
    return null
  }
}

export const executeLivePlayTableActionCommandUseCase = async (
  input: ExecuteLivePlayTableActionCommandInput,
  dependencies: LivePlayTableActionCommandDependencies = {},
): Promise<LivePlayTableActionCommandResponse> => {
  if (isRecord(input.command) && input.command.type === LIVE_PLAY_COMMAND_TYPES.USE_ABILITY) {
    throw new MapTokenTableActionUseCaseError(410, LEGACY_USE_ABILITY_RETIRED_MESSAGE)
  }
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedActionContext | null = null

  const result = await deps.commandExecutor.execute<LivePlayTableActionCommand, ResolvedActionContext, LivePlayTableActionActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
      playerProfile: input.playerProfile,
    },
    readMap: ({ command, actor }) => resolveContext(command, actor, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    authorize: ({ command, actor, map }) => {
      assertTableActionCommandType(command, input.expectedType)
      validateCommandPayloadAndScopes(command)
      if (!actorCanControlMapPlacement({
        role: actor.role,
        profile: actor.playerProfile,
        placement: map.actorPlacement,
        linkedTrainerSheets: map.linkedTrainerSheets,
      })) {
        throw new MapTokenTableActionUseCaseError(403, controlDeniedMessage(actor.role, actor.playerProfile))
      }
    },
    apply: ({ command, map, currentRevision }) => {
      const nextContext = applyTableActionCommand(command, map, currentRevision, deps)
      if (!nextContext.action) {
        return {
          status: 'rejected',
          reason: 'no-op',
          message: `${command.type} did not change token ${map.actorPlacement.id}`,
          currentRevision,
          currentState: map.actorPlacement,
        }
      }

      const revision = nextRevision(currentRevision)
      return {
        status: 'accepted',
        nextMap: nextContext,
        previousRevision: currentRevision,
        revision,
        patches: patchesForAcceptedTableActionCommand(command, revision, map, nextContext),
      }
    },
    persist: () => {
      throw new Error('live-play table action commands must persist through the accepted-result commit hook')
    },
    commit: ({ actor, command, currentRevision, nextMap, result, recordRealtimeEvents, saveOpResult }) => {
      deps.database.withTransaction(() => {
        for (const read of nextMap.consultedHpSheetRevisions ?? []) {
          const current = deps.sheetRepository.getByRef(read.kind, read.slug)
          if (!current || normalizeRevision(current.revision) !== read.revision) {
            throw new MapTokenTableActionUseCaseError(
              409,
              `Sheet ${read.kind}/${read.slug} changed before Capability HP reconciliation could be persisted`,
            )
          }
        }
        const persistedMap = toPersistedMap(
          nextMap.map,
          nextMap.map.folder ?? '',
          nextMap.map.updatedAt ?? deps.now(),
          { revision: result.revision },
        )
        const mapResult = deps.mapRepository.applyLivePlayUpdate({
          slug: result.mapSlug,
          expectedRevision: currentRevision,
          nextMap: persistedMap,
        })
        if (mapResult === 'stale') {
          throw new MapTokenTableActionUseCaseError(409, `Map ${result.mapSlug} changed before the live-play command could be persisted`)
        }

        for (const plan of nextMap.nextSheets ?? []) {
          const sheetResult = deps.sheetRepository.applyLivePlayUpdate({
            kind: plan.kind,
            slug: plan.slug,
            expectedRevision: plan.original.revision,
            nextSheet: plan.next,
          })
          if (sheetResult === 'stale') {
            throw new MapTokenTableActionUseCaseError(409, `Sheet ${plan.kind}/${plan.slug} changed before the live-play command could be persisted`)
          }
        }

        const sheetUpdates: LivePlayTableActionSheetUpdate[] = []
        for (const plan of nextMap.nextSheets ?? []) {
          const sheet = deps.sheetRepository.getByRef(plan.kind, plan.slug)
          if (!sheet) throw new MapTokenTableActionUseCaseError(404, `Sheet ${plan.kind}/${plan.slug} not found after live-play command`)
          sheetUpdates.push(sheetUpdateFromPersisted(sheet))
        }
        recordRealtimeEvents(livePlaySheetUpdateRealtimeAppendInputs({
          command,
          updates: sheetUpdates,
          clientId: actor.clientId,
        }))
        saveOpResult()

        const authoritativeMap = deps.mapRepository.getBySlug(result.mapSlug)
        if (!authoritativeMap) throw new MapTokenTableActionUseCaseError(404, `Map ${result.mapSlug}.json not found after live-play command`)
        const actorPlacement = authoritativeMap.placements.find((placement) => placement.id === nextMap.actorPlacement.id)
        if (!actorPlacement) throw new MapTokenTableActionUseCaseError(404, `Placement ${nextMap.actorPlacement.id} not found after live-play command`)
        const actorSheet = readRequiredSheetSync(actorPlacement, deps, 'table action response')
        const targetPlacement = nextMap.targetPlacement
          ? authoritativeMap.placements.find((placement) => placement.id === nextMap.targetPlacement?.id)
          : undefined
        const targetSheet = targetPlacement
          ? readRequiredSheetSync(targetPlacement, deps, 'table action target response')
          : undefined
        persistedContext = {
          ...nextMap,
          map: authoritativeMap,
          actorPlacement,
          ...(targetPlacement ? { targetPlacement } : {}),
          actorSheet,
          ...(targetSheet ? { targetSheet } : {}),
          sheetUpdates,
        }
      })
    },
  })

  const responseContext = persistedContext
    ?? (isAcceptedResult(result)
      ? await currentContextForAcceptedResult(result, input.role, input.playerProfile, deps)
      : null)
  return responseFromContext(result, responseContext, input.role)
}
