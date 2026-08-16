import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ENCOUNTER_SETTLEMENT_DOCUMENT_SCHEMA_VERSION = 1 as const

export const ENCOUNTER_SETTLEMENT_STATUSES = [
  'draft', 'blocked', 'ready', 'committing', 'completed', 'cancelled',
] as const
export type EncounterSettlementStatus = typeof ENCOUNTER_SETTLEMENT_STATUSES[number]

export const ENCOUNTER_SETTLEMENT_AUTHORITY_KINDS = [
  'encounter-document', 'map', 'sheet', 'group-inventory', 'campaign-clock',
  'capture-operation', 'item-operation', 'equipment-operation', 'inventory-operation',
  'objective', 'clock', 'phase', 'effect', 'resource',
] as const
export type EncounterSettlementAuthorityKind = typeof ENCOUNTER_SETTLEMENT_AUTHORITY_KINDS[number]

export const ENCOUNTER_SETTLEMENT_AUDIENCES = [
  'public', 'participant-owner', 'destination-owner', 'gm',
] as const
export type EncounterSettlementAudience = typeof ENCOUNTER_SETTLEMENT_AUDIENCES[number]

export const ENCOUNTER_SETTLEMENT_LIMITS = Object.freeze({
  participants: 1_024,
  unresolvedGates: 256,
  authorityRefsPerGate: 16,
  participantRefsPerEntry: 1_024,
  consequences: 4_096,
  rewardLines: 1_024,
  allocations: 4_096,
  cleanupEntries: 4_096,
  decisions: 1_024,
  decisionOptions: 64,
  decisionSubjects: 256,
  receipts: 8_192,
  receiptSubjects: 1_024,
  textValues: 512,
  narrativeChars: 4_000,
  strictJsonDepth: 18,
  strictJsonNodes: 250_000,
  strictJsonObjectFields: 32,
  strictJsonArrayEntries: 8_192,
})

export interface EncounterSettlementAuthorityRef {
  readonly kind: EncounterSettlementAuthorityKind
  readonly id: string
  readonly revision: number
}

export interface EncounterSettlementEncounterRef {
  readonly encounterId: string
  readonly encounterRevision: number
  readonly linkedMapSlug: string
  readonly linkedMapRevision: number
  readonly campaignMinute: number
}

export interface EncounterSettlementParticipant {
  readonly participantId: string
  readonly sourceAuthority: EncounterSettlementAuthorityRef
  readonly sheetKind: 'trainer' | 'pokemon'
  readonly sheetSlug: string
  readonly sheetRevision: number
  readonly sideId: string | null
  readonly ownerParticipantId: string | null
  readonly settlementRole: 'combatant' | 'support' | 'observer'
  readonly disposition: 'active' | 'defeated' | 'withdrawn' | 'escaped' | 'captured' | 'excluded'
}

export const ENCOUNTER_SETTLEMENT_GATE_KINDS = [
  'pending-reaction', 'pending-resolution', 'uncertain-command', 'private-choice',
  'revision-conflict', 'invalid-participant', 'unallocated-reward', 'capture-destination',
  'cleanup-decision', 'unsupported-authority', 'gm-adjudication', 'stale-snapshot',
] as const
export type EncounterSettlementGateKind = typeof ENCOUNTER_SETTLEMENT_GATE_KINDS[number]

export const ENCOUNTER_SETTLEMENT_GATE_RESOLUTIONS = [
  'refresh', 'retry-exact', 'choose', 'adjudicate', 'allocate', 'correct', 'exclude',
] as const
export type EncounterSettlementGateResolution = typeof ENCOUNTER_SETTLEMENT_GATE_RESOLUTIONS[number]

export interface EncounterSettlementGate {
  readonly gateId: string
  readonly kind: EncounterSettlementGateKind
  readonly blocking: true
  readonly audience: EncounterSettlementAudience
  readonly authorityRefs: readonly EncounterSettlementAuthorityRef[]
  readonly participantIds: readonly string[]
  readonly resolutionKinds: readonly EncounterSettlementGateResolution[]
  readonly openedAtSettlementRevision: number
}

export type EncounterSettlementSnapshot =
  | { readonly kind: 'integer', readonly before: number, readonly after: number | null }
  | { readonly kind: 'boolean', readonly before: boolean, readonly after: boolean | null }
  | { readonly kind: 'text', readonly before: string, readonly after: string | null }
  | { readonly kind: 'text-list', readonly before: readonly string[], readonly after: readonly string[] | null }
  | { readonly kind: 'reference', readonly before: string | null, readonly after: string | null }

export const ENCOUNTER_SETTLEMENT_CONSEQUENCE_KINDS = [
  'hp', 'injuries', 'conditions', 'capture', 'inventory', 'equipment', 'resource',
  'usage', 'effect', 'objective', 'clock', 'phase', 'ownership', 'accepted-event',
] as const
export type EncounterSettlementConsequenceKind = typeof ENCOUNTER_SETTLEMENT_CONSEQUENCE_KINDS[number]

export const ENCOUNTER_SETTLEMENT_BEHAVIORS = [
  'preserve', 'transform', 'expire', 'reset', 'require-decision',
] as const
export type EncounterSettlementBehavior = typeof ENCOUNTER_SETTLEMENT_BEHAVIORS[number]

export const ENCOUNTER_SETTLEMENT_ENTRY_STATES = [
  'proposed', 'ready', 'applied', 'excluded',
] as const
export type EncounterSettlementEntryState = typeof ENCOUNTER_SETTLEMENT_ENTRY_STATES[number]

export interface EncounterSettlementPersistentConsequence {
  readonly consequenceId: string
  readonly participantId: string | null
  readonly kind: EncounterSettlementConsequenceKind
  readonly authority: EncounterSettlementAuthorityRef
  readonly field: string
  readonly behavior: EncounterSettlementBehavior
  readonly snapshot: EncounterSettlementSnapshot
  readonly state: EncounterSettlementEntryState
  readonly decisionId: string | null
  readonly receiptId: string | null
}

export type EncounterSettlementRewardPayload =
  | { readonly kind: 'experience', readonly amount: number }
  | { readonly kind: 'money', readonly amount: number }
  | {
      readonly kind: 'item'
      readonly canonicalItemId: string
      readonly quantity: number
      readonly serialized: boolean
      readonly definitionAuthority: EncounterSettlementAuthorityRef
    }
  | {
      readonly kind: 'capture'
      readonly captureOperationId: string
      readonly pokemonSheetSlug: string
    }
  | {
      readonly kind: 'narrative'
      readonly factId: string
      readonly note: string
    }

export interface EncounterSettlementRewardLine {
  readonly rewardId: string
  readonly visibility: EncounterSettlementAudience
  readonly sourceAuthority: EncounterSettlementAuthorityRef
  readonly disposition: 'pending' | 'allocated' | 'excluded' | 'committed'
  readonly payload: EncounterSettlementRewardPayload
}

export interface EncounterSettlementRewardPackage {
  readonly rewardPackageId: string
  readonly status: 'draft' | 'ready' | 'allocated' | 'committed' | 'cancelled'
  readonly lines: readonly EncounterSettlementRewardLine[]
}

export interface EncounterSettlementAllocationDestination {
  readonly kind: 'group' | 'side' | 'participant' | 'trainer-inventory' | 'pokemon-sheet' | 'group-inventory' | 'profile'
  readonly id: string
  readonly revision: number
}

export interface EncounterSettlementAllocation {
  readonly allocationId: string
  readonly rewardId: string
  readonly destination: EncounterSettlementAllocationDestination
  readonly method: 'fixed' | 'weighted' | 'individual' | 'whole'
  readonly amount: number
  readonly weight: number | null
  readonly state: EncounterSettlementEntryState
  readonly decisionId: string | null
  readonly receiptId: string | null
}

export const ENCOUNTER_SETTLEMENT_CLEANUP_KINDS = [
  'combat-stages', 'temporary-effects', 'encounter-resources', 'reservations',
  'zones', 'ground-items', 'duration-effects', 'encounter-items', 'initiative',
] as const
export type EncounterSettlementCleanupKind = typeof ENCOUNTER_SETTLEMENT_CLEANUP_KINDS[number]

export interface EncounterSettlementCleanupEntry {
  readonly cleanupId: string
  readonly kind: EncounterSettlementCleanupKind
  readonly authority: EncounterSettlementAuthorityRef
  readonly participantIds: readonly string[]
  readonly sourceIds: readonly string[]
  readonly behavior: EncounterSettlementBehavior
  readonly state: EncounterSettlementEntryState
  readonly decisionId: string | null
  readonly receiptId: string | null
}

export interface EncounterSettlementDecisionSubject {
  readonly kind: 'gate' | 'consequence' | 'reward' | 'allocation' | 'cleanup' | 'objective' | 'clock' | 'phase' | 'capture' | 'completion'
  readonly id: string
}

export interface EncounterSettlementDecisionOption {
  readonly optionId: string
  readonly effect: 'accept' | 'exclude' | 'destination' | 'transform' | 'correct' | 'waive'
  readonly valueId: string | null
  readonly authority: EncounterSettlementAuthorityRef | null
}

export interface EncounterSettlementDecisionActor {
  readonly kind: 'gm' | 'profile'
  readonly principalId: string
}

export interface EncounterSettlementDecision {
  readonly decisionId: string
  readonly kind: 'allocation' | 'capture-destination' | 'consequence' | 'cleanup' | 'objective-outcome' | 'gm-correction' | 'exclusion' | 'completion'
  readonly audience: EncounterSettlementAudience
  readonly status: 'open' | 'accepted'
  readonly subjects: readonly EncounterSettlementDecisionSubject[]
  readonly options: readonly EncounterSettlementDecisionOption[]
  readonly selectedOptionId: string | null
  readonly decidedBy: EncounterSettlementDecisionActor | null
  readonly decidedAtCampaignMinute: number | null
}

export interface EncounterSettlementReceiptSubject {
  readonly kind: EncounterSettlementDecisionSubject['kind'] | 'decision' | 'settlement'
  readonly id: string
}

export interface EncounterSettlementReceipt {
  readonly receiptId: string
  readonly kind: 'decision' | 'consequence' | 'reward' | 'allocation' | 'cleanup' | 'completion' | 'correction'
  readonly audience: EncounterSettlementAudience
  readonly operationId: string
  readonly result: 'accepted' | 'excluded' | 'corrected' | 'cancelled'
  readonly subjects: readonly EncounterSettlementReceiptSubject[]
  readonly sourceReceiptId: string | null
  readonly acceptedAtCampaignMinute: number
}

export type EncounterSettlementCompletion =
  | {
      readonly state: 'open'
      readonly operationId: null
      readonly receiptId: null
      readonly completedEncounterRevision: null
      readonly completedAtCampaignMinute: null
    }
  | {
      readonly state: 'accepted' | 'cancelled'
      readonly operationId: string
      readonly receiptId: string
      readonly completedEncounterRevision: number
      readonly completedAtCampaignMinute: number
    }

export interface EncounterSettlementDocument {
  readonly schemaVersion: typeof ENCOUNTER_SETTLEMENT_DOCUMENT_SCHEMA_VERSION
  readonly settlementId: string
  readonly revision: number
  readonly status: EncounterSettlementStatus
  readonly encounter: EncounterSettlementEncounterRef
  readonly participants: readonly EncounterSettlementParticipant[]
  readonly unresolvedGates: readonly EncounterSettlementGate[]
  readonly persistentConsequences: readonly EncounterSettlementPersistentConsequence[]
  readonly rewardPackage: EncounterSettlementRewardPackage
  readonly allocations: readonly EncounterSettlementAllocation[]
  readonly temporaryCleanup: readonly EncounterSettlementCleanupEntry[]
  readonly decisions: readonly EncounterSettlementDecision[]
  readonly receipts: readonly EncounterSettlementReceipt[]
  readonly completion: EncounterSettlementCompletion
  readonly createdAtCampaignMinute: number
  readonly updatedAtCampaignMinute: number
}

export class EncounterSettlementDocumentValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'EncounterSettlementDocumentValidationError'
  }
}

const fail = (path: string, message: string): never => {
  throw new EncounterSettlementDocumentValidationError(path, message)
}

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as Record<string, unknown>
}

const exact = (value: Record<string, unknown>, keys: readonly string[], path: string): void => {
  const allowed = new Set(keys)
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  const missing = keys.filter(key => !Object.prototype.hasOwnProperty.call(value, key))
  if (unknown.length || missing.length) fail(path, `must contain exactly ${keys.join(', ')}.`)
}

const identifier = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value)) {
    fail(path, 'must be a stable bounded identity.')
  }
  return value as string
}

const nullableIdentifier = (value: unknown, path: string): string | null => (
  value === null ? null : identifier(value, path)
)

const boundedText = (
  value: unknown,
  path: string,
  maximum: number = ENCOUNTER_SETTLEMENT_LIMITS.textValues,
): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    fail(path, `must be non-empty text of at most ${maximum} characters without control characters.`)
  }
  return (value as string).trim()
}

const nonNegativeInteger = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(path, 'must be a non-negative safe integer.')
  return Number(value)
}

const signedInteger = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value)) fail(path, 'must be a safe integer.')
  return Number(value)
}

const positiveInteger = (value: unknown, path: string): number => {
  const parsed = nonNegativeInteger(value, path)
  if (parsed < 1) fail(path, 'must be a positive safe integer.')
  return parsed
}

const oneOf = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(path, `must be one of ${values.join(', ')}.`)
  return value as T
}

const parseArray = <T>(
  value: unknown,
  path: string,
  maximum: number,
  parse: (entry: unknown, path: string) => T,
): readonly T[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(path, `must be an array with at most ${maximum} entries.`)
  return Object.freeze((value as unknown[]).map((entry, index) => parse(entry, `${path}[${index}]`)))
}

const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) fail(path, 'must not contain duplicate identities.')
}

const parseIdArray = (value: unknown, path: string, maximum: number): readonly string[] => {
  const result = parseArray(value, path, maximum, identifier)
  unique(result, path)
  return result
}

const parseTextArray = (value: unknown, path: string): readonly string[] => {
  const result = parseArray(value, path, ENCOUNTER_SETTLEMENT_LIMITS.participantRefsPerEntry, boundedText)
  unique(result, path)
  return result
}

const parseAuthority = (value: unknown, path: string): EncounterSettlementAuthorityRef => {
  const input = record(value, path)
  exact(input, ['kind', 'id', 'revision'], path)
  return Object.freeze({
    kind: oneOf(input.kind, ENCOUNTER_SETTLEMENT_AUTHORITY_KINDS, `${path}.kind`),
    id: identifier(input.id, `${path}.id`),
    revision: nonNegativeInteger(input.revision, `${path}.revision`),
  })
}

const parseEncounter = (value: unknown, path: string): EncounterSettlementEncounterRef => {
  const input = record(value, path)
  exact(input, ['encounterId', 'encounterRevision', 'linkedMapSlug', 'linkedMapRevision', 'campaignMinute'], path)
  return Object.freeze({
    encounterId: identifier(input.encounterId, `${path}.encounterId`),
    encounterRevision: nonNegativeInteger(input.encounterRevision, `${path}.encounterRevision`),
    linkedMapSlug: identifier(input.linkedMapSlug, `${path}.linkedMapSlug`),
    linkedMapRevision: nonNegativeInteger(input.linkedMapRevision, `${path}.linkedMapRevision`),
    campaignMinute: nonNegativeInteger(input.campaignMinute, `${path}.campaignMinute`),
  })
}

const parseParticipant = (value: unknown, path: string): EncounterSettlementParticipant => {
  const input = record(value, path)
  exact(input, [
    'participantId', 'sourceAuthority', 'sheetKind', 'sheetSlug', 'sheetRevision', 'sideId',
    'ownerParticipantId', 'settlementRole', 'disposition',
  ], path)
  return Object.freeze({
    participantId: identifier(input.participantId, `${path}.participantId`),
    sourceAuthority: parseAuthority(input.sourceAuthority, `${path}.sourceAuthority`),
    sheetKind: oneOf(input.sheetKind, ['trainer', 'pokemon'] as const, `${path}.sheetKind`),
    sheetSlug: identifier(input.sheetSlug, `${path}.sheetSlug`),
    sheetRevision: nonNegativeInteger(input.sheetRevision, `${path}.sheetRevision`),
    sideId: nullableIdentifier(input.sideId, `${path}.sideId`),
    ownerParticipantId: nullableIdentifier(input.ownerParticipantId, `${path}.ownerParticipantId`),
    settlementRole: oneOf(input.settlementRole, ['combatant', 'support', 'observer'] as const, `${path}.settlementRole`),
    disposition: oneOf(input.disposition, ['active', 'defeated', 'withdrawn', 'escaped', 'captured', 'excluded'] as const, `${path}.disposition`),
  })
}

const parseGate = (value: unknown, path: string): EncounterSettlementGate => {
  const input = record(value, path)
  exact(input, [
    'gateId', 'kind', 'blocking', 'audience', 'authorityRefs', 'participantIds',
    'resolutionKinds', 'openedAtSettlementRevision',
  ], path)
  if (input.blocking !== true) fail(`${path}.blocking`, 'must be true for every unresolved gate.')
  const authorityRefs = parseArray(
    input.authorityRefs,
    `${path}.authorityRefs`,
    ENCOUNTER_SETTLEMENT_LIMITS.authorityRefsPerGate,
    parseAuthority,
  )
  if (authorityRefs.length === 0) fail(`${path}.authorityRefs`, 'must name at least one current authority.')
  const resolutionKinds = parseArray(
    input.resolutionKinds,
    `${path}.resolutionKinds`,
    ENCOUNTER_SETTLEMENT_GATE_RESOLUTIONS.length,
    (entry, entryPath) => oneOf(entry, ENCOUNTER_SETTLEMENT_GATE_RESOLUTIONS, entryPath),
  )
  if (resolutionKinds.length === 0) fail(`${path}.resolutionKinds`, 'must name at least one bounded resolution.')
  unique(resolutionKinds, `${path}.resolutionKinds`)
  return Object.freeze({
    gateId: identifier(input.gateId, `${path}.gateId`),
    kind: oneOf(input.kind, ENCOUNTER_SETTLEMENT_GATE_KINDS, `${path}.kind`),
    blocking: true,
    audience: oneOf(input.audience, ENCOUNTER_SETTLEMENT_AUDIENCES, `${path}.audience`),
    authorityRefs,
    participantIds: parseIdArray(input.participantIds, `${path}.participantIds`, ENCOUNTER_SETTLEMENT_LIMITS.participantRefsPerEntry),
    resolutionKinds,
    openedAtSettlementRevision: nonNegativeInteger(input.openedAtSettlementRevision, `${path}.openedAtSettlementRevision`),
  })
}

const parseSnapshot = (value: unknown, path: string): EncounterSettlementSnapshot => {
  const input = record(value, path)
  exact(input, ['kind', 'before', 'after'], path)
  const kind = oneOf(input.kind, ['integer', 'boolean', 'text', 'text-list', 'reference'] as const, `${path}.kind`)
  if (kind === 'integer') {
    return Object.freeze({
      kind,
      before: signedInteger(input.before, `${path}.before`),
      after: input.after === null ? null : signedInteger(input.after, `${path}.after`),
    })
  }
  if (kind === 'boolean') {
    if (typeof input.before !== 'boolean' || (input.after !== null && typeof input.after !== 'boolean')) {
      fail(path, 'boolean snapshots require one boolean before value and a boolean or null after value.')
    }
    return Object.freeze({ kind, before: input.before as boolean, after: input.after as boolean | null })
  }
  if (kind === 'text') {
    return Object.freeze({
      kind,
      before: boundedText(input.before, `${path}.before`),
      after: input.after === null ? null : boundedText(input.after, `${path}.after`),
    })
  }
  if (kind === 'text-list') {
    return Object.freeze({
      kind,
      before: parseTextArray(input.before, `${path}.before`),
      after: input.after === null ? null : parseTextArray(input.after, `${path}.after`),
    })
  }
  return Object.freeze({
    kind,
    before: nullableIdentifier(input.before, `${path}.before`),
    after: nullableIdentifier(input.after, `${path}.after`),
  })
}

const snapshotEquals = (left: EncounterSettlementSnapshot['before'], right: EncounterSettlementSnapshot['after']): boolean => (
  JSON.stringify(left) === JSON.stringify(right)
)

const parseConsequence = (value: unknown, path: string): EncounterSettlementPersistentConsequence => {
  const input = record(value, path)
  exact(input, [
    'consequenceId', 'participantId', 'kind', 'authority', 'field', 'behavior',
    'snapshot', 'state', 'decisionId', 'receiptId',
  ], path)
  const behavior = oneOf(input.behavior, ENCOUNTER_SETTLEMENT_BEHAVIORS, `${path}.behavior`)
  const snapshot = parseSnapshot(input.snapshot, `${path}.snapshot`)
  const decisionId = nullableIdentifier(input.decisionId, `${path}.decisionId`)
  const receiptId = nullableIdentifier(input.receiptId, `${path}.receiptId`)
  const state = oneOf(input.state, ENCOUNTER_SETTLEMENT_ENTRY_STATES, `${path}.state`)
  if (behavior === 'require-decision' && decisionId === null) fail(`${path}.decisionId`, 'is required by require-decision behavior.')
  if (behavior === 'preserve' && !snapshotEquals(snapshot.before, snapshot.after)) fail(`${path}.snapshot`, 'preserve behavior requires identical before and after values.')
  if (state === 'applied' && receiptId === null) fail(`${path}.receiptId`, 'is required after application.')
  if ((state === 'proposed' || state === 'ready') && receiptId !== null) fail(`${path}.receiptId`, 'must remain null before terminal settlement.')
  return Object.freeze({
    consequenceId: identifier(input.consequenceId, `${path}.consequenceId`),
    participantId: nullableIdentifier(input.participantId, `${path}.participantId`),
    kind: oneOf(input.kind, ENCOUNTER_SETTLEMENT_CONSEQUENCE_KINDS, `${path}.kind`),
    authority: parseAuthority(input.authority, `${path}.authority`),
    field: identifier(input.field, `${path}.field`),
    behavior,
    snapshot,
    state,
    decisionId,
    receiptId,
  })
}

const parseRewardPayload = (value: unknown, path: string): EncounterSettlementRewardPayload => {
  const input = record(value, path)
  const kind = oneOf(input.kind, ['experience', 'money', 'item', 'capture', 'narrative'] as const, `${path}.kind`)
  if (kind === 'experience' || kind === 'money') {
    exact(input, ['kind', 'amount'], path)
    return Object.freeze({ kind, amount: positiveInteger(input.amount, `${path}.amount`) })
  }
  if (kind === 'item') {
    exact(input, ['kind', 'canonicalItemId', 'quantity', 'serialized', 'definitionAuthority'], path)
    if (typeof input.serialized !== 'boolean') fail(`${path}.serialized`, 'must be a boolean.')
    const serialized = input.serialized as boolean
    const quantity = positiveInteger(input.quantity, `${path}.quantity`)
    if (serialized && quantity !== 1) fail(`${path}.quantity`, 'serialized equipment reward lines must contain exactly one whole item.')
    return Object.freeze({
      kind,
      canonicalItemId: boundedText(input.canonicalItemId, `${path}.canonicalItemId`, 200),
      quantity,
      serialized,
      definitionAuthority: parseAuthority(input.definitionAuthority, `${path}.definitionAuthority`),
    })
  }
  if (kind === 'capture') {
    exact(input, ['kind', 'captureOperationId', 'pokemonSheetSlug'], path)
    return Object.freeze({
      kind,
      captureOperationId: identifier(input.captureOperationId, `${path}.captureOperationId`),
      pokemonSheetSlug: identifier(input.pokemonSheetSlug, `${path}.pokemonSheetSlug`),
    })
  }
  exact(input, ['kind', 'factId', 'note'], path)
  return Object.freeze({
    kind,
    factId: identifier(input.factId, `${path}.factId`),
    note: boundedText(input.note, `${path}.note`, ENCOUNTER_SETTLEMENT_LIMITS.narrativeChars),
  })
}

const parseRewardLine = (value: unknown, path: string): EncounterSettlementRewardLine => {
  const input = record(value, path)
  exact(input, ['rewardId', 'visibility', 'sourceAuthority', 'disposition', 'payload'], path)
  return Object.freeze({
    rewardId: identifier(input.rewardId, `${path}.rewardId`),
    visibility: oneOf(input.visibility, ENCOUNTER_SETTLEMENT_AUDIENCES, `${path}.visibility`),
    sourceAuthority: parseAuthority(input.sourceAuthority, `${path}.sourceAuthority`),
    disposition: oneOf(input.disposition, ['pending', 'allocated', 'excluded', 'committed'] as const, `${path}.disposition`),
    payload: parseRewardPayload(input.payload, `${path}.payload`),
  })
}

const parseRewardPackage = (value: unknown, path: string): EncounterSettlementRewardPackage => {
  const input = record(value, path)
  exact(input, ['rewardPackageId', 'status', 'lines'], path)
  const lines = parseArray(input.lines, `${path}.lines`, ENCOUNTER_SETTLEMENT_LIMITS.rewardLines, parseRewardLine)
  unique(lines.map(line => line.rewardId), `${path}.lines`)
  return Object.freeze({
    rewardPackageId: identifier(input.rewardPackageId, `${path}.rewardPackageId`),
    status: oneOf(input.status, ['draft', 'ready', 'allocated', 'committed', 'cancelled'] as const, `${path}.status`),
    lines,
  })
}

const parseDestination = (value: unknown, path: string): EncounterSettlementAllocationDestination => {
  const input = record(value, path)
  exact(input, ['kind', 'id', 'revision'], path)
  return Object.freeze({
    kind: oneOf(input.kind, ['group', 'side', 'participant', 'trainer-inventory', 'pokemon-sheet', 'group-inventory', 'profile'] as const, `${path}.kind`),
    id: identifier(input.id, `${path}.id`),
    revision: nonNegativeInteger(input.revision, `${path}.revision`),
  })
}

const parseAllocation = (value: unknown, path: string): EncounterSettlementAllocation => {
  const input = record(value, path)
  exact(input, [
    'allocationId', 'rewardId', 'destination', 'method', 'amount', 'weight',
    'state', 'decisionId', 'receiptId',
  ], path)
  const method = oneOf(input.method, ['fixed', 'weighted', 'individual', 'whole'] as const, `${path}.method`)
  const weight = input.weight === null ? null : positiveInteger(input.weight, `${path}.weight`)
  if ((method === 'weighted') !== (weight !== null)) fail(`${path}.weight`, 'must be positive only for weighted allocation.')
  const state = oneOf(input.state, ENCOUNTER_SETTLEMENT_ENTRY_STATES, `${path}.state`)
  const receiptId = nullableIdentifier(input.receiptId, `${path}.receiptId`)
  if (state === 'applied' && receiptId === null) fail(`${path}.receiptId`, 'is required after application.')
  if ((state === 'proposed' || state === 'ready') && receiptId !== null) fail(`${path}.receiptId`, 'must remain null before terminal settlement.')
  return Object.freeze({
    allocationId: identifier(input.allocationId, `${path}.allocationId`),
    rewardId: identifier(input.rewardId, `${path}.rewardId`),
    destination: parseDestination(input.destination, `${path}.destination`),
    method,
    amount: positiveInteger(input.amount, `${path}.amount`),
    weight,
    state,
    decisionId: nullableIdentifier(input.decisionId, `${path}.decisionId`),
    receiptId,
  })
}

const parseCleanup = (value: unknown, path: string): EncounterSettlementCleanupEntry => {
  const input = record(value, path)
  exact(input, [
    'cleanupId', 'kind', 'authority', 'participantIds', 'sourceIds', 'behavior',
    'state', 'decisionId', 'receiptId',
  ], path)
  const behavior = oneOf(input.behavior, ENCOUNTER_SETTLEMENT_BEHAVIORS, `${path}.behavior`)
  const decisionId = nullableIdentifier(input.decisionId, `${path}.decisionId`)
  if (behavior === 'require-decision' && decisionId === null) fail(`${path}.decisionId`, 'is required by require-decision behavior.')
  const state = oneOf(input.state, ENCOUNTER_SETTLEMENT_ENTRY_STATES, `${path}.state`)
  const receiptId = nullableIdentifier(input.receiptId, `${path}.receiptId`)
  if (state === 'applied' && receiptId === null) fail(`${path}.receiptId`, 'is required after application.')
  if ((state === 'proposed' || state === 'ready') && receiptId !== null) fail(`${path}.receiptId`, 'must remain null before terminal settlement.')
  return Object.freeze({
    cleanupId: identifier(input.cleanupId, `${path}.cleanupId`),
    kind: oneOf(input.kind, ENCOUNTER_SETTLEMENT_CLEANUP_KINDS, `${path}.kind`),
    authority: parseAuthority(input.authority, `${path}.authority`),
    participantIds: parseIdArray(input.participantIds, `${path}.participantIds`, ENCOUNTER_SETTLEMENT_LIMITS.participantRefsPerEntry),
    sourceIds: parseIdArray(input.sourceIds, `${path}.sourceIds`, ENCOUNTER_SETTLEMENT_LIMITS.participantRefsPerEntry),
    behavior,
    state,
    decisionId,
    receiptId,
  })
}

const parseSubject = (value: unknown, path: string): EncounterSettlementDecisionSubject => {
  const input = record(value, path)
  exact(input, ['kind', 'id'], path)
  return Object.freeze({
    kind: oneOf(input.kind, ['gate', 'consequence', 'reward', 'allocation', 'cleanup', 'objective', 'clock', 'phase', 'capture', 'completion'] as const, `${path}.kind`),
    id: identifier(input.id, `${path}.id`),
  })
}

const parseOption = (value: unknown, path: string): EncounterSettlementDecisionOption => {
  const input = record(value, path)
  exact(input, ['optionId', 'effect', 'valueId', 'authority'], path)
  return Object.freeze({
    optionId: identifier(input.optionId, `${path}.optionId`),
    effect: oneOf(input.effect, ['accept', 'exclude', 'destination', 'transform', 'correct', 'waive'] as const, `${path}.effect`),
    valueId: nullableIdentifier(input.valueId, `${path}.valueId`),
    authority: input.authority === null ? null : parseAuthority(input.authority, `${path}.authority`),
  })
}

const parseDecisionActor = (value: unknown, path: string): EncounterSettlementDecisionActor => {
  const input = record(value, path)
  exact(input, ['kind', 'principalId'], path)
  return Object.freeze({
    kind: oneOf(input.kind, ['gm', 'profile'] as const, `${path}.kind`),
    principalId: identifier(input.principalId, `${path}.principalId`),
  })
}

const parseDecision = (value: unknown, path: string): EncounterSettlementDecision => {
  const input = record(value, path)
  exact(input, [
    'decisionId', 'kind', 'audience', 'status', 'subjects', 'options',
    'selectedOptionId', 'decidedBy', 'decidedAtCampaignMinute',
  ], path)
  const subjects = parseArray(input.subjects, `${path}.subjects`, ENCOUNTER_SETTLEMENT_LIMITS.decisionSubjects, parseSubject)
  if (subjects.length === 0) fail(`${path}.subjects`, 'must name at least one bounded subject.')
  unique(subjects.map(subject => `${subject.kind}:${subject.id}`), `${path}.subjects`)
  const options = parseArray(input.options, `${path}.options`, ENCOUNTER_SETTLEMENT_LIMITS.decisionOptions, parseOption)
  if (options.length === 0) fail(`${path}.options`, 'must contain at least one bounded option.')
  unique(options.map(option => option.optionId), `${path}.options`)
  const status = oneOf(input.status, ['open', 'accepted'] as const, `${path}.status`)
  const selectedOptionId = nullableIdentifier(input.selectedOptionId, `${path}.selectedOptionId`)
  const decidedBy = input.decidedBy === null ? null : parseDecisionActor(input.decidedBy, `${path}.decidedBy`)
  const decidedAtCampaignMinute = input.decidedAtCampaignMinute === null
    ? null
    : nonNegativeInteger(input.decidedAtCampaignMinute, `${path}.decidedAtCampaignMinute`)
  if (status === 'open' && (selectedOptionId !== null || decidedBy !== null || decidedAtCampaignMinute !== null)) {
    fail(path, 'open decisions cannot contain terminal selection or actor evidence.')
  }
  if (status === 'accepted' && (
    selectedOptionId === null
    || !options.some(option => option.optionId === selectedOptionId)
    || decidedBy === null
    || decidedAtCampaignMinute === null
  )) {
    fail(path, 'accepted decisions require one current option, actor, and campaign minute.')
  }
  return Object.freeze({
    decisionId: identifier(input.decisionId, `${path}.decisionId`),
    kind: oneOf(input.kind, ['allocation', 'capture-destination', 'consequence', 'cleanup', 'objective-outcome', 'gm-correction', 'exclusion', 'completion'] as const, `${path}.kind`),
    audience: oneOf(input.audience, ENCOUNTER_SETTLEMENT_AUDIENCES, `${path}.audience`),
    status,
    subjects,
    options,
    selectedOptionId,
    decidedBy,
    decidedAtCampaignMinute,
  })
}

const parseReceiptSubject = (value: unknown, path: string): EncounterSettlementReceiptSubject => {
  const input = record(value, path)
  exact(input, ['kind', 'id'], path)
  return Object.freeze({
    kind: oneOf(input.kind, ['gate', 'consequence', 'reward', 'allocation', 'cleanup', 'objective', 'clock', 'phase', 'capture', 'completion', 'decision', 'settlement'] as const, `${path}.kind`),
    id: identifier(input.id, `${path}.id`),
  })
}

const parseReceipt = (value: unknown, path: string): EncounterSettlementReceipt => {
  const input = record(value, path)
  exact(input, [
    'receiptId', 'kind', 'audience', 'operationId', 'result', 'subjects',
    'sourceReceiptId', 'acceptedAtCampaignMinute',
  ], path)
  const subjects = parseArray(input.subjects, `${path}.subjects`, ENCOUNTER_SETTLEMENT_LIMITS.receiptSubjects, parseReceiptSubject)
  if (subjects.length === 0) fail(`${path}.subjects`, 'must name at least one settled subject.')
  unique(subjects.map(subject => `${subject.kind}:${subject.id}`), `${path}.subjects`)
  const kind = oneOf(input.kind, ['decision', 'consequence', 'reward', 'allocation', 'cleanup', 'completion', 'correction'] as const, `${path}.kind`)
  const sourceReceiptId = nullableIdentifier(input.sourceReceiptId, `${path}.sourceReceiptId`)
  if ((kind === 'correction') !== (sourceReceiptId !== null)) fail(`${path}.sourceReceiptId`, 'is required only for a correction receipt.')
  return Object.freeze({
    receiptId: identifier(input.receiptId, `${path}.receiptId`),
    kind,
    audience: oneOf(input.audience, ENCOUNTER_SETTLEMENT_AUDIENCES, `${path}.audience`),
    operationId: identifier(input.operationId, `${path}.operationId`),
    result: oneOf(input.result, ['accepted', 'excluded', 'corrected', 'cancelled'] as const, `${path}.result`),
    subjects,
    sourceReceiptId,
    acceptedAtCampaignMinute: nonNegativeInteger(input.acceptedAtCampaignMinute, `${path}.acceptedAtCampaignMinute`),
  })
}

const parseCompletion = (value: unknown, path: string): EncounterSettlementCompletion => {
  const input = record(value, path)
  exact(input, ['state', 'operationId', 'receiptId', 'completedEncounterRevision', 'completedAtCampaignMinute'], path)
  const state = oneOf(input.state, ['open', 'accepted', 'cancelled'] as const, `${path}.state`)
  if (state === 'open') {
    if (
      input.operationId !== null
      || input.receiptId !== null
      || input.completedEncounterRevision !== null
      || input.completedAtCampaignMinute !== null
    ) fail(path, 'open completion cannot contain terminal evidence.')
    return Object.freeze({
      state,
      operationId: null,
      receiptId: null,
      completedEncounterRevision: null,
      completedAtCampaignMinute: null,
    })
  }
  return Object.freeze({
    state,
    operationId: identifier(input.operationId, `${path}.operationId`),
    receiptId: identifier(input.receiptId, `${path}.receiptId`),
    completedEncounterRevision: nonNegativeInteger(input.completedEncounterRevision, `${path}.completedEncounterRevision`),
    completedAtCampaignMinute: nonNegativeInteger(input.completedAtCampaignMinute, `${path}.completedAtCampaignMinute`),
  })
}

const assertLocalSubject = (
  subject: EncounterSettlementDecisionSubject | EncounterSettlementReceiptSubject,
  localIds: ReadonlyMap<string, ReadonlySet<string>>,
  path: string,
): void => {
  const identities = localIds.get(subject.kind)
  if (identities && !identities.has(subject.id)) fail(path, `references unknown ${subject.kind} identity.`)
}

export const parseEncounterSettlementDocument = (value: unknown): EncounterSettlementDocument => {
  const detached = cloneStrictJson(value, 'settlement', {
    limits: {
      depth: ENCOUNTER_SETTLEMENT_LIMITS.strictJsonDepth,
      nodes: ENCOUNTER_SETTLEMENT_LIMITS.strictJsonNodes,
      objectFields: ENCOUNTER_SETTLEMENT_LIMITS.strictJsonObjectFields,
      arrayEntries: ENCOUNTER_SETTLEMENT_LIMITS.strictJsonArrayEntries,
      stringLength: ENCOUNTER_SETTLEMENT_LIMITS.narrativeChars,
      objectKeyLength: 100,
    },
    rootLabel: 'Encounter settlement document',
    valueLabel: 'encounter settlement documents',
    failNotJson: fail,
    failLimit: fail,
  })
  const input = record(detached, 'settlement')
  exact(input, [
    'schemaVersion', 'settlementId', 'revision', 'status', 'encounter', 'participants',
    'unresolvedGates', 'persistentConsequences', 'rewardPackage', 'allocations',
    'temporaryCleanup', 'decisions', 'receipts', 'completion',
    'createdAtCampaignMinute', 'updatedAtCampaignMinute',
  ], 'settlement')
  if (input.schemaVersion !== ENCOUNTER_SETTLEMENT_DOCUMENT_SCHEMA_VERSION) fail('settlement.schemaVersion', 'is unsupported.')

  const settlementId = identifier(input.settlementId, 'settlement.settlementId')
  const revision = nonNegativeInteger(input.revision, 'settlement.revision')
  const status = oneOf(input.status, ENCOUNTER_SETTLEMENT_STATUSES, 'settlement.status')
  const encounter = parseEncounter(input.encounter, 'settlement.encounter')
  const participants = parseArray(input.participants, 'settlement.participants', ENCOUNTER_SETTLEMENT_LIMITS.participants, parseParticipant)
  const unresolvedGates = parseArray(input.unresolvedGates, 'settlement.unresolvedGates', ENCOUNTER_SETTLEMENT_LIMITS.unresolvedGates, parseGate)
  const persistentConsequences = parseArray(
    input.persistentConsequences,
    'settlement.persistentConsequences',
    ENCOUNTER_SETTLEMENT_LIMITS.consequences,
    parseConsequence,
  )
  const rewardPackage = parseRewardPackage(input.rewardPackage, 'settlement.rewardPackage')
  const allocations = parseArray(input.allocations, 'settlement.allocations', ENCOUNTER_SETTLEMENT_LIMITS.allocations, parseAllocation)
  const temporaryCleanup = parseArray(input.temporaryCleanup, 'settlement.temporaryCleanup', ENCOUNTER_SETTLEMENT_LIMITS.cleanupEntries, parseCleanup)
  const decisions = parseArray(input.decisions, 'settlement.decisions', ENCOUNTER_SETTLEMENT_LIMITS.decisions, parseDecision)
  const receipts = parseArray(input.receipts, 'settlement.receipts', ENCOUNTER_SETTLEMENT_LIMITS.receipts, parseReceipt)
  const completion = parseCompletion(input.completion, 'settlement.completion')
  const createdAtCampaignMinute = nonNegativeInteger(input.createdAtCampaignMinute, 'settlement.createdAtCampaignMinute')
  const updatedAtCampaignMinute = nonNegativeInteger(input.updatedAtCampaignMinute, 'settlement.updatedAtCampaignMinute')

  unique(participants.map(entry => entry.participantId), 'settlement.participants')
  unique(unresolvedGates.map(entry => entry.gateId), 'settlement.unresolvedGates')
  unique(persistentConsequences.map(entry => entry.consequenceId), 'settlement.persistentConsequences')
  unique(allocations.map(entry => entry.allocationId), 'settlement.allocations')
  unique(temporaryCleanup.map(entry => entry.cleanupId), 'settlement.temporaryCleanup')
  unique(decisions.map(entry => entry.decisionId), 'settlement.decisions')
  unique(receipts.map(entry => entry.receiptId), 'settlement.receipts')

  const participantIds = new Set(participants.map(entry => entry.participantId))
  for (const [index, participant] of participants.entries()) {
    if (participant.ownerParticipantId !== null && !participantIds.has(participant.ownerParticipantId)) {
      fail(`settlement.participants[${index}].ownerParticipantId`, 'references an unknown participant.')
    }
  }
  for (const [index, gate] of unresolvedGates.entries()) {
    if (gate.openedAtSettlementRevision > revision) fail(`settlement.unresolvedGates[${index}].openedAtSettlementRevision`, 'cannot exceed the document revision.')
    for (const participantId of gate.participantIds) if (!participantIds.has(participantId)) fail(`settlement.unresolvedGates[${index}].participantIds`, 'references an unknown participant.')
  }
  for (const [index, consequence] of persistentConsequences.entries()) {
    if (consequence.participantId !== null && !participantIds.has(consequence.participantId)) {
      fail(`settlement.persistentConsequences[${index}].participantId`, 'references an unknown participant.')
    }
  }
  for (const [index, cleanup] of temporaryCleanup.entries()) {
    for (const participantId of cleanup.participantIds) if (!participantIds.has(participantId)) fail(`settlement.temporaryCleanup[${index}].participantIds`, 'references an unknown participant.')
  }

  const rewardIds = new Set(rewardPackage.lines.map(line => line.rewardId))
  for (const [index, allocation] of allocations.entries()) {
    if (!rewardIds.has(allocation.rewardId)) fail(`settlement.allocations[${index}].rewardId`, 'references an unknown reward line.')
    if (allocation.destination.kind === 'participant' && !participantIds.has(allocation.destination.id)) {
      fail(`settlement.allocations[${index}].destination.id`, 'references an unknown participant destination.')
    }
  }

  const decisionIds = new Set(decisions.map(entry => entry.decisionId))
  const receiptIds = new Set(receipts.map(entry => entry.receiptId))
  const assertDecisionReceiptRefs = (entry: { readonly decisionId: string | null, readonly receiptId: string | null }, path: string): void => {
    if (entry.decisionId !== null && !decisionIds.has(entry.decisionId)) fail(`${path}.decisionId`, 'references an unknown decision.')
    if (entry.receiptId !== null && !receiptIds.has(entry.receiptId)) fail(`${path}.receiptId`, 'references an unknown receipt.')
  }
  persistentConsequences.forEach((entry, index) => assertDecisionReceiptRefs(entry, `settlement.persistentConsequences[${index}]`))
  allocations.forEach((entry, index) => assertDecisionReceiptRefs(entry, `settlement.allocations[${index}]`))
  temporaryCleanup.forEach((entry, index) => assertDecisionReceiptRefs(entry, `settlement.temporaryCleanup[${index}]`))

  // Gate decisions and receipts may retain a stable subject after the gate is
  // resolved and removed from the current unresolved list. Other local subjects
  // must still resolve inside this revision.
  const localIds = new Map<string, ReadonlySet<string>>([
    ['consequence', new Set(persistentConsequences.map(entry => entry.consequenceId))],
    ['reward', rewardIds],
    ['allocation', new Set(allocations.map(entry => entry.allocationId))],
    ['cleanup', new Set(temporaryCleanup.map(entry => entry.cleanupId))],
    ['decision', decisionIds],
    ['settlement', new Set([settlementId])],
    ['completion', new Set([settlementId])],
  ])
  decisions.forEach((decision, decisionIndex) => decision.subjects.forEach((subject, subjectIndex) => {
    assertLocalSubject(subject, localIds, `settlement.decisions[${decisionIndex}].subjects[${subjectIndex}]`)
  }))
  receipts.forEach((receipt, receiptIndex) => receipt.subjects.forEach((subject, subjectIndex) => {
    assertLocalSubject(subject, localIds, `settlement.receipts[${receiptIndex}].subjects[${subjectIndex}]`)
  }))
  for (const [index, receipt] of receipts.entries()) {
    if (receipt.sourceReceiptId !== null && !receiptIds.has(receipt.sourceReceiptId)) {
      fail(`settlement.receipts[${index}].sourceReceiptId`, 'references an unknown source receipt.')
    }
  }

  if (updatedAtCampaignMinute < createdAtCampaignMinute || createdAtCampaignMinute < encounter.campaignMinute) {
    fail('settlement.updatedAtCampaignMinute', 'campaign timestamps must be monotonic from the encounter checkpoint.')
  }
  decisions.forEach((decision, index) => {
    if (decision.decidedAtCampaignMinute !== null && (
      decision.decidedAtCampaignMinute < createdAtCampaignMinute
      || decision.decidedAtCampaignMinute > updatedAtCampaignMinute
    )) fail(`settlement.decisions[${index}].decidedAtCampaignMinute`, 'must fall between document creation and the latest update minute.')
  })
  receipts.forEach((receipt, index) => {
    if (
      receipt.acceptedAtCampaignMinute < createdAtCampaignMinute
      || receipt.acceptedAtCampaignMinute > updatedAtCampaignMinute
    ) fail(`settlement.receipts[${index}].acceptedAtCampaignMinute`, 'must fall between document creation and the latest update minute.')
  })
  if (completion.state === 'open') {
    if (status === 'completed' || status === 'cancelled') fail('settlement.completion', 'terminal document status requires terminal completion evidence.')
  }
  else {
    const requiredStatus = completion.state === 'accepted' ? 'completed' : 'cancelled'
    if (status !== requiredStatus) fail('settlement.status', `must be ${requiredStatus} for ${completion.state} completion.`)
    const receipt = receipts.find(entry => entry.receiptId === completion.receiptId)
    const expectedResult = completion.state === 'accepted' ? 'accepted' : 'cancelled'
    if (
      !receipt
      || receipt.kind !== 'completion'
      || receipt.operationId !== completion.operationId
      || receipt.result !== expectedResult
      || receipt.acceptedAtCampaignMinute !== completion.completedAtCampaignMinute
      || !receipt.subjects.some(subject => subject.kind === 'settlement' && subject.id === settlementId)
    ) {
      fail('settlement.completion.receiptId', 'must link the exact completion receipt, operation, result, subject, and campaign minute.')
    }
    if (unresolvedGates.length > 0) fail('settlement.unresolvedGates', 'must be empty after terminal completion.')
    if (completion.completedEncounterRevision < encounter.encounterRevision) {
      fail('settlement.completion.completedEncounterRevision', 'cannot precede the snapshotted encounter revision.')
    }
    if (
      completion.completedAtCampaignMinute < createdAtCampaignMinute
      || updatedAtCampaignMinute < completion.completedAtCampaignMinute
    ) {
      fail('settlement.completion.completedAtCampaignMinute', 'must fall between document creation and the latest update minute.')
    }
  }

  return deepFreezeStrictJson({
    schemaVersion: ENCOUNTER_SETTLEMENT_DOCUMENT_SCHEMA_VERSION,
    settlementId,
    revision,
    status,
    encounter,
    participants,
    unresolvedGates,
    persistentConsequences,
    rewardPackage,
    allocations,
    temporaryCleanup,
    decisions,
    receipts,
    completion,
    createdAtCampaignMinute,
    updatedAtCampaignMinute,
  })
}

export const createEncounterSettlementDocument = (input: {
  readonly settlementId: string
  readonly rewardPackageId: string
  readonly encounter: EncounterSettlementEncounterRef
}): EncounterSettlementDocument => parseEncounterSettlementDocument({
  schemaVersion: ENCOUNTER_SETTLEMENT_DOCUMENT_SCHEMA_VERSION,
  settlementId: input.settlementId,
  revision: 0,
  status: 'draft',
  encounter: input.encounter,
  participants: [],
  unresolvedGates: [],
  persistentConsequences: [],
  rewardPackage: {
    rewardPackageId: input.rewardPackageId,
    status: 'draft',
    lines: [],
  },
  allocations: [],
  temporaryCleanup: [],
  decisions: [],
  receipts: [],
  completion: {
    state: 'open',
    operationId: null,
    receiptId: null,
    completedEncounterRevision: null,
    completedAtCampaignMinute: null,
  },
  createdAtCampaignMinute: input.encounter.campaignMinute,
  updatedAtCampaignMinute: input.encounter.campaignMinute,
})
