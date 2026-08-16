import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseEncounterDocument,
  type EncounterDocument,
  type EncounterDocumentClock,
  type EncounterDocumentObjective,
  type EncounterDocumentPhase,
} from '#shared/encounterDocuments/model'
import {
  parseEncounterSettlementDocument,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementAudience,
  type EncounterSettlementDocument,
  type EncounterSettlementPersistentConsequence,
  type EncounterSettlementSnapshot,
} from '#shared/encounterSettlement/document'

export type EncounterSettlementOutcomeDeclaration =
  | {
      readonly kind: 'objective'
      readonly subjectId: string
      readonly status: 'completed' | 'failed'
    }
  | {
      readonly kind: 'clock'
      readonly subjectId: string
      readonly status: 'paused' | 'completed'
      readonly progress: number
    }
  | {
      readonly kind: 'phase'
      readonly subjectId: string
      readonly status: 'completed'
      readonly summary: string | null
    }
  | {
      readonly kind: 'stake'
      readonly subjectId: 'public' | 'gm'
      readonly result: 'realized' | 'avoided' | 'changed'
      readonly summary: string
    }

export interface EncounterSettlementCampaignConsequenceDeclaration {
  readonly consequenceId: string
  readonly visibility: 'public' | 'gm'
  readonly category: 'relationship' | 'location' | 'faction' | 'opportunity' | 'other'
  readonly resultCode: string
  readonly summary: string
  readonly mechanicalEffect: 'none'
}

export interface EncounterSettlementOutcomeAuthorization {
  readonly status: 'allowed' | 'denied'
  readonly authority: EncounterSettlementAuthorityRef
  readonly reasonId: string | null
}

export interface EncounterSettlementOutcomeAuthoritySnapshot {
  readonly completeness: 'authoritative-current'
  readonly encounterDocument: EncounterDocument
  readonly declarations: readonly EncounterSettlementOutcomeDeclaration[]
  readonly campaignConsequencesComplete: true
  readonly campaignConsequences: readonly EncounterSettlementCampaignConsequenceDeclaration[]
  readonly authorization: EncounterSettlementOutcomeAuthorization
  readonly writeTimestamp: number
}

export interface EncounterSettlementOutcomeFact {
  readonly factId: string
  readonly kind: 'objective' | 'clock' | 'phase' | 'stake' | 'campaign-consequence'
  readonly subjectId: string
  readonly audience: EncounterSettlementAudience
  readonly sourceAuthority: EncounterSettlementAuthorityRef
  readonly resultCode: string
  readonly summary: string | null
  readonly mechanicalEffect: 'closed-encounter-field' | 'none'
}

export interface EncounterSettlementOutcomeRequiredDecision {
  readonly kind: 'objective' | 'clock' | 'phase' | 'stake'
  readonly subjectId: string
  readonly audience: EncounterSettlementAudience
}

export interface EncounterSettlementEncounterDocumentWrite {
  readonly encounterId: string
  readonly expectedRevision: number
  readonly revision: number
  readonly beforeDefinitionSha256: string
  readonly afterDefinitionSha256: string
  readonly nextDocument: EncounterDocument
}

export interface EncounterSettlementOutcomePlan {
  readonly complete: boolean
  readonly authorityDefinitionSha256: string
  readonly document: EncounterSettlementDocument
  readonly outcomeFacts: readonly EncounterSettlementOutcomeFact[]
  readonly requiredDecisions: readonly EncounterSettlementOutcomeRequiredDecision[]
  readonly encounterWrite: EncounterSettlementEncounterDocumentWrite | null
  readonly deniedReasonId: string | null
}

export type EncounterSettlementOutcomeErrorCode =
  | 'incomplete-authority'
  | 'invalid-encounter-authority'
  | 'invalid-declaration'
  | 'duplicate-declaration'
  | 'invalid-campaign-consequence'
  | 'stale-consequence'
  | 'terminal-outcome-state'
  | 'stale-outcome-plan'

export class EncounterSettlementOutcomeError extends Error {
  constructor(
    readonly code: EncounterSettlementOutcomeErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'EncounterSettlementOutcomeError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const OUTCOME_CONSEQUENCE_PREFIX = 'settlement-outcome-consequence:v1:'
const OUTCOME_FACT_PREFIX = 'settlement-outcome-fact:v1:'
const MAX_CAMPAIGN_CONSEQUENCES = 128

const fail = (code: EncounterSettlementOutcomeErrorCode, path: string, message: string): never => {
  throw new EncounterSettlementOutcomeError(code, path, message)
}
const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const boundedText = (value: unknown, maximum = 4_000): value is string => typeof value === 'string'
  && Boolean(value.trim()) && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)

const hashJson = (value: unknown, path = 'outcomeAuthority'): string => createHash('sha256')
  .update(stableJsonStringify(value, {
    path,
    limits: { maxDepth: 48, maxNodes: 250_000, maxObjectFields: 10_000, maxArrayEntries: 50_000, maxStringLength: 100_000 },
  }))
  .digest('hex')

const deterministicId = (prefix: string, ...parts: readonly string[]): string => {
  const hash = createHash('sha256').update(prefix)
  parts.forEach(part => hash.update('\u0000').update(part))
  return `${prefix}${hash.digest('hex')}`
}

const entityAuthority = (
  kind: 'objective' | 'clock' | 'phase',
  encounter: EncounterDocument,
  subjectId: string,
): EncounterSettlementAuthorityRef => Object.freeze({
  kind,
  id: `${kind}:v1:${createHash('sha256')
    .update(encounter.encounterId).update('\u0000').update(subjectId).digest('hex').slice(0, 32)}`,
  revision: encounter.revision,
})

const encounterAuthority = (encounter: EncounterDocument): EncounterSettlementAuthorityRef => Object.freeze({
  kind: 'encounter-document', id: encounter.encounterId, revision: encounter.revision,
})

const audienceForVisibility = (visibility: 'public' | 'gm'): EncounterSettlementAudience => visibility

const declarationKey = (kind: EncounterSettlementOutcomeDeclaration['kind'], subjectId: string): string => `${kind}\u0000${subjectId}`

const snapshotEqual = (left: EncounterSettlementSnapshot, right: EncounterSettlementSnapshot): boolean => (
  JSON.stringify(left) === JSON.stringify(right)
)

const upsertConsequence = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly consequences: EncounterSettlementPersistentConsequence[]
  readonly expectedIds: Set<string>
  readonly kind: 'objective' | 'clock' | 'phase' | 'accepted-event'
  readonly authority: EncounterSettlementAuthorityRef
  readonly field: string
  readonly snapshot: EncounterSettlementSnapshot
}): void => {
  const semanticMatches = input.settlement.persistentConsequences.filter(entry => (
    entry.kind === input.kind && entry.authority.kind === input.authority.kind
    && entry.authority.id === input.authority.id && entry.field === input.field
  ))
  if (semanticMatches.length > 1) {
    fail('stale-consequence', `${input.authority.id}.${input.field}`, 'has duplicate consequence authority.')
  }
  const existing = semanticMatches[0]
  if (existing && (existing.state === 'applied' || existing.receiptId !== null)) {
    if (existing.authority.revision !== input.authority.revision || !snapshotEqual(existing.snapshot, input.snapshot)) {
      fail('stale-consequence', existing.consequenceId, 'an applied outcome consequence cannot be rewritten.')
    }
    input.consequences.push(existing)
    input.expectedIds.add(existing.consequenceId)
    return
  }
  const consequenceId = existing?.consequenceId ?? deterministicId(
    OUTCOME_CONSEQUENCE_PREFIX,
    input.settlement.settlementId,
    input.kind,
    input.authority.id,
    input.field,
  )
  input.consequences.push(Object.freeze({
    consequenceId,
    participantId: null,
    kind: input.kind,
    authority: input.authority,
    field: input.field,
    behavior: input.kind === 'accepted-event' ? 'preserve' : 'transform',
    snapshot: input.snapshot,
    state: 'ready',
    decisionId: null,
    receiptId: null,
  }))
  input.expectedIds.add(consequenceId)
}

const fact = (input: Omit<EncounterSettlementOutcomeFact, 'factId'> & {
  readonly settlementId: string
}): EncounterSettlementOutcomeFact => Object.freeze({
  factId: deterministicId(OUTCOME_FACT_PREFIX, input.settlementId, input.kind, input.subjectId, input.resultCode),
  kind: input.kind,
  subjectId: input.subjectId,
  audience: input.audience,
  sourceAuthority: input.sourceAuthority,
  resultCode: input.resultCode,
  summary: input.summary,
  mechanicalEffect: input.mechanicalEffect,
})

const authorityEvidence = (authority: EncounterSettlementOutcomeAuthoritySnapshot): string => hashJson({
  completeness: authority.completeness,
  encounterDocument: authority.encounterDocument,
  declarations: authority.declarations,
  campaignConsequencesComplete: authority.campaignConsequencesComplete,
  campaignConsequences: authority.campaignConsequences,
  authorization: authority.authorization,
  writeTimestamp: authority.writeTimestamp,
})

const changedObjective = (objective: EncounterDocumentObjective, status: 'completed' | 'failed'): EncounterDocumentObjective => ({
  ...objective,
  status,
})

const changedClock = (
  clock: EncounterDocumentClock,
  declaration: Extract<EncounterSettlementOutcomeDeclaration, { kind: 'clock' }>,
): EncounterDocumentClock => ({ ...clock, status: declaration.status, progress: declaration.progress })

const changedPhase = (
  phase: EncounterDocumentPhase,
  declaration: Extract<EncounterSettlementOutcomeDeclaration, { kind: 'phase' }>,
): EncounterDocumentPhase => ({ ...phase, status: 'completed', summary: declaration.summary })

export const planEncounterSettlementOutcomes = (input: {
  readonly settlement: unknown
  readonly authority: EncounterSettlementOutcomeAuthoritySnapshot
}): EncounterSettlementOutcomePlan => {
  const settlement = parseEncounterSettlementDocument(input.settlement)
  if (settlement.status === 'committing' || settlement.status === 'completed' || settlement.status === 'cancelled'
    || settlement.completion.state !== 'open') {
    return fail('terminal-outcome-state', 'settlement', 'cannot re-plan outcomes after settlement commit has begun.')
  }
  const source = input.authority
  if (!source || source.completeness !== 'authoritative-current'
    || source.campaignConsequencesComplete !== true || !Array.isArray(source.declarations)
    || !Array.isArray(source.campaignConsequences)) {
    return fail('incomplete-authority', 'authority', 'must contain one complete current outcome authority read.')
  }
  let encounter: EncounterDocument
  try { encounter = parseEncounterDocument(source.encounterDocument) }
  catch (error) {
    return fail('invalid-encounter-authority', 'authority.encounterDocument', error instanceof Error ? error.message : 'is malformed.')
  }
  if (encounter.encounterId !== settlement.encounter.encounterId
    || encounter.linkedMapSlug !== settlement.encounter.linkedMapSlug
    || encounter.revision !== settlement.encounter.encounterRevision
    || !['active', 'paused', 'completed'].includes(encounter.lifecycle)
    || !integer(source.writeTimestamp) || source.writeTimestamp < encounter.updatedAt
    || encounter.revision >= Number.MAX_SAFE_INTEGER) {
    return fail('invalid-encounter-authority', 'authority.encounterDocument', 'must be the exact current linked encounter document and writable revision.')
  }
  const expectedAuthorization = encounterAuthority(encounter)
  const authorization = source.authorization
  if (!authorization || (authorization.status !== 'allowed' && authorization.status !== 'denied')
    || !authorization.authority || authorization.authority.kind !== expectedAuthorization.kind
    || authorization.authority.id !== expectedAuthorization.id || authorization.authority.revision !== expectedAuthorization.revision
    || (authorization.status === 'denied') !== (authorization.reasonId !== null)
    || (authorization.reasonId !== null && !isId(authorization.reasonId))) {
    return fail('invalid-encounter-authority', 'authority.authorization', 'must be one exact GM outcome authorization for the current encounter document.')
  }

  const declarations = new Map<string, EncounterSettlementOutcomeDeclaration>()
  source.declarations.forEach((declaration, index) => {
    const path = `authority.declarations[${index}]`
    if (!declaration || !['objective', 'clock', 'phase', 'stake'].includes(declaration.kind)
      || !isId(declaration.subjectId)) {
      fail('invalid-declaration', path, 'must name one current objective, clock, phase, or stake.')
    }
    const key = declarationKey(declaration.kind, declaration.subjectId)
    if (declarations.has(key)) fail('duplicate-declaration', path, 'must not duplicate an outcome subject.')
    if (declaration.kind === 'objective') {
      if (!encounter.objectives.some(row => row.objectiveId === declaration.subjectId)
        || !['completed', 'failed'].includes(declaration.status)) {
        fail('invalid-declaration', path, 'must conclude one current objective as completed or failed.')
      }
    }
    else if (declaration.kind === 'clock') {
      const clock = encounter.clocks.find(row => row.clockId === declaration.subjectId)
      if (!clock || !['paused', 'completed'].includes(declaration.status)
        || !integer(declaration.progress) || declaration.progress > clock.maximum
        || (declaration.status === 'completed' && declaration.progress !== clock.maximum)) {
        fail('invalid-declaration', path, 'must pause at bounded progress or complete one current clock at its maximum.')
      }
    }
    else if (declaration.kind === 'phase') {
      if (!encounter.phases.some(row => row.phaseId === declaration.subjectId)
        || declaration.status !== 'completed'
        || (declaration.summary !== null && !boundedText(declaration.summary))) {
        fail('invalid-declaration', path, 'must complete one current phase with optional bounded summary.')
      }
    }
    else {
      const stake = declaration as Extract<EncounterSettlementOutcomeDeclaration, { kind: 'stake' }>
      const visibility = stake.subjectId === 'public' || stake.subjectId === 'gm'
        ? stake.subjectId
        : fail('invalid-declaration', path, 'must target one public or GM stake.')
      if (!['realized', 'avoided', 'changed'].includes(stake.result)
        || !boundedText(stake.summary)
        || encounter.stakes[visibility] === null) {
        fail('invalid-declaration', path, 'must resolve one existing public or GM stake with a bounded narrative result.')
      }
    }
    declarations.set(key, declaration)
  })

  if (source.campaignConsequences.length > MAX_CAMPAIGN_CONSEQUENCES) {
    fail('invalid-campaign-consequence', 'authority.campaignConsequences', `must contain at most ${MAX_CAMPAIGN_CONSEQUENCES} entries.`)
  }
  const consequenceIds = new Set<string>()
  source.campaignConsequences.forEach((entry, index) => {
    const path = `authority.campaignConsequences[${index}]`
    if (!entry || !isId(entry.consequenceId) || consequenceIds.has(entry.consequenceId)
      || !['public', 'gm'].includes(entry.visibility)
      || !['relationship', 'location', 'faction', 'opportunity', 'other'].includes(entry.category)
      || !isId(entry.resultCode) || !boundedText(entry.summary)
      || entry.mechanicalEffect !== 'none') {
      fail('invalid-campaign-consequence', path, 'must be unique bounded narrative evidence with mechanicalEffect none.')
    }
    consequenceIds.add(entry.consequenceId)
  })

  const requiredDecisions: EncounterSettlementOutcomeRequiredDecision[] = []
  for (const objective of encounter.objectives) {
    if (!declarations.has(declarationKey('objective', objective.objectiveId))) {
      requiredDecisions.push(Object.freeze({ kind: 'objective', subjectId: objective.objectiveId, audience: audienceForVisibility(objective.visibility) }))
    }
  }
  for (const clock of encounter.clocks) {
    if (!declarations.has(declarationKey('clock', clock.clockId))) {
      requiredDecisions.push(Object.freeze({ kind: 'clock', subjectId: clock.clockId, audience: audienceForVisibility(clock.visibility) }))
    }
  }
  for (const phase of encounter.phases) {
    if (!declarations.has(declarationKey('phase', phase.phaseId))) {
      requiredDecisions.push(Object.freeze({ kind: 'phase', subjectId: phase.phaseId, audience: audienceForVisibility(phase.visibility) }))
    }
  }
  for (const visibility of ['public', 'gm'] as const) {
    if (encounter.stakes[visibility] !== null && !declarations.has(declarationKey('stake', visibility))) {
      requiredDecisions.push(Object.freeze({ kind: 'stake', subjectId: visibility, audience: visibility }))
    }
  }
  requiredDecisions.sort((a, b) => `${a.kind}:${a.subjectId}`.localeCompare(`${b.kind}:${b.subjectId}`))
  const complete = authorization.status === 'allowed' && requiredDecisions.length === 0

  let nextEncounter: EncounterDocument = encounter
  const facts: EncounterSettlementOutcomeFact[] = []
  const consequences: EncounterSettlementPersistentConsequence[] = []
  const expectedConsequenceIds = new Set<string>()

  const objectives = encounter.objectives.map((objective) => {
    const declaration = declarations.get(declarationKey('objective', objective.objectiveId)) as Extract<EncounterSettlementOutcomeDeclaration, { kind: 'objective' }> | undefined
    if (!declaration) return objective
    const next = changedObjective(objective, declaration.status)
    const authority = entityAuthority('objective', encounter, objective.objectiveId)
    upsertConsequence({ settlement, consequences, expectedIds: expectedConsequenceIds, kind: 'objective', authority, field: 'status', snapshot: { kind: 'text', before: objective.status, after: next.status } })
    facts.push(fact({ settlementId: settlement.settlementId, kind: 'objective', subjectId: objective.objectiveId, audience: audienceForVisibility(objective.visibility), sourceAuthority: authority, resultCode: declaration.status, summary: null, mechanicalEffect: 'closed-encounter-field' }))
    return next
  })
  const clocks = encounter.clocks.map((clock) => {
    const declaration = declarations.get(declarationKey('clock', clock.clockId)) as Extract<EncounterSettlementOutcomeDeclaration, { kind: 'clock' }> | undefined
    if (!declaration) return clock
    const next = changedClock(clock, declaration)
    const authority = entityAuthority('clock', encounter, clock.clockId)
    upsertConsequence({ settlement, consequences, expectedIds: expectedConsequenceIds, kind: 'clock', authority, field: 'status', snapshot: { kind: 'text', before: clock.status, after: next.status } })
    upsertConsequence({ settlement, consequences, expectedIds: expectedConsequenceIds, kind: 'clock', authority, field: 'progress', snapshot: { kind: 'integer', before: clock.progress, after: next.progress } })
    facts.push(fact({ settlementId: settlement.settlementId, kind: 'clock', subjectId: clock.clockId, audience: audienceForVisibility(clock.visibility), sourceAuthority: authority, resultCode: next.status, summary: null, mechanicalEffect: 'closed-encounter-field' }))
    return next
  })
  const phases = encounter.phases.map((phase) => {
    const declaration = declarations.get(declarationKey('phase', phase.phaseId)) as Extract<EncounterSettlementOutcomeDeclaration, { kind: 'phase' }> | undefined
    if (!declaration) return phase
    const next = changedPhase(phase, declaration)
    const authority = entityAuthority('phase', encounter, phase.phaseId)
    upsertConsequence({ settlement, consequences, expectedIds: expectedConsequenceIds, kind: 'phase', authority, field: 'status', snapshot: { kind: 'text', before: phase.status, after: next.status } })
    upsertConsequence({
      settlement,
      consequences,
      expectedIds: expectedConsequenceIds,
      kind: 'phase',
      authority,
      field: 'summary',
      snapshot: {
        kind: 'reference',
        before: phase.summary === null ? null : `summary:v1:${hashJson(phase.summary, 'phaseSummary').slice(0, 32)}`,
        after: next.summary === null ? null : `summary:v1:${hashJson(next.summary, 'phaseSummary').slice(0, 32)}`,
      },
    })
    facts.push(fact({ settlementId: settlement.settlementId, kind: 'phase', subjectId: phase.phaseId, audience: audienceForVisibility(phase.visibility), sourceAuthority: authority, resultCode: 'completed', summary: next.summary, mechanicalEffect: 'closed-encounter-field' }))
    return next
  })

  for (const visibility of ['public', 'gm'] as const) {
    const declaration = declarations.get(declarationKey('stake', visibility)) as Extract<EncounterSettlementOutcomeDeclaration, { kind: 'stake' }> | undefined
    if (!declaration) continue
    const authority = encounterAuthority(encounter)
    upsertConsequence({
      settlement,
      consequences,
      expectedIds: expectedConsequenceIds,
      kind: 'accepted-event',
      authority,
      field: `stake-${visibility}`,
      snapshot: { kind: 'reference', before: declaration.result, after: declaration.result },
    })
    facts.push(fact({ settlementId: settlement.settlementId, kind: 'stake', subjectId: visibility, audience: visibility, sourceAuthority: authority, resultCode: declaration.result, summary: declaration.summary, mechanicalEffect: 'none' }))
  }
  for (const declaration of source.campaignConsequences) {
    const authority = encounterAuthority(encounter)
    const consequenceField = `campaign:v1:${createHash('sha256')
      .update(declaration.consequenceId).digest('hex').slice(0, 32)}`
    upsertConsequence({ settlement, consequences, expectedIds: expectedConsequenceIds, kind: 'accepted-event', authority, field: consequenceField, snapshot: { kind: 'reference', before: declaration.resultCode, after: declaration.resultCode } })
    facts.push(fact({ settlementId: settlement.settlementId, kind: 'campaign-consequence', subjectId: declaration.consequenceId, audience: declaration.visibility, sourceAuthority: authority, resultCode: declaration.resultCode, summary: declaration.summary, mechanicalEffect: 'none' }))
  }
  for (const existing of settlement.persistentConsequences) {
    if (expectedConsequenceIds.has(existing.consequenceId)) continue
    if (existing.consequenceId.startsWith(OUTCOME_CONSEQUENCE_PREFIX)) {
      if (existing.state === 'applied' || existing.receiptId !== null) {
        fail('stale-consequence', existing.consequenceId, 'an applied outcome consequence cannot disappear from current authority.')
      }
      continue
    }
    consequences.push(existing)
  }

  nextEncounter = parseEncounterDocument({
    ...encounter,
    objectives,
    clocks,
    phases,
    activePhaseId: phases.some(phase => phase.phaseId === encounter.activePhaseId && phase.status === 'active')
      ? encounter.activePhaseId
      : null,
    lifecycle: complete ? 'completed' : encounter.lifecycle,
    revision: encounter.revision + 1,
    updatedAt: source.writeTimestamp,
  })
  const encounterWrite: EncounterSettlementEncounterDocumentWrite = Object.freeze({
    encounterId: encounter.encounterId,
    expectedRevision: encounter.revision,
    revision: encounter.revision + 1,
    beforeDefinitionSha256: hashJson(encounter, 'encounterOutcomeDocument'),
    afterDefinitionSha256: hashJson(nextEncounter, 'encounterOutcomeDocument'),
    nextDocument: nextEncounter,
  })
  facts.sort((a, b) => a.factId.localeCompare(b.factId))
  consequences.sort((a, b) => a.consequenceId.localeCompare(b.consequenceId))
  const document = parseEncounterSettlementDocument({
    ...settlement,
    persistentConsequences: consequences,
  })
  return Object.freeze({
    complete,
    authorityDefinitionSha256: authorityEvidence(source),
    document,
    outcomeFacts: Object.freeze(facts),
    requiredDecisions: Object.freeze(requiredDecisions),
    encounterWrite,
    deniedReasonId: authorization.status === 'denied' ? authorization.reasonId : null,
  })
}

export const applyEncounterSettlementOutcomePlan = (input: {
  readonly plan: EncounterSettlementOutcomePlan
  readonly currentAuthority: EncounterSettlementOutcomeAuthoritySnapshot
}): EncounterSettlementEncounterDocumentWrite => {
  if (!input.plan.complete || !input.plan.encounterWrite
    || input.plan.authorityDefinitionSha256 !== authorityEvidence(input.currentAuthority)) {
    return fail('stale-outcome-plan', 'plan', 'complete outcome authority changed before application.')
  }
  const current = parseEncounterDocument(input.currentAuthority.encounterDocument)
  const write = input.plan.encounterWrite
  if (current.revision !== write.expectedRevision
    || hashJson(current, 'encounterOutcomeDocument') !== write.beforeDefinitionSha256
    || hashJson(write.nextDocument, 'encounterOutcomeDocument') !== write.afterDefinitionSha256
    || write.revision !== write.expectedRevision + 1) {
    return fail('stale-outcome-plan', 'plan.encounterWrite', 'encounter outcome authority no longer matches its complete preview.')
  }
  return write
}
