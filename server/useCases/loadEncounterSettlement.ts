import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  encounterSettlementDestinationProjectionKey,
  type EncounterSettlementProjection,
  type EncounterSettlementProjectedHistoryFact,
  type EncounterSettlementProjectionContext,
} from '#shared/encounterSettlement/projection'
import { canAccessGroupInventoryForRole } from '../policies/groupInventoryAccessPolicy'
import { canAccessMapForRole } from '../policies/mapPolicy'
import { playerProfileSheetAccessKeys } from '../policies/playerProfilePolicy'
import {
  gmEncounterSettlementProjectionContext,
  projectEncounterSettlement,
  projectEncounterSettlementHistory,
  publicEncounterSettlementProjectionContext,
} from '../domain/encounterSettlement/projection'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteEncounterSettlementRepository,
  type EncounterSettlementRepository,
  type StoredEncounterSettlementHistoryFact,
} from '../storage/encounterSettlementRepository'
import {
  createSqliteEncounterSettlementCorrectionRepository,
  type EncounterSettlementCorrectionRepository,
  type StoredEncounterSettlementCorrection,
} from '../storage/encounterSettlementCorrectionRepository'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteGroupInventoryRepository, type GroupInventoryRepository } from '../storage/groupInventoryRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { EncounterSettlementDocument, EncounterSettlementReceiptSubject } from '#shared/encounterSettlement/document'

export class LoadEncounterSettlementUseCaseError extends UseCaseHttpError<400 | 403 | 404> {}

export interface EncounterSettlementCorrectionSummary {
  readonly reasonCode: string
  readonly settlementRevision: number
  readonly correctedAtCampaignMinute: number
}

export interface LoadEncounterSettlementResponse {
  readonly freshness: 'current' | 'stale-draft'
  readonly settlement: EncounterSettlementProjection
  readonly history: readonly EncounterSettlementProjectedHistoryFact[]
  readonly corrections: readonly EncounterSettlementCorrectionSummary[]
}

export interface LoadEncounterSettlementDependencies {
  readonly database?: RotomDatabase
  readonly settlementRepository?: Pick<
    EncounterSettlementRepository,
    'get' | 'listHistoryFacts'
  >
  readonly correctionRepository?: Pick<EncounterSettlementCorrectionRepository, 'listBySettlement'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug'>
  readonly sheetRepository?: Pick<SheetRepository, 'list'>
  readonly groupRepository?: Pick<GroupInventoryRepository, 'get'>
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const parseExpectedRevision = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    throw new LoadEncounterSettlementUseCaseError(400, 'expectedRevision must be a safe non-negative integer.')
  }
  return Number(parsed)
}
const parseLimit = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 50
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 1 || Number(parsed) > 50) {
    throw new LoadEncounterSettlementUseCaseError(400, 'Settlement history limit must be from 1 through 50.')
  }
  return Number(parsed)
}

const ownerContext = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly profile: PlayerProfile
  readonly sheetRepository: Pick<SheetRepository, 'list'>
  readonly groupRepository: Pick<GroupInventoryRepository, 'get'>
}): EncounterSettlementProjectionContext => {
  const trainerSheets = input.sheetRepository.list()
    .filter(row => row.kind === 'trainer')
    .map(row => row.document as { readonly slug: string, readonly currentTeam?: readonly unknown[], readonly boxedPokemon?: readonly unknown[] })
  const accessKeys = playerProfileSheetAccessKeys(input.profile, { linkedTrainerSheets: trainerSheets })
  const ownedParticipants = input.settlement.participants.filter(participant => (
    accessKeys.has(`${participant.sheetKind}:${participant.sheetSlug}`)
  ))
  const participantIds = new Set(ownedParticipants.map(row => row.participantId))
  const destinationKeys = new Set<string>()
  const historySubjects = new Set<string>()
  for (const participant of ownedParticipants) {
    destinationKeys.add(encounterSettlementDestinationProjectionKey('participant', participant.participantId))
    destinationKeys.add(encounterSettlementDestinationProjectionKey(
      participant.sheetKind === 'trainer' ? 'trainer-inventory' : 'pokemon-sheet',
      participant.sheetSlug,
    ))
    if (participant.sideId !== null) {
      destinationKeys.add(encounterSettlementDestinationProjectionKey('side', participant.sideId))
    }
    historySubjects.add(participant.sheetSlug)
    historySubjects.add(`${participant.sheetKind}:${participant.sheetSlug}`)
    historySubjects.add(`${participant.sheetKind === 'trainer' ? 'trainer-inventory' : 'pokemon-sheet'}:${participant.sheetSlug}`)
  }
  destinationKeys.add(encounterSettlementDestinationProjectionKey('profile', input.profile.id))
  for (const allocation of input.settlement.allocations) {
    if ((allocation.destination.kind === 'group' || allocation.destination.kind === 'group-inventory')
      && canAccessGroupInventoryForRole('player', allocation.destination.id)
      && input.groupRepository.get(allocation.destination.id) !== null) {
      destinationKeys.add(encounterSettlementDestinationProjectionKey(
        allocation.destination.kind,
        allocation.destination.id,
      ))
      historySubjects.add(allocation.destination.id)
      historySubjects.add(`group:${allocation.destination.id}`)
      historySubjects.add(`group-inventory:${allocation.destination.id}`)
    }
  }
  return {
    audience: ownedParticipants.length > 0 || destinationKeys.size > 1 ? 'owner' : 'public',
    ownedParticipantIds: participantIds,
    ownedDestinationKeys: destinationKeys,
    ownedHistorySubjectIds: historySubjects,
  }
}

const subjectOwned = (
  subject: EncounterSettlementReceiptSubject,
  settlement: EncounterSettlementDocument,
  context: EncounterSettlementProjectionContext,
): boolean => {
  if (subject.kind === 'consequence') {
    const consequence = settlement.persistentConsequences.find(row => row.consequenceId === subject.id)
    return consequence?.participantId !== null
      && consequence?.participantId !== undefined
      && context.ownedParticipantIds.has(consequence.participantId)
  }
  if (subject.kind === 'allocation') {
    const allocation = settlement.allocations.find(row => row.allocationId === subject.id)
    return allocation !== undefined && context.ownedDestinationKeys.has(
      encounterSettlementDestinationProjectionKey(allocation.destination.kind, allocation.destination.id),
    )
  }
  if (subject.kind === 'reward') {
    return settlement.allocations.some(allocation => (
      allocation.rewardId === subject.id
      && context.ownedDestinationKeys.has(encounterSettlementDestinationProjectionKey(
        allocation.destination.kind,
        allocation.destination.id,
      ))
    ))
  }
  if (subject.kind === 'cleanup') {
    const cleanup = settlement.temporaryCleanup.find(row => row.cleanupId === subject.id)
    return cleanup?.participantIds.some(id => context.ownedParticipantIds.has(id)) === true
  }
  return false
}

const correctionVisible = (input: {
  readonly correction: StoredEncounterSettlementCorrection
  readonly settlement: EncounterSettlementDocument
  readonly context: EncounterSettlementProjectionContext
}): boolean => {
  if (input.context.audience === 'gm') return true
  const receipt = input.settlement.receipts.find(row => (
    row.kind === 'correction' && row.operationId === input.correction.operationId
  ))
  if (!receipt || receipt.audience === 'gm') return false
  if (receipt.audience === 'public') return true
  return input.context.audience === 'owner'
    && receipt.subjects.some(subject => subjectOwned(subject, input.settlement, input.context))
}

export const loadEncounterSettlement = (input: {
  readonly role: AuthRole
  readonly playerProfile: PlayerProfile | null
  readonly settlementId: unknown
  readonly expectedRevision?: unknown
  readonly historyLimit?: unknown
}, dependencies: LoadEncounterSettlementDependencies = {}): LoadEncounterSettlementResponse => {
  if (typeof input.settlementId !== 'string' || !ID.test(input.settlementId)) {
    throw new LoadEncounterSettlementUseCaseError(400, 'Settlement identity is invalid.')
  }
  const expectedRevision = parseExpectedRevision(input.expectedRevision)
  const historyLimit = parseLimit(input.historyLimit)
  const database = dependencies.database ?? getRotomDatabase()
  const settlementRepository = dependencies.settlementRepository
    ?? createSqliteEncounterSettlementRepository(database)
  const correctionRepository = dependencies.correctionRepository
    ?? createSqliteEncounterSettlementCorrectionRepository(database)
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository(database)
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository(database)
  const groupRepository = dependencies.groupRepository ?? createSqliteGroupInventoryRepository(database)
  const settlement = settlementRepository.get(input.settlementId)
  if (!settlement) throw new LoadEncounterSettlementUseCaseError(404, 'Encounter settlement was not found.')
  const map = mapRepository.getBySlug(settlement.encounter.linkedMapSlug)
  if (!map || !canAccessMapForRole(input.role, map)) {
    throw new LoadEncounterSettlementUseCaseError(404, 'Encounter settlement was not found.')
  }
  if (input.role === 'player' && !input.playerProfile) {
    throw new LoadEncounterSettlementUseCaseError(403, 'A selected player profile is required for settlement details.')
  }
  const context = input.role === 'gm'
    ? gmEncounterSettlementProjectionContext()
    : input.playerProfile
      ? ownerContext({ settlement, profile: input.playerProfile, sheetRepository, groupRepository })
      : publicEncounterSettlementProjectionContext()
  const facts = settlementRepository.listHistoryFacts(settlement.settlementId) as readonly StoredEncounterSettlementHistoryFact[]
  const corrections = correctionRepository.listBySettlement(settlement.settlementId)
    .filter(correction => correctionVisible({ correction, settlement, context }))
    .map(correction => Object.freeze({
      reasonCode: correction.reasonCode,
      settlementRevision: correction.settlementRevision,
      correctedAtCampaignMinute: correction.acceptedAtCampaignMinute,
    }))
  return Object.freeze({
    freshness: expectedRevision !== null && expectedRevision !== settlement.revision
      ? 'stale-draft'
      : 'current',
    settlement: projectEncounterSettlement({ settlement, context }),
    history: projectEncounterSettlementHistory({ facts, context, limit: historyLimit }),
    corrections: Object.freeze(corrections),
  })
}
