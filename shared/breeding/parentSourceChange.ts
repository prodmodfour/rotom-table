import { isSlug } from '../paths'
import type { BreedingProjectId, PokemonEggId } from './ids'

export const BREEDING_PARENT_SOURCE_CHANGE_KINDS = Object.freeze([
  'evolution',
  'trade',
  'rename',
  'folder-move',
  'deletion',
  'retraining',
  'source-reference-update',
] as const)
export const BREEDING_PARENT_SOURCE_CHANGE_CHECKPOINTS = Object.freeze([
  'project-pre-check',
  'project-pre-check-unrefreshable',
  'project-post-check',
  'project-settled-with-egg',
  'project-terminal',
  'accepted-egg',
] as const)
export const BREEDING_PARENT_SOURCE_CHANGE_DISPOSITIONS = Object.freeze([
  'interrupt-refresh-and-revalidate',
  'block-until-cancel-or-reviewed-migration',
  'preserve-settled-project',
  'preserve-terminal-project',
  'preserve-immutable-egg',
] as const)
export const BREEDING_PARENT_SOURCE_CHANGE_REASON_IDS = Object.freeze([
  'breeding.parent-change.accepted-egg-preserved',
  'breeding.parent-change.active-project-blocked',
  'breeding.parent-change.pre-check-refresh-required',
  'breeding.parent-change.settled-project-preserved',
  'breeding.parent-change.terminal-project-preserved',
] as const)

export type BreedingParentSourceChangeKindV1 = typeof BREEDING_PARENT_SOURCE_CHANGE_KINDS[number]
export type BreedingParentSourceChangeCheckpointV1 = typeof BREEDING_PARENT_SOURCE_CHANGE_CHECKPOINTS[number]
export type BreedingParentSourceChangeDispositionV1 = typeof BREEDING_PARENT_SOURCE_CHANGE_DISPOSITIONS[number]
export type BreedingParentSourceChangeReasonIdV1 = typeof BREEDING_PARENT_SOURCE_CHANGE_REASON_IDS[number]

export interface BreedingParentSourceFactV1 {
  readonly pokemonSheetSlug: string
  readonly sheetRevision: number
  readonly ownerTrainerSlug: string
  readonly speciesId: string
  readonly folder: string
  readonly sourceSheetSha256: string
  readonly referenceSnapshotDefinitionSha256: string
}

export interface BreedingParentSourceChangeEvidenceV1 {
  readonly schemaVersion: 1
  readonly changeId: `breeding-parent-change:v1:${string}`
  readonly changeKind: BreedingParentSourceChangeKindV1
  readonly prior: BreedingParentSourceFactV1
  readonly next: BreedingParentSourceFactV1 | null
  readonly observedAtCampaignMinute: number
  readonly authority: 'server-observed-current-storage-and-reference-snapshots'
  readonly clientAuthority: 'none'
  readonly definitionSha256: string
}

export interface BreedingParentSourceChangeImpactV1 {
  readonly schemaVersion: 1
  readonly changeId: BreedingParentSourceChangeEvidenceV1['changeId']
  readonly changeDefinitionSha256: string
  readonly changeKind: BreedingParentSourceChangeKindV1
  readonly aggregateKind: 'breeding-project' | 'pokemon-egg'
  readonly aggregateId: BreedingProjectId | PokemonEggId
  readonly aggregateRevision: number
  readonly parentIndex: 0 | 1
  readonly checkpoint: BreedingParentSourceChangeCheckpointV1
  readonly disposition: BreedingParentSourceChangeDispositionV1
  readonly aggregateMutation: 'none'
  readonly creditedProgress: 'preserve-no-new-credit' | 'preserve-complete' | 'not-applicable'
  readonly consent: 'renew-current-parent-revision-required' | 'cannot-substitute-for-new-project' | 'unchanged-audit-only'
  readonly acceptedSnapshot: 'not-yet-created' | 'immutable-preserved' | 'not-applicable'
  readonly incubation: 'not-applicable' | 'preserve-current-explicit-state'
  readonly hatchEligibility: 'not-applicable' | 'preserve-status-derived-eligibility'
  readonly reasonId: BreedingParentSourceChangeReasonIdV1
  readonly evaluatedAtCampaignMinute: number
  readonly definitionSha256: string
}

export type BreedingParentSourceChangeValidationCode =
  | 'breeding.parent-change.invalid-document'
  | 'breeding.parent-change.unknown-field'
  | 'breeding.parent-change.invalid-id'
  | 'breeding.parent-change.invalid-invariant'

export class BreedingParentSourceChangeValidationError extends Error {
  readonly code: BreedingParentSourceChangeValidationCode
  readonly path: string

  constructor(code: BreedingParentSourceChangeValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingParentSourceChangeValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const CHANGE_ID = /^breeding-parent-change:v1:[0-9a-f]{32}$/
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const FOLDER = /^(?:[A-Za-z0-9][A-Za-z0-9._ -]{0,79})(?:\/(?:[A-Za-z0-9][A-Za-z0-9._ -]{0,79}))*$/
const changeKinds = new Set<string>(BREEDING_PARENT_SOURCE_CHANGE_KINDS)
const checkpoints = new Set<string>(BREEDING_PARENT_SOURCE_CHANGE_CHECKPOINTS)
const dispositions = new Set<string>(BREEDING_PARENT_SOURCE_CHANGE_DISPOSITIONS)
const reasons = new Set<string>(BREEDING_PARENT_SOURCE_CHANGE_REASON_IDS)

const fail = (code: BreedingParentSourceChangeValidationCode, path: string, message: string): never => {
  throw new BreedingParentSourceChangeValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.parent-change.invalid-document', path, 'must be one plain data object without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.parent-change.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.parent-change.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail('breeding.parent-change.invalid-document', path, 'must be a nonnegative safe integer.')
  }
  return value as number
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.parent-change.invalid-document', path, 'must be one lowercase SHA-256 value.')
const closed = <Value extends string>(value: unknown, allowed: ReadonlySet<string>, path: string): Value => (
  typeof value === 'string' && allowed.has(value)
    ? value as Value
    : fail('breeding.parent-change.invalid-document', path, 'must be one closed v1 value.')
)
const literal = <Value extends string>(value: unknown, expected: Value, path: string): Value => value === expected
  ? expected
  : fail('breeding.parent-change.invalid-invariant', path, `must be ${expected}.`)
const stableId = (value: unknown, path: string): string => typeof value === 'string' && STABLE_ID.test(value)
  ? value
  : fail('breeding.parent-change.invalid-id', path, 'must be one bounded stable identifier.')
const slug = (value: unknown, path: string): string => isSlug(value)
  ? value
  : fail('breeding.parent-change.invalid-id', path, 'must be one canonical sheet slug.')
const folder = (value: unknown, path: string): string => value === '' || (typeof value === 'string' && value.length <= 512 && FOLDER.test(value))
  ? value as string
  : fail('breeding.parent-change.invalid-document', path, 'must be an empty or canonical bounded folder path.')

const parseFact = (value: unknown, path: string): BreedingParentSourceFactV1 => {
  const row = exact(value, [
    'pokemonSheetSlug', 'sheetRevision', 'ownerTrainerSlug', 'speciesId', 'folder',
    'sourceSheetSha256', 'referenceSnapshotDefinitionSha256',
  ], path)
  return Object.freeze({
    pokemonSheetSlug: slug(row.pokemonSheetSlug, `${path}.pokemonSheetSlug`),
    sheetRevision: integer(row.sheetRevision, `${path}.sheetRevision`),
    ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`),
    speciesId: stableId(row.speciesId, `${path}.speciesId`),
    folder: folder(row.folder, `${path}.folder`),
    sourceSheetSha256: hash(row.sourceSheetSha256, `${path}.sourceSheetSha256`),
    referenceSnapshotDefinitionSha256: hash(row.referenceSnapshotDefinitionSha256, `${path}.referenceSnapshotDefinitionSha256`),
  })
}
const sameFactField = (prior: BreedingParentSourceFactV1, next: BreedingParentSourceFactV1, field: keyof BreedingParentSourceFactV1): boolean => prior[field] === next[field]
const exactChangedFields = (
  prior: BreedingParentSourceFactV1,
  next: BreedingParentSourceFactV1,
  changed: readonly (keyof BreedingParentSourceFactV1)[],
): boolean => {
  const changedSet = new Set<keyof BreedingParentSourceFactV1>(changed)
  return (Object.keys(prior) as Array<keyof BreedingParentSourceFactV1>).every(field => (
    changedSet.has(field) ? !sameFactField(prior, next, field) : sameFactField(prior, next, field)
  ))
}
const validChangeDelta = (
  kind: BreedingParentSourceChangeKindV1,
  prior: BreedingParentSourceFactV1,
  next: BreedingParentSourceFactV1 | null,
): boolean => {
  if (kind === 'deletion') return next === null
  if (!next) return false
  if (kind === 'source-reference-update') {
    return exactChangedFields(prior, next, ['referenceSnapshotDefinitionSha256'])
  }
  if (next.sheetRevision <= prior.sheetRevision || next.sourceSheetSha256 === prior.sourceSheetSha256) return false
  if (kind === 'evolution') return exactChangedFields(prior, next, ['sheetRevision', 'speciesId', 'sourceSheetSha256'])
  if (kind === 'trade') return exactChangedFields(prior, next, ['sheetRevision', 'ownerTrainerSlug', 'sourceSheetSha256'])
  if (kind === 'rename') return exactChangedFields(prior, next, ['pokemonSheetSlug', 'sheetRevision', 'sourceSheetSha256'])
  if (kind === 'folder-move') return exactChangedFields(prior, next, ['sheetRevision', 'folder', 'sourceSheetSha256'])
  return exactChangedFields(prior, next, ['sheetRevision', 'sourceSheetSha256'])
}

export const parseBreedingParentSourceChangeEvidenceV1 = (
  value: unknown,
  path = 'breedingParentSourceChangeEvidence',
): BreedingParentSourceChangeEvidenceV1 => {
  const row = exact(value, [
    'schemaVersion', 'changeId', 'changeKind', 'prior', 'next', 'observedAtCampaignMinute',
    'authority', 'clientAuthority', 'definitionSha256',
  ], path)
  if (row.schemaVersion !== 1) fail('breeding.parent-change.invalid-document', `${path}.schemaVersion`, 'must be schema version 1.')
  if (typeof row.changeId !== 'string' || !CHANGE_ID.test(row.changeId)) {
    fail('breeding.parent-change.invalid-id', `${path}.changeId`, 'must be one breeding parent-change ID.')
  }
  const changeKind = closed<BreedingParentSourceChangeKindV1>(row.changeKind, changeKinds, `${path}.changeKind`)
  const prior = parseFact(row.prior, `${path}.prior`)
  const next = row.next === null ? null : parseFact(row.next, `${path}.next`)
  if (!validChangeDelta(changeKind, prior, next)) {
    fail('breeding.parent-change.invalid-invariant', path, 'change kind must match exactly one authoritative before/after delta.')
  }
  return Object.freeze({
    schemaVersion: 1,
    changeId: row.changeId as BreedingParentSourceChangeEvidenceV1['changeId'],
    changeKind,
    prior,
    next,
    observedAtCampaignMinute: integer(row.observedAtCampaignMinute, `${path}.observedAtCampaignMinute`),
    authority: literal(row.authority, 'server-observed-current-storage-and-reference-snapshots', `${path}.authority`),
    clientAuthority: literal(row.clientAuthority, 'none', `${path}.clientAuthority`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}

const expectedImpact = (checkpoint: BreedingParentSourceChangeCheckpointV1): Omit<BreedingParentSourceChangeImpactV1,
  'schemaVersion' | 'changeId' | 'changeDefinitionSha256' | 'changeKind' | 'aggregateKind' | 'aggregateId'
  | 'aggregateRevision' | 'parentIndex' | 'checkpoint' | 'evaluatedAtCampaignMinute' | 'definitionSha256'> => {
  if (checkpoint === 'project-pre-check') return {
    disposition: 'interrupt-refresh-and-revalidate', aggregateMutation: 'none',
    creditedProgress: 'preserve-no-new-credit', consent: 'renew-current-parent-revision-required',
    acceptedSnapshot: 'not-yet-created', incubation: 'not-applicable', hatchEligibility: 'not-applicable',
    reasonId: 'breeding.parent-change.pre-check-refresh-required',
  }
  if (checkpoint === 'project-pre-check-unrefreshable' || checkpoint === 'project-post-check') return {
    disposition: 'block-until-cancel-or-reviewed-migration', aggregateMutation: 'none',
    creditedProgress: 'preserve-no-new-credit', consent: 'cannot-substitute-for-new-project',
    acceptedSnapshot: 'not-yet-created', incubation: 'not-applicable', hatchEligibility: 'not-applicable',
    reasonId: 'breeding.parent-change.active-project-blocked',
  }
  if (checkpoint === 'project-settled-with-egg') return {
    disposition: 'preserve-settled-project', aggregateMutation: 'none',
    creditedProgress: 'preserve-complete', consent: 'unchanged-audit-only',
    acceptedSnapshot: 'immutable-preserved', incubation: 'not-applicable', hatchEligibility: 'not-applicable',
    reasonId: 'breeding.parent-change.settled-project-preserved',
  }
  if (checkpoint === 'project-terminal') return {
    disposition: 'preserve-terminal-project', aggregateMutation: 'none',
    creditedProgress: 'not-applicable', consent: 'unchanged-audit-only',
    acceptedSnapshot: 'not-applicable', incubation: 'not-applicable', hatchEligibility: 'not-applicable',
    reasonId: 'breeding.parent-change.terminal-project-preserved',
  }
  return {
    disposition: 'preserve-immutable-egg', aggregateMutation: 'none',
    creditedProgress: 'preserve-complete', consent: 'unchanged-audit-only',
    acceptedSnapshot: 'immutable-preserved', incubation: 'preserve-current-explicit-state',
    hatchEligibility: 'preserve-status-derived-eligibility',
    reasonId: 'breeding.parent-change.accepted-egg-preserved',
  }
}

export const parseBreedingParentSourceChangeImpactV1 = (
  value: unknown,
  path = 'breedingParentSourceChangeImpact',
): BreedingParentSourceChangeImpactV1 => {
  const row = exact(value, [
    'schemaVersion', 'changeId', 'changeDefinitionSha256', 'changeKind', 'aggregateKind', 'aggregateId',
    'aggregateRevision', 'parentIndex', 'checkpoint', 'disposition', 'aggregateMutation',
    'creditedProgress', 'consent', 'acceptedSnapshot', 'incubation', 'hatchEligibility', 'reasonId',
    'evaluatedAtCampaignMinute', 'definitionSha256',
  ], path)
  if (row.schemaVersion !== 1) fail('breeding.parent-change.invalid-document', `${path}.schemaVersion`, 'must be schema version 1.')
  if (typeof row.changeId !== 'string' || !CHANGE_ID.test(row.changeId)) fail('breeding.parent-change.invalid-id', `${path}.changeId`, 'must be one breeding parent-change ID.')
  const aggregateKind = row.aggregateKind === 'breeding-project' || row.aggregateKind === 'pokemon-egg'
    ? row.aggregateKind
    : fail('breeding.parent-change.invalid-document', `${path}.aggregateKind`, 'must be breeding-project or pokemon-egg.')
  if (typeof row.aggregateId !== 'string' || !STABLE_ID.test(row.aggregateId)) fail('breeding.parent-change.invalid-id', `${path}.aggregateId`, 'must be one stable aggregate ID.')
  const parentIndex = row.parentIndex === 0 || row.parentIndex === 1
    ? row.parentIndex
    : fail('breeding.parent-change.invalid-document', `${path}.parentIndex`, 'must be zero or one.')
  const checkpoint = closed<BreedingParentSourceChangeCheckpointV1>(row.checkpoint, checkpoints, `${path}.checkpoint`)
  if ((aggregateKind === 'pokemon-egg') !== (checkpoint === 'accepted-egg')) {
    fail('breeding.parent-change.invalid-invariant', path, 'aggregate kind and checkpoint must agree.')
  }
  const expected = expectedImpact(checkpoint)
  const actual = {
    disposition: closed<BreedingParentSourceChangeDispositionV1>(row.disposition, dispositions, `${path}.disposition`),
    aggregateMutation: row.aggregateMutation,
    creditedProgress: row.creditedProgress,
    consent: row.consent,
    acceptedSnapshot: row.acceptedSnapshot,
    incubation: row.incubation,
    hatchEligibility: row.hatchEligibility,
    reasonId: closed<BreedingParentSourceChangeReasonIdV1>(row.reasonId, reasons, `${path}.reasonId`),
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('breeding.parent-change.invalid-invariant', path, 'checkpoint dispositions must match the closed policy matrix exactly.')
  }
  return Object.freeze({
    schemaVersion: 1,
    changeId: row.changeId as BreedingParentSourceChangeImpactV1['changeId'],
    changeDefinitionSha256: hash(row.changeDefinitionSha256, `${path}.changeDefinitionSha256`),
    changeKind: closed<BreedingParentSourceChangeKindV1>(row.changeKind, changeKinds, `${path}.changeKind`),
    aggregateKind,
    aggregateId: row.aggregateId as BreedingParentSourceChangeImpactV1['aggregateId'],
    aggregateRevision: integer(row.aggregateRevision, `${path}.aggregateRevision`),
    parentIndex,
    checkpoint,
    ...expected,
    evaluatedAtCampaignMinute: integer(row.evaluatedAtCampaignMinute, `${path}.evaluatedAtCampaignMinute`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
