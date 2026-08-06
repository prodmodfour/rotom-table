import { isSlug } from '../paths'
import { BREEDING_AUTHORIZATION_REASON_IDS } from './authorization'
import {
  parseBreedingAdjudicationIdSyntax,
  parseBreedingEggGroupIdSyntax,
  parseBreedingOperationIdSyntax,
  parseBreedingSpeciesIdSyntax,
  type BreedingAdjudicationId,
  type BreedingEggGroupId,
  type BreedingOperationId,
  type BreedingSpeciesId,
} from './ids'

export const BREEDING_PROJECT_PARENT_FACTS_SCHEMA_VERSION = 1 as const
export const BREEDING_PROJECT_SETUP_VALIDATION_SCHEMA_VERSION = 1 as const
export const BREEDING_PROJECT_SETUP_REASON_IDS = Object.freeze([
  ...BREEDING_AUTHORIZATION_REASON_IDS.filter(reason => reason !== 'breeding.authorization.authorized'),
  'breeding.setup.awaiting-consent',
  'breeding.setup.compatibility-unavailable',
  'breeding.setup.facility-unsupported',
  'breeding.setup.maturity-level-low',
  'breeding.setup.maturity-unconfirmed',
  'breeding.setup.parent-facts-stale',
  'breeding.setup.role-adjudication-required',
] as const)
export const BREEDING_PROJECT_SETUP_COMPATIBILITY_REASON_IDS = Object.freeze([
  'breeding.compatibility.ditto-pair',
  'breeding.compatibility.gender-mismatch',
  'breeding.compatibility.genderless-unavailable',
  'breeding.compatibility.invalid-parent-facts',
  'breeding.compatibility.maturity-level-low',
  'breeding.compatibility.maturity-unconfirmed',
  'breeding.compatibility.no-shared-egg-group',
  'breeding.compatibility.not-breedable',
  'breeding.compatibility.role-override-invalid',
  'breeding.compatibility.role-override-not-allowed',
  'breeding.compatibility.role-override-required',
  'breeding.compatibility.same-parent',
  'breeding.compatibility.same-sex-unavailable',
  'breeding.compatibility.spec-unavailable',
] as const)
export type BreedingProjectSetupReasonId = typeof BREEDING_PROJECT_SETUP_REASON_IDS[number]
export type BreedingProjectSetupCompatibilityReasonId = typeof BREEDING_PROJECT_SETUP_COMPATIBILITY_REASON_IDS[number]
export type BreedingProjectSetupCheckStatus = 'awaiting' | 'not-evaluated' | 'satisfied' | 'unavailable'

export interface BreedingProjectParentFactsV1 {
  readonly schemaVersion: 1
  readonly parentSheetSlug: string
  readonly parentSheetRevision: number
  readonly parentSheetDefinitionSha256: string
  readonly speciesId: BreedingSpeciesId
  readonly speciesSpecDefinitionSha256: string
  readonly genderId: 'female' | 'genderless' | 'male'
  readonly level: number
  readonly eggGroupIds: readonly BreedingEggGroupId[]
  readonly capturedAtCampaignMinute: number
  readonly definitionSha256: string
}
export interface BreedingProjectSetupValidationChecksV1 {
  readonly ownership: BreedingProjectSetupCheckStatus
  readonly consent: BreedingProjectSetupCheckStatus
  readonly maturity: BreedingProjectSetupCheckStatus
  readonly locationFacility: BreedingProjectSetupCheckStatus
  readonly compatibility: BreedingProjectSetupCheckStatus
}
export interface BreedingProjectSetupCompatibilityV1 {
  readonly status: 'compatible' | 'not-evaluated' | 'unavailable'
  readonly compatibilityKind: 'canonical-ditto' | 'conventional' | 'gm-role-override' | null
  readonly reasonIds: readonly BreedingProjectSetupCompatibilityReasonId[]
}
export interface BreedingProjectSetupValidationV1 {
  readonly schemaVersion: 1
  readonly operationId: BreedingOperationId
  readonly commandSha256: string
  readonly commandKind: 'create-breeding-project' | 'preview-breeding'
  readonly status: 'awaiting-consent' | 'ready' | 'unavailable'
  readonly reasonIds: readonly BreedingProjectSetupReasonId[]
  readonly checks: BreedingProjectSetupValidationChecksV1
  readonly compatibility: BreedingProjectSetupCompatibilityV1
  readonly authorizationReceiptDefinitionSha256: string
  readonly parentFactsDefinitionHashes: readonly string[]
  readonly maturityAdjudicationIds: readonly BreedingAdjudicationId[]
  readonly roleAdjudicationId: BreedingAdjudicationId | null
  readonly campaignOptionSnapshotDefinitionSha256: string
  readonly compatibilityPolicyDefinitionSha256: string
  readonly locationPolicyId: 'campaign-workshop-off-map-v1'
  readonly facilityId: null
  readonly evaluatedAtCampaignMinute: number
  readonly definitionSha256: string
}
export interface BreedingProjectSetupValidationProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly status: BreedingProjectSetupValidationV1['status']
  readonly reasonIds: readonly BreedingProjectSetupReasonId[]
  readonly checks: BreedingProjectSetupValidationChecksV1
  readonly compatibility: BreedingProjectSetupCompatibilityV1
  readonly locationPolicyId: 'campaign-workshop-off-map-v1'
  readonly facilityId: null
}

export type BreedingProjectSetupValidationCode =
  | 'breeding.setup.invalid-document'
  | 'breeding.setup.unknown-field'
  | 'breeding.setup.invalid-id'
  | 'breeding.setup.invalid-invariant'
export class BreedingProjectSetupValidationError extends Error {
  readonly code: BreedingProjectSetupValidationCode
  readonly path: string
  constructor(code: BreedingProjectSetupValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingProjectSetupValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const GENDERS = new Set<string>(['female', 'genderless', 'male'])
const SETUP_REASONS = new Set<string>(BREEDING_PROJECT_SETUP_REASON_IDS)
const COMPATIBILITY_REASONS = new Set<string>(BREEDING_PROJECT_SETUP_COMPATIBILITY_REASON_IDS)
const CHECK_STATUSES = new Set<string>(['awaiting', 'not-evaluated', 'satisfied', 'unavailable'])
const fail = (code: BreedingProjectSetupValidationCode, path: string, message: string): never => {
  throw new BreedingProjectSetupValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.setup.invalid-document', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.setup.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.setup.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    fail('breeding.setup.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.setup.invalid-document', path, `must be a plain non-enriched array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.setup.invalid-document', `${path}[${index}]`, 'must be an enumerable data field.')
    }
  }
  return value
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return fail('breeding.setup.invalid-document', path, 'must be a nonnegative safe integer.')
  }
  return Number(value)
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.setup.invalid-document', path, 'must be a lowercase SHA-256 digest.')
const sortedUnique = <Value extends string>(values: Value[], path: string): readonly Value[] => {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      fail('breeding.setup.invalid-invariant', path, 'must be unique in code-point order.')
    }
  }
  return Object.freeze(values)
}
const freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export const parseBreedingProjectParentFactsV1 = (
  value: unknown,
  path = 'breedingProjectParentFacts',
): BreedingProjectParentFactsV1 => {
  const row = exact(value, [
    'schemaVersion', 'parentSheetSlug', 'parentSheetRevision', 'parentSheetDefinitionSha256',
    'speciesId', 'speciesSpecDefinitionSha256', 'genderId', 'level', 'eggGroupIds',
    'capturedAtCampaignMinute', 'definitionSha256',
  ], path)
  const speciesId = parseBreedingSpeciesIdSyntax(row.speciesId)
    ?? fail('breeding.setup.invalid-id', `${path}.speciesId`, 'must be a canonical Species ID.')
  if (row.schemaVersion !== 1 || !isSlug(row.parentSheetSlug)
    || typeof row.genderId !== 'string' || !GENDERS.has(row.genderId)) {
    fail('breeding.setup.invalid-document', path, 'must be schema-v1 canonical parent facts.')
  }
  const level = integer(row.level, `${path}.level`)
  if (level < 1 || level > 100) fail('breeding.setup.invalid-invariant', `${path}.level`, 'must be Level 1-100.')
  const eggGroupIds = sortedUnique(array(row.eggGroupIds, `${path}.eggGroupIds`, 2)
    .map((entry, index) => parseBreedingEggGroupIdSyntax(entry)
      ?? fail('breeding.setup.invalid-id', `${path}.eggGroupIds[${index}]`, 'must be a canonical Egg Group ID.')), `${path}.eggGroupIds`)
  if (eggGroupIds.length < 1) fail('breeding.setup.invalid-invariant', `${path}.eggGroupIds`, 'cannot be empty.')
  return freeze({
    schemaVersion: 1,
    parentSheetSlug: row.parentSheetSlug as string,
    parentSheetRevision: integer(row.parentSheetRevision, `${path}.parentSheetRevision`),
    parentSheetDefinitionSha256: hash(row.parentSheetDefinitionSha256, `${path}.parentSheetDefinitionSha256`),
    speciesId,
    speciesSpecDefinitionSha256: hash(row.speciesSpecDefinitionSha256, `${path}.speciesSpecDefinitionSha256`),
    genderId: row.genderId as BreedingProjectParentFactsV1['genderId'],
    level,
    eggGroupIds,
    capturedAtCampaignMinute: integer(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
const checks = (value: unknown, path: string): BreedingProjectSetupValidationChecksV1 => {
  const row = exact(value, ['ownership', 'consent', 'maturity', 'locationFacility', 'compatibility'], path)
  for (const field of ['ownership', 'consent', 'maturity', 'locationFacility', 'compatibility'] as const) {
    if (typeof row[field] !== 'string' || !CHECK_STATUSES.has(row[field] as string)) {
      fail('breeding.setup.invalid-document', `${path}.${field}`, 'must be a setup check status.')
    }
  }
  return freeze(row as unknown as BreedingProjectSetupValidationChecksV1)
}
const compatibility = (value: unknown, path: string): BreedingProjectSetupCompatibilityV1 => {
  const row = exact(value, ['status', 'compatibilityKind', 'reasonIds'], path)
  if (row.status !== 'compatible' && row.status !== 'not-evaluated' && row.status !== 'unavailable') {
    fail('breeding.setup.invalid-document', `${path}.status`, 'must be a compatibility status.')
  }
  if (row.compatibilityKind !== null && row.compatibilityKind !== 'canonical-ditto'
    && row.compatibilityKind !== 'conventional' && row.compatibilityKind !== 'gm-role-override') {
    fail('breeding.setup.invalid-document', `${path}.compatibilityKind`, 'must be a compatibility kind.')
  }
  const reasonIds = sortedUnique(array(row.reasonIds, `${path}.reasonIds`, COMPATIBILITY_REASONS.size)
    .map((entry, index) => typeof entry === 'string' && COMPATIBILITY_REASONS.has(entry)
      ? entry as BreedingProjectSetupCompatibilityReasonId
      : fail('breeding.setup.invalid-document', `${path}.reasonIds[${index}]`, 'must be a compatibility reason.')), `${path}.reasonIds`)
  if ((row.status === 'compatible') !== (row.compatibilityKind !== null)
    || (row.status === 'unavailable') !== (reasonIds.length > 0)) {
    fail('breeding.setup.invalid-invariant', path, 'compatible has one kind, unavailable has reasons, and not-evaluated has neither.')
  }
  return freeze({
    status: row.status as BreedingProjectSetupCompatibilityV1['status'],
    compatibilityKind: row.compatibilityKind as BreedingProjectSetupCompatibilityV1['compatibilityKind'],
    reasonIds,
  })
}
const reasonIds = (value: unknown, path: string): readonly BreedingProjectSetupReasonId[] => sortedUnique(
  array(value, path, SETUP_REASONS.size).map((entry, index) => (
    typeof entry === 'string' && SETUP_REASONS.has(entry)
      ? entry as BreedingProjectSetupReasonId
      : fail('breeding.setup.invalid-document', `${path}[${index}]`, 'must be a setup reason.')
  )),
  path,
)
const validateOutcome = (
  status: BreedingProjectSetupValidationV1['status'],
  reasons: readonly BreedingProjectSetupReasonId[],
  parsedChecks: BreedingProjectSetupValidationChecksV1,
  parsedCompatibility: BreedingProjectSetupCompatibilityV1,
  path: string,
): void => {
  if (status === 'ready') {
    if (reasons.length !== 0 || Object.values(parsedChecks).some(check => check !== 'satisfied')
      || parsedCompatibility.status !== 'compatible') {
      fail('breeding.setup.invalid-invariant', path, 'ready requires every satisfied check and one compatible result.')
    }
    return
  }
  if (reasons.length === 0) fail('breeding.setup.invalid-invariant', path, 'non-ready outcomes require a bounded reason.')
  if (status === 'awaiting-consent') {
    if (!reasons.includes('breeding.setup.awaiting-consent')
      || parsedChecks.ownership !== 'satisfied' || parsedChecks.consent !== 'awaiting'
      || parsedChecks.maturity !== 'not-evaluated' || parsedChecks.locationFacility !== 'not-evaluated'
      || parsedChecks.compatibility !== 'not-evaluated' || parsedCompatibility.status !== 'not-evaluated') {
      fail('breeding.setup.invalid-invariant', path, 'awaiting consent cannot evaluate private downstream mechanics.')
    }
    return
  }
  if (!Object.values(parsedChecks).includes('unavailable')) {
    fail('breeding.setup.invalid-invariant', path, 'unavailable requires at least one unavailable check.')
  }
}

export const parseBreedingProjectSetupValidationV1 = (
  value: unknown,
  path = 'breedingProjectSetupValidation',
): BreedingProjectSetupValidationV1 => {
  const row = exact(value, [
    'schemaVersion', 'operationId', 'commandSha256', 'commandKind', 'status', 'reasonIds',
    'checks', 'compatibility', 'authorizationReceiptDefinitionSha256',
    'parentFactsDefinitionHashes', 'maturityAdjudicationIds', 'roleAdjudicationId',
    'campaignOptionSnapshotDefinitionSha256', 'compatibilityPolicyDefinitionSha256',
    'locationPolicyId', 'facilityId', 'evaluatedAtCampaignMinute', 'definitionSha256',
  ], path)
  const status = row.status
  if (row.schemaVersion !== 1
    || (row.commandKind !== 'create-breeding-project' && row.commandKind !== 'preview-breeding')
    || (status !== 'awaiting-consent' && status !== 'ready' && status !== 'unavailable')
    || row.locationPolicyId !== 'campaign-workshop-off-map-v1' || row.facilityId !== null) {
    fail('breeding.setup.invalid-document', path, 'must be a schema-v1 off-map project setup validation.')
  }
  const parsedReasons = reasonIds(row.reasonIds, `${path}.reasonIds`)
  const parsedChecks = checks(row.checks, `${path}.checks`)
  const parsedCompatibility = compatibility(row.compatibility, `${path}.compatibility`)
  const parentHashes = array(row.parentFactsDefinitionHashes, `${path}.parentFactsDefinitionHashes`, 2)
    .map((entry, index) => hash(entry, `${path}.parentFactsDefinitionHashes[${index}]`))
  if (parentHashes.length !== 0 && parentHashes.length !== 2) {
    fail('breeding.setup.invalid-invariant', `${path}.parentFactsDefinitionHashes`, 'must bind either no private facts or both ordered parents.')
  }
  const maturityIds = sortedUnique(array(row.maturityAdjudicationIds, `${path}.maturityAdjudicationIds`, 2)
    .map((entry, index) => parseBreedingAdjudicationIdSyntax(entry)
      ?? fail('breeding.setup.invalid-id', `${path}.maturityAdjudicationIds[${index}]`, 'must be an adjudication ID.')), `${path}.maturityAdjudicationIds`)
  const roleAdjudicationId = row.roleAdjudicationId === null ? null
    : parseBreedingAdjudicationIdSyntax(row.roleAdjudicationId)
      ?? fail('breeding.setup.invalid-id', `${path}.roleAdjudicationId`, 'must be an adjudication ID.')
  validateOutcome(
    status as BreedingProjectSetupValidationV1['status'],
    parsedReasons,
    parsedChecks,
    parsedCompatibility,
    path,
  )
  if (status === 'ready' && parentHashes.length !== 2) {
    fail('breeding.setup.invalid-invariant', `${path}.parentFactsDefinitionHashes`, 'ready authority must bind both parents.')
  }
  return freeze({
    schemaVersion: 1,
    operationId: parseBreedingOperationIdSyntax(row.operationId)
      ?? fail('breeding.setup.invalid-id', `${path}.operationId`, 'must be a Breeding operation ID.'),
    commandSha256: hash(row.commandSha256, `${path}.commandSha256`),
    commandKind: row.commandKind as BreedingProjectSetupValidationV1['commandKind'],
    status: status as BreedingProjectSetupValidationV1['status'],
    reasonIds: parsedReasons,
    checks: parsedChecks,
    compatibility: parsedCompatibility,
    authorizationReceiptDefinitionSha256: hash(row.authorizationReceiptDefinitionSha256, `${path}.authorizationReceiptDefinitionSha256`),
    parentFactsDefinitionHashes: Object.freeze(parentHashes),
    maturityAdjudicationIds: maturityIds,
    roleAdjudicationId,
    campaignOptionSnapshotDefinitionSha256: hash(row.campaignOptionSnapshotDefinitionSha256, `${path}.campaignOptionSnapshotDefinitionSha256`),
    compatibilityPolicyDefinitionSha256: hash(row.compatibilityPolicyDefinitionSha256, `${path}.compatibilityPolicyDefinitionSha256`),
    locationPolicyId: 'campaign-workshop-off-map-v1',
    facilityId: null,
    evaluatedAtCampaignMinute: integer(row.evaluatedAtCampaignMinute, `${path}.evaluatedAtCampaignMinute`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}

export const parseBreedingProjectSetupValidationProjectionV1 = (
  value: unknown,
  path = 'breedingProjectSetupValidationProjection',
): BreedingProjectSetupValidationProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'status', 'reasonIds', 'checks', 'compatibility',
    'locationPolicyId', 'facilityId',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner')
    || (row.status !== 'awaiting-consent' && row.status !== 'ready' && row.status !== 'unavailable')
    || row.locationPolicyId !== 'campaign-workshop-off-map-v1' || row.facilityId !== null) {
    fail('breeding.setup.invalid-document', path, 'must be a bounded owner or GM setup projection.')
  }
  const parsedReasons = reasonIds(row.reasonIds, `${path}.reasonIds`)
  const parsedChecks = checks(row.checks, `${path}.checks`)
  const parsedCompatibility = compatibility(row.compatibility, `${path}.compatibility`)
  validateOutcome(
    row.status as BreedingProjectSetupValidationV1['status'],
    parsedReasons,
    parsedChecks,
    parsedCompatibility,
    path,
  )
  return freeze({
    schemaVersion: 1,
    audience: row.audience,
    status: row.status,
    reasonIds: parsedReasons,
    checks: parsedChecks,
    compatibility: parsedCompatibility,
    locationPolicyId: 'campaign-workshop-off-map-v1',
    facilityId: null,
  }) as BreedingProjectSetupValidationProjectionV1
}
