import { createHash } from 'node:crypto'
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
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  ITEM_INVENTORY_SECTIONS,
  itemInventoryInstanceId,
  type ItemInventorySection,
} from '#shared/itemAutomation/inventory'
import {
  resolveSnagBallForThrow,
  SNAG_BALL_ATTACK_ROLL_PENALTY,
} from '#shared/itemAutomation/snagMachine'
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
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import { livePlaySheetUpdateRealtimeAppendInputs } from '../livePlay/sheetUpdateRealtime'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
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
import { redactSheetUpdatesForPlayer } from '../utils/sheetPrivacy'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'
import { resolveEffectiveCapabilities } from '../domain/capabilityAutomation/effectiveCapabilities'
import { capabilityStandardActionRestriction } from '../domain/capabilityAutomation/actionEligibility'
import { resolveMarsupialRelationship } from '../domain/capabilityAutomation/marsupialRelationship'
import { effectiveRuntimeAbilityIds } from '../domain/abilityAutomation/effectiveRuntimeAbilities'
import {
  clearPhysicalPowerLoadsForPlacements,
  physicalPowerSourceValues,
  projectPhysicalPowerLoadToken,
} from '../domain/capabilityAutomation/physicalPower'

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

export interface CaptureSpeciesAcquisitionSettlementInput {
  readonly database: RotomDatabase
  readonly livePlayOperationId: string
  readonly actorProfileId: string | null
  readonly mapSlug: string
  readonly acceptedMapRevision: number
  readonly trainerSheetBefore: PersistedSheet
  readonly captureTargetSheetSlug: string
  readonly captureSucceeded: boolean
}

export interface ThrowPokeballCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list' | 'applyLivePlayUpdate'>
  readonly database?: Pick<RotomDatabase, 'withTransaction'> & Partial<RotomDatabase>
  readonly settleCaptureSpeciesAcquisitions?: (input: CaptureSpeciesAcquisitionSettlementInput) => PersistedSheet
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
  readonly consultedSheetRevisions: readonly { readonly kind: SheetKind; readonly slug: string; readonly revision: number }[]
  readonly consultedSheetDirectoryKeys: readonly string[]
  readonly linkedTrainerSheets: readonly ServerTokenControlLinkedTrainerSheet[]
  readonly targetOwnerSheets: readonly PersistedSheet[]
  readonly userToken: SpawnedPokemon
  readonly targetToken: SpawnedPokemon
  readonly nextMap?: TabletopMap
  readonly nextTrainerSheet?: Record<string, unknown>
  readonly nextTargetSheet?: Record<string, unknown>
  readonly nextTargetOwnerSheets?: readonly {
    readonly previous: PersistedSheet
    readonly current: Record<string, unknown>
  }[]
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
  const commandExecutor = dependencies.commandExecutor ?? createSqliteAuthoritativeLivePlayCommandExecutor({
    database: concreteDatabase,
  })
  return {
    database,
    mapRepository,
    sheetRepository,
    commandExecutor,
    settleCaptureSpeciesAcquisitions: dependencies.settleCaptureSpeciesAcquisitions,
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

const expectBoundedString = (
  value: unknown,
  label: string,
  maximum = COMMAND_STRING_MAX_LENGTH,
): string => {
  if (!nonEmptyString(value)) rejectLivePlayCommand('invalid', `${label} is required`)
  const trimmed = (value as string).trim()
  if (trimmed.length > maximum) {
    rejectLivePlayCommand('invalid', `${label} must be at most ${maximum} characters`)
  }
  return trimmed
}

const expectThrowPokeballPayload = (payload: unknown): ThrowPokeballPayload => {
  if (!isRecord(payload)) rejectLivePlayCommand('invalid', 'throwPokeball payload must be an object')
  const record = payload as UnknownRecord
  if (Object.keys(record).length !== 4
    || !['trainerPlacementId', 'targetPlacementId', 'sourceInstanceId', 'source']
      .every(field => Object.hasOwn(record, field))) {
    rejectLivePlayCommand('invalid', 'throwPokeball payload must contain only exact source and placement authority')
  }
  const trainerPlacementId = expectBoundedString(record.trainerPlacementId, 'throwPokeball payload.trainerPlacementId')
  const targetPlacementId = expectBoundedString(record.targetPlacementId, 'throwPokeball payload.targetPlacementId')
  const sourceInstanceId = expectBoundedString(record.sourceInstanceId, 'throwPokeball payload.sourceInstanceId', 1_024)
  if (trainerPlacementId === targetPlacementId) {
    rejectLivePlayCommand('invalid', 'throwPokeball trainerPlacementId and targetPlacementId must be different')
  }
  if (!isRecord(record.source)) rejectLivePlayCommand('invalid', 'throwPokeball payload.source must be an object')
  const rawSource = record.source as UnknownRecord
  if (Object.keys(rawSource).length !== 5
    || !['kind', 'slug', 'section', 'rowId', 'expectedRevision'].every(field => Object.hasOwn(rawSource, field))
    || rawSource.kind !== 'trainer'
    || typeof rawSource.section !== 'string'
    || !ITEM_INVENTORY_SECTIONS.includes(rawSource.section as ItemInventorySection)
    || !Number.isSafeInteger(rawSource.expectedRevision)
    || Number(rawSource.expectedRevision) < 0) {
    rejectLivePlayCommand('invalid', 'throwPokeball payload.source is malformed')
  }
  const source = {
    kind: 'trainer' as const,
    slug: expectBoundedString(rawSource.slug, 'throwPokeball payload.source.slug'),
    section: rawSource.section as ItemInventorySection,
    rowId: expectBoundedString(rawSource.rowId, 'throwPokeball payload.source.rowId', 200),
    expectedRevision: Number(rawSource.expectedRevision),
  }
  if (itemInventoryInstanceId({
    containerKind: 'trainer', containerSlug: source.slug, section: source.section, rowId: source.rowId,
  }) !== sourceInstanceId) {
    rejectLivePlayCommand('invalid', 'throwPokeball payload source identity is inconsistent')
  }
  return { trainerPlacementId, targetPlacementId, sourceInstanceId, source }
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
        && ((scope.sheetSlug === context.trainerPlacement.sheetSlug
          && (scope.field === TRAINER_INVENTORY_SHEET_FIELD || scope.field === TRAINER_ROSTER_SHEET_FIELD))
          || (scope.field === TRAINER_ROSTER_SHEET_FIELD
            && context.targetOwnerSheets.some(owner => owner.slug === scope.sheetSlug)))
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
  const targetOwnerSlugs = new Set(allTrainerSheets.filter(trainer => (
    [...(trainer.currentTeam ?? []), ...(trainer.boxedPokemon ?? [])]
      .some(slug => slug.trim() === targetPlacement.sheetSlug)
  )).map(trainer => trainer.slug))
  const targetOwnerSheets: PersistedSheet[] = allTrainerStored
    .filter(stored => targetOwnerSlugs.has(stored.slug))
    .map(stored => ({
      kind: stored.kind,
      slug: stored.slug,
      sheet: stored.document,
      revision: stored.revision,
      updatedAt: stored.updatedAt,
    }))
  const trainerBySlug = storedTrainerSheetMap(allTrainerStored)
  const pokemonBySlug = storedPokemonSheetMap(allPokemonStored)
  const storedByKey = new Map([...allTrainerStored, ...allPokemonStored]
    .map(stored => [`${stored.kind}:${stored.slug}`, stored] as const))
  for (const placement of map.placements) {
    if (!storedByKey.has(`${placement.sheetKind}:${placement.sheetSlug}`)) {
      throw new ThrowPokeballCommandUseCaseError(
        409,
        `Map-referenced sheet ${placement.sheetKind}/${placement.sheetSlug} is unavailable for Poké Ball authority`,
      )
    }
  }
  // Capture ownership and Marsupial relationships inspect the complete sheet
  // directory. Freeze every consulted revision, including the two exact reads
  // performed before the directory snapshots, rather than only map residents.
  const consultedByKey = new Map([...storedByKey.values()].map(stored => [
    `${stored.kind}:${stored.slug}`,
    { kind: stored.kind, slug: stored.slug, revision: normalizeRevision(stored.revision) },
  ] as const))
  consultedByKey.set(`trainer:${trainerSheet.slug}`, {
    kind: 'trainer', slug: trainerSheet.slug, revision: normalizeRevision(trainerSheet.revision),
  })
  consultedByKey.set(`pokemon:${targetSheet.slug}`, {
    kind: 'pokemon', slug: targetSheet.slug, revision: normalizeRevision(targetSheet.revision),
  })
  const consultedSheetRevisions = [...consultedByKey.values()]
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
    consultedSheetRevisions,
    consultedSheetDirectoryKeys: [...storedByKey.keys()].sort(),
    linkedTrainerSheets: await linkedTrainerSheetsForActor(actor, dependencies),
    targetOwnerSheets,
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
  if (payload.source.slug !== trainerSheet.slug
    || payload.source.expectedRevision !== trainerSheet.revision) {
    rejectLivePlayCommand('conflict', 'The exact Poké Ball source Trainer or revision changed')
  }
  const options = buildTrainerPokeballOptions(trainerSheet)
  const matches = options.filter(candidate => (
    candidate.sourceInstanceId === payload.sourceInstanceId
    && candidate.source.section === payload.source.section
    && candidate.source.rowId === payload.source.rowId
  ))
  if (matches.length !== 1) {
    rejectLivePlayCommand('conflict', 'The exact Poké Ball source row is unavailable or ambiguous')
    throw new Error('unreachable')
  }
  const option = matches[0]!
  if (option.quantity <= 0) {
    rejectLivePlayCommand('conflict', `${option.name} quantity must be greater than zero`)
    throw new Error('unreachable')
  }
  return option
}

const captureLinkedPokemonSlugs = (
  context: ResolvedThrowPokeballCommandContext,
): ReadonlySet<string> => linkedPokemonSlugSet(context.allTrainerSheets)

interface MarsupialCapturePair {
  readonly motherPlacementId: string
  readonly babyPlacementId: string
  readonly babySlug: string
}

interface CapabilityCaptureCompanion {
  readonly placementId: string
  readonly sheetSlug: string
  readonly kind: 'marsupial' | 'as-one-mount' | 'viral-fusion'
}

const capabilityCaptureCompanions = (
  context: ResolvedThrowPokeballCommandContext,
  marsupial: MarsupialCapturePair | null,
): readonly CapabilityCaptureCompanion[] => {
  const companions: CapabilityCaptureCompanion[] = marsupial ? [{
    placementId: marsupial.babyPlacementId,
    sheetSlug: marsupial.babySlug,
    kind: 'marsupial',
  }] : []
  const sourceCapabilities = resolveEffectiveCapabilities({
    map: context.map,
    placement: context.targetPlacement,
    sheet: context.pokemonBySlug.get(context.targetPlacement.sheetSlug)!,
    sheets: { pokemon: context.sheetLookup.pokemon, trainer: context.sheetLookup.trainer },
  })
  for (const link of context.map.encounterState?.capabilityRuntime?.links ?? []) {
    if (link.ownerPlacementId !== context.targetPlacement.id
      || (link.kind !== 'as-one-mount' && link.kind !== 'viral-fusion')
      || !sourceCapabilities.instances.some(instance => (
        instance.instanceId === link.capabilityInstanceId
        && instance.canonicalId === link.canonicalId
        && instance.effective
      ))) continue
    for (const placementId of link.participantPlacementIds) {
      const placement = context.map.placements.find(candidate => candidate.id === placementId)
      if (placement?.sheetKind !== 'pokemon') continue
      companions.push({ placementId, sheetSlug: placement.sheetSlug, kind: link.kind })
    }
  }
  return [...new Map(companions.map(companion => [companion.placementId, companion])).values()]
}

const marsupialRelationshipForCaptureTarget = (
  context: ResolvedThrowPokeballCommandContext,
) => {
  const relationship = resolveMarsupialRelationship({
    subjectSlug: context.targetPlacement.sheetSlug,
    pokemonBySlug: context.pokemonBySlug,
  })
  if (relationship.status === 'corrupt') rejectLivePlayCommand('conflict', relationship.message)
  return relationship
}

const marsupialCapturePairForMother = (
  context: ResolvedThrowPokeballCommandContext,
): MarsupialCapturePair | null => {
  const relationship = marsupialRelationshipForCaptureTarget(context)
  if (relationship.status !== 'valid' || relationship.subjectRole !== 'mother') return null
  const motherPlacement = context.map.placements.find(placement => (
    placement.sheetKind === 'pokemon' && placement.sheetSlug === relationship.pouch.motherSheetSlug
  ))
  const babyPlacement = context.map.placements.find(placement => (
    placement.sheetKind === 'pokemon' && placement.sheetSlug === relationship.pouch.babySheetSlug
  ))
  if (!motherPlacement || !babyPlacement || motherPlacement.id !== context.targetPlacement.id) {
    rejectLivePlayCommand('conflict', 'The authoritative Marsupial pair is not deployed together and cannot be captured partially')
  }
  return {
    motherPlacementId: motherPlacement!.id,
    babyPlacementId: babyPlacement!.id,
    babySlug: babyPlacement!.sheetSlug,
  }
}

const rejectCombinedParticipantCapture = (context: ResolvedThrowPokeballCommandContext): void => {
  for (const link of context.map.encounterState?.capabilityRuntime?.links ?? []) {
    if ((link.kind !== 'as-one-mount' && link.kind !== 'viral-fusion')
      || !link.participantPlacementIds.includes(context.targetPlacement.id)) continue
    const owner = context.map.placements.find(placement => placement.id === link.ownerPlacementId)
    const ownerSheet = owner?.sheetKind === 'pokemon' ? context.pokemonBySlug.get(owner.sheetSlug) : null
    if (!owner || !ownerSheet) continue
    const effective = resolveEffectiveCapabilities({
      map: context.map,
      placement: owner,
      sheet: ownerSheet,
      sheets: { pokemon: context.sheetLookup.pokemon, trainer: context.sheetLookup.trainer },
    })
    if (effective.instances.some(instance => instance.effective
      && instance.instanceId === link.capabilityInstanceId && instance.canonicalId === link.canonicalId)) {
      rejectLivePlayCommand('conflict', 'A mounted As One or Viral Fusion participant cannot be targeted or captured separately')
    }
  }
}

const rejectProtectedMarsupialBabyCapture = (context: ResolvedThrowPokeballCommandContext): void => {
  const relationship = marsupialRelationshipForCaptureTarget(context)
  if (relationship.status !== 'valid' || relationship.subjectRole !== 'baby') return
  const babySheet = context.pokemonBySlug.get(context.targetPlacement.sheetSlug)
    ?? rejectLivePlayCommand('conflict', 'The authoritative Marsupial baby sheet is unavailable')
  // Parental Bond explicitly moves the Baby out of the pouch. Its 10-metre
  // movement tether remains authoritative, but the conscious-mother pouch
  // protection no longer applies while the Ability is currently effective.
  if (effectiveRuntimeAbilityIds({
    map: context.map,
    placement: context.targetPlacement,
    sheet: babySheet,
  }).includes('Parental Bond')) return
  const motherPlacement = context.map.placements.find(placement => (
    placement.sheetKind === 'pokemon' && placement.sheetSlug === relationship.pouch.motherSheetSlug
  ))
  if (!motherPlacement) {
    rejectLivePlayCommand('conflict', 'A bound Baby-Template Kangaskhan cannot be captured while deployed without its mother')
  }
  const mother = placementToSpawned(motherPlacement!, context.sheetLookup, context.map)
  if (mother && mother.currentHp > 0) {
    rejectLivePlayCommand('conflict', 'A Baby Template Kangaskhan in its conscious mother’s pouch cannot be targeted or captured separately')
  }
}

const validateTargetIsInRange = (
  context: ResolvedThrowPokeballCommandContext,
  linkedSlugs: ReadonlySet<string>,
  allowOwnedTarget = false,
): void => {
  const rangeMeters = trainerThrowingRangeMeters(persistedSheetToTrainerSheet(context.trainerSheet))
  const tokens = context.map.placements
    .map((placement) => placementToSpawned(placement, context.sheetLookup, context.map))
    .filter((token): token is SpawnedPokemon => token !== null)
  const effectiveLinkedSlugs = allowOwnedTarget
    ? new Set([...linkedSlugs].filter(slug => slug !== context.targetPlacement.sheetSlug))
    : linkedSlugs
  const targets = unlinkedPokemonTargetsInPokeballRange({
    user: context.userToken,
    tokens,
    rangeMeters,
    linkedSlugs: effectiveLinkedSlugs,
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

const formerOwnerRosterPatch = (
  command: ThrowPokeballLivePlayCommand,
  revision: number,
  context: ResolvedThrowPokeballCommandContext,
  owner: { readonly previous: PersistedSheet, readonly current: Record<string, unknown> },
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.SHEET_FIELD, Record<string, unknown>, LivePlaySheetScope> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.SHEET_FIELD,
  mapSlug: command.mapSlug,
  revision,
  scopes: [{
    kind: 'sheet', sheetKind: 'trainer', sheetSlug: owner.previous.slug, field: TRAINER_ROSTER_SHEET_FIELD,
  }],
  payload: {
    command: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
    placementId: context.targetPlacement.id,
    sheetKind: 'trainer',
    sheetSlug: owner.previous.slug,
    field: TRAINER_ROSTER_SHEET_FIELD,
    previous: trainerPatchState(persistedSheetToTrainerSheet(owner.previous)),
    current: trainerPatchState(owner.current as unknown as TrainerSheet),
    sheetRevision: nextRevision(owner.previous.revision),
    transfer: 'snag-ball-capture',
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
    ...(nextContext.nextTargetOwnerSheets ?? []).map(owner => (
      formerOwnerRosterPatch(command, revision, previousContext, owner)
    )),
    ...(afterTargetSheet ? [targetSheetPatch(command, revision, previousContext, beforeTargetSheet, afterTargetSheet)] : []),
    ...(capture.result.success ? [placementDeletedPatch(command, revision, previousContext, capture)] : []),
  ]
}

const sheetUpdateFromPersisted = (sheet: PersistedSheet): LivePlayPokeballCommandSheetUpdate => ({
  kind: sheet.kind,
  slug: sheet.slug,
  sheet: sheet.sheet,
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
  const capabilitySheets = {
    pokemon: context.sheetLookup.pokemon ?? new Map(),
    trainer: context.sheetLookup.trainer ?? new Map(),
  }
  const actorEffective = resolveEffectiveCapabilities({
    map: context.map,
    placement: context.trainerPlacement,
    sheet: trainerSheet,
    sheets: capabilitySheets,
  }).instances.filter(instance => instance.effective)
  const targetEffective = resolveEffectiveCapabilities({
    map: context.map,
    placement: context.targetPlacement,
    sheet: targetSheet,
    sheets: capabilitySheets,
  }).instances.filter(instance => instance.effective)
  const loadedUserToken = projectPhysicalPowerLoadToken({
    token: context.userToken,
    map: context.map,
    placementId: context.trainerPlacement.id,
    powerByCapabilityInstanceId: physicalPowerSourceValues(actorEffective),
  })
  const loadedTargetToken = projectPhysicalPowerLoadToken({
    token: context.targetToken,
    map: context.map,
    placementId: context.targetPlacement.id,
    powerByCapabilityInstanceId: physicalPowerSourceValues(targetEffective),
  })
  const modeRestriction = capabilityStandardActionRestriction({
    map: context.map,
    placement: context.trainerPlacement,
    sheet: trainerSheet,
    pokemonSheets: capabilitySheets.pokemon,
    trainerSheets: capabilitySheets.trainer,
    now: dependencies.now(),
  })
  if (modeRestriction) rejectLivePlayCommand('invalid', modeRestriction.message)
  if (loadedUserToken.physicalPowerLoad?.standardActionsAllowed === false) {
    rejectLivePlayCommand('invalid', 'Staggering Weight prevents the Trainer from taking the Standard Action required to throw a Poké Ball.')
  }
  const pokeball = optionForPayload(trainerSheet, payload)
  const snagState = trainerSheet.serverPrivate?.snagMachine
  const snagResolution = resolveSnagBallForThrow({
    state: snagState ? snagState : { schemaVersion: 1, revision: 0, conversions: [], history: [] },
    ballSourceInstanceId: pokeball.sourceInstanceId,
    currentRound: context.map.initiative?.round ?? null,
    operationId: command.opId,
    historyIdFor: conversionId => `snag-history:v1:${createHash('sha256')
      .update(`throw\u0000${command.opId}\u0000${conversionId}`).digest('hex').slice(0, 32)}`,
  })
  if (snagResolution.kind === 'blocked') {
    rejectLivePlayCommand('conflict', 'The exact Portable Snag Ball is still inside its one-round conversion delay.')
  }
  const snagConversion = snagResolution.kind === 'snag-ball' ? snagResolution.conversion : null
  if (snagConversion && snagConversion.ballCanonicalItemId !== pokeball.name) {
    rejectLivePlayCommand('conflict', 'The converted Snag Ball lost its original reviewed Poké Ball identity.')
  }
  if (context.targetOwnerSheets.length > 1) {
    rejectLivePlayCommand('conflict', 'The target Pokémon has ambiguous Trainer ownership and cannot be captured.')
  }
  const targetOwner = context.targetOwnerSheets[0] ?? null
  if (targetOwner?.slug === trainerSheet.slug) {
    rejectLivePlayCommand('conflict', 'A Trainer cannot use a Snag Ball to recapture their own Pokémon.')
  }
  if (targetOwner && !snagConversion) {
    rejectLivePlayCommand('conflict', `Target Pokémon ${context.targetPlacement.sheetSlug} is already linked to a Trainer roster`)
  }
  rejectCombinedParticipantCapture(context)
  rejectProtectedMarsupialBabyCapture(context)
  const linkedSlugs = captureLinkedPokemonSlugs(context)
  const prospectiveMarsupialPair = marsupialCapturePairForMother(context)
  const prospectiveCompanions = capabilityCaptureCompanions(context, prospectiveMarsupialPair)
  if (targetOwner && prospectiveCompanions.length > 0) {
    rejectLivePlayCommand('conflict', 'Owned linked-capability groups cannot be stolen through a partial Snag Ball capture.')
  }
  const alreadyLinkedCompanion = prospectiveCompanions.find(companion => linkedSlugs.has(companion.sheetSlug))
  if (alreadyLinkedCompanion) {
    rejectLivePlayCommand('conflict', `The ${alreadyLinkedCompanion.kind} companion ${alreadyLinkedCompanion.sheetSlug} is already linked to a Trainer roster`)
  }
  validateTargetIsInRange(context, linkedSlugs, targetOwner !== null)

  const capture = resolvePokeballCaptureAttempt({
    trainer: trainerSheet,
    user: loadedUserToken,
    target: loadedTargetToken,
    targetSheet,
    pokeball,
    pokemonBySlug: context.pokemonBySlug,
    currentRound: context.map.initiative?.round ?? null,
    map: context.map,
    random: dependencies.random,
    now: dependencies.now,
    attackRollModifier: snagConversion ? SNAG_BALL_ATTACK_ROLL_PENALTY : 0,
    snagBall: snagConversion !== null,
  })
  const event: PokeballCaptureOutcomeEvent = {
    trainerId: context.trainerPlacement.id,
    targetId: context.targetPlacement.id,
    targetSlug: context.targetPlacement.sheetSlug,
    pokeballName: pokeball.name,
    result: capture,
  }

  const nextTrainer = deepCloneJson(trainerSheet) as TrainerSheet
  if (snagState || snagResolution.state.revision > 0) {
    nextTrainer.serverPrivate = {
      ...(nextTrainer.serverPrivate ?? {}),
      snagMachine: snagResolution.state,
    }
  }
  const trainerApplyResult = applyPokeballCaptureOutcomeToTrainerSheet(nextTrainer, event, pokeball)
  const marsupialPair = event.result.success ? prospectiveMarsupialPair : null
  const captureCompanions = event.result.success ? prospectiveCompanions : []
  for (const companion of captureCompanions) {
    if (linkedSlugs.has(companion.sheetSlug)
      || (nextTrainer.currentTeam ?? []).includes(companion.sheetSlug)
      || (nextTrainer.boxedPokemon ?? []).includes(companion.sheetSlug)) continue
    if ((nextTrainer.currentTeam ?? []).length < 6) {
      nextTrainer.currentTeam = [...(nextTrainer.currentTeam ?? []), companion.sheetSlug]
    }
    else nextTrainer.boxedPokemon = [...(nextTrainer.boxedPokemon ?? []), companion.sheetSlug]
  }
  if (!trainerApplyResult.consumed) {
    rejectLivePlayCommand('conflict', `Could not consume ${pokeball.name} from the authoritative trainer sheet`)
  }

  const beforeTarget = deepCloneJson(targetSheet) as CharacterSheet
  const nextTarget = event.result.success ? deepCloneJson(targetSheet) as CharacterSheet : null
  if (nextTarget) applyPokeballCaptureOutcomeToPokemonSheet(nextTarget, event)

  const timestamp = dependencies.now()
  const nextTargetOwnerSheets = event.result.success && targetOwner ? (() => {
    const owner = persistedSheetToTrainerSheet(targetOwner)
    const currentTeam = (owner.currentTeam ?? []).filter(slug => slug !== context.targetPlacement.sheetSlug)
    const boxedPokemon = (owner.boxedPokemon ?? []).filter(slug => slug !== context.targetPlacement.sheetSlug)
    if (currentTeam.length === (owner.currentTeam ?? []).length
      && boxedPokemon.length === (owner.boxedPokemon ?? []).length) {
      rejectLivePlayCommand('conflict', 'The owned target disappeared from its exact Trainer roster before settlement.')
    }
    return [{
      previous: targetOwner,
      current: sheetPayloadForPersistence({ ...owner, currentTeam, boxedPokemon }, targetOwner.slug, timestamp),
    }]
  })() : []
  const removedCapturePlacementIds = new Set([
    context.targetPlacement.id,
    ...captureCompanions.map(companion => companion.placementId),
  ])
  const captureBaseMap = event.result.success
    ? clearPhysicalPowerLoadsForPlacements(context.map, removedCapturePlacementIds)
    : context.map
  const nextMetadata = appendPokeballCaptureLogEntry(captureBaseMap.metadata, event, {
    now: () => timestamp,
    maxLogEntries: dependencies.maxLogEntries,
  })
  const nextInitiative = event.result.success && captureBaseMap.initiative?.activeId
    && removedCapturePlacementIds.has(captureBaseMap.initiative.activeId)
    ? { ...captureBaseMap.initiative, activeId: null }
    : captureBaseMap.initiative
  const revision = nextRevision(currentRevision)
  const capabilityRuntime = captureBaseMap.encounterState?.capabilityRuntime
  const nextEncounterState = event.result.success && capabilityRuntime ? {
    ...captureBaseMap.encounterState!,
    effects: captureBaseMap.encounterState!.effects.filter(effect => (
      !effect.affected.placementIds.some(placementId => removedCapturePlacementIds.has(placementId))
    )),
    capabilityRuntime: {
      ...capabilityRuntime,
      modes: capabilityRuntime.modes.filter(mode => !removedCapturePlacementIds.has(mode.actorPlacementId)),
      links: capabilityRuntime.links.filter(link => (
        !removedCapturePlacementIds.has(link.ownerPlacementId)
        && !link.participantPlacementIds.some(placementId => removedCapturePlacementIds.has(placementId))
      )),
    },
  } : captureBaseMap.encounterState
  const nextMap: TabletopMap = {
    ...captureBaseMap,
    revision,
    updatedAt: timestamp,
    metadata: marsupialPair ? {
      ...nextMetadata,
      capabilityMarsupialPouches: (Array.isArray(nextMetadata.capabilityMarsupialPouches)
        ? nextMetadata.capabilityMarsupialPouches : []).filter(raw => {
        const pouch = raw as Record<string, unknown>
        return pouch?.motherPlacementId !== marsupialPair.motherPlacementId
          && pouch?.babyPlacementId !== marsupialPair.babyPlacementId
      }),
    } : nextMetadata,
    placements: event.result.success
      ? captureBaseMap.placements.filter((placement) => !removedCapturePlacementIds.has(placement.id))
      : captureBaseMap.placements,
    ...(nextEncounterState === undefined ? {} : { encounterState: nextEncounterState }),
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
    ...(nextTargetOwnerSheets.length > 0 ? { nextTargetOwnerSheets } : {}),
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
  role: AuthRole,
  capture: PokeballCaptureOutcomeEvent | undefined = context?.capture,
): LivePlayPokeballCommandResponse => ({
  result,
  ...(context ? {
    path: context.relativePath,
    map: context.map,
    ...(context.sheetUpdates?.length ? {
      sheetUpdates: role === 'player'
        ? (redactSheetUpdatesForPlayer([...context.sheetUpdates]) ?? [])
        : [...context.sheetUpdates],
    } : {}),
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
      consultedSheetRevisions: [],
      consultedSheetDirectoryKeys: [],
      linkedTrainerSheets: [],
      targetOwnerSheets: [],
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
    commit: ({ actor, command, currentRevision, nextMap, result, recordRealtimeEvents, saveOpResult }) => {
      deps.database.withTransaction(() => {
        if (!nextMap.nextMap || !nextMap.nextTrainerSheet) {
          throw new ThrowPokeballCommandUseCaseError(409, 'throwPokeball accepted without a complete map and trainer sheet update')
        }
        const currentDirectoryKeys = [
          ...deps.sheetRepository.list('trainer'),
          ...deps.sheetRepository.list('pokemon'),
        ].map(stored => `${stored.kind}:${stored.slug}`).sort()
        if (JSON.stringify(currentDirectoryKeys) !== JSON.stringify(nextMap.consultedSheetDirectoryKeys)) {
          throw new ThrowPokeballCommandUseCaseError(
            409,
            'The sheet directory changed before Poké Ball authority could be persisted',
          )
        }
        for (const read of nextMap.consultedSheetRevisions) {
          const current = deps.sheetRepository.getByRef(read.kind, read.slug)
          if (!current || normalizeRevision(current.revision) !== read.revision) {
            throw new ThrowPokeballCommandUseCaseError(
              409,
              `Sheet ${read.kind}/${read.slug} changed before Poké Ball authority could be persisted`,
            )
          }
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

        for (const owner of nextMap.nextTargetOwnerSheets ?? []) {
          const ownerResult = deps.sheetRepository.applyLivePlayUpdate({
            kind: 'trainer',
            slug: owner.previous.slug,
            expectedRevision: owner.previous.revision,
            nextSheet: owner.current,
          })
          if (ownerResult === 'stale') {
            throw new ThrowPokeballCommandUseCaseError(409, `Former owner Trainer sheet ${owner.previous.slug} changed before Snag Ball settlement`)
          }
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

        if (!('connection' in deps.database)) throw new ThrowPokeballCommandUseCaseError(409, 'Poké Ball acquisition integration requires the authoritative SQLite database')
        const settleSpeciesAcquisitions = deps.settleCaptureSpeciesAcquisitions
        if (!settleSpeciesAcquisitions) throw new ThrowPokeballCommandUseCaseError(409, 'Poké Ball acquisition integration is unavailable')
        const authoritativeTrainerSheet = settleSpeciesAcquisitions({
          database: deps.database as RotomDatabase,
          livePlayOperationId: command.opId,
          actorProfileId: actor.playerProfile?.id
            ?? (actor.role === 'gm' ? 'system:gm-live-play' : null),
          mapSlug: command.mapSlug,
          acceptedMapRevision: result.revision,
          trainerSheetBefore: nextMap.trainerSheet,
          captureTargetSheetSlug: nextMap.targetSheet.slug,
          captureSucceeded: nextMap.capture?.result.success === true,
        })
        const updates = [sheetUpdateFromPersisted(authoritativeTrainerSheet)]
        for (const owner of nextMap.nextTargetOwnerSheets ?? []) {
          const authoritativeOwner = deps.sheetRepository.getByRef('trainer', owner.previous.slug)
          if (!authoritativeOwner) throw new ThrowPokeballCommandUseCaseError(404, `Former owner Trainer sheet ${owner.previous.slug} not found after Snag Ball command`)
          updates.push(sheetUpdateFromPersisted(authoritativeOwner))
        }
        if (nextMap.nextTargetSheet) {
          const authoritativeTargetSheet = deps.sheetRepository.getByRef('pokemon', nextMap.targetSheet.slug)
          if (!authoritativeTargetSheet) throw new ThrowPokeballCommandUseCaseError(404, `Target Pokémon sheet ${nextMap.targetSheet.slug} not found after Poké Ball command`)
          updates.push(sheetUpdateFromPersisted(authoritativeTargetSheet))
        }
        recordRealtimeEvents(livePlaySheetUpdateRealtimeAppendInputs({
          command,
          updates,
          clientId: actor.clientId,
        }))
        saveOpResult()

        const authoritativeMap = deps.mapRepository.getBySlug(result.mapSlug)
        if (!authoritativeMap) throw new ThrowPokeballCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after Poké Ball command`)
        persistedContext = {
          ...nextMap,
          map: authoritativeMap,
          sheetUpdates: updates,
        }
      })
    },
  })

  const accepted = isAcceptedResult(result) ? result : null
  const committedContext = persistedContext as ResolvedThrowPokeballCommandContext | null
  const responseContext = committedContext
    ?? (accepted ? await currentContextForAcceptedResult(accepted, input.role, deps) : null)
  const capture = committedContext?.capture ?? (accepted ? captureFromAcceptedResult(accepted) : undefined)
  return responseFromContext(result, responseContext, input.role, capture)
}

export const buildThrowPokeballCommandEnvelope = (input: {
  readonly opId: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly trainerPlacement: SheetPlacement
  readonly targetPlacement: SheetPlacement
  readonly pokeball: Pick<ReturnType<typeof buildTrainerPokeballOptions>[number], 'sourceInstanceId' | 'source'>
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
    sourceInstanceId: input.pokeball.sourceInstanceId,
    source: input.pokeball.source,
  },
})
