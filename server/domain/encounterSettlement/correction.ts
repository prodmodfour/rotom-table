import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  ENCOUNTER_SETTLEMENT_LIMITS,
  parseEncounterSettlementDocument,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementDecision,
  type EncounterSettlementDecisionSubject,
  type EncounterSettlementDocument,
  type EncounterSettlementReceipt,
} from '#shared/encounterSettlement/document'

export const ENCOUNTER_SETTLEMENT_CORRECTION_REASON_CODES = [
  'reward-adjusted',
  'capture-corrected',
  'outcome-corrected',
  'cleanup-corrected',
  'clerical-corrected',
  'authority-linked',
] as const
export type EncounterSettlementCorrectionReasonCode = typeof ENCOUNTER_SETTLEMENT_CORRECTION_REASON_CODES[number]

export interface EncounterSettlementCorrectionAuthoritySnapshot {
  readonly completeness: 'authoritative-current'
  readonly settlement: EncounterSettlementDocument
  /** Exact accepted authority from the owning mechanical correction workflow. */
  readonly correctionAuthority: EncounterSettlementAuthorityRef
  readonly correctionAuthorityDefinitionSha256: string
  readonly campaignMinute: number
}

export interface EncounterSettlementCorrectionPlan {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly settlementId: string
  readonly expectedSettlementRevision: number
  readonly sourceReceiptId: string
  readonly reasonCode: EncounterSettlementCorrectionReasonCode
  readonly correctionAuthority: EncounterSettlementAuthorityRef
  readonly correctionAuthorityDefinitionSha256: string
  readonly campaignMinute: number
  readonly committedAt: number
  readonly beforeDefinitionSha256: string
  readonly afterDefinitionSha256: string
  readonly authorityDefinitionSha256: string
  readonly offerDefinitionSha256: string
  readonly nextDocument: EncounterSettlementDocument
}

export type EncounterSettlementCorrectionErrorCode =
  | 'invalid-input'
  | 'not-completed'
  | 'source-receipt-missing'
  | 'source-receipt-ineligible'
  | 'already-corrected'
  | 'stale-authority'
  | 'overflow'

export class EncounterSettlementCorrectionError extends Error {
  constructor(readonly code: EncounterSettlementCorrectionErrorCode, message: string) {
    super(message)
    this.name = 'EncounterSettlementCorrectionError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const HASH = /^[a-f0-9]{64}$/
const fail = (code: EncounterSettlementCorrectionErrorCode, message: string): never => {
  throw new EncounterSettlementCorrectionError(code, message)
}
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const hashJson = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(JSON.parse(JSON.stringify(value)), {
    path: 'encounterSettlementCorrection',
    limits: {
      maxDepth: 64,
      maxNodes: 1_500_000,
      maxObjectFields: 20_000,
      maxArrayEntries: 150_000,
      maxStringLength: 250_000,
    },
  }))
  .digest('hex')
const deterministicId = (prefix: string, ...parts: readonly string[]): string => {
  const hash = createHash('sha256').update(prefix)
  for (const part of parts) hash.update('\u0000').update(part)
  return `${prefix}${hash.digest('hex')}`
}
const reason = (value: unknown): EncounterSettlementCorrectionReasonCode => (
  ENCOUNTER_SETTLEMENT_CORRECTION_REASON_CODES.includes(value as EncounterSettlementCorrectionReasonCode)
    ? value as EncounterSettlementCorrectionReasonCode
    : fail('invalid-input', 'Encounter settlement correction reason is unsupported.')
)

const correctionAuthorityAllowed = (authority: EncounterSettlementAuthorityRef): boolean => [
  'encounter-document', 'map', 'sheet', 'group-inventory', 'campaign-clock',
  'capture-operation', 'item-operation', 'equipment-operation', 'inventory-operation',
  'objective', 'clock', 'phase', 'effect', 'resource',
].includes(authority.kind)

const authorityEvidence = (
  authority: EncounterSettlementCorrectionAuthoritySnapshot,
): string => hashJson({
  completeness: authority.completeness,
  settlement: authority.settlement,
  correctionAuthority: authority.correctionAuthority,
  correctionAuthorityDefinitionSha256: authority.correctionAuthorityDefinitionSha256,
  campaignMinute: authority.campaignMinute,
})

export const planEncounterSettlementCorrection = (input: {
  readonly operationId: string
  readonly sourceReceiptId: string
  readonly reasonCode: EncounterSettlementCorrectionReasonCode
  readonly gmPrincipalKey: string
  readonly committedAt: number
  readonly authority: EncounterSettlementCorrectionAuthoritySnapshot
}): EncounterSettlementCorrectionPlan => {
  if (!ID.test(input.operationId) || !ID.test(input.sourceReceiptId)
    || !ID.test(input.gmPrincipalKey) || !integer(input.committedAt)) {
    fail('invalid-input', 'Encounter settlement correction identities and timestamp must be bounded.')
  }
  if (!input.authority || input.authority.completeness !== 'authoritative-current'
    || !integer(input.authority.campaignMinute)
    || !HASH.test(input.authority.correctionAuthorityDefinitionSha256)
    || !correctionAuthorityAllowed(input.authority.correctionAuthority)) {
    fail('invalid-input', 'Encounter settlement correction requires complete exact owning authority.')
  }
  const reasonCode = reason(input.reasonCode)
  const settlement = parseEncounterSettlementDocument(input.authority.settlement)
  if (settlement.status !== 'completed' || settlement.completion.state !== 'accepted') {
    fail('not-completed', 'Only an accepted completed settlement can receive a correction link.')
  }
  if (input.authority.campaignMinute < settlement.updatedAtCampaignMinute) {
    fail('stale-authority', 'Correction campaign minute cannot precede current settlement authority.')
  }
  const sourceReceipt = settlement.receipts.find(row => row.receiptId === input.sourceReceiptId)
    ?? fail('source-receipt-missing', 'Correction source receipt is unavailable in the current settlement revision.')
  if (sourceReceipt.kind === 'completion' || sourceReceipt.result === 'cancelled') {
    fail('source-receipt-ineligible', 'Completion and cancelled receipts cannot be corrected through this workflow.')
  }
  if (settlement.receipts.some(row => row.kind === 'correction' && row.sourceReceiptId === sourceReceipt.receiptId)) {
    fail('already-corrected', 'The selected receipt already has a superseding correction receipt.')
  }
  if (settlement.revision >= Number.MAX_SAFE_INTEGER) {
    fail('overflow', 'Encounter settlement correction cannot advance beyond the safe revision range.')
  }
  if (settlement.decisions.length >= ENCOUNTER_SETTLEMENT_LIMITS.decisions
    || settlement.receipts.length >= ENCOUNTER_SETTLEMENT_LIMITS.receipts) {
    fail('overflow', 'Encounter settlement correction evidence exceeds document bounds.')
  }
  const decisionSubjects = sourceReceipt.subjects.map((subject): EncounterSettlementDecisionSubject => {
    if (subject.kind === 'decision' || subject.kind === 'settlement') {
      return fail('source-receipt-ineligible', 'Correction source receipt subjects are not correctable settlement entries.')
    }
    return { kind: subject.kind, id: subject.id }
  })
  if (decisionSubjects.length === 0) {
    fail('source-receipt-ineligible', 'Correction source receipt has no correctable settlement entry.')
  }
  const decisionId = deterministicId(
    'settlement-correction-decision:v1:', settlement.settlementId, input.operationId,
  )
  const optionId = deterministicId(
    'settlement-correction-option:v1:', settlement.settlementId, input.operationId, reasonCode,
  )
  const receiptId = deterministicId(
    'settlement-correction-receipt:v1:', settlement.settlementId, input.operationId,
  )
  const decision: EncounterSettlementDecision = Object.freeze({
    decisionId,
    kind: 'gm-correction',
    audience: sourceReceipt.audience,
    status: 'accepted',
    subjects: Object.freeze(decisionSubjects.map(subject => ({ ...subject }))),
    options: Object.freeze([{
      optionId,
      effect: 'correct' as const,
      valueId: reasonCode,
      authority: { ...input.authority.correctionAuthority },
    }]),
    selectedOptionId: optionId,
    decidedBy: { kind: 'gm' as const, principalId: input.gmPrincipalKey },
    decidedAtCampaignMinute: input.authority.campaignMinute,
  })
  const receipt: EncounterSettlementReceipt = Object.freeze({
    receiptId,
    kind: 'correction',
    audience: sourceReceipt.audience,
    operationId: input.operationId,
    result: 'corrected',
    subjects: Object.freeze(decisionSubjects.map(subject => ({ ...subject }))),
    sourceReceiptId: sourceReceipt.receiptId,
    acceptedAtCampaignMinute: input.authority.campaignMinute,
  })
  const nextDocument = parseEncounterSettlementDocument({
    ...settlement,
    revision: settlement.revision + 1,
    decisions: [...settlement.decisions, decision],
    receipts: [...settlement.receipts, receipt],
    updatedAtCampaignMinute: input.authority.campaignMinute,
  })
  const beforeDefinitionSha256 = hashJson(settlement)
  const afterDefinitionSha256 = hashJson(nextDocument)
  const authorityDefinitionSha256 = authorityEvidence(input.authority)
  const evidence = correctionPlanDefinitionEvidence({
    schemaVersion: 1,
    operationId: input.operationId,
    settlementId: settlement.settlementId,
    expectedSettlementRevision: settlement.revision,
    sourceReceiptId: sourceReceipt.receiptId,
    reasonCode,
    correctionAuthority: input.authority.correctionAuthority,
    correctionAuthorityDefinitionSha256: input.authority.correctionAuthorityDefinitionSha256,
    campaignMinute: input.authority.campaignMinute,
    committedAt: input.committedAt,
    beforeDefinitionSha256,
    afterDefinitionSha256,
    authorityDefinitionSha256,
    offerDefinitionSha256: '',
    nextDocument,
  })
  return Object.freeze({
    ...evidence,
    offerDefinitionSha256: hashJson(evidence),
  }) as EncounterSettlementCorrectionPlan
}

const correctionPlanDefinitionEvidence = (
  plan: EncounterSettlementCorrectionPlan,
): Omit<EncounterSettlementCorrectionPlan, 'offerDefinitionSha256'> => ({
  schemaVersion: plan.schemaVersion,
  operationId: plan.operationId,
  settlementId: plan.settlementId,
  expectedSettlementRevision: plan.expectedSettlementRevision,
  sourceReceiptId: plan.sourceReceiptId,
  reasonCode: plan.reasonCode,
  correctionAuthority: plan.correctionAuthority,
  correctionAuthorityDefinitionSha256: plan.correctionAuthorityDefinitionSha256,
  campaignMinute: plan.campaignMinute,
  committedAt: plan.committedAt,
  beforeDefinitionSha256: plan.beforeDefinitionSha256,
  afterDefinitionSha256: plan.afterDefinitionSha256,
  authorityDefinitionSha256: plan.authorityDefinitionSha256,
  nextDocument: plan.nextDocument,
})

export const assertEncounterSettlementCorrectionPlanIntegrity = (
  plan: EncounterSettlementCorrectionPlan,
): EncounterSettlementCorrectionPlan => {
  if (!plan || plan.schemaVersion !== 1 || !ID.test(plan.operationId)
    || !ID.test(plan.settlementId) || !ID.test(plan.sourceReceiptId)
    || !integer(plan.expectedSettlementRevision) || !integer(plan.campaignMinute)
    || !integer(plan.committedAt) || !correctionAuthorityAllowed(plan.correctionAuthority)
    || !HASH.test(plan.correctionAuthorityDefinitionSha256)
    || !HASH.test(plan.beforeDefinitionSha256) || !HASH.test(plan.afterDefinitionSha256)
    || !HASH.test(plan.authorityDefinitionSha256) || !HASH.test(plan.offerDefinitionSha256)) {
    fail('invalid-input', 'Encounter settlement correction plan evidence is malformed.')
  }
  reason(plan.reasonCode)
  const nextDocument = parseEncounterSettlementDocument(plan.nextDocument)
  if (nextDocument.settlementId !== plan.settlementId
    || nextDocument.revision !== plan.expectedSettlementRevision + 1
    || hashJson(nextDocument) !== plan.afterDefinitionSha256
    || hashJson(correctionPlanDefinitionEvidence(plan)) !== plan.offerDefinitionSha256) {
    fail('stale-authority', 'Encounter settlement correction plan evidence is invalid or changed.')
  }
  return plan
}

export const assertEncounterSettlementCorrectionPlanCurrent = (input: {
  readonly plan: EncounterSettlementCorrectionPlan
  readonly authority: EncounterSettlementCorrectionAuthoritySnapshot
}): EncounterSettlementCorrectionPlan => {
  const plan = assertEncounterSettlementCorrectionPlanIntegrity(input.plan)
  const settlement = parseEncounterSettlementDocument(input.authority.settlement)
  if (plan.authorityDefinitionSha256 !== authorityEvidence(input.authority)
    || plan.settlementId !== settlement.settlementId
    || plan.expectedSettlementRevision !== settlement.revision
    || plan.beforeDefinitionSha256 !== hashJson(settlement)
    || plan.correctionAuthorityDefinitionSha256 !== input.authority.correctionAuthorityDefinitionSha256) {
    fail('stale-authority', 'Current correction authority no longer matches the confirmed offer.')
  }
  return plan
}
