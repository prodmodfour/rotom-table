import type { PlayerProfileId } from '../playerProfiles'
import {
  CONTEST_LETTERS,
  CONTEST_STAGES,
  CONTEST_STAT_IDS,
  emptyContestStatRecord,
  isContestEffectId,
  isContestParticipantMethodId,
  isContestParticipantVariantId,
  isContestStatId,
  isContestVariantId,
  parseContestAppealId,
  parseContestId,
  parseContestantId,
  parseContestOperationId,
  type ContestEffectId,
  type ContestIntroductionSkillId,
  type ContestLetter,
  type ContestParticipantMethodId,
  type ContestParticipantVariantId,
  type ContestStage,
  type ContestStatId,
  type ContestVariantId,
} from './ids'
import { contestBaseVariantAllowsTrainerParticipants, contestCatalog, contestVariantIsNative, trainerParticipantContestVariant } from './catalog'
import type { ContestStatContribution } from './preparation'
import { resolveTrainerParticipantMethodTurn, type ContestParticipantPerformerKind } from './participantMethods'
import itemsJson from '../../data/reference/items.json'

export const CONTEST_DOCUMENT_SCHEMA_VERSION = 1 as const

export interface ContestControllerGmV1 { readonly kind: 'gm' }
export interface ContestControllerProfileV1 { readonly kind: 'profile', readonly profileId: PlayerProfileId }
export type ContestControllerV1 = ContestControllerGmV1 | ContestControllerProfileV1

export interface ContestPrizeItemV1 {
  readonly itemId: string
  readonly quantity: number
  readonly targetTrainerSlug: string | null
}

const CANONICAL_CONTEST_PRIZE_ITEM_IDS = new Set(Object.keys(itemsJson as Record<string, unknown>))
export const normalizeContestPrize = (value: Partial<ContestPolicyV1['prize']> | null | undefined): ContestPolicyV1['prize'] => {
  if (value !== null && value !== undefined && (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['declared','money','items','notes'].includes(key)))) throw new ContestContractError('contest.invalid-prize', 'prize', 'has an invalid shape')
  if (value?.declared !== undefined && typeof value.declared !== 'boolean') throw new ContestContractError('contest.invalid-prize', 'prize.declared', 'must be boolean')
  const money = value?.money ?? 0
  if (typeof money !== 'number' || !Number.isSafeInteger(money) || money < 0 || money > 1_000_000_000) throw new ContestContractError('contest.invalid-prize', 'prize.money', 'must be a bounded whole number')
  const notesInput = value?.notes ?? ''
  const notes = typeof notesInput === 'string' && notesInput.length <= 1_000 && !/[\u0000-\u001f\u007f]/u.test(notesInput) ? notesInput : (() => { throw new ContestContractError('contest.invalid-prize', 'prize.notes', 'must be bounded control-free text') })()
  const rawItems = value?.items ?? []
  if (!Array.isArray(rawItems) || rawItems.length > 50) throw new ContestContractError('contest.invalid-prize', 'prize.items', 'must contain at most 50 canonical item writes')
  const items = rawItems.map((raw, index): ContestPrizeItemV1 => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ContestContractError('contest.invalid-prize', `prize.items[${index}]`, 'must be an object')
    const row = raw as ContestPrizeItemV1
    if (Object.keys(raw).some(key => !['itemId','quantity','targetTrainerSlug'].includes(key)) || !['itemId','quantity','targetTrainerSlug'].every(key => Object.hasOwn(raw, key))) throw new ContestContractError('contest.invalid-prize', `prize.items[${index}]`, 'has an invalid shape')
    if (!CANONICAL_CONTEST_PRIZE_ITEM_IDS.has(row.itemId)) throw new ContestContractError('contest.invalid-prize', `prize.items[${index}].itemId`, 'must name an app-owned canonical item')
    if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 999) throw new ContestContractError('contest.invalid-prize', `prize.items[${index}].quantity`, 'must be from 1 through 999')
    if (row.targetTrainerSlug !== null && (typeof row.targetTrainerSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,119}$/u.test(row.targetTrainerSlug))) throw new ContestContractError('contest.invalid-prize', `prize.items[${index}].targetTrainerSlug`, 'must be a valid Trainer slug or null')
    return Object.freeze({ itemId: row.itemId, quantity: row.quantity, targetTrainerSlug: row.targetTrainerSlug })
  })
  return Object.freeze({ declared: value?.declared === true, money, items: Object.freeze(items), notes })
}

export interface ContestPolicyV1 {
  readonly significanceMultiplier: number
  readonly awardRibbon: boolean
  readonly prize: {
    readonly declared: boolean
    readonly money: number
    readonly items: readonly ContestPrizeItemV1[]
    readonly notes: string
  }
  readonly rotationOrderPolicy: 'choose-each-round' | 'predeclared'
  readonly supercontestFestival: boolean
  readonly source: 'gm-reviewed'
  readonly lockedAt: number | null
}

export interface ContestMoveOptionV1 {
  readonly optionId: string
  readonly canonicalMoveId: string
  readonly label: string
  readonly typeId: ContestStatId | null
  readonly effectId: ContestEffectId | null
  readonly tags: readonly string[]
  readonly source: 'sheet' | 'style-feature' | 'created-move'
  readonly available: boolean
  readonly unavailableCode: string | null
  readonly unavailableReason: string | null
}

export interface ContestDicePoolV1 {
  readonly total: number
  readonly remaining: number
  readonly contributors: readonly ContestStatContribution[]
}

export interface ContestPerformerSnapshotBaseV1 {
  readonly performerKind: 'pokemon' | 'trainer'
  readonly performerId: string
  readonly displayName: string
  readonly level: number
  readonly portraitUrl: string | null
  readonly moves: readonly ContestMoveOptionV1[]
  readonly dicePools: Readonly<Record<ContestStatId, ContestDicePoolV1>>
  readonly providerIds: readonly string[]
}

export interface ContestPokemonPerformerSnapshotV1 extends ContestPerformerSnapshotBaseV1 {
  readonly performerKind: 'pokemon'
  readonly pokemonSheetSlug: string
  readonly pokemonSheetRevision: number
  readonly species: string
}

export interface ContestTrainerPerformerSnapshotV1 extends ContestPerformerSnapshotBaseV1 {
  readonly performerKind: 'trainer'
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
}

export type ContestPerformerSnapshotV1 = ContestPokemonPerformerSnapshotV1 | ContestTrainerPerformerSnapshotV1
export const contestPerformerIsPokemon = (performer: ContestPerformerSnapshotV1): performer is ContestPokemonPerformerSnapshotV1 => performer.performerKind === 'pokemon'
export const contestPerformerIsTrainer = (performer: ContestPerformerSnapshotV1): performer is ContestTrainerPerformerSnapshotV1 => performer.performerKind === 'trainer'

export interface ContestIntroductionStateV1 {
  readonly status: 'pending' | 'accepted'
  /** Exact Trainer performer for Trainer Participant introductions; null for ordinary base entries. */
  readonly performerId: string | null
  readonly skillId: ContestIntroductionSkillId | null
  readonly generatedStatId: ContestStatId | null
  readonly skillRankDice: number
  readonly bonusDice: number
  readonly results: readonly number[]
  readonly generatedDice: number
  readonly matchingAppealBonus: number
  readonly letterTotal: number
  readonly operationId: string | null
}

export interface ContestSharedDiceSpendJournalEntryV1 {
  readonly spendId: string
  readonly operationId: string
  /** Trainer or Pokémon that accepted the spend. */
  readonly performerId: string
  /** Exact Pokémon preparation pool shared with that performer. */
  readonly pokemonPerformerId: string
  readonly sourcePolicy: 'trainer-pokemon-entry'
  readonly spentDice: Readonly<Record<ContestStatId, number>>
  readonly pokemonSpentDice: Readonly<Record<ContestStatId, number>>
  readonly teamSpentDice: Readonly<Record<ContestStatId, number>>
  readonly pokemonRemainingBefore: Readonly<Record<ContestStatId, number>>
  readonly pokemonRemainingAfter: Readonly<Record<ContestStatId, number>>
  readonly teamRemainingBefore: Readonly<Record<ContestStatId, number>>
  readonly teamRemainingAfter: Readonly<Record<ContestStatId, number>>
  readonly createdAt: number
}

export interface ContestPendingEffectStateV1 {
  readonly nextRoundBaseMoveDiceMultiplier: number
  readonly fumbleProtectionRound: number | null
  readonly nextAppealAlignmentSteps: number
  readonly nextAppealAlignmentTypeId: ContestStatId | null
  readonly nextAppealBonusDice: number
  readonly nextAppealTypeId: ContestStatId | null
  readonly nextAppealEffectId: ContestEffectId | null
  readonly fixedAppealPerDie: boolean
  /** Exact pending pre-appeal recipient for Trainer Participant interventions. */
  readonly targetPerformerId: string | null
  /** Adaptable Performance source Moves that become unavailable on the named performer's next round. */
  readonly blockedMoveOptionIds: readonly string[]
  readonly blockedMoveRound: number | null
  readonly blockedMovePerformerId: string | null
}

export interface ContestantStateV1 {
  readonly contestantId: string
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
  readonly displayName: string
  readonly controller: ContestControllerV1
  readonly performers: readonly ContestPerformerSnapshotV1[]
  readonly rotationOrder: readonly number[]
  readonly letter: ContestLetter | null
  /** Enrollment-time private offer snapshot from ordinary Trainer skill authority. */
  readonly introductionSkillDice: Readonly<Record<ContestIntroductionSkillId, number>>
  readonly introduction: ContestIntroductionStateV1
  readonly appeal: number
  readonly fumble: number
  /** Shared-entry Voltage for ordinary and Alternating play; fixed at zero under Simultaneous. */
  readonly voltage: number
  /** Exact per-performer Voltage authority for Simultaneous; empty for every other format/method. */
  readonly performerVoltages: Readonly<Record<string, number>>
  readonly lastMoveOptionId: string | null
  readonly usedInterventionIds: readonly string[]
  /** Entry-shared authority: Rotation Introduction dice, or the sole Trainer Participant prepared pool. */
  readonly teamDicePools: Readonly<Record<ContestStatId, ContestDicePoolV1>>
  /** Immutable single-spend evidence for the Trainer Participant shared pool. */
  readonly sharedDiceSpendJournal: readonly ContestSharedDiceSpendJournalEntryV1[]
  readonly teamContestDiceSpent: number
  readonly pendingEffects: ContestPendingEffectStateV1
  readonly withdrawn: boolean
  readonly finalPlacement: number | null
  readonly finalScore: number | null
}

export interface ContestDiceJournalEntryV1 {
  readonly journalId: string
  readonly operationId: string
  readonly purpose: 'introduction' | 'introduction-bonus' | 'letter-tie' | 'appeal' | 'appeal-reroll' | 'supercontest-type' | 'placement-tie'
  readonly contestantId: string | null
  readonly round: number | null
  readonly dieSides: number
  readonly results: readonly number[]
  /** Exact positions replaced in an Appeal result vector; absent only on legacy schema-v1 evidence. */
  readonly rerolledDieIndices?: readonly number[]
  readonly replacesJournalId: string | null
  readonly createdAt: number
}

export interface ContestAppealContributorV1 {
  readonly id: string
  readonly label: string
  readonly kind: 'base' | 'contest-stat' | 'voltage' | 'type' | 'effect' | 'feature' | 'ability' | 'item'
  readonly dice: number
  readonly explanation: string
}

export interface ContestAppealLedgerEntryV1 {
  readonly appealId: string
  readonly operationId: string
  readonly round: number
  readonly turn: number
  readonly contestantId: string
  readonly performerId: string
  readonly moveOptionId: string
  readonly moveLabel: string
  readonly moveTypeId: ContestStatId
  readonly contestTypeId: ContestStatId
  readonly effectId: ContestEffectId
  /** Same-entry recipient selected under a reviewed Simultaneous cross-performer effect, otherwise null. */
  readonly partnerEffectTargetPerformerId: string | null
  readonly centerOfAttention: boolean
  readonly adjacentContestantIds: readonly string[]
  readonly spentDice: Readonly<Record<ContestStatId, number>>
  readonly contributors: readonly ContestAppealContributorV1[]
  readonly baseMoveDiceMultiplier: 1 | 2
  readonly assembledDice: number
  readonly journalIds: readonly string[]
  readonly acceptedResults: readonly number[]
  readonly appealDelta: number
  readonly fumbleDelta: number
  readonly voltageBefore: number
  readonly voltageAfter: number
  readonly consequences: readonly { readonly contestantId: string, readonly performerId: string | null, readonly appealDelta: number, readonly fumbleDelta: number, readonly voltageDelta: number, readonly reason: string }[]
  readonly acceptedAt: number
  readonly correctionIds: readonly string[]
}

export interface ContestHistoryEntryV1 {
  readonly sequence: number
  readonly eventId: string
  readonly type: string
  readonly visibility: 'public' | 'owner' | 'gm' | 'diagnostic'
  readonly contestantId: string | null
  readonly headline: string
  readonly detail: string
  readonly operationId: string | null
  readonly createdAt: number
}

export interface ContestCorrectionReceiptV1 {
  readonly correctionId: string
  readonly operationId: string
  readonly contestantId: string | null
  readonly kind: 'appeal-delta' | 'fumble-delta' | 'voltage-delta' | 'dice-pool-delta' | 'controller-reassignment' | 'cancel-contest'
  readonly reason: string
  readonly numericDelta: number | null
  readonly statId: ContestStatId | null
  readonly priorValue: number | string | null
  readonly nextValue: number | string | null
  readonly createdAt: number
}

export interface ContestSettlementEntryV1 {
  readonly contestantId: string
  readonly placement: number
  readonly finalScore: number
  readonly experienceByPokemon: readonly { readonly pokemonSheetSlug: string, readonly experience: number }[]
  readonly ribbon: boolean
  readonly trainerSheetSlug: string
}

export interface ContestSettlementV1 {
  readonly settlementId: string
  readonly status: 'preview' | 'committed'
  readonly entries: readonly ContestSettlementEntryV1[]
  readonly money: number
  readonly items: readonly ContestPrizeItemV1[]
  readonly attentionItemIds: readonly string[]
  readonly committedOperationId: string | null
  readonly committedAt: number | null
}

export interface ContestDocumentV1 {
  readonly schemaVersion: 1
  readonly contestId: string
  readonly catalogId: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly display: {
    readonly name: string
    readonly hallName: string
    readonly description: string
  }
  /** Canonical base ruleset used for charts, type policy, and lifecycle. */
  readonly variantId: ContestVariantId
  /** Optional reviewed performer-format layer; null preserves ordinary Pokémon-only entries. */
  readonly participantVariantId: ContestParticipantVariantId | null
  /** Explicit source-bound method choice for Trainer Participant entries. */
  readonly participantMethodId: ContestParticipantMethodId | null
  /** Server-authored marker for the canonical one-pool Trainer Participant policy. */
  readonly sharedContestDicePoolScope: 'trainer-pokemon-entry' | null
  readonly contestTypeId: ContestStatId | null
  readonly stage: ContestStage
  readonly paused: boolean
  readonly round: number
  readonly turnIndex: number
  /** Most recent appeal whose bounded reroll/pass decision blocks turn advancement. */
  readonly pendingInterventionAppealId: string | null
  readonly currentRoundContestTypeId: ContestStatId | null
  readonly supercontestTypeByRound: readonly ContestStatId[]
  readonly festivalHeat: number
  readonly contestants: readonly ContestantStateV1[]
  readonly policy: ContestPolicyV1
  readonly gmNotes: string
  readonly diceJournal: readonly ContestDiceJournalEntryV1[]
  readonly appealLedger: readonly ContestAppealLedgerEntryV1[]
  readonly corrections: readonly ContestCorrectionReceiptV1[]
  readonly history: readonly ContestHistoryEntryV1[]
  readonly settlement: ContestSettlementV1 | null
  readonly cancellationReason: string | null
}

export class ContestContractError extends Error {
  readonly code: string
  readonly field: string
  constructor(code: string, field: string, message: string) {
    super(message)
    this.name = 'ContestContractError'
    this.code = code
    this.field = field
  }
}

const fail = (code: string, field: string, message: string): never => { throw new ContestContractError(code, field, message) }
const safeInteger = (value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail('contest.invalid-document', field, `must be an integer from ${minimum} through ${maximum}`)
  return Number(value)
}
const safeNumber = (value: unknown, field: string, minimum: number, maximum: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail('contest.invalid-document', field, `must be from ${minimum} through ${maximum}`)
  return value as number
}
const safeText = (value: unknown, field: string, maximum: number, required = false): string => {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim()) || /[\u0000-\u001f\u007f]/u.test(value)) fail('contest.invalid-document', field, 'must be bounded control-free text')
  return value as string
}
const record = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('contest.invalid-document', field, 'must be an object')
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, keys: readonly string[], field: string): void => {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail('contest.invalid-document', `${field}.${key}`, 'is not recognized')
}
const array = (value: unknown, field: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail('contest.invalid-document', field, `must be an array of at most ${maximum}`)
  return value as unknown[]
}
const frozenClone = <T>(value: T): T => Object.freeze(structuredClone(value)) as T

const LEGAL_TRANSITIONS: Readonly<Record<ContestStage, readonly ContestStage[]>> = Object.freeze({
  setup: ['introduction', 'cancelled'],
  introduction: ['performance', 'setup', 'cancelled'],
  performance: ['settling', 'cancelled'],
  settling: ['completed', 'performance', 'cancelled'],
  completed: [],
  cancelled: [],
})

export const contestStageCanTransition = (from: ContestStage, to: ContestStage): boolean => LEGAL_TRANSITIONS[from].includes(to)
export const assertContestStageTransition = (from: ContestStage, to: ContestStage): void => {
  if (!contestStageCanTransition(from, to)) fail('contest.illegal-transition', 'stage', `Contest cannot transition from ${from} to ${to}.`)
}

export interface CreateContestDocumentInput {
  readonly contestId: string
  readonly name: string
  readonly hallName: string
  readonly description?: string
  readonly variantId: ContestVariantId
  readonly participantVariantId?: ContestParticipantVariantId | null
  readonly participantMethodId?: ContestParticipantMethodId | null
  readonly contestTypeId?: ContestStatId | null
  readonly significanceMultiplier: number
  readonly awardRibbon: boolean
  readonly prize?: Partial<ContestPolicyV1['prize']>
  readonly rotationOrderPolicy?: ContestPolicyV1['rotationOrderPolicy']
  readonly supercontestFestival?: boolean
  readonly gmNotes?: string
  readonly now: number
}

export const createContestDocument = (input: CreateContestDocumentInput): ContestDocumentV1 => {
  const contestId = parseContestId(input.contestId)
  if (!contestVariantIsNative(input.variantId)) fail('contest.variant-unsupported', 'variantId', 'Choose a supported Contest variant.')
  if (input.participantVariantId !== undefined && input.participantVariantId !== null && !isContestParticipantVariantId(input.participantVariantId)) fail('contest.variant-unsupported', 'participantVariantId', 'Choose a reviewed participant format.')
  if (input.participantVariantId === 'trainer-participant' && !contestBaseVariantAllowsTrainerParticipants(input.variantId)) fail('contest.variant-unsupported', 'participantVariantId', 'Trainer performers are not permitted by this base Contest variant.')
  if (input.participantMethodId !== undefined && input.participantMethodId !== null && !isContestParticipantMethodId(input.participantMethodId)) fail('contest.variant-unsupported', 'participantMethodId', 'Choose a canonical Trainer Participant method.')
  if (input.participantVariantId !== 'trainer-participant' && input.participantMethodId != null) fail('contest.policy-invalid', 'participantMethodId', 'A participant method is available only to Trainer Participant Contests.')
  const needsFixedType = input.variantId === 'standard' || input.variantId === 'festival' || input.variantId === 'rotation'
  if (needsFixedType && !isContestStatId(input.contestTypeId)) fail('contest.type-required', 'contestTypeId', 'Choose a Contest type.')
  if (input.variantId === 'supercontest' && input.contestTypeId != null) fail('contest.type-invalid', 'contestTypeId', 'Supercontest types are rolled authoritatively each round and cannot be fixed during setup.')
  if (input.contestTypeId != null && !isContestStatId(input.contestTypeId)) fail('contest.type-invalid', 'contestTypeId', 'Contest type is not canonical.')
  if (typeof input.awardRibbon !== 'boolean') fail('contest.policy-invalid', 'awardRibbon', 'must be an explicit boolean')
  if (input.rotationOrderPolicy !== undefined && input.variantId !== 'rotation') fail('contest.policy-invalid', 'rotationOrderPolicy', 'Rotation order policy is available only for Rotation Contests.')
  if (input.supercontestFestival === true && input.variantId !== 'festival') fail('contest.policy-invalid', 'supercontestFestival', 'Random Festival round types are available only for Festivals.')
  const significanceMultiplier = safeNumber(
    input.significanceMultiplier,
    'significanceMultiplier',
    contestCatalog.experience.significanceMultiplierMinimum,
    contestCatalog.experience.significanceMultiplierMaximum,
  )
  const step = contestCatalog.experience.significanceMultiplierStep
  if (Math.abs(significanceMultiplier / step - Math.round(significanceMultiplier / step)) > Number.EPSILON) fail('contest.policy-invalid', 'significanceMultiplier', `must use ${step} steps`)
  const now = safeInteger(input.now, 'now')
  return frozenClone({
    schemaVersion: 1 as const,
    contestId,
    catalogId: contestCatalog.catalogId,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    display: {
      name: safeText(input.name, 'name', 120, true),
      hallName: safeText(input.hallName, 'hallName', 120, true),
      description: safeText(input.description ?? '', 'description', 1_000),
    },
    variantId: input.variantId,
    participantVariantId: input.participantVariantId ?? null,
    participantMethodId: input.participantVariantId === 'trainer-participant' ? input.participantMethodId ?? null : null,
    sharedContestDicePoolScope: input.participantVariantId === 'trainer-participant' ? trainerParticipantContestVariant.sharedContestDicePool.scope : null,
    contestTypeId: input.contestTypeId ?? null,
    stage: 'setup' as const,
    paused: false,
    round: 0,
    turnIndex: 0,
    pendingInterventionAppealId: null,
    currentRoundContestTypeId: input.variantId === 'supercontest' ? null : input.contestTypeId ?? null,
    supercontestTypeByRound: [],
    festivalHeat: 1,
    contestants: [],
    policy: {
      significanceMultiplier,
      awardRibbon: input.awardRibbon,
      prize: normalizeContestPrize(input.prize),
      rotationOrderPolicy: input.rotationOrderPolicy ?? 'predeclared',
      supercontestFestival: input.supercontestFestival === true,
      source: 'gm-reviewed' as const,
      lockedAt: null,
    },
    gmNotes: safeText(input.gmNotes ?? '', 'gmNotes', 4_000),
    diceJournal: [],
    appealLedger: [],
    corrections: [],
    history: [{
      sequence: 1,
      eventId: `${contestId}:history:1`,
      type: 'contest-created',
      visibility: 'public' as const,
      contestantId: null,
      headline: `${input.name} created`,
      detail: `${input.hallName} is preparing a ${input.participantVariantId === 'trainer-participant' ? 'Trainer Participant ' : ''}${input.variantId} Contest.`,
      operationId: null,
      createdAt: now,
    }],
    settlement: null,
    cancellationReason: null,
  })
}

const parseController = (value: unknown, field: string): ContestControllerV1 => {
  const row = record(value, field)
  if (row.kind === 'gm') { exact(row, ['kind'], field); return Object.freeze({ kind: 'gm' }) }
  if (row.kind === 'profile' && typeof row.profileId === 'string' && /^profile_[A-Za-z0-9_-]{8,64}$/u.test(row.profileId)) {
    exact(row, ['kind', 'profileId'], field)
    return Object.freeze({ kind: 'profile', profileId: row.profileId as PlayerProfileId })
  }
  return fail('contest.invalid-controller', field, 'must identify the GM or one selected player profile')
}

const validateDicePool = (value: unknown, field: string): void => {
  const pool = record(value, field); exact(pool, ['total','remaining','contributors'], field)
  const total = safeInteger(pool.total, `${field}.total`, 0, 1_000); safeInteger(pool.remaining, `${field}.remaining`, 0, total)
  const contributions = array(pool.contributors, `${field}.contributors`, 100)
  let activeTotal = 0
  for (const [index, raw] of contributions.entries()) {
    const path = `${field}.contributors[${index}]`, contribution = record(raw, path)
    exact(contribution, ['id','kind','statId','dice','active','label','sourceId','explanation'], path)
    safeText(contribution.id, `${path}.id`, 240, true); if (!['combat-stat','poffin','feature-poffin-equivalent','temporary-reallocation','introduction','ability'].includes(String(contribution.kind)) || !isContestStatId(contribution.statId)) fail('contest.invalid-contestant', path, 'has invalid contribution identity')
    const dice = safeInteger(contribution.dice, `${path}.dice`, -100, 100); if (typeof contribution.active !== 'boolean') fail('contest.invalid-contestant', `${path}.active`, 'must be boolean')
    safeText(contribution.label, `${path}.label`, 160, true); safeText(contribution.sourceId, `${path}.sourceId`, 240, true); safeText(contribution.explanation, `${path}.explanation`, 1_000, true)
    if (contribution.active) activeTotal += dice
  }
  if (activeTotal !== total) fail('contest.invalid-contestant', field, 'total must equal active contributor dice')
}

const validateContestant = (value: unknown, index: number): ContestantStateV1 => {
  const field = `contestants[${index}]`, row = record(value, field)
  exact(row, ['contestantId','trainerSheetSlug','trainerSheetRevision','displayName','controller','performers','rotationOrder','letter','introductionSkillDice','introduction','appeal','fumble','voltage','performerVoltages','lastMoveOptionId','usedInterventionIds','teamDicePools','sharedDiceSpendJournal','teamContestDiceSpent','pendingEffects','withdrawn','finalPlacement','finalScore'], field)
  parseContestantId(row.contestantId, `${field}.contestantId`); safeText(row.trainerSheetSlug, `${field}.trainerSheetSlug`, 160, true); safeInteger(row.trainerSheetRevision, `${field}.trainerSheetRevision`); safeText(row.displayName, `${field}.displayName`, 160, true); parseController(row.controller, `${field}.controller`)
  const performers = array(row.performers, `${field}.performers`, 6); if (performers.length < 1) fail('contest.invalid-contestant', `${field}.performers`, 'must contain at least one performer')
  const performerIds = new Set<string>(), pokemonPerformerIds = new Set<string>(), trainerPerformerIds = new Set<string>()
  for (const [performerIndex, raw] of performers.entries()) {
    const path = `${field}.performers[${performerIndex}]`, performer = record(raw, path)
    const commonFields = ['performerKind','performerId','displayName','level','portraitUrl','moves','dicePools','providerIds'] as const
    if (performer.performerKind === 'pokemon') {
      exact(performer, [...commonFields, 'pokemonSheetSlug','pokemonSheetRevision','species'], path)
      safeText(performer.pokemonSheetSlug, `${path}.pokemonSheetSlug`, 160, true); safeInteger(performer.pokemonSheetRevision, `${path}.pokemonSheetRevision`); safeText(performer.species, `${path}.species`, 160, true)
    } else if (performer.performerKind === 'trainer') {
      exact(performer, [...commonFields, 'trainerSheetSlug','trainerSheetRevision'], path)
      safeText(performer.trainerSheetSlug, `${path}.trainerSheetSlug`, 160, true); safeInteger(performer.trainerSheetRevision, `${path}.trainerSheetRevision`)
    } else fail('contest.invalid-contestant', `${path}.performerKind`, 'must identify a Pokémon or Trainer performer')
    const performerId = safeText(performer.performerId, `${path}.performerId`, 160, true); if (performerIds.has(performerId)) fail('contest.invalid-contestant', `${path}.performerId`, 'must be unique'); performerIds.add(performerId); if (performer.performerKind === 'pokemon') pokemonPerformerIds.add(performerId); else trainerPerformerIds.add(performerId)
    safeText(performer.displayName, `${path}.displayName`, 160, true); safeInteger(performer.level, `${path}.level`, 1, 100)
    if (performer.portraitUrl !== null) safeText(performer.portraitUrl, `${path}.portraitUrl`, 2_000, true)
    const moves = array(performer.moves, `${path}.moves`, 100), optionIds = new Set<string>()
    for (const [moveIndex, rawMove] of moves.entries()) {
      const movePath = `${path}.moves[${moveIndex}]`, move = record(rawMove, movePath)
      exact(move, ['optionId','canonicalMoveId','label','typeId','effectId','tags','source','available','unavailableCode','unavailableReason'], movePath)
      const optionId = safeText(move.optionId, `${movePath}.optionId`, 240, true); if (optionIds.has(optionId)) fail('contest.invalid-option', `${movePath}.optionId`, 'must be unique'); optionIds.add(optionId)
      safeText(move.canonicalMoveId, `${movePath}.canonicalMoveId`, 240, true); safeText(move.label, `${movePath}.label`, 160, true); if (!['sheet','style-feature','created-move'].includes(String(move.source)) || performer.performerKind === 'trainer' && move.source !== 'sheet' || typeof move.available !== 'boolean') fail('contest.invalid-option', movePath, 'has invalid source or availability')
      const tags = array(move.tags, `${movePath}.tags`, 20); tags.forEach((tag, tagIndex) => safeText(tag, `${movePath}.tags[${tagIndex}]`, 80, true)); if (new Set(tags).size !== tags.length) fail('contest.invalid-option', `${movePath}.tags`, 'must be unique')
      if (move.available && (!isContestStatId(move.typeId) || !isContestEffectId(move.effectId) || move.unavailableCode !== null || move.unavailableReason !== null)) fail('contest.invalid-option', movePath, 'available option needs canonical type and effect without unavailable evidence')
      if (!move.available && (move.typeId !== null && !isContestStatId(move.typeId) || move.effectId !== null && !isContestEffectId(move.effectId) || move.unavailableCode === null || move.unavailableReason === null)) fail('contest.invalid-option', movePath, 'has invalid optional identity or missing safe unavailable evidence')
      if (move.unavailableCode !== null) safeText(move.unavailableCode, `${movePath}.unavailableCode`, 160, true); if (move.unavailableReason !== null) safeText(move.unavailableReason, `${movePath}.unavailableReason`, 1_000, true)
    }
    const pools = record(performer.dicePools, `${path}.dicePools`); exact(pools, CONTEST_STAT_IDS, `${path}.dicePools`); for (const statId of CONTEST_STAT_IDS) validateDicePool(pools[statId], `${path}.dicePools.${statId}`)
    if (performer.performerKind === 'trainer' && CONTEST_STAT_IDS.some(statId => { const pool = pools[statId] as Record<string, unknown>; return pool.total !== 0 || pool.remaining !== 0 || (pool.contributors as unknown[]).length !== 0 })) fail('contest.invalid-contestant', `${path}.dicePools`, 'Trainer performers cannot retain a parallel Contest dice pool')
    const providers = array(performer.providerIds, `${path}.providerIds`, 500); providers.forEach((provider, providerIndex) => safeText(provider, `${path}.providerIds[${providerIndex}]`, 240, true)); if (new Set(providers).size !== providers.length) fail('contest.invalid-contestant', `${path}.providerIds`, 'must be unique')
  }
  const rotationOrder = array(row.rotationOrder, `${field}.rotationOrder`, 5); rotationOrder.forEach((performerIndex, orderIndex) => safeInteger(performerIndex, `${field}.rotationOrder[${orderIndex}]`, 0, performers.length - 1)); if (new Set(rotationOrder).size !== rotationOrder.length) fail('contest.invalid-contestant', `${field}.rotationOrder`, 'must not repeat performers')
  if (row.letter !== null && !CONTEST_LETTERS.includes(row.letter as ContestLetter)) fail('contest.invalid-letter', `${field}.letter`, 'must be A through E or null')
  const skillDice = record(row.introductionSkillDice, `${field}.introductionSkillDice`); exact(skillDice, ['charm','command','guile','intimidate','intuition'], `${field}.introductionSkillDice`); for (const skillId of ['charm','command','guile','intimidate','intuition']) safeInteger(skillDice[skillId], `${field}.introductionSkillDice.${skillId}`, 1, 6)
  const introduction = record(row.introduction, `${field}.introduction`); exact(introduction, ['status','performerId','skillId','generatedStatId','skillRankDice','bonusDice','results','generatedDice','matchingAppealBonus','letterTotal','operationId'], `${field}.introduction`)
  if (!['pending','accepted'].includes(String(introduction.status))) fail('contest.invalid-contestant', `${field}.introduction.status`, 'is invalid'); if (introduction.performerId !== null) safeText(introduction.performerId, `${field}.introduction.performerId`, 160, true); if (introduction.skillId !== null && !['charm','command','guile','intimidate','intuition'].includes(String(introduction.skillId))) fail('contest.invalid-contestant', `${field}.introduction.skillId`, 'is invalid'); if (introduction.generatedStatId !== null && !isContestStatId(introduction.generatedStatId)) fail('contest.invalid-contestant', `${field}.introduction.generatedStatId`, 'is invalid')
  safeInteger(introduction.skillRankDice, `${field}.introduction.skillRankDice`, 0, 6); safeInteger(introduction.bonusDice, `${field}.introduction.bonusDice`, 0, 20); array(introduction.results, `${field}.introduction.results`, 26).forEach((die, dieIndex) => safeInteger(die, `${field}.introduction.results[${dieIndex}]`, 1, 6)); safeInteger(introduction.generatedDice, `${field}.introduction.generatedDice`, 0, 26); safeInteger(introduction.matchingAppealBonus, `${field}.introduction.matchingAppealBonus`, 0, 10); safeInteger(introduction.letterTotal, `${field}.introduction.letterTotal`, 0, 40); if (introduction.operationId !== null) parseContestOperationId(introduction.operationId, `${field}.introduction.operationId`)
  if (introduction.status === 'accepted' && (introduction.skillId === null || introduction.generatedStatId === null || introduction.operationId === null)) fail('contest.invalid-contestant', `${field}.introduction`, 'accepted state needs complete evidence')
  safeInteger(row.appeal, `${field}.appeal`, 0, 1_000_000); safeInteger(row.fumble, `${field}.fumble`, 0, 1_000_000); safeInteger(row.voltage, `${field}.voltage`, contestCatalog.performance.voltage.minimum, contestCatalog.performance.voltage.maximum)
  const performerVoltages = record(row.performerVoltages, `${field}.performerVoltages`); for (const [performerId, voltage] of Object.entries(performerVoltages)) { safeText(performerId, `${field}.performerVoltages.${performerId}`, 160, true); safeInteger(voltage, `${field}.performerVoltages.${performerId}`, contestCatalog.performance.voltage.minimum, contestCatalog.performance.voltage.maximum) }
  if (row.lastMoveOptionId !== null) safeText(row.lastMoveOptionId, `${field}.lastMoveOptionId`, 240, true); const used = array(row.usedInterventionIds, `${field}.usedInterventionIds`, 100); const interventionIds = new Set(['Coordinator','Adaptable Performance','Fabulous Max','Rule of Cool','Gleeful Steps','Calculated Assault','Macho Charge','Fashion Designer','Beautiful','Style Flourish','Contest Fashion']); used.forEach((id, usedIndex) => { const value = safeText(id, `${field}.usedInterventionIds[${usedIndex}]`, 160, true), scoped = /^(Beautiful|Contest Fashion)@(.+)$/u.exec(value); if (!interventionIds.has(value) && (!scoped || !performerIds.has(scoped[2]!))) fail('contest.invalid-contestant', `${field}.usedInterventionIds[${usedIndex}]`, 'is not a selectable Contest intervention or enrolled provider identity') }); if (new Set(used).size !== used.length) fail('contest.invalid-contestant', `${field}.usedInterventionIds`, 'must be unique')
  const teamPools = record(row.teamDicePools, `${field}.teamDicePools`); exact(teamPools, CONTEST_STAT_IDS, `${field}.teamDicePools`); for (const statId of CONTEST_STAT_IDS) validateDicePool(teamPools[statId], `${field}.teamDicePools.${statId}`)
  const sharedSpends = array(row.sharedDiceSpendJournal, `${field}.sharedDiceSpendJournal`, 10_000)
  const spendIds = new Set<string>(), spendOperationIds = new Set<string>()
  for (const [spendIndex, rawSpend] of sharedSpends.entries()) {
    const spendPath = `${field}.sharedDiceSpendJournal[${spendIndex}]`, spend = record(rawSpend, spendPath)
    exact(spend, ['spendId','operationId','performerId','pokemonPerformerId','sourcePolicy','spentDice','pokemonSpentDice','teamSpentDice','pokemonRemainingBefore','pokemonRemainingAfter','teamRemainingBefore','teamRemainingAfter','createdAt'], spendPath)
    const spendId = safeText(spend.spendId, `${spendPath}.spendId`, 240, true); if (spendIds.has(spendId)) fail('contest.invalid-contestant', `${spendPath}.spendId`, 'must be unique'); spendIds.add(spendId)
    const operationId = parseContestOperationId(spend.operationId, `${spendPath}.operationId`); if (spendOperationIds.has(operationId)) fail('contest.invalid-contestant', `${spendPath}.operationId`, 'must be unique'); spendOperationIds.add(operationId); if (spendId !== `${operationId}:shared-dice`) fail('contest.invalid-contestant', `${spendPath}.spendId`, 'must derive from the accepted operation identity')
    const performerId = safeText(spend.performerId, `${spendPath}.performerId`, 160, true); if (!performerIds.has(performerId)) fail('contest.invalid-contestant', `${spendPath}.performerId`, 'must identify an enrolled performer')
    const pokemonPerformerId = safeText(spend.pokemonPerformerId, `${spendPath}.pokemonPerformerId`, 160, true); if (!pokemonPerformerIds.has(pokemonPerformerId) || performerId !== pokemonPerformerId && !trainerPerformerIds.has(performerId)) fail('contest.invalid-contestant', `${spendPath}.pokemonPerformerId`, 'must bind the acting Trainer or that exact enrolled Pokémon to one Pokémon preparation pool')
    if (spend.sourcePolicy !== 'trainer-pokemon-entry') fail('contest.invalid-contestant', `${spendPath}.sourcePolicy`, 'must use the canonical Trainer Participant pool')
    const spentDice = record(spend.spentDice, `${spendPath}.spentDice`), pokemonSpentDice = record(spend.pokemonSpentDice, `${spendPath}.pokemonSpentDice`), teamSpentDice = record(spend.teamSpentDice, `${spendPath}.teamSpentDice`)
    const pokemonRemainingBefore = record(spend.pokemonRemainingBefore, `${spendPath}.pokemonRemainingBefore`), pokemonRemainingAfter = record(spend.pokemonRemainingAfter, `${spendPath}.pokemonRemainingAfter`), teamRemainingBefore = record(spend.teamRemainingBefore, `${spendPath}.teamRemainingBefore`), teamRemainingAfter = record(spend.teamRemainingAfter, `${spendPath}.teamRemainingAfter`)
    for (const [label, values] of Object.entries({ spentDice, pokemonSpentDice, teamSpentDice, pokemonRemainingBefore, pokemonRemainingAfter, teamRemainingBefore, teamRemainingAfter })) exact(values, CONTEST_STAT_IDS, `${spendPath}.${label}`)
    let spentTotal = 0
    for (const statId of CONTEST_STAT_IDS) {
      const spent = safeInteger(spentDice[statId], `${spendPath}.spentDice.${statId}`, 0, contestCatalog.performance.contestDiceSpendMaximumPerAppeal)
      const pokemonSpent = safeInteger(pokemonSpentDice[statId], `${spendPath}.pokemonSpentDice.${statId}`, 0, contestCatalog.performance.contestDiceSpendMaximumPerAppeal)
      const teamSpent = safeInteger(teamSpentDice[statId], `${spendPath}.teamSpentDice.${statId}`, 0, contestCatalog.performance.contestDiceSpendMaximumPerAppeal)
      const pokemonBefore = safeInteger(pokemonRemainingBefore[statId], `${spendPath}.pokemonRemainingBefore.${statId}`, 0, 1_000), pokemonAfter = safeInteger(pokemonRemainingAfter[statId], `${spendPath}.pokemonRemainingAfter.${statId}`, 0, 1_000)
      const teamBefore = safeInteger(teamRemainingBefore[statId], `${spendPath}.teamRemainingBefore.${statId}`, 0, 1_000), teamAfter = safeInteger(teamRemainingAfter[statId], `${spendPath}.teamRemainingAfter.${statId}`, 0, 1_000)
      if (pokemonSpent + teamSpent !== spent || pokemonAfter !== pokemonBefore - pokemonSpent || teamAfter !== teamBefore - teamSpent || teamSpent !== Math.min(teamBefore, spent)) fail('contest.invalid-contestant', `${spendPath}.${statId}`, 'must apply one shared-first spend across the paired Pokémon and Rotation team pools')
      spentTotal += spent
    }
    if (spentTotal < 1 || spentTotal > contestCatalog.performance.contestDiceSpendMaximumPerAppeal) fail('contest.invalid-contestant', `${spendPath}.spentDice`, 'must record one bounded accepted spend')
    safeInteger(spend.createdAt, `${spendPath}.createdAt`)
  }
  safeInteger(row.teamContestDiceSpent, `${field}.teamContestDiceSpent`, 0, 1_000)
  const pending = record(row.pendingEffects, `${field}.pendingEffects`); exact(pending, ['nextRoundBaseMoveDiceMultiplier','fumbleProtectionRound','nextAppealAlignmentSteps','nextAppealAlignmentTypeId','nextAppealBonusDice','nextAppealTypeId','nextAppealEffectId','fixedAppealPerDie','targetPerformerId','blockedMoveOptionIds','blockedMoveRound','blockedMovePerformerId'], `${field}.pendingEffects`)
  safeInteger(pending.nextRoundBaseMoveDiceMultiplier, `${field}.pendingEffects.nextRoundBaseMoveDiceMultiplier`, 1, 2); if (pending.fumbleProtectionRound !== null) safeInteger(pending.fumbleProtectionRound, `${field}.pendingEffects.fumbleProtectionRound`, 1, 100); const alignmentSteps = safeInteger(pending.nextAppealAlignmentSteps, `${field}.pendingEffects.nextAppealAlignmentSteps`, 0, 1); if (pending.nextAppealAlignmentTypeId !== null && !isContestStatId(pending.nextAppealAlignmentTypeId)) fail('contest.invalid-contestant', `${field}.pendingEffects.nextAppealAlignmentTypeId`, 'is invalid'); safeInteger(pending.nextAppealBonusDice, `${field}.pendingEffects.nextAppealBonusDice`, 0, 2); if (pending.targetPerformerId !== null && !performerIds.has(safeText(pending.targetPerformerId, `${field}.pendingEffects.targetPerformerId`, 160, true))) fail('contest.invalid-contestant', `${field}.pendingEffects.targetPerformerId`, 'must identify an enrolled performer'); if (pending.nextAppealTypeId !== null && !isContestStatId(pending.nextAppealTypeId)) fail('contest.invalid-contestant', `${field}.pendingEffects.nextAppealTypeId`, 'is invalid'); if (pending.nextAppealEffectId !== null && !isContestEffectId(pending.nextAppealEffectId)) fail('contest.invalid-contestant', `${field}.pendingEffects.nextAppealEffectId`, 'is invalid'); if (typeof pending.fixedAppealPerDie !== 'boolean') fail('contest.invalid-contestant', `${field}.pendingEffects.fixedAppealPerDie`, 'must be boolean'); const blockedMoveOptionIds = array(pending.blockedMoveOptionIds, `${field}.pendingEffects.blockedMoveOptionIds`, 2); blockedMoveOptionIds.forEach((id, blockedIndex) => safeText(id, `${field}.pendingEffects.blockedMoveOptionIds[${blockedIndex}]`, 240, true)); if (pending.blockedMoveRound !== null) safeInteger(pending.blockedMoveRound, `${field}.pendingEffects.blockedMoveRound`, 1, 100); if (pending.blockedMovePerformerId !== null) safeText(pending.blockedMovePerformerId, `${field}.pendingEffects.blockedMovePerformerId`, 160, true)
  if ((alignmentSteps === 0) !== (pending.nextAppealAlignmentTypeId === null) || (pending.nextAppealTypeId === null) !== (pending.nextAppealEffectId === null) || (blockedMoveOptionIds.length === 0) !== (pending.blockedMoveRound === null && pending.blockedMovePerformerId === null) || blockedMoveOptionIds.length > 0 && (blockedMoveOptionIds.length !== 2 || new Set(blockedMoveOptionIds).size !== 2 || pending.blockedMoveRound === null || pending.blockedMovePerformerId === null)) fail('contest.invalid-contestant', `${field}.pendingEffects`, 'contains inconsistent intervention evidence')
  if (typeof row.withdrawn !== 'boolean') fail('contest.invalid-contestant', `${field}.withdrawn`, 'must be boolean'); if (row.finalPlacement !== null) safeInteger(row.finalPlacement, `${field}.finalPlacement`, 1, 5); if (row.finalScore !== null) { safeInteger(row.finalScore, `${field}.finalScore`, -1_000_000, 1_000_000); if (row.finalScore !== Number(row.appeal) - Number(row.fumble)) fail('contest.invalid-contestant', `${field}.finalScore`, 'must equal Appeal minus Fumble') }
  return row as unknown as ContestantStateV1
}

const validateJournal = (value: unknown, index: number): ContestDiceJournalEntryV1 => {
  const field = `diceJournal[${index}]`, row = record(value, field)
  exact(row, ['journalId','operationId','purpose','contestantId','round','dieSides','results','rerolledDieIndices','replacesJournalId','createdAt'], field)
  safeText(row.journalId, `${field}.journalId`, 240, true); parseContestOperationId(row.operationId, `${field}.operationId`)
  if (!['introduction','introduction-bonus','letter-tie','appeal','appeal-reroll','supercontest-type','placement-tie'].includes(String(row.purpose))) fail('contest.invalid-document', `${field}.purpose`, 'is invalid')
  if (row.contestantId !== null) parseContestantId(row.contestantId, `${field}.contestantId`)
  if (row.round !== null) safeInteger(row.round, `${field}.round`, 1, 100)
  const sides = safeInteger(row.dieSides, `${field}.dieSides`, 2, 100)
  const results = array(row.results, `${field}.results`, 1_000); for (const [resultIndex, result] of results.entries()) safeInteger(result, `${field}.results[${resultIndex}]`, 1, sides)
  if (row.rerolledDieIndices !== undefined) { const indices = array(row.rerolledDieIndices, `${field}.rerolledDieIndices`, 1_000); indices.forEach((dieIndex, index) => safeInteger(dieIndex, `${field}.rerolledDieIndices[${index}]`, 0, 999)); if (new Set(indices).size !== indices.length) fail('contest.invalid-document', `${field}.rerolledDieIndices`, 'must be unique'); if (row.purpose !== 'appeal-reroll' && indices.length) fail('contest.invalid-document', `${field}.rerolledDieIndices`, 'is available only for appeal rerolls') }
  if (row.replacesJournalId !== null) safeText(row.replacesJournalId, `${field}.replacesJournalId`, 240, true)
  const purpose = String(row.purpose)
  const introductionPurpose = purpose === 'introduction' || purpose === 'introduction-bonus'
  const appealPurpose = purpose === 'appeal' || purpose === 'appeal-reroll'
  const tiePurpose = purpose === 'letter-tie' || purpose === 'placement-tie'
  if (introductionPurpose && (row.contestantId === null || row.round !== null || sides !== 6)
    || appealPurpose && (row.contestantId === null || row.round === null || sides !== 6)
    || tiePurpose && (row.contestantId !== null || sides !== 2)
    || purpose === 'letter-tie' && row.round !== null
    || purpose === 'placement-tie' && row.round === null
    || purpose === 'supercontest-type' && (row.contestantId !== null || row.round === null || sides !== 6)) fail('contest.invalid-document', field, 'has invalid purpose-specific dice evidence')
  if (purpose === 'appeal-reroll' ? row.replacesJournalId === null : row.replacesJournalId !== null) fail('contest.invalid-document', `${field}.replacesJournalId`, 'does not match the journal purpose')
  if (purpose === 'supercontest-type' && (!results.length || results.length > 100 || results.at(-1) === 6 || results.slice(0, -1).some(result => result !== 6))) fail('contest.invalid-document', `${field}.results`, 'must contain bounded six rerolls followed by one mapped type result')
  safeInteger(row.createdAt, `${field}.createdAt`)
  return row as unknown as ContestDiceJournalEntryV1
}

const validateAppeal = (value: unknown, index: number, journalsById: ReadonlyMap<string, ContestDiceJournalEntryV1>): ContestAppealLedgerEntryV1 => {
  const field = `appealLedger[${index}]`, row = record(value, field)
  exact(row, ['appealId','operationId','round','turn','contestantId','performerId','moveOptionId','moveLabel','moveTypeId','contestTypeId','effectId','partnerEffectTargetPerformerId','centerOfAttention','adjacentContestantIds','spentDice','contributors','baseMoveDiceMultiplier','assembledDice','journalIds','acceptedResults','appealDelta','fumbleDelta','voltageBefore','voltageAfter','consequences','acceptedAt','correctionIds'], field)
  parseContestAppealId(row.appealId, `${field}.appealId`); parseContestOperationId(row.operationId, `${field}.operationId`); parseContestantId(row.contestantId, `${field}.contestantId`)
  safeInteger(row.round, `${field}.round`, 1, 100); safeInteger(row.turn, `${field}.turn`, 1, 5)
  safeText(row.performerId, `${field}.performerId`, 160, true); safeText(row.moveOptionId, `${field}.moveOptionId`, 240, true); safeText(row.moveLabel, `${field}.moveLabel`, 160, true); if (row.partnerEffectTargetPerformerId !== null) safeText(row.partnerEffectTargetPerformerId, `${field}.partnerEffectTargetPerformerId`, 160, true)
  if (!isContestStatId(row.moveTypeId) || !isContestStatId(row.contestTypeId) || !isContestEffectId(row.effectId)) fail('contest.invalid-document', field, 'has noncanonical Move identity')
  if (typeof row.centerOfAttention !== 'boolean') fail('contest.invalid-document', `${field}.centerOfAttention`, 'must be boolean')
  const adjacent = array(row.adjacentContestantIds, `${field}.adjacentContestantIds`, 2); adjacent.forEach((id, adjacentIndex) => parseContestantId(id, `${field}.adjacentContestantIds[${adjacentIndex}]`)); if (new Set(adjacent).size !== adjacent.length || adjacent.includes(row.contestantId)) fail('contest.invalid-document', `${field}.adjacentContestantIds`, 'must be unique competitors')
  const spent = record(row.spentDice, `${field}.spentDice`); exact(spent, CONTEST_STAT_IDS, `${field}.spentDice`); let spentTotal = 0; for (const statId of CONTEST_STAT_IDS) spentTotal += safeInteger(spent[statId], `${field}.spentDice.${statId}`, 0, 3); if (spentTotal > contestCatalog.performance.contestDiceSpendMaximumPerAppeal) fail('contest.invalid-document', `${field}.spentDice`, 'exceeds the per-appeal cap')
  const baseMoveDiceMultiplier = safeInteger(row.baseMoveDiceMultiplier, `${field}.baseMoveDiceMultiplier`, 1, 2); if (baseMoveDiceMultiplier !== 1 && baseMoveDiceMultiplier !== 2) fail('contest.invalid-document', `${field}.baseMoveDiceMultiplier`, 'must be one or two')
  const assembled = safeInteger(row.assembledDice, `${field}.assembledDice`, 0, 1_000)
  const accepted = array(row.acceptedResults, `${field}.acceptedResults`, 1_000); if (accepted.length !== assembled) fail('contest.invalid-document', `${field}.acceptedResults`, 'must match assembled dice'); accepted.forEach((die, dieIndex) => safeInteger(die, `${field}.acceptedResults[${dieIndex}]`, 0, 6))
  const appealJournalIds = array(row.journalIds, `${field}.journalIds`, 100); if (!appealJournalIds.length || new Set(appealJournalIds).size !== appealJournalIds.length) fail('contest.invalid-document', `${field}.journalIds`, 'must contain unique appeal evidence')
  const appealJournals = appealJournalIds.map((id, journalIndex) => {
    if (typeof id !== 'string' || !journalsById.has(id)) return fail('contest.invalid-document', `${field}.journalIds`, 'references missing evidence')
    const journal = journalsById.get(id)!
    if (journal.contestantId !== row.contestantId || journal.round !== row.round || journal.purpose !== (journalIndex === 0 ? 'appeal' : 'appeal-reroll')) fail('contest.invalid-document', `${field}.journalIds[${journalIndex}]`, 'does not match this appeal')
    if (journalIndex === 0 && journal.operationId !== row.operationId) fail('contest.invalid-document', `${field}.journalIds[0]`, 'does not match the accepting operation')
    if (journalIndex > 0 && journal.replacesJournalId !== appealJournalIds[journalIndex - 1]) fail('contest.invalid-document', `${field}.journalIds[${journalIndex}]`, 'has invalid replacement lineage')
    return journal
  })
  if (accepted.some(value => value === 0) && (accepted.some(value => value !== 0) || appealJournals[0]!.results.length !== 0)) fail('contest.invalid-document', `${field}.acceptedResults`, 'fixed appeal evidence must be entirely deterministic')
  const fixedEvidence = accepted.length > 0 && accepted.every(value => value === 0)
  const exactJournalEvidence = appealJournals.every(journal => journal.rerolledDieIndices !== undefined)
  if (!fixedEvidence && appealJournals[0]!.results.length !== assembled) fail('contest.invalid-document', `${field}.journalIds[0]`, 'does not cover the assembled appeal dice')
  if (!fixedEvidence && appealJournals.length === 1 && appealJournals[0]!.results.join(',') !== accepted.join(',')) fail('contest.invalid-document', `${field}.acceptedResults`, 'does not match immutable journal evidence')
  if (!fixedEvidence && exactJournalEvidence) {
    const reconstructed = [...appealJournals[0]!.results]
    for (const journal of appealJournals.slice(1)) {
      const indices = journal.rerolledDieIndices!
      if (indices.length !== journal.results.length || indices.some(dieIndex => dieIndex >= assembled)) fail('contest.invalid-document', `${field}.journalIds`, 'contains impossible reroll positions')
      indices.forEach((dieIndex, resultIndex) => { reconstructed[dieIndex] = journal.results[resultIndex]! })
    }
    if (reconstructed.join(',') !== accepted.join(',')) fail('contest.invalid-document', `${field}.acceptedResults`, 'does not match immutable journal evidence')
  }
  const contributors = array(row.contributors, `${field}.contributors`, 100), normalizedContributors: Record<string, unknown>[] = []; let contributorTotal = 0
  for (const [contributorIndex, raw] of contributors.entries()) {
    const path = `${field}.contributors[${contributorIndex}]`, contributor = record(raw, path); exact(contributor, ['id','label','kind','dice','explanation'], path)
    safeText(contributor.id, `${path}.id`, 240, true); safeText(contributor.label, `${path}.label`, 160, true); if (!['base','contest-stat','voltage','type','effect','feature','ability','item'].includes(String(contributor.kind))) fail('contest.invalid-document', `${path}.kind`, 'is invalid'); contributorTotal += safeInteger(contributor.dice, `${path}.dice`, -1000, 1000); safeText(contributor.explanation, `${path}.explanation`, 1_000, true); normalizedContributors.push(contributor)
  }
  const contributorById = new Map(normalizedContributors.map(contributor => [String(contributor.id), contributor])); if (contributorById.size !== normalizedContributors.length) fail('contest.invalid-document', `${field}.contributors`, 'must use unique canonical contributor identities')
  const baseContributor = contributorById.get(`effect:${row.effectId}`), typeContributor = contributorById.get(`type:${row.moveTypeId}:${row.contestTypeId}`), spentContributor = contributorById.get('contest-stat-spend'), voltageContributor = contributorById.get('start-voltage'), voiceContributor = contributorById.get('feature:Voice Lessons'), interventionContributor = contributorById.get('accepted-intervention')
  const allowedContributorIds = new Set([`effect:${row.effectId}`, `type:${row.moveTypeId}:${row.contestTypeId}`, 'contest-stat-spend', 'start-voltage', 'feature:Voice Lessons', 'accepted-intervention'])
  const contestType = contestCatalog.contestStats.find(stat => stat.id === row.contestTypeId)!, baselineTypeDice = row.moveTypeId === row.contestTypeId ? 1 : contestType.alliedStatIds.includes(row.moveTypeId as ContestStatId) ? 0 : -1, improvedTypeDice = baselineTypeDice < 1 ? baselineTypeDice + 1 : 1
  if (normalizedContributors.some(contributor => !allowedContributorIds.has(String(contributor.id))) || !baseContributor || baseContributor.kind !== 'base' || Number(baseContributor.dice) < 0 || !typeContributor || typeContributor.kind !== 'type' || ![baselineTypeDice, improvedTypeDice].includes(Number(typeContributor.dice)) || (spentTotal > 0) !== Boolean(spentContributor) || spentContributor && (spentContributor.kind !== 'contest-stat' || spentContributor.dice !== spentTotal) || (Number(row.voltageBefore) > 0) !== Boolean(voltageContributor) || voltageContributor && (voltageContributor.kind !== 'voltage' || voltageContributor.dice !== Number(row.voltageBefore) * contestCatalog.performance.voltage.startOfTurnBonusDicePerPoint) || voiceContributor && (voiceContributor.kind !== 'feature' || voiceContributor.dice !== 1) || interventionContributor && (interventionContributor.kind !== 'feature' || interventionContributor.dice !== 2)) fail('contest.invalid-document', `${field}.contributors`, 'do not match canonical appeal assembly sources')
  if ((baseMoveDiceMultiplier === 2) !== String(baseContributor!.explanation).includes('×2')) fail('contest.invalid-document', `${field}.baseMoveDiceMultiplier`, 'does not match the immutable base contributor explanation')
  if (Math.max(0, contributorTotal) !== assembled) fail('contest.invalid-document', `${field}.contributors`, 'must assemble the accepted dice count')
  const fixedRoll = accepted.length === assembled && accepted.length > 0 && accepted.every(value => value === 0)
  let expectedAppeal = 0, expectedFumble = 0
  if (fixedRoll) expectedAppeal = assembled
  else if (row.effectId === 'safe-option') expectedAppeal = accepted.filter(value => value === 6).length
  else if (row.effectId === 'sabotage') { expectedAppeal = 0; expectedFumble = 0 }
  else if (row.effectId === 'tease') { expectedAppeal = accepted.filter(value => Number(value) >= 5).length; expectedFumble = row.centerOfAttention ? accepted.filter(value => value === 1).length : 0 }
  else {
    const table = row.centerOfAttention ? contestCatalog.performance.centerScoring : contestCatalog.performance.normalScoring
    for (const value of accepted) { expectedAppeal += table[String(value)]?.appeal ?? 0; expectedFumble += table[String(value)]?.fumble ?? 0 }
    if (row.effectId === 'desperation') { expectedAppeal += accepted.filter(value => value === 6).length; expectedFumble += accepted.filter(value => value === 1).length }
  }
  const moveStat = contestCatalog.contestStats.find(stat => stat.id === row.moveTypeId)!
  const opposed = row.moveTypeId !== row.contestTypeId && !contestCatalog.contestStats.find(stat => stat.id === row.contestTypeId)!.alliedStatIds.includes(row.moveTypeId as ContestStatId)
  if (contributorTotal <= 0 && opposed) expectedFumble += 1
  const appealDelta = safeInteger(row.appealDelta, `${field}.appealDelta`, 0, 1_000_000), fumbleDelta = safeInteger(row.fumbleDelta, `${field}.fumbleDelta`, 0, 1_000_000)
  if (!moveStat || appealDelta !== expectedAppeal || fumbleDelta !== expectedFumble) fail('contest.invalid-document', field, 'score deltas do not match accepted roll evidence')
  safeInteger(row.voltageBefore, `${field}.voltageBefore`, 0, 5); safeInteger(row.voltageAfter, `${field}.voltageAfter`, 0, 5)
  const consequenceReasons: Partial<Record<ContestEffectId, string>> = { 'big-show': 'Big Show', excitement: 'Excitement', 'steady-performance': 'Steady Performance', 'special-attention': 'Special Attention', unsettling: 'Unsettling', incentives: 'Incentives', gamble: 'Gamble', reliable: 'Reliable repeat', 'catching-up': 'Catching Up', 'good-show': 'Good Show', 'exhausting-act': 'Exhausting Act', 'attention-grabber': 'Attention Grabber', sabotage: 'Sabotage', tease: 'Tease', 'saving-grace': 'Saving Grace' }
  const consequences = array(row.consequences, `${field}.consequences`, 20); const consequenceKeys = new Set<string>(); for (const [consequenceIndex, raw] of consequences.entries()) {
    const path = `${field}.consequences[${consequenceIndex}]`, consequence = record(raw, path); exact(consequence, ['contestantId','performerId','appealDelta','fumbleDelta','voltageDelta','reason'], path)
    const targetId = parseContestantId(consequence.contestantId, `${path}.contestantId`), performerId = consequence.performerId === null ? null : safeText(consequence.performerId, `${path}.performerId`, 160, true), appealChange = safeInteger(consequence.appealDelta, `${path}.appealDelta`, -1_000_000, 1_000_000), fumbleChange = safeInteger(consequence.fumbleDelta, `${path}.fumbleDelta`, -1_000_000, 1_000_000), voltageChange = safeInteger(consequence.voltageDelta, `${path}.voltageDelta`, -5, 5), reason = safeText(consequence.reason, `${path}.reason`, 500, true)
    const expectedReason = consequenceReasons[row.effectId as ContestEffectId]
    const consequenceKey = `${targetId}:${performerId ?? 'shared'}:${reason}`; if (consequenceKeys.has(consequenceKey)) fail('contest.invalid-document', path, 'duplicates canonical effect evidence'); consequenceKeys.add(consequenceKey)
    if (!expectedReason || reason !== expectedReason || appealChange !== 0) fail('contest.invalid-document', path, 'does not match the canonical Contest effect')
    const adjacentOnly = ['special-attention','sabotage','tease'].includes(String(row.effectId))
    const actorOnly = ['big-show','excitement','steady-performance','gamble','reliable','catching-up','good-show','exhausting-act','saving-grace'].includes(String(row.effectId))
    if (adjacentOnly && !adjacent.includes(targetId) || actorOnly && targetId !== row.contestantId || !adjacentOnly && !actorOnly && targetId !== row.contestantId && !adjacent.includes(targetId)) fail('contest.invalid-document', `${path}.contestantId`, 'is not a canonical effect target')
    if (performerId !== null && (appealChange !== 0 || fumbleChange !== 0) || !['sabotage','tease','saving-grace'].includes(String(row.effectId)) && fumbleChange !== 0 || ['sabotage','tease'].includes(String(row.effectId)) && (fumbleChange < 0 || voltageChange !== 0) || row.effectId === 'saving-grace' && (fumbleChange > 0 || voltageChange !== 0 || -fumbleChange > Number(row.voltageBefore))) fail('contest.invalid-document', path, 'has an invalid effect delta kind')
    const indirectFumble = row.effectId === 'sabotage' ? accepted.length : row.effectId === 'tease' ? accepted.filter(value => value === 6).length : null
    if (indirectFumble !== null && fumbleChange !== 0 && fumbleChange !== indirectFumble) fail('contest.invalid-document', path, 'does not match the accepted indirect Fumble evidence')
  }
  if ((row.effectId === 'sabotage' || row.effectId === 'tease') && adjacent.some(targetId => !consequenceKeys.has(`${targetId}:shared:${row.effectId === 'sabotage' ? 'Sabotage' : 'Tease'}`))) fail('contest.invalid-document', `${field}.consequences`, 'must cover every adjacent indirect Fumble target')
  {
    const actorRows = consequences.map(raw => raw as Record<string, unknown>).filter(consequence => consequence.contestantId === row.contestantId && (consequence.performerId === null || consequence.performerId === row.performerId))
    let expectedVoltage = Number(row.voltageBefore)
    if (row.effectId === 'saving-grace') { const removed = -actorRows.reduce((sum, consequence) => sum + Number(consequence.fumbleDelta), 0); if (removed <= 2) expectedVoltage = Math.min(5, expectedVoltage + 1) }
    expectedVoltage = Math.max(0, Math.min(5, expectedVoltage + actorRows.reduce((sum, consequence) => sum + Number(consequence.voltageDelta), 0)))
    if (row.effectId === 'get-ready' || row.effectId === 'double-time') expectedVoltage = Math.max(0, expectedVoltage - 2)
    if (row.effectId === 'seen-nothing-yet') expectedVoltage = 0
    if (Number(row.voltageAfter) !== expectedVoltage) fail('contest.invalid-document', `${field}.voltageAfter`, 'does not match canonical effect consequences')
  }
  safeInteger(row.acceptedAt, `${field}.acceptedAt`); const correctionIds = array(row.correctionIds, `${field}.correctionIds`, 100); correctionIds.forEach((id, correctionIndex) => safeText(id, `${field}.correctionIds[${correctionIndex}]`, 240, true)); if (new Set(correctionIds).size !== correctionIds.length) fail('contest.invalid-document', `${field}.correctionIds`, 'must be unique')
  return row as unknown as ContestAppealLedgerEntryV1
}

const validateSettlement = (value: unknown, contestantIds: ReadonlySet<string>): ContestSettlementV1 | null => {
  if (value === null) return null
  const row = record(value, 'settlement'); exact(row, ['settlementId','status','entries','money','items','attentionItemIds','committedOperationId','committedAt'], 'settlement')
  safeText(row.settlementId, 'settlement.settlementId', 240, true); if (row.status !== 'preview' && row.status !== 'committed') fail('contest.invalid-document', 'settlement.status', 'is invalid')
  const entries = array(row.entries, 'settlement.entries', 5); if (entries.length !== contestantIds.size) fail('contest.invalid-document', 'settlement.entries', 'must cover every enrolled contestant exactly once')
  const entryContestantIds: string[] = [], placements: number[] = []
  for (const [index, raw] of entries.entries()) {
    const path = `settlement.entries[${index}]`, entry = record(raw, path); exact(entry, ['contestantId','placement','finalScore','experienceByPokemon','ribbon','trainerSheetSlug'], path)
    const id = parseContestantId(entry.contestantId); if (!contestantIds.has(id)) fail('contest.invalid-document', `${path}.contestantId`, 'is not enrolled'); entryContestantIds.push(id)
    const placement = safeInteger(entry.placement, `${path}.placement`, 1, contestantIds.size); placements.push(placement); safeInteger(entry.finalScore, `${path}.finalScore`, -1_000_000, 1_000_000)
    const experience = array(entry.experienceByPokemon, `${path}.experienceByPokemon`, 5); if (!experience.length) fail('contest.invalid-document', `${path}.experienceByPokemon`, 'must name at least one enrolled performer')
    const pokemonSlugs: string[] = []; for (const [xpIndex, rawXp] of experience.entries()) { const xpPath = `${path}.experienceByPokemon[${xpIndex}]`, xp = record(rawXp, xpPath); exact(xp, ['pokemonSheetSlug','experience'], xpPath); pokemonSlugs.push(safeText(xp.pokemonSheetSlug, `${xpPath}.pokemonSheetSlug`, 160, true)); safeInteger(xp.experience, `${xpPath}.experience`, 0, 1_000_000_000) }; if (new Set(pokemonSlugs).size !== pokemonSlugs.length) fail('contest.invalid-document', `${path}.experienceByPokemon`, 'must contain unique Pokémon')
    if (typeof entry.ribbon !== 'boolean' || entry.ribbon && placement !== 1) fail('contest.invalid-document', `${path}.ribbon`, 'must be a first-place boolean award'); safeText(entry.trainerSheetSlug, `${path}.trainerSheetSlug`, 160, true)
  }
  if (new Set(entryContestantIds).size !== entries.length || new Set(placements).size !== entries.length) fail('contest.invalid-document', 'settlement.entries', 'must have unique contestant and placement identities')
  safeInteger(row.money, 'settlement.money', 0, 1_000_000_000); normalizeContestPrize({ declared: true, money: row.money as number, items: row.items as ContestPrizeItemV1[], notes: '' }); const attentionIds = array(row.attentionItemIds, 'settlement.attentionItemIds', 100); attentionIds.forEach((id, index) => safeText(id, `settlement.attentionItemIds[${index}]`, 240, true)); if (new Set(attentionIds).size !== attentionIds.length) fail('contest.invalid-document', 'settlement.attentionItemIds', 'must be unique')
  if (row.committedOperationId !== null) parseContestOperationId(row.committedOperationId, 'settlement.committedOperationId'); if (row.committedAt !== null) safeInteger(row.committedAt, 'settlement.committedAt')
  if ((row.status === 'committed') !== (row.committedOperationId !== null && row.committedAt !== null)) fail('contest.invalid-document', 'settlement', 'commit evidence does not match status')
  return row as unknown as ContestSettlementV1
}

export const parseContestDocument = (value: unknown): ContestDocumentV1 => {
  const input = record(value, 'contest')
  const root = structuredClone(input)
  // Schema-v1 additive compatibility: Plan 10 introduced these fields before
  // release while persisted development/backup fixtures already existed.
  if (!Object.hasOwn(root, 'pendingInterventionAppealId')) root.pendingInterventionAppealId = null
  if (!Object.hasOwn(root, 'participantVariantId')) root.participantVariantId = null
  if (!Object.hasOwn(root, 'participantMethodId')) root.participantMethodId = null
  if (!Object.hasOwn(root, 'sharedContestDicePoolScope')) root.sharedContestDicePoolScope = root.participantVariantId === 'trainer-participant' ? trainerParticipantContestVariant.sharedContestDicePool.scope : null
  for (const contestantRaw of Array.isArray(root.contestants) ? root.contestants : []) {
    if (!contestantRaw || typeof contestantRaw !== 'object' || Array.isArray(contestantRaw)) continue
    const contestant = contestantRaw as Record<string, unknown>
    if (!Object.hasOwn(contestant, 'introductionSkillDice')) {
      const skillDice: Record<string, number> = { charm: 2, command: 2, guile: 2, intimidate: 2, intuition: 2 }
      const introduction = contestant.introduction as Record<string, unknown> | undefined
      if (introduction && typeof introduction.skillId === 'string' && Object.hasOwn(skillDice, introduction.skillId) && Number.isSafeInteger(introduction.skillRankDice) && Number(introduction.skillRankDice) >= 1 && Number(introduction.skillRankDice) <= 6) skillDice[introduction.skillId] = Number(introduction.skillRankDice)
      contestant.introductionSkillDice = skillDice
    }
    if (!Object.hasOwn(contestant, 'teamDicePools')) contestant.teamDicePools = emptyContestStatRecord(() => ({ total: 0, remaining: 0, contributors: [] }))
    if (!Object.hasOwn(contestant, 'sharedDiceSpendJournal')) contestant.sharedDiceSpendJournal = []
    for (const performerRaw of Array.isArray(contestant.performers) ? contestant.performers : []) {
      if (performerRaw && typeof performerRaw === 'object' && !Array.isArray(performerRaw) && !Object.hasOwn(performerRaw, 'performerKind')) (performerRaw as Record<string, unknown>).performerKind = 'pokemon'
    }
    if (!Object.hasOwn(contestant, 'performerVoltages')) contestant.performerVoltages = root.participantVariantId === 'trainer-participant' && root.participantMethodId === 'simultaneous'
      ? Object.fromEntries(((contestant.performers as Record<string, unknown>[] | undefined) ?? []).map(performer => [String(performer.performerId), 0]))
      : {}
    const introduction = contestant.introduction as Record<string, unknown> | undefined
    if (introduction && !Object.hasOwn(introduction, 'performerId')) introduction.performerId = root.participantVariantId === 'trainer-participant'
      ? (contestant.performers as Record<string, unknown>[] | undefined)?.find(performer => performer.performerKind === 'trainer')?.performerId ?? null
      : null
    if (contestant.pendingEffects && typeof contestant.pendingEffects === 'object' && !Array.isArray(contestant.pendingEffects)) {
      if (!Object.hasOwn(contestant.pendingEffects, 'nextAppealAlignmentTypeId')) (contestant.pendingEffects as Record<string, unknown>).nextAppealAlignmentTypeId = null
      if (!Object.hasOwn(contestant.pendingEffects, 'targetPerformerId')) (contestant.pendingEffects as Record<string, unknown>).targetPerformerId = null
    }
  }
  for (const appealRaw of Array.isArray(root.appealLedger) ? root.appealLedger : []) {
    if (!appealRaw || typeof appealRaw !== 'object' || Array.isArray(appealRaw)) continue
    const appeal = appealRaw as Record<string, unknown>
    if (!Object.hasOwn(appeal, 'partnerEffectTargetPerformerId')) appeal.partnerEffectTargetPerformerId = null
    if (!Object.hasOwn(appeal, 'baseMoveDiceMultiplier')) appeal.baseMoveDiceMultiplier = Array.isArray(appeal.contributors) && (appeal.contributors as Record<string, unknown>[]).some(contributor => String(contributor.explanation ?? '').includes('×2')) ? 2 : 1
    if (!Object.hasOwn(appeal, 'moveTypeId')) {
      const contestant = (root.contestants as Record<string, unknown>[] | undefined)?.find(row => row.contestantId === appeal.contestantId)
      const performers = Array.isArray(contestant?.performers) ? contestant.performers as Record<string, unknown>[] : []
      const performer = performers.find(row => row.performerId === appeal.performerId)
      const moves = Array.isArray(performer?.moves) ? performer.moves as Record<string, unknown>[] : []
      appeal.moveTypeId = moves.find(row => row.optionId === appeal.moveOptionId)?.typeId ?? appeal.contestTypeId
    }
    for (const consequenceRaw of Array.isArray(appeal.consequences) ? appeal.consequences : []) if (consequenceRaw && typeof consequenceRaw === 'object' && !Array.isArray(consequenceRaw) && !Object.hasOwn(consequenceRaw, 'performerId')) (consequenceRaw as Record<string, unknown>).performerId = null
  }
  exact(root, ['schemaVersion','contestId','catalogId','revision','createdAt','updatedAt','display','variantId','participantVariantId','participantMethodId','sharedContestDicePoolScope','contestTypeId','stage','paused','round','turnIndex','pendingInterventionAppealId','currentRoundContestTypeId','supercontestTypeByRound','festivalHeat','contestants','policy','gmNotes','diceJournal','appealLedger','corrections','history','settlement','cancellationReason'], 'contest')
  if (root.schemaVersion !== CONTEST_DOCUMENT_SCHEMA_VERSION) fail('contest.schema-unsupported', 'schemaVersion', 'This Contest document version is not supported.')
  parseContestId(root.contestId)
  if (root.catalogId !== contestCatalog.catalogId) fail('contest.catalog-drift', 'catalogId', 'Contest canonical catalog does not match this build.')
  if (!isContestVariantId(root.variantId) || !contestVariantIsNative(root.variantId)) fail('contest.variant-unsupported', 'variantId', 'Contest variant is unavailable.')
  if (root.participantVariantId !== null && !isContestParticipantVariantId(root.participantVariantId)) fail('contest.variant-unsupported', 'participantVariantId', 'Contest participant format is unavailable.')
  if (root.participantVariantId === 'trainer-participant' && !contestBaseVariantAllowsTrainerParticipants(root.variantId as ContestVariantId)) fail('contest.variant-unsupported', 'participantVariantId', 'Trainer performers are not permitted by this base Contest variant.')
  if (root.participantMethodId !== null && !isContestParticipantMethodId(root.participantMethodId)) fail('contest.variant-unsupported', 'participantMethodId', 'Trainer Participant method is unavailable.')
  if (root.participantVariantId !== 'trainer-participant' && root.participantMethodId !== null) fail('contest.invalid-document', 'participantMethodId', 'Participant method authority requires the Trainer Participant format.')
  if (root.participantVariantId === 'trainer-participant' ? root.sharedContestDicePoolScope !== trainerParticipantContestVariant.sharedContestDicePool.scope : root.sharedContestDicePoolScope !== null) fail('contest.invalid-document', 'sharedContestDicePoolScope', 'Shared Contest dice authority does not match the participant format.')
  if (root.contestTypeId !== null && !isContestStatId(root.contestTypeId)) fail('contest.type-invalid', 'contestTypeId', 'Contest type is not canonical.')
  if (root.variantId === 'supercontest' && root.contestTypeId !== null) fail('contest.type-invalid', 'contestTypeId', 'Supercontest setup cannot retain a fixed Contest type.')
  if (!CONTEST_STAGES.includes(root.stage as ContestStage)) fail('contest.stage-invalid', 'stage', 'Contest stage is invalid.')
  const display = record(root.display, 'display'); exact(display, ['name','hallName','description'], 'display'); safeText(display.name, 'display.name', 120, true); safeText(display.hallName, 'display.hallName', 120, true); safeText(display.description, 'display.description', 1_000)
  if (typeof root.paused !== 'boolean') fail('contest.invalid-document', 'paused', 'must be boolean')
  if (root.currentRoundContestTypeId !== null && !isContestStatId(root.currentRoundContestTypeId)) fail('contest.type-invalid', 'currentRoundContestTypeId', 'must be canonical or null')
  const supercontestTypes = array(root.supercontestTypeByRound, 'supercontestTypeByRound', 100); if (supercontestTypes.some(typeId => !isContestStatId(typeId))) fail('contest.type-invalid', 'supercontestTypeByRound', 'contains a noncanonical type')
  safeInteger(root.festivalHeat, 'festivalHeat', 1, 5)
  safeInteger(root.revision, 'revision')
  safeInteger(root.createdAt, 'createdAt')
  safeInteger(root.updatedAt, 'updatedAt')
  safeInteger(root.round, 'round', 0, 100)
  safeInteger(root.turnIndex, 'turnIndex', 0, 5)
  const contestants = array(root.contestants, 'contestants', 5).map(validateContestant)
  if (new Set(contestants.map(row => row.contestantId)).size !== contestants.length) fail('contest.duplicate-contestant', 'contestants', 'Contestant identities must be unique.')
  if (new Set(contestants.map(row => row.trainerSheetSlug)).size !== contestants.length) fail('contest.duplicate-contestant', 'contestants', 'A Trainer may enroll only once.')
  const pokemonPerformers = contestants.flatMap(row => row.performers.filter(contestPerformerIsPokemon))
  if (new Set(pokemonPerformers.map(performer => performer.pokemonSheetSlug)).size !== pokemonPerformers.length) fail('contest.duplicate-pokemon', 'contestants', 'A Pokémon may enroll only once.')
  if (new Set(contestants.flatMap(row => row.performers.map(performer => performer.performerId))).size !== contestants.reduce((sum, row) => sum + row.performers.length, 0)) fail('contest.duplicate-performer', 'contestants', 'Performer identities must be globally unique.')
  for (const contestant of contestants) {
    const pokemon = contestant.performers.filter(contestPerformerIsPokemon)
    const trainers = contestant.performers.filter(contestPerformerIsTrainer)
    const requiresTrainer = root.participantVariantId === 'trainer-participant'
    if (trainers.length !== (requiresTrainer ? 1 : 0)) fail('contest.trainer-performer-not-permitted', `${contestant.contestantId}.performers`, requiresTrainer ? 'Trainer Participant entries require exactly one Trainer performer.' : 'This Contest format does not permit a Trainer performer.')
    if (trainers.some(performer => performer.trainerSheetSlug !== contestant.trainerSheetSlug || performer.trainerSheetRevision !== contestant.trainerSheetRevision)) fail('contest.invalid-contestant', `${contestant.contestantId}.performers`, 'Trainer performer authority must be the contestant’s exact enrolled Trainer sheet revision.')
    if (requiresTrainer ? contestant.introduction.performerId !== trainers[0]?.performerId : contestant.introduction.performerId !== null) fail('contest.invalid-contestant', `${contestant.contestantId}.introduction.performerId`, requiresTrainer ? 'must identify the exact enrolled Trainer performer' : 'must remain null for an ordinary Contest entry')
    if (!requiresTrainer && contestant.sharedDiceSpendJournal.length !== 0) fail('contest.invalid-contestant', `${contestant.contestantId}.sharedDiceSpendJournal`, 'is available only to Trainer Participant entries')
    const performerVoltageIds = Object.keys(contestant.performerVoltages).sort(), enrolledPerformerIds = contestant.performers.map(performer => performer.performerId).sort()
    if (root.participantVariantId === 'trainer-participant' && root.participantMethodId === 'simultaneous') {
      if (contestant.voltage !== 0 || performerVoltageIds.join(',') !== enrolledPerformerIds.join(',')) fail('contest.invalid-contestant', `${contestant.contestantId}.performerVoltages`, 'Simultaneous entries require exact per-performer Voltage and a zero shared-entry compatibility value')
    } else if (performerVoltageIds.length !== 0) fail('contest.invalid-contestant', `${contestant.contestantId}.performerVoltages`, 'Per-performer Voltage authority is available only to the Simultaneous method')
    const hasTargetedPendingAppeal = contestant.pendingEffects.nextAppealAlignmentSteps > 0 || contestant.pendingEffects.nextAppealBonusDice > 0 || contestant.pendingEffects.nextAppealTypeId !== null || contestant.pendingEffects.fixedAppealPerDie
    if (root.participantVariantId === 'trainer-participant' ? hasTargetedPendingAppeal !== (contestant.pendingEffects.targetPerformerId !== null) : contestant.pendingEffects.targetPerformerId !== null) fail('contest.invalid-contestant', `${contestant.contestantId}.pendingEffects.targetPerformerId`, 'does not match pending Trainer Participant intervention authority')
    if (root.variantId === 'rotation') {
      if (pokemon.length < 3 || pokemon.length > 5) fail('contest.rotation-team-size', `${contestant.contestantId}.performers`, 'Rotation teams require three through five Pokémon performers.')
      if (contestant.rotationOrder.some(index => !contestPerformerIsPokemon(contestant.performers[index]!))) fail('contest.rotation-order', `${contestant.contestantId}.rotationOrder`, 'Rotation order may reference only enrolled Pokémon performers.')
    } else if (pokemon.length !== 1 || contestant.rotationOrder.length !== 0 || contestant.teamContestDiceSpent !== 0 || CONTEST_STAT_IDS.some(statId => contestant.teamDicePools[statId].total !== 0)) fail('contest.invalid-contestant', `${contestant.contestantId}.performers`, 'This base Contest variant requires exactly one Pokémon performer and no Rotation team authority.')
  }
  if (root.participantVariantId === 'trainer-participant' && !['setup','introduction','performance','settling','cancelled'].includes(String(root.stage))) fail('contest.variant-unsupported', 'stage', 'Trainer Participant settlement mechanics are not active yet.')
  if (root.participantVariantId === 'trainer-participant' && root.stage !== 'setup' && root.stage !== 'cancelled' && root.participantMethodId === null) fail('contest.invalid-document', 'participantMethodId', 'Trainer Participant play requires one locked canonical method.')
  if (root.stage !== 'setup' && (contestants.length < 3 || contestants.length > 5)) fail('contest.contestant-count', 'contestants', 'A started Contest needs three through five contestants.')
  const letters = contestants.map(row => row.letter).filter((letter): letter is ContestLetter => letter !== null)
  if (new Set(letters).size !== letters.length) fail('contest.duplicate-letter', 'contestants', 'Contest letters must be unique.')
  if (root.pendingInterventionAppealId !== null) parseContestAppealId(root.pendingInterventionAppealId, 'pendingInterventionAppealId')
  const policy = record(root.policy, 'policy'); exact(policy, ['significanceMultiplier','awardRibbon','prize','rotationOrderPolicy','supercontestFestival','source','lockedAt'], 'policy'); const significanceMultiplier = safeNumber(policy.significanceMultiplier, 'policy.significanceMultiplier', contestCatalog.experience.significanceMultiplierMinimum, contestCatalog.experience.significanceMultiplierMaximum); if (Math.abs(significanceMultiplier / contestCatalog.experience.significanceMultiplierStep - Math.round(significanceMultiplier / contestCatalog.experience.significanceMultiplierStep)) > Number.EPSILON) fail('contest.invalid-document', 'policy.significanceMultiplier', 'does not use the canonical step'); if (typeof policy.awardRibbon !== 'boolean' || typeof policy.supercontestFestival !== 'boolean' || policy.source !== 'gm-reviewed' || !['choose-each-round','predeclared'].includes(String(policy.rotationOrderPolicy)) || root.variantId !== 'rotation' && policy.rotationOrderPolicy !== 'predeclared' || root.variantId !== 'festival' && policy.supercontestFestival !== false) fail('contest.invalid-document', 'policy', 'has invalid bounded settings'); normalizeContestPrize(policy.prize as ContestPolicyV1['prize']); if (policy.lockedAt !== null) safeInteger(policy.lockedAt, 'policy.lockedAt')
  safeText(root.gmNotes, 'gmNotes', 4_000); if (root.cancellationReason !== null) safeText(root.cancellationReason, 'cancellationReason', 500, true)
  const contestantIds = new Set(contestants.map(row => row.contestantId))
  const journals = array(root.diceJournal, 'diceJournal', 10_000).map(validateJournal); const journalsById = new Map(journals.map(row => [row.journalId, row])); if (journalsById.size !== journals.length) fail('contest.invalid-document', 'diceJournal', 'journal identities must be unique')
  const typeJournals = journals.filter(row => row.purpose === 'supercontest-type')
  const mappedTypes = typeJournals.map(row => ({ 1: 'cool', 2: 'tough', 3: 'beauty', 4: 'smart', 5: 'cute' } as const)[row.results.at(-1)! as 1|2|3|4|5])
  const rollsRoundTypes = root.variantId === 'supercontest' || (root.variantId === 'festival' && policy.supercontestFestival === true)
  if (!rollsRoundTypes && (typeJournals.length || supercontestTypes.length)) fail('contest.invalid-document', 'supercontestTypeByRound', 'type-roll evidence is unavailable for this Contest policy')
  if (!rollsRoundTypes && root.currentRoundContestTypeId !== root.contestTypeId) fail('contest.invalid-document', 'currentRoundContestTypeId', 'must match the fixed Contest type')
  if (rollsRoundTypes && ['performance','settling','completed'].includes(String(root.stage)) && typeJournals.length === 0) fail('contest.invalid-document', 'supercontestTypeByRound', 'running round-type policy requires immutable type-die evidence')
  if (rollsRoundTypes && mappedTypes.join(',') !== supercontestTypes.join(',')) fail('contest.invalid-document', 'supercontestTypeByRound', 'must match immutable type-die evidence')
  if ((root.stage === 'setup' || root.stage === 'introduction') && (typeJournals.length || root.variantId === 'supercontest' && root.currentRoundContestTypeId !== null)) fail('contest.invalid-document', 'supercontestTypeByRound', 'pre-performance state cannot retain round-type evidence')
  if (rollsRoundTypes && typeJournals.length > 0 && root.currentRoundContestTypeId !== mappedTypes.at(-1)) fail('contest.invalid-document', 'currentRoundContestTypeId', 'must match the latest immutable type-die evidence')
  for (const contestant of contestants) {
    const introduction = contestant.introduction
    if (introduction.status === 'pending') {
      if (introduction.skillId !== null || introduction.generatedStatId !== null || introduction.skillRankDice !== 0 || introduction.bonusDice !== 0 || introduction.results.length || introduction.generatedDice !== 0 || introduction.matchingAppealBonus !== 0 || introduction.letterTotal !== 0 || introduction.operationId !== null) fail('contest.invalid-contestant', `${contestant.contestantId}.introduction`, 'pending state cannot retain accepted evidence')
      continue
    }
    const evidence = journals.filter(row => row.operationId === introduction.operationId && row.contestantId === contestant.contestantId && (row.purpose === 'introduction' || row.purpose === 'introduction-bonus'))
    const base = evidence.filter(row => row.purpose === 'introduction'), bonus = evidence.filter(row => row.purpose === 'introduction-bonus')
    if (base.length !== 1 || bonus.length !== 1 || introduction.skillRankDice !== contestant.introductionSkillDice[introduction.skillId!] || base[0]!.results.length !== introduction.skillRankDice || bonus[0]!.results.length !== introduction.bonusDice || [...base[0]!.results, ...bonus[0]!.results].join(',') !== introduction.results.join(',')) fail('contest.invalid-contestant', `${contestant.contestantId}.introduction`, 'accepted state must match journaled roll evidence')
    const rawGenerated = introduction.results.filter(value => contestCatalog.introduction.successFaces.includes(value)).length
    const uglyGenerated = introduction.results.map(value => value === 6 ? 1 : value).filter(value => contestCatalog.introduction.successFaces.includes(value)).length
    if (introduction.generatedDice !== rawGenerated && introduction.generatedDice !== uglyGenerated) fail('contest.invalid-contestant', `${contestant.contestantId}.introduction.generatedDice`, 'does not match accepted results')
    const hasAllocationEvidence = Array.isArray(root.history) && root.history.some(raw => raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).type === 'introduction-evidence' && (raw as Record<string, unknown>).operationId === introduction.operationId)
    const introductionPools = root.variantId === 'rotation' ? [contestant.teamDicePools] : contestant.performers.filter(performer => root.participantVariantId !== 'trainer-participant' || contestPerformerIsPokemon(performer)).map(performer => performer.dicePools)
    for (const pools of introductionPools) {
      const matchingContributions = CONTEST_STAT_IDS.flatMap(statId => pools[statId].contributors.filter(entry => entry.kind === 'introduction' && entry.sourceId === introduction.operationId))
      const contributed = matchingContributions.reduce((dice, entry) => dice + (entry.active ? entry.dice : 0), 0)
      if ((hasAllocationEvidence || matchingContributions.length > 0) && contributed !== introduction.generatedDice) fail('contest.invalid-contestant', `${contestant.contestantId}.introduction`, 'generated dice must match active pool provenance')
    }
    const mappedStatId = contestCatalog.contestStats.find(stat => stat.introductionSkillId === introduction.skillId)?.id
    // Early schema-v1 development snapshots tied this bonus to the generated
    // stat. Allocation-evidence snapshots use the canonical selected-Skill rule.
    const matching = root.variantId === 'standard' && (hasAllocationEvidence ? mappedStatId : introduction.generatedStatId) === root.contestTypeId
    if (introduction.matchingAppealBonus !== (matching ? contestCatalog.introduction.standardMatchingAppealBonus : 0) || introduction.letterTotal !== introduction.generatedDice + (matching ? contestCatalog.introduction.standardMatchingLetterTotalBonus : 0)) fail('contest.invalid-contestant', `${contestant.contestantId}.introduction`, 'matching bonuses do not match canonical policy')
  }
  const validatesIntroductionLetters = root.variantId !== 'festival' || root.festivalHeat === 1
  if (validatesIntroductionLetters && contestants.length > 0 && contestants.every(row => row.introduction.status === 'accepted' && row.letter !== null)) {
    const currentIntroductionJournalIndexes = contestants.flatMap(contestant => journals.map((journal, index) => journal.operationId === contestant.introduction.operationId && (journal.purpose === 'introduction' || journal.purpose === 'introduction-bonus') ? index : -1).filter(index => index >= 0))
    const lastIntroductionJournalIndex = Math.max(...currentIntroductionJournalIndexes)
    const finalIntroductionOperationId = journals[lastIntroductionJournalIndex]!.operationId
    const tieJournals = journals.slice(lastIntroductionJournalIndex + 1).filter(journal => journal.purpose === 'letter-tie')
    const groups = new Map<number, ContestantStateV1[]>()
    for (const contestant of contestants) groups.set(contestant.introduction.letterTotal, [...(groups.get(contestant.introduction.letterTotal) ?? []), contestant])
    const vectors = new Map<string, number[]>()
    let tieJournalCursor = 0
    for (const tied of groups.values()) {
      if (tied.length < 2) continue
      let unresolved = [...tied]
      for (let attempt = 0; attempt < 24 && unresolved.length > 1; attempt += 1) {
        const candidateJournal = tieJournals[tieJournalCursor++]
        if (!candidateJournal || candidateJournal.operationId !== finalIntroductionOperationId || candidateJournal.results.length !== unresolved.length) fail('contest.invalid-document', 'diceJournal', 'letter tie evidence is missing or malformed')
        const journal = candidateJournal!
        unresolved.forEach((contestant, position) => vectors.set(contestant.contestantId, [...(vectors.get(contestant.contestantId) ?? []), journal.results[position]!]))
        const vectorKey = (contestant: ContestantStateV1): string => (vectors.get(contestant.contestantId) ?? []).join('')
        const duplicateKeys = new Set(unresolved.map(vectorKey).filter((key, index, all) => all.indexOf(key) !== index))
        unresolved = unresolved.filter(contestant => duplicateKeys.has(vectorKey(contestant)))
      }
    }
    const expected = [...contestants].sort((left, right) => right.introduction.letterTotal - left.introduction.letterTotal || (vectors.get(right.contestantId) ?? []).join('').localeCompare((vectors.get(left.contestantId) ?? []).join('')) || left.contestantId.localeCompare(right.contestantId))
    if (expected.some((contestant, index) => contestant.letter !== CONTEST_LETTERS[index])) fail('contest.invalid-document', 'contestants', 'letters do not match immutable Introduction and tie evidence')
    if (tieJournalCursor !== tieJournals.length) fail('contest.invalid-document', 'diceJournal', 'contains orphan current letter tie evidence')
  }
  const appeals = array(root.appealLedger, 'appealLedger', 10_000).map((row, index) => validateAppeal(row, index, journalsById)); if (new Set(appeals.map(row => row.appealId)).size !== appeals.length) fail('contest.invalid-document', 'appealLedger', 'appeal identities must be unique')
  if (root.pendingInterventionAppealId !== null && !appeals.some(row => row.appealId === root.pendingInterventionAppealId)) fail('contest.invalid-document', 'pendingInterventionAppealId', 'must reference accepted evidence')
  const corrections = array(root.corrections, 'corrections', 10_000).map((raw, index) => {
    const path = `corrections[${index}]`, row = record(raw, path); exact(row, ['correctionId','operationId','contestantId','kind','reason','numericDelta','statId','priorValue','nextValue','createdAt'], path)
    safeText(row.correctionId, `${path}.correctionId`, 240, true); parseContestOperationId(row.operationId, `${path}.operationId`); if (row.contestantId !== null && !contestantIds.has(parseContestantId(row.contestantId, `${path}.contestantId`))) fail('contest.invalid-document', `${path}.contestantId`, 'is not enrolled'); if (!['appeal-delta','fumble-delta','voltage-delta','dice-pool-delta','controller-reassignment','cancel-contest'].includes(String(row.kind))) fail('contest.invalid-document', `${path}.kind`, 'is invalid'); safeText(row.reason, `${path}.reason`, 500, true); if (row.numericDelta !== null) safeInteger(row.numericDelta, `${path}.numericDelta`, -99, 99); if (row.statId !== null && !isContestStatId(row.statId)) fail('contest.invalid-document', `${path}.statId`, 'is invalid'); for (const key of ['priorValue','nextValue'] as const) if (row[key] !== null && typeof row[key] !== 'number' && typeof row[key] !== 'string') fail('contest.invalid-document', `${path}.${key}`, 'must be a scalar receipt value'); else if (typeof row[key] === 'number') safeNumber(row[key], `${path}.${key}`, -1_000_000, 1_000_000); else if (typeof row[key] === 'string') safeText(row[key], `${path}.${key}`, 240, true); safeInteger(row.createdAt, `${path}.createdAt`); if (row.kind === 'cancel-contest' && (row.contestantId !== null || row.numericDelta !== null || row.statId !== null) || row.kind === 'controller-reassignment' && (row.contestantId === null || row.numericDelta !== null || row.statId !== null || typeof row.priorValue !== 'string' || typeof row.nextValue !== 'string') || row.kind === 'dice-pool-delta' && (row.contestantId === null || row.numericDelta === null || row.statId === null) || ['appeal-delta','fumble-delta','voltage-delta'].includes(String(row.kind)) && (row.contestantId === null || row.numericDelta === null || row.statId !== null)) fail('contest.invalid-document', path, 'has invalid correction evidence for its kind'); if (['appeal-delta','fumble-delta','voltage-delta'].includes(String(row.kind))) { const priorValue = row.priorValue, nextValue = row.nextValue; if (typeof priorValue !== 'number' || typeof nextValue !== 'number') fail('contest.invalid-document', path, 'numeric correction receipt values are required'); const expected = row.kind === 'voltage-delta' ? Math.max(0, Math.min(5, Number(priorValue) + Number(row.numericDelta))) : Math.max(0, Number(priorValue) + Number(row.numericDelta)); if (nextValue !== expected) fail('contest.invalid-document', path, 'numeric correction receipt does not match its delta') }; return row
  }); const correctionIds = new Set(corrections.map(row => row.correctionId)); if (correctionIds.size !== corrections.length) fail('contest.invalid-document', 'corrections', 'correction identities must be unique')
  for (const [index, appeal] of appeals.entries()) {
    const contestant = contestants.find(row => row.contestantId === appeal.contestantId), performer = contestant?.performers.find(row => row.performerId === appeal.performerId)
    const option = performer?.moves.find(row => row.optionId === appeal.moveOptionId)
    if (!contestant || !performer || !option || !option.available || option.label !== appeal.moveLabel || option.typeId !== appeal.moveTypeId || option.effectId !== appeal.effectId) fail('contest.invalid-document', `appealLedger[${index}]`, 'references an unavailable or mismatched enrolled option')
    if (appeal.partnerEffectTargetPerformerId !== null) {
      const acceptedContestant = contestant!
      const pairedPokemon = root.variantId === 'rotation' ? acceptedContestant.performers[acceptedContestant.rotationOrder[appeal.round - 1] ?? -1] : acceptedContestant.performers.find(contestPerformerIsPokemon)
      const trainer = acceptedContestant.performers.find(contestPerformerIsTrainer), pairedIds = [trainer?.performerId, pairedPokemon?.performerId]
      const sameCursorBefore = appeals.slice(0, index).some(candidate => candidate.contestantId === appeal.contestantId && candidate.round === appeal.round && candidate.turn === appeal.turn && (root.variantId !== 'festival' || /-(\d+)-(\d+)-(\d+)-(\d+)$/u.exec(candidate.appealId)?.[1] === /-(\d+)-(\d+)-(\d+)-(\d+)$/u.exec(appeal.appealId)?.[1]))
      if (root.participantVariantId !== 'trainer-participant' || root.participantMethodId !== 'simultaneous' || !['get-ready','attention-grabber'].includes(appeal.effectId) || appeal.partnerEffectTargetPerformerId === appeal.performerId || !pairedIds.includes(appeal.partnerEffectTargetPerformerId) || appeal.effectId === 'get-ready' && sameCursorBefore) fail('contest.invalid-document', `appealLedger[${index}].partnerEffectTargetPerformerId`, 'does not match a reviewed Simultaneous cross-performer effect choice')
    }
    if (appeal.adjacentContestantIds.some(id => !contestantIds.has(id)) || appeal.consequences.some(row => !contestantIds.has(row.contestantId)) || appeal.correctionIds.some(id => !correctionIds.has(id) && !journals.some(journal => journal.operationId === id && journal.purpose === 'appeal-reroll'))) fail('contest.invalid-document', `appealLedger[${index}]`, 'contains a missing cross-reference')
    for (const consequence of appeal.consequences) {
      const target = contestants.find(candidate => candidate.contestantId === consequence.contestantId)!
      if (consequence.performerId !== null && !target.performers.some(candidate => candidate.performerId === consequence.performerId)) fail('contest.invalid-document', `appealLedger[${index}].consequences`, 'references a performer outside the target entry')
      if (root.participantVariantId === 'trainer-participant' && root.participantMethodId === 'simultaneous' && consequence.voltageDelta !== 0) {
        const targetPokemon = root.variantId === 'rotation' ? target.performers[target.rotationOrder[appeal.round - 1] ?? -1] : target.performers.find(contestPerformerIsPokemon)
        const targetTrainer = target.performers.find(contestPerformerIsTrainer)
        const legalVoltageTargets = consequence.contestantId === appeal.contestantId ? [appeal.performerId, appeal.partnerEffectTargetPerformerId] : [targetTrainer?.performerId, targetPokemon?.performerId]
        if (consequence.performerId === null || !legalVoltageTargets.includes(consequence.performerId)) fail('contest.invalid-document', `appealLedger[${index}].consequences`, 'does not bind Simultaneous Voltage to the exact acting or adjacent paired performer')
      } else if (consequence.performerId !== null) fail('contest.invalid-document', `appealLedger[${index}].consequences`, 'can bind a performer only for nonzero Simultaneous Voltage')
    }
    const firstJournalIndex = journals.findIndex(journal => journal.journalId === appeal.journalIds[0])
    const precedingType = [...journals.slice(0, firstJournalIndex)].reverse().find(journal => journal.purpose === 'supercontest-type')
    const expectedType = rollsRoundTypes ? precedingType ? ({ 1: 'cool', 2: 'tough', 3: 'beauty', 4: 'smart', 5: 'cute' } as const)[precedingType.results.at(-1)! as 1|2|3|4|5] : null : root.contestTypeId
    if (appeal.contestTypeId !== expectedType) fail('contest.invalid-document', `appealLedger[${index}].contestTypeId`, 'does not match immutable round-type authority')
  }
  if (root.participantVariantId === 'trainer-participant' && root.participantMethodId !== null) {
    const previousKindByContestant = new Map<string, ContestParticipantPerformerKind>(), acceptedKindsByCursor = new Map<string, ContestParticipantPerformerKind[]>()
    for (const [index, appeal] of appeals.entries()) {
      const contestant = contestants.find(candidate => candidate.contestantId === appeal.contestantId)!
      const performer = contestant.performers.find(candidate => candidate.performerId === appeal.performerId)!
      const performerKind: ContestParticipantPerformerKind = contestPerformerIsTrainer(performer) ? 'trainer' : 'pokemon'
      const heat = root.variantId === 'festival' ? Number(/-(\d+)-(\d+)-(\d+)-(\d+)$/u.exec(appeal.appealId)?.[1] ?? 0) : 1
      const cursorKey = `${heat}:${appeal.round}:${appeal.turn}:${appeal.contestantId}`, acceptedKinds = acceptedKindsByCursor.get(cursorKey) ?? []
      const priorAppeals = appeals.slice(0, index), previousPerformerAppeal = [...priorAppeals].reverse().find(candidate => candidate.contestantId === appeal.contestantId && candidate.performerId === appeal.performerId)
      const transferredGetReady = priorAppeals.some(candidate => candidate.contestantId === appeal.contestantId && candidate.round === appeal.round && candidate.turn === appeal.turn && (root.variantId !== 'festival' || Number(/-(\d+)-(\d+)-(\d+)-(\d+)$/u.exec(candidate.appealId)?.[1] ?? 0) === heat) && candidate.effectId === 'get-ready' && candidate.partnerEffectTargetPerformerId === appeal.performerId)
      const expectedMultiplier = transferredGetReady || previousPerformerAppeal?.effectId === 'get-ready' && previousPerformerAppeal.partnerEffectTargetPerformerId === null ? 2 : 1
      if (appeal.baseMoveDiceMultiplier !== expectedMultiplier) fail('contest.invalid-document', `appealLedger[${index}].baseMoveDiceMultiplier`, 'does not match same-performer or reviewed partner Get Ready authority')
      let turn
      try { turn = resolveTrainerParticipantMethodTurn({ methodId: root.participantMethodId as ContestParticipantMethodId, acceptedPerformerKindsThisRound: acceptedKinds, previousRoundTerminalPerformerKind: previousKindByContestant.get(contestant.contestantId) ?? null }) }
      catch { fail('contest.invalid-document', `appealLedger[${index}].performerId`, 'does not follow the locked alternating Trainer/Pokémon sequence or Simultaneous paired sequence') }
      if (!turn!.legalNextPerformerKinds.includes(performerKind)) fail('contest.invalid-document', `appealLedger[${index}].performerId`, 'does not follow the locked alternating Trainer/Pokémon sequence or Simultaneous paired sequence')
      const nextKinds = [...acceptedKinds, performerKind]; acceptedKindsByCursor.set(cursorKey, nextKinds)
      const after = resolveTrainerParticipantMethodTurn({ methodId: root.participantMethodId as ContestParticipantMethodId, acceptedPerformerKindsThisRound: nextKinds, previousRoundTerminalPerformerKind: previousKindByContestant.get(contestant.contestantId) ?? null })
      if (after.roundComplete) previousKindByContestant.set(contestant.contestantId, performerKind)
    }
  }
  for (const contestant of contestants) {
    const contestantAppeals = appeals.filter(appeal => appeal.contestantId === contestant.contestantId)
    const spent = contestantAppeals.reduce((sum, appeal) => sum + CONTEST_STAT_IDS.reduce((subtotal, statId) => subtotal + appeal.spentDice[statId], 0), 0)
    if (root.variantId === 'rotation' && spent !== contestant.teamContestDiceSpent) fail('contest.invalid-contestant', contestant.contestantId, 'Rotation Contest dice spent must match accepted appeal evidence')
    if (root.participantVariantId === 'trainer-participant') {
      for (const receipt of contestant.sharedDiceSpendJournal) {
        const appeal = contestantAppeals.find(candidate => candidate.operationId === receipt.operationId)
        const actor = contestant.performers.find(performer => performer.performerId === receipt.performerId)
        const pairedPokemon = actor && contestPerformerIsPokemon(actor)
          ? actor
          : root.variantId === 'rotation'
            ? contestant.performers[contestant.rotationOrder[(appeal?.round ?? 1) - 1] ?? -1]
            : contestant.performers.find(contestPerformerIsPokemon)
        if (!appeal || appeal.performerId !== receipt.performerId || !pairedPokemon || !contestPerformerIsPokemon(pairedPokemon) || pairedPokemon.performerId !== receipt.pokemonPerformerId || CONTEST_STAT_IDS.some(statId => appeal.spentDice[statId] !== receipt.spentDice[statId])) fail('contest.invalid-contestant', `${contestant.contestantId}.sharedDiceSpendJournal`, 'must match one accepted appeal and the exact paired Pokémon preparation pool')
        if (root.variantId !== 'rotation' && CONTEST_STAT_IDS.some(statId => receipt.teamSpentDice[statId] !== 0 || receipt.teamRemainingBefore[statId] !== 0 || receipt.teamRemainingAfter[statId] !== 0)) fail('contest.invalid-contestant', `${contestant.contestantId}.sharedDiceSpendJournal`, 'non-Rotation entries cannot retain Rotation team-pool spend evidence')
      }
      if (contestantAppeals.some(appeal => CONTEST_STAT_IDS.some(statId => appeal.spentDice[statId] > 0) && !contestant.sharedDiceSpendJournal.some(receipt => receipt.operationId === appeal.operationId))) fail('contest.invalid-contestant', `${contestant.contestantId}.sharedDiceSpendJournal`, 'must cover every accepted shared-pool spend exactly once')
    }
  }
  if (root.variantId === 'supercontest') {
    const expectedTypeRolls = ['settling','completed'].includes(String(root.stage)) ? contestants.length : root.stage === 'performance' ? Number(root.round) : 0
    if (typeJournals.length !== expectedTypeRolls) fail('contest.invalid-document', 'supercontestTypeByRound', 'does not cover every opened Supercontest round exactly once')
  }
  if (root.variantId === 'festival' && policy.supercontestFestival === true && root.stage !== 'cancelled') {
    let expectedTypeRolls = 0
    for (let heat = 1; heat < Number(root.festivalHeat); heat += 1) expectedTypeRolls += contestants.filter(contestant => !contestant.withdrawn || Number(contestant.finalPlacement) <= contestants.length - heat + 1).length
    const currentActiveCount = contestants.filter(contestant => !contestant.withdrawn).length
    expectedTypeRolls += ['settling','completed'].includes(String(root.stage)) ? currentActiveCount : root.stage === 'performance' ? Number(root.round) : 0
    if (typeJournals.length !== expectedTypeRolls) fail('contest.invalid-document', 'supercontestTypeByRound', 'does not cover every opened Festival round exactly once')
  }
  if (root.variantId !== 'festival' && appeals.length) {
    const chart = contestCatalog.charts[String(contestants.length) as '3'|'4'|'5']
    const contestantsByLetter = new Map(contestants.map(contestant => [contestant.letter, contestant]))
    const turnCounts = new Map<string, number>(), appealsPerTurn = root.participantVariantId === 'trainer-participant' && root.participantMethodId === 'simultaneous' ? 2 : 1
    for (const [index, appeal] of appeals.entries()) {
      const candidateRound = chart?.rounds[appeal.round - 1], key = `${appeal.round}:${appeal.turn}`, acceptedAtTurn = turnCounts.get(key) ?? 0
      if (!candidateRound || appeal.turn > candidateRound.turnOrder.length || acceptedAtTurn >= appealsPerTurn) fail('contest.invalid-document', `appealLedger[${index}]`, 'has invalid or overfilled chart turn evidence')
      const round = candidateRound!
      turnCounts.set(key, acceptedAtTurn + 1)
      const candidateContestant = contestantsByLetter.get(round.turnOrder[appeal.turn - 1] as ContestLetter)
      if (!candidateContestant) fail('contest.invalid-document', `appealLedger[${index}]`, 'references a chart letter without an active contestant')
      const expectedContestant = candidateContestant!
      const actorPosition = expectedContestant.letter ? round.lineup.indexOf(expectedContestant.letter) : -1
      const expectedAdjacent = round.lineup.flatMap((letter, position) => Math.abs(position - actorPosition) === 1 ? [contestantsByLetter.get(letter as ContestLetter)?.contestantId] : []).filter((id): id is string => Boolean(id))
      if (expectedContestant.contestantId !== appeal.contestantId || actorPosition < 0 || (actorPosition === chart.centerPosition) !== appeal.centerOfAttention || expectedAdjacent.join(',') !== appeal.adjacentContestantIds.join(',')) fail('contest.invalid-document', `appealLedger[${index}]`, 'does not match the canonical position chart')
      if (root.variantId === 'rotation' && root.participantVariantId !== 'trainer-participant') {
        const performerIndex = expectedContestant.rotationOrder[appeal.round - 1]
        if (!Number.isInteger(performerIndex) || expectedContestant.performers[performerIndex!]!.performerId !== appeal.performerId) fail('contest.invalid-document', `appealLedger[${index}].performerId`, 'does not match the locked Rotation performer')
      }
    }
    const completedTurns = (Number(root.round) - 1) * contestants.length + Number(root.turnIndex)
    const expectedAppeals = ['settling','completed'].includes(String(root.stage)) ? contestants.length * contestants.length * appealsPerTurn : null
    if (expectedAppeals !== null && appeals.length !== expectedAppeals) fail('contest.invalid-document', 'appealLedger', 'does not match the authoritative round and turn cursor')
    if (root.stage === 'performance') {
      const currentTurnAppeals = appeals.length - completedTurns * appealsPerTurn
      const maximumOpenAppeals = appealsPerTurn === 2 ? 1 : root.pendingInterventionAppealId ? 1 : 0
      if (currentTurnAppeals < 0 || currentTurnAppeals > maximumOpenAppeals) fail('contest.invalid-document', 'appealLedger', 'does not match the authoritative round and turn cursor')
    }
  }
  if (root.variantId === 'festival' && appeals.length) {
    const appealsByHeat = new Map<number, ContestAppealLedgerEntryV1[]>()
    for (const [index, appeal] of appeals.entries()) {
      const identity = /-(\d+)-(\d+)-(\d+)-(\d+)$/u.exec(appeal.appealId)
      if (!identity) fail('contest.invalid-document', `appealLedger[${index}].appealId`, 'does not retain Festival heat cursor evidence')
      const heat = Number(identity![1]), identityRound = Number(identity![2]), identityTurn = Number(identity![3])
      if (heat < 1 || heat > Number(root.festivalHeat) || identityRound !== appeal.round || identityTurn !== appeal.turn) fail('contest.invalid-document', `appealLedger[${index}].appealId`, 'does not match its Festival heat, round, and turn')
      appealsByHeat.set(heat, [...(appealsByHeat.get(heat) ?? []), appeal])
    }
    for (let heat = 1; heat <= Number(root.festivalHeat); heat += 1) {
      const heatAppeals = appealsByHeat.get(heat) ?? []
      const activeForHeat = contestants.filter(contestant => !contestant.withdrawn || Number(contestant.finalPlacement) <= contestants.length - heat + 1)
      const chart = contestCatalog.charts[String(activeForHeat.length) as '3'|'4'|'5']
      if (!chart) fail('contest.invalid-document', 'appealLedger', 'Festival heat has no canonical active chart')
      const letterByContestant = new Map<string, ContestLetter>(), contestantByLetter = new Map<ContestLetter, ContestantStateV1>()
      if (heat === Number(root.festivalHeat)) for (const contestant of activeForHeat) if (contestant.letter !== null) { letterByContestant.set(contestant.contestantId, contestant.letter); contestantByLetter.set(contestant.letter, contestant) }
      const turnCounts = new Map<string, number>(), appealsPerTurn = root.participantVariantId === 'trainer-participant' && root.participantMethodId === 'simultaneous' ? 2 : 1
      for (const [heatIndex, appeal] of heatAppeals.entries()) {
        const round = chart.rounds[appeal.round - 1], key = `${appeal.round}:${appeal.turn}`, acceptedAtTurn = turnCounts.get(key) ?? 0
        if (!round || appeal.turn > round.turnOrder.length || acceptedAtTurn >= appealsPerTurn) fail('contest.invalid-document', `appealLedger[${heatIndex}]`, 'has invalid or overfilled Festival chart turn evidence')
        const acceptedRound = round!
        turnCounts.set(key, acceptedAtTurn + 1)
        const expectedLetter = acceptedRound.turnOrder[appeal.turn - 1] as ContestLetter
        const existingLetter = letterByContestant.get(appeal.contestantId), existingContestant = contestantByLetter.get(expectedLetter)
        if (!activeForHeat.some(contestant => contestant.contestantId === appeal.contestantId) || existingLetter && existingLetter !== expectedLetter || existingContestant && existingContestant.contestantId !== appeal.contestantId) fail('contest.invalid-document', `appealLedger[${heatIndex}]`, 'does not match the Festival heat turn order')
        const contestant = activeForHeat.find(candidate => candidate.contestantId === appeal.contestantId)!
        letterByContestant.set(contestant.contestantId, expectedLetter); contestantByLetter.set(expectedLetter, contestant)
      }
      for (const [heatIndex, appeal] of heatAppeals.entries()) {
        const round = chart.rounds[appeal.round - 1]!, actorLetter = letterByContestant.get(appeal.contestantId), actorPosition = actorLetter ? round.lineup.indexOf(actorLetter) : -1
        const expectedAdjacent = round.lineup.flatMap((letter, position) => Math.abs(position - actorPosition) === 1 ? [contestantByLetter.get(letter as ContestLetter)?.contestantId] : []).filter((id): id is string => Boolean(id))
        if (actorPosition < 0 || (actorPosition === chart.centerPosition) !== appeal.centerOfAttention || expectedAdjacent.join(',') !== appeal.adjacentContestantIds.join(',')) fail('contest.invalid-document', `appealLedger[${heatIndex}]`, 'does not match Festival position and adjacency authority')
      }
      const completedTurns = (Number(root.round) - 1) * activeForHeat.length + Number(root.turnIndex)
      const expectedHeatAppeals = heat < Number(root.festivalHeat) ? activeForHeat.length * activeForHeat.length * appealsPerTurn
        : ['settling','completed'].includes(String(root.stage)) ? activeForHeat.length * activeForHeat.length * appealsPerTurn : null
      if (expectedHeatAppeals !== null && heatAppeals.length !== expectedHeatAppeals) fail('contest.invalid-document', 'appealLedger', 'does not match the authoritative Festival heat cursor')
      if (heat === Number(root.festivalHeat) && root.stage === 'performance') {
        const currentTurnAppeals = heatAppeals.length - completedTurns * appealsPerTurn
        const maximumOpenAppeals = appealsPerTurn === 2 ? 1 : root.pendingInterventionAppealId ? 1 : 0
        if (currentTurnAppeals < 0 || currentTurnAppeals > maximumOpenAppeals) fail('contest.invalid-document', 'appealLedger', 'does not match the authoritative Festival heat cursor')
      }
    }
  }
  const history = array(root.history, 'history', 20_000) as ContestHistoryEntryV1[]
  const historyIds = new Set<string>(); for (const [index, raw] of history.entries()) { const path = `history[${index}]`, row = record(raw, path); exact(row, ['sequence','eventId','type','visibility','contestantId','headline','detail','operationId','createdAt'], path); if (row.sequence !== index + 1) fail('contest.history-order', 'history', 'History sequence must be contiguous.'); const eventId = safeText(row.eventId, `${path}.eventId`, 240, true); if (historyIds.has(eventId)) fail('contest.history-order', `${path}.eventId`, 'must be unique'); historyIds.add(eventId); safeText(row.type, `${path}.type`, 120, true); if (!['public','owner','gm','diagnostic'].includes(String(row.visibility))) fail('contest.invalid-document', `${path}.visibility`, 'is invalid'); if (row.contestantId !== null && !contestantIds.has(parseContestantId(row.contestantId, `${path}.contestantId`))) fail('contest.invalid-document', `${path}.contestantId`, 'is not enrolled'); safeText(row.headline, `${path}.headline`, 500, true); safeText(row.detail, `${path}.detail`, 4_000); if (row.operationId !== null) parseContestOperationId(row.operationId, `${path}.operationId`); safeInteger(row.createdAt, `${path}.createdAt`) }
  const lastIntroductionRestart = [...history].reverse().find(row => row.type === 'introduction-restarted')?.sequence ?? 0
  const operationSequence = new Map(history.flatMap(row => row.operationId === null ? [] : [[row.operationId, row.sequence] as const]))
  for (const contestant of contestants) {
    const acceptedAppeal = appeals.filter(appeal => appeal.contestantId === contestant.contestantId).reduce((sum, appeal) => sum + appeal.appealDelta, 0)
    const consequenceAppeal = appeals.flatMap(appeal => appeal.consequences).filter(consequence => consequence.contestantId === contestant.contestantId).reduce((sum, consequence) => sum + consequence.appealDelta, 0)
    const correctedAppeal = corrections.filter(correction => correction.contestantId === contestant.contestantId && correction.kind === 'appeal-delta' && (operationSequence.get(String(correction.operationId)) ?? Number.MAX_SAFE_INTEGER) > lastIntroductionRestart).reduce((sum, correction) => sum + Number(correction.nextValue) - Number(correction.priorValue), 0)
    const expectedAppeal = contestant.introduction.matchingAppealBonus + acceptedAppeal + consequenceAppeal + correctedAppeal
    if (contestant.appeal !== expectedAppeal) fail('contest.invalid-contestant', `${contestant.contestantId}.appeal`, 'does not reconcile with accepted Introduction, appeal, effect, and correction evidence')
    if (root.variantId !== 'festival') {
      const acceptedFumble = appeals.filter(appeal => appeal.contestantId === contestant.contestantId).reduce((sum, appeal) => sum + appeal.fumbleDelta, 0)
      const consequenceFumble = appeals.flatMap(appeal => appeal.consequences).filter(consequence => consequence.contestantId === contestant.contestantId).reduce((sum, consequence) => sum + consequence.fumbleDelta, 0)
      const correctedFumble = corrections.filter(correction => correction.contestantId === contestant.contestantId && correction.kind === 'fumble-delta').reduce((sum, correction) => sum + Number(correction.nextValue) - Number(correction.priorValue), 0)
      if (contestant.fumble !== acceptedFumble + consequenceFumble + correctedFumble) fail('contest.invalid-contestant', `${contestant.contestantId}.fumble`, 'does not reconcile with accepted appeal, effect, and correction evidence')
    }
  }
  if (root.variantId === 'festival') {
    const fumbleByContestant = new Map(contestants.map(contestant => [contestant.contestantId, 0]))
    const appealsByOperation = new Map(appeals.map(appeal => [appeal.operationId, appeal]))
    const fumbleCorrectionsByOperation = new Map(corrections.filter(correction => correction.kind === 'fumble-delta').map(correction => [String(correction.operationId), correction]))
    const eliminated = new Set<string>()
    for (const event of history) {
      if (event.type === 'contest-corrected' && event.operationId) {
        const correction = fumbleCorrectionsByOperation.get(event.operationId)
        if (correction?.contestantId) {
          const contestantId = String(correction.contestantId)
          const current = fumbleByContestant.get(contestantId)!
          if (current !== Number(correction.priorValue)) fail('contest.invalid-document', String(correction.correctionId), 'Fumble correction prior value does not match accepted history')
          fumbleByContestant.set(contestantId, Number(correction.nextValue))
        }
      }
      if (event.type === 'appeal-accepted' && event.operationId) {
        const appeal = appealsByOperation.get(event.operationId)
        if (appeal) {
          fumbleByContestant.set(appeal.contestantId, fumbleByContestant.get(appeal.contestantId)! + appeal.fumbleDelta)
          for (const consequence of appeal.consequences) fumbleByContestant.set(consequence.contestantId, Math.max(0, fumbleByContestant.get(consequence.contestantId)! + consequence.fumbleDelta))
        }
      }
      if (event.type === 'festival-elimination' && event.contestantId) {
        eliminated.add(event.contestantId)
        for (const contestant of contestants) if (!eliminated.has(contestant.contestantId)) fumbleByContestant.set(contestant.contestantId, 0)
      }
    }
    for (const contestant of contestants) if (fumbleByContestant.get(contestant.contestantId) !== contestant.fumble) fail('contest.invalid-contestant', `${contestant.contestantId}.fumble`, 'does not reconcile with accepted Festival heat evidence')
  }
  const voltageCorrections = corrections.filter(correction => correction.kind === 'voltage-delta')
  if (root.participantVariantId === 'trainer-participant' && root.participantMethodId === 'simultaneous') {
    if (voltageCorrections.length) fail('contest.invalid-document', 'corrections', 'Simultaneous Voltage corrections require unavailable exact-performer correction authority')
    const voltageByPerformer = new Map<string, number>(contestants.flatMap(contestant => contestant.performers.map(performer => [`${contestant.contestantId}:${performer.performerId}`, 0] as const)))
    const appealsByOperation = new Map(appeals.map(appeal => [appeal.operationId, appeal])), eliminated = new Set<string>()
    for (const event of history) {
      if (event.type === 'appeal-accepted' && event.operationId) {
        const appeal = appealsByOperation.get(event.operationId)
        if (appeal) {
          const actorKey = `${appeal.contestantId}:${appeal.performerId}`
          if (voltageByPerformer.get(actorKey) !== appeal.voltageBefore) fail('contest.invalid-document', appeal.appealId, 'start-of-turn performer Voltage does not match accepted history')
          voltageByPerformer.set(actorKey, appeal.voltageAfter)
          for (const consequence of appeal.consequences) if (consequence.performerId !== null && consequence.voltageDelta !== 0 && (consequence.contestantId !== appeal.contestantId || consequence.performerId !== appeal.performerId)) {
            const targetKey = `${consequence.contestantId}:${consequence.performerId}`, currentVoltage = voltageByPerformer.get(targetKey) ?? fail('contest.invalid-document', appeal.appealId, 'Voltage consequence references missing performer state')
            voltageByPerformer.set(targetKey, Math.max(0, Math.min(5, currentVoltage + consequence.voltageDelta)))
          }
        }
      }
      if (event.type === 'festival-elimination' && event.contestantId) {
        eliminated.add(event.contestantId)
        for (const contestant of contestants) if (!eliminated.has(contestant.contestantId)) for (const performer of contestant.performers) voltageByPerformer.set(`${contestant.contestantId}:${performer.performerId}`, 0)
      }
    }
    for (const contestant of contestants) for (const performer of contestant.performers) if (voltageByPerformer.get(`${contestant.contestantId}:${performer.performerId}`) !== contestant.performerVoltages[performer.performerId]) fail('contest.invalid-contestant', `${contestant.contestantId}.performerVoltages.${performer.performerId}`, 'does not reconcile with accepted performer appeal, effect, and Festival evidence')
  } else {
    const hasCorrectionInsideRerollWindow = appeals.some(appeal => {
      const acceptedSequence = history.find(row => row.type === 'appeal-accepted' && row.operationId === appeal.operationId)?.sequence ?? 0
      const lastRerollSequence = Math.max(acceptedSequence, ...appeal.correctionIds.map(operationId => operationSequence.get(operationId) ?? acceptedSequence))
      return voltageCorrections.some(correction => { const sequence = operationSequence.get(String(correction.operationId)) ?? 0; return sequence > acceptedSequence && sequence < lastRerollSequence })
    })
    if (!hasCorrectionInsideRerollWindow) {
      const voltageByContestant = new Map(contestants.map(contestant => [contestant.contestantId, 0]))
      const appealsByOperation = new Map(appeals.map(appeal => [appeal.operationId, appeal]))
      const correctionsByOperation = new Map(voltageCorrections.map(correction => [String(correction.operationId), correction]))
      const eliminated = new Set<string>()
      for (const event of history) {
        if (event.type === 'contest-corrected' && event.operationId) {
          const correction = correctionsByOperation.get(event.operationId)
          if (correction?.contestantId) {
            const contestantId = String(correction.contestantId)
            const current = voltageByContestant.get(contestantId)!
            if (current !== Number(correction.priorValue)) fail('contest.invalid-document', String(correction.correctionId), 'voltage correction prior value does not match accepted history')
            voltageByContestant.set(contestantId, Number(correction.nextValue))
          }
        }
        if (event.type === 'appeal-accepted' && event.operationId) {
          const appeal = appealsByOperation.get(event.operationId)
          if (appeal) {
            if (voltageByContestant.get(appeal.contestantId) !== appeal.voltageBefore) fail('contest.invalid-document', appeal.appealId, 'start-of-turn Voltage does not match accepted history')
            voltageByContestant.set(appeal.contestantId, appeal.voltageAfter)
            for (const consequence of appeal.consequences) if (consequence.contestantId !== appeal.contestantId && consequence.voltageDelta !== 0) voltageByContestant.set(consequence.contestantId, Math.max(0, Math.min(5, voltageByContestant.get(consequence.contestantId)! + consequence.voltageDelta)))
          }
        }
        if (event.type === 'festival-elimination' && event.contestantId) {
          eliminated.add(event.contestantId)
          for (const contestant of contestants) if (!eliminated.has(contestant.contestantId)) voltageByContestant.set(contestant.contestantId, 0)
        }
      }
      for (const contestant of contestants) if (voltageByContestant.get(contestant.contestantId) !== contestant.voltage) fail('contest.invalid-contestant', `${contestant.contestantId}.voltage`, 'does not reconcile with accepted appeal, effect, correction, and Festival evidence')
    }
  }
  const settlement = validateSettlement(root.settlement, contestantIds)
  if (root.participantVariantId === 'trainer-participant' && settlement !== null) fail('contest.variant-unsupported', 'settlement', 'Trainer Participant reward settlement authority is not active yet.')
  if (settlement) {
    if (settlement.money !== (policy.prize as ContestPolicyV1['prize']).money || JSON.stringify(settlement.items) !== JSON.stringify((policy.prize as ContestPolicyV1['prize']).items)) fail('contest.invalid-document', 'settlement', 'rewards do not match the locked declared prize')
    for (const [index, entry] of settlement.entries.entries()) {
      const contestant = contestants.find(row => row.contestantId === entry.contestantId)!
      const pokemon = contestant.performers.filter(contestPerformerIsPokemon)
      if (entry.trainerSheetSlug !== contestant.trainerSheetSlug || entry.finalScore !== contestant.finalScore || entry.placement !== contestant.finalPlacement || entry.experienceByPokemon.map(row => row.pokemonSheetSlug).sort().join(',') !== pokemon.map(row => row.pokemonSheetSlug).sort().join(',')) fail('contest.invalid-document', `settlement.entries[${index}]`, 'does not match final enrolled authority')
      if (entry.ribbon !== (policy.awardRibbon === true && entry.placement === 1)) fail('contest.invalid-document', `settlement.entries[${index}].ribbon`, 'does not match the locked ribbon policy')
      const lowerPlacedPokemon = root.variantId === 'rotation' ? contestants.filter(row => (row.finalPlacement ?? contestants.length) > entry.placement).reduce((sum, row) => sum + row.performers.filter(contestPerformerIsPokemon).length, 0) : 0
      const units = root.variantId === 'rotation' ? Math.ceil((lowerPlacedPokemon + 1) / 2) : Math.ceil((contestants.length - entry.placement + 1) / 2)
      const individual = pokemon.map(performer => Math.ceil(performer.level * units * Number(policy.significanceMultiplier)))
      const expectedExperience = new Map<string, number>()
      if (root.variantId === 'rotation') { const total = individual.reduce((sum, value) => sum + value, 0), base = Math.floor(total / pokemon.length); let remainder = total % pokemon.length; pokemon.forEach(performer => expectedExperience.set(performer.pokemonSheetSlug, base + (remainder-- > 0 ? 1 : 0))) }
      else expectedExperience.set(pokemon[0]!.pokemonSheetSlug, individual[0]!)
      if (entry.experienceByPokemon.some(row => expectedExperience.get(row.pokemonSheetSlug) !== row.experience)) fail('contest.invalid-document', `settlement.entries[${index}].experienceByPokemon`, 'does not match canonical Contest experience')
    }
    const expectedAttention = settlement.entries.flatMap(entry => entry.experienceByPokemon.filter(row => row.experience > 0).map(row => `contest-level-check:${root.contestId}:${row.pokemonSheetSlug}`))
    if ([...settlement.attentionItemIds].sort().join(',') !== expectedAttention.sort().join(',')) fail('contest.invalid-document', 'settlement.attentionItemIds', 'does not match awarded experience')
  }
  const stage = root.stage as ContestStage
  const activeContestants = contestants.filter(row => !row.withdrawn)
  if (root.variantId !== 'festival' && contestants.some(row => row.withdrawn)) fail('contest.invalid-contestant', 'contestants', 'Only Festival elimination may withdraw a contestant.')
  if (root.variantId === 'rotation' && !['setup','cancelled'].includes(stage)) {
    if (contestants.some(row => row.performers.filter(contestPerformerIsPokemon).length !== contestants.length || row.teamContestDiceSpent > contestants.length * 2)) fail('contest.rotation-team-size', 'contestants', 'Started Rotation teams must match the field size and team spending cap.')
    if (policy.rotationOrderPolicy === 'predeclared' && contestants.some(row => row.rotationOrder.length !== contestants.length)) fail('contest.invalid-contestant', 'contestants', 'Started Rotation teams require a complete predeclared order.')
    if (policy.rotationOrderPolicy === 'choose-each-round' && (stage === 'introduction' && contestants.some(row => row.rotationOrder.length !== 0) || ['settling','completed'].includes(stage) && contestants.some(row => row.rotationOrder.length !== contestants.length))) fail('contest.invalid-contestant', 'contestants', 'Rotation performer choices do not match the lifecycle stage.')
  }
  if (stage === 'setup' && (root.diceJournal as unknown[]).length || stage === 'setup' && (root.appealLedger as unknown[]).length || stage === 'setup' && contestants.some(row => row.introduction.status !== 'pending' || row.letter !== null || row.appeal !== 0 || row.fumble !== 0 || row.voltage !== 0)) fail('contest.stage-invalid', 'contestants', 'Setup cannot retain accepted Contest play evidence.')
  if (stage === 'introduction') {
    if (appeals.length || contestants.some(row => row.finalPlacement !== null || row.finalScore !== null)) fail('contest.stage-invalid', 'contestants', 'Introduction cannot retain Performance or settlement evidence.')
    const allAccepted = contestants.every(row => row.introduction.status === 'accepted')
    if (allAccepted !== contestants.every(row => row.letter !== null) || !allAccepted && contestants.some(row => row.letter !== null)) fail('contest.stage-invalid', 'contestants', 'Letters are published only after every Introduction is accepted.')
  }
  if (stage === 'performance' && root.variantId !== 'festival' && contestants.some(row => row.finalPlacement !== null || row.finalScore !== null)) fail('contest.stage-invalid', 'contestants', 'Non-Festival Performance cannot retain final placement evidence.')
  if (!['introduction','performance','settling'].includes(stage) && root.paused) fail('contest.stage-invalid', 'paused', 'Only an active Contest stage may remain paused.')
  if ((stage === 'cancelled') !== (root.cancellationReason !== null)) fail('contest.stage-invalid', 'cancellationReason', 'Cancellation reason evidence must match the terminal stage.')
  const assignedPlacements = contestants.flatMap(row => row.finalPlacement === null ? [] : [row.finalPlacement])
  if (new Set(assignedPlacements).size !== assignedPlacements.length || assignedPlacements.some(placement => placement < 1 || placement > contestants.length)) fail('contest.invalid-document', 'contestants', 'final placements must be unique and bounded')
  if (activeContestants.length > 0 && activeContestants.every(row => row.finalPlacement !== null && row.finalScore !== null)) {
    const lastAppealJournalIndex = appeals.flatMap(appeal => appeal.journalIds.map(id => journals.findIndex(journal => journal.journalId === id))).reduce((maximum, index) => Math.max(maximum, index), -1)
    const finalTieJournals = journals.slice(lastAppealJournalIndex + 1).filter(journal => journal.purpose === 'placement-tie')
    let tieJournalCursor = 0
    const scoreGroups = [...new Set(activeContestants.map(row => Number(row.finalScore)))].sort((left, right) => right - left)
    for (const score of scoreGroups) {
      const tied = activeContestants.filter(row => row.finalScore === score).sort((left, right) => left.contestantId.localeCompare(right.contestantId))
      if (tied.length < 2) continue
      const vectors = new Map(tied.map(row => [row.contestantId, [] as number[]]))
      let unresolved = [...tied]
      for (let attempt = 0; attempt < 24 && unresolved.length > 1; attempt += 1) {
        const candidateJournal = finalTieJournals[tieJournalCursor++]
        if (!candidateJournal || candidateJournal.round !== root.round || candidateJournal.results.length !== unresolved.length) fail('contest.invalid-document', 'diceJournal', 'final placement tie evidence is missing or malformed')
        const journal = candidateJournal!
        unresolved.forEach((row, position) => vectors.get(row.contestantId)!.push(journal.results[position]!))
        const keys = unresolved.map(row => vectors.get(row.contestantId)!.join(''))
        unresolved = unresolved.filter(row => keys.filter(key => key === vectors.get(row.contestantId)!.join('')).length > 1)
      }
      const expected = [...tied].sort((left, right) => vectors.get(right.contestantId)!.join('').localeCompare(vectors.get(left.contestantId)!.join('')) || left.contestantId.localeCompare(right.contestantId))
      const placed = [...tied].sort((left, right) => Number(left.finalPlacement) - Number(right.finalPlacement))
      if (expected.map(row => row.contestantId).join(',') !== placed.map(row => row.contestantId).join(',')) fail('contest.invalid-document', 'contestants', 'final placements do not match immutable tie evidence')
    }
    if (tieJournalCursor !== finalTieJournals.length) fail('contest.invalid-document', 'diceJournal', 'contains orphan final placement tie evidence')
  }
  if (stage === 'setup' && (root.round !== 0 || root.turnIndex !== 0 || policy.lockedAt !== null)) fail('contest.stage-invalid', 'stage', 'Setup state must remain unlocked before round play.')
  if (stage !== 'setup' && stage !== 'cancelled' && policy.lockedAt === null) fail('contest.stage-invalid', 'policy.lockedAt', 'A started Contest must retain its lock evidence.')
  if (stage === 'performance') {
    if (activeContestants.some(row => row.letter === null || row.introduction.status !== 'accepted')) fail('contest.stage-invalid', 'contestants', 'Performance requires accepted Introductions and active letters.')
    if (Number(root.round) < 1 || Number(root.round) > activeContestants.length || Number(root.turnIndex) >= activeContestants.length) fail('contest.stage-invalid', 'round', 'Performance round or turn is outside the active chart.')
    if (!isContestStatId(root.currentRoundContestTypeId)) fail('contest.type-invalid', 'currentRoundContestTypeId', 'Performance requires one canonical current Contest type.')
  }
  if (root.pendingInterventionAppealId !== null && stage !== 'performance') fail('contest.stage-invalid', 'pendingInterventionAppealId', 'An intervention window exists only during Performance.')
  if (root.settlement !== null && !['settling','completed','cancelled'].includes(stage)) fail('contest.stage-invalid', 'settlement', 'Settlement evidence exists only after Performance.')
  if (stage === 'settling' && activeContestants.some(row => row.finalPlacement === null || row.finalScore === null)) fail('contest.stage-invalid', 'contestants', 'Settling requires final active placements and scores.')
  if (stage === 'completed' && (record(root.settlement, 'settlement').status !== 'committed' || root.paused)) fail('contest.stage-invalid', 'settlement', 'Completed state requires committed settlement evidence and cannot remain paused.')
  return frozenClone(root as unknown as ContestDocumentV1)
}

export const contestActiveContestants = (document: ContestDocumentV1): readonly ContestantStateV1[] => document.contestants.filter(row => !row.withdrawn)

export const contestCurrentContestant = (document: ContestDocumentV1): ContestantStateV1 | null => {
  if (document.stage !== 'performance' || document.round < 1) return null
  const active = contestActiveContestants(document)
  const letters = new Map(active.map(row => [row.letter, row]))
  const chart = contestCatalog.charts[String(active.length) as '3' | '4' | '5']
  const letter = chart?.rounds[document.round - 1]?.turnOrder[document.turnIndex]
  return letter ? letters.get(letter as ContestLetter) ?? null : null
}

export const contestCurrentPerformer = (document: ContestDocumentV1, contestant: ContestantStateV1): ContestPokemonPerformerSnapshotV1 => {
  if (document.variantId !== 'rotation') return contestant.performers.find(contestPerformerIsPokemon)
    ?? fail('contest.invalid-contestant', 'performers', 'One Pokémon performer is required.')
  const selected = contestant.rotationOrder[document.round - 1]
  if (!Number.isInteger(selected) || Number(selected) < 0 || Number(selected) >= contestant.performers.length) fail('contest.rotation-performer-required', 'rotationOrder', 'Choose one unused Rotation performer for this round.')
  const performer = contestant.performers[Number(selected)]!
  if (contestPerformerIsPokemon(performer)) return performer
  return fail('contest.rotation-performer-required', 'rotationOrder', 'Choose one unused Pokémon performer for this round.')
}

export const appendContestHistory = (
  document: ContestDocumentV1,
  input: Omit<ContestHistoryEntryV1, 'sequence' | 'eventId'>,
): readonly ContestHistoryEntryV1[] => {
  const sequence = document.history.length + 1
  return Object.freeze([...document.history, Object.freeze({ ...input, sequence, eventId: `${document.contestId}:history:${sequence}` })])
}

export const emptyContestDicePools = (): Readonly<Record<ContestStatId, ContestDicePoolV1>> => Object.freeze(emptyContestStatRecord(() => Object.freeze({ total: 0, remaining: 0, contributors: Object.freeze([]) })))

export interface SpendTrainerParticipantSharedDiceInputV1 {
  readonly pokemonPools: Readonly<Record<ContestStatId, ContestDicePoolV1>>
  /** Rotation's ordinary Introduction pool; exact empty pools for other base variants. */
  readonly teamPools: Readonly<Record<ContestStatId, ContestDicePoolV1>>
  readonly journal: readonly ContestSharedDiceSpendJournalEntryV1[]
  readonly enrolledPerformerIds: readonly string[]
  readonly trainerPerformerId: string
  readonly pokemonPerformerId: string
  readonly performerId: string
  readonly operationId: string
  readonly spentDice: Readonly<Record<ContestStatId, number>>
  readonly createdAt: number
}

export interface SpendTrainerParticipantSharedDiceResultV1 {
  readonly pokemonPools: Readonly<Record<ContestStatId, ContestDicePoolV1>>
  readonly teamPools: Readonly<Record<ContestStatId, ContestDicePoolV1>>
  readonly journal: readonly ContestSharedDiceSpendJournalEntryV1[]
  readonly receipt: ContestSharedDiceSpendJournalEntryV1
  readonly exactRetry: boolean
}

/** Replay-safe depletion of one Pokémon pool shared with its exact Trainer; Rotation keeps shared-first team semantics. */
export const spendTrainerParticipantSharedDice = (input: SpendTrainerParticipantSharedDiceInputV1): SpendTrainerParticipantSharedDiceResultV1 => {
  const operationId = parseContestOperationId(input.operationId)
  if (!input.enrolledPerformerIds.includes(input.trainerPerformerId) || !input.enrolledPerformerIds.includes(input.pokemonPerformerId) || !input.enrolledPerformerIds.includes(input.performerId) || input.performerId !== input.trainerPerformerId && input.performerId !== input.pokemonPerformerId) fail('contest.invalid-contestant', 'performerId', 'Shared Contest dice may be spent only by the paired Trainer or Pokémon.')
  const spentDice = Object.freeze(emptyContestStatRecord(statId => safeInteger(input.spentDice[statId], `spentDice.${statId}`, 0, contestCatalog.performance.contestDiceSpendMaximumPerAppeal)))
  const spentTotal = CONTEST_STAT_IDS.reduce((sum, statId) => sum + spentDice[statId], 0)
  if (spentTotal < 1 || spentTotal > contestCatalog.performance.contestDiceSpendMaximumPerAppeal) fail('contest.dice-overspend', 'spentDice', `One shared-pool spend must contain one through ${contestCatalog.performance.contestDiceSpendMaximumPerAppeal} dice.`)
  const existing = input.journal.find(entry => entry.operationId === operationId)
  if (existing) {
    if (existing.performerId !== input.performerId || existing.pokemonPerformerId !== input.pokemonPerformerId || CONTEST_STAT_IDS.some(statId => existing.spentDice[statId] !== spentDice[statId])) fail('contest.operation-conflict', 'operationId', 'Shared Contest dice operation ID was reused with changed input.')
    return Object.freeze({ pokemonPools: input.pokemonPools, teamPools: input.teamPools, journal: input.journal, receipt: existing, exactRetry: true })
  }
  if (input.journal.length >= 10_000) fail('contest.invalid-contestant', 'sharedDiceSpendJournal', 'Shared Contest dice journal is full.')
  const pokemonRemainingBefore = Object.freeze(emptyContestStatRecord(statId => safeInteger(input.pokemonPools[statId].remaining, `pokemonPools.${statId}.remaining`, 0, input.pokemonPools[statId].total)))
  const teamRemainingBefore = Object.freeze(emptyContestStatRecord(statId => safeInteger(input.teamPools[statId].remaining, `teamPools.${statId}.remaining`, 0, input.teamPools[statId].total)))
  for (const statId of CONTEST_STAT_IDS) {
    const available = pokemonRemainingBefore[statId] + teamRemainingBefore[statId]
    if (spentDice[statId] > available) fail('contest.dice-overspend', `spentDice.${statId}`, `Only ${available} shared ${statId} dice remain.`)
  }
  const teamSpentDice = Object.freeze(emptyContestStatRecord(statId => Math.min(teamRemainingBefore[statId], spentDice[statId])))
  const pokemonSpentDice = Object.freeze(emptyContestStatRecord(statId => spentDice[statId] - teamSpentDice[statId]))
  const pokemonRemainingAfter = Object.freeze(emptyContestStatRecord(statId => pokemonRemainingBefore[statId] - pokemonSpentDice[statId]))
  const teamRemainingAfter = Object.freeze(emptyContestStatRecord(statId => teamRemainingBefore[statId] - teamSpentDice[statId]))
  const pokemonPools = Object.freeze(emptyContestStatRecord(statId => Object.freeze({ ...input.pokemonPools[statId], remaining: pokemonRemainingAfter[statId] })))
  const teamPools = Object.freeze(emptyContestStatRecord(statId => Object.freeze({ ...input.teamPools[statId], remaining: teamRemainingAfter[statId] })))
  const receipt: ContestSharedDiceSpendJournalEntryV1 = Object.freeze({
    spendId: `${operationId}:shared-dice`,
    operationId,
    performerId: safeText(input.performerId, 'performerId', 160, true),
    pokemonPerformerId: safeText(input.pokemonPerformerId, 'pokemonPerformerId', 160, true),
    sourcePolicy: trainerParticipantContestVariant.sharedContestDicePool.scope,
    spentDice,
    pokemonSpentDice,
    teamSpentDice,
    pokemonRemainingBefore,
    pokemonRemainingAfter,
    teamRemainingBefore,
    teamRemainingAfter,
    createdAt: safeInteger(input.createdAt, 'createdAt'),
  })
  return Object.freeze({ pokemonPools, teamPools, journal: Object.freeze([...input.journal, receipt]), receipt, exactRetry: false })
}
