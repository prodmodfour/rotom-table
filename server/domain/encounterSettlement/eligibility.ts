import { createHash } from 'node:crypto'
import {
  ENCOUNTER_SETTLEMENT_AUTHORITY_KINDS,
  ENCOUNTER_SETTLEMENT_GATE_RESOLUTIONS,
  ENCOUNTER_SETTLEMENT_LIMITS,
  parseEncounterSettlementDocument,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementAudience,
  type EncounterSettlementDocument,
  type EncounterSettlementEncounterRef,
  type EncounterSettlementGate,
  type EncounterSettlementGateKind,
  type EncounterSettlementGateResolution,
  type EncounterSettlementParticipant,
  type EncounterSettlementStatus,
} from '#shared/encounterSettlement/document'

export const ENCOUNTER_SETTLEMENT_BLOCKING_FACT_KINDS = [
  'pending-reaction',
  'pending-resolution',
  'uncertain-command',
  'private-choice',
  'invalid-participant',
  'unsupported-authority',
  'gm-adjudication',
] as const

export type EncounterSettlementBlockingFactKind =
  (typeof ENCOUNTER_SETTLEMENT_BLOCKING_FACT_KINDS)[number]

export const ENCOUNTER_SETTLEMENT_FACT_RESOLUTIONS = Object.freeze({
  'pending-reaction': Object.freeze(['choose'] as const),
  'pending-resolution': Object.freeze(['retry-exact', 'choose'] as const),
  'uncertain-command': Object.freeze(['retry-exact', 'refresh'] as const),
  'private-choice': Object.freeze(['choose'] as const),
  'invalid-participant': Object.freeze(['refresh', 'correct', 'exclude'] as const),
  'unsupported-authority': Object.freeze(['correct', 'exclude'] as const),
  'gm-adjudication': Object.freeze(['adjudicate', 'correct', 'exclude'] as const),
} satisfies Readonly<Record<EncounterSettlementBlockingFactKind, readonly EncounterSettlementGateResolution[]>>)

/**
 * One current, server-derived blocker. `factId` is a stable private identity
 * owned by the source subsystem; it is never a label or client assertion.
 */
export interface EncounterSettlementBlockingFact {
  readonly factId: string
  readonly kind: EncounterSettlementBlockingFactKind
  readonly audience: EncounterSettlementAudience
  readonly authorityRefs: readonly EncounterSettlementAuthorityRef[]
  readonly participantIds: readonly string[]
  readonly resolutionKinds: readonly EncounterSettlementGateResolution[]
}

/**
 * Complete current authority used to compare a settlement draft. Callers must
 * gather all blocking facts from source-owned repositories before evaluation.
 */
export interface EncounterSettlementEligibilityAuthoritySnapshot {
  readonly completeness: 'authoritative-current'
  readonly encounter: EncounterSettlementEncounterRef
  readonly participants: readonly EncounterSettlementParticipant[]
  readonly blockingFacts: readonly EncounterSettlementBlockingFact[]
}

export type EncounterSettlementEligibilityOutcome =
  | 'eligible'
  | 'blocked'
  | 'committing'
  | 'terminal'

export interface EncounterSettlementEligibilityResult {
  readonly outcome: EncounterSettlementEligibilityOutcome
  readonly eligible: boolean
  readonly nextStatus: EncounterSettlementStatus
  readonly unresolvedGates: readonly EncounterSettlementGate[]
  readonly resolvedByRecordedGmCorrectionGateIds: readonly string[]
}

export type EncounterSettlementEligibilityErrorCode =
  | 'invalid-authority-snapshot'
  | 'duplicate-authority-fact'
  | 'invalid-blocking-fact'
  | 'invalid-current-participant'
  | 'gate-limit-exceeded'

export class EncounterSettlementEligibilityError extends Error {
  constructor(
    readonly code: EncounterSettlementEligibilityErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'EncounterSettlementEligibilityError'
  }
}

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const AUTHORITY_KIND_SET = new Set<string>(ENCOUNTER_SETTLEMENT_AUTHORITY_KINDS)
const GATE_RESOLUTION_SET = new Set<string>(ENCOUNTER_SETTLEMENT_GATE_RESOLUTIONS)
const FACT_KIND_SET = new Set<string>(ENCOUNTER_SETTLEMENT_BLOCKING_FACT_KINDS)

const fail = (
  code: EncounterSettlementEligibilityErrorCode,
  path: string,
  message: string,
): never => {
  throw new EncounterSettlementEligibilityError(code, path, message)
}

const isStableId = (value: unknown): value is string => (
  typeof value === 'string' && STABLE_ID.test(value)
)

const authorityKey = (authority: EncounterSettlementAuthorityRef): string => (
  `${authority.kind}\u0000${authority.id}\u0000${authority.revision}`
)

const sameAuthority = (
  left: EncounterSettlementAuthorityRef,
  right: EncounterSettlementAuthorityRef,
): boolean => authorityKey(left) === authorityKey(right)

const validateAuthority = (
  authority: EncounterSettlementAuthorityRef,
  path: string,
): EncounterSettlementAuthorityRef => {
  if (
    !authority
    || !AUTHORITY_KIND_SET.has(authority.kind)
    || !isStableId(authority.id)
    || !Number.isSafeInteger(authority.revision)
    || authority.revision < 0
  ) {
    return fail('invalid-authority-snapshot', path, 'must be one exact supported authority reference.')
  }
  return Object.freeze({
    kind: authority.kind,
    id: authority.id,
    revision: authority.revision,
  })
}

const normalizeAuthorities = (
  authorities: readonly EncounterSettlementAuthorityRef[],
  path: string,
): readonly EncounterSettlementAuthorityRef[] => {
  if (!Array.isArray(authorities) || authorities.length < 1
    || authorities.length > ENCOUNTER_SETTLEMENT_LIMITS.authorityRefsPerGate) {
    return fail(
      'invalid-authority-snapshot',
      path,
      `must contain 1 through ${ENCOUNTER_SETTLEMENT_LIMITS.authorityRefsPerGate} exact authorities.`,
    )
  }
  const normalized = authorities.map((authority, index) => validateAuthority(authority, `${path}[${index}]`))
    .sort((left, right) => authorityKey(left).localeCompare(authorityKey(right)))
  if (new Set(normalized.map(authorityKey)).size !== normalized.length) {
    return fail('invalid-authority-snapshot', path, 'must not contain duplicate authority references.')
  }
  return Object.freeze(normalized)
}

const encounterAuthorities = (
  encounter: EncounterSettlementEncounterRef,
): readonly EncounterSettlementAuthorityRef[] => Object.freeze([
  Object.freeze({
    kind: 'encounter-document' as const,
    id: encounter.encounterId,
    revision: encounter.encounterRevision,
  }),
  Object.freeze({
    kind: 'map' as const,
    id: encounter.linkedMapSlug,
    revision: encounter.linkedMapRevision,
  }),
])

const participantAuthorities = (
  participant: EncounterSettlementParticipant,
): readonly EncounterSettlementAuthorityRef[] => normalizeAuthorities([
  participant.sourceAuthority,
  {
    kind: 'sheet',
    id: participant.sheetSlug,
    revision: participant.sheetRevision,
  },
], `currentParticipants.${participant.participantId}.authorities`)

const gateIdentity = (
  settlementId: string,
  kind: EncounterSettlementGateKind,
  sourceKey: string,
): string => {
  const digest = createHash('sha256')
    .update('encounter-settlement-gate:v1\u0000')
    .update(settlementId)
    .update('\u0000')
    .update(kind)
    .update('\u0000')
    .update(sourceKey)
    .digest('hex')
  return `settlement-gate:v1:${digest}`
}

interface AddGateInput {
  readonly kind: EncounterSettlementGateKind
  readonly sourceKey: string
  readonly audience: EncounterSettlementAudience
  readonly authorityRefs: readonly EncounterSettlementAuthorityRef[]
  readonly participantIds?: readonly string[]
  readonly resolutionKinds: readonly EncounterSettlementGateResolution[]
}

const isCurrentParticipantIdentity = (
  participant: EncounterSettlementParticipant,
): boolean => (
  isStableId(participant.participantId)
  && isStableId(participant.sheetSlug)
  && (participant.sideId === null || isStableId(participant.sideId))
  && (participant.ownerParticipantId === null || isStableId(participant.ownerParticipantId))
  && (participant.sheetKind === 'trainer' || participant.sheetKind === 'pokemon')
  && Number.isSafeInteger(participant.sheetRevision)
  && participant.sheetRevision >= 0
  && ['combatant', 'support', 'observer'].includes(participant.settlementRole)
  && ['active', 'defeated', 'withdrawn', 'escaped', 'captured', 'excluded'].includes(participant.disposition)
)

const validateCurrentParticipants = (
  participants: readonly EncounterSettlementParticipant[],
): ReadonlyMap<string, EncounterSettlementParticipant> => {
  if (!Array.isArray(participants) || participants.length > ENCOUNTER_SETTLEMENT_LIMITS.participants) {
    return fail('invalid-current-participant', 'authority.participants', 'must be one bounded participant array.')
  }
  const byId = new Map<string, EncounterSettlementParticipant>()
  participants.forEach((participant, index) => {
    const path = `authority.participants[${index}]`
    if (!isCurrentParticipantIdentity(participant)) {
      fail('invalid-current-participant', path, 'must be one complete current participant authority snapshot.')
    }
    validateAuthority(participant.sourceAuthority, `${path}.sourceAuthority`)
    if (byId.has(participant.participantId)) {
      fail('invalid-current-participant', 'authority.participants', 'must not contain duplicate participant identities.')
    }
    byId.set(participant.participantId, participant)
  })
  return byId
}

const validateEncounter = (encounter: EncounterSettlementEncounterRef): void => {
  if (
    !encounter
    || !isStableId(encounter.encounterId)
    || !isStableId(encounter.linkedMapSlug)
    || !Number.isSafeInteger(encounter.encounterRevision)
    || encounter.encounterRevision < 0
    || !Number.isSafeInteger(encounter.linkedMapRevision)
    || encounter.linkedMapRevision < 0
    || !Number.isSafeInteger(encounter.campaignMinute)
    || encounter.campaignMinute < 0
  ) {
    fail('invalid-authority-snapshot', 'authority.encounter', 'must be one complete current encounter checkpoint.')
  }
}

const validateFacts = (
  facts: readonly EncounterSettlementBlockingFact[],
  participantIds: ReadonlySet<string>,
): readonly EncounterSettlementBlockingFact[] => {
  if (!Array.isArray(facts) || facts.length > ENCOUNTER_SETTLEMENT_LIMITS.unresolvedGates) {
    return fail('invalid-blocking-fact', 'authority.blockingFacts', 'must be a bounded complete fact list.')
  }
  const factIds = new Set<string>()
  return Object.freeze(facts.map((fact, index) => {
    const path = `authority.blockingFacts[${index}]`
    if (!isStableId(fact.factId) || !FACT_KIND_SET.has(fact.kind)) {
      return fail('invalid-blocking-fact', path, 'must have one stable identity and supported fact kind.')
    }
    const factKind: EncounterSettlementBlockingFactKind = fact.kind
    if (factIds.has(fact.factId)) {
      return fail('duplicate-authority-fact', 'authority.blockingFacts', 'must not contain duplicate fact identities.')
    }
    factIds.add(fact.factId)
    if (!['public', 'participant-owner', 'destination-owner', 'gm'].includes(fact.audience)) {
      return fail('invalid-blocking-fact', `${path}.audience`, 'must be one supported settlement audience.')
    }
    if (!Array.isArray(fact.participantIds)
      || fact.participantIds.length > ENCOUNTER_SETTLEMENT_LIMITS.participantRefsPerEntry
      || new Set(fact.participantIds).size !== fact.participantIds.length
      || fact.participantIds.some((id: string) => !participantIds.has(id))) {
      return fail('invalid-blocking-fact', `${path}.participantIds`, 'must contain unique current settlement participants only.')
    }
    if (!Array.isArray(fact.resolutionKinds) || fact.resolutionKinds.length < 1
      || new Set(fact.resolutionKinds).size !== fact.resolutionKinds.length
      || fact.resolutionKinds.some((resolution: EncounterSettlementGateResolution) => !GATE_RESOLUTION_SET.has(resolution))) {
      return fail('invalid-blocking-fact', `${path}.resolutionKinds`, 'must contain unique bounded resolutions.')
    }
    const allowed = new Set<EncounterSettlementGateResolution>(ENCOUNTER_SETTLEMENT_FACT_RESOLUTIONS[factKind])
    if (fact.resolutionKinds.some((resolution: EncounterSettlementGateResolution) => !allowed.has(resolution))) {
      return fail('invalid-blocking-fact', `${path}.resolutionKinds`, `contains a resolution not owned by ${fact.kind}.`)
    }
    return Object.freeze({
      factId: fact.factId,
      kind: fact.kind,
      audience: fact.audience,
      authorityRefs: normalizeAuthorities(fact.authorityRefs, `${path}.authorityRefs`),
      participantIds: Object.freeze([...fact.participantIds].sort()),
      resolutionKinds: Object.freeze([...fact.resolutionKinds]),
    })
  }))
}

const selectedCorrectionOption = (
  settlement: EncounterSettlementDocument,
  gate: EncounterSettlementGate,
) => {
  for (const decision of settlement.decisions) {
    if (
      decision.kind !== 'gm-correction'
      || decision.audience !== 'gm'
      || decision.status !== 'accepted'
      || decision.decidedBy?.kind !== 'gm'
      || decision.selectedOptionId === null
      || decision.decidedAtCampaignMinute === null
    ) continue
    const gateSubjects = decision.subjects.filter(subject => subject.kind === 'gate')
    if (gateSubjects.length !== 1 || gateSubjects[0]?.id !== gate.gateId) continue
    const option = decision.options.find(candidate => candidate.optionId === decision.selectedOptionId)
    if (!option || option.authority === null || option.valueId === null) continue
    const resolution = option.valueId as EncounterSettlementGateResolution
    if (!gate.resolutionKinds.includes(resolution)) continue
    const legalEffect = (
      (resolution === 'adjudicate' && option.effect === 'waive')
      || (resolution === 'correct' && option.effect === 'correct')
      || (resolution === 'exclude' && option.effect === 'exclude')
    )
    if (!legalEffect || !gate.authorityRefs.some(authority => sameAuthority(authority, option.authority!))) continue
    const receipt = settlement.receipts.find(candidate => (
      candidate.kind === 'decision'
      && candidate.audience === 'gm'
      && candidate.result === 'accepted'
      && candidate.acceptedAtCampaignMinute === decision.decidedAtCampaignMinute
      && candidate.subjects.some(subject => subject.kind === 'decision' && subject.id === decision.decisionId)
      && candidate.subjects.some(subject => subject.kind === 'gate' && subject.id === gate.gateId)
    ))
    if (receipt) return option
  }
  return null
}

const compareParticipantIdentity = (
  draft: EncounterSettlementParticipant,
  current: EncounterSettlementParticipant,
): boolean => (
  draft.sheetKind === current.sheetKind
  && draft.sheetSlug === current.sheetSlug
  && draft.sideId === current.sideId
  && draft.ownerParticipantId === current.ownerParticipantId
  && draft.settlementRole === current.settlementRole
  && draft.disposition === current.disposition
  && draft.sourceAuthority.kind === current.sourceAuthority.kind
  && draft.sourceAuthority.id === current.sourceAuthority.id
)

const isRevisionRollback = (
  draft: EncounterSettlementParticipant,
  current: EncounterSettlementParticipant,
): boolean => (
  current.sheetRevision < draft.sheetRevision
  || current.sourceAuthority.revision < draft.sourceAuthority.revision
)

const isRevisionAdvance = (
  draft: EncounterSettlementParticipant,
  current: EncounterSettlementParticipant,
): boolean => (
  current.sheetRevision > draft.sheetRevision
  || current.sourceAuthority.revision > draft.sourceAuthority.revision
)

export const evaluateEncounterSettlementEligibility = (input: {
  readonly settlement: unknown
  readonly authority: EncounterSettlementEligibilityAuthoritySnapshot
}): EncounterSettlementEligibilityResult => {
  const settlement = parseEncounterSettlementDocument(input.settlement)
  if (!input.authority || input.authority.completeness !== 'authoritative-current') {
    return fail('invalid-authority-snapshot', 'authority.completeness', 'must explicitly certify one complete current authority read.')
  }
  validateEncounter(input.authority.encounter)
  const currentById = validateCurrentParticipants(input.authority.participants)
  const participantIds = new Set(settlement.participants.map(participant => participant.participantId))
  const facts = validateFacts(input.authority.blockingFacts, participantIds)
  const existingById = new Map(settlement.unresolvedGates.map(gate => [gate.gateId, gate] as const))
  const gates = new Map<string, EncounterSettlementGate>()

  const addGate = (candidate: AddGateInput): void => {
    const gateId = gateIdentity(settlement.settlementId, candidate.kind, candidate.sourceKey)
    const participantIds = Object.freeze([...(candidate.participantIds ?? [])].sort())
    const resolutionKinds = Object.freeze([...candidate.resolutionKinds])
    const gate = Object.freeze({
      gateId,
      kind: candidate.kind,
      blocking: true as const,
      audience: candidate.audience,
      authorityRefs: normalizeAuthorities(candidate.authorityRefs, `gates.${gateId}.authorityRefs`),
      participantIds,
      resolutionKinds,
      openedAtSettlementRevision: existingById.get(gateId)?.openedAtSettlementRevision ?? settlement.revision,
    })
    gates.set(gateId, gate)
  }

  const currentEncounter = input.authority.encounter
  const currentEncounterAuthorities = encounterAuthorities(currentEncounter)
  const encounterIdentityChanged = (
    currentEncounter.encounterId !== settlement.encounter.encounterId
    || currentEncounter.linkedMapSlug !== settlement.encounter.linkedMapSlug
  )
  if (encounterIdentityChanged) {
    addGate({
      kind: 'stale-snapshot',
      sourceKey: 'encounter:identity',
      audience: 'gm',
      authorityRefs: currentEncounterAuthorities,
      resolutionKinds: ['refresh'],
    })
  }
  else {
    const rolledBack = (
      currentEncounter.encounterRevision < settlement.encounter.encounterRevision
      || currentEncounter.linkedMapRevision < settlement.encounter.linkedMapRevision
      || currentEncounter.campaignMinute < settlement.encounter.campaignMinute
    )
    const advanced = (
      currentEncounter.encounterRevision > settlement.encounter.encounterRevision
      || currentEncounter.linkedMapRevision > settlement.encounter.linkedMapRevision
      || currentEncounter.campaignMinute > settlement.encounter.campaignMinute
    )
    if (rolledBack) {
      addGate({
        kind: 'revision-conflict',
        sourceKey: 'encounter:revision-rollback',
        audience: 'gm',
        authorityRefs: currentEncounterAuthorities,
        resolutionKinds: ['correct'],
      })
    }
    else if (advanced) {
      addGate({
        kind: 'stale-snapshot',
        sourceKey: 'encounter:revision-advanced',
        audience: 'gm',
        authorityRefs: currentEncounterAuthorities,
        resolutionKinds: ['refresh'],
      })
    }
  }

  for (const draft of settlement.participants) {
    const current = currentById.get(draft.participantId)
    if (!current) {
      addGate({
        kind: 'invalid-participant',
        sourceKey: `participant:${draft.participantId}:missing`,
        audience: 'gm',
        authorityRefs: participantAuthorities(draft),
        participantIds: [draft.participantId],
        resolutionKinds: ['refresh', 'exclude'],
      })
      continue
    }
    if (!compareParticipantIdentity(draft, current)) {
      addGate({
        kind: 'invalid-participant',
        sourceKey: `participant:${draft.participantId}:identity`,
        audience: 'gm',
        authorityRefs: participantAuthorities(current),
        participantIds: [draft.participantId],
        resolutionKinds: ['refresh', 'correct', 'exclude'],
      })
      continue
    }
    if (isRevisionRollback(draft, current)) {
      addGate({
        kind: 'revision-conflict',
        sourceKey: `participant:${draft.participantId}:revision-rollback`,
        audience: 'gm',
        authorityRefs: participantAuthorities(current),
        participantIds: [draft.participantId],
        resolutionKinds: ['correct'],
      })
    }
    else if (isRevisionAdvance(draft, current)) {
      addGate({
        kind: 'stale-snapshot',
        sourceKey: `participant:${draft.participantId}:revision-advanced`,
        audience: 'gm',
        authorityRefs: participantAuthorities(current),
        participantIds: [draft.participantId],
        resolutionKinds: ['refresh'],
      })
    }
  }

  for (const current of input.authority.participants) {
    if (participantIds.has(current.participantId)) continue
    addGate({
      kind: 'invalid-participant',
      sourceKey: `participant:${current.participantId}:unexpected`,
      audience: 'gm',
      authorityRefs: participantAuthorities(current),
      resolutionKinds: ['refresh', 'exclude'],
    })
  }

  for (const fact of facts) {
    addGate({
      kind: fact.kind,
      sourceKey: `fact:${fact.factId}`,
      audience: fact.audience,
      authorityRefs: fact.authorityRefs,
      participantIds: fact.participantIds,
      resolutionKinds: fact.resolutionKinds,
    })
  }

  const decisionsById = new Map(settlement.decisions.map(decision => [decision.decisionId, decision] as const))
  const structurallyLinkedDecisionIds = new Set([
    ...settlement.persistentConsequences.flatMap(entry => entry.decisionId ? [entry.decisionId] : []),
    ...settlement.allocations.flatMap(entry => entry.decisionId ? [entry.decisionId] : []),
    ...settlement.temporaryCleanup.flatMap(entry => entry.decisionId ? [entry.decisionId] : []),
  ])
  for (const decision of settlement.decisions) {
    if (decision.status !== 'open' || structurallyLinkedDecisionIds.has(decision.decisionId)) continue
    const authorities = decision.options.flatMap(option => option.authority ? [option.authority] : [])
    addGate({
      kind: decision.kind === 'gm-correction' ? 'gm-adjudication' : 'private-choice',
      sourceKey: `decision:${decision.decisionId}`,
      audience: decision.audience,
      authorityRefs: authorities.length > 0 ? authorities : currentEncounterAuthorities,
      resolutionKinds: decision.kind === 'gm-correction' ? ['adjudicate', 'correct', 'exclude'] : ['choose'],
    })
  }

  for (const consequence of settlement.persistentConsequences) {
    if (consequence.behavior !== 'require-decision' || consequence.state === 'applied' || consequence.state === 'excluded') continue
    const decision = consequence.decisionId ? decisionsById.get(consequence.decisionId) : null
    if (decision?.status === 'accepted') continue
    addGate({
      kind: 'private-choice',
      sourceKey: `consequence:${consequence.consequenceId}:decision`,
      audience: decision?.audience ?? 'gm',
      authorityRefs: [consequence.authority],
      participantIds: consequence.participantId ? [consequence.participantId] : [],
      resolutionKinds: ['choose'],
    })
  }

  for (const reward of settlement.rewardPackage.lines) {
    if (reward.disposition !== 'pending') continue
    addGate({
      kind: reward.payload.kind === 'capture' ? 'capture-destination' : 'unallocated-reward',
      sourceKey: `reward:${reward.rewardId}`,
      audience: reward.visibility,
      authorityRefs: [reward.sourceAuthority],
      resolutionKinds: reward.payload.kind === 'capture' ? ['choose', 'exclude'] : ['allocate', 'exclude'],
    })
  }

  for (const cleanup of settlement.temporaryCleanup) {
    if (cleanup.behavior !== 'require-decision' || cleanup.state === 'applied' || cleanup.state === 'excluded') continue
    const decision = cleanup.decisionId ? decisionsById.get(cleanup.decisionId) : null
    if (decision?.status === 'accepted') continue
    addGate({
      kind: 'cleanup-decision',
      sourceKey: `cleanup:${cleanup.cleanupId}:decision`,
      audience: decision?.audience ?? 'gm',
      authorityRefs: [cleanup.authority],
      participantIds: cleanup.participantIds,
      resolutionKinds: ['choose'],
    })
  }

  const resolvedByCorrection: string[] = []
  for (const [gateId, gate] of gates) {
    if (gate.kind !== 'gm-adjudication') continue
    if (selectedCorrectionOption(settlement, gate)) {
      gates.delete(gateId)
      resolvedByCorrection.push(gateId)
    }
  }

  if (gates.size > ENCOUNTER_SETTLEMENT_LIMITS.unresolvedGates) {
    return fail('gate-limit-exceeded', 'settlement.unresolvedGates', `derived more than ${ENCOUNTER_SETTLEMENT_LIMITS.unresolvedGates} current gates.`)
  }

  const unresolved = [...gates.values()].sort((left, right) => left.gateId.localeCompare(right.gateId))
  const hypotheticalStatus: EncounterSettlementStatus = unresolved.length > 0 ? 'blocked' : 'ready'
  const terminal = settlement.status === 'completed' || settlement.status === 'cancelled'
  const validated = parseEncounterSettlementDocument({
    ...settlement,
    status: terminal
      ? settlement.status
      : settlement.status === 'committing' ? 'committing' : hypotheticalStatus,
    unresolvedGates: terminal ? settlement.unresolvedGates : unresolved,
  })

  if (terminal) {
    return Object.freeze({
      outcome: 'terminal',
      eligible: false,
      nextStatus: settlement.status,
      unresolvedGates: validated.unresolvedGates,
      resolvedByRecordedGmCorrectionGateIds: Object.freeze(resolvedByCorrection.sort()),
    })
  }
  if (settlement.status === 'committing') {
    return Object.freeze({
      outcome: 'committing',
      eligible: false,
      nextStatus: 'committing',
      unresolvedGates: validated.unresolvedGates,
      resolvedByRecordedGmCorrectionGateIds: Object.freeze(resolvedByCorrection.sort()),
    })
  }
  return Object.freeze({
    outcome: validated.unresolvedGates.length > 0 ? 'blocked' : 'eligible',
    eligible: validated.unresolvedGates.length === 0,
    nextStatus: validated.unresolvedGates.length > 0 ? 'blocked' : 'ready',
    unresolvedGates: validated.unresolvedGates,
    resolvedByRecordedGmCorrectionGateIds: Object.freeze(resolvedByCorrection.sort()),
  })
}
