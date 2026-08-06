import {
  parseBreedingCheckRecordIdSyntax,
  parseBreedingOperationIdSyntax,
  parseBreedingProjectIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingCheckRecordId,
  type BreedingOperationId,
  type BreedingProjectId,
  type PokemonEggId,
} from './ids'
import { isSlug } from '../paths'

export const BREEDING_PROJECT_DOCUMENT_SCHEMA_VERSION = 1 as const
export const BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES = 240 as const
export const BREEDING_PROJECT_ADDITIONAL_REQUIRED_CAMPAIGN_MINUTES = 240 as const
export const BREEDING_PROJECT_REVISION_MAXIMUM = 2_147_483_647 as const
export const BREEDING_PROJECT_STATUSES = Object.freeze([
  'draft',
  'awaiting-parent-consent',
  'initial-time-in-progress',
  'check-ready',
  'additional-time-in-progress',
  'ready-to-produce',
  'egg-produced',
  'check-failed',
  'cancelled',
  'expired',
  'abandoned',
  'conflicted',
] as const)
export const BREEDING_PROJECT_ACTIVE_STATUSES = Object.freeze([
  'draft',
  'awaiting-parent-consent',
  'initial-time-in-progress',
  'check-ready',
  'additional-time-in-progress',
  'ready-to-produce',
] as const)
export const BREEDING_PROJECT_TERMINAL_STATUSES = Object.freeze([
  'check-failed', 'cancelled', 'expired', 'abandoned', 'conflicted',
] as const)
export const BREEDING_PROJECT_SETTLED_STATUSES = Object.freeze([
  'egg-produced', ...BREEDING_PROJECT_TERMINAL_STATUSES,
] as const)
export type BreedingProjectStatus = typeof BREEDING_PROJECT_STATUSES[number]
export type BreedingProjectActiveStatus = typeof BREEDING_PROJECT_ACTIVE_STATUSES[number]
export type BreedingProjectTerminalStatus = typeof BREEDING_PROJECT_TERMINAL_STATUSES[number]
export type BreedingProjectConsentPolicy = 'same-owner-control' | 'cross-owner-current-revision-consent'
export type BreedingProjectCheckOutcome = 'success' | 'failure'

export interface BreedingProjectRulesetReferenceV1 {
  readonly rulesetId: string
  readonly definitionSha256: string
}
export interface BreedingProjectParentRefV1 {
  readonly pokemonSheetSlug: string
  readonly ownerTrainerSlug: string
  readonly expectedSheetRevision: number
}
export interface BreedingProjectTimelineV1 {
  readonly initialRequiredCampaignMinutes: 240
  readonly initialAccumulatedCampaignMinutes: number
  readonly additionalRequiredCampaignMinutes: 240
  readonly additionalAccumulatedCampaignMinutes: number
  readonly initialStartedAtCampaignMinute: number | null
  readonly checkReadyAtCampaignMinute: number | null
  readonly additionalStartedAtCampaignMinute: number | null
  readonly readyToProduceAtCampaignMinute: number | null
  readonly eggProducedAtCampaignMinute: number | null
  readonly lastAppliedClockRevision: number | null
  readonly lastAppliedClockMinute: number | null
}
export interface BreedingProjectCheckReferenceV1 {
  readonly checkRecordId: BreedingCheckRecordId
  readonly outcome: BreedingProjectCheckOutcome
  readonly resolvedAtCampaignMinute: number
}
export interface BreedingProjectTerminalV1 {
  readonly reasonId: string
  readonly atCampaignMinute: number
  readonly operationId: BreedingOperationId
}
export interface BreedingProjectDocumentV1 {
  readonly schemaVersion: 1
  readonly projectId: BreedingProjectId
  readonly revision: number
  readonly status: BreedingProjectStatus
  readonly ruleset: BreedingProjectRulesetReferenceV1
  readonly projectCreationOptionSnapshotSha256: string
  readonly ownerTrainerSlug: string
  readonly breederTrainerSlug: string
  readonly parentRefs: readonly [BreedingProjectParentRefV1, BreedingProjectParentRefV1]
  readonly consentPolicy: BreedingProjectConsentPolicy
  readonly timeline: BreedingProjectTimelineV1
  readonly check: BreedingProjectCheckReferenceV1 | null
  readonly producedEggId: PokemonEggId | null
  readonly terminal: BreedingProjectTerminalV1 | null
  readonly createdAtCampaignMinute: number
  readonly updatedAtCampaignMinute: number
  readonly statusChangedAtCampaignMinute: number
  readonly lastOperationId: BreedingOperationId
}

export type BreedingProjectValidationCode =
  | 'breeding.project.invalid-document'
  | 'breeding.project.unknown-field'
  | 'breeding.project.invalid-id'
  | 'breeding.project.invalid-status'
  | 'breeding.project.invalid-invariant'
export class BreedingProjectValidationError extends Error {
  readonly code: BreedingProjectValidationCode
  readonly path: string
  constructor(code: BreedingProjectValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingProjectValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const RULESET_ID = /^[a-z0-9][a-z0-9.-]{0,95}$/
const TERMINAL_REASON_ID = /^breeding\.project-terminal\.[a-z0-9]+(?:-[a-z0-9]+)*$/
const STATUS_SET = new Set<string>(BREEDING_PROJECT_STATUSES)
const CONSENT_POLICIES = new Set<string>(['same-owner-control', 'cross-owner-current-revision-consent'])
const fail = (code: BreedingProjectValidationCode, path: string, message: string): never => {
  throw new BreedingProjectValidationError(code, path, message)
}
const plainRecord = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('breeding.project.invalid-document', path, 'must be a plain object.')
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.project.invalid-document', path, 'must be a plain data object without symbol fields.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.project.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exactRecord = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = plainRecord(value, path)
  const expected = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !expected.has(field))) {
    return fail('breeding.project.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const boundedInteger = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    return fail('breeding.project.invalid-document', path, `must be a non-negative safe integer no greater than ${maximum}.`)
  }
  return value as number
}
const campaignMinute = (value: unknown, path: string): number => boundedInteger(value, path)
const nullableCampaignMinute = (value: unknown, path: string): number | null => (
  value === null ? null : campaignMinute(value, path)
)
const sha256 = (value: unknown, path: string): string => (
  typeof value === 'string' && SHA256.test(value)
    ? value
    : fail('breeding.project.invalid-document', path, 'must be a lowercase SHA-256 value.')
)
const slug = (value: unknown, path: string): string => (
  isSlug(value) && value.length <= 160
    ? value
    : fail('breeding.project.invalid-id', path, 'must be a canonical sheet slug of at most 160 characters.')
)
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}
const parseRuleset = (value: unknown, path: string): BreedingProjectRulesetReferenceV1 => {
  const row = exactRecord(value, ['rulesetId', 'definitionSha256'], path)
  if (typeof row.rulesetId !== 'string' || !RULESET_ID.test(row.rulesetId)) {
    return fail('breeding.project.invalid-id', `${path}.rulesetId`, 'must be a bounded ruleset ID.')
  }
  return Object.freeze({ rulesetId: row.rulesetId, definitionSha256: sha256(row.definitionSha256, `${path}.definitionSha256`) })
}
const parseParentRef = (value: unknown, path: string): BreedingProjectParentRefV1 => {
  const row = exactRecord(value, ['pokemonSheetSlug', 'ownerTrainerSlug', 'expectedSheetRevision'], path)
  return Object.freeze({
    pokemonSheetSlug: slug(row.pokemonSheetSlug, `${path}.pokemonSheetSlug`),
    ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`),
    expectedSheetRevision: boundedInteger(row.expectedSheetRevision, `${path}.expectedSheetRevision`, BREEDING_PROJECT_REVISION_MAXIMUM),
  })
}
const parseTimeline = (value: unknown, path: string): BreedingProjectTimelineV1 => {
  const row = exactRecord(value, [
    'initialRequiredCampaignMinutes', 'initialAccumulatedCampaignMinutes',
    'additionalRequiredCampaignMinutes', 'additionalAccumulatedCampaignMinutes',
    'initialStartedAtCampaignMinute', 'checkReadyAtCampaignMinute',
    'additionalStartedAtCampaignMinute', 'readyToProduceAtCampaignMinute',
    'eggProducedAtCampaignMinute', 'lastAppliedClockRevision', 'lastAppliedClockMinute',
  ], path)
  if (row.initialRequiredCampaignMinutes !== BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES
    || row.additionalRequiredCampaignMinutes !== BREEDING_PROJECT_ADDITIONAL_REQUIRED_CAMPAIGN_MINUTES) {
    return fail('breeding.project.invalid-invariant', path, 'required duration fields must match the v1 ruleset.')
  }
  const initial = boundedInteger(row.initialAccumulatedCampaignMinutes, `${path}.initialAccumulatedCampaignMinutes`)
  const additional = boundedInteger(row.additionalAccumulatedCampaignMinutes, `${path}.additionalAccumulatedCampaignMinutes`)
  if (initial > BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES
    || additional > BREEDING_PROJECT_ADDITIONAL_REQUIRED_CAMPAIGN_MINUTES) {
    return fail('breeding.project.invalid-invariant', path, 'accumulated duration cannot exceed its required duration.')
  }
  const clockRevision = row.lastAppliedClockRevision === null
    ? null
    : boundedInteger(row.lastAppliedClockRevision, `${path}.lastAppliedClockRevision`, BREEDING_PROJECT_REVISION_MAXIMUM)
  const clockMinute = nullableCampaignMinute(row.lastAppliedClockMinute, `${path}.lastAppliedClockMinute`)
  if ((clockRevision === null) !== (clockMinute === null)) {
    return fail('breeding.project.invalid-invariant', path, 'last clock revision and minute must both be null or both be present.')
  }
  return Object.freeze({
    initialRequiredCampaignMinutes: BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES,
    initialAccumulatedCampaignMinutes: initial,
    additionalRequiredCampaignMinutes: BREEDING_PROJECT_ADDITIONAL_REQUIRED_CAMPAIGN_MINUTES,
    additionalAccumulatedCampaignMinutes: additional,
    initialStartedAtCampaignMinute: nullableCampaignMinute(row.initialStartedAtCampaignMinute, `${path}.initialStartedAtCampaignMinute`),
    checkReadyAtCampaignMinute: nullableCampaignMinute(row.checkReadyAtCampaignMinute, `${path}.checkReadyAtCampaignMinute`),
    additionalStartedAtCampaignMinute: nullableCampaignMinute(row.additionalStartedAtCampaignMinute, `${path}.additionalStartedAtCampaignMinute`),
    readyToProduceAtCampaignMinute: nullableCampaignMinute(row.readyToProduceAtCampaignMinute, `${path}.readyToProduceAtCampaignMinute`),
    eggProducedAtCampaignMinute: nullableCampaignMinute(row.eggProducedAtCampaignMinute, `${path}.eggProducedAtCampaignMinute`),
    lastAppliedClockRevision: clockRevision,
    lastAppliedClockMinute: clockMinute,
  })
}
const parseCheck = (value: unknown, path: string): BreedingProjectCheckReferenceV1 | null => {
  if (value === null) return null
  const row = exactRecord(value, ['checkRecordId', 'outcome', 'resolvedAtCampaignMinute'], path)
  const checkRecordId = parseBreedingCheckRecordIdSyntax(row.checkRecordId)
  if (!checkRecordId) fail('breeding.project.invalid-id', `${path}.checkRecordId`, 'must be a breeding check record ID.')
  const outcome = row.outcome
  if (outcome !== 'success' && outcome !== 'failure') {
    fail('breeding.project.invalid-document', `${path}.outcome`, 'must be success or failure.')
  }
  return Object.freeze({
    checkRecordId: checkRecordId!,
    outcome: outcome as BreedingProjectCheckOutcome,
    resolvedAtCampaignMinute: campaignMinute(row.resolvedAtCampaignMinute, `${path}.resolvedAtCampaignMinute`),
  })
}
const parseTerminal = (value: unknown, path: string): BreedingProjectTerminalV1 | null => {
  if (value === null) return null
  const row = exactRecord(value, ['reasonId', 'atCampaignMinute', 'operationId'], path)
  const reasonId = row.reasonId
  if (typeof reasonId !== 'string' || !TERMINAL_REASON_ID.test(reasonId) || reasonId.length > 160) {
    fail('breeding.project.invalid-id', `${path}.reasonId`, 'must be a typed project terminal reason ID.')
  }
  const operationId = parseBreedingOperationIdSyntax(row.operationId)
  if (!operationId) fail('breeding.project.invalid-id', `${path}.operationId`, 'must be a breeding operation ID.')
  return Object.freeze({
    reasonId: reasonId as string,
    atCampaignMinute: campaignMinute(row.atCampaignMinute, `${path}.atCampaignMinute`),
    operationId: operationId!,
  })
}
const requireTimestampOrder = (values: readonly (number | null)[], updated: number, path: string): void => {
  let previous = values[0]!
  for (const value of values.slice(1)) {
    if (value === null) continue
    if (previous !== null && value < previous) fail('breeding.project.invalid-invariant', path, 'campaign timestamps must be monotonic.')
    if (value > updated) fail('breeding.project.invalid-invariant', path, 'campaign timestamps cannot exceed updatedAtCampaignMinute.')
    previous = value
  }
}
const validateInvariants = (document: BreedingProjectDocumentV1): void => {
  const { timeline, status, check } = document
  const initialComplete = timeline.initialAccumulatedCampaignMinutes === timeline.initialRequiredCampaignMinutes
  const additionalComplete = timeline.additionalAccumulatedCampaignMinutes === timeline.additionalRequiredCampaignMinutes
  if ((timeline.initialStartedAtCampaignMinute === null) !== (timeline.lastAppliedClockRevision === null)
    || (timeline.initialAccumulatedCampaignMinutes > 0 && timeline.initialStartedAtCampaignMinute === null)) {
    fail('breeding.project.invalid-invariant', 'breedingProject.timeline', 'started progress must retain a campaign-clock checkpoint.')
  }
  if ((timeline.checkReadyAtCampaignMinute !== null) !== initialComplete) {
    fail('breeding.project.invalid-invariant', 'breedingProject.timeline.checkReadyAtCampaignMinute', 'must exist exactly when initial time is complete.')
  }
  if (timeline.additionalAccumulatedCampaignMinutes > 0 && timeline.additionalStartedAtCampaignMinute === null) {
    fail('breeding.project.invalid-invariant', 'breedingProject.timeline.additionalStartedAtCampaignMinute', 'must exist before additional progress.')
  }
  if ((timeline.readyToProduceAtCampaignMinute !== null) !== additionalComplete) {
    fail('breeding.project.invalid-invariant', 'breedingProject.timeline.readyToProduceAtCampaignMinute', 'must exist exactly when additional time is complete.')
  }
  if ((timeline.eggProducedAtCampaignMinute !== null) !== (status === 'egg-produced')) {
    fail('breeding.project.invalid-invariant', 'breedingProject.timeline.eggProducedAtCampaignMinute', 'must exist exactly for an egg-produced project.')
  }
  if (status === 'draft') {
    if (timeline.initialAccumulatedCampaignMinutes !== 0 || timeline.additionalAccumulatedCampaignMinutes !== 0
      || timeline.initialStartedAtCampaignMinute !== null || check !== null) {
      fail('breeding.project.invalid-invariant', 'breedingProject', 'a draft cannot contain progress or a check.')
    }
  }
  if (status === 'awaiting-parent-consent' && (timeline.additionalAccumulatedCampaignMinutes !== 0 || check !== null)) {
    fail('breeding.project.invalid-invariant', 'breedingProject', 'an awaiting-consent project cannot contain a resolved check or additional progress.')
  }
  if (status === 'initial-time-in-progress' && (timeline.initialStartedAtCampaignMinute === null
    || initialComplete || timeline.additionalAccumulatedCampaignMinutes !== 0 || check !== null)) {
    fail('breeding.project.invalid-invariant', 'breedingProject', 'initial-time status requires started but incomplete initial progress.')
  }
  if (status === 'check-ready' && (!initialComplete || timeline.additionalAccumulatedCampaignMinutes !== 0 || check !== null)) {
    fail('breeding.project.invalid-invariant', 'breedingProject', 'check-ready status requires complete initial time and no resolved check.')
  }
  const successRequired = status === 'additional-time-in-progress' || status === 'ready-to-produce' || status === 'egg-produced'
  if (successRequired && (check?.outcome !== 'success' || !initialComplete || timeline.additionalStartedAtCampaignMinute === null)) {
    fail('breeding.project.invalid-invariant', 'breedingProject.check', 'this status requires one successful check and additional-time start.')
  }
  if (status === 'additional-time-in-progress' && additionalComplete) {
    fail('breeding.project.invalid-invariant', 'breedingProject.status', 'completed additional time must transition to ready-to-produce.')
  }
  if ((status === 'ready-to-produce' || status === 'egg-produced') && !additionalComplete) {
    fail('breeding.project.invalid-invariant', 'breedingProject.status', 'this status requires complete additional time.')
  }
  if (status === 'check-failed' && (check?.outcome !== 'failure' || !initialComplete)) {
    fail('breeding.project.invalid-invariant', 'breedingProject.check', 'check-failed requires one failed check after initial time.')
  }
  if (check?.outcome === 'failure' && status !== 'check-failed') {
    fail('breeding.project.invalid-invariant', 'breedingProject.check', 'a failed check is terminal for its project.')
  }
  if (check?.outcome === 'success' && timeline.additionalStartedAtCampaignMinute === null) {
    fail('breeding.project.invalid-invariant', 'breedingProject.timeline.additionalStartedAtCampaignMinute', 'a successful check must atomically start additional time.')
  }
  if (check && (timeline.checkReadyAtCampaignMinute === null
    || check.resolvedAtCampaignMinute < timeline.checkReadyAtCampaignMinute
    || check.resolvedAtCampaignMinute > document.updatedAtCampaignMinute)) {
    fail('breeding.project.invalid-invariant', 'breedingProject.check.resolvedAtCampaignMinute', 'must follow check readiness and not exceed update time.')
  }
  if (status === 'egg-produced') {
    if (!document.producedEggId || document.terminal !== null) {
      fail('breeding.project.invalid-invariant', 'breedingProject', 'egg-produced requires one Egg ID and no terminal failure record.')
    }
  }
  else if (document.producedEggId !== null) {
    fail('breeding.project.invalid-invariant', 'breedingProject.producedEggId', 'is allowed only for egg-produced.')
  }
  const isTerminal = (BREEDING_PROJECT_TERMINAL_STATUSES as readonly string[]).includes(status)
  if (isTerminal !== (document.terminal !== null)) {
    fail('breeding.project.invalid-invariant', 'breedingProject.terminal', 'must exist exactly for terminal failure states.')
  }
  if (status === 'check-failed' && document.terminal?.reasonId !== 'breeding.project-terminal.check-failed') {
    fail('breeding.project.invalid-invariant', 'breedingProject.terminal.reasonId', 'must identify the terminal failed check.')
  }
  if (document.terminal && (document.terminal.atCampaignMinute < document.createdAtCampaignMinute
    || document.terminal.atCampaignMinute > document.updatedAtCampaignMinute)) {
    fail('breeding.project.invalid-invariant', 'breedingProject.terminal.atCampaignMinute', 'must be within the project campaign-time range.')
  }
  if (document.terminal && document.terminal.operationId !== document.lastOperationId) {
    fail('breeding.project.invalid-invariant', 'breedingProject.terminal.operationId', 'must identify the operation that wrote the terminal revision.')
  }
  requireTimestampOrder([
    document.createdAtCampaignMinute,
    timeline.initialStartedAtCampaignMinute,
    timeline.checkReadyAtCampaignMinute,
    check?.resolvedAtCampaignMinute ?? null,
    timeline.additionalStartedAtCampaignMinute,
    timeline.readyToProduceAtCampaignMinute,
    timeline.eggProducedAtCampaignMinute,
  ], document.updatedAtCampaignMinute, 'breedingProject.timeline')
}

/** Parse, detach, deeply freeze, and enforce all v1 aggregate invariants. */
export const parseBreedingProjectDocumentV1 = (
  value: unknown,
  path = 'breedingProject',
): BreedingProjectDocumentV1 => {
  const row = exactRecord(value, [
    'schemaVersion', 'projectId', 'revision', 'status', 'ruleset',
    'projectCreationOptionSnapshotSha256', 'ownerTrainerSlug', 'breederTrainerSlug',
    'parentRefs', 'consentPolicy', 'timeline', 'check', 'producedEggId', 'terminal',
    'createdAtCampaignMinute', 'updatedAtCampaignMinute', 'statusChangedAtCampaignMinute', 'lastOperationId',
  ], path)
  if (row.schemaVersion !== BREEDING_PROJECT_DOCUMENT_SCHEMA_VERSION) {
    fail('breeding.project.invalid-document', `${path}.schemaVersion`, 'must be schema version 1.')
  }
  const projectId = parseBreedingProjectIdSyntax(row.projectId)
  if (!projectId) fail('breeding.project.invalid-id', `${path}.projectId`, 'must be a breeding project ID.')
  if (typeof row.status !== 'string' || !STATUS_SET.has(row.status)) {
    fail('breeding.project.invalid-status', `${path}.status`, 'must be a v1 project status.')
  }
  const parentRefValues = row.parentRefs
  if (!Array.isArray(parentRefValues) || parentRefValues.length !== 2
    || !Object.hasOwn(parentRefValues, 0) || !Object.hasOwn(parentRefValues, 1)
    || Object.getOwnPropertySymbols(parentRefValues).length > 0
    || Object.keys(parentRefValues).some(key => key !== '0' && key !== '1')) {
    fail('breeding.project.invalid-document', `${path}.parentRefs`, 'must contain exactly two parent references and no enriched fields.')
  }
  const parentRefs = [
    parseParentRef((parentRefValues as unknown[])[0], `${path}.parentRefs[0]`),
    parseParentRef((parentRefValues as unknown[])[1], `${path}.parentRefs[1]`),
  ] as const
  if (parentRefs[0].pokemonSheetSlug === parentRefs[1].pokemonSheetSlug) {
    fail('breeding.project.invalid-invariant', `${path}.parentRefs`, 'must identify two distinct Pokémon sheets.')
  }
  if (typeof row.consentPolicy !== 'string' || !CONSENT_POLICIES.has(row.consentPolicy)) {
    fail('breeding.project.invalid-document', `${path}.consentPolicy`, 'must be a v1 consent policy.')
  }
  const producedEggId = row.producedEggId === null ? null : parsePokemonEggIdSyntax(row.producedEggId)
  if (row.producedEggId !== null && !producedEggId) fail('breeding.project.invalid-id', `${path}.producedEggId`, 'must be a Pokémon Egg ID.')
  const lastOperationId = parseBreedingOperationIdSyntax(row.lastOperationId)
  if (!lastOperationId) fail('breeding.project.invalid-id', `${path}.lastOperationId`, 'must be a breeding operation ID.')
  const createdAtCampaignMinute = campaignMinute(row.createdAtCampaignMinute, `${path}.createdAtCampaignMinute`)
  const updatedAtCampaignMinute = campaignMinute(row.updatedAtCampaignMinute, `${path}.updatedAtCampaignMinute`)
  const statusChangedAtCampaignMinute = campaignMinute(row.statusChangedAtCampaignMinute, `${path}.statusChangedAtCampaignMinute`)
  if (createdAtCampaignMinute > statusChangedAtCampaignMinute || statusChangedAtCampaignMinute > updatedAtCampaignMinute) {
    fail('breeding.project.invalid-invariant', path, 'created, status-changed, and updated campaign minutes must be monotonic.')
  }
  const document: BreedingProjectDocumentV1 = {
    schemaVersion: BREEDING_PROJECT_DOCUMENT_SCHEMA_VERSION,
    projectId: projectId!,
    revision: boundedInteger(row.revision, `${path}.revision`, BREEDING_PROJECT_REVISION_MAXIMUM),
    status: row.status as BreedingProjectStatus,
    ruleset: parseRuleset(row.ruleset, `${path}.ruleset`),
    projectCreationOptionSnapshotSha256: sha256(row.projectCreationOptionSnapshotSha256, `${path}.projectCreationOptionSnapshotSha256`),
    ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`),
    breederTrainerSlug: slug(row.breederTrainerSlug, `${path}.breederTrainerSlug`),
    parentRefs,
    consentPolicy: row.consentPolicy as BreedingProjectConsentPolicy,
    timeline: parseTimeline(row.timeline, `${path}.timeline`),
    check: parseCheck(row.check, `${path}.check`),
    producedEggId,
    terminal: parseTerminal(row.terminal, `${path}.terminal`),
    createdAtCampaignMinute,
    updatedAtCampaignMinute,
    statusChangedAtCampaignMinute,
    lastOperationId: lastOperationId!,
  }
  validateInvariants(document)
  return deepFreeze(document)
}

export const isBreedingProjectStatus = (value: unknown): value is BreedingProjectStatus => (
  typeof value === 'string' && STATUS_SET.has(value)
)
export const isBreedingProjectTerminalStatus = (value: unknown): value is BreedingProjectTerminalStatus => (
  typeof value === 'string' && (BREEDING_PROJECT_TERMINAL_STATUSES as readonly string[]).includes(value)
)
export const isBreedingProjectSettledStatus = (value: unknown): boolean => (
  typeof value === 'string' && (BREEDING_PROJECT_SETTLED_STATUSES as readonly string[]).includes(value)
)
