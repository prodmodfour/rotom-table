import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayMapScope,
  type LivePlayPatch,
  type LivePlayScope,
  type LivePlaySheetScope,
  type LivePlayTokenScope,
  type ThrowPokeballLivePlayCommand,
  type ThrowPokeballPayload,
} from '#shared/livePlayCommands'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { normalizeRevision, nextRevision } from '#shared/sessionRevisions'
import { sheetChannel, sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  appendPokeballCaptureLogEntry,
  applyPokeballCaptureOutcomeToPokemonSheet,
  applyPokeballCaptureOutcomeToTrainerSheet,
  buildTrainerPokeballOptions,
  linkedPokemonSlugSet,
  resolvePokeballCaptureAttempt,
  trainerThrowingRangeMeters,
  unlinkedPokemonTargetsInPokeballRange,
  type PokeballCaptureOutcomeApplyResult,
  type PokeballCaptureOutcomeEvent,
  type PokeballCaptureLogEntry,
} from '~/utils/pokeballCapture'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { deepCloneJson } from '~/utils/serialization'
import { toPersistableSheetPayload } from '~/utils/sheetMutations'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControlAsync,
  type ServerTokenControlLinkedTrainerSheet,
} from '../policies/playerProfileTokenControlPolicy'
import { canAccessMapForRole } from '../policies/mapPolicy'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createAuthoritativeLivePlayCommandExecutor } from '../livePlay/commandExecutor'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteLivePlayOpRepository } from '../storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '../storage/mapInteractionModeRepository'
import {
  createSqliteMapRepository,
  type MapRepository,
} from '../storage/mapRepository'
import {
  createSqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
  type StoredSheetDocument,
} from '../storage/sheetRepository'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { livePlayCommandAcceptedRealtimeEvent } from '../utils/mapRealtimeEvents'
import { publishRealtime } from '../utils/realtime'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'

export class ThrowPokeballCommandUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface ThrowPokeballCommandActor {
  readonly role: AuthRole
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
}

export interface ExecuteThrowPokeballCommandInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
  readonly expectedType?: typeof LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL
}

export interface LivePlayPokeballCommandSheetUpdate {
  readonly kind: SheetKind
  readonly slug: string
  readonly path?: string
  readonly sheet: Record<string, unknown>
}

export interface LivePlayPokeballCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly sheetUpdates?: LivePlayPokeballCommandSheetUpdate[]
  readonly capture?: PokeballCaptureOutcomeEvent
}

export interface ThrowPokeballCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list' | 'applyLivePlayUpdate'>
  readonly database?: Pick<RotomDatabase, 'withTransaction'> & Partial<RotomDatabase>
  readonly publishRealtimeEvent?: (event: Omit<RealtimeEvent, 'timestamp'>) => void
  readonly random?: () => number
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
  readonly maxLogEntries?: number
}

interface ResolvedThrowPokeballCommandContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
  readonly trainerPlacement: SheetPlacement
  readonly targetPlacement: SheetPlacement
  readonly trainerSheet: PersistedSheet
  readonly targetSheet: PersistedSheet
  readonly allTrainerSheets: readonly TrainerSheet[]
  readonly pokemonBySlug: ReadonlyMap<string, CharacterSheet>
  readonly sheetLookup: SheetLookup
  readonly linkedTrainerSheets: readonly ServerTokenControlLinkedTrainerSheet[]
  readonly userToken: SpawnedPokemon
  readonly targetToken: SpawnedPokemon
  readonly nextMap?: TabletopMap
  readonly nextTrainerSheet?: Record<string, unknown>
  readonly nextTargetSheet?: Record<string, unknown>
  readonly sheetUpdates?: readonly LivePlayPokeballCommandSheetUpdate[]
  readonly capture?: PokeballCaptureOutcomeEvent
  readonly captureLogEntry?: PokeballCaptureLogEntry
}

type DependencySet = ReturnType<typeof actionDependencies>
type UnknownRecord = Record<string, unknown>

const THROW_POKEBALL_MAX_SCOPE_COUNT = 10
const COMMAND_STRING_MAX_LENGTH = 120
const TRAINER_ROSTER_SHEET_FIELD = 'pokemonRoster'
const TRAINER_INVENTORY_SHEET_FIELD = 'inventory'
const TARGET_CAUGHT_BALL_SHEET_FIELD = 'caughtBall'
const CAPTURE_METADATA_PATCH_FIELD = 'captureLog'

const defaultNow = (): number => Date.now()

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const nonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const actionDependencies = (dependencies: ThrowPokeballCommandDependencies) => {
  const database = dependencies.database ?? getRotomDatabase()
  const concreteDatabase = database as RotomDatabase
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(concreteDatabase)
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(concreteDatabase)
  const commandExecutor = dependencies.commandExecutor ?? createAuthoritativeLivePlayCommandExecutor({
    opStore: createSqliteLivePlayOpRepository({ database: concreteDatabase }),
    readMapInteractionMode: (mapSlug) => createSqliteMapInteractionModeRepository(concreteDatabase).get(mapSlug).interactionMode,
  })
  return {
    database,
    mapRepository,
    sheetRepository,
    commandExecutor,
    publishRealtimeEvent: dependencies.publishRealtimeEvent ?? publishRealtime,
    random: dependencies.random,
    now: dependencies.now ?? defaultNow,
    relativePath: dependencies.relativePath ?? ((path: string) => path),
    maxLogEntries: dependencies.maxLogEntries,
  }
}

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => logicalMapResourcePath(map)

const persistedSheetToTrainerSheet = (sheet: PersistedSheet): TrainerSheet => (
  { ...(sheet.sheet as unknown as TrainerSheet), slug: sheet.slug, revision: sheet.revision }
)

const persistedSheetToPokemonSheet = (sheet: PersistedSheet): CharacterSheet => (
  { ...(sheet.sheet as unknown as CharacterSheet), slug: sheet.slug, revision: sheet.revision }
)

const storedSheetToRecord = (stored: StoredSheetDocument<Record<string, unknown>>): Record<string, unknown> => {
  if (!stored.document || typeof stored.document !== 'object' || Array.isArray(stored.document)) {
    throw new ThrowPokeballCommandUseCaseError(409, `${stored.kind} sheet ${stored.slug} is not an object`)
  }
  return { ...stored.document, slug: stored.slug, revision: stored.revision, updatedAt: stored.updatedAt }
}

const storedTrainerSheets = (
  stored: readonly StoredSheetDocument<Record<string, unknown>>[],
): TrainerSheet[] => stored.map((sheet) => storedSheetToRecord(sheet) as unknown as TrainerSheet)

const storedPokemonSheetMap = (
  stored: readonly StoredSheetDocument<Record<string, unknown>>[],
): Map<string, CharacterSheet> => new Map(stored.map((sheet) => [
  sheet.slug,
  storedSheetToRecord(sheet) as unknown as CharacterSheet,
]))

const storedTrainerSheetMap = (
  stored: readonly StoredSheetDocument<Record<string, unknown>>[],
): Map<string, TrainerSheet> => new Map(stored.map((sheet) => [
  sheet.slug,
  storedSheetToRecord(sheet) as unknown as TrainerSheet,
]))

const tokenControlTrainerSheet = (sheet: PersistedSheet): ServerTokenControlLinkedTrainerSheet => ({
  slug: sheet.slug,
  ...(Array.isArray(sheet.sheet.currentTeam) ? { currentTeam: sheet.sheet.currentTeam } : {}),
  ...(Array.isArray(sheet.sheet.boxedPokemon) ? { boxedPokemon: sheet.sheet.boxedPokemon } : {}),
})

const linkedTrainerSheetsForActor = async (
  actor: ThrowPokeballCommandActor,
  dependencies: DependencySet,
): Promise<readonly ServerTokenControlLinkedTrainerSheet[]> => playerProfileLinkedTrainerSheetsForTokenControlAsync(
  actor.playerProfile,
  async (slug) => {
    const sheet = await dependencies.sheetRepository.getByRef('trainer', slug)
    return sheet ? tokenControlTrainerSheet(sheet) : null
  },
)

const expectBoundedString = (value: unknown, label: string): string => {
  if (!nonEmptyString(value)) rejectLivePlayCommand('invalid', `${label} is required`)
  const trimmed = (value as string).trim()
  if (trimmed.length > COMMAND_STRING_MAX_LENGTH) {
    rejectLivePlayCommand('invalid', `${label} must be at most ${COMMAND_STRING_MAX_LENGTH} characters`)
  }
  return trimmed
}

const expectThrowPokeballPayload = (payload: unknown): ThrowPokeballPayload => {
  if (!isRecord(payload)) rejectLivePlayCommand('invalid', 'throwPokeball payload must be an object')
  const record = payload as UnknownRecord
  const trainerPlacementId = expectBoundedString(record.trainerPlacementId, 'throwPokeball payload.trainerPlacementId')
  const targetPlacementId = expectBoundedString(record.targetPlacementId, 'throwPokeball payload.targetPlacementId')
  const pokeballName = expectBoundedString(record.pokeballName, 'throwPokeball payload.pokeballName')
  if (trainerPlacementId === targetPlacementId) {
    rejectLivePlayCommand('invalid', 'throwPokeball trainerPlacementId and targetPlacementId must be different')
  }
  return { trainerPlacementId, targetPlacementId, pokeballName }
}

const commandPayload = (command: ThrowPokeballLivePlayCommand): ThrowPokeballPayload => (
  expectThrowPokeballPayload(command.payload)
)

const tokenScopeMatches = (
  scopes: readonly LivePlayScope[],
  placementId: string,
  field: LivePlayTokenScope['field'],
): boolean => scopes.some((scope) => (
  scope.kind === 'token' && scope.placementId === placementId && scope.field === field
))

const mapScopeMatches = (
  scopes: readonly LivePlayScope[],
  lane: LivePlayMapScope['lane'],
): boolean => scopes.some((scope) => scope.kind === 'map' && scope.lane === lane)

const sheetScopeMatches = (
  scopes: readonly LivePlayScope[],
  sheetKind: SheetKind,
  sheetSlug: string,
  field: string,
): boolean => scopes.some((scope) => (
  scope.kind === 'sheet'
  && scope.sheetKind === sheetKind
  && scope.sheetSlug === sheetSlug
  && scope.field === field
))

const assertThrowPokeballScopesMatchContext = (
  command: ThrowPokeballLivePlayCommand,
  context: ResolvedThrowPokeballCommandContext,
): void => {
  const scopes = command.scopes
  if (scopes.length > THROW_POKEBALL_MAX_SCOPE_COUNT) {
    rejectLivePlayCommand('invalid', `throwPokeball scopes must contain at most ${THROW_POKEBALL_MAX_SCOPE_COUNT} entries`)
  }

  for (const scope of scopes) {
    if (scope.kind === 'token') {
      if (scope.placementId === context.trainerPlacement.id && scope.field === 'action') continue
      if (scope.placementId === context.targetPlacement.id && scope.field === 'action') continue
      rejectLivePlayCommand('invalid', 'throwPokeball token scopes must be action scopes for the authoritative trainer and target placements')
    }

    if (scope.kind === 'map') {
      if (scope.lane === 'metadata' || scope.lane === 'placements') continue
      rejectLivePlayCommand('invalid', 'throwPokeball map scopes must be metadata or placements lanes')
    }

    if (scope.kind === 'sheet') {
      const trainerSheetScope = scope.sheetKind === 'trainer'
        && scope.sheetSlug === context.trainerPlacement.sheetSlug
        && (scope.field === TRAINER_INVENTORY_SHEET_FIELD || scope.field === TRAINER_ROSTER_SHEET_FIELD)
      const targetSheetScope = scope.sheetKind === 'pokemon'
        && scope.sheetSlug === context.targetPlacement.sheetSlug
        && scope.field === TARGET_CAUGHT_BALL_SHEET_FIELD
      if (trainerSheetScope || targetSheetScope) continue
      rejectLivePlayCommand('invalid', 'throwPokeball sheet scopes must match the authoritative trainer inventory/roster and target caught-ball sheets')
    }
  }

  if (!tokenScopeMatches(scopes, context.trainerPlacement.id, 'action')) {
    rejectLivePlayCommand('invalid', 'throwPokeball scopes must include the trainer token action scope')
  }
  if (!tokenScopeMatches(scopes, context.targetPlacement.id, 'action')) {
    rejectLivePlayCommand('invalid', 'throwPokeball scopes must include the target token action scope')
  }
  if (!mapScopeMatches(scopes, 'metadata')) {
    rejectLivePlayCommand('invalid', 'throwPokeball scopes must include the map metadata scope')
  }
  if (!mapScopeMatches(scopes, 'placements')) {
    rejectLivePlayCommand('invalid', 'throwPokeball scopes must include the map placements scope')
  }
  if (!sheetScopeMatches(scopes, 'trainer', context.trainerPlacement.sheetSlug, TRAINER_INVENTORY_SHEET_FIELD)) {
    rejectLivePlayCommand('invalid', 'throwPokeball scopes must include the trainer sheet inventory scope')
  }
  if (!sheetScopeMatches(scopes, 'trainer', context.trainerPlacement.sheetSlug, TRAINER_ROSTER_SHEET_FIELD)) {
    rejectLivePlayCommand('invalid', 'throwPokeball scopes must include the trainer sheet roster scope')
  }
  if (!sheetScopeMatches(scopes, 'pokemon', context.targetPlacement.sheetSlug, TARGET_CAUGHT_BALL_SHEET_FIELD)) {
    rejectLivePlayCommand('invalid', 'throwPokeball scopes must include the target Pokémon sheet caughtBall scope')
  }
}

const resolveContext = async (
  command: ThrowPokeballLivePlayCommand,
  actor: ThrowPokeballCommandActor,
  dependencies: DependencySet,
): Promise<ResolvedThrowPokeballCommandContext> => {
  const payload = commandPayload(command)
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw new ThrowPokeballCommandUseCaseError(404, `Map ${command.mapSlug}.json not found`)

  if (!canAccessMapForRole(actor.role, map)) {
    throw new ThrowPokeballCommandUseCaseError(403, 'Map is not player visible')
  }

  const trainerPlacement = map.placements.find((candidate) => candidate.id === payload.trainerPlacementId)
  if (!trainerPlacement) throw new ThrowPokeballCommandUseCaseError(404, `Trainer token ${payload.trainerPlacementId} not found`)
  if (trainerPlacement.sheetKind !== 'trainer') rejectLivePlayCommand('invalid', `Token ${payload.trainerPlacementId} is not a trainer token`)

  const targetPlacement = map.placements.find((candidate) => candidate.id === payload.targetPlacementId)
  if (!targetPlacement) throw new ThrowPokeballCommandUseCaseError(404, `Target token ${payload.targetPlacementId} not found`)
  if (targetPlacement.sheetKind !== 'pokemon') rejectLivePlayCommand('invalid', `Token ${payload.targetPlacementId} is not a Pokémon token`)

  const trainerSheet = await dependencies.sheetRepository.getByRef('trainer', trainerPlacement.sheetSlug)
  if (!trainerSheet) {
    throw new ThrowPokeballCommandUseCaseError(404, `Trainer sheet ${trainerPlacement.sheetSlug} not found`)
  }
  const targetSheet = await dependencies.sheetRepository.getByRef('pokemon', targetPlacement.sheetSlug)
  if (!targetSheet) {
    throw new ThrowPokeballCommandUseCaseError(404, `Target Pokémon sheet ${targetPlacement.sheetSlug} not found`)
  }

  const allTrainerStored = await dependencies.sheetRepository.list('trainer') as readonly StoredSheetDocument<Record<string, unknown>>[]
  const allPokemonStored = await dependencies.sheetRepository.list('pokemon') as readonly StoredSheetDocument<Record<string, unknown>>[]
  const allTrainerSheets = storedTrainerSheets(allTrainerStored)
  const trainerBySlug = storedTrainerSheetMap(allTrainerStored)
  const pokemonBySlug = storedPokemonSheetMap(allPokemonStored)
  trainerBySlug.set(trainerSheet.slug, persistedSheetToTrainerSheet(trainerSheet))
  pokemonBySlug.set(targetSheet.slug, persistedSheetToPokemonSheet(targetSheet))
  const sheetLookup = { trainer: trainerBySlug, pokemon: pokemonBySlug }

  const userToken = placementToSpawned(trainerPlacement, sheetLookup, map)
    ?? rejectLivePlayCommand('conflict', `Trainer ${trainerPlacement.sheetSlug} could not resolve a map footprint`)
  const targetToken = placementToSpawned(targetPlacement, sheetLookup, map)
    ?? rejectLivePlayCommand('conflict', `Target Pokémon ${targetPlacement.sheetSlug} could not resolve a map footprint`)

  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
    trainerPlacement,
    targetPlacement,
    trainerSheet,
    targetSheet,
    allTrainerSheets,
    pokemonBySlug,
    sheetLookup,
    linkedTrainerSheets: await linkedTrainerSheetsForActor(actor, dependencies),
    userToken,
    targetToken,
  }
}

const controlDeniedMessage = (role: AuthRole, profile: PlayerProfile | null | undefined): string => (
  role === 'player' && !profile
    ? 'Select a player profile to control linked map tokens'
    : 'Token is not linked to selected player profile'
)

const optionForPayload = (
  trainerSheet: TrainerSheet,
  payload: ThrowPokeballPayload,
) => {
  const options = buildTrainerPokeballOptions(trainerSheet)
  const option = options.find((candidate) => candidate.name === payload.pokeballName)
  if (!option) {
    rejectLivePlayCommand('conflict', `${payload.pokeballName} is not available in the trainer's Poké Ball inventory`)
    throw new Error('unreachable')
  }
  if (option.quantity <= 0) {
    rejectLivePlayCommand('conflict', `${option.name} quantity must be greater than zero`)
    throw new Error('unreachable')
  }
  return option
}

const validateTargetIsUnlinked = (
  context: ResolvedThrowPokeballCommandContext,
): ReadonlySet<string> => {
  const linkedSlugs = linkedPokemonSlugSet(context.allTrainerSheets)
  if (linkedSlugs.has(context.targetPlacement.sheetSlug)) {
    rejectLivePlayCommand('conflict', `Target Pokémon ${context.targetPlacement.sheetSlug} is already linked to a trainer roster`)
  }
  return linkedSlugs
}

const validateTargetIsInRange = (
  context: ResolvedThrowPokeballCommandContext,
  linkedSlugs: ReadonlySet<string>,
): void => {
  const rangeMeters = trainerThrowingRangeMeters(persistedSheetToTrainerSheet(context.trainerSheet))
  const tokens = context.map.placements
    .map((placement) => placementToSpawned(placement, context.sheetLookup, context.map))
    .filter((token): token is SpawnedPokemon => token !== null)
  const targets = unlinkedPokemonTargetsInPokeballRange({
    user: context.userToken,
    tokens,
    rangeMeters,
    linkedSlugs,
  })
  if (!targets.some((target) => target.id === context.targetToken.id)) {
    rejectLivePlayCommand('conflict', `Target Pokémon ${context.targetPlacement.id} is outside ${rangeMeters}m Poké Ball throwing range`)
  }
}

const latestCaptureLogEntry = (metadata: Record<string, unknown> | undefined): PokeballCaptureLogEntry | undefined => {
  const entries = metadata?.captureLog
  const entry = Array.isArray(entries) ? entries.at(-1) : undefined
  return isRecord(entry) ? entry as unknown as PokeballCaptureLogEntry : undefined
}

const sheetPayloadForPersistence = (
  sheet: Record<string, unknown>,
  slug: string,
  updatedAt: number,
): Record<string, unknown> => ({
  ...toPersistableSheetPayload(sheet),
  slug,
  updatedAt,
})

const trainerPatchState = (sheet: TrainerSheet): Record<string, unknown> => ({
  inventory: deepCloneJson(sheet.inventory ?? {}),
  currentTeam: deepCloneJson(sheet.currentTeam ?? []),
  boxedPokemon: deepCloneJson(sheet.boxedPokemon ?? []),
})

const pokemonCaughtBallState = (sheet: CharacterSheet): Record<string, unknown> => ({
  caughtBall: sheet.caughtBall ?? null,
})

const mapMetadataScope = (command: ThrowPokeballLivePlayCommand): LivePlayMapScope[] => {
  const scopes = command.scopes.filter((scope): scope is LivePlayMapScope => scope.kind === 'map' && scope.lane === 'metadata')
  return scopes.length ? scopes : [{ kind: 'map', lane: 'metadata' }]
}

const mapPlacementScope = (command: ThrowPokeballLivePlayCommand): LivePlayScope[] => {
  const scopes = command.scopes.filter((scope) => (
    (scope.kind === 'map' && scope.lane === 'placements')
    || (scope.kind === 'token' && scope.placementId === command.payload.targetPlacementId)
  ))
  return scopes.length ? scopes : [{ kind: 'map', lane: 'placements' }]
}

const trainerSheetScopes = (
  command: ThrowPokeballLivePlayCommand,
  context: ResolvedThrowPokeballCommandContext,
): LivePlaySheetScope[] => {
  const scopes = command.scopes.filter((scope): scope is LivePlaySheetScope => (
    scope.kind === 'sheet'
    && scope.sheetKind === 'trainer'
    && scope.sheetSlug === context.trainerPlacement.sheetSlug
  ))
  return scopes.length
    ? scopes
    : [
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: context.trainerPlacement.sheetSlug, field: TRAINER_INVENTORY_SHEET_FIELD },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: context.trainerPlacement.sheetSlug, field: TRAINER_ROSTER_SHEET_FIELD },
      ]
}

const targetSheetScopes = (
  command: ThrowPokeballLivePlayCommand,
  context: ResolvedThrowPokeballCommandContext,
): LivePlaySheetScope[] => {
  const scopes = command.scopes.filter((scope): scope is LivePlaySheetScope => (
    scope.kind === 'sheet'
    && scope.sheetKind === 'pokemon'
    && scope.sheetSlug === context.targetPlacement.sheetSlug
    && scope.field === TARGET_CAUGHT_BALL_SHEET_FIELD
  ))
  return scopes.length ? scopes : [{ kind: 'sheet', sheetKind: 'pokemon', sheetSlug: context.targetPlacement.sheetSlug, field: TARGET_CAUGHT_BALL_SHEET_FIELD }]
}

const metadataPatch = (
  command: ThrowPokeballLivePlayCommand,
  revision: number,
  previous: Record<string, unknown> | undefined,
  current: Record<string, unknown> | undefined,
  capture: PokeballCaptureOutcomeEvent,
  captureLogEntry: PokeballCaptureLogEntry | undefined,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_METADATA> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
  mapSlug: command.mapSlug,
  revision,
  scopes: mapMetadataScope(command),
  payload: {
    command: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
    previous: deepCloneJson(previous ?? {}),
    current: deepCloneJson(current ?? {}),
    capture,
    ...(captureLogEntry === undefined ? {} : { captureLogEntry }),
  },
})

const trainerSheetPatch = (
  command: ThrowPokeballLivePlayCommand,
  revision: number,
  context: ResolvedThrowPokeballCommandContext,
  before: TrainerSheet,
  after: TrainerSheet,
  applyResult: PokeballCaptureOutcomeApplyResult,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.SHEET_FIELD, Record<string, unknown>, LivePlaySheetScope> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.SHEET_FIELD,
  mapSlug: command.mapSlug,
  revision,
  scopes: trainerSheetScopes(command, context),
  payload: {
    command: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
    placementId: context.trainerPlacement.id,
    sheetKind: 'trainer',
    sheetSlug: context.trainerPlacement.sheetSlug,
    field: 'inventoryRoster',
    previous: trainerPatchState(before),
    current: trainerPatchState(after),
    consumed: applyResult.consumed,
    roster: applyResult.roster,
    sheetRevision: nextRevision(context.trainerSheet.revision),
  },
})

const targetSheetPatch = (
  command: ThrowPokeballLivePlayCommand,
  revision: number,
  context: ResolvedThrowPokeballCommandContext,
  before: CharacterSheet,
  after: CharacterSheet,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.SHEET_FIELD, Record<string, unknown>, LivePlaySheetScope> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.SHEET_FIELD,
  mapSlug: command.mapSlug,
  revision,
  scopes: targetSheetScopes(command, context),
  payload: {
    command: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
    placementId: context.targetPlacement.id,
    sheetKind: 'pokemon',
    sheetSlug: context.targetPlacement.sheetSlug,
    field: TARGET_CAUGHT_BALL_SHEET_FIELD,
    previous: pokemonCaughtBallState(before),
    current: pokemonCaughtBallState(after),
    sheetRevision: nextRevision(context.targetSheet.revision),
  },
})

const placementDeletedPatch = (
  command: ThrowPokeballLivePlayCommand,
  revision: number,
  context: ResolvedThrowPokeballCommandContext,
  capture: PokeballCaptureOutcomeEvent,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS,
  mapSlug: command.mapSlug,
  revision,
  scopes: mapPlacementScope(command),
  payload: {
    command: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
    placementId: context.targetPlacement.id,
    previous: context.targetPlacement,
    current: null,
    capture,
  },
})

const patchesForAcceptedThrow = (
  command: ThrowPokeballLivePlayCommand,
  revision: number,
  previousContext: ResolvedThrowPokeballCommandContext,
  nextContext: ResolvedThrowPokeballCommandContext,
  beforeTrainerSheet: TrainerSheet,
  afterTrainerSheet: TrainerSheet,
  trainerApplyResult: PokeballCaptureOutcomeApplyResult,
  beforeTargetSheet: CharacterSheet,
  afterTargetSheet: CharacterSheet | null,
): LivePlayPatch[] => {
  const capture = nextContext.capture
  if (!capture) return []
  return [
    metadataPatch(
      command,
      revision,
      previousContext.map.metadata,
      nextContext.map.metadata,
      capture,
      nextContext.captureLogEntry,
    ),
    trainerSheetPatch(command, revision, previousContext, beforeTrainerSheet, afterTrainerSheet, trainerApplyResult),
    ...(afterTargetSheet ? [targetSheetPatch(command, revision, previousContext, beforeTargetSheet, afterTargetSheet)] : []),
    ...(capture.result.success ? [placementDeletedPatch(command, revision, previousContext, capture)] : []),
  ]
}

const sheetUpdateFromPersisted = (sheet: PersistedSheet): LivePlayPokeballCommandSheetUpdate => ({
  kind: sheet.kind,
  slug: sheet.slug,
  sheet: sheet.sheet,
})

const sheetRealtimeEvents = (
  updates: readonly LivePlayPokeballCommandSheetUpdate[],
  clientId: string | undefined,
): Array<Omit<RealtimeEvent, 'timestamp'>> => updates.flatMap((update) => {
  const data = { kind: update.kind, slug: update.slug, sheet: update.sheet }
  return [
    { channel: sheetChannel(update.kind, update.slug), type: 'updated' as const, clientId, data },
    { channel: sheetsChannel, type: 'updated' as const, clientId, data },
  ]
})

const applyThrowPokeballCommand = (
  command: ThrowPokeballLivePlayCommand,
  context: ResolvedThrowPokeballCommandContext,
  currentRevision: number,
  dependencies: DependencySet,
): {
  readonly context: ResolvedThrowPokeballCommandContext
  readonly patches: readonly LivePlayPatch[]
} => {
  const payload = commandPayload(command)
  const trainerSheet = persistedSheetToTrainerSheet(context.trainerSheet)
  const targetSheet = persistedSheetToPokemonSheet(context.targetSheet)
  const pokeball = optionForPayload(trainerSheet, payload)
  const linkedSlugs = validateTargetIsUnlinked(context)
  validateTargetIsInRange(context, linkedSlugs)

  const capture = resolvePokeballCaptureAttempt({
    trainer: trainerSheet,
    user: context.userToken,
    target: context.targetToken,
    targetSheet,
    pokeball,
    pokemonBySlug: context.pokemonBySlug,
    currentRound: context.map.initiative?.round ?? null,
    random: dependencies.random,
    now: dependencies.now,
  })
  const event: PokeballCaptureOutcomeEvent = {
    trainerId: context.trainerPlacement.id,
    targetId: context.targetPlacement.id,
    targetSlug: context.targetPlacement.sheetSlug,
    pokeballName: pokeball.name,
    result: capture,
  }

  const nextTrainer = deepCloneJson(trainerSheet) as TrainerSheet
  const trainerApplyResult = applyPokeballCaptureOutcomeToTrainerSheet(nextTrainer, event)
  if (!trainerApplyResult.consumed) {
    rejectLivePlayCommand('conflict', `Could not consume ${pokeball.name} from the authoritative trainer sheet`)
  }

  const beforeTarget = deepCloneJson(targetSheet) as CharacterSheet
  const nextTarget = event.result.success ? deepCloneJson(targetSheet) as CharacterSheet : null
  if (nextTarget) applyPokeballCaptureOutcomeToPokemonSheet(nextTarget, event)

  const timestamp = dependencies.now()
  const nextMetadata = appendPokeballCaptureLogEntry(context.map.metadata, event, {
    now: () => timestamp,
    maxLogEntries: dependencies.maxLogEntries,
  })
  const nextInitiative = event.result.success && context.map.initiative?.activeId === context.targetPlacement.id
    ? { ...context.map.initiative, activeId: null }
    : context.map.initiative
  const revision = nextRevision(currentRevision)
  const nextMap: TabletopMap = {
    ...context.map,
    revision,
    updatedAt: timestamp,
    metadata: nextMetadata,
    placements: event.result.success
      ? context.map.placements.filter((placement) => placement.id !== context.targetPlacement.id)
      : context.map.placements,
    ...(nextInitiative === undefined ? {} : { initiative: nextInitiative }),
  }
  const nextContext: ResolvedThrowPokeballCommandContext = {
    ...context,
    map: nextMap,
    nextMap,
    nextTrainerSheet: sheetPayloadForPersistence(nextTrainer as unknown as Record<string, unknown>, context.trainerSheet.slug, timestamp),
    ...(nextTarget ? {
      nextTargetSheet: sheetPayloadForPersistence(nextTarget as unknown as Record<string, unknown>, context.targetSheet.slug, timestamp),
    } : {}),
    capture: event,
    captureLogEntry: latestCaptureLogEntry(nextMetadata),
  }

  return {
    context: nextContext,
    patches: patchesForAcceptedThrow(
      command,
      revision,
      context,
      nextContext,
      trainerSheet,
      nextTrainer,
      trainerApplyResult,
      beforeTarget,
      nextTarget,
    ),
  }
}

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const captureFromAcceptedResult = (result: LivePlayCommandAccepted): PokeballCaptureOutcomeEvent | undefined => {
  for (const patch of result.patches) {
    if (patch.type !== LIVE_PLAY_PATCH_TYPES.MAP_METADATA || !isRecord(patch.payload)) continue
    const capture = patch.payload.capture
    if (isRecord(capture) && isRecord(capture.result)) return capture as unknown as PokeballCaptureOutcomeEvent
  }
  return undefined
}

const responseFromContext = (
  result: LivePlayCommandResult,
  context: ResolvedThrowPokeballCommandContext | null,
  capture: PokeballCaptureOutcomeEvent | undefined = context?.capture,
): LivePlayPokeballCommandResponse => ({
  result,
  ...(context ? {
    path: context.relativePath,
    map: context.map,
    ...(context.sheetUpdates?.length ? { sheetUpdates: [...context.sheetUpdates] } : {}),
  } : {}),
  ...(capture === undefined ? {} : { capture }),
})

const sheetSlugFromAcceptedScopes = (
  result: LivePlayCommandAccepted,
  kind: SheetKind,
  field: string,
): string | null => {
  for (const patch of result.patches) {
    for (const scope of patch.scopes) {
      if (scope.kind === 'sheet' && scope.sheetKind === kind && scope.field === field) return scope.sheetSlug
    }
  }
  return null
}

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  role: AuthRole,
  dependencies: DependencySet,
): Promise<ResolvedThrowPokeballCommandContext | null> => {
  const capture = captureFromAcceptedResult(result)
  const trainerSlug = sheetSlugFromAcceptedScopes(result, 'trainer', TRAINER_INVENTORY_SHEET_FIELD)
    ?? sheetSlugFromAcceptedScopes(result, 'trainer', TRAINER_ROSTER_SHEET_FIELD)
  const targetSlug = capture?.targetSlug ?? sheetSlugFromAcceptedScopes(result, 'pokemon', TARGET_CAUGHT_BALL_SHEET_FIELD)

  try {
    const map = await dependencies.mapRepository.getBySlug(result.mapSlug)
    if (!map || !canAccessMapForRole(role, map)) return null
    const mapPath = mapPathForDocument(map)
    const sheetUpdates: LivePlayPokeballCommandSheetUpdate[] = []
    const trainerSheet = trainerSlug ? await dependencies.sheetRepository.getByRef('trainer', trainerSlug) : null
    if (trainerSheet) sheetUpdates.push(sheetUpdateFromPersisted(trainerSheet))
    const shouldIncludeTarget = capture?.result.success === true
    const targetSheet = shouldIncludeTarget && targetSlug
      ? await dependencies.sheetRepository.getByRef('pokemon', targetSlug)
      : null
    if (targetSheet) sheetUpdates.push(sheetUpdateFromPersisted(targetSheet))

    return {
      mapPath,
      relativePath: dependencies.relativePath(mapPath),
      map,
      trainerPlacement: map.placements.find((placement) => placement.id === capture?.trainerId) ?? {
        id: capture?.trainerId ?? 'unknown-trainer',
        sheetKind: 'trainer',
        sheetSlug: trainerSlug ?? 'unknown-trainer',
        position: { x: 0, y: 0, z: 0 },
      },
      targetPlacement: map.placements.find((placement) => placement.id === capture?.targetId) ?? {
        id: capture?.targetId ?? 'unknown-target',
        sheetKind: 'pokemon',
        sheetSlug: targetSlug ?? 'unknown-target',
        position: { x: 0, y: 0, z: 0 },
      },
      trainerSheet: trainerSheet ?? { kind: 'trainer', slug: trainerSlug ?? 'unknown-trainer', sheet: {}, revision: 0, updatedAt: 0 },
      targetSheet: targetSheet ?? { kind: 'pokemon', slug: targetSlug ?? 'unknown-target', sheet: {}, revision: 0, updatedAt: 0 },
      allTrainerSheets: [],
      pokemonBySlug: new Map(),
      sheetLookup: { pokemon: new Map(), trainer: new Map() },
      linkedTrainerSheets: [],
      userToken: {} as SpawnedPokemon,
      targetToken: {} as SpawnedPokemon,
      sheetUpdates,
      ...(capture === undefined ? {} : { capture }),
    }
  } catch {
    return null
  }
}

export const executeThrowPokeballCommandUseCase = async (
  input: ExecuteThrowPokeballCommandInput,
  dependencies: ThrowPokeballCommandDependencies = {},
): Promise<LivePlayPokeballCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedThrowPokeballCommandContext | null = null

  const result = await deps.commandExecutor.execute<ThrowPokeballLivePlayCommand, ResolvedThrowPokeballCommandContext, ThrowPokeballCommandActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
      playerProfile: input.playerProfile,
    },
    readMap: ({ command, actor }) => resolveContext(command, actor, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    authorize: ({ command, actor, map }) => {
      if (input.expectedType && command.type !== input.expectedType) {
        rejectLivePlayCommand('invalid', `This route only accepts ${input.expectedType} commands`)
      }
      if (command.type !== LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL) {
        rejectLivePlayCommand('invalid', 'This route only accepts throwPokeball commands')
      }
      assertThrowPokeballScopesMatchContext(command, map)
      if (!actorCanControlMapPlacement({
        role: actor.role,
        profile: actor.playerProfile,
        placement: map.trainerPlacement,
        linkedTrainerSheets: map.linkedTrainerSheets,
      })) {
        throw new ThrowPokeballCommandUseCaseError(403, controlDeniedMessage(actor.role, actor.playerProfile))
      }
    },
    apply: ({ command, map, currentRevision }) => {
      const application = applyThrowPokeballCommand(command, map, currentRevision, deps)
      const revision = nextRevision(currentRevision)
      return {
        status: 'accepted',
        nextMap: application.context,
        previousRevision: currentRevision,
        revision,
        patches: application.patches,
      }
    },
    persist: () => {
      throw new Error('throwPokeball live-play commands must persist through the accepted-result commit hook')
    },
    commit: ({ currentRevision, nextMap, result, saveOpResult }) => {
      deps.database.withTransaction(() => {
        if (!nextMap.nextMap || !nextMap.nextTrainerSheet) {
          throw new ThrowPokeballCommandUseCaseError(409, 'throwPokeball accepted without a complete map and trainer sheet update')
        }
        const persisted = toPersistedMap(
          nextMap.nextMap,
          nextMap.nextMap.folder ?? '',
          nextMap.nextMap.updatedAt ?? deps.now(),
          { revision: result.revision },
        )
        const mapResult = deps.mapRepository.applyLivePlayUpdate({
          slug: result.mapSlug,
          expectedRevision: currentRevision,
          nextMap: persisted,
        })
        if (mapResult === 'stale') {
          throw new ThrowPokeballCommandUseCaseError(409, `Map ${result.mapSlug} changed before the Poké Ball command could be persisted`)
        }

        const trainerResult = deps.sheetRepository.applyLivePlayUpdate({
          kind: 'trainer',
          slug: nextMap.trainerSheet.slug,
          expectedRevision: nextMap.trainerSheet.revision,
          nextSheet: nextMap.nextTrainerSheet,
        })
        if (trainerResult === 'stale') {
          throw new ThrowPokeballCommandUseCaseError(409, `Trainer sheet ${nextMap.trainerSheet.slug} changed before the Poké Ball command could be persisted`)
        }

        if (nextMap.nextTargetSheet) {
          const targetResult = deps.sheetRepository.applyLivePlayUpdate({
            kind: 'pokemon',
            slug: nextMap.targetSheet.slug,
            expectedRevision: nextMap.targetSheet.revision,
            nextSheet: nextMap.nextTargetSheet,
          })
          if (targetResult === 'stale') {
            throw new ThrowPokeballCommandUseCaseError(409, `Target Pokémon sheet ${nextMap.targetSheet.slug} changed before the Poké Ball command could be persisted`)
          }
        }

        saveOpResult()

        const authoritativeMap = deps.mapRepository.getBySlug(result.mapSlug)
        if (!authoritativeMap) throw new ThrowPokeballCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after Poké Ball command`)
        const authoritativeTrainerSheet = deps.sheetRepository.getByRef('trainer', nextMap.trainerSheet.slug)
        if (!authoritativeTrainerSheet) throw new ThrowPokeballCommandUseCaseError(404, `Trainer sheet ${nextMap.trainerSheet.slug} not found after Poké Ball command`)
        const updates = [sheetUpdateFromPersisted(authoritativeTrainerSheet)]
        if (nextMap.nextTargetSheet) {
          const authoritativeTargetSheet = deps.sheetRepository.getByRef('pokemon', nextMap.targetSheet.slug)
          if (!authoritativeTargetSheet) throw new ThrowPokeballCommandUseCaseError(404, `Target Pokémon sheet ${nextMap.targetSheet.slug} not found after Poké Ball command`)
          updates.push(sheetUpdateFromPersisted(authoritativeTargetSheet))
        }
        persistedContext = {
          ...nextMap,
          map: authoritativeMap,
          sheetUpdates: updates,
        }
      })
    },
    publish: ({ actor, result }) => {
      if (!persistedContext) return
      for (const event of sheetRealtimeEvents(persistedContext.sheetUpdates ?? [], actor.clientId)) {
        deps.publishRealtimeEvent(event)
      }
      deps.publishRealtimeEvent(livePlayCommandAcceptedRealtimeEvent(result, actor.clientId))
    },
  })

  const accepted = isAcceptedResult(result) ? result : null
  const committedContext = persistedContext as ResolvedThrowPokeballCommandContext | null
  const responseContext = committedContext
    ?? (accepted ? await currentContextForAcceptedResult(accepted, input.role, deps) : null)
  const capture = committedContext?.capture ?? (accepted ? captureFromAcceptedResult(accepted) : undefined)
  return responseFromContext(result, responseContext, capture)
}

export const buildThrowPokeballCommandEnvelope = (input: {
  readonly opId: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly trainerPlacement: SheetPlacement
  readonly targetPlacement: SheetPlacement
  readonly pokeballName: string
}): ThrowPokeballLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: input.opId,
  mapSlug: input.mapSlug,
  baseRevision: input.baseRevision,
  type: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
  scopes: [
    { kind: 'token', placementId: input.trainerPlacement.id, field: 'action' },
    { kind: 'token', placementId: input.targetPlacement.id, field: 'action' },
    { kind: 'map', lane: 'metadata' },
    { kind: 'map', lane: 'placements' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: input.trainerPlacement.sheetSlug, field: TRAINER_INVENTORY_SHEET_FIELD },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: input.trainerPlacement.sheetSlug, field: TRAINER_ROSTER_SHEET_FIELD },
    { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: input.targetPlacement.sheetSlug, field: TARGET_CAUGHT_BALL_SHEET_FIELD },
  ],
  payload: {
    trainerPlacementId: input.trainerPlacement.id,
    targetPlacementId: input.targetPlacement.id,
    pokeballName: input.pokeballName,
  },
})
