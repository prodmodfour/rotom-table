import { join } from 'node:path'
import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayPatch,
  type LivePlayScope,
  type LivePlaySheetCommand,
  type LivePlaySheetScope,
  type LivePlayTokenScope,
  type ModifyCombatStagesLivePlayCommand,
  type ModifyCombatStagesPayload,
  type ModifyConditionsLivePlayCommand,
  type ModifyConditionsPayload,
  type ModifyHpLivePlayCommand,
  type ModifyHpPayload,
} from '#shared/livePlayCommands'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { sheetChannel, sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { COMBAT_STAGE_KEYS } from '~/utils/combatStages'
import { sameJsonValue } from '~/utils/serialization'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  applyHpToSheet,
  toPersistableSheetPayload,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { actorCanControlMapPlacement } from '../policies/playerProfileTokenControlPolicy'
import { canSaveMap } from '../policies/mapPolicy'
import {
  createAuthoritativeLivePlayCommandExecutor,
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { sqliteLivePlayOpRepository } from '../storage/opRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  sqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import { campaignPathLabel } from '../utils/campaignPaths'
import { MAPS_ROOT } from '../utils/mapPaths'
import {
  livePlayCommandAcceptedRealtimeEvent,
  mapDocumentUpdatedRealtimeEvents,
} from '../utils/mapRealtimeEvents'
import { publishRealtime } from '../utils/realtime'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'

export class LivePlaySheetCommandUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export type LivePlaySheetCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_HP
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS

export interface LivePlaySheetCommandActor {
  readonly role: AuthRole
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
}

export interface ExecuteLivePlaySheetCommandInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
  readonly expectedType?: LivePlaySheetCommandType
}

export interface LivePlaySheetCommandSheetUpdate {
  readonly kind: SheetKind
  readonly slug: string
  readonly path?: string
  readonly sheet: Record<string, unknown>
}

export interface LivePlaySheetCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly placement?: SheetPlacement
  readonly sheetUpdates?: LivePlaySheetCommandSheetUpdate[]
}

export interface LivePlaySheetCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'applyLivePlayUpdate'>
  readonly database?: Pick<RotomDatabase, 'withAsyncTransaction'>
  readonly publishRealtimeEvent?: (event: Omit<RealtimeEvent, 'timestamp'>) => void
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
}

interface ResolvedLivePlaySheetCommandContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: PersistedSheet
  readonly nextSheet?: Record<string, unknown>
  readonly sheetUpdate?: LivePlaySheetCommandSheetUpdate
}

interface HpValueState {
  readonly currentHp: number
  readonly maxHp: number
  readonly fullMaxHp: number
  readonly injuries: number
}

const livePlaySheetCommandExecutor = createAuthoritativeLivePlayCommandExecutor({
  opStore: sqliteLivePlayOpRepository,
})

const sheetCommandTypes = new Set<string>([
  LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
  LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES,
  LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
])

const actionDependencies = (dependencies: LivePlaySheetCommandDependencies) => ({
  commandExecutor: dependencies.commandExecutor ?? livePlaySheetCommandExecutor,
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  sheetRepository: dependencies.sheetRepository ?? sqliteSheetRepository,
  database: dependencies.database ?? getRotomDatabase(),
  publishRealtimeEvent: dependencies.publishRealtimeEvent ?? publishRealtime,
  now: dependencies.now ?? Date.now,
  relativePath: dependencies.relativePath ?? campaignPathLabel,
})

type LivePlaySheetCommandDependencySet = ReturnType<typeof actionDependencies>

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => (
  map.folder ? join(MAPS_ROOT, map.folder, `${map.slug}.json`) : join(MAPS_ROOT, `${map.slug}.json`)
)

const controlDeniedMessage = (role: AuthRole, profile: PlayerProfile | null | undefined): string => (
  role === 'player' && !profile
    ? 'Select a player profile to control linked map tokens'
    : 'Token is not linked to selected player profile'
)

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const expectPlacementId = (payload: UnknownRecord, commandName: string): string => {
  if (!nonEmptyString(payload.placementId)) {
    rejectLivePlayCommand('invalid', `${commandName} payload.placementId is required`)
  }
  return payload.placementId as string
}

const expectModifyHpPayload = (payload: unknown): ModifyHpPayload => {
  if (!isRecord(payload)) rejectLivePlayCommand('invalid', 'modifyHp payload must be an object')
  const record = payload as UnknownRecord
  const placementId = expectPlacementId(record, 'modifyHp')
  if (!finiteNumber(record.currentHp)) {
    rejectLivePlayCommand('invalid', 'modifyHp payload.currentHp must be a finite number')
  }
  if (record.injuries !== undefined && !finiteNumber(record.injuries)) {
    rejectLivePlayCommand('invalid', 'modifyHp payload.injuries must be a finite number when provided')
  }
  return {
    placementId,
    currentHp: record.currentHp as number,
    ...(record.injuries === undefined ? {} : { injuries: record.injuries as number }),
  }
}

const expectModifyCombatStagesPayload = (payload: unknown): ModifyCombatStagesPayload => {
  if (!isRecord(payload)) rejectLivePlayCommand('invalid', 'modifyCombatStages payload must be an object')
  const record = payload as UnknownRecord
  const placementId = expectPlacementId(record, 'modifyCombatStages')
  if (!isRecord(record.stages)) {
    rejectLivePlayCommand('invalid', 'modifyCombatStages payload.stages must be an object')
  }

  const stages = record.stages as UnknownRecord
  for (const key of COMBAT_STAGE_KEYS) {
    if (!finiteNumber(stages[key])) {
      rejectLivePlayCommand('invalid', `modifyCombatStages payload.stages.${key} must be a finite number`)
    }
  }

  return {
    placementId,
    stages: {
      atk: stages.atk as number,
      def: stages.def as number,
      satk: stages.satk as number,
      sdef: stages.sdef as number,
      spd: stages.spd as number,
      acc: stages.acc as number,
    },
  }
}

const isModifyConditionsAction = (value: unknown): value is ModifyConditionsPayload['action'] => (
  value === 'add' || value === 'remove' || value === 'replace'
)

const expectModifyConditionsPayload = (payload: unknown): ModifyConditionsPayload => {
  if (!isRecord(payload)) rejectLivePlayCommand('invalid', 'modifyConditions payload must be an object')
  const record = payload as UnknownRecord
  const placementId = expectPlacementId(record, 'modifyConditions')
  if (!isModifyConditionsAction(record.action)) {
    rejectLivePlayCommand('invalid', 'modifyConditions payload.action must be add, remove, or replace')
  }
  if (!Array.isArray(record.conditions) || record.conditions.some((condition: unknown) => typeof condition !== 'string')) {
    rejectLivePlayCommand('invalid', 'modifyConditions payload.conditions must be an array of strings')
  }
  const conditions = record.conditions as string[]
  return {
    placementId,
    action: record.action as ModifyConditionsPayload['action'],
    conditions: [...conditions],
  }
}

const commandPayload = (command: LivePlaySheetCommand): ModifyHpPayload | ModifyCombatStagesPayload | ModifyConditionsPayload => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP) return expectModifyHpPayload(command.payload)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES) return expectModifyCombatStagesPayload(command.payload)
  return expectModifyConditionsPayload(command.payload)
}

const commandPlacementId = (command: LivePlaySheetCommand): string => {
  if (!isRecord(command.payload)) rejectLivePlayCommand('invalid', `${command.type} payload must be an object`)
  return expectPlacementId(command.payload as unknown as UnknownRecord, command.type)
}

const tokenScopeFieldFor = (command: Pick<LivePlaySheetCommand, 'type'>): LivePlayTokenScope['field'] => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP) return 'hp'
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES) return 'combatStages'
  return 'conditions'
}

const sheetScopeFieldFor = (command: Pick<LivePlaySheetCommand, 'type'>): string => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP) return 'hp'
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES) return 'combatStages'
  return 'conditions'
}

const tokenScopeMatches = (
  scopes: readonly LivePlayScope[],
  placementId: string,
  field: LivePlayTokenScope['field'],
): boolean => scopes.some((scope) => (
  scope.kind === 'token' && scope.placementId === placementId && scope.field === field
))

const mismatchedSheetScope = (
  scopes: readonly LivePlayScope[],
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): LivePlaySheetScope | null => (
  scopes.find((scope): scope is LivePlaySheetScope => (
    scope.kind === 'sheet'
    && (scope.sheetKind !== placement.sheetKind || scope.sheetSlug !== placement.sheetSlug)
  )) ?? null
)

const validateCommandPayloadAndScopes = (
  command: LivePlaySheetCommand,
  placement?: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): ModifyHpPayload | ModifyCombatStagesPayload | ModifyConditionsPayload => {
  const payload = commandPayload(command)
  const tokenField = tokenScopeFieldFor(command)
  if (!tokenScopeMatches(command.scopes, payload.placementId, tokenField)) {
    rejectLivePlayCommand('invalid', `${command.type} scopes must include the token ${tokenField} scope for payload.placementId`)
  }

  if (placement) {
    const badSheetScope = mismatchedSheetScope(command.scopes, placement)
    if (badSheetScope) {
      rejectLivePlayCommand(
        'invalid',
        `${command.type} sheet scope ${badSheetScope.sheetKind}/${badSheetScope.sheetSlug} does not match placement ${placement.sheetKind}/${placement.sheetSlug}`,
      )
    }
  }

  return payload
}

const assertSheetCommandType = (command: LivePlaySheetCommand, expectedType?: LivePlaySheetCommandType): void => {
  if (expectedType && command.type !== expectedType) {
    rejectLivePlayCommand('invalid', `This route only accepts ${expectedType} commands`)
  }
  if (!sheetCommandTypes.has(command.type)) {
    rejectLivePlayCommand('invalid', 'Sheet live-play routes support modifyHp, modifyCombatStages, and modifyConditions commands only')
  }
}

const resolveContext = async (
  command: LivePlaySheetCommand,
  actor: LivePlaySheetCommandActor,
  dependencies: LivePlaySheetCommandDependencySet,
): Promise<ResolvedLivePlaySheetCommandContext> => {
  const placementId = commandPlacementId(command)
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw new LivePlaySheetCommandUseCaseError(404, `Map ${command.mapSlug}.json not found`)

  if (!canSaveMap(actor.role, map)) {
    throw new LivePlaySheetCommandUseCaseError(403, 'Map is not player visible')
  }

  const placement = map.placements.find((candidate) => candidate.id === placementId)
  if (!placement) throw new LivePlaySheetCommandUseCaseError(404, `Placement ${placementId} not found`)

  const sheet = await dependencies.sheetRepository.getByRef(placement.sheetKind, placement.sheetSlug)
  if (!sheet) {
    throw new LivePlaySheetCommandUseCaseError(404, `Sheet ${placement.sheetKind}/${placement.sheetSlug} not found`)
  }

  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
    placement,
    sheet,
  }
}

const hpSnapshotForSheet = (kind: SheetKind, sheet: AnyLiveSheet): HpValueState => {
  const snapshot = kind === 'pokemon'
    ? pokemonHpSnapshot(sheet as CharacterSheet)
    : trainerHpSnapshot(sheet as TrainerSheet)
  return {
    currentHp: snapshot.currentHp,
    maxHp: snapshot.maxHp,
    fullMaxHp: snapshot.fullMaxHp,
    injuries: snapshot.injuries,
  }
}

const combatStagesSnapshotForSheet = (kind: SheetKind, sheet: AnyLiveSheet): CombatStageMap => {
  const snapshot = kind === 'pokemon'
    ? pokemonHpSnapshot(sheet as CharacterSheet)
    : trainerHpSnapshot(sheet as TrainerSheet)
  return { ...snapshot.combatStages }
}

const conditionsSnapshotForSheet = (kind: SheetKind, sheet: AnyLiveSheet): string[] => {
  const snapshot = kind === 'pokemon'
    ? pokemonHpSnapshot(sheet as CharacterSheet)
    : trainerHpSnapshot(sheet as TrainerSheet)
  return [...snapshot.conditions]
}

const sameStringArray = (left: readonly string[], right: readonly string[]): boolean => (
  left.length === right.length && left.every((value, index) => value === right[index])
)

const conditionsAfterAction = (
  previous: readonly string[],
  payload: ModifyConditionsPayload,
): string[] => {
  const requested = normalizeConditionNames(payload.conditions)
  if (payload.action === 'replace') return requested
  if (payload.action === 'add') return normalizeConditionNames([...previous, ...requested])

  const removals = new Set(requested)
  return normalizeConditionNames(previous.filter((condition) => !removals.has(condition)))
}

const sheetPayloadForPersistence = (
  sheet: AnyLiveSheet,
  slug: string,
  updatedAt: number,
): Record<string, unknown> => ({
  ...toPersistableSheetPayload(sheet as unknown as Record<string, unknown>),
  slug,
  updatedAt,
})

const sheetUpdateFromPersisted = (sheet: PersistedSheet): LivePlaySheetCommandSheetUpdate => ({
  kind: sheet.kind,
  slug: sheet.slug,
  sheet: sheet.sheet,
})

const sheetRealtimeEvents = (
  updates: readonly LivePlaySheetCommandSheetUpdate[],
  clientId: string | undefined,
): Array<Omit<RealtimeEvent, 'timestamp'>> => updates.flatMap((update) => {
  const data = { kind: update.kind, slug: update.slug, sheet: update.sheet }
  return [
    { channel: sheetChannel(update.kind, update.slug), type: 'updated' as const, clientId, data },
    { channel: sheetsChannel, type: 'updated' as const, clientId, data },
  ]
})

const mapEvents = (
  map: TabletopMap,
  clientId: string | undefined,
): Array<Omit<RealtimeEvent, 'timestamp'>> => mapDocumentUpdatedRealtimeEvents(map, clientId)

const sheetFieldPatch = (
  command: LivePlaySheetCommand,
  revision: number,
  placement: SheetPlacement,
  payload: Record<string, unknown>,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.SHEET_FIELD> => {
  const field = sheetScopeFieldFor(command)
  const sheetScopes = command.scopes.filter((scope): scope is LivePlaySheetScope => scope.kind === 'sheet')
  return {
    schemaVersion: command.schemaVersion,
    type: LIVE_PLAY_PATCH_TYPES.SHEET_FIELD,
    mapSlug: command.mapSlug,
    revision,
    scopes: sheetScopes.length > 0
      ? sheetScopes
      : [{ kind: 'sheet', sheetKind: placement.sheetKind, sheetSlug: placement.sheetSlug, field }],
    payload: {
      placementId: placement.id,
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      field,
      ...payload,
    },
  }
}

const tokenPatch = (
  command: LivePlaySheetCommand,
  revision: number,
  placement: SheetPlacement,
  payload: Record<string, unknown>,
): LivePlayPatch => ({
  schemaVersion: command.schemaVersion,
  type: command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP
    ? LIVE_PLAY_PATCH_TYPES.TOKEN_HP
    : command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES
      ? LIVE_PLAY_PATCH_TYPES.TOKEN_COMBAT_STAGES
      : LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS,
  mapSlug: command.mapSlug,
  revision,
  scopes: command.scopes,
  payload: {
    placementId: placement.id,
    sheetKind: placement.sheetKind,
    sheetSlug: placement.sheetSlug,
    ...payload,
  },
})

const applyModifyHp = (
  command: ModifyHpLivePlayCommand,
  context: ResolvedLivePlaySheetCommandContext,
  currentRevision: number,
  updatedAt: number,
): ResolvedLivePlaySheetCommandContext | null => {
  const payload = expectModifyHpPayload(command.payload)
  const original = context.sheet.sheet as unknown as AnyLiveSheet
  const previous = hpSnapshotForSheet(context.placement.sheetKind, original)
  const updated = applyHpToSheet(context.placement.sheetKind, original, payload.currentHp, payload.injuries)
  const current = hpSnapshotForSheet(context.placement.sheetKind, updated)
  if (previous.currentHp === current.currentHp && previous.injuries === current.injuries) return null

  const nextSheetRevision = nextRevision(context.sheet.revision)
  const revision = nextRevision(currentRevision)
  return {
    ...context,
    map: { ...context.map, revision, updatedAt },
    nextSheet: sheetPayloadForPersistence(updated, context.sheet.slug, updatedAt),
    sheetUpdate: {
      kind: context.sheet.kind,
      slug: context.sheet.slug,
      sheet: { ...sheetPayloadForPersistence(updated, context.sheet.slug, updatedAt), revision: nextSheetRevision },
    },
    // These computed patches are recreated by `patchesForAcceptedSheetCommand`.
    // Keeping the next state focused on documents prevents client patch shape from
    // becoming the persistence API.
  }
}

const applyModifyCombatStages = (
  command: ModifyCombatStagesLivePlayCommand,
  context: ResolvedLivePlaySheetCommandContext,
  currentRevision: number,
  updatedAt: number,
): ResolvedLivePlaySheetCommandContext | null => {
  const payload = expectModifyCombatStagesPayload(command.payload)
  const original = context.sheet.sheet as unknown as AnyLiveSheet
  const previous = combatStagesSnapshotForSheet(context.placement.sheetKind, original)
  const updated = applyCombatStagesToSheet(context.placement.sheetKind, original, payload.stages)
  const current = combatStagesSnapshotForSheet(context.placement.sheetKind, updated)
  if (sameJsonValue(previous, current)) return null

  const nextSheetRevision = nextRevision(context.sheet.revision)
  const revision = nextRevision(currentRevision)
  return {
    ...context,
    map: { ...context.map, revision, updatedAt },
    nextSheet: sheetPayloadForPersistence(updated, context.sheet.slug, updatedAt),
    sheetUpdate: {
      kind: context.sheet.kind,
      slug: context.sheet.slug,
      sheet: { ...sheetPayloadForPersistence(updated, context.sheet.slug, updatedAt), revision: nextSheetRevision },
    },
  }
}

const applyModifyConditions = (
  command: ModifyConditionsLivePlayCommand,
  context: ResolvedLivePlaySheetCommandContext,
  currentRevision: number,
  updatedAt: number,
): ResolvedLivePlaySheetCommandContext | null => {
  const payload = expectModifyConditionsPayload(command.payload)
  const original = context.sheet.sheet as unknown as AnyLiveSheet
  const previous = conditionsSnapshotForSheet(context.placement.sheetKind, original)
  const nextConditions = conditionsAfterAction(previous, payload)
  const updated = applyConditionsToSheet(context.placement.sheetKind, original, nextConditions)
  const current = conditionsSnapshotForSheet(context.placement.sheetKind, updated)
  if (sameStringArray(previous, current)) return null

  const nextSheetRevision = nextRevision(context.sheet.revision)
  const revision = nextRevision(currentRevision)
  return {
    ...context,
    map: { ...context.map, revision, updatedAt },
    nextSheet: sheetPayloadForPersistence(updated, context.sheet.slug, updatedAt),
    sheetUpdate: {
      kind: context.sheet.kind,
      slug: context.sheet.slug,
      sheet: { ...sheetPayloadForPersistence(updated, context.sheet.slug, updatedAt), revision: nextSheetRevision },
    },
  }
}

const valuePatchPayload = (
  command: LivePlaySheetCommand,
  before: AnyLiveSheet,
  after: AnyLiveSheet,
  placement: SheetPlacement,
  sheetRevision: number,
): Record<string, unknown> => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP) {
    return {
      previous: hpSnapshotForSheet(placement.sheetKind, before),
      current: hpSnapshotForSheet(placement.sheetKind, after),
      sheetRevision,
    }
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES) {
    return {
      previous: combatStagesSnapshotForSheet(placement.sheetKind, before),
      current: combatStagesSnapshotForSheet(placement.sheetKind, after),
      sheetRevision,
    }
  }
  return {
    previous: conditionsSnapshotForSheet(placement.sheetKind, before),
    current: conditionsSnapshotForSheet(placement.sheetKind, after),
    sheetRevision,
  }
}

const patchesForAcceptedSheetCommand = (
  command: LivePlaySheetCommand,
  revision: number,
  previousContext: ResolvedLivePlaySheetCommandContext,
  nextContext: ResolvedLivePlaySheetCommandContext,
): LivePlayPatch[] => {
  if (!nextContext.nextSheet) return []
  const before = previousContext.sheet.sheet as unknown as AnyLiveSheet
  const after = nextContext.nextSheet as unknown as AnyLiveSheet
  const sheetRevision = nextRevision(previousContext.sheet.revision)
  const payload = valuePatchPayload(command, before, after, previousContext.placement, sheetRevision)
  return [
    tokenPatch(command, revision, previousContext.placement, payload),
    sheetFieldPatch(command, revision, previousContext.placement, payload),
  ]
}

const applySheetCommand = (
  command: LivePlaySheetCommand,
  context: ResolvedLivePlaySheetCommandContext,
  currentRevision: number,
  dependencies: LivePlaySheetCommandDependencySet,
): ResolvedLivePlaySheetCommandContext | null => {
  const updatedAt = dependencies.now()
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP) {
    return applyModifyHp(command, context, currentRevision, updatedAt)
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES) {
    return applyModifyCombatStages(command, context, currentRevision, updatedAt)
  }
  return applyModifyConditions(command, context, currentRevision, updatedAt)
}

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const placementIdFromAcceptedResult = (result: LivePlayCommandAccepted): string | null => (
  result.patches[0]?.scopes.find((scope): scope is LivePlayTokenScope => scope.kind === 'token')?.placementId ?? null
)

const responseFromContext = (
  result: LivePlayCommandResult,
  context: ResolvedLivePlaySheetCommandContext | null,
): LivePlaySheetCommandResponse => ({
  result,
  ...(context ? {
    path: context.relativePath,
    map: context.map,
    placement: context.placement,
    sheetUpdates: context.sheetUpdate ? [context.sheetUpdate] : [sheetUpdateFromPersisted(context.sheet)],
  } : {}),
})

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  role: AuthRole,
  playerProfile: PlayerProfile | null | undefined,
  dependencies: LivePlaySheetCommandDependencySet,
): Promise<ResolvedLivePlaySheetCommandContext | null> => {
  const placementId = placementIdFromAcceptedResult(result)
  if (!placementId) return null

  try {
    const command = {
      schemaVersion: 1,
      opId: result.opId,
      mapSlug: result.mapSlug,
      baseRevision: result.revision,
      type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      scopes: [{ kind: 'token', placementId, field: 'hp' }],
      payload: { placementId, currentHp: 0 },
    } as const satisfies ModifyHpLivePlayCommand
    return await resolveContext(command, { role, playerProfile }, dependencies)
  } catch {
    return null
  }
}

export const executeLivePlaySheetCommandUseCase = async (
  input: ExecuteLivePlaySheetCommandInput,
  dependencies: LivePlaySheetCommandDependencies = {},
): Promise<LivePlaySheetCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedLivePlaySheetCommandContext | null = null

  const result = await deps.commandExecutor.execute<LivePlaySheetCommand, ResolvedLivePlaySheetCommandContext, LivePlaySheetCommandActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
      playerProfile: input.playerProfile,
    },
    readMap: ({ command, actor }) => resolveContext(command, actor, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    authorize: ({ command, actor, map }) => {
      assertSheetCommandType(command, input.expectedType)
      validateCommandPayloadAndScopes(command, map.placement)
      if (!actorCanControlMapPlacement({
        role: actor.role,
        profile: actor.playerProfile,
        placement: map.placement,
      })) {
        throw new LivePlaySheetCommandUseCaseError(403, controlDeniedMessage(actor.role, actor.playerProfile))
      }
    },
    apply: ({ command, map, currentRevision }) => {
      const nextContext = applySheetCommand(command, map, currentRevision, deps)
      if (!nextContext?.nextSheet) {
        return {
          status: 'rejected',
          reason: 'no-op',
          message: `${command.type} did not change token ${map.placement.id}`,
          currentRevision,
          currentState: map.placement,
        }
      }

      const revision = nextRevision(currentRevision)
      return {
        status: 'accepted',
        nextMap: nextContext,
        previousRevision: currentRevision,
        revision,
        patches: patchesForAcceptedSheetCommand(command, revision, map, nextContext),
      }
    },
    persist: async () => {
      throw new Error('live-play sheet commands must persist through the accepted-result commit hook')
    },
    commit: async ({ currentRevision, nextMap, result, saveOpResult }) => {
      const nextSheet = nextMap.nextSheet
      if (!nextSheet) throw new Error('next sheet missing for live-play sheet command')
      await deps.database.withAsyncTransaction(async () => {
        const persisted = toPersistedMap(
          nextMap.map,
          nextMap.mapPath,
          nextMap.map.updatedAt ?? deps.now(),
          { revision: result.revision },
        )
        const mapResult = await deps.mapRepository.applyLivePlayUpdate({
          slug: result.mapSlug,
          expectedRevision: currentRevision,
          nextMap: persisted,
        })
        if (mapResult === 'stale') {
          throw new LivePlaySheetCommandUseCaseError(409, `Map ${result.mapSlug} changed before the live-play command could be persisted`)
        }

        const sheetResult = await deps.sheetRepository.applyLivePlayUpdate({
          kind: nextMap.sheet.kind,
          slug: nextMap.sheet.slug,
          expectedRevision: nextMap.sheet.revision,
          nextSheet,
        })
        if (sheetResult === 'stale') {
          throw new LivePlaySheetCommandUseCaseError(409, `Sheet ${nextMap.sheet.kind}/${nextMap.sheet.slug} changed before the live-play command could be persisted`)
        }

        saveOpResult()

        const authoritativeMap = await deps.mapRepository.getBySlug(result.mapSlug)
        if (!authoritativeMap) throw new LivePlaySheetCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after live-play command`)
        const authoritativePlacement = authoritativeMap.placements.find((candidate) => candidate.id === nextMap.placement.id)
        if (!authoritativePlacement) throw new LivePlaySheetCommandUseCaseError(404, `Placement ${nextMap.placement.id} not found after live-play command`)
        const authoritativeSheet = await deps.sheetRepository.getByRef(nextMap.sheet.kind, nextMap.sheet.slug)
        if (!authoritativeSheet) {
          throw new LivePlaySheetCommandUseCaseError(404, `Sheet ${nextMap.sheet.kind}/${nextMap.sheet.slug} not found after live-play command`)
        }
        persistedContext = {
          ...nextMap,
          map: authoritativeMap,
          placement: authoritativePlacement,
          sheet: authoritativeSheet,
          sheetUpdate: sheetUpdateFromPersisted(authoritativeSheet),
        }
      })
    },
    publish: ({ actor, result }) => {
      if (!persistedContext) return
      for (const event of mapEvents(persistedContext.map, actor.clientId)) {
        deps.publishRealtimeEvent(event)
      }
      for (const event of sheetRealtimeEvents(persistedContext.sheetUpdate ? [persistedContext.sheetUpdate] : [], actor.clientId)) {
        deps.publishRealtimeEvent(event)
      }
      deps.publishRealtimeEvent(livePlayCommandAcceptedRealtimeEvent(result, actor.clientId))
    },
  })

  const responseContext = persistedContext
    ?? (isAcceptedResult(result)
      ? await currentContextForAcceptedResult(result, input.role, input.playerProfile, deps)
      : null)
  return responseFromContext(result, responseContext)
}
