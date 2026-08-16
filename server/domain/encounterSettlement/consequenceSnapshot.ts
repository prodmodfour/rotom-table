import { createHash } from 'node:crypto'
import {
  ENCOUNTER_SETTLEMENT_AUDIENCES,
  ENCOUNTER_SETTLEMENT_CLEANUP_KINDS,
  ENCOUNTER_SETTLEMENT_CONSEQUENCE_KINDS,
  ENCOUNTER_SETTLEMENT_LIMITS,
  parseEncounterSettlementDocument,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementAudience,
  type EncounterSettlementBehavior,
  type EncounterSettlementCleanupEntry,
  type EncounterSettlementCleanupKind,
  type EncounterSettlementDecision,
  type EncounterSettlementDecisionOption,
  type EncounterSettlementDocument,
  type EncounterSettlementPersistentConsequence,
  type EncounterSettlementSnapshot,
  type EncounterSettlementConsequenceKind,
} from '#shared/encounterSettlement/document'

export type EncounterSettlementConsequenceCoverageDomain =
  `consequence:${EncounterSettlementConsequenceKind}`
export type EncounterSettlementCleanupCoverageDomain =
  `cleanup:${EncounterSettlementCleanupKind}`
export type EncounterSettlementSnapshotCoverageDomain =
  | EncounterSettlementConsequenceCoverageDomain
  | EncounterSettlementCleanupCoverageDomain

export const ENCOUNTER_SETTLEMENT_SNAPSHOT_COVERAGE_DOMAINS = Object.freeze([
  ...ENCOUNTER_SETTLEMENT_CONSEQUENCE_KINDS.map(kind => `consequence:${kind}` as const),
  ...ENCOUNTER_SETTLEMENT_CLEANUP_KINDS.map(kind => `cleanup:${kind}` as const),
])

export interface EncounterSettlementSnapshotCoverage {
  readonly domain: EncounterSettlementSnapshotCoverageDomain
  readonly disposition: 'complete' | 'not-applicable'
  readonly authorityRefs: readonly EncounterSettlementAuthorityRef[]
}

export interface EncounterSettlementSnapshotDecisionOffer {
  readonly audience: EncounterSettlementAudience
  readonly options: readonly EncounterSettlementDecisionOption[]
}

export interface EncounterSettlementPersistentConsequenceFact {
  readonly sourceFactId: string
  readonly participantId: string | null
  readonly kind: EncounterSettlementConsequenceKind
  readonly authority: EncounterSettlementAuthorityRef
  readonly field: string
  readonly behavior: 'preserve' | 'transform' | 'require-decision'
  readonly snapshot: EncounterSettlementSnapshot
  readonly decision: EncounterSettlementSnapshotDecisionOffer | null
}

export interface EncounterSettlementTemporaryCleanupFact {
  readonly sourceFactId: string
  readonly kind: EncounterSettlementCleanupKind
  readonly authority: EncounterSettlementAuthorityRef
  readonly participantIds: readonly string[]
  readonly sourceIds: readonly string[]
  readonly behavior: EncounterSettlementBehavior
  readonly decision: EncounterSettlementSnapshotDecisionOffer | null
}

export interface EncounterSettlementConsequenceAuthoritySnapshot {
  readonly completeness: 'authoritative-current'
  readonly coverage: readonly EncounterSettlementSnapshotCoverage[]
  readonly persistentConsequences: readonly EncounterSettlementPersistentConsequenceFact[]
  readonly temporaryCleanup: readonly EncounterSettlementTemporaryCleanupFact[]
}

export interface EncounterSettlementConsequenceSnapshotResult {
  readonly document: EncounterSettlementDocument
  readonly persistentConsequences: readonly EncounterSettlementPersistentConsequence[]
  readonly temporaryCleanup: readonly EncounterSettlementCleanupEntry[]
  readonly snapshotDecisions: readonly EncounterSettlementDecision[]
  readonly coverage: readonly EncounterSettlementSnapshotCoverage[]
}

export type EncounterSettlementConsequenceSnapshotErrorCode =
  | 'incomplete-coverage'
  | 'invalid-coverage'
  | 'invalid-source-fact'
  | 'duplicate-source-fact'
  | 'unsupported-behavior'
  | 'invalid-bounded-decision'
  | 'stale-accepted-decision'
  | 'stale-applied-snapshot'
  | 'orphaned-snapshot-entry'
  | 'terminal-settlement'

export class EncounterSettlementConsequenceSnapshotError extends Error {
  constructor(
    readonly code: EncounterSettlementConsequenceSnapshotErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'EncounterSettlementConsequenceSnapshotError'
  }
}

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const AUDIENCES = new Set<string>(ENCOUNTER_SETTLEMENT_AUDIENCES)
const COVERAGE_DOMAINS = new Set<string>(ENCOUNTER_SETTLEMENT_SNAPSHOT_COVERAGE_DOMAINS)
const SNAPSHOT_ENTRY_PREFIX = 'settlement-snapshot-entry:v1:'
const SNAPSHOT_DECISION_PREFIX = 'settlement-snapshot-decision:v1:'

export const ENCOUNTER_SETTLEMENT_PERSISTENT_SNAPSHOT_BEHAVIORS = Object.freeze({
  hp: Object.freeze(['preserve'] as const),
  injuries: Object.freeze(['preserve', 'transform', 'require-decision'] as const),
  conditions: Object.freeze(['preserve', 'transform', 'require-decision'] as const),
  capture: Object.freeze(['preserve', 'transform', 'require-decision'] as const),
  inventory: Object.freeze(['preserve', 'transform'] as const),
  equipment: Object.freeze(['preserve', 'transform', 'require-decision'] as const),
  resource: Object.freeze(['preserve', 'transform'] as const),
  usage: Object.freeze(['preserve', 'transform'] as const),
  effect: Object.freeze(['preserve', 'transform', 'require-decision'] as const),
  objective: Object.freeze(['preserve', 'transform', 'require-decision'] as const),
  clock: Object.freeze(['preserve', 'transform', 'require-decision'] as const),
  phase: Object.freeze(['preserve', 'transform', 'require-decision'] as const),
  ownership: Object.freeze(['preserve', 'transform', 'require-decision'] as const),
  'accepted-event': Object.freeze(['preserve'] as const),
} satisfies Readonly<Record<EncounterSettlementConsequenceKind, readonly EncounterSettlementBehavior[]>>)

export const ENCOUNTER_SETTLEMENT_TEMPORARY_CLEANUP_BEHAVIORS = Object.freeze({
  'combat-stages': Object.freeze(['reset'] as const),
  'temporary-effects': Object.freeze(['expire', 'transform', 'require-decision'] as const),
  'encounter-resources': Object.freeze(['reset'] as const),
  reservations: Object.freeze(['expire'] as const),
  zones: Object.freeze(['preserve', 'transform', 'expire', 'require-decision'] as const),
  'ground-items': Object.freeze(['preserve', 'transform', 'expire', 'require-decision'] as const),
  'duration-effects': Object.freeze(['preserve', 'transform', 'expire', 'require-decision'] as const),
  'encounter-items': Object.freeze(['transform', 'expire', 'require-decision'] as const),
  initiative: Object.freeze(['reset'] as const),
} satisfies Readonly<Record<EncounterSettlementCleanupKind, readonly EncounterSettlementBehavior[]>>)

const fail = (
  code: EncounterSettlementConsequenceSnapshotErrorCode,
  path: string,
  message: string,
): never => {
  throw new EncounterSettlementConsequenceSnapshotError(code, path, message)
}

const isStableId = (value: unknown): value is string => (
  typeof value === 'string' && STABLE_ID.test(value)
)

const authorityKey = (authority: EncounterSettlementAuthorityRef): string => (
  `${authority.kind}\u0000${authority.id}\u0000${authority.revision}`
)

const cloneAuthority = (
  authority: EncounterSettlementAuthorityRef,
  path: string,
): EncounterSettlementAuthorityRef => {
  if (
    !authority
    || !['encounter-document', 'map', 'sheet', 'group-inventory', 'campaign-clock',
      'capture-operation', 'item-operation', 'equipment-operation', 'inventory-operation',
      'objective', 'clock', 'phase', 'effect', 'resource'].includes(authority.kind)
    || !isStableId(authority.id)
    || !Number.isSafeInteger(authority.revision)
    || authority.revision < 0
  ) return fail('invalid-source-fact', path, 'must be one exact supported authority reference.')
  return Object.freeze({ kind: authority.kind, id: authority.id, revision: authority.revision })
}

const normalizeAuthorities = (
  authorities: readonly EncounterSettlementAuthorityRef[],
  path: string,
): readonly EncounterSettlementAuthorityRef[] => {
  if (!Array.isArray(authorities) || authorities.length < 1
    || authorities.length > ENCOUNTER_SETTLEMENT_LIMITS.authorityRefsPerGate) {
    return fail('invalid-coverage', path, 'must contain a bounded non-empty authority list.')
  }
  const normalized = authorities.map((authority, index) => cloneAuthority(authority, `${path}[${index}]`))
    .sort((left, right) => authorityKey(left).localeCompare(authorityKey(right)))
  if (new Set(normalized.map(authorityKey)).size !== normalized.length) {
    return fail('invalid-coverage', path, 'must not contain duplicate authority references.')
  }
  return Object.freeze(normalized)
}

const stableIdentity = (
  prefix: typeof SNAPSHOT_ENTRY_PREFIX | typeof SNAPSHOT_DECISION_PREFIX,
  settlementId: string,
  scope: 'consequence' | 'cleanup',
  sourceFactId: string,
): string => `${prefix}${createHash('sha256')
  .update(prefix)
  .update('\u0000')
  .update(settlementId)
  .update('\u0000')
  .update(scope)
  .update('\u0000')
  .update(sourceFactId)
  .digest('hex')}`

const semanticJson = (value: unknown): string => JSON.stringify(value)

const optionsEqual = (
  left: readonly EncounterSettlementDecisionOption[],
  right: readonly EncounterSettlementDecisionOption[],
): boolean => semanticJson(left) === semanticJson(right)

const snapshotEqual = (
  left: EncounterSettlementSnapshot,
  right: EncounterSettlementSnapshot,
): boolean => semanticJson(left) === semanticJson(right)

const normalizeDecisionOffer = (
  offer: EncounterSettlementSnapshotDecisionOffer | null,
  authority: EncounterSettlementAuthorityRef,
  behavior: EncounterSettlementBehavior,
  path: string,
): EncounterSettlementSnapshotDecisionOffer | null => {
  if ((behavior === 'require-decision') !== (offer !== null)) {
    return fail('invalid-bounded-decision', path, 'must be present exactly for require-decision behavior.')
  }
  if (offer === null) return null
  if (!AUDIENCES.has(offer.audience) || !Array.isArray(offer.options)
    || offer.options.length < 1 || offer.options.length > ENCOUNTER_SETTLEMENT_LIMITS.decisionOptions) {
    return fail('invalid-bounded-decision', path, 'must contain one bounded audience-specific option set.')
  }
  const optionIds = new Set<string>()
  const options = offer.options.map((option, index) => {
    const optionPath = `${path}.options[${index}]`
    if (!isStableId(option.optionId) || optionIds.has(option.optionId)) {
      return fail('invalid-bounded-decision', `${optionPath}.optionId`, 'must be one unique stable option identity.')
    }
    optionIds.add(option.optionId)
    if (!['accept', 'exclude', 'transform'].includes(option.effect)
      || !isStableId(option.valueId)
      || option.authority === null
      || authorityKey(option.authority) !== authorityKey(authority)) {
      return fail('invalid-bounded-decision', optionPath, 'must be a bounded accept, exclude, or transform backed by the exact fact authority.')
    }
    return Object.freeze({
      optionId: option.optionId,
      effect: option.effect,
      valueId: option.valueId,
      authority: cloneAuthority(option.authority, `${optionPath}.authority`),
    })
  })
  return Object.freeze({ audience: offer.audience, options: Object.freeze(options) })
}

const decisionFor = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly scope: 'consequence' | 'cleanup'
  readonly sourceFactId: string
  readonly subjectId: string
  readonly authority: EncounterSettlementAuthorityRef
  readonly behavior: EncounterSettlementBehavior
  readonly offer: EncounterSettlementSnapshotDecisionOffer | null
}): EncounterSettlementDecision | null => {
  const path = `${input.scope}.${input.sourceFactId}.decision`
  const offer = normalizeDecisionOffer(input.offer, input.authority, input.behavior, path)
  if (offer === null) return null
  const decisionId = stableIdentity(
    SNAPSHOT_DECISION_PREFIX,
    input.settlement.settlementId,
    input.scope,
    input.sourceFactId,
  )
  const subject = Object.freeze({ kind: input.scope, id: input.subjectId })
  const existing = input.settlement.decisions.find(decision => decision.decisionId === decisionId)
  if (existing) {
    const sameOffer = existing.kind === input.scope
      && existing.audience === offer.audience
      && existing.subjects.length === 1
      && existing.subjects[0]?.kind === input.scope
      && existing.subjects[0].id === input.subjectId
      && optionsEqual(existing.options, offer.options)
    if (sameOffer) return existing
    if (existing.status === 'accepted') {
      return fail('stale-accepted-decision', path, 'an accepted bounded decision cannot be rewritten after its authority or options changed.')
    }
  }
  return Object.freeze({
    decisionId,
    kind: input.scope,
    audience: offer.audience,
    status: 'open',
    subjects: Object.freeze([subject]),
    options: offer.options,
    selectedOptionId: null,
    decidedBy: null,
    decidedAtCampaignMinute: null,
  })
}

const stateFromDecision = (
  decision: EncounterSettlementDecision | null,
): 'proposed' | 'ready' | 'excluded' => {
  if (!decision) return 'ready'
  if (decision.status === 'open') return 'proposed'
  const selected = decision.options.find(option => option.optionId === decision.selectedOptionId)
  return selected?.effect === 'exclude' ? 'excluded' : 'ready'
}

const consequenceSemanticsEqual = (
  existing: EncounterSettlementPersistentConsequence,
  candidate: EncounterSettlementPersistentConsequence,
): boolean => (
  existing.participantId === candidate.participantId
  && existing.kind === candidate.kind
  && authorityKey(existing.authority) === authorityKey(candidate.authority)
  && existing.field === candidate.field
  && existing.behavior === candidate.behavior
  && snapshotEqual(existing.snapshot, candidate.snapshot)
  && existing.decisionId === candidate.decisionId
)

const cleanupSemanticsEqual = (
  existing: EncounterSettlementCleanupEntry,
  candidate: EncounterSettlementCleanupEntry,
): boolean => (
  existing.kind === candidate.kind
  && authorityKey(existing.authority) === authorityKey(candidate.authority)
  && semanticJson(existing.participantIds) === semanticJson(candidate.participantIds)
  && semanticJson(existing.sourceIds) === semanticJson(candidate.sourceIds)
  && existing.behavior === candidate.behavior
  && existing.decisionId === candidate.decisionId
)

const normalizeCoverage = (
  coverage: readonly EncounterSettlementSnapshotCoverage[],
): readonly EncounterSettlementSnapshotCoverage[] => {
  if (!Array.isArray(coverage) || coverage.length !== ENCOUNTER_SETTLEMENT_SNAPSHOT_COVERAGE_DOMAINS.length) {
    return fail('incomplete-coverage', 'authority.coverage', 'must contain exactly one row for every consequence and cleanup domain.')
  }
  const rows = new Map<EncounterSettlementSnapshotCoverageDomain, EncounterSettlementSnapshotCoverage>()
  coverage.forEach((entry, index) => {
    const path = `authority.coverage[${index}]`
    if (!COVERAGE_DOMAINS.has(entry.domain)
      || (entry.disposition !== 'complete' && entry.disposition !== 'not-applicable')) {
      fail('invalid-coverage', path, 'must name one supported domain and explicit complete or not-applicable disposition.')
    }
    if (rows.has(entry.domain)) fail('incomplete-coverage', 'authority.coverage', 'must not contain duplicate domains.')
    rows.set(entry.domain, Object.freeze({
      domain: entry.domain,
      disposition: entry.disposition,
      authorityRefs: normalizeAuthorities(entry.authorityRefs, `${path}.authorityRefs`),
    }))
  })
  for (const domain of ENCOUNTER_SETTLEMENT_SNAPSHOT_COVERAGE_DOMAINS) {
    if (!rows.has(domain)) fail('incomplete-coverage', 'authority.coverage', `is missing ${domain}.`)
  }
  return Object.freeze(ENCOUNTER_SETTLEMENT_SNAPSHOT_COVERAGE_DOMAINS.map(domain => rows.get(domain)!))
}

const assertCovered = (
  coverageByDomain: ReadonlyMap<EncounterSettlementSnapshotCoverageDomain, EncounterSettlementSnapshotCoverage>,
  domain: EncounterSettlementSnapshotCoverageDomain,
  authority: EncounterSettlementAuthorityRef,
  path: string,
): void => {
  const coverage = coverageByDomain.get(domain)!
  if (coverage.disposition !== 'complete') {
    fail('invalid-coverage', path, `${domain} cannot contain facts while marked not-applicable.`)
  }
  if (!coverage.authorityRefs.some(candidate => authorityKey(candidate) === authorityKey(authority))) {
    fail('invalid-coverage', path, `must use one exact current authority declared by ${domain} coverage.`)
  }
}

const exactStringArray = (
  values: readonly string[],
  path: string,
  maximum: number,
): readonly string[] => {
  if (!Array.isArray(values) || values.length > maximum
    || values.some(value => !isStableId(value))
    || new Set(values).size !== values.length) {
    return fail('invalid-source-fact', path, 'must contain bounded unique stable identities.')
  }
  return Object.freeze([...values].sort())
}

export const buildEncounterSettlementConsequenceSnapshot = (input: {
  readonly settlement: unknown
  readonly authority: EncounterSettlementConsequenceAuthoritySnapshot
}): EncounterSettlementConsequenceSnapshotResult => {
  const settlement = parseEncounterSettlementDocument(input.settlement)
  if (settlement.status === 'committing' || settlement.status === 'completed' || settlement.status === 'cancelled') {
    return fail('terminal-settlement', 'settlement.status', 'cannot rebuild consequence authority after commit has begun.')
  }
  if (!input.authority || input.authority.completeness !== 'authoritative-current') {
    return fail('incomplete-coverage', 'authority.completeness', 'must certify one complete current source read.')
  }
  const coverage = normalizeCoverage(input.authority.coverage)
  const coverageByDomain = new Map(coverage.map(entry => [entry.domain, entry] as const))
  const participantIds = new Set(settlement.participants.map(participant => participant.participantId))
  const sourceFactIds = new Set<string>()
  const semanticFactKeys = new Set<string>()
  const snapshotDecisions: EncounterSettlementDecision[] = []
  const consequences: EncounterSettlementPersistentConsequence[] = []
  const expectedEntryIds = new Set<string>()
  const expectedDecisionIds = new Set<string>()

  if (!Array.isArray(input.authority.persistentConsequences as unknown)
    || input.authority.persistentConsequences.length > ENCOUNTER_SETTLEMENT_LIMITS.consequences) {
    return fail('invalid-source-fact', 'authority.persistentConsequences', 'must be one bounded source-fact list.')
  }
  const persistentFacts: readonly EncounterSettlementPersistentConsequenceFact[] = input.authority.persistentConsequences
  persistentFacts.forEach((fact, index) => {
    const path = `authority.persistentConsequences[${index}]`
    if (!isStableId(fact.sourceFactId) || sourceFactIds.has(fact.sourceFactId)) {
      fail('duplicate-source-fact', `${path}.sourceFactId`, 'must be one globally unique stable source-fact identity.')
    }
    sourceFactIds.add(fact.sourceFactId)
    if (!ENCOUNTER_SETTLEMENT_CONSEQUENCE_KINDS.includes(fact.kind)
      || !isStableId(fact.field)
      || (fact.participantId !== null && !participantIds.has(fact.participantId))) {
      fail('invalid-source-fact', path, 'must name one supported field and current participant when scoped.')
    }
    const allowed = new Set<EncounterSettlementBehavior>(ENCOUNTER_SETTLEMENT_PERSISTENT_SNAPSHOT_BEHAVIORS[fact.kind])
    if (!allowed.has(fact.behavior)) {
      fail('unsupported-behavior', `${path}.behavior`, `${fact.kind} cannot use ${fact.behavior} in the persistent snapshot.`)
    }
    const authority = cloneAuthority(fact.authority, `${path}.authority`)
    assertCovered(coverageByDomain, `consequence:${fact.kind}`, authority, path)
    const semanticKey = `${fact.participantId ?? '-'}\u0000${fact.kind}\u0000${fact.field}`
    if (semanticFactKeys.has(semanticKey)) fail('duplicate-source-fact', path, 'duplicates one participant, kind, and field.')
    semanticFactKeys.add(semanticKey)
    const consequenceId = stableIdentity(SNAPSHOT_ENTRY_PREFIX, settlement.settlementId, 'consequence', fact.sourceFactId)
    expectedEntryIds.add(consequenceId)
    const decision = decisionFor({
      settlement,
      scope: 'consequence',
      sourceFactId: fact.sourceFactId,
      subjectId: consequenceId,
      authority,
      behavior: fact.behavior,
      offer: fact.decision,
    })
    if (decision) {
      snapshotDecisions.push(decision)
      expectedDecisionIds.add(decision.decisionId)
    }
    const candidate: EncounterSettlementPersistentConsequence = Object.freeze({
      consequenceId,
      participantId: fact.participantId,
      kind: fact.kind,
      authority,
      field: fact.field,
      behavior: fact.behavior,
      snapshot: fact.snapshot,
      state: stateFromDecision(decision),
      decisionId: decision?.decisionId ?? null,
      receiptId: null,
    })
    const existing = settlement.persistentConsequences.find(entry => entry.consequenceId === consequenceId)
    if (existing && !consequenceSemanticsEqual(existing, candidate)
      && (existing.state === 'applied' || existing.receiptId !== null)) {
      fail('stale-applied-snapshot', path, 'cannot rewrite an applied consequence or its receipt evidence.')
    }
    const preserveExisting = existing
      && consequenceSemanticsEqual(existing, candidate)
      && (existing.state === candidate.state || existing.state === 'applied' || existing.receiptId !== null)
    consequences.push(preserveExisting ? existing : candidate)
  })

  for (const kind of ['hp', 'injuries', 'conditions', 'equipment'] as const) {
    for (const participantId of participantIds) {
      if (!consequences.some(entry => entry.kind === kind && entry.participantId === participantId)) {
        fail(
          'incomplete-coverage',
          `authority.persistentConsequences.${kind}`,
          `must contain current ${kind} evidence for participant ${participantId}.`,
        )
      }
    }
  }

  const cleanupEntries: EncounterSettlementCleanupEntry[] = []
  if (!Array.isArray(input.authority.temporaryCleanup as unknown)
    || input.authority.temporaryCleanup.length > ENCOUNTER_SETTLEMENT_LIMITS.cleanupEntries) {
    return fail('invalid-source-fact', 'authority.temporaryCleanup', 'must be one bounded source-fact list.')
  }
  const cleanupFacts: readonly EncounterSettlementTemporaryCleanupFact[] = input.authority.temporaryCleanup
  cleanupFacts.forEach((fact, index) => {
    const path = `authority.temporaryCleanup[${index}]`
    if (!isStableId(fact.sourceFactId) || sourceFactIds.has(fact.sourceFactId)) {
      fail('duplicate-source-fact', `${path}.sourceFactId`, 'must be one globally unique stable source-fact identity.')
    }
    sourceFactIds.add(fact.sourceFactId)
    if (!ENCOUNTER_SETTLEMENT_CLEANUP_KINDS.includes(fact.kind)) {
      fail('invalid-source-fact', `${path}.kind`, 'must name one supported cleanup kind.')
    }
    const allowed = new Set<EncounterSettlementBehavior>(ENCOUNTER_SETTLEMENT_TEMPORARY_CLEANUP_BEHAVIORS[fact.kind])
    if (!allowed.has(fact.behavior)) {
      fail('unsupported-behavior', `${path}.behavior`, `${fact.kind} cannot use ${fact.behavior} in temporary cleanup.`)
    }
    const authority = cloneAuthority(fact.authority, `${path}.authority`)
    assertCovered(coverageByDomain, `cleanup:${fact.kind}`, authority, path)
    const cleanupParticipantIds = exactStringArray(
      fact.participantIds,
      `${path}.participantIds`,
      ENCOUNTER_SETTLEMENT_LIMITS.participantRefsPerEntry,
    )
    if (cleanupParticipantIds.some(participantId => !participantIds.has(participantId))) {
      fail('invalid-source-fact', `${path}.participantIds`, 'references a participant outside this settlement.')
    }
    const sourceIds = exactStringArray(
      fact.sourceIds,
      `${path}.sourceIds`,
      ENCOUNTER_SETTLEMENT_LIMITS.participantRefsPerEntry,
    )
    if (sourceIds.length < 1) fail('invalid-source-fact', `${path}.sourceIds`, 'must name at least one exact temporary source.')
    const cleanupId = stableIdentity(SNAPSHOT_ENTRY_PREFIX, settlement.settlementId, 'cleanup', fact.sourceFactId)
    expectedEntryIds.add(cleanupId)
    const decision = decisionFor({
      settlement,
      scope: 'cleanup',
      sourceFactId: fact.sourceFactId,
      subjectId: cleanupId,
      authority,
      behavior: fact.behavior,
      offer: fact.decision,
    })
    if (decision) {
      snapshotDecisions.push(decision)
      expectedDecisionIds.add(decision.decisionId)
    }
    const candidate: EncounterSettlementCleanupEntry = Object.freeze({
      cleanupId,
      kind: fact.kind,
      authority,
      participantIds: cleanupParticipantIds,
      sourceIds,
      behavior: fact.behavior,
      state: stateFromDecision(decision),
      decisionId: decision?.decisionId ?? null,
      receiptId: null,
    })
    const existing = settlement.temporaryCleanup.find(entry => entry.cleanupId === cleanupId)
    if (existing && !cleanupSemanticsEqual(existing, candidate)
      && (existing.state === 'applied' || existing.receiptId !== null)) {
      fail('stale-applied-snapshot', path, 'cannot rewrite applied cleanup or its receipt evidence.')
    }
    const preserveExisting = existing
      && cleanupSemanticsEqual(existing, candidate)
      && (existing.state === candidate.state || existing.state === 'applied' || existing.receiptId !== null)
    cleanupEntries.push(preserveExisting ? existing : candidate)
  })

  for (const entry of [...settlement.persistentConsequences, ...settlement.temporaryCleanup]) {
    const id = 'consequenceId' in entry ? entry.consequenceId : entry.cleanupId
    if (!id.startsWith(SNAPSHOT_ENTRY_PREFIX)) {
      fail('orphaned-snapshot-entry', id, 'is not owned by the versioned source snapshot builder and cannot be replaced implicitly.')
    }
    if (!expectedEntryIds.has(id) && (entry.state === 'applied' || entry.receiptId !== null)) {
      fail('orphaned-snapshot-entry', id, 'an applied source fact cannot disappear from a complete refreshed snapshot.')
    }
  }
  for (const decision of settlement.decisions) {
    if (decision.decisionId.startsWith(SNAPSHOT_DECISION_PREFIX)
      && !expectedDecisionIds.has(decision.decisionId)
      && decision.status === 'accepted') {
      fail('orphaned-snapshot-entry', decision.decisionId, 'an accepted snapshot decision cannot disappear from a complete refresh.')
    }
  }

  consequences.sort((left, right) => left.consequenceId.localeCompare(right.consequenceId))
  cleanupEntries.sort((left, right) => left.cleanupId.localeCompare(right.cleanupId))
  snapshotDecisions.sort((left, right) => left.decisionId.localeCompare(right.decisionId))
  const otherDecisions = settlement.decisions.filter(decision => !decision.decisionId.startsWith(SNAPSHOT_DECISION_PREFIX))
  const document = parseEncounterSettlementDocument({
    ...settlement,
    persistentConsequences: consequences,
    temporaryCleanup: cleanupEntries,
    decisions: [...otherDecisions, ...snapshotDecisions],
  })
  return Object.freeze({
    document,
    persistentConsequences: document.persistentConsequences,
    temporaryCleanup: document.temporaryCleanup,
    snapshotDecisions: Object.freeze(document.decisions.filter(decision => decision.decisionId.startsWith(SNAPSHOT_DECISION_PREFIX))),
    coverage,
  })
}
