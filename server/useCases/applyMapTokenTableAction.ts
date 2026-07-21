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
  type UseAbilityPayload,
  type UseManeuverPayload,
  type UseOrderPayload,
} from '#shared/livePlayCommands'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AbilityAutomationCategory } from '~/types/abilityAutomation'
import { abilityEntriesForPlacement } from '~/utils/mapTokenAbilities'
import { referenceManeuverOptions, trainerManeuverOptionsForSheet, type TokenManeuverMenuOption } from '~/utils/mapTokenManeuvers'
import { trainerOrderOptionsForSheet, type TokenOrderMenuOption } from '~/utils/mapTokenOrders'
import {
  applyAbilityActivationToSheet,
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  toPersistableSheetPayload,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import {
  buildLegacyTokenAbilityMenuOptions,
  getLegacyMapAbilityAutomation as getMapAbilityAutomation,
  resolveLegacyMapAbilityAutomationTransaction as resolveMapAbilityAutomationTransaction,
  type LegacyTokenAbilityMenuOption,
} from '../domain/abilityAutomation/legacyCompatibility'
import { appendAbilityAutomationLogEntry } from '~/utils/abilityAutomationLog'
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

export class MapTokenTableActionUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

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
  readonly type: 'maneuver' | 'ability' | 'order'
  readonly placementId: string
  readonly targetPlacementId?: string
  readonly name: string
  readonly category?: AbilityAutomationCategory
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
  'id' | 'species' | 'position' | 'sheetKind' | 'sheetSlug' | 'combatStages' | 'conditions'
> {}

type UnknownRecord = Record<string, unknown>
type TableActionPayload = UseManeuverPayload | UseAbilityPayload | UseOrderPayload

const livePlayTableActionCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const tableActionCommandTypes = new Set<string>([
  LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
  LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
  LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
])

const actionDependencies = (dependencies: LivePlayTableActionCommandDependencies) => ({
  commandExecutor: dependencies.commandExecutor ?? livePlayTableActionCommandExecutor,
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  sheetRepository: dependencies.sheetRepository ?? sqliteSheetRepository,
  database: dependencies.database ?? getRotomDatabase(),
  now: dependencies.now ?? Date.now,
  idFactory: dependencies.idFactory,
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

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

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

const expectUseAbilityPayload = (payload: unknown): UseAbilityPayload => {
  const base = expectBasePayload(payload, 'useAbility', 'abilityName')
  return {
    placementId: base.placementId,
    abilityName: base.name,
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
  if (command.type === LIVE_PLAY_COMMAND_TYPES.USE_ABILITY) return expectUseAbilityPayload(command.payload)
  return expectUseOrderPayload(command.payload)
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

const sheetScopeMatches = (
  scopes: readonly LivePlayScope[],
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  field: string,
): boolean => scopes.some((scope) => (
  scope.kind === 'sheet'
  && scope.sheetKind === placement.sheetKind
  && scope.sheetSlug === placement.sheetSlug
  && scope.field === field
))

const mismatchedSheetScope = (
  scopes: readonly LivePlayScope[],
  placements: readonly Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>[],
): LivePlaySheetScope | null => (
  scopes.find((scope): scope is LivePlaySheetScope => (
    scope.kind === 'sheet'
    && !placements.some((placement) => placement.sheetKind === scope.sheetKind && placement.sheetSlug === scope.sheetSlug)
  )) ?? null
)

const assertTableActionCommandType = (command: LivePlayTableActionCommand, expectedType?: LivePlayTableActionCommandType): void => {
  if (expectedType && command.type !== expectedType) {
    rejectLivePlayCommand('invalid', `This route only accepts ${expectedType} commands`)
  }
  if (!tableActionCommandTypes.has(command.type)) {
    rejectLivePlayCommand('invalid', 'Table-action live-play routes support useManeuver, useAbility, and useOrder commands only')
  }
}

const validateCommandPayloadAndScopes = (
  command: LivePlayTableActionCommand,
  context: Pick<ResolvedActionContext, 'actorPlacement' | 'targetPlacement'>,
): TableActionPayload => {
  const payload = commandPayload(command)
  if (!tokenActionScopeMatches(command.scopes, payload.placementId)) {
    rejectLivePlayCommand('invalid', `${command.type} scopes must include the token action scope for payload.placementId`)
  }
  if (!metadataScopeMatches(command.scopes)) {
    rejectLivePlayCommand('invalid', `${command.type} scopes must include the map metadata scope`)
  }

  if (command.type === LIVE_PLAY_COMMAND_TYPES.USE_ABILITY) {
    const sheetPlacements = [context.actorPlacement, ...(context.targetPlacement ? [context.targetPlacement] : [])]
    const badSheetScope = mismatchedSheetScope(command.scopes, sheetPlacements)
    if (badSheetScope) {
      rejectLivePlayCommand('invalid', `${command.type} sheet scope ${badSheetScope.sheetKind}/${badSheetScope.sheetSlug} does not match the actor or target token`)
    }
    if (!sheetScopeMatches(command.scopes, context.actorPlacement, 'ability')) {
      rejectLivePlayCommand('invalid', `${command.type} scopes must include the actor sheet ability scope`)
    }
    if (context.targetPlacement && !sheetScopeMatches(command.scopes, context.targetPlacement, 'ability')) {
      rejectLivePlayCommand('invalid', `${command.type} scopes must include the target sheet ability scope`)
    }
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

  const actorSheet = await readRequiredSheet(actorPlacement, dependencies, command.type)
  const targetSheet = targetPlacement
    ? await readRequiredSheet(targetPlacement, dependencies, `${command.type} target`)
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

const resolveAbilityOption = (
  placement: SheetPlacement,
  sheet: PersistedSheet,
  requestedName: string,
): LegacyTokenAbilityMenuOption | null => {
  const sheets = placement.sheetKind === 'pokemon'
    ? { pokemon: new Map([[placement.sheetSlug, sheet.sheet as unknown as CharacterSheet]]) }
    : { trainer: new Map([[placement.sheetSlug, sheet.sheet as unknown as TrainerSheet]]) }
  const options = buildLegacyTokenAbilityMenuOptions(abilityEntriesForPlacement(placement, sheets))
  return options.find((option) => optionMatchesName(option.name, requestedName)) ?? null
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

  const metadata = appendManeuverLogEntry(context.map.metadata, {
    userId: actor.id,
    userName: actor.species,
    maneuverName: maneuver.name,
    lines: buildManeuverUseLogLines(actor as SpawnedPokemon, maneuver, { target: target as SpawnedPokemon | null }),
  }, { now: dependencies.now })
  const revision = nextRevision(currentRevision)
  const updatedAt = dependencies.now()

  return {
    ...context,
    map: { ...context.map, metadata, revision, updatedAt },
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

const applyAbilityCommand = (
  command: LivePlayTableActionCommand,
  context: ResolvedActionContext,
  currentRevision: number,
  dependencies: LivePlayTableActionDependencySet,
): ResolvedActionContext => {
  const payload = expectUseAbilityPayload(command.payload)
  const actor = tokenFromSheet(context.actorPlacement, context.actorSheet)
  const target = context.targetPlacement && context.targetSheet
    ? tokenFromSheet(context.targetPlacement, context.targetSheet)
    : null
  const option = resolveAbilityOption(context.actorPlacement, context.actorSheet, payload.abilityName)
  if (!option) {
    throw new MapTokenTableActionUseCaseError(
      404,
      `Ability ${payload.abilityName} is not present on token ${payload.placementId}'s sheet`,
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
  const updatedAt = dependencies.now()

  if (option.automation.category === 'sheet') {
    if (option.activated) {
      throw new MapTokenTableActionUseCaseError(409, `Ability ${option.name} is already active on token ${payload.placementId}`)
    }
    addOrUpdateWritePlan(writePlans, context.actorSheet, 'ability', (kind, sheet) =>
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
      const updateSheet = update.id === actor.id
        ? context.actorSheet
        : update.id === target?.id
          ? context.targetSheet
          : undefined
      if (!updateSheet) {
        throw new MapTokenTableActionUseCaseError(409, `Ability ${option.name} references unavailable combat-stage target ${update.id}`)
      }
      addOrUpdateWritePlan(writePlans, updateSheet, 'combatStages', (kind, sheet) =>
        applyCombatStagesToSheet(kind, sheet, update.stages as CombatStageMap),
      )
      combatStageUpdates.push({ id: update.id, stages: update.stages as CombatStageMap })
    }
    for (const update of transaction.conditionUpdates) {
      const updateSheet = update.id === actor.id
        ? context.actorSheet
        : update.id === target?.id
          ? context.targetSheet
          : undefined
      if (!updateSheet) {
        throw new MapTokenTableActionUseCaseError(409, `Ability ${option.name} references unavailable condition target ${update.id}`)
      }
      addOrUpdateWritePlan(writePlans, updateSheet, 'conditions', (kind, sheet) =>
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
  }, { now: () => updatedAt })
  const revision = nextRevision(currentRevision)
  const sheetUpdates = [...writePlans.values()].map(sheetUpdateFromPlan)

  return {
    ...context,
    map: { ...context.map, metadata, revision, updatedAt },
    nextSheets: [...writePlans.values()],
    sheetUpdates,
    action: {
      type: 'ability',
      placementId: context.actorPlacement.id,
      ...(context.targetPlacement ? { targetPlacementId: context.targetPlacement.id } : {}),
      name: option.name,
      category,
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
  return applyAbilityCommand(command, context, currentRevision, dependencies)
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
    ...(typeof action.category === 'string' ? { category: action.category as AbilityAutomationCategory } : {}),
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
      validateCommandPayloadAndScopes(command, map)
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
