import { createHash, randomBytes } from 'node:crypto'
import itemsJson from '~~/data/reference/items.json'
import type { AuthRole } from '#shared/auth'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  ENCOUNTER_SETTLEMENT_COMMIT_COMMAND_SCHEMA_VERSION,
  type EncounterSettlementCommitCommand,
} from '#shared/encounterSettlement/atomicCommit'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
  type EncounterSettlementAllocation,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementDocument,
  type EncounterSettlementParticipant,
  type EncounterSettlementRewardLine,
} from '#shared/encounterSettlement/document'
import {
  FINISH_ENCOUNTER_VIEW_SCHEMA_VERSION,
  type FinishEncounterAcceptedSummary,
  type FinishEncounterCleanupView,
  type FinishEncounterConsequenceView,
  type FinishEncounterContinuationView,
  type FinishEncounterGateView,
  type FinishEncounterOutstandingWorkView,
  type FinishEncounterOutcomeView,
  type FinishEncounterRewardView,
  type FinishEncounterView,
} from '#shared/encounterSettlement/finish'
import { PENDING_MOVE_RESOLUTION_TERMINAL_STATUSES } from '#shared/moveAutomation/pendingResolution'
import { LIVE_PLAY_COMMAND_TYPES, LIVE_PLAY_PATCH_TYPES, type LivePlayCommandAccepted } from '#shared/livePlayCommands'
import type { ItemInventorySection } from '#shared/itemAutomation/inventory'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { EncounterDocument } from '#shared/encounterDocuments/model'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { SheetKind, TabletopMap } from '~/types/map'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import { computeMaxHp, resolveStats } from '~/utils/sheets/pokemonDerived'
import { computeTrainerMaxHp } from '~/utils/sheets/trainerDerived'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { createSqliteEncounterDocumentRepository } from '../storage/encounterDocumentRepository'
import {
  createSqliteEncounterSettlementRepository,
  type EncounterSettlementRepository,
} from '../storage/encounterSettlementRepository'
import { createSqliteGroupInventoryRepository } from '../storage/groupInventoryRepository'
import { createSqliteItemOperationRepository } from '../storage/itemOperationRepository'
import { createSqliteMapRepository } from '../storage/mapRepository'
import { createSqlitePendingMoveResolutionRepository } from '../storage/pendingMoveResolutionRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import { createSqliteLivePlayOpRepository, type SqliteLivePlayOpRecord } from '../storage/opRepository'
import { createSqliteTrainerSpeciesAcquisitionSourceOperationRepository } from '../storage/trainerSpeciesAcquisitionSourceOperationRepository'
import { listPlayerProfiles } from '../utils/playerProfileStorage'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  buildEncounterSettlementConsequenceSnapshot,
  EncounterSettlementConsequenceSnapshotError,
  ENCOUNTER_SETTLEMENT_SNAPSHOT_COVERAGE_DOMAINS,
  type EncounterSettlementConsequenceAuthoritySnapshot,
  type EncounterSettlementPersistentConsequenceFact,
  type EncounterSettlementTemporaryCleanupFact,
} from '../domain/encounterSettlement/consequenceSnapshot'
import {
  evaluateEncounterSettlementEligibility,
  EncounterSettlementEligibilityError,
  type EncounterSettlementBlockingFact,
  type EncounterSettlementEligibilityAuthoritySnapshot,
} from '../domain/encounterSettlement/eligibility'
import {
  planEncounterSettlementBatchExperience,
  EncounterSettlementExperienceAllocationError,
  type EncounterSettlementBatchExperiencePlan,
  type EncounterSettlementExperienceDeclaration,
} from '../domain/encounterSettlement/experienceAllocation'
import {
  encounterSettlementSerializedRewardInstanceId,
  EncounterSettlementLootAllocationError,
  planEncounterSettlementLootAllocation,
  type EncounterSettlementLootAllocationPlan,
  type EncounterSettlementLootContainerAuthority,
  type EncounterSettlementLootDeclaration,
} from '../domain/encounterSettlement/lootAllocation'
import {
  EncounterSettlementCaptureError,
  planEncounterSettlementCaptures,
  type AcceptedEncounterSettlementCaptureRecordV1,
  type EncounterSettlementCaptureDeclaration,
  type EncounterSettlementCapturePlan,
} from '../domain/encounterSettlement/captureSettlement'
import {
  EncounterSettlementOutcomeError,
  planEncounterSettlementOutcomes,
  type EncounterSettlementOutcomeDeclaration,
  type EncounterSettlementOutcomePlan,
} from '../domain/encounterSettlement/outcomeSettlement'
import {
  ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS,
  EncounterSettlementCleanupError,
  planEncounterSettlementTemporaryCleanup,
  type EncounterSettlementCleanupPlan,
} from '../domain/encounterSettlement/temporaryCleanup'
import {
  EncounterSettlementAtomicCommitError,
  planEncounterSettlementAtomicCommit,
  type EncounterSettlementAtomicAuthoritySnapshot,
  type EncounterSettlementAtomicCommitPlan,
} from '../domain/encounterSettlement/atomicCommit'
import {
  EncounterStateMigrationConflictError,
  materializeMapGlobalFieldZones,
} from '../domain/moveAutomation/fieldMapState'
import {
  equipmentDefinitionFor,
  equipmentDefinitionSha256,
} from '../domain/itemAutomation/equipmentDefinitionRegistry'

export class PrepareFinishEncounterUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

const isSettlementPlanningError = (error: unknown): boolean => (
  error instanceof EncounterSettlementConsequenceSnapshotError
  || error instanceof EncounterSettlementEligibilityError
  || error instanceof EncounterSettlementExperienceAllocationError
  || error instanceof EncounterSettlementLootAllocationError
  || error instanceof EncounterSettlementCaptureError
  || error instanceof EncounterSettlementOutcomeError
  || error instanceof EncounterSettlementCleanupError
  || error instanceof EncounterSettlementAtomicCommitError
  || error instanceof EncounterStateMigrationConflictError
)
const mapSettlementPlanningError = (error: unknown): never => {
  if (error instanceof PrepareFinishEncounterUseCaseError) throw error
  if (isSettlementPlanningError(error)) {
    throw new PrepareFinishEncounterUseCaseError(409, 'Encounter authority changed. Refresh and explicitly review the current settlement.')
  }
  throw error
}

interface CurrentSheet {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly updatedAt: number
  readonly document: CharacterSheet | TrainerSheet
}

interface CaptureAuthorityBundle {
  readonly records: readonly AcceptedEncounterSettlementCaptureRecordV1[]
  readonly declarations: readonly EncounterSettlementCaptureDeclaration[]
  readonly profiles: readonly {
    readonly profileId: string
    readonly revision: number
    readonly definitionSha256: string
    readonly profile: PlayerProfile
  }[]
  readonly blockingFacts: readonly EncounterSettlementBlockingFact[]
  readonly rewardLines: readonly EncounterSettlementRewardLine[]
}

interface FinishAuthorityRead {
  readonly encounter: EncounterDocument
  readonly map: TabletopMap
  readonly campaignMinute: number
  readonly sheets: readonly CurrentSheet[]
  readonly participants: readonly EncounterSettlementParticipant[]
  readonly participantLabels: ReadonlyMap<string, string>
  readonly blockingFacts: readonly EncounterSettlementBlockingFact[]
  readonly activeReservationOperationIds: readonly string[]
  readonly capture: CaptureAuthorityBundle
  readonly group: { readonly slug: string, readonly revision: number, readonly document: GroupInventoryDocument } | null
  /** Exact internal link capability permits source-bound Battle stakes to close with the Contest. */
  readonly autoResolveLinkedBattleStakes: boolean
}

export interface PreparedFinishEncounter {
  readonly view: FinishEncounterView
  readonly plan: EncounterSettlementAtomicCommitPlan | null
  readonly authority: EncounterSettlementAtomicAuthoritySnapshot | null
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const COMMIT_OPERATION = /^settlement-commit:v1:(\d{13}):[a-f0-9]{32}$/
const hashJson = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const deterministicId = (prefix: string, ...parts: readonly string[]): string => {
  const hash = createHash('sha256').update(prefix)
  for (const part of parts) hash.update('\u0000').update(part)
  return `${prefix}${hash.digest('hex')}`
}
const asRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
)
const revisionOf = (value: unknown): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
const committedAtFromOperationId = (operationId: string): number | null => {
  const match = COMMIT_OPERATION.exec(operationId)
  if (!match) return null
  const value = Number(match[1])
  return Number.isSafeInteger(value) ? value : null
}
const createCommitOperationId = (now: number): string => (
  `settlement-commit:v1:${String(now).padStart(13, '0')}:${randomBytes(16).toString('hex')}`
)
const settlementIdFor = (encounterId: string): string => deterministicId('encounter-settlement:v1:', encounterId)
const rewardPackageIdFor = (encounterId: string): string => deterministicId('settlement-reward-package:v1:', encounterId)
const authority = (kind: EncounterSettlementAuthorityRef['kind'], id: string, revision: number): EncounterSettlementAuthorityRef => (
  Object.freeze({ kind, id, revision })
)

const currentSheets = (database: RotomDatabase): readonly CurrentSheet[] => (
  createSqliteSheetRepository<CharacterSheet | TrainerSheet>(database).list().map((row): CurrentSheet => ({
    kind: row.kind,
    slug: row.slug,
    revision: row.revision,
    updatedAt: row.updatedAt,
    document: row.document,
  }))
)
const sheetKey = (kind: SheetKind, slug: string): string => `${kind}\u0000${slug}`
const participantName = (sheet: CurrentSheet): string => {
  if (sheet.kind === 'trainer') return (sheet.document as TrainerSheet).name?.trim() || 'Trainer'
  const pokemon = sheet.document as CharacterSheet
  return pokemon.nickname?.trim() || pokemon.species?.trim() || 'Pokémon'
}
const participantHp = (sheet: CurrentSheet): number => {
  if (sheet.kind === 'trainer') {
    const trainer = sheet.document as TrainerSheet
    const value = trainer.currentHp
    return Number.isSafeInteger(value) && Number(value) >= 0
      ? Number(value)
      : Math.max(1, computeTrainerMaxHp(trainer))
  }
  const pokemon = sheet.document as CharacterSheet
  const value = pokemon.combat?.currentHp
  if (Number.isSafeInteger(value) && Number(value) >= 0) return Number(value)
  const hpStat = resolveStats(pokemon).find(stat => stat.key === 'hp')?.total ?? 0
  return Math.max(1, computeMaxHp(pokemon, hpStat))
}
const participantInjuries = (sheet: CurrentSheet): number => {
  const value = sheet.kind === 'trainer'
    ? (sheet.document as TrainerSheet).currentInjuries
    : (sheet.document as CharacterSheet).combat?.injuries
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
}
const participantConditions = (sheet: CurrentSheet): readonly string[] => {
  const values = sheet.kind === 'trainer'
    ? (sheet.document as TrainerSheet).conditions
    : (sheet.document as CharacterSheet).combat?.conditions
  return Object.freeze([...(Array.isArray(values) ? values : [])]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map(value => value.trim())
    .filter((value, index, rows) => rows.indexOf(value) === index))
}

const buildParticipants = (input: {
  readonly encounter: EncounterDocument
  readonly map: TabletopMap
  readonly sheets: readonly CurrentSheet[]
}): { readonly participants: readonly EncounterSettlementParticipant[], readonly labels: ReadonlyMap<string, string> } => {
  const bySheet = new Map(input.sheets.map(sheet => [sheetKey(sheet.kind, sheet.slug), sheet]))
  const trainerPlacements = input.map.placements.filter(row => row.sheetKind === 'trainer')
  const trainersBySlug = new Map(input.sheets.filter(row => row.kind === 'trainer')
    .map(row => [row.slug, row.document as TrainerSheet]))
  const ownerFor = (sheetSlug: string, sideId: string | null): string | null => {
    const matches = trainerPlacements.filter((placement) => {
      if ((placement.sideId ?? null) !== sideId) return false
      const trainer = trainersBySlug.get(placement.sheetSlug)
      return [...(trainer?.currentTeam ?? []), ...(trainer?.boxedPokemon ?? [])].includes(sheetSlug)
    })
    return matches.length === 1 ? matches[0]!.id : null
  }
  const labels = new Map<string, string>()
  const participants = input.map.placements.map((placement): EncounterSettlementParticipant => {
    const sheet = bySheet.get(sheetKey(placement.sheetKind, placement.sheetSlug))
    if (!sheet) {
      throw new PrepareFinishEncounterUseCaseError(409, 'Every encounter participant must retain one exact current backing sheet before settlement.')
    }
    labels.set(placement.id, participantName(sheet))
    return Object.freeze({
      participantId: placement.id,
      sourceAuthority: authority('map', input.map.slug, revisionOf(input.map.revision)),
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      sheetRevision: sheet.revision,
      sideId: placement.sideId ?? null,
      ownerParticipantId: placement.sheetKind === 'pokemon'
        ? ownerFor(placement.sheetSlug, placement.sideId ?? null)
        : null,
      settlementRole: 'combatant',
      disposition: participantHp(sheet) === 0 ? 'defeated' : 'active',
    })
  })
  return { participants: Object.freeze(participants), labels }
}

const captureFromResult = (result: LivePlayCommandAccepted): Record<string, unknown> | null => {
  for (const patch of result.patches) {
    if (patch.type !== LIVE_PLAY_PATCH_TYPES.MAP_METADATA) continue
    const payload = asRecord(patch.payload)
    const capture = asRecord(payload?.capture)
    if (asRecord(capture?.result)) return capture
  }
  return null
}
const acceptedResult = (record: SqliteLivePlayOpRecord): LivePlayCommandAccepted | null => (
  record.result.ok ? record.result : null
)
const captureTrainerSlug = (result: LivePlayCommandAccepted): string | null => {
  for (const patch of result.patches) {
    for (const scope of patch.scopes) {
      if (scope.kind === 'sheet' && scope.sheetKind === 'trainer'
        && (scope.field === 'inventory' || scope.field === 'pokemonRoster')) return scope.sheetSlug
    }
  }
  return null
}
const profileDefinitionSha256 = (profile: PlayerProfile): string => hashJson(profile)

const discoverCaptureAuthority = (input: {
  readonly database: RotomDatabase
  readonly encounter: EncounterDocument
  readonly map: TabletopMap
  readonly sheets: readonly CurrentSheet[]
  readonly campaignMinute: number
  readonly profiles: readonly PlayerProfile[]
}): CaptureAuthorityBundle => {
  const operationRepository = createSqliteLivePlayOpRepository({ database: input.database })
  const operationCount = operationRepository.countStoredOpsForMap(input.map.slug, input.encounter.createdAt)
  const operations = operationRepository.listStoredOpsForMap(input.map.slug, 10_000)
    .filter(row => row.createdAt >= input.encounter.createdAt)
  const profiles = input.profiles
  const sheetMap = new Map(input.sheets.map(row => [sheetKey(row.kind, row.slug), row]))
  const acquisitionRepository = createSqliteTrainerSpeciesAcquisitionSourceOperationRepository(input.database)
  const records: AcceptedEncounterSettlementCaptureRecordV1[] = []
  const declarations: EncounterSettlementCaptureDeclaration[] = []
  const profileAuthorities = new Map<string, CaptureAuthorityBundle['profiles'][number]>()
  const rewardLines: EncounterSettlementRewardLine[] = []
  const blockingFacts: EncounterSettlementBlockingFact[] = []
  if (operationCount > 10_000) blockingFacts.push(Object.freeze({
    factId: deterministicId('settlement-capture-source-limit:v1:', input.map.slug, String(operationCount)),
    kind: 'unsupported-authority',
    audience: 'gm',
    authorityRefs: Object.freeze([authority('map', input.map.slug, revisionOf(input.map.revision))]),
    participantIds: Object.freeze([]),
    resolutionKinds: Object.freeze(['correct'] as const),
  }))

  for (const operation of operations) {
    const command = asRecord(operation.command)
    const result = acceptedResult(operation)
    if (command?.type !== LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL || !result) continue
    const capture = captureFromResult(result)
    const captureResult = asRecord(capture?.result)
    if (!capture || captureResult?.success !== true) continue
    const pokemonSlug = typeof capture.targetSlug === 'string' ? capture.targetSlug : null
    const ball = typeof capture.pokeballName === 'string' ? capture.pokeballName : null
    const trainerSlug = captureTrainerSlug(result)
    const trainer = trainerSlug ? sheetMap.get(sheetKey('trainer', trainerSlug)) : null
    const profileCandidates = trainerSlug
      ? profiles.filter(profile => profile.linkedCharacters.some(ref => ref.sheetKind === 'trainer' && ref.sheetSlug === trainerSlug))
      : []
    const matches: {
      readonly profile: PlayerProfile
      readonly acquisition: ReturnType<typeof acquisitionRepository.listByTrainer>[number]
      readonly pokemon: CurrentSheet
      readonly rosterDestination: 'team' | 'box'
    }[] = []
    let linkedEvidenceCount = 0
    let linkedAuthorityIncomplete = false
    if (trainer && pokemonSlug && ball && profileCandidates.length > 0) {
      const trainerSheet = trainer.document as TrainerSheet
      const acquisitions = acquisitionRepository.listByTrainer(trainer.slug, 100)
        .filter(row => row.evidence.sourceKind === 'capture')
      for (const profile of profileCandidates) {
        for (const acquisition of acquisitions) {
          const acquiredPokemonSlug = acquisition.evidence.pokemonSheetSlug
          if (!acquiredPokemonSlug) continue
          const sourceDefinition = {
            schemaVersion: 1,
            authorityKind: 'live-play-capture',
            livePlayOperationId: operation.opId,
            actorProfileId: profile.id,
            mapSlug: input.map.slug,
            acceptedMapRevision: result.revision,
            trainerSheetSlug: trainer.slug,
            pokemonSheetSlug: acquiredPokemonSlug,
            pokemonSheetRevision: acquisition.evidence.pokemonSheetRevision,
            captureTargetSheetSlug: pokemonSlug,
            captureSucceeded: true,
          }
          if (hashJson(sourceDefinition) !== acquisition.evidence.sourceAuthorityDefinitionSha256) continue
          linkedEvidenceCount += 1
          const pokemon = sheetMap.get(sheetKey('pokemon', acquiredPokemonSlug))
          const rosterDestination = (trainerSheet.currentTeam ?? []).includes(acquiredPokemonSlug) ? 'team' as const
            : (trainerSheet.boxedPokemon ?? []).includes(acquiredPokemonSlug) ? 'box' as const : null
          if (!pokemon || !rosterDestination) {
            linkedAuthorityIncomplete = true
            continue
          }
          matches.push({ profile, acquisition, pokemon, rosterDestination })
        }
      }
    }
    const captureAuthority = authority('capture-operation', operation.opId, result.revision)
    const profileIds = new Set(matches.map(row => row.profile.id))
    const valid = trainer && ball && matches.length > 0 && profileIds.size === 1
      && !linkedAuthorityIncomplete && matches.length === linkedEvidenceCount
      && matches.some(row => row.pokemon.slug === pokemonSlug)
      && matches.every(row => (row.pokemon.document as CharacterSheet).caughtBall === ball
        && row.acquisition.evidence.campaignMinute <= input.campaignMinute)
    if (!trainer || !ball || !valid) {
      blockingFacts.push(Object.freeze({
        factId: deterministicId('settlement-capture-blocker:v1:', operation.opId),
        kind: 'unsupported-authority',
        audience: 'gm',
        authorityRefs: Object.freeze([captureAuthority]),
        participantIds: Object.freeze([]),
        resolutionKinds: Object.freeze(['correct', 'exclude'] as const),
      }))
      continue
    }
    for (const matched of matches) {
      const rewardId = deterministicId(
        'settlement-capture-reward:v1:', input.encounter.encounterId, operation.opId, matched.pokemon.slug,
      )
      const destination = { kind: 'profile' as const, id: matched.profile.id, revision: 0 }
      records.push(Object.freeze({
        schemaVersion: 1,
        captureOperationId: operation.opId,
        sourceAuthority: captureAuthority,
        acceptedResultSha256: hashJson(result),
        provenanceDefinitionSha256: matched.acquisition.evidence.sourceAuthorityDefinitionSha256,
        actorProfileId: matched.profile.id,
        trainerSheetSlug: trainer.slug,
        trainerRevisionAfterCapture: matched.acquisition.evidence.trainerRevisionBeforeReward,
        pokemonSheetSlug: matched.pokemon.slug,
        pokemonRevisionAfterCapture: matched.acquisition.evidence.pokemonSheetRevision!,
        rosterDestinationAfterCapture: matched.rosterDestination,
        caughtBall: ball,
        namingRequirement: 'optional',
        acceptedAtCampaignMinute: matched.acquisition.evidence.campaignMinute,
      }))
      declarations.push(Object.freeze({
        rewardId,
        destination,
        ownerTrainerSlug: trainer.slug,
        rosterDestination: matched.rosterDestination,
        nicknameDecision: 'keep',
        nickname: null,
        permission: {
          status: 'allowed' as const,
          authority: authority('sheet', trainer.slug, trainer.revision),
          reasonId: null,
        },
      }))
      profileAuthorities.set(matched.profile.id, Object.freeze({
        profileId: matched.profile.id,
        revision: 0,
        definitionSha256: profileDefinitionSha256(matched.profile),
        profile: matched.profile,
      }))
      rewardLines.push(Object.freeze({
        rewardId,
        visibility: 'participant-owner',
        sourceAuthority: captureAuthority,
        disposition: 'pending',
        payload: {
          kind: 'capture' as const,
          captureOperationId: operation.opId,
          pokemonSheetSlug: matched.pokemon.slug,
        },
      }))
    }
  }
  return Object.freeze({
    records: Object.freeze(records),
    declarations: Object.freeze(declarations),
    profiles: Object.freeze([...profileAuthorities.values()]),
    blockingFacts: Object.freeze(blockingFacts),
    rewardLines: Object.freeze(rewardLines),
  })
}

const buildBlockingFacts = (input: {
  readonly database: RotomDatabase
  readonly map: TabletopMap
  readonly participants: readonly EncounterSettlementParticipant[]
  readonly captureFacts: readonly EncounterSettlementBlockingFact[]
}): { readonly facts: readonly EncounterSettlementBlockingFact[], readonly reservationIds: readonly string[] } => {
  const mapAuthority = authority('map', input.map.slug, revisionOf(input.map.revision))
  const facts: EncounterSettlementBlockingFact[] = [...input.captureFacts]
  const participantIds = new Set(input.participants.map(row => row.participantId))
  for (const row of createSqlitePendingMoveResolutionRepository(input.database).listByMap(input.map.slug)) {
    if (PENDING_MOVE_RESOLUTION_TERMINAL_STATUSES.includes(row.status as never)) continue
    const reaction = row.resolution.outstandingWindows.some(window => window.kind === 'reaction')
    facts.push(Object.freeze({
      factId: row.resolutionId,
      kind: reaction ? 'pending-reaction' : 'pending-resolution',
      audience: 'public',
      authorityRefs: Object.freeze([mapAuthority]),
      participantIds: Object.freeze(participantIds.has(row.resolution.actorPlacementId)
        ? [row.resolution.actorPlacementId]
        : []),
      resolutionKinds: Object.freeze(reaction
        ? ['choose'] as const
        : ['retry-exact', 'choose'] as const),
    }))
  }
  const pendingItems = createSqliteItemOperationRepository({ database: input.database })
    .listForMap(input.map.slug, 500)
    .filter(row => row.status === 'pending')
  for (const row of pendingItems) facts.push(Object.freeze({
    factId: row.operationId,
    kind: 'pending-resolution',
    audience: 'gm',
    authorityRefs: Object.freeze([mapAuthority]),
    participantIds: Object.freeze([]),
    resolutionKinds: Object.freeze(['retry-exact', 'choose'] as const),
  }))
  const reservationIds = pendingItems.flatMap(row => row.pendingDecision?.reservation ? [row.operationId] : [])
  const unique = new Map(facts.map(fact => [fact.factId, fact]))
  return { facts: Object.freeze([...unique.values()]), reservationIds: Object.freeze(reservationIds) }
}

const readAuthority = (
  database: RotomDatabase,
  encounterId: string,
  profiles: readonly PlayerProfile[] = listPlayerProfiles(),
  coordinatedBattleContestId: string | null = null,
): FinishAuthorityRead => {
  if (!ID.test(encounterId)) throw new PrepareFinishEncounterUseCaseError(400, 'Encounter identity is invalid.')
  const encounters = createSqliteEncounterDocumentRepository(database)
  const encounter = encounters.get(encounterId) ?? encounters.findByMapSlug(encounterId)
  if (!encounter) throw new PrepareFinishEncounterUseCaseError(404, 'Finish Encounter requires an initialized Encounter Document.')
  if (encounter.battleContest && encounter.battleContest.link.contestId !== coordinatedBattleContestId) {
    throw new PrepareFinishEncounterUseCaseError(409, 'A linked Battle Contest encounter settles only through the combined Battle Contest coordinator.')
  }
  if (!encounter.battleContest && coordinatedBattleContestId !== null) {
    throw new PrepareFinishEncounterUseCaseError(409, 'Combined Battle Contest settlement requires the exact linked Encounter authority.')
  }
  if (!['active', 'paused', 'completed'].includes(encounter.lifecycle)) {
    throw new PrepareFinishEncounterUseCaseError(409, 'Only an active or paused encounter can be settled.')
  }
  const map = createSqliteMapRepository<TabletopMap>(database).getBySlug(encounter.linkedMapSlug)
  if (!map) throw new PrepareFinishEncounterUseCaseError(404, 'The linked encounter battlefield was not found.')
  const sheets = currentSheets(database)
  const built = buildParticipants({ encounter, map, sheets })
  const campaignMinute = createSqliteCampaignClockRepository(database).get().campaignMinute
  const capture = discoverCaptureAuthority({ database, encounter, map, sheets, campaignMinute, profiles })
  const participants = [...built.participants]
  const participantLabels = new Map(built.labels)
  for (const record of capture.records) {
    if (participants.some(row => row.sheetKind === 'pokemon' && row.sheetSlug === record.pokemonSheetSlug)) continue
    const sheet = sheets.find(row => row.kind === 'pokemon' && row.slug === record.pokemonSheetSlug)
    if (!sheet) continue
    const ownerPlacements = map.placements.filter(row => row.sheetKind === 'trainer' && row.sheetSlug === record.trainerSheetSlug)
    const participantId = deterministicId('settlement-captured-participant:v1:', record.captureOperationId)
    participants.push(Object.freeze({
      participantId,
      sourceAuthority: record.sourceAuthority,
      sheetKind: 'pokemon',
      sheetSlug: record.pokemonSheetSlug,
      sheetRevision: sheet.revision,
      sideId: ownerPlacements.length === 1 ? ownerPlacements[0]!.sideId ?? null : null,
      ownerParticipantId: ownerPlacements.length === 1 ? ownerPlacements[0]!.id : null,
      settlementRole: 'combatant',
      disposition: 'captured',
    }))
    participantLabels.set(participantId, participantName(sheet))
  }
  const frozenParticipants = Object.freeze(participants)
  const blockers = buildBlockingFacts({
    database, map, participants: frozenParticipants, captureFacts: capture.blockingFacts,
  })
  const group = createSqliteGroupInventoryRepository(database).get('main')
  return Object.freeze({
    encounter,
    map,
    campaignMinute,
    sheets,
    participants: frozenParticipants,
    participantLabels,
    blockingFacts: blockers.facts,
    activeReservationOperationIds: blockers.reservationIds,
    capture,
    group: group ? { slug: group.slug, revision: group.revision, document: group.document } : null,
    autoResolveLinkedBattleStakes: encounter.battleContest !== null && coordinatedBattleContestId !== null,
  })
}

const factId = (prefix: string, ...parts: readonly string[]): string => deterministicId(`settlement-${prefix}:v1:`, ...parts)
const buildSnapshotAuthority = (settlement: EncounterSettlementDocument, read: FinishAuthorityRead): EncounterSettlementConsequenceAuthoritySnapshot => {
  const mapAuthority = authority('map', read.map.slug, revisionOf(read.map.revision))
  const sheetMap = new Map(read.sheets.map(row => [sheetKey(row.kind, row.slug), row]))
  const consequences: EncounterSettlementPersistentConsequenceFact[] = []
  for (const participant of settlement.participants) {
    const sheet = sheetMap.get(sheetKey(participant.sheetKind, participant.sheetSlug))!
    const conditions = participantConditions(sheet)
    const equipmentHash = hashJson((sheet.document as CharacterSheet | TrainerSheet).equipmentState ?? null)
    consequences.push(
      {
        sourceFactId: factId('hp', participant.participantId), participantId: participant.participantId,
        kind: 'hp', authority: mapAuthority, field: 'current-hp', behavior: 'preserve',
        snapshot: { kind: 'integer', before: participantHp(sheet), after: participantHp(sheet) }, decision: null,
      },
      {
        sourceFactId: factId('injuries', participant.participantId), participantId: participant.participantId,
        kind: 'injuries', authority: mapAuthority, field: 'injuries', behavior: 'preserve',
        snapshot: { kind: 'integer', before: participantInjuries(sheet), after: participantInjuries(sheet) }, decision: null,
      },
      {
        sourceFactId: factId('conditions', participant.participantId), participantId: participant.participantId,
        kind: 'conditions', authority: mapAuthority, field: 'conditions', behavior: 'preserve',
        snapshot: { kind: 'text-list', before: conditions, after: conditions }, decision: null,
      },
      {
        sourceFactId: factId('equipment', participant.participantId), participantId: participant.participantId,
        kind: 'equipment', authority: mapAuthority, field: 'equipment-state', behavior: 'preserve',
        snapshot: {
          kind: 'reference',
          before: `equipment:v1:${equipmentHash.slice(0, 32)}`,
          after: `equipment:v1:${equipmentHash.slice(0, 32)}`,
        },
        decision: null,
      },
    )
  }
  const state = materializeMapGlobalFieldZones(read.map)
  const cleanup: EncounterSettlementTemporaryCleanupFact[] = []
  const addCleanup = (
    kind: EncounterSettlementTemporaryCleanupFact['kind'],
    behavior: EncounterSettlementTemporaryCleanupFact['behavior'],
    sourceIds: readonly string[],
    participantIds: readonly string[] = [],
  ): void => {
    if (sourceIds.length === 0) return
    cleanup.push({
      sourceFactId: factId('cleanup', kind, behavior, ...sourceIds),
      kind, authority: mapAuthority, participantIds, sourceIds, behavior, decision: null,
    })
  }
  const participantSheetKeys = new Set(settlement.participants.map(row => sheetKey(row.sheetKind, row.sheetSlug)))
  const participantSheets = read.sheets.filter(row => participantSheetKeys.has(sheetKey(row.kind, row.slug)))
  addCleanup('combat-stages', 'reset', participantSheets.map(row => `sheet:${row.kind}:${row.slug}`), settlement.participants.map(row => row.participantId))
  const expiringEffects = state.effects.filter(row => ['turns', 'rounds', 'encounter'].includes(row.duration.kind)).map(row => row.id)
  const preservedEffects = state.effects.filter(row => !expiringEffects.includes(row.id)).map(row => row.id)
  const expiringZones = state.zones.filter(row => ['turns', 'rounds', 'encounter'].includes(row.duration.kind)).map(row => row.id)
  const preservedZones = state.zones.filter(row => !expiringZones.includes(row.id)).map(row => row.id)
  addCleanup('duration-effects', 'expire', [...expiringEffects, ...expiringZones])
  addCleanup('duration-effects', 'preserve', [...preservedEffects, ...preservedZones])
  addCleanup('ground-items', 'preserve', state.groundItems.map(row => row.id))
  addCleanup('encounter-resources', 'reset', [ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.encounterResources], settlement.participants.map(row => row.participantId))
  addCleanup('reservations', 'expire', read.activeReservationOperationIds)
  if ((state.itemExploration?.repelPositioning ?? []).length > 0) {
    addCleanup('encounter-items', 'expire', [ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.encounterItems])
  }
  if (read.map.initiative !== undefined) {
    addCleanup('initiative', 'reset', [ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.initiative], settlement.participants.map(row => row.participantId))
  }
  return {
    completeness: 'authoritative-current',
    coverage: ENCOUNTER_SETTLEMENT_SNAPSHOT_COVERAGE_DOMAINS.map(domain => ({
      domain,
      disposition: 'complete',
      authorityRefs: [mapAuthority],
    })),
    persistentConsequences: consequences,
    temporaryCleanup: cleanup,
  }
}

const refreshRewardLines = (
  existing: readonly EncounterSettlementRewardLine[],
  read: FinishAuthorityRead,
): readonly EncounterSettlementRewardLine[] => {
  const retained = existing
    .map((line): EncounterSettlementRewardLine => line.sourceAuthority.kind === 'encounter-document'
      && line.sourceAuthority.id === read.encounter.encounterId
      ? { ...line, sourceAuthority: authority('encounter-document', read.encounter.encounterId, read.encounter.revision) }
      : line)
  const known = new Set(retained.map(row => row.rewardId))
  return Object.freeze([...retained, ...read.capture.rewardLines.filter(row => !known.has(row.rewardId))]
    .sort((left, right) => left.rewardId.localeCompare(right.rewardId)))
}

const persistFreshDraft = (
  repository: EncounterSettlementRepository,
  existing: EncounterSettlementDocument | null,
  read: FinishAuthorityRead,
): EncounterSettlementDocument => {
  if (existing && existing.completion.state !== 'open') return existing
  if (existing && existing.encounter.campaignMinute !== read.campaignMinute) return existing
  const checkpoint = {
    encounterId: read.encounter.encounterId,
    encounterRevision: read.encounter.revision,
    linkedMapSlug: read.map.slug,
    linkedMapRevision: revisionOf(read.map.revision),
    campaignMinute: read.campaignMinute,
  }
  const initial = existing ?? createEncounterSettlementDocument({
    settlementId: settlementIdFor(read.encounter.encounterId),
    rewardPackageId: rewardPackageIdFor(read.encounter.encounterId),
    encounter: checkpoint,
  })
  const rewardLines = refreshRewardLines(initial.rewardPackage.lines, read)
  let draft = parseEncounterSettlementDocument({
    ...initial,
    encounter: checkpoint,
    participants: read.participants,
    status: 'draft',
    unresolvedGates: [],
    rewardPackage: {
      ...initial.rewardPackage,
      status: rewardLines.length > 0 ? 'ready' : 'allocated',
      lines: rewardLines,
    },
    updatedAtCampaignMinute: read.campaignMinute,
  })
  const snapshot = buildEncounterSettlementConsequenceSnapshot({
    settlement: draft,
    authority: buildSnapshotAuthority(draft, read),
  })
  draft = snapshot.document
  const eligibilityAuthority: EncounterSettlementEligibilityAuthoritySnapshot = {
    completeness: 'authoritative-current',
    encounter: checkpoint,
    participants: read.participants,
    blockingFacts: read.blockingFacts,
  }
  const eligibility = evaluateEncounterSettlementEligibility({ settlement: draft, authority: eligibilityAuthority })
  draft = parseEncounterSettlementDocument({
    ...draft,
    revision: existing?.revision ?? 0,
    status: eligibility.nextStatus,
    unresolvedGates: eligibility.unresolvedGates,
  })
  if (!existing) return repository.create(draft)
  if (stableJsonStringify(draft) === stableJsonStringify(existing)) return existing
  const successor = parseEncounterSettlementDocument({ ...draft, revision: existing.revision + 1 })
  return repository.replace({ expectedRevision: existing.revision, document: successor })
    ?? (() => { throw new PrepareFinishEncounterUseCaseError(409, 'Settlement authority changed while the current review was prepared.') })()
}

const allowedPermission = (read: FinishAuthorityRead) => ({
  status: 'allowed' as const,
  authority: authority('encounter-document', read.encounter.encounterId, read.encounter.revision),
  reasonId: null,
})
const existingAllocations = (settlement: EncounterSettlementDocument, rewardId: string): readonly EncounterSettlementAllocation[] => (
  settlement.allocations.filter(row => row.rewardId === rewardId && row.state !== 'excluded')
)
const experienceDeclarations = (
  settlement: EncounterSettlementDocument,
  read: FinishAuthorityRead,
): readonly EncounterSettlementExperienceDeclaration[] => {
  const pokemon = settlement.participants.filter(row => row.sheetKind === 'pokemon' && row.disposition !== 'excluded')
  return settlement.rewardPackage.lines.flatMap((line): readonly EncounterSettlementExperienceDeclaration[] => {
    if (line.payload.kind !== 'experience' || line.disposition === 'excluded') return []
    const allocation = existingAllocations(settlement, line.rewardId)[0]
    if (!allocation && pokemon.length !== 1) return []
    let recipients = pokemon
    if (allocation?.destination.kind === 'participant') {
      recipients = pokemon.filter(row => row.participantId === allocation.destination.id)
    }
    else if (allocation?.destination.kind === 'pokemon-sheet') {
      recipients = pokemon.filter(row => row.sheetSlug === allocation.destination.id)
    }
    else if (allocation?.destination.kind === 'side') {
      recipients = pokemon.filter(row => row.sideId === allocation.destination.id)
    }
    if (recipients.length === 0 || line.payload.amount < recipients.length) return []
    const destination = allocation?.destination ?? {
      kind: 'group' as const,
      id: read.encounter.encounterId,
      revision: read.encounter.revision,
    }
    return [{
      rewardId: line.rewardId,
      destination,
      method: 'fixed',
      recipients: recipients.map(row => ({ participantId: row.participantId, weight: null, amount: null })),
      permission: allowedPermission(read),
    }]
  })
}

const itemSection = (canonicalItemId: string): ItemInventorySection | null => {
  const record = (itemsJson as Record<string, { readonly categories?: readonly string[], readonly sections?: readonly string[] }>)[canonicalItemId]
  if (!record) return null
  const values = [...(record.categories ?? []), ...(record.sections ?? [])].map(value => value.toLocaleLowerCase('en-US'))
  if (values.some(value => /equipment|held item|weapon|accessory/.test(value))) return 'equipment'
  if (values.some(value => /medicine|medical/.test(value))) return 'medicalKit'
  if (values.some(value => /ball/.test(value))) return 'pokeBalls'
  if (values.some(value => /food|berry|refreshment/.test(value))) return 'foodStuff'
  if (values.some(value => /key item/.test(value))) return 'keyItems'
  return 'pokemonItems'
}
const itemCost = (canonicalItemId: string): number | undefined => {
  const record = (itemsJson as Record<string, { readonly costs?: readonly string[] }>)[canonicalItemId]
  const match = record?.costs?.find(value => /\d/.test(value))?.replace(/[^0-9]/g, '')
  const value = match ? Number(match) : 0
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}
const serializedRewardEntry = (settlementId: string, line: EncounterSettlementRewardLine): InventoryEntry | null => {
  if (line.payload.kind !== 'item') return null
  const definition = equipmentDefinitionFor(line.payload.canonicalItemId)
  const definitionSha = equipmentDefinitionSha256(line.payload.canonicalItemId)
  if (!definition || !definitionSha) return null
  return {
    name: line.payload.canonicalItemId,
    ...(itemCost(line.payload.canonicalItemId) ? { cost: itemCost(line.payload.canonicalItemId) } : {}),
    serializedEquipment: {
      schemaVersion: 1,
      instanceId: encounterSettlementSerializedRewardInstanceId(settlementId, line.rewardId),
      revision: 0,
      canonicalItemId: line.payload.canonicalItemId,
      canonicalRecordSha256: definition.canonicalRecordSha256,
      equipmentDefinitionSha256: definitionSha,
      configuration: null,
      activity: { status: 'active', reasons: [] },
      state: {},
    },
  }
}

const lootPlanning = (settlement: EncounterSettlementDocument, read: FinishAuthorityRead): {
  readonly declarations: readonly EncounterSettlementLootDeclaration[]
  readonly containers: readonly EncounterSettlementLootContainerAuthority[]
  readonly unresolvedCount: number
} => {
  const sheetMap = new Map(read.sheets.map(row => [sheetKey(row.kind, row.slug), row]))
  const declarations: EncounterSettlementLootDeclaration[] = []
  const containerMap = new Map<string, EncounterSettlementLootContainerAuthority>()
  let unresolvedCount = 0
  const defaultTrainer = settlement.participants.filter(row => row.sheetKind === 'trainer')
  for (const line of settlement.rewardPackage.lines) {
    if ((line.payload.kind !== 'money' && line.payload.kind !== 'item') || line.disposition === 'excluded') continue
    const allocations = existingAllocations(settlement, line.rewardId)
    const destinations = allocations.length > 0 ? allocations.map(row => ({ destination: row.destination, amount: row.amount }))
      : read.group ? [{ destination: { kind: 'group-inventory' as const, id: read.group.slug, revision: read.group.revision }, amount: line.payload.kind === 'money' ? line.payload.amount : line.payload.quantity }]
        : defaultTrainer.length === 1 ? [{
            destination: {
              kind: 'trainer-inventory' as const,
              id: defaultTrainer[0]!.sheetSlug,
              revision: defaultTrainer[0]!.sheetRevision,
            },
            amount: line.payload.kind === 'money' ? line.payload.amount : line.payload.quantity,
          }]
          : []
    if (destinations.length === 0) { unresolvedCount += 1; continue }
    for (const selected of destinations) {
      let container: EncounterSettlementLootContainerAuthority | null = null
      if (selected.destination.kind === 'group-inventory' && read.group?.slug === selected.destination.id) {
        container = { kind: 'group', slug: read.group.slug, revision: read.group.revision, document: read.group.document }
      }
      else if (selected.destination.kind === 'trainer-inventory') {
        const sheet = sheetMap.get(sheetKey('trainer', selected.destination.id))
        if (sheet) container = { kind: 'trainer', slug: sheet.slug, revision: sheet.revision, document: sheet.document as TrainerSheet }
      }
      if (!container || container.revision !== selected.destination.revision) { unresolvedCount += 1; continue }
      containerMap.set(`${container.kind}:${container.slug}`, container)
      const permission = allowedPermission(read)
      if (line.payload.kind === 'money') declarations.push({
        kind: 'money', rewardId: line.rewardId, destination: selected.destination,
        amount: selected.amount, permission,
      })
      else {
        const section = itemSection(line.payload.canonicalItemId)
        const entry = line.payload.serialized
          ? serializedRewardEntry(settlement.settlementId, line)
          : section && section !== 'equipment' ? {
              name: line.payload.canonicalItemId,
              qty: selected.amount,
              ...(itemCost(line.payload.canonicalItemId) ? { cost: itemCost(line.payload.canonicalItemId) } : {}),
            } : null
        if (!section || !entry || (line.payload.serialized && section !== 'equipment')) {
          unresolvedCount += 1
          continue
        }
        declarations.push({
          kind: 'item', rewardId: line.rewardId, destination: selected.destination,
          amount: selected.amount, section, definitionAuthority: line.payload.definitionAuthority,
          entry, permission,
        })
      }
    }
  }
  return { declarations, containers: Object.freeze([...containerMap.values()]), unresolvedCount }
}

const outcomeDeclarations = (
  encounter: EncounterDocument,
  autoResolveLinkedBattleStakes: boolean,
): readonly EncounterSettlementOutcomeDeclaration[] => {
  const declarations: EncounterSettlementOutcomeDeclaration[] = []
  for (const objective of encounter.objectives) {
    if (objective.status === 'completed' || objective.status === 'failed') declarations.push({
      kind: 'objective', subjectId: objective.objectiveId, status: objective.status,
    })
  }
  for (const clock of encounter.clocks) {
    if (clock.status === 'completed' || clock.progress === clock.maximum) declarations.push({
      kind: 'clock', subjectId: clock.clockId, status: 'completed', progress: clock.maximum,
    })
  }
  for (const phase of encounter.phases) {
    if (phase.status === 'completed') declarations.push({
      kind: 'phase', subjectId: phase.phaseId, status: 'completed', summary: phase.summary,
    })
  }
  if (autoResolveLinkedBattleStakes) for (const visibility of ['public', 'gm'] as const) {
    if (encounter.stakes[visibility] !== null) declarations.push({
      kind: 'stake',
      subjectId: visibility,
      result: 'realized',
      summary: 'Resolved by the linked source-bound Battle Contest ending.',
    })
  }
  return Object.freeze(declarations)
}

const buildComponents = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly read: FinishAuthorityRead
  readonly committedAt: number
}): {
  readonly experience: EncounterSettlementBatchExperiencePlan
  readonly loot: EncounterSettlementLootAllocationPlan
  readonly capture: EncounterSettlementCapturePlan
  readonly outcomes: EncounterSettlementOutcomePlan
  readonly cleanup: EncounterSettlementCleanupPlan
  readonly supplementalGates: readonly FinishEncounterGateView[]
} => {
  const pokemonSheets = input.read.sheets.filter(row => row.kind === 'pokemon').map(row => ({
    sheetSlug: row.slug, revision: row.revision, sheet: row.document as CharacterSheet,
  }))
  const experience = planEncounterSettlementBatchExperience({
    settlement: input.settlement,
    authority: {
      completeness: 'authoritative-current',
      pokemonSheets,
      declarations: experienceDeclarations(input.settlement, input.read),
    },
  })
  const lootInput = lootPlanning(input.settlement, input.read)
  const loot = planEncounterSettlementLootAllocation({
    settlement: input.settlement,
    authority: { completeness: 'authoritative-current', declarations: lootInput.declarations, containers: lootInput.containers },
  })
  const trainerSheets = input.read.sheets.filter(row => row.kind === 'trainer').map(row => ({
    slug: row.slug, revision: row.revision, sheet: row.document as TrainerSheet,
  }))
  const capturePokemonSlugs = new Set(input.read.capture.records.map(row => row.pokemonSheetSlug))
  const capture = planEncounterSettlementCaptures({
    settlement: input.settlement,
    authority: {
      completeness: 'authoritative-current',
      captureRecords: input.read.capture.records,
      trainerSheets,
      pokemonSheets: pokemonSheets.filter(row => capturePokemonSlugs.has(row.sheetSlug)).map(row => ({
        slug: row.sheetSlug, revision: row.revision, sheet: row.sheet,
      })),
      profiles: input.read.capture.profiles,
      declarations: input.read.capture.declarations,
    },
  })
  const outcomes = planEncounterSettlementOutcomes({
    settlement: input.settlement,
    authority: {
      completeness: 'authoritative-current',
      encounterDocument: input.read.encounter,
      declarations: outcomeDeclarations(input.read.encounter, input.read.autoResolveLinkedBattleStakes),
      campaignConsequencesComplete: true,
      campaignConsequences: [],
      authorization: {
        status: 'allowed',
        authority: authority('encounter-document', input.read.encounter.encounterId, input.read.encounter.revision),
        reasonId: null,
      },
      writeTimestamp: input.committedAt,
    },
  })
  const participantSheetKeys = new Set(input.settlement.participants.map(row => sheetKey(row.sheetKind, row.sheetSlug)))
  const cleanup = planEncounterSettlementTemporaryCleanup({
    settlement: input.settlement,
    authority: {
      completeness: 'authoritative-current',
      map: input.read.map,
      sheetsComplete: true,
      sheets: input.read.sheets
        .filter(row => participantSheetKeys.has(sheetKey(row.kind, row.slug)))
        .map(row => ({ kind: row.kind, slug: row.slug, revision: row.revision, document: row.document })),
      activeReservationOperationIds: input.read.activeReservationOperationIds,
      transformationsComplete: true,
      transformations: [],
      authorization: {
        status: 'allowed', authority: authority('map', input.read.map.slug, revisionOf(input.read.map.revision)), reasonId: null,
      },
      writeTimestamp: input.committedAt,
    },
  })
  const gates: FinishEncounterGateView[] = []
  const addAllocationGate = (count: number, title: string, detail: string): void => {
    if (count <= 0) return
    gates.push({ kind: 'reward-allocation', title, detail, action: 'open-director', actionLabel: 'Review encounter setup' })
  }
  addAllocationGate(experience.pendingRewardIds.length, 'Experience needs recipients', 'Choose or repair an exact current Pokémon recipient before settlement.')
  addAllocationGate(loot.pendingRewardIds.length + lootInput.unresolvedCount, 'Loot needs a destination', 'Choose one current Trainer or shared inventory destination before settlement.')
  if (capture.requiredDecisions.length || capture.pendingRewardIds.length) gates.push({
    kind: 'capture-decision', title: 'A capture needs review',
    detail: 'Confirm its current owner, team or box destination, and any required naming choice.',
    action: 'open-director', actionLabel: 'Review encounter setup',
  })
  if (outcomes.requiredDecisions.length) gates.push({
    kind: 'outcome-decision', title: 'Encounter outcomes need review',
    detail: 'Resolve every objective, clock, phase, and private or public stake before finishing.',
    action: 'open-director', actionLabel: 'Review story state',
  })
  if (cleanup.blockers.length) gates.push({
    kind: 'cleanup-blocker', title: 'Temporary state cannot be cleaned up yet',
    detail: 'Resolve pending reservations, item choices, or cleanup decisions in the encounter first.',
    action: 'return-to-encounter', actionLabel: 'Return to encounter',
  })
  return { experience, loot, capture, outcomes, cleanup, supplementalGates: Object.freeze(gates) }
}

const atomicAuthority = (
  settlement: EncounterSettlementDocument,
  read: FinishAuthorityRead,
): EncounterSettlementAtomicAuthoritySnapshot => ({
  completeness: 'authoritative-current',
  settlement,
  eligibility: {
    completeness: 'authoritative-current',
    encounter: settlement.encounter,
    participants: read.participants,
    blockingFacts: read.blockingFacts,
  },
  sheetsComplete: true,
  sheets: read.sheets.map(row => ({ kind: row.kind, slug: row.slug, revision: row.revision, document: row.document })),
  groupsComplete: true,
  groups: read.group ? [{ slug: read.group.slug, revision: read.group.revision, document: read.group.document }] : [],
  map: read.map,
  encounterDocument: read.encounter,
  additionalRewardDestinations: [],
})

const consequenceViews = (settlement: EncounterSettlementDocument): readonly FinishEncounterConsequenceView[] => {
  const labels = {
    hp: ['Hit Points', 'Current Hit Points remain on each sheet.'],
    injuries: ['Injuries', 'Current Injuries remain and can be handled during recovery.'],
    conditions: ['Persistent conditions', 'Persistent conditions remain until their owning rules remove them.'],
    equipment: ['Inventory and equipment', 'Inventory custody and equipped items remain authoritative.'],
  } as const
  return (Object.keys(labels) as (keyof typeof labels)[]).map(kind => ({
    kind,
    label: labels[kind][0],
    count: settlement.persistentConsequences.filter(row => row.kind === kind && row.state !== 'excluded').length,
    detail: labels[kind][1],
  }))
}
const destinationLabel = (destination: { readonly kind: string, readonly id: string }, read: FinishAuthorityRead): string => {
  if (destination.kind === 'group' || destination.kind === 'group-inventory') return 'Shared inventory'
  if (destination.kind === 'profile') return 'Captured Pokémon owner'
  const participant = read.participants.find(row => row.participantId === destination.id || row.sheetSlug === destination.id)
  return participant ? read.participantLabels.get(participant.participantId) ?? 'Participant' : 'Current settlement destination'
}
const rewardViews = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly read: FinishAuthorityRead
  readonly components?: ReturnType<typeof buildComponents>
}): readonly FinishEncounterRewardView[] => {
  const experienceByReward = new Map(input.components?.experience.allocations.map(row => [row.rewardId, row]) ?? [])
  const lootByReward = new Map<string, EncounterSettlementLootAllocationPlan['previews'][number][]>()
  for (const preview of input.components?.loot.previews ?? []) {
    const rows = lootByReward.get(preview.rewardId) ?? []
    rows.push(preview)
    lootByReward.set(preview.rewardId, rows)
  }
  const captureByReward = new Map(input.components?.capture.previews.map(row => [row.rewardId, row]) ?? [])
  return input.settlement.rewardPackage.lines.map((line): FinishEncounterRewardView => {
    if (line.payload.kind === 'experience') {
      const allocation = experienceByReward.get(line.rewardId) ?? existingAllocations(input.settlement, line.rewardId)[0]
      const recipients = input.components?.experience.recipientPreviews
        .filter(row => row.grantAmount > 0)
        .map(row => input.read.participants.find(participant => participant.sheetKind === 'pokemon' && participant.sheetSlug === row.sheetSlug))
        .filter((participant): participant is EncounterSettlementParticipant => participant !== undefined)
        .map(participant => input.read.participantLabels.get(participant.participantId) ?? 'Pokémon') ?? []
      return {
        kind: 'experience', label: 'Experience', amountLabel: `${line.payload.amount} XP`,
        destinationLabel: recipients.length > 0
          ? recipients.join(', ')
          : allocation?.destination.kind === 'group'
            ? 'Settled Pokémon recipients'
            : allocation ? destinationLabel(allocation.destination, input.read) : 'Needs recipients',
        detail: null,
      }
    }
    if (line.payload.kind === 'money') {
      const rows = lootByReward.get(line.rewardId) ?? []
      return { kind: 'money', label: 'Money', amountLabel: `₽${line.payload.amount.toLocaleString('en-US')}`, destinationLabel: rows[0] ? destinationLabel(rows[0].destination, input.read) : 'Needs a destination', detail: rows.length > 1 ? `${rows.length} destinations` : null }
    }
    if (line.payload.kind === 'item') {
      const rows = lootByReward.get(line.rewardId) ?? []
      return { kind: 'item', label: line.payload.canonicalItemId, amountLabel: `×${line.payload.quantity}`, destinationLabel: rows[0] ? destinationLabel(rows[0].destination, input.read) : 'Needs a destination', detail: line.payload.serialized ? 'One whole serialized item' : null }
    }
    if (line.payload.kind === 'capture') {
      const preview = captureByReward.get(line.rewardId)
      const pokemonSheetSlug = line.payload.pokemonSheetSlug
      const sheet = input.read.sheets.find(row => row.kind === 'pokemon' && row.slug === pokemonSheetSlug)
      return { kind: 'capture', label: sheet ? participantName(sheet) : 'Captured Pokémon', amountLabel: 'Captured', destinationLabel: preview ? `${preview.rosterAfter === 'team' ? 'Current team' : 'Storage box'}` : 'Needs review', detail: 'Original caught Ball remains recorded.' }
    }
    return { kind: 'narrative', label: 'Narrative outcome', amountLabel: 'Recorded', destinationLabel: line.visibility === 'gm' ? 'GM only' : 'Encounter history', detail: null }
  })
}
const outcomeViews = (encounter: EncounterDocument, plan?: EncounterSettlementOutcomePlan): readonly FinishEncounterOutcomeView[] => {
  if (!plan) return [{ kind: 'encounter', label: encounter.name, resultLabel: 'Completed', visibility: 'public' }]
  const objectiveLabels = new Map(encounter.objectives.map(row => [row.objectiveId, row.label]))
  const clockLabels = new Map(encounter.clocks.map(row => [row.clockId, row.label]))
  const phaseLabels = new Map(encounter.phases.map(row => [row.phaseId, row.label]))
  const rows = plan.outcomeFacts.map((fact): FinishEncounterOutcomeView => ({
    kind: fact.kind,
    label: fact.kind === 'objective' ? objectiveLabels.get(fact.subjectId) ?? 'Objective'
      : fact.kind === 'clock' ? clockLabels.get(fact.subjectId) ?? 'Clock'
        : fact.kind === 'phase' ? phaseLabels.get(fact.subjectId) ?? 'Phase'
          : fact.kind === 'stake' ? 'Encounter stake' : 'Campaign consequence',
    resultLabel: fact.resultCode.replace(/-/g, ' '),
    visibility: fact.audience === 'gm' ? 'gm' : 'public',
  }))
  return Object.freeze(rows.length ? rows : [{ kind: 'encounter', label: encounter.name, resultLabel: 'Completed', visibility: 'public' }])
}
const cleanupViews = (plan: EncounterSettlementCleanupPlan | null, settlement: EncounterSettlementDocument): readonly FinishEncounterCleanupView[] => {
  const labels: Record<string, readonly [string, string]> = {
    'combat-stages': ['Combat stages', 'Reset to their encounter-end defaults.'],
    'temporary-effects': ['Temporary effects', 'Expired according to their duration authority.'],
    'duration-effects': ['Duration effects', 'Encounter effects expire; longer-lived effects remain.'],
    'encounter-resources': ['Turn resources', 'Encounter-scoped actions and resources reset.'],
    reservations: ['Reservations', 'Owning operations must resolve before cleanup.'],
    zones: ['Battlefield zones', 'Expired or preserved by exact duration.'],
    'ground-items': ['Ground items', 'Persistent battlefield custody is preserved.'],
    'encounter-items': ['Encounter item state', 'Pending item choices must resolve first.'],
    initiative: ['Initiative', 'Turn order and per-token initiative are reset.'],
  }
  const source = plan?.previews ?? settlement.temporaryCleanup.flatMap(row => row.sourceIds.map(sourceId => ({
    cleanupKind: row.kind, sourceId, action: row.behavior,
  })))
  const kinds = [...new Set(source.map(row => row.cleanupKind))]
  return Object.freeze(kinds.map((kind): FinishEncounterCleanupView => {
    const rows = source.filter(row => row.cleanupKind === kind)
    const [label, detail] = labels[kind] ?? ['Temporary state', 'Handled by current cleanup authority.']
    const actions = [...new Set(rows.map(row => row.action))]
    return { kind, label, sourceCount: rows.length, actionLabel: actions.join(' / '), detail }
  }))
}
const gateView = (kind: FinishEncounterGateView['kind']): FinishEncounterGateView => {
  const rows: Record<string, Omit<FinishEncounterGateView, 'kind'>> = {
    'pending-reaction': { title: 'A reaction is waiting', detail: 'Resolve or pass the current reaction before settlement.', action: 'return-to-encounter', actionLabel: 'Return to encounter' },
    'pending-resolution': { title: 'A resolution is waiting', detail: 'Finish or explicitly recover the exact pending action before settlement.', action: 'return-to-encounter', actionLabel: 'Return to encounter' },
    'uncertain-command': { title: 'A command outcome is uncertain', detail: 'Check the server or retry only the exact retained command.', action: 'return-to-encounter', actionLabel: 'Open recovery' },
    'unallocated-reward': { title: 'A reward needs allocation', detail: 'Choose an exact current destination before settlement.', action: 'open-director', actionLabel: 'Review encounter setup' },
    'capture-destination': { title: 'A capture needs a destination', detail: 'Confirm its owner and team or box destination.', action: 'open-director', actionLabel: 'Review encounter setup' },
    'stale-snapshot': { title: 'The settlement review is stale', detail: 'Refresh from current encounter authority and review the changed result.', action: 'refresh-review', actionLabel: 'Refresh review' },
    'revision-conflict': { title: 'Encounter authority conflicts', detail: 'Current revisions do not safely continue this draft.', action: 'refresh-review', actionLabel: 'Refresh review' },
    'invalid-participant': { title: 'A participant changed', detail: 'Refresh or repair the encounter cast before settlement.', action: 'refresh-review', actionLabel: 'Refresh review' },
    'cleanup-decision': { title: 'Cleanup needs a decision', detail: 'Resolve the bounded cleanup choice before settlement.', action: 'return-to-encounter', actionLabel: 'Return to encounter' },
    'unsupported-authority': { title: 'Settlement evidence needs GM review', detail: 'Required source authority is absent or no longer exact.', action: 'open-director', actionLabel: 'Review encounter setup' },
    'private-choice': { title: 'A private choice is waiting', detail: 'The authorized owner or GM must resolve it first.', action: 'return-to-encounter', actionLabel: 'Return to encounter' },
    'gm-adjudication': { title: 'GM adjudication is required', detail: 'Record one bounded outcome before settlement.', action: 'open-director', actionLabel: 'Review story state' },
  }
  const row = rows[kind] ?? { title: 'Settlement is blocked', detail: 'Resolve the current authoritative gate before finishing.', action: 'refresh-review' as const, actionLabel: 'Refresh review' }
  return { kind, ...row }
}
const outstandingReasonViews = (reasons: readonly string[]): readonly FinishEncounterOutstandingWorkView[] => {
  const labels: Record<string, readonly [FinishEncounterOutstandingWorkView['kind'], string, string]> = {
    'level-threshold': ['level-threshold', 'Level-up review', 'A reached level threshold will remain visible as follow-up work.'],
    'capture-review': ['capture-review', 'Capture review', 'Review the captured Pokémon after settlement.'],
    'medical-review': ['medical-review', 'Medical recovery', 'Persistent Injuries or treatment need follow-up.'],
    'equipment-review': ['equipment-review', 'Equipment review', 'An equipment choice needs follow-up.'],
    'continuation-review': ['continuation-review', 'Campaign follow-up', 'A current continuation remains available.'],
  }
  return Object.freeze(reasons.map((reason) => {
    const row = labels[reason] ?? labels['continuation-review']!
    return { kind: row[0], label: row[1], detail: row[2] }
  }))
}
const outstandingViews = (plan: EncounterSettlementAtomicCommitPlan | null): readonly FinishEncounterOutstandingWorkView[] => (
  outstandingReasonViews(plan?.attentionSources.map(source => source.reason) ?? [])
)
const continuations = (): readonly FinishEncounterContinuationView[] => Object.freeze([
  { kind: 'encounter-library', label: 'Encounter library', href: '/play', detail: 'Return to the live encounter list.' },
  { kind: 'group-inventory', label: 'Shared inventory', href: '/group-inventory', detail: 'Review settled shared rewards.' },
  { kind: 'campaign', label: 'Campaign follow-up', href: '/campaign', detail: 'Continue with advancement and recovery work.' },
])

const acceptedView = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly read: FinishAuthorityRead
  readonly result?: FinishEncounterAcceptedSummary
  readonly outstandingWork?: readonly FinishEncounterOutstandingWorkView[]
}): FinishEncounterView => ({
  schemaVersion: FINISH_ENCOUNTER_VIEW_SCHEMA_VERSION,
  state: 'accepted',
  encounterName: input.read.encounter.name,
  participantCount: input.settlement.participants.length,
  readinessLabel: 'Encounter finished',
  readinessDetail: 'The complete settlement was accepted atomically. Partial application was not possible.',
  gates: [],
  consequences: consequenceViews(input.settlement),
  rewards: rewardViews({ settlement: input.settlement, read: input.read }),
  outcomes: outcomeViews(input.read.encounter),
  cleanup: cleanupViews(null, input.settlement),
  outstandingWork: input.outstandingWork ?? [],
  continuations: continuations(),
  command: null,
  accepted: input.result ?? {
    completedAtCampaignMinute: input.settlement.completion.completedAtCampaignMinute ?? input.read.campaignMinute,
    changedSheetCount: 0,
    changedGroupCount: 0,
    historyFactCount: 0,
    attentionSourceCount: 0,
    replayed: false,
  },
})

const buildPrepared = (input: {
  readonly database: RotomDatabase
  readonly encounterId: string
  readonly settlement: EncounterSettlementDocument
  readonly read: FinishAuthorityRead
  readonly operationId: string
  readonly committedAt: number
}): PreparedFinishEncounter => {
  if (input.settlement.completion.state === 'accepted') {
    const repository = createSqliteEncounterSettlementRepository(input.database)
    const operation = repository.getOperation(input.settlement.completion.operationId)
    const attention = repository.listAttentionSources(input.settlement.settlementId)
    return { view: acceptedView({
      settlement: input.settlement,
      read: input.read,
      result: operation ? {
        completedAtCampaignMinute: operation.result.completedAtCampaignMinute,
        changedSheetCount: operation.result.sheetRevisions.length,
        changedGroupCount: operation.result.groupRevisions.length,
        historyFactCount: operation.result.historyFactIds.length,
        attentionSourceCount: operation.result.attentionSourceIds.length,
        replayed: false,
      } : undefined,
      outstandingWork: outstandingReasonViews(attention.filter(source => source.status === 'open').map(source => source.reason)),
    }), plan: null, authority: null }
  }
  const components = buildComponents({ settlement: input.settlement, read: input.read, committedAt: input.committedAt })
  const storedGates = input.settlement.unresolvedGates.filter(gate => !['unallocated-reward', 'capture-destination'].includes(gate.kind))
  const gates = [...storedGates.map(gate => gateView(gate.kind)), ...components.supplementalGates]
  const allComplete = gates.length === 0
    && components.experience.complete && components.loot.complete && components.capture.complete
    && components.outcomes.complete && components.cleanup.complete
  let plan: EncounterSettlementAtomicCommitPlan | null = null
  let completeAuthority: EncounterSettlementAtomicAuthoritySnapshot | null = null
  if (allComplete) {
    completeAuthority = atomicAuthority(input.settlement, input.read)
    const captureAttention = components.capture.previews.map((preview) => {
      const participant = input.settlement.participants.find(row => row.sheetKind === 'pokemon' && row.sheetSlug === preview.pokemonSheetSlug)
      const currentRevision = participant?.sheetRevision ?? 0
      const changesSheet = components.capture.sheetWrites.some(row => row.kind === 'pokemon' && row.slug === preview.pokemonSheetSlug)
        || components.cleanup.sheetWrites.some(row => row.kind === 'pokemon' && row.slug === preview.pokemonSheetSlug)
        || components.experience.sheetWrites.some(row => row.sheetSlug === preview.pokemonSheetSlug)
      return {
        sourceId: deterministicId(
          'settlement-attention-source:v1:', input.settlement.settlementId, input.operationId,
          'capture-review', preview.pokemonSheetSlug,
        ),
        reason: 'capture-review' as const,
        audience: 'owner' as const,
        entityKind: 'pokemon-sheet' as const,
        entityId: preview.pokemonSheetSlug,
        sourceFactId: deterministicId(
          'settlement-history-fact:v1:', input.settlement.settlementId, input.operationId,
          'capture-settled', `capture:${preview.rewardId}`,
        ),
        authority: authority('sheet', preview.pokemonSheetSlug, currentRevision + (changesSheet ? 1 : 0)),
      }
    })
    plan = planEncounterSettlementAtomicCommit({
      operationId: input.operationId,
      campaignMinute: input.read.campaignMinute,
      committedAt: input.committedAt,
      authority: completeAuthority,
      components,
      additionalAttentionSources: captureAttention,
    })
  }
  const command: EncounterSettlementCommitCommand | null = plan ? Object.freeze({
    schemaVersion: ENCOUNTER_SETTLEMENT_COMMIT_COMMAND_SCHEMA_VERSION,
    operationId: plan.operationId,
    settlementId: plan.settlementId,
    expectedSettlementRevision: plan.expectedSettlementRevision,
    planDefinitionSha256: plan.planDefinitionSha256,
    confirmed: true,
  }) : null
  const view: FinishEncounterView = Object.freeze({
    schemaVersion: FINISH_ENCOUNTER_VIEW_SCHEMA_VERSION,
    state: plan ? 'ready' : 'blocked',
    encounterName: input.read.encounter.name,
    participantCount: input.settlement.participants.length,
    readinessLabel: plan ? 'Ready to settle' : `${gates.length} outstanding ${gates.length === 1 ? 'task' : 'tasks'}`,
    readinessDetail: plan
      ? 'No unresolved decisions. Rewards, consequences, outcomes, and cleanup can commit together.'
      : 'Finish the first listed task, then refresh this authoritative review.',
    gates: Object.freeze(gates),
    consequences: consequenceViews(input.settlement),
    rewards: rewardViews({ settlement: input.settlement, read: input.read, components }),
    outcomes: outcomeViews(input.read.encounter, components.outcomes),
    cleanup: cleanupViews(components.cleanup, input.settlement),
    outstandingWork: outstandingViews(plan),
    continuations: [],
    command,
    accepted: null,
  })
  return Object.freeze({ view, plan, authority: completeAuthority })
}

export const prepareFinishEncounter = (input: {
  readonly role: AuthRole
  readonly encounterId: unknown
  readonly now?: number
}, dependencies: {
  readonly database?: RotomDatabase
  readonly playerProfiles?: readonly PlayerProfile[]
  /** Internal-only capability: public Finish Encounter ingress never sets this identity. */
  readonly coordinatedBattleContestId?: string
} = {}): PreparedFinishEncounter => {
  if (input.role !== 'gm') throw new PrepareFinishEncounterUseCaseError(403, 'Only the GM may prepare encounter settlement.')
  if (typeof input.encounterId !== 'string' || !ID.test(input.encounterId)) {
    throw new PrepareFinishEncounterUseCaseError(400, 'Encounter identity is invalid.')
  }
  try {
    const database = dependencies.database ?? getRotomDatabase()
    const read = readAuthority(database, input.encounterId, dependencies.playerProfiles, dependencies.coordinatedBattleContestId ?? null)
    const repository = createSqliteEncounterSettlementRepository(database)
    const settlement = persistFreshDraft(repository, repository.getByEncounterId(read.encounter.encounterId), read)
    const now = input.now ?? Date.now()
    const operationId = createCommitOperationId(now)
    return buildPrepared({ database, encounterId: read.encounter.encounterId, settlement, read, operationId, committedAt: now })
  }
  catch (error) { return mapSettlementPlanningError(error) }
}

export const rebuildPreparedFinishEncounter = (input: {
  readonly role: AuthRole
  readonly command: EncounterSettlementCommitCommand
}, dependencies: {
  readonly database?: RotomDatabase
  readonly playerProfiles?: readonly PlayerProfile[]
  /** Internal-only capability paired with the immutable Contest/Encounter link. */
  readonly coordinatedBattleContestId?: string
} = {}): PreparedFinishEncounter => {
  if (input.role !== 'gm') throw new PrepareFinishEncounterUseCaseError(403, 'Only the GM may rebuild encounter settlement.')
  const committedAt = committedAtFromOperationId(input.command.operationId)
  if (committedAt === null) throw new PrepareFinishEncounterUseCaseError(409, 'The selected settlement preview is unavailable or stale.')
  try {
    const database = dependencies.database ?? getRotomDatabase()
    const repository = createSqliteEncounterSettlementRepository(database)
    const settlement = repository.get(input.command.settlementId)
    if (!settlement || settlement.revision !== input.command.expectedSettlementRevision) {
      throw new PrepareFinishEncounterUseCaseError(409, 'The selected settlement preview is unavailable or stale.')
    }
    const read = readAuthority(database, settlement.encounter.encounterId, dependencies.playerProfiles, dependencies.coordinatedBattleContestId ?? null)
    const prepared = buildPrepared({
      database,
      encounterId: settlement.encounter.encounterId,
      settlement,
      read,
      operationId: input.command.operationId,
      committedAt,
    })
    if (!prepared.plan || prepared.plan.planDefinitionSha256 !== input.command.planDefinitionSha256) {
      throw new PrepareFinishEncounterUseCaseError(409, 'The selected settlement preview is unavailable or stale.')
    }
    return prepared
  }
  catch (error) { return mapSettlementPlanningError(error) }
}

export const finishEncounterAcceptedView = (input: {
  readonly preview: FinishEncounterView
  readonly response: FinishEncounterAcceptedSummary
}): FinishEncounterView => Object.freeze({
  ...input.preview,
  state: 'accepted',
  readinessLabel: 'Encounter finished',
  readinessDetail: 'The complete settlement was accepted atomically. Partial application was not possible.',
  gates: Object.freeze([]),
  continuations: continuations(),
  command: null,
  accepted: Object.freeze(input.response),
})
