import { isPokemonEggStatus, type PokemonEggStatus } from './egg'
import { parsePokemonEggIdSyntax, type PokemonEggId } from './ids'

export const POKEMON_EGG_LIFECYCLE_READINESS_STATES = Object.freeze([
  'not-ready', 'ready', 'hatch-started', 'hatched', 'terminal',
] as const)
export const POKEMON_EGG_LIFECYCLE_INCUBATION_DISPOSITIONS = Object.freeze([
  'active', 'explicitly-paused', 'complete', 'settled',
] as const)
export const POKEMON_EGG_LIFECYCLE_BLOCKER_REASON_IDS = Object.freeze([
  'breeding.egg-lifecycle.not-ready',
  'breeding.egg-lifecycle.hatch-already-started',
  'breeding.egg-lifecycle.already-hatched',
  'breeding.egg-lifecycle.cancelled',
  'breeding.egg-lifecycle.invalidated-by-gm',
] as const)
export const POKEMON_EGG_SOURCE_CONTINUITY_ROLES = Object.freeze([
  'origin', 'parent-0', 'parent-1', 'breeder',
] as const)
export const POKEMON_EGG_SOURCE_CONTINUITY_STATES = Object.freeze(['missing', 'changed'] as const)
export const POKEMON_EGG_CUSTODY_STATES = Object.freeze(['carried', 'stored'] as const)
export const POKEMON_EGG_EXTERNAL_LIFECYCLE_REASON_IDS = Object.freeze([
  'breeding.egg-lifecycle.storage-continues',
  'breeding.egg-lifecycle.source-loss-snapshot-preserved',
  'breeding.egg-lifecycle.facility-removed-base-rate-continues',
  'breeding.egg-lifecycle.facility-unsupported',
] as const)

export type PokemonEggLifecycleReadinessStateV1 = typeof POKEMON_EGG_LIFECYCLE_READINESS_STATES[number]
export type PokemonEggLifecycleIncubationDispositionV1 = typeof POKEMON_EGG_LIFECYCLE_INCUBATION_DISPOSITIONS[number]
export type PokemonEggLifecycleBlockerReasonIdV1 = typeof POKEMON_EGG_LIFECYCLE_BLOCKER_REASON_IDS[number]
export type PokemonEggSourceContinuityRoleV1 = typeof POKEMON_EGG_SOURCE_CONTINUITY_ROLES[number]
export type PokemonEggSourceContinuityStateV1 = typeof POKEMON_EGG_SOURCE_CONTINUITY_STATES[number]
export type PokemonEggCustodyStateV1 = typeof POKEMON_EGG_CUSTODY_STATES[number]
export type PokemonEggExternalLifecycleReasonIdV1 = typeof POKEMON_EGG_EXTERNAL_LIFECYCLE_REASON_IDS[number]

export interface PokemonEggLifecycleProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly eggId: PokemonEggId
  readonly revision: number
  readonly status: PokemonEggStatus
  readonly readinessState: PokemonEggLifecycleReadinessStateV1
  readonly incubationDisposition: PokemonEggLifecycleIncubationDispositionV1
  readonly canTransferBeforeHatch: boolean
  readonly canBeginHatch: boolean
  readonly transferPolicy: 'continues-incubation-and-preserves-readiness'
  readonly storagePolicy: 'continues-incubation-and-preserves-readiness'
  readonly facilityPolicy: 'base-rate-continues-provider-contribution-required'
  readonly sourceLossPolicy: 'frozen-snapshot-continues'
  readonly blockerReasonIds: readonly PokemonEggLifecycleBlockerReasonIdV1[]
  readonly generatedAtCampaignMinute: number
}

export type PokemonEggExternalLifecycleObservationV1 =
  | {
      readonly schemaVersion: 1
      readonly kind: 'custody-change'
      readonly custodyState: PokemonEggCustodyStateV1
    }
  | {
      readonly schemaVersion: 1
      readonly kind: 'source-continuity-loss'
      readonly sourceRole: PokemonEggSourceContinuityRoleV1
      readonly continuityState: PokemonEggSourceContinuityStateV1
    }
  | {
      readonly schemaVersion: 1
      readonly kind: 'facility-change'
      readonly facilityId: string | null
      readonly evidenceDefinitionSha256: string | null
    }

export interface PokemonEggExternalLifecycleEvaluationV1 {
  readonly schemaVersion: 1
  readonly eggId: PokemonEggId
  readonly eggRevision: number
  readonly observationKind: PokemonEggExternalLifecycleObservationV1['kind']
  readonly mutationRequired: false
  readonly incubationDisposition: 'preserve-current-explicit-state'
  readonly readinessDisposition: 'preserve'
  readonly hatchEligibilityDisposition: 'preserve-status-derived-eligibility'
  readonly facilityContributionDisposition: 'none' | 'unavailable'
  readonly reasonId: PokemonEggExternalLifecycleReasonIdV1
  readonly observedAtCampaignMinute: number
}

export type PokemonEggLifecycleValidationCode =
  | 'breeding.egg-lifecycle.invalid-document'
  | 'breeding.egg-lifecycle.unknown-field'
  | 'breeding.egg-lifecycle.invalid-id'
  | 'breeding.egg-lifecycle.invalid-invariant'

export class PokemonEggLifecycleValidationError extends Error {
  readonly code: PokemonEggLifecycleValidationCode
  readonly path: string

  constructor(code: PokemonEggLifecycleValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'PokemonEggLifecycleValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const readinessStates = new Set<string>(POKEMON_EGG_LIFECYCLE_READINESS_STATES)
const incubationDispositions = new Set<string>(POKEMON_EGG_LIFECYCLE_INCUBATION_DISPOSITIONS)
const blockerReasons = new Set<string>(POKEMON_EGG_LIFECYCLE_BLOCKER_REASON_IDS)
const sourceRoles = new Set<string>(POKEMON_EGG_SOURCE_CONTINUITY_ROLES)
const sourceStates = new Set<string>(POKEMON_EGG_SOURCE_CONTINUITY_STATES)
const custodyStates = new Set<string>(POKEMON_EGG_CUSTODY_STATES)
const externalReasons = new Set<string>(POKEMON_EGG_EXTERNAL_LIFECYCLE_REASON_IDS)

const fail = (code: PokemonEggLifecycleValidationCode, path: string, message: string): never => {
  throw new PokemonEggLifecycleValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.egg-lifecycle.invalid-document', path, 'must be a plain data object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.egg-lifecycle.invalid-document', path, 'must be a plain data object without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.egg-lifecycle.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    return fail('breeding.egg-lifecycle.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const array = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.egg-lifecycle.invalid-document', path, `must be a strict array of at most ${maximum} entries.`)
  }
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== value.length + 1 || names.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) {
    return fail('breeding.egg-lifecycle.invalid-document', path, 'must not be sparse or enriched.')
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.egg-lifecycle.invalid-document', path, 'must not be sparse or accessor-backed.')
    }
  }
  return value
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail('breeding.egg-lifecycle.invalid-document', path, 'must be a non-negative safe integer.')
  }
  return value as number
}
const boolean = (value: unknown, path: string): boolean => typeof value === 'boolean'
  ? value
  : fail('breeding.egg-lifecycle.invalid-document', path, 'must be a boolean.')
const oneOf = <Value extends string>(value: unknown, values: ReadonlySet<string>, path: string): Value => (
  typeof value === 'string' && values.has(value)
    ? value as Value
    : fail('breeding.egg-lifecycle.invalid-document', path, 'must be a closed v1 value.')
)
const sortedReasons = <Value extends string>(value: unknown, allowed: ReadonlySet<string>, path: string): readonly Value[] => {
  const values = array(value, path, allowed.size).map((entry, index) => oneOf<Value>(entry, allowed, `${path}[${index}]`))
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      return fail('breeding.egg-lifecycle.invalid-invariant', path, 'must be unique in strict code-point order.')
    }
  }
  return Object.freeze(values)
}
const assertLiteral = <Value extends string>(value: unknown, literal: Value, path: string): Value => value === literal
  ? literal
  : fail('breeding.egg-lifecycle.invalid-invariant', path, `must be ${literal}.`)
const nullableFacilityId = (value: unknown, path: string): string | null => value === null
  ? null
  : typeof value === 'string' && IDENTIFIER.test(value)
    ? value
    : fail('breeding.egg-lifecycle.invalid-id', path, 'must be null or a bounded stable identifier.')
const nullableHash = (value: unknown, path: string): string | null => value === null
  ? null
  : typeof value === 'string' && SHA256.test(value)
    ? value
    : fail('breeding.egg-lifecycle.invalid-document', path, 'must be null or a lowercase SHA-256 value.')

const expectedProjection = (status: PokemonEggStatus): {
  readonly readinessState: PokemonEggLifecycleReadinessStateV1
  readonly canTransferBeforeHatch: boolean
  readonly canBeginHatch: boolean
  readonly blockers: readonly PokemonEggLifecycleBlockerReasonIdV1[]
} => {
  if (status === 'incubating') return {
    readinessState: 'not-ready',
    canTransferBeforeHatch: true,
    canBeginHatch: false,
    blockers: Object.freeze(['breeding.egg-lifecycle.not-ready']),
  }
  if (status === 'ready') return {
    readinessState: 'ready',
    canTransferBeforeHatch: true,
    canBeginHatch: true,
    blockers: Object.freeze([]),
  }
  if (status === 'awaiting-special-adjudication' || status === 'hatching') return {
    readinessState: 'hatch-started',
    canTransferBeforeHatch: false,
    canBeginHatch: false,
    blockers: Object.freeze(['breeding.egg-lifecycle.hatch-already-started']),
  }
  if (status === 'hatched') return {
    readinessState: 'hatched',
    canTransferBeforeHatch: false,
    canBeginHatch: false,
    blockers: Object.freeze(['breeding.egg-lifecycle.already-hatched']),
  }
  return {
    readinessState: 'terminal',
    canTransferBeforeHatch: false,
    canBeginHatch: false,
    blockers: Object.freeze([
      status === 'cancelled'
        ? 'breeding.egg-lifecycle.cancelled'
        : 'breeding.egg-lifecycle.invalidated-by-gm',
    ]),
  }
}

export const parsePokemonEggLifecycleProjectionV1 = (
  value: unknown,
  path = 'pokemonEggLifecycleProjection',
): PokemonEggLifecycleProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'eggId', 'revision', 'status', 'readinessState',
    'incubationDisposition', 'canTransferBeforeHatch', 'canBeginHatch', 'transferPolicy',
    'storagePolicy', 'facilityPolicy', 'sourceLossPolicy', 'blockerReasonIds',
    'generatedAtCampaignMinute',
  ], path)
  if (row.schemaVersion !== 1) fail('breeding.egg-lifecycle.invalid-document', `${path}.schemaVersion`, 'must be schema version 1.')
  const audienceValue = row.audience
  if (audienceValue !== 'gm' && audienceValue !== 'owner') {
    fail('breeding.egg-lifecycle.invalid-document', `${path}.audience`, 'must be GM or owner.')
  }
  const audience = audienceValue as 'gm' | 'owner'
  const eggId = parsePokemonEggIdSyntax(row.eggId)
    ?? fail('breeding.egg-lifecycle.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.')
  const statusValue = row.status
  if (!isPokemonEggStatus(statusValue)) {
    fail('breeding.egg-lifecycle.invalid-document', `${path}.status`, 'must be a Pokémon Egg status.')
  }
  const status = statusValue as PokemonEggStatus
  const incubationDisposition = oneOf<PokemonEggLifecycleIncubationDispositionV1>(
    row.incubationDisposition,
    incubationDispositions,
    `${path}.incubationDisposition`,
  )
  const expected = expectedProjection(status)
  const readinessState = oneOf<PokemonEggLifecycleReadinessStateV1>(row.readinessState, readinessStates, `${path}.readinessState`)
  const canTransferBeforeHatch = boolean(row.canTransferBeforeHatch, `${path}.canTransferBeforeHatch`)
  const canBeginHatch = boolean(row.canBeginHatch, `${path}.canBeginHatch`)
  const blockers = sortedReasons<PokemonEggLifecycleBlockerReasonIdV1>(row.blockerReasonIds, blockerReasons, `${path}.blockerReasonIds`)
  const statusDispositionValid = status === 'incubating'
    ? incubationDisposition === 'active' || incubationDisposition === 'explicitly-paused'
    : status === 'ready' || status === 'awaiting-special-adjudication' || status === 'hatching'
      ? incubationDisposition === 'complete'
      : incubationDisposition === 'settled'
  if (!statusDispositionValid || readinessState !== expected.readinessState
    || canTransferBeforeHatch !== expected.canTransferBeforeHatch
    || canBeginHatch !== expected.canBeginHatch
    || JSON.stringify(blockers) !== JSON.stringify(expected.blockers)) {
    fail('breeding.egg-lifecycle.invalid-invariant', path, 'status, readiness, incubation, action, and blocker facts must agree exactly.')
  }
  return Object.freeze({
    schemaVersion: 1,
    audience,
    eggId,
    revision: integer(row.revision, `${path}.revision`),
    status,
    readinessState,
    incubationDisposition,
    canTransferBeforeHatch,
    canBeginHatch,
    transferPolicy: assertLiteral(row.transferPolicy, 'continues-incubation-and-preserves-readiness', `${path}.transferPolicy`),
    storagePolicy: assertLiteral(row.storagePolicy, 'continues-incubation-and-preserves-readiness', `${path}.storagePolicy`),
    facilityPolicy: assertLiteral(row.facilityPolicy, 'base-rate-continues-provider-contribution-required', `${path}.facilityPolicy`),
    sourceLossPolicy: assertLiteral(row.sourceLossPolicy, 'frozen-snapshot-continues', `${path}.sourceLossPolicy`),
    blockerReasonIds: blockers,
    generatedAtCampaignMinute: integer(row.generatedAtCampaignMinute, `${path}.generatedAtCampaignMinute`),
  })
}

export const parsePokemonEggExternalLifecycleObservationV1 = (
  value: unknown,
  path = 'pokemonEggExternalLifecycleObservation',
): PokemonEggExternalLifecycleObservationV1 => {
  const row = record(value, path)
  if (row.kind === 'custody-change') {
    const exactRow = exact(row, ['schemaVersion', 'kind', 'custodyState'], path)
    if (exactRow.schemaVersion !== 1) fail('breeding.egg-lifecycle.invalid-document', `${path}.schemaVersion`, 'must be schema version 1.')
    return Object.freeze({
      schemaVersion: 1,
      kind: 'custody-change',
      custodyState: oneOf<PokemonEggCustodyStateV1>(exactRow.custodyState, custodyStates, `${path}.custodyState`),
    })
  }
  if (row.kind === 'source-continuity-loss') {
    const exactRow = exact(row, ['schemaVersion', 'kind', 'sourceRole', 'continuityState'], path)
    if (exactRow.schemaVersion !== 1) fail('breeding.egg-lifecycle.invalid-document', `${path}.schemaVersion`, 'must be schema version 1.')
    return Object.freeze({
      schemaVersion: 1,
      kind: 'source-continuity-loss',
      sourceRole: oneOf<PokemonEggSourceContinuityRoleV1>(exactRow.sourceRole, sourceRoles, `${path}.sourceRole`),
      continuityState: oneOf<PokemonEggSourceContinuityStateV1>(exactRow.continuityState, sourceStates, `${path}.continuityState`),
    })
  }
  if (row.kind === 'facility-change') {
    const exactRow = exact(row, ['schemaVersion', 'kind', 'facilityId', 'evidenceDefinitionSha256'], path)
    if (exactRow.schemaVersion !== 1) fail('breeding.egg-lifecycle.invalid-document', `${path}.schemaVersion`, 'must be schema version 1.')
    const facilityId = nullableFacilityId(exactRow.facilityId, `${path}.facilityId`)
    const evidenceDefinitionSha256 = nullableHash(exactRow.evidenceDefinitionSha256, `${path}.evidenceDefinitionSha256`)
    if ((facilityId === null) !== (evidenceDefinitionSha256 === null)) {
      fail('breeding.egg-lifecycle.invalid-invariant', path, 'facility identity and evidence must both be null or both be present.')
    }
    return Object.freeze({ schemaVersion: 1, kind: 'facility-change', facilityId, evidenceDefinitionSha256 })
  }
  return fail('breeding.egg-lifecycle.invalid-document', `${path}.kind`, 'must be a closed external lifecycle observation kind.')
}

export const parsePokemonEggExternalLifecycleEvaluationV1 = (
  value: unknown,
  path = 'pokemonEggExternalLifecycleEvaluation',
): PokemonEggExternalLifecycleEvaluationV1 => {
  const row = exact(value, [
    'schemaVersion', 'eggId', 'eggRevision', 'observationKind', 'mutationRequired',
    'incubationDisposition', 'readinessDisposition', 'hatchEligibilityDisposition',
    'facilityContributionDisposition', 'reasonId', 'observedAtCampaignMinute',
  ], path)
  if (row.schemaVersion !== 1) fail('breeding.egg-lifecycle.invalid-document', `${path}.schemaVersion`, 'must be schema version 1.')
  const eggId = parsePokemonEggIdSyntax(row.eggId)
    ?? fail('breeding.egg-lifecycle.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.')
  if (!['custody-change', 'source-continuity-loss', 'facility-change'].includes(row.observationKind as string)) {
    fail('breeding.egg-lifecycle.invalid-document', `${path}.observationKind`, 'must be a closed observation kind.')
  }
  if (row.mutationRequired !== false) fail('breeding.egg-lifecycle.invalid-invariant', `${path}.mutationRequired`, 'external observations never mutate an accepted Egg.')
  const reasonId = oneOf<PokemonEggExternalLifecycleReasonIdV1>(row.reasonId, externalReasons, `${path}.reasonId`)
  const facilityDisposition = row.facilityContributionDisposition === 'none' || row.facilityContributionDisposition === 'unavailable'
    ? row.facilityContributionDisposition
    : fail('breeding.egg-lifecycle.invalid-document', `${path}.facilityContributionDisposition`, 'must be none or unavailable.')
  const expectedFacilityUnavailable = reasonId === 'breeding.egg-lifecycle.facility-unsupported'
  if ((facilityDisposition === 'unavailable') !== expectedFacilityUnavailable) {
    fail('breeding.egg-lifecycle.invalid-invariant', path, 'unsupported facility evidence must be the only unavailable contribution.')
  }
  return Object.freeze({
    schemaVersion: 1,
    eggId,
    eggRevision: integer(row.eggRevision, `${path}.eggRevision`),
    observationKind: row.observationKind as PokemonEggExternalLifecycleObservationV1['kind'],
    mutationRequired: false,
    incubationDisposition: assertLiteral(row.incubationDisposition, 'preserve-current-explicit-state', `${path}.incubationDisposition`),
    readinessDisposition: assertLiteral(row.readinessDisposition, 'preserve', `${path}.readinessDisposition`),
    hatchEligibilityDisposition: assertLiteral(row.hatchEligibilityDisposition, 'preserve-status-derived-eligibility', `${path}.hatchEligibilityDisposition`),
    facilityContributionDisposition: facilityDisposition,
    reasonId,
    observedAtCampaignMinute: integer(row.observedAtCampaignMinute, `${path}.observedAtCampaignMinute`),
  })
}
