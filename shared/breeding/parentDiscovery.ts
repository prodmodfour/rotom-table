import { isSlug } from '../paths'
import {
  parseBreedingSpeciesIdSyntax,
  type BreedingSpeciesId,
} from './ids'

export const BREEDING_PARENT_DISCOVERY_SCHEMA_VERSION = 1 as const
export const BREEDING_PARENT_ROSTER_FIELDS = Object.freeze([
  'boxed-pokemon',
  'current-team',
] as const)
export const BREEDING_PARENT_CANDIDATE_REASON_IDS = Object.freeze([
  'breeding.parent-discovery.gender-mismatch',
  'breeding.parent-discovery.gender-unresolved',
  'breeding.parent-discovery.sheet-invalid',
  'breeding.parent-discovery.sheet-unavailable',
  'breeding.parent-discovery.species-not-breedable',
  'breeding.parent-discovery.species-spec-unavailable',
  'breeding.parent-discovery.species-unresolved',
] as const)
export const BREEDING_PARENT_PREVIEW_REASON_IDS = Object.freeze([
  'breeding.compatibility.ditto-pair',
  'breeding.compatibility.gender-mismatch',
  'breeding.compatibility.genderless-unavailable',
  'breeding.compatibility.invalid-parent-facts',
  'breeding.compatibility.maturity-level-low',
  'breeding.compatibility.no-shared-egg-group',
  'breeding.compatibility.not-breedable',
  'breeding.compatibility.role-override-invalid',
  'breeding.compatibility.role-override-not-allowed',
  'breeding.compatibility.role-override-required',
  'breeding.compatibility.same-parent',
  'breeding.compatibility.same-sex-unavailable',
  'breeding.compatibility.spec-unavailable',
  'breeding.parent-preview.candidate-unavailable',
] as const)
export const BREEDING_PARENT_REQUIRED_VALIDATION_IDS = Object.freeze([
  'breeding.parent-validation.compatibility',
  'breeding.parent-validation.consent',
  'breeding.parent-validation.current-revisions',
  'breeding.parent-validation.location-facility',
  'breeding.parent-validation.maturity',
  'breeding.parent-validation.ownership-control',
] as const)
export type BreedingParentRosterField = typeof BREEDING_PARENT_ROSTER_FIELDS[number]
export type BreedingParentCandidateReasonId = typeof BREEDING_PARENT_CANDIDATE_REASON_IDS[number]
export type BreedingParentPreviewReasonId = typeof BREEDING_PARENT_PREVIEW_REASON_IDS[number]
export type BreedingParentRequiredValidationId = typeof BREEDING_PARENT_REQUIRED_VALIDATION_IDS[number]
export type BreedingParentGenderId = 'female' | 'genderless' | 'male'

export interface BreedingParentDiscoveryFilterV1 {
  readonly schemaVersion: 1
  readonly trainerSheetSlug: string | null
  readonly rosterFields: readonly BreedingParentRosterField[]
  readonly availability: 'all' | 'selectable' | 'unavailable'
  readonly speciesIds: readonly BreedingSpeciesId[]
}
export interface BreedingParentSelectionRefV1 {
  readonly pokemonSheetSlug: string
  readonly expectedSheetRevision: number
}
export interface BreedingParentSelectionV1 {
  readonly schemaVersion: 1
  readonly parentRefs: readonly BreedingParentSelectionRefV1[]
}
export interface BreedingParentCandidateAvailabilityV1 {
  readonly status: 'selectable' | 'unavailable'
  readonly reasonIds: readonly BreedingParentCandidateReasonId[]
}
export interface BreedingParentCandidateV1 {
  readonly parentSheetSlug: string
  readonly parentSheetRevision: number | null
  readonly ownerTrainerSlug: string
  readonly ownerTrainerRevision: number
  readonly rosterField: BreedingParentRosterField
  readonly label: string
  readonly speciesId: BreedingSpeciesId | null
  readonly genderId: BreedingParentGenderId | null
  readonly level: number | null
  readonly availability: BreedingParentCandidateAvailabilityV1
}
export interface BreedingParentTrainerCandidatesV1 {
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
  readonly candidates: readonly BreedingParentCandidateV1[]
}
export interface BreedingParentCompatibilityPreviewV1 {
  readonly previewId: string
  readonly status: 'requires-validation' | 'unavailable'
  readonly reasonIds: readonly BreedingParentPreviewReasonId[]
  readonly requiredValidationIds: readonly BreedingParentRequiredValidationId[]
}
export interface BreedingParentDiscoveryProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly generatedAtCampaignMinute: number
  readonly trainerSheets: readonly BreedingParentTrainerCandidatesV1[]
  readonly selectedParentRefs: readonly BreedingParentSelectionRefV1[]
  readonly compatibilityPreview: BreedingParentCompatibilityPreviewV1 | null
}

export type BreedingParentDiscoveryValidationCode =
  | 'breeding.parent-discovery.invalid-document'
  | 'breeding.parent-discovery.unknown-field'
  | 'breeding.parent-discovery.invalid-id'
  | 'breeding.parent-discovery.invalid-invariant'
export class BreedingParentDiscoveryValidationError extends Error {
  readonly code: BreedingParentDiscoveryValidationCode
  readonly path: string
  constructor(code: BreedingParentDiscoveryValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingParentDiscoveryValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const PREVIEW_ID = /^breeding-parent-preview:v1:[0-9a-f]{32}$/u
const CANDIDATE_REASONS = new Set<string>(BREEDING_PARENT_CANDIDATE_REASON_IDS)
const PREVIEW_REASONS = new Set<string>(BREEDING_PARENT_PREVIEW_REASON_IDS)
const VALIDATIONS = new Set<string>(BREEDING_PARENT_REQUIRED_VALIDATION_IDS)
const ROSTER_FIELDS = new Set<string>(BREEDING_PARENT_ROSTER_FIELDS)
const GENDERS = new Set<string>(['female', 'genderless', 'male'])
const fail = (code: BreedingParentDiscoveryValidationCode, path: string, message: string): never => {
  throw new BreedingParentDiscoveryValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.parent-discovery.invalid-document', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.parent-discovery.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.parent-discovery.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    fail('breeding.parent-discovery.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.parent-discovery.invalid-document', path, `must be a plain array of at most ${maximum} entries.`)
  }
  if (Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.parent-discovery.unknown-field', path, 'cannot be sparse or enriched.')
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.parent-discovery.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
    }
  }
  return value
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return fail('breeding.parent-discovery.invalid-document', path, 'must be a nonnegative safe integer.')
  }
  return Number(value)
}
const slug = (value: unknown, path: string): string => isSlug(value)
  ? value
  : fail('breeding.parent-discovery.invalid-id', path, 'must be a sheet slug.')
const sortedUnique = <Value extends string>(values: Value[], path: string): readonly Value[] => {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      fail('breeding.parent-discovery.invalid-invariant', path, 'must be unique in code-point order.')
    }
  }
  return Object.freeze(values)
}
const label = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length < 1 || Array.from(value).length > 80
    || value.normalize('NFKC') !== value || value.trim() !== value
    || /[<>\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    return fail('breeding.parent-discovery.invalid-document', path, 'must be 1-80 safe normalized display characters.')
  }
  return value
}
const freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
    Object.freeze(value)
  }
  return value
}
const selectionRef = (value: unknown, path: string): BreedingParentSelectionRefV1 => {
  const row = exact(value, ['pokemonSheetSlug', 'expectedSheetRevision'], path)
  return freeze({
    pokemonSheetSlug: slug(row.pokemonSheetSlug, `${path}.pokemonSheetSlug`),
    expectedSheetRevision: integer(row.expectedSheetRevision, `${path}.expectedSheetRevision`),
  })
}
const selectionRefs = (value: unknown, path: string): readonly BreedingParentSelectionRefV1[] => {
  const values = array(value, path, 2).map((entry, index) => selectionRef(entry, `${path}[${index}]`))
  if (new Set(values.map(entry => entry.pokemonSheetSlug)).size !== values.length) {
    fail('breeding.parent-discovery.invalid-invariant', path, 'cannot select one parent twice.')
  }
  return Object.freeze(values)
}

export const parseBreedingParentDiscoveryFilterV1 = (
  value: unknown,
  path = 'breedingParentDiscoveryFilter',
): BreedingParentDiscoveryFilterV1 => {
  const row = exact(value, ['schemaVersion', 'trainerSheetSlug', 'rosterFields', 'availability', 'speciesIds'], path)
  if (row.schemaVersion !== 1 || (row.availability !== 'all'
    && row.availability !== 'selectable' && row.availability !== 'unavailable')) {
    fail('breeding.parent-discovery.invalid-document', path, 'must be a schema-v1 discovery filter.')
  }
  const rosterFields = sortedUnique(array(row.rosterFields, `${path}.rosterFields`, 2)
    .map((entry, index) => typeof entry === 'string' && ROSTER_FIELDS.has(entry)
      ? entry as BreedingParentRosterField
      : fail('breeding.parent-discovery.invalid-document', `${path}.rosterFields[${index}]`, 'must be a roster field.')), `${path}.rosterFields`)
  if (rosterFields.length < 1) {
    fail('breeding.parent-discovery.invalid-invariant', `${path}.rosterFields`, 'must include at least one roster field.')
  }
  const speciesIds = sortedUnique(array(row.speciesIds, `${path}.speciesIds`, 32)
    .map((entry, index) => parseBreedingSpeciesIdSyntax(entry)
      ?? fail('breeding.parent-discovery.invalid-id', `${path}.speciesIds[${index}]`, 'must be a canonical Species ID.')), `${path}.speciesIds`)
  return freeze({
    schemaVersion: 1,
    trainerSheetSlug: row.trainerSheetSlug === null ? null : slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    rosterFields,
    availability: row.availability as BreedingParentDiscoveryFilterV1['availability'],
    speciesIds,
  })
}

export const parseBreedingParentSelectionV1 = (
  value: unknown,
  path = 'breedingParentSelection',
): BreedingParentSelectionV1 => {
  const row = exact(value, ['schemaVersion', 'parentRefs'], path)
  if (row.schemaVersion !== 1) {
    fail('breeding.parent-discovery.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  }
  return freeze({ schemaVersion: 1, parentRefs: selectionRefs(row.parentRefs, `${path}.parentRefs`) })
}

const candidate = (value: unknown, path: string): BreedingParentCandidateV1 => {
  const row = exact(value, [
    'parentSheetSlug', 'parentSheetRevision', 'ownerTrainerSlug', 'ownerTrainerRevision',
    'rosterField', 'label', 'speciesId', 'genderId', 'level', 'availability',
  ], path)
  if (typeof row.rosterField !== 'string' || !ROSTER_FIELDS.has(row.rosterField)) {
    fail('breeding.parent-discovery.invalid-document', `${path}.rosterField`, 'must be a roster field.')
  }
  const availability = exact(row.availability, ['status', 'reasonIds'], `${path}.availability`)
  if (availability.status !== 'selectable' && availability.status !== 'unavailable') {
    fail('breeding.parent-discovery.invalid-document', `${path}.availability.status`, 'must be selectable or unavailable.')
  }
  const reasonIds = sortedUnique(array(availability.reasonIds, `${path}.availability.reasonIds`, CANDIDATE_REASONS.size)
    .map((entry, index) => typeof entry === 'string' && CANDIDATE_REASONS.has(entry)
      ? entry as BreedingParentCandidateReasonId
      : fail('breeding.parent-discovery.invalid-document', `${path}.availability.reasonIds[${index}]`, 'must be a safe candidate reason.')), `${path}.availability.reasonIds`)
  if ((availability.status === 'selectable') !== (reasonIds.length === 0)) {
    fail('breeding.parent-discovery.invalid-invariant', `${path}.availability`, 'selectable alone has no unavailable reasons.')
  }
  const speciesId = row.speciesId === null ? null : parseBreedingSpeciesIdSyntax(row.speciesId)
    ?? fail('breeding.parent-discovery.invalid-id', `${path}.speciesId`, 'must be a canonical Species ID.')
  const genderId = row.genderId === null ? null
    : typeof row.genderId === 'string' && GENDERS.has(row.genderId)
      ? row.genderId as BreedingParentGenderId
      : fail('breeding.parent-discovery.invalid-document', `${path}.genderId`, 'must be a parent Gender ID.')
  const levelValue = row.level === null ? null : integer(row.level, `${path}.level`)
  if (levelValue !== null && (levelValue < 1 || levelValue > 100)) {
    fail('breeding.parent-discovery.invalid-invariant', `${path}.level`, 'must be Level 1-100.')
  }
  const revision = row.parentSheetRevision === null ? null : integer(row.parentSheetRevision, `${path}.parentSheetRevision`)
  if (revision === null && !reasonIds.includes('breeding.parent-discovery.sheet-unavailable')) {
    fail('breeding.parent-discovery.invalid-invariant', path, 'missing sheets require the safe unavailable reason.')
  }
  if (availability.status === 'selectable'
    && (revision === null || speciesId === null || genderId === null || levelValue === null)) {
    fail('breeding.parent-discovery.invalid-invariant', path, 'selectable candidates require complete current safe facts.')
  }
  if (reasonIds.includes('breeding.parent-discovery.sheet-unavailable')
    && (revision !== null || speciesId !== null || genderId !== null || levelValue !== null)) {
    fail('breeding.parent-discovery.invalid-invariant', path, 'unavailable missing sheets cannot project inferred mechanics.')
  }
  return freeze({
    parentSheetSlug: slug(row.parentSheetSlug, `${path}.parentSheetSlug`),
    parentSheetRevision: revision,
    ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`),
    ownerTrainerRevision: integer(row.ownerTrainerRevision, `${path}.ownerTrainerRevision`),
    rosterField: row.rosterField as BreedingParentRosterField,
    label: label(row.label, `${path}.label`),
    speciesId,
    genderId,
    level: levelValue,
    availability: {
      status: availability.status as BreedingParentCandidateAvailabilityV1['status'],
      reasonIds,
    },
  })
}

export const parseBreedingParentDiscoveryProjectionV1 = (
  value: unknown,
  path = 'breedingParentDiscoveryProjection',
): BreedingParentDiscoveryProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'generatedAtCampaignMinute', 'trainerSheets',
    'selectedParentRefs', 'compatibilityPreview',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner')) {
    fail('breeding.parent-discovery.invalid-document', path, 'must be a schema-v1 owner or GM projection.')
  }
  const trainerSheets = array(row.trainerSheets, `${path}.trainerSheets`, 64).map((entry, index) => {
    const trainerPath = `${path}.trainerSheets[${index}]`
    const trainer = exact(entry, ['trainerSheetSlug', 'trainerSheetRevision', 'candidates'], trainerPath)
    const trainerSlug = slug(trainer.trainerSheetSlug, `${trainerPath}.trainerSheetSlug`)
    const trainerRevision = integer(trainer.trainerSheetRevision, `${trainerPath}.trainerSheetRevision`)
    const candidates = array(trainer.candidates, `${trainerPath}.candidates`, 512)
      .map((candidateValue, candidateIndex) => candidate(candidateValue, `${trainerPath}.candidates[${candidateIndex}]`))
    if (candidates.some(value => value.ownerTrainerSlug !== trainerSlug || value.ownerTrainerRevision !== trainerRevision)) {
      fail('breeding.parent-discovery.invalid-invariant', `${trainerPath}.candidates`, 'must belong to this exact Trainer revision.')
    }
    sortedUnique(candidates.map(value => `${value.rosterField}\u0000${value.parentSheetSlug}`), `${trainerPath}.candidates`)
    return freeze({ trainerSheetSlug: trainerSlug, trainerSheetRevision: trainerRevision, candidates: Object.freeze(candidates) })
  })
  sortedUnique(trainerSheets.map(value => value.trainerSheetSlug), `${path}.trainerSheets`)
  const selectedParentRefs = selectionRefs(row.selectedParentRefs, `${path}.selectedParentRefs`)
  const visibleCandidates = trainerSheets.flatMap(trainer => trainer.candidates)
  if (new Set(visibleCandidates.map(value => value.parentSheetSlug)).size !== visibleCandidates.length) {
    fail('breeding.parent-discovery.invalid-invariant', `${path}.trainerSheets`, 'cannot project one parent through multiple ownership links.')
  }
  const visible = new Map(visibleCandidates.map(value => [value.parentSheetSlug, value] as const))
  if (selectedParentRefs.some(ref => visible.get(ref.pokemonSheetSlug)?.parentSheetRevision !== ref.expectedSheetRevision)) {
    fail('breeding.parent-discovery.invalid-invariant', `${path}.selectedParentRefs`, 'must identify exact visible current candidate revisions.')
  }
  let compatibilityPreview: BreedingParentCompatibilityPreviewV1 | null = null
  if (row.compatibilityPreview !== null) {
    const preview = exact(row.compatibilityPreview, ['previewId', 'status', 'reasonIds', 'requiredValidationIds'], `${path}.compatibilityPreview`)
    if (selectedParentRefs.length !== 2 || typeof preview.previewId !== 'string' || !PREVIEW_ID.test(preview.previewId)
      || (preview.status !== 'requires-validation' && preview.status !== 'unavailable')) {
      fail('breeding.parent-discovery.invalid-document', `${path}.compatibilityPreview`, 'must be a selected-pair preview.')
    }
    const reasonIds = sortedUnique(array(preview.reasonIds, `${path}.compatibilityPreview.reasonIds`, PREVIEW_REASONS.size)
      .map((entry, index) => typeof entry === 'string' && PREVIEW_REASONS.has(entry)
        ? entry as BreedingParentPreviewReasonId
        : fail('breeding.parent-discovery.invalid-document', `${path}.compatibilityPreview.reasonIds[${index}]`, 'must be a safe preview reason.')), `${path}.compatibilityPreview.reasonIds`)
    const requiredValidationIds = sortedUnique(array(preview.requiredValidationIds, `${path}.compatibilityPreview.requiredValidationIds`, VALIDATIONS.size)
      .map((entry, index) => typeof entry === 'string' && VALIDATIONS.has(entry)
        ? entry as BreedingParentRequiredValidationId
        : fail('breeding.parent-discovery.invalid-document', `${path}.compatibilityPreview.requiredValidationIds[${index}]`, 'must be a validation ID.')), `${path}.compatibilityPreview.requiredValidationIds`)
    if (requiredValidationIds.length !== VALIDATIONS.size
      || (preview.status === 'requires-validation') !== (reasonIds.length === 0)) {
      fail('breeding.parent-discovery.invalid-invariant', `${path}.compatibilityPreview`, 'must retain every final validation and reasons only when unavailable.')
    }
    compatibilityPreview = freeze({
      previewId: preview.previewId as string,
      status: preview.status as BreedingParentCompatibilityPreviewV1['status'],
      reasonIds,
      requiredValidationIds,
    })
  }
  else if (selectedParentRefs.length === 2) {
    fail('breeding.parent-discovery.invalid-invariant', `${path}.compatibilityPreview`, 'a selected pair requires one safe compatibility preview.')
  }
  return freeze({
    schemaVersion: 1,
    audience: row.audience as BreedingParentDiscoveryProjectionV1['audience'],
    generatedAtCampaignMinute: integer(row.generatedAtCampaignMinute, `${path}.generatedAtCampaignMinute`),
    trainerSheets: Object.freeze(trainerSheets),
    selectedParentRefs,
    compatibilityPreview,
  })
}
