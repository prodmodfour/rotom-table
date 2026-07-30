import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandDuplicate,
  type LivePlayCommandResult,
  type LivePlayPatch,
  type LivePlayScope,
  type LivePlaySheetCommand,
  type LivePlaySheetScope,
  type LivePlayTokenScope,
  type GrantExperienceLivePlayCommand,
  type GrantExperiencePayload,
  type ModifyCombatStagesLivePlayCommand,
  type ModifyCombatStagesPayload,
  type ModifyConditionsLivePlayCommand,
  type ModifyConditionsPayload,
  type ModifyHpLivePlayCommand,
  type ModifyHpPayload,
} from '#shared/livePlayCommands'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { SheetKind } from '#shared/sheets'
import { createEmptyCapabilityCampaignState } from '#shared/capabilityAutomation/campaignState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { COMBAT_STAGE_KEYS } from '~/utils/combatStages'
import { sameJsonValue } from '~/utils/serialization'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  applyExperienceToSheet,
  applyHpToSheet,
  toPersistableSheetPayload,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { pokemonExperienceNeededForLevel } from '~/utils/sheets/pokemonExperience'
import { pokemonHasResolvedCapability, resolveStats } from '~/utils/sheets/pokemonDerived'
import {
  clampHpValue,
  computeInjuryAdjustedMaxHp,
  computePokemonFormulaMaxHp,
  normalizeInjuryCount,
} from '~/utils/ptuHp'
import { normalizeMapSceneState } from '~/utils/mapSceneState'
import {
  mapWithTemporaryHpForPlacement,
  normalizeTemporaryHpAmount,
  temporaryHpForPlacement,
} from '~/utils/mapTemporaryHitPoints'
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
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { reconcileAa075IceFaceTemporaryHpOwnershipAfterMove } from '../domain/abilityAutomation/mechanics/aa075TemporaryHpIntegration'
import {
  sqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { accessibleSheetUpdatesForPlayer } from '../utils/sheetPrivacy'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'
import { resolveAa062BerserkDirectTrigger } from '../domain/abilityAutomation/mechanics/aa062TriggeredIntegration'
import { applyCapabilityEvolutionTransition } from '../domain/capabilityAutomation/evolutionProviders'
import { resolveEffectiveCapabilities } from '../domain/capabilityAutomation/effectiveCapabilities'
import {
  capabilityHpSheetKey,
  reconcileCapabilityHpState,
  CapabilityHpStateReconciliationError,
  type CapabilityHpStateSheet,
  type ReconciledCapabilityHpState,
} from '../domain/capabilityAutomation/reconcileHpState'
import {
  marsupialRelationshipClaimedSlugs,
  resolveMarsupialRelationship,
  withoutMarsupialPouchState,
  withoutMarsupialTransientMapState,
  type ValidMarsupialRelationship,
} from '../domain/capabilityAutomation/marsupialRelationship'

export class LivePlaySheetCommandUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export type LivePlaySheetCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_HP
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS
  | typeof LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE

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
    & Partial<Pick<SheetRepository<Record<string, unknown>>, 'list'>>
  readonly database?: Pick<RotomDatabase, 'withTransaction'>
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
}

interface AdditionalLivePlaySheetWrite {
  readonly sheet: PersistedSheet
  readonly nextSheet: Record<string, unknown>
}

interface DerivedLivePlayHpPatch {
  readonly placement: SheetPlacement
  readonly sheet: PersistedSheet
  readonly nextSheet?: Record<string, unknown>
  readonly effectiveSoulless: boolean
}

interface ResolvedCapabilityHpContext {
  readonly targetHasEffectiveSoulless: boolean
  /** Every map sheet whose exact revision informed alias/link closure. */
  readonly consultedSheets: readonly PersistedSheet[]
}

interface ResolvedMarsupialRelationshipContext {
  readonly resolution: ValidMarsupialRelationship
  readonly motherSheet: PersistedSheet
  readonly babySheet: PersistedSheet
  readonly motherPlacement: SheetPlacement | null
  readonly babyPlacement: SheetPlacement | null
}

interface ResolvedLivePlaySheetCommandContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: PersistedSheet
  readonly linkedTrainerSheets: readonly ServerTokenControlLinkedTrainerSheet[]
  readonly nextSheet?: Record<string, unknown>
  readonly sheetUpdate?: LivePlaySheetCommandSheetUpdate
  readonly marsupialRelationship?: ResolvedMarsupialRelationshipContext
  readonly capabilityHp?: ResolvedCapabilityHpContext
  readonly additionalSheetWrites?: readonly AdditionalLivePlaySheetWrite[]
  readonly additionalHpPatches?: readonly DerivedLivePlayHpPatch[]
  readonly additionalSheetUpdates?: readonly LivePlaySheetCommandSheetUpdate[]
}

interface HpValueState {
  readonly currentHp: number
  readonly maxHp: number
  readonly fullMaxHp: number
  readonly injuries: number
}

interface ExperienceValueState {
  readonly level: number
  readonly totalExp: number
}

const livePlaySheetCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const sheetCommandTypes = new Set<string>([
  LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
  LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES,
  LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
  LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE,
])

const actionDependencies = (dependencies: LivePlaySheetCommandDependencies) => ({
  commandExecutor: dependencies.commandExecutor ?? livePlaySheetCommandExecutor,
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  sheetRepository: dependencies.sheetRepository ?? sqliteSheetRepository,
  database: dependencies.database ?? getRotomDatabase(),
  now: dependencies.now ?? Date.now,
  relativePath: dependencies.relativePath ?? ((path: string) => path),
})

type LivePlaySheetCommandDependencySet = ReturnType<typeof actionDependencies>

type UnknownRecord = Record<string, unknown>

const tokenControlTrainerSheet = (sheet: PersistedSheet): ServerTokenControlLinkedTrainerSheet => ({
  slug: sheet.slug,
  ...(Array.isArray(sheet.sheet.currentTeam) ? { currentTeam: sheet.sheet.currentTeam } : {}),
  ...(Array.isArray(sheet.sheet.boxedPokemon) ? { boxedPokemon: sheet.sheet.boxedPokemon } : {}),
})

const linkedTrainerSheetsForActor = async (
  actor: LivePlaySheetCommandActor,
  dependencies: LivePlaySheetCommandDependencySet,
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
  if (record.temporaryHp !== undefined && !finiteNumber(record.temporaryHp)) {
    rejectLivePlayCommand('invalid', 'modifyHp payload.temporaryHp must be a finite number when provided')
  }
  if (record.injuries !== undefined && !finiteNumber(record.injuries)) {
    rejectLivePlayCommand('invalid', 'modifyHp payload.injuries must be a finite number when provided')
  }
  return {
    placementId,
    currentHp: record.currentHp as number,
    ...(record.temporaryHp === undefined ? {} : { temporaryHp: normalizeTemporaryHpAmount(record.temporaryHp) }),
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

const expectGrantExperiencePayload = (payload: unknown): GrantExperiencePayload => {
  if (!isRecord(payload)) rejectLivePlayCommand('invalid', 'grantExperience payload must be an object')
  const record = payload as UnknownRecord
  const placementId = expectPlacementId(record, 'grantExperience')
  if (!Number.isSafeInteger(record.amount) || (record.amount as number) <= 0) {
    rejectLivePlayCommand('invalid', 'grantExperience payload.amount must be a safe positive integer')
  }
  return {
    placementId,
    amount: record.amount as number,
  }
}

const commandPayload = (command: LivePlaySheetCommand): ModifyHpPayload | ModifyCombatStagesPayload | ModifyConditionsPayload | GrantExperiencePayload => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP) return expectModifyHpPayload(command.payload)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES) return expectModifyCombatStagesPayload(command.payload)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS) return expectModifyConditionsPayload(command.payload)
  return expectGrantExperiencePayload(command.payload)
}

const commandPlacementId = (command: LivePlaySheetCommand): string => {
  if (!isRecord(command.payload)) rejectLivePlayCommand('invalid', `${command.type} payload must be an object`)
  return expectPlacementId(command.payload as unknown as UnknownRecord, command.type)
}

const tokenScopeFieldFor = (command: Pick<LivePlaySheetCommand, 'type'>): LivePlayTokenScope['field'] => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP) return 'hp'
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES) return 'combatStages'
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS) return 'conditions'
  return 'experience'
}

const sheetScopeFieldFor = (command: Pick<LivePlaySheetCommand, 'type'>): string => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP) return 'hp'
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES) return 'combatStages'
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS) return 'conditions'
  return 'experience'
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
): ModifyHpPayload | ModifyCombatStagesPayload | ModifyConditionsPayload | GrantExperiencePayload => {
  const payload = commandPayload(command)
  const tokenField = tokenScopeFieldFor(command)
  if (!tokenScopeMatches(command.scopes, payload.placementId, tokenField)) {
    rejectLivePlayCommand('invalid', `${command.type} scopes must include the token ${tokenField} scope for payload.placementId`)
  }

  if (placement) {
    if (command.type === LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE && placement.sheetKind !== 'pokemon') {
      rejectLivePlayCommand('invalid', 'grantExperience can only target Pokémon sheet placements')
    }

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
    rejectLivePlayCommand('invalid', 'Sheet live-play routes support modifyHp, modifyCombatStages, modifyConditions, and grantExperience commands only')
  }
}

const capabilitySheetDocument = (
  persisted: PersistedSheet,
): CharacterSheet | TrainerSheet => ({
  ...persisted.sheet,
  slug: persisted.slug,
  revision: persisted.revision,
}) as unknown as CharacterSheet | TrainerSheet

const resolveCapabilityHpContext = async (input: {
  readonly map: TabletopMap
  readonly targetPlacement: SheetPlacement
  readonly targetSheet: PersistedSheet
  readonly dependencies: LivePlaySheetCommandDependencySet
}): Promise<ResolvedCapabilityHpContext> => {
  const consultedByRef = new Map<string, PersistedSheet>([
    [`${input.targetSheet.kind}:${input.targetSheet.slug}`, input.targetSheet],
  ])
  for (const placement of input.map.placements) {
    const key = `${placement.sheetKind}:${placement.sheetSlug}`
    if (consultedByRef.has(key)) continue
    const loaded = await input.dependencies.sheetRepository.getByRef(placement.sheetKind, placement.sheetSlug)
    if (!loaded) {
      throw new LivePlaySheetCommandUseCaseError(
        404,
        `Sheet ${placement.sheetKind}/${placement.sheetSlug} required by Capability HP reconciliation was not found`,
      )
    }
    consultedByRef.set(key, loaded)
  }
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const persisted of consultedByRef.values()) {
    if (persisted.kind === 'pokemon') pokemon.set(persisted.slug, capabilitySheetDocument(persisted) as CharacterSheet)
    else trainer.set(persisted.slug, capabilitySheetDocument(persisted) as TrainerSheet)
  }
  const targetHasEffectiveSoulless = resolveEffectiveCapabilities({
    map: input.map,
    placement: input.targetPlacement,
    sheet: capabilitySheetDocument(input.targetSheet),
    sheets: { pokemon, trainer },
  }).instances.some(instance => instance.canonicalId === 'Soulless' && instance.effective)
  return {
    targetHasEffectiveSoulless,
    consultedSheets: [...consultedByRef.values()],
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

  if (!canAccessMapForRole(actor.role, map)) {
    throw new LivePlaySheetCommandUseCaseError(403, 'Map is not player visible')
  }

  const placement = map.placements.find((candidate) => candidate.id === placementId)
  if (!placement) throw new LivePlaySheetCommandUseCaseError(404, `Placement ${placementId} not found`)

  const sheet = await dependencies.sheetRepository.getByRef(placement.sheetKind, placement.sheetSlug)
  if (!sheet) {
    throw new LivePlaySheetCommandUseCaseError(404, `Sheet ${placement.sheetKind}/${placement.sheetSlug} not found`)
  }

  const capabilityHp = command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP
    || command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS
    ? await resolveCapabilityHpContext({ map, targetPlacement: placement, targetSheet: sheet, dependencies })
    : undefined

  let marsupialRelationship: ResolvedLivePlaySheetCommandContext['marsupialRelationship']
  if (command.type === LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE && placement.sheetKind === 'pokemon') {
    const persistedBySlug = new Map<string, PersistedSheet>([[sheet.slug, sheet]])
    const subject = { ...sheet.sheet, slug: sheet.slug } as unknown as CharacterSheet
    const candidateSlugs = new Set([
      ...marsupialRelationshipClaimedSlugs(subject),
      ...map.placements.filter(candidate => candidate.sheetKind === 'pokemon').map(candidate => candidate.sheetSlug),
      ...(dependencies.sheetRepository.list?.('pokemon').map(candidate => candidate.slug) ?? []),
    ])
    for (const slug of candidateSlugs) {
      if (persistedBySlug.has(slug)) continue
      const candidate = await dependencies.sheetRepository.getByRef('pokemon', slug)
      if (candidate) persistedBySlug.set(slug, candidate)
    }
    const pokemonBySlug = new Map([...persistedBySlug].map(([slug, persisted]) => [
      slug,
      { ...persisted.sheet, slug } as unknown as CharacterSheet,
    ]))
    const resolution = resolveMarsupialRelationship({ subjectSlug: sheet.slug, pokemonBySlug })
    if (resolution.status === 'corrupt') rejectLivePlayCommand('conflict', resolution.message)
    if (resolution.status === 'valid') {
      const motherSheet = persistedBySlug.get(resolution.pouch.motherSheetSlug)
      const babySheet = persistedBySlug.get(resolution.pouch.babySheetSlug)
      if (!motherSheet || !babySheet) rejectLivePlayCommand('conflict', 'The authoritative Marsupial pair is unavailable')
      marsupialRelationship = {
        resolution,
        motherSheet: motherSheet!,
        babySheet: babySheet!,
        motherPlacement: map.placements.find(candidate => (
          candidate.sheetKind === 'pokemon' && candidate.sheetSlug === resolution.pouch.motherSheetSlug
        )) ?? null,
        babyPlacement: map.placements.find(candidate => (
          candidate.sheetKind === 'pokemon' && candidate.sheetSlug === resolution.pouch.babySheetSlug
        )) ?? null,
      }
    }
  }

  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
    placement,
    sheet,
    linkedTrainerSheets: await linkedTrainerSheetsForActor(actor, dependencies),
    ...(marsupialRelationship ? { marsupialRelationship } : {}),
    ...(capabilityHp ? { capabilityHp } : {}),
  }
}

const hpSnapshotForSheet = (
  kind: SheetKind,
  sheet: AnyLiveSheet,
  effectiveSoulless?: boolean,
): HpValueState => {
  if (kind === 'pokemon' && effectiveSoulless === false
    && pokemonHasResolvedCapability(sheet as CharacterSheet, 'Soulless')) {
    const pokemon = sheet as CharacterSheet
    const injuries = normalizeInjuryCount(pokemon.combat?.injuries)
    const hpTotal = resolveStats(pokemon).find(stat => stat.key === 'hp')?.total ?? 0
    const fullMaxHp = computePokemonFormulaMaxHp(pokemon.level ?? 1, hpTotal)
    const maxHp = computeInjuryAdjustedMaxHp(fullMaxHp, injuries)
    return {
      currentHp: clampHpValue(pokemon.combat?.currentHp ?? maxHp, maxHp),
      maxHp,
      fullMaxHp,
      injuries,
    }
  }
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

const experienceSnapshotForSheet = (sheet: CharacterSheet): ExperienceValueState => ({
  level: sheet.level,
  totalExp: typeof sheet.totalExp === 'number' && Number.isFinite(sheet.totalExp)
    ? Math.max(0, Math.floor(sheet.totalExp))
    : pokemonExperienceNeededForLevel(sheet.level) ?? 0,
})

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

const sheetFieldPatch = (
  command: LivePlaySheetCommand,
  revision: number,
  placement: SheetPlacement,
  payload: Record<string, unknown>,
  derivedSheetScopes?: readonly LivePlaySheetScope[],
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.SHEET_FIELD> => {
  const field = sheetScopeFieldFor(command)
  const sheetScopes = derivedSheetScopes
    ?? command.scopes.filter((scope): scope is LivePlaySheetScope => scope.kind === 'sheet')
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
  scopes: readonly LivePlayScope[] = command.scopes,
): LivePlayPatch => ({
  schemaVersion: command.schemaVersion,
  type: command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP
    ? LIVE_PLAY_PATCH_TYPES.TOKEN_HP
    : command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES
      ? LIVE_PLAY_PATCH_TYPES.TOKEN_COMBAT_STAGES
      : command.type === LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE
        ? LIVE_PLAY_PATCH_TYPES.TOKEN_EXPERIENCE
        : LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS,
  mapSlug: command.mapSlug,
  revision,
  scopes,
  payload: {
    placementId: placement.id,
    sheetKind: placement.sheetKind,
    sheetSlug: placement.sheetSlug,
    ...payload,
  },
})

const derivedHpTokenPatch = (
  command: LivePlaySheetCommand,
  revision: number,
  placement: SheetPlacement,
  payload: Record<string, unknown>,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_HP> => {
  const tokenScope: LivePlayTokenScope = { kind: 'token', placementId: placement.id, field: 'hp' }
  const sheetScope: LivePlaySheetScope = {
    kind: 'sheet', sheetKind: placement.sheetKind, sheetSlug: placement.sheetSlug, field: 'hp',
  }
  return {
    schemaVersion: command.schemaVersion,
    type: LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
    mapSlug: command.mapSlug,
    revision,
    scopes: [tokenScope, sheetScope],
    payload: {
      placementId: placement.id,
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      ...payload,
    },
  }
}

const derivedHpSheetPatch = (
  command: LivePlaySheetCommand,
  revision: number,
  placement: SheetPlacement,
  payload: Record<string, unknown>,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.SHEET_FIELD> => {
  const sheetScope: LivePlaySheetScope = {
    kind: 'sheet', sheetKind: placement.sheetKind, sheetSlug: placement.sheetSlug, field: 'hp',
  }
  return {
    schemaVersion: command.schemaVersion,
    type: LIVE_PLAY_PATCH_TYPES.SHEET_FIELD,
    mapSlug: command.mapSlug,
    revision,
    scopes: [sheetScope],
    payload: {
      placementId: placement.id,
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      field: 'hp',
      ...payload,
    },
  }
}

const capabilityHpSnapshots = (
  context: ResolvedLivePlaySheetCommandContext,
): Map<string, CapabilityHpStateSheet> => new Map((context.capabilityHp?.consultedSheets ?? []).map((persisted) => {
  const key = capabilityHpSheetKey(persisted.kind, persisted.slug)
  return [key, {
    kind: persisted.kind,
    slug: persisted.slug,
    revision: normalizeRevision(persisted.revision),
    sheet: capabilitySheetDocument(persisted),
  }]
}))

const reconcileCapabilityHpMutation = (input: {
  readonly context: ResolvedLivePlaySheetCommandContext
  readonly targetSheet: AnyLiveSheet
  readonly nextMap: TabletopMap
  readonly rejectEffectiveSoullessTemporaryHpIncrease?: boolean
}): ReconciledCapabilityHpState => {
  const previousSheets = capabilityHpSnapshots(input.context)
  const projectedSheets = new Map(previousSheets)
  const targetKey = capabilityHpSheetKey(input.context.placement.sheetKind, input.context.placement.sheetSlug)
  const target = projectedSheets.get(targetKey)
  if (!target) rejectLivePlayCommand('conflict', `Capability HP sheet ${targetKey} is unavailable`)
  projectedSheets.set(targetKey, { ...target!, sheet: input.targetSheet as CharacterSheet | TrainerSheet })
  try {
    return reconcileCapabilityHpState({
      previousMap: input.context.map,
      nextMap: input.nextMap,
      sheets: projectedSheets,
      previousSheets,
      touchedPlacementIds: new Set([input.context.placement.id]),
      rejectEffectiveSoullessTemporaryHpIncrease: input.rejectEffectiveSoullessTemporaryHpIncrease,
    })
  }
  catch (error) {
    if (error instanceof CapabilityHpStateReconciliationError) {
      rejectLivePlayCommand(error.code === 'soulless-temporary-hp' ? 'invalid' : 'conflict', error.message)
    }
    throw error
  }
}

const finalizeCapabilityHpMutation = (input: {
  readonly context: ResolvedLivePlaySheetCommandContext
  readonly currentRevision: number
  readonly updatedAt: number
  readonly map: TabletopMap
  readonly sheets: ReadonlyMap<string, CapabilityHpStateSheet>
  readonly relatedPlacementIds: ReadonlySet<string>
}): ResolvedLivePlaySheetCommandContext | null => {
  const originalByKey = new Map((input.context.capabilityHp?.consultedSheets ?? []).map(persisted => [
    capabilityHpSheetKey(persisted.kind, persisted.slug),
    persisted,
  ]))
  const primaryKey = capabilityHpSheetKey(input.context.sheet.kind, input.context.sheet.slug)
  const changedKeys = [...input.sheets].flatMap(([key, snapshot]) => {
    const original = originalByKey.get(key)
    return original && !sameJsonValue(capabilitySheetDocument(original), snapshot.sheet) ? [key] : []
  })
  const mapChanged = !sameJsonValue(input.context.map, input.map)
  if (changedKeys.length === 0 && !mapChanged) return null

  const primarySnapshot = input.sheets.get(primaryKey)
    ?? rejectLivePlayCommand('conflict', `Capability HP sheet ${primaryKey} disappeared during reconciliation`)
  const primaryChanged = changedKeys.includes(primaryKey)
  const nextSheet = primaryChanged
    ? sheetPayloadForPersistence(primarySnapshot.sheet, input.context.sheet.slug, input.updatedAt)
    : undefined
  const additionalSheetWrites: AdditionalLivePlaySheetWrite[] = changedKeys.flatMap((key) => {
    if (key === primaryKey) return []
    const original = originalByKey.get(key)
    const snapshot = input.sheets.get(key)
    return original && snapshot ? [{
      sheet: original,
      nextSheet: sheetPayloadForPersistence(snapshot.sheet, original.slug, input.updatedAt),
    }] : []
  })

  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const snapshot of input.sheets.values()) {
    if (snapshot.kind === 'pokemon') pokemon.set(snapshot.slug, snapshot.sheet as CharacterSheet)
    else trainer.set(snapshot.slug, snapshot.sheet as TrainerSheet)
  }
  const additionalHpPatches: DerivedLivePlayHpPatch[] = []
  for (const placementId of input.relatedPlacementIds) {
    const placement = input.context.map.placements.find(candidate => candidate.id === placementId)
    if (!placement) continue
    const key = capabilityHpSheetKey(placement.sheetKind, placement.sheetSlug)
    const original = originalByKey.get(key)
    const snapshot = input.sheets.get(key)
    if (!original || !snapshot) continue
    const effectiveSoulless = resolveEffectiveCapabilities({
      map: input.map,
      placement,
      sheet: snapshot.sheet,
      sheets: { pokemon, trainer },
    }).instances.some(instance => instance.effective && instance.canonicalId === 'Soulless')
    const before = hpSnapshotForSheet(placement.sheetKind, capabilitySheetDocument(original), effectiveSoulless)
    const after = hpSnapshotForSheet(placement.sheetKind, snapshot.sheet, effectiveSoulless)
    const temporaryHpChanged = temporaryHpForPlacement(input.context.map, placement.id)
      !== temporaryHpForPlacement(input.map, placement.id)
    if (sameJsonValue(before, after) && !temporaryHpChanged) continue
    additionalHpPatches.push({
      placement,
      sheet: original,
      ...(changedKeys.includes(key)
        ? { nextSheet: sheetPayloadForPersistence(snapshot.sheet, original.slug, input.updatedAt) }
        : {}),
      effectiveSoulless,
    })
  }

  const revision = nextRevision(input.currentRevision)
  const nextSheetRevision = nextRevision(input.context.sheet.revision)
  return {
    ...input.context,
    map: { ...input.map, revision, updatedAt: input.updatedAt },
    ...(nextSheet ? { nextSheet } : {}),
    ...(additionalSheetWrites.length > 0 ? { additionalSheetWrites } : {}),
    ...(additionalHpPatches.length > 0 ? { additionalHpPatches } : {}),
    ...(primaryChanged ? {
      sheetUpdate: {
        kind: input.context.sheet.kind,
        slug: input.context.sheet.slug,
        sheet: { ...nextSheet!, revision: nextSheetRevision },
      },
    } : {}),
  }
}

const applyModifyHp = (
  command: ModifyHpLivePlayCommand,
  context: ResolvedLivePlaySheetCommandContext,
  currentRevision: number,
  updatedAt: number,
): ResolvedLivePlaySheetCommandContext | null => {
  const payload = expectModifyHpPayload(command.payload)
  const targetHasEffectiveSoulless = context.capabilityHp?.targetHasEffectiveSoulless ?? false
  if (payload.temporaryHp !== undefined && payload.temporaryHp > 0 && targetHasEffectiveSoulless) {
    rejectLivePlayCommand('invalid', 'Soulless creatures cannot gain Temporary HP')
  }
  if (payload.temporaryHp !== undefined && payload.temporaryHp > 0
    && !normalizeMapSceneState(context.map.activeScene)) {
    rejectLivePlayCommand('invalid', 'Temporary HP requires an active scene')
  }

  const original = capabilitySheetDocument(context.sheet) as AnyLiveSheet
  const previous = hpSnapshotForSheet(context.placement.sheetKind, original, targetHasEffectiveSoulless)
  const requestedSheet = applyHpToSheet(
    context.placement.sheetKind,
    original,
    payload.currentHp,
    payload.injuries,
    { effectiveSoulless: targetHasEffectiveSoulless },
  )
  const requestedMap = payload.temporaryHp === undefined
    ? context.map
    : mapWithTemporaryHpForPlacement(context.map, context.placement.id, payload.temporaryHp)
  const reconciled = reconcileCapabilityHpMutation({
    context,
    targetSheet: requestedSheet,
    nextMap: requestedMap,
  })
  const targetKey = capabilityHpSheetKey(context.placement.sheetKind, context.placement.sheetSlug)
  const targetSnapshot = reconciled.sheets.get(targetKey)
    ?? rejectLivePlayCommand('conflict', `Capability HP sheet ${targetKey} disappeared during reconciliation`)
  const current = hpSnapshotForSheet(
    context.placement.sheetKind,
    targetSnapshot.sheet,
    targetHasEffectiveSoulless,
  )
  const berserk = resolveAa062BerserkDirectTrigger({
    map: reconciled.nextMap,
    placement: context.placement,
    sheet: original,
    previousHp: previous.currentHp,
    currentHp: current.currentHp,
    maximumHp: previous.fullMaxHp,
    previousConditions: conditionsSnapshotForSheet(context.placement.sheetKind, original),
    currentConditions: conditionsSnapshotForSheet(context.placement.sheetKind, targetSnapshot.sheet),
    operationId: command.opId,
  })
  const finalSheets = new Map(reconciled.sheets)
  if (berserk.triggered) {
    const stages = combatStagesSnapshotForSheet(context.placement.sheetKind, targetSnapshot.sheet)
    stages.satk = Math.min(6, stages.satk + 1)
    finalSheets.set(targetKey, {
      ...targetSnapshot,
      sheet: applyCombatStagesToSheet(context.placement.sheetKind, targetSnapshot.sheet, stages) as CharacterSheet | TrainerSheet,
    })
  }
  const finalMap = !sameJsonValue(context.map.temporaryHitPoints, berserk.map.temporaryHitPoints)
    ? reconcileAa075IceFaceTemporaryHpOwnershipAfterMove({
        previousMap: context.map,
        nextMap: berserk.map,
        operations: [],
      })
    : berserk.map
  return finalizeCapabilityHpMutation({
    context,
    currentRevision,
    updatedAt,
    map: finalMap,
    sheets: finalSheets,
    relatedPlacementIds: reconciled.relatedPlacementIds,
  })
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
  const original = capabilitySheetDocument(context.sheet) as AnyLiveSheet
  const previousConditions = conditionsSnapshotForSheet(context.placement.sheetKind, original)
  const nextConditions = conditionsAfterAction(previousConditions, payload)
  if (sameStringArray(previousConditions, nextConditions)) return null
  const requestedSheet = applyConditionsToSheet(context.placement.sheetKind, original, nextConditions)
  const reconciled = reconcileCapabilityHpMutation({
    context,
    targetSheet: requestedSheet,
    nextMap: context.map,
  })
  const targetKey = capabilityHpSheetKey(context.placement.sheetKind, context.placement.sheetSlug)
  const targetSnapshot = reconciled.sheets.get(targetKey)
    ?? rejectLivePlayCommand('conflict', `Capability HP sheet ${targetKey} disappeared during reconciliation`)
  const previousHp = hpSnapshotForSheet(context.placement.sheetKind, original)
  const currentHp = hpSnapshotForSheet(context.placement.sheetKind, targetSnapshot.sheet)
  const currentConditions = conditionsSnapshotForSheet(context.placement.sheetKind, targetSnapshot.sheet)
  const berserk = resolveAa062BerserkDirectTrigger({
    map: reconciled.nextMap,
    placement: context.placement,
    sheet: original,
    previousHp: previousHp.currentHp,
    currentHp: currentHp.currentHp,
    maximumHp: previousHp.fullMaxHp,
    previousConditions,
    currentConditions,
    operationId: command.opId,
  })
  const finalSheets = new Map(reconciled.sheets)
  if (berserk.triggered) {
    const stages = combatStagesSnapshotForSheet(context.placement.sheetKind, targetSnapshot.sheet)
    stages.satk = Math.min(6, stages.satk + 1)
    finalSheets.set(targetKey, {
      ...targetSnapshot,
      sheet: applyCombatStagesToSheet(context.placement.sheetKind, targetSnapshot.sheet, stages) as CharacterSheet | TrainerSheet,
    })
  }
  const finalMap = !sameJsonValue(context.map.temporaryHitPoints, berserk.map.temporaryHitPoints)
    ? reconcileAa075IceFaceTemporaryHpOwnershipAfterMove({
        previousMap: context.map,
        nextMap: berserk.map,
        operations: [],
      })
    : berserk.map
  return finalizeCapabilityHpMutation({
    context,
    currentRevision,
    updatedAt,
    map: finalMap,
    sheets: finalSheets,
    relatedPlacementIds: reconciled.relatedPlacementIds,
  })
}

const applyGrantExperience = (
  command: GrantExperienceLivePlayCommand,
  context: ResolvedLivePlaySheetCommandContext,
  currentRevision: number,
  updatedAt: number,
): ResolvedLivePlaySheetCommandContext | null => {
  const payload = expectGrantExperiencePayload(command.payload)
  if (context.placement.sheetKind !== 'pokemon') {
    rejectLivePlayCommand('invalid', 'grantExperience can only target Pokémon sheet placements')
  }

  const original = context.sheet.sheet as unknown as CharacterSheet
  const relationshipContext = context.marsupialRelationship
  const relationship = relationshipContext?.resolution
  const targetIsMother = relationship?.subjectRole === 'mother'
  const shareWithBaby = targetIsMother && relationship.pouch.experienceSharePercent === 20
  const babyAmount = shareWithBaby ? Math.floor(payload.amount * 0.2) : 0
  const targetAmount = payload.amount - babyAmount
  const previous = experienceSnapshotForSheet(original)
  let updated = applyCapabilityEvolutionTransition(
    original,
    applyExperienceToSheet('pokemon', original, targetAmount) as CharacterSheet,
    relationship ? { marsupialRelationship: relationship } : {},
  ).sheet
  const current = experienceSnapshotForSheet(updated)

  const marsupialSheetPayload = (
    next: CharacterSheet,
    persisted: PersistedSheet,
  ): Record<string, unknown> => {
    const payload = sheetPayloadForPersistence(next, persisted.slug, updatedAt)
    if (next.capabilityCampaignState === undefined
      && (persisted.sheet as unknown as CharacterSheet).capabilityCampaignState !== undefined) {
      payload.capabilityCampaignState = createEmptyCapabilityCampaignState()
    }
    return payload
  }
  const additionalWrites = new Map<string, AdditionalLivePlaySheetWrite>()
  const addWrite = (persisted: PersistedSheet, next: CharacterSheet): void => {
    if (persisted.slug === context.sheet.slug) return
    additionalWrites.set(persisted.slug, {
      sheet: persisted,
      nextSheet: marsupialSheetPayload(next, persisted),
    })
  }

  let babyUpdated: CharacterSheet | null = null
  if (shareWithBaby && relationshipContext && babyAmount > 0) {
    const babyOriginal = relationshipContext.babySheet.sheet as unknown as CharacterSheet
    babyUpdated = applyCapabilityEvolutionTransition(
      babyOriginal,
      applyExperienceToSheet('pokemon', babyOriginal, babyAmount) as CharacterSheet,
      { marsupialRelationship: relationshipContext.resolution },
    ).sheet
    addWrite(relationshipContext.babySheet, babyUpdated)
  }

  let relationshipEnded = false
  if (relationshipContext) {
    const babyOriginal = relationshipContext.babySheet.sheet as unknown as CharacterSheet
    const resolvedRelationship = relationshipContext.resolution
    const resultingBaby = context.sheet.slug === resolvedRelationship.pouch.babySheetSlug
      ? updated
      : babyUpdated ?? babyOriginal
    relationshipEnded = babyOriginal.babyTemplate === true && resultingBaby.babyTemplate === false
    if (relationshipEnded) {
      if (context.sheet.slug === resolvedRelationship.pouch.motherSheetSlug
        || context.sheet.slug === resolvedRelationship.pouch.babySheetSlug) {
        updated = withoutMarsupialPouchState(updated)
      }
      const motherNext = context.sheet.slug === resolvedRelationship.pouch.motherSheetSlug
        ? updated
        : withoutMarsupialPouchState(relationshipContext.motherSheet.sheet as unknown as CharacterSheet)
      const babyNext = context.sheet.slug === resolvedRelationship.pouch.babySheetSlug
        ? updated
        : withoutMarsupialPouchState(babyUpdated ?? babyOriginal)
      addWrite(relationshipContext.motherSheet, motherNext)
      addWrite(relationshipContext.babySheet, babyNext)
    }
  }

  const additionalSheetWrites = [...additionalWrites.values()]
  if (sameJsonValue(previous, current) && additionalSheetWrites.length === 0 && !relationshipEnded) return null
  const nextSheetRevision = nextRevision(context.sheet.revision)
  const revision = nextRevision(currentRevision)
  const relationshipReconciledMap = relationshipEnded && relationship
    ? withoutMarsupialTransientMapState(context.map, relationship)
    : context.map
  return {
    ...context,
    map: {
      ...relationshipReconciledMap,
      revision,
      updatedAt,
    },
    nextSheet: marsupialSheetPayload(updated, context.sheet),
    ...(additionalSheetWrites.length ? { additionalSheetWrites } : {}),
    sheetUpdate: {
      kind: context.sheet.kind,
      slug: context.sheet.slug,
      sheet: { ...sheetPayloadForPersistence(updated, context.sheet.slug, updatedAt), revision: nextSheetRevision },
    },
  }
}

const hpValuePatchPayload = (
  before: AnyLiveSheet,
  after: AnyLiveSheet,
  placement: SheetPlacement,
  sheetRevision: number,
  previousMap: TabletopMap | undefined,
  nextMap: TabletopMap | undefined,
  effectiveSoulless?: boolean,
): Record<string, unknown> => ({
  previous: hpSnapshotForSheet(placement.sheetKind, before, effectiveSoulless),
  current: hpSnapshotForSheet(placement.sheetKind, after, effectiveSoulless),
  previousTemporaryHp: previousMap ? temporaryHpForPlacement(previousMap, placement.id) : 0,
  currentTemporaryHp: nextMap ? temporaryHpForPlacement(nextMap, placement.id) : 0,
  sheetRevision,
})

const valuePatchPayload = (
  command: LivePlaySheetCommand,
  before: AnyLiveSheet,
  after: AnyLiveSheet,
  placement: SheetPlacement,
  sheetRevision: number,
  previousMap?: TabletopMap,
  nextMap?: TabletopMap,
  effectiveSoulless?: boolean,
): Record<string, unknown> => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP) {
    return hpValuePatchPayload(
      before,
      after,
      placement,
      sheetRevision,
      previousMap,
      nextMap,
      effectiveSoulless,
    )
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES) {
    return {
      previous: combatStagesSnapshotForSheet(placement.sheetKind, before),
      current: combatStagesSnapshotForSheet(placement.sheetKind, after),
      sheetRevision,
    }
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE) {
    const payload = expectGrantExperiencePayload(command.payload)
    return {
      previous: experienceSnapshotForSheet(before as CharacterSheet),
      current: experienceSnapshotForSheet(after as CharacterSheet),
      amount: payload.amount,
      sheetRevision,
    }
  }
  return {
    previous: conditionsSnapshotForSheet(placement.sheetKind, before),
    current: conditionsSnapshotForSheet(placement.sheetKind, after),
    sheetRevision,
  }
}

const mapStateNotCoveredBySheetCommandPatches = (
  command: LivePlaySheetCommand,
  map: TabletopMap,
): Record<string, unknown> => {
  const { revision: _revision, updatedAt: _updatedAt, ...state } = map
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.MODIFY_HP
    && command.type !== LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS) return state
  const { temporaryHitPoints: _temporaryHitPoints, ...stateWithoutTemporaryHp } = state
  return stateWithoutTemporaryHp
}

const reconciliationRequiredPatch = (
  command: LivePlaySheetCommand,
  revision: number,
  placement: SheetPlacement,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.RECONCILIATION_REQUIRED> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.RECONCILIATION_REQUIRED,
  mapSlug: command.mapSlug,
  revision,
  scopes: command.scopes,
  payload: {
    placementId: placement.id,
    reason: 'authoritative map-owned state changed outside bounded sheet-command patches',
  },
})

const patchesForAcceptedSheetCommand = (
  command: LivePlaySheetCommand,
  revision: number,
  previousContext: ResolvedLivePlaySheetCommandContext,
  nextContext: ResolvedLivePlaySheetCommandContext,
): LivePlayPatch[] => {
  if (!nextContext.nextSheet && command.type !== LIVE_PLAY_COMMAND_TYPES.MODIFY_HP) return []
  const before = previousContext.sheet.sheet as unknown as AnyLiveSheet
  const after = (nextContext.nextSheet ?? previousContext.sheet.sheet) as unknown as AnyLiveSheet
  const sheetRevision = nextContext.nextSheet ? nextRevision(previousContext.sheet.revision) : previousContext.sheet.revision
  const payload = valuePatchPayload(
    command,
    before,
    after,
    previousContext.placement,
    sheetRevision,
    previousContext.map,
    nextContext.map,
    previousContext.capabilityHp?.targetHasEffectiveSoulless,
  )
  const projectsHpConsequences = command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP
    || command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS
  const representedHpPlacementIds = new Set(
    command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP ? [previousContext.placement.id] : [],
  )
  const derivedHpPatches = projectsHpConsequences
    ? (nextContext.additionalHpPatches ?? []).flatMap((derived): LivePlayPatch[] => {
        if (representedHpPlacementIds.has(derived.placement.id)) return []
        representedHpPlacementIds.add(derived.placement.id)
        const derivedPayload = hpValuePatchPayload(
          capabilitySheetDocument(derived.sheet),
          (derived.nextSheet ?? capabilitySheetDocument(derived.sheet)) as unknown as AnyLiveSheet,
          derived.placement,
          derived.nextSheet ? nextRevision(derived.sheet.revision) : derived.sheet.revision,
          previousContext.map,
          nextContext.map,
          derived.effectiveSoulless,
        )
        return [
          derivedHpTokenPatch(command, revision, derived.placement, derivedPayload),
          ...(derived.nextSheet
            ? [derivedHpSheetPatch(command, revision, derived.placement, derivedPayload)]
            : []),
        ]
      })
    : []
  const temporaryHpOnlyPatches = projectsHpConsequences
    ? previousContext.map.placements.flatMap((placement): LivePlayPatch[] => {
        const previousTemporaryHp = temporaryHpForPlacement(previousContext.map, placement.id)
        const currentTemporaryHp = temporaryHpForPlacement(nextContext.map, placement.id)
        if (previousTemporaryHp === currentTemporaryHp || representedHpPlacementIds.has(placement.id)) return []
        return [derivedHpTokenPatch(command, revision, placement, {
          previousTemporaryHp,
          currentTemporaryHp,
        })]
      })
    : []
  const requiresReconciliation = !sameJsonValue(
    mapStateNotCoveredBySheetCommandPatches(command, previousContext.map),
    mapStateNotCoveredBySheetCommandPatches(command, nextContext.map),
  )
  return [
    ...(requiresReconciliation
      ? [reconciliationRequiredPatch(command, revision, previousContext.placement)]
      : []),
    tokenPatch(command, revision, previousContext.placement, payload),
    ...(nextContext.nextSheet ? [sheetFieldPatch(command, revision, previousContext.placement, payload)] : []),
    ...derivedHpPatches,
    ...temporaryHpOnlyPatches,
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
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS) {
    return applyModifyConditions(command, context, currentRevision, updatedAt)
  }
  return applyGrantExperience(command, context, currentRevision, updatedAt)
}

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const isDuplicateWithAcceptedResult = (
  result: LivePlayCommandResult,
): result is LivePlayCommandDuplicate & { readonly original: LivePlayCommandAccepted } => (
  result.ok === true && 'duplicate' in result && result.original.ok === true
)

const acceptedResultFromCommandResult = (
  result: LivePlayCommandResult,
): LivePlayCommandAccepted | null => {
  if (isAcceptedResult(result)) return result
  return isDuplicateWithAcceptedResult(result) ? result.original : null
}

const placementIdFromAcceptedResult = (result: LivePlayCommandAccepted): string | null => (
  result.patches[0]?.scopes.find((scope): scope is LivePlayTokenScope => scope.kind === 'token')?.placementId ?? null
)

const responseFromContext = (
  result: LivePlayCommandResult,
  context: ResolvedLivePlaySheetCommandContext | null,
  role: AuthRole,
  playerProfile: PlayerProfile | null | undefined,
): LivePlaySheetCommandResponse => {
  const sheetUpdates = context
    ? [...(context.sheetUpdate ? [context.sheetUpdate] : []), ...(context.additionalSheetUpdates ?? [])]
    : []
  const projectedSheetUpdates = role === 'player' && context
    ? (accessibleSheetUpdatesForPlayer(sheetUpdates, {
        playerProfile,
        linkedTrainerSheets: context.linkedTrainerSheets,
      }) ?? [])
    : sheetUpdates
  const acceptedResult = acceptedResultFromCommandResult(result)
  const scopedSheetUpdates = acceptedResult?.patches.flatMap(patch => patch.scopes.flatMap(scope => (
    scope.kind === 'sheet'
      ? [{ kind: scope.sheetKind, slug: scope.sheetSlug, sheet: { slug: scope.sheetSlug } }]
      : []
  ))) ?? []
  const accessibleScopedSheets = role === 'player' && context
    ? (accessibleSheetUpdatesForPlayer(scopedSheetUpdates, {
        playerProfile,
        linkedTrainerSheets: context.linkedTrainerSheets,
      }) ?? [])
    : scopedSheetUpdates
  const accessibleSheetRefs = new Set([
    ...projectedSheetUpdates.map(update => `${update.kind}:${update.slug}`),
    ...accessibleScopedSheets.map(update => `${update.kind}:${update.slug}`),
  ])
  const projectAcceptedResult = (accepted: LivePlayCommandAccepted): LivePlayCommandAccepted => ({
    ...accepted,
    patches: context
      ? accepted.patches.filter((patch) => {
          if (patch.type === LIVE_PLAY_PATCH_TYPES.RECONCILIATION_REQUIRED) return true
          const placementId = isRecord(patch.payload) && typeof patch.payload.placementId === 'string'
            ? patch.payload.placementId : null
          if (placementId === context.placement.id) return true
          return patch.scopes.some(scope => scope.kind === 'sheet'
            && accessibleSheetRefs.has(`${scope.sheetKind}:${scope.sheetSlug}`))
        })
      : [],
  })
  const projectedResult = role !== 'player'
    ? result
    : isAcceptedResult(result)
      ? projectAcceptedResult(result)
      : isDuplicateWithAcceptedResult(result)
        ? { ...result, original: projectAcceptedResult(result.original) }
        : result
  return {
    result: projectedResult,
    ...(context ? {
      path: context.relativePath,
      // Player clients apply bounded accepted patches. Returning the raw map
      // here would bypass Capability/runtime and carried-participant projection.
      ...(role === 'gm' ? { map: context.map } : {}),
      placement: context.placement,
      ...(sheetUpdates.length ? { sheetUpdates: projectedSheetUpdates } : {}),
    } : {}),
  }
}

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
    const context = await resolveContext(command, { role, playerProfile }, dependencies)
    if (!actorCanControlMapPlacement({
      role,
      profile: playerProfile,
      placement: context.placement,
      linkedTrainerSheets: context.linkedTrainerSheets,
    })) return null
    return context
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
        linkedTrainerSheets: map.linkedTrainerSheets,
      })) {
        throw new LivePlaySheetCommandUseCaseError(403, controlDeniedMessage(actor.role, actor.playerProfile))
      }
      if (actor.role === 'player' && map.marsupialRelationship) {
        const relationship = map.marsupialRelationship
        const counterpartSlug = map.sheet.slug === relationship.resolution.pouch.motherSheetSlug
          ? relationship.resolution.pouch.babySheetSlug
          : relationship.resolution.pouch.motherSheetSlug
        const counterpartPlacement = relationship.motherPlacement?.sheetSlug === counterpartSlug
          ? relationship.motherPlacement
          : relationship.babyPlacement?.sheetSlug === counterpartSlug
            ? relationship.babyPlacement
            : { ...map.placement, id: `marsupial-counterpart:${counterpartSlug}`, sheetKind: 'pokemon' as const, sheetSlug: counterpartSlug }
        if (!actorCanControlMapPlacement({
          role: actor.role,
          profile: actor.playerProfile,
          placement: counterpartPlacement,
          linkedTrainerSheets: map.linkedTrainerSheets,
        })) {
          throw new LivePlaySheetCommandUseCaseError(403, 'The selected player profile must control both Marsupial sheets')
        }
      }
    },
    apply: ({ command, map, currentRevision }) => {
      const nextContext = applySheetCommand(command, map, currentRevision, deps)
      if (!nextContext) {
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
    persist: () => {
      throw new Error('live-play sheet commands must persist through the accepted-result commit hook')
    },
    commit: ({ actor, command, currentRevision, nextMap, result, recordRealtimeEvents, saveOpResult }) => {
      const nextSheet = nextMap.nextSheet
      deps.database.withTransaction(() => {
        for (const consulted of nextMap.capabilityHp?.consultedSheets ?? []) {
          const current = deps.sheetRepository.getByRef(consulted.kind, consulted.slug)
          if (!current || normalizeRevision(current.revision) !== normalizeRevision(consulted.revision)) {
            throw new LivePlaySheetCommandUseCaseError(
              409,
              `Sheet ${consulted.kind}/${consulted.slug} changed after Capability HP planning`,
            )
          }
        }
        const persisted = toPersistedMap(
          nextMap.map,
          nextMap.map.folder ?? '',
          nextMap.map.updatedAt ?? deps.now(),
          { revision: result.revision },
        )
        const mapResult = deps.mapRepository.applyLivePlayUpdate({
          slug: result.mapSlug,
          expectedRevision: currentRevision,
          nextMap: persisted,
        })
        if (mapResult === 'stale') {
          throw new LivePlaySheetCommandUseCaseError(409, `Map ${result.mapSlug} changed before the live-play command could be persisted`)
        }

        if (nextSheet) {
          const sheetResult = deps.sheetRepository.applyLivePlayUpdate({
            kind: nextMap.sheet.kind,
            slug: nextMap.sheet.slug,
            expectedRevision: nextMap.sheet.revision,
            nextSheet,
          })
          if (sheetResult === 'stale') {
            throw new LivePlaySheetCommandUseCaseError(409, `Sheet ${nextMap.sheet.kind}/${nextMap.sheet.slug} changed before the live-play command could be persisted`)
          }
        }
        for (const write of nextMap.additionalSheetWrites ?? []) {
          const result = deps.sheetRepository.applyLivePlayUpdate({
            kind: write.sheet.kind,
            slug: write.sheet.slug,
            expectedRevision: write.sheet.revision,
            nextSheet: write.nextSheet,
          })
          if (result === 'stale') {
            throw new LivePlaySheetCommandUseCaseError(409, `Sheet ${write.sheet.kind}/${write.sheet.slug} changed before the derived sheet consequence could be persisted`)
          }
        }

        const authoritativeSheet = deps.sheetRepository.getByRef(nextMap.sheet.kind, nextMap.sheet.slug)
        if (!authoritativeSheet) {
          throw new LivePlaySheetCommandUseCaseError(404, `Sheet ${nextMap.sheet.kind}/${nextMap.sheet.slug} not found after live-play command`)
        }
        const sheetUpdate = nextSheet ? sheetUpdateFromPersisted(authoritativeSheet) : undefined
        const additionalSheetUpdates = (nextMap.additionalSheetWrites ?? []).map((write) => {
          const stored = deps.sheetRepository.getByRef(write.sheet.kind, write.sheet.slug)
          if (!stored) throw new LivePlaySheetCommandUseCaseError(404, `Sheet ${write.sheet.kind}/${write.sheet.slug} not found after a derived sheet consequence`)
          return sheetUpdateFromPersisted(stored)
        })
        recordRealtimeEvents(livePlaySheetUpdateRealtimeAppendInputs({
          command,
          updates: [...(sheetUpdate ? [sheetUpdate] : []), ...additionalSheetUpdates],
          clientId: actor.clientId,
        }))
        saveOpResult()

        const authoritativeMap = deps.mapRepository.getBySlug(result.mapSlug)
        if (!authoritativeMap) throw new LivePlaySheetCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after live-play command`)
        const authoritativePlacement = authoritativeMap.placements.find((candidate) => candidate.id === nextMap.placement.id)
        if (!authoritativePlacement) throw new LivePlaySheetCommandUseCaseError(404, `Placement ${nextMap.placement.id} not found after live-play command`)
        persistedContext = {
          ...nextMap,
          map: authoritativeMap,
          placement: authoritativePlacement,
          sheet: authoritativeSheet,
          ...(sheetUpdate ? { sheetUpdate } : {}),
          ...(additionalSheetUpdates.length ? { additionalSheetUpdates } : {}),
        }
      })
    },
  })

  const acceptedResult = acceptedResultFromCommandResult(result)
  const responseContext = persistedContext
    ?? (acceptedResult
      ? await currentContextForAcceptedResult(acceptedResult, input.role, input.playerProfile, deps)
      : null)
  return responseFromContext(result, responseContext, input.role, input.playerProfile)
}
