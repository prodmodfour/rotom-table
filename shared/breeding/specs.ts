import {
  breedingFamilyIdForRoot,
  parseBreedingAbilityIdSyntax,
  parseBreedingEggGroupIdSyntax,
  parseBreedingFamilyIdSyntax,
  parseBreedingMoveIdSyntax,
  parseBreedingSpeciesIdSyntax,
  type BreedingAbilityId,
  type BreedingEggGroupId,
  type BreedingFamilyId,
  type BreedingMoveId,
  type BreedingSpeciesId,
} from './ids'

export const BREEDING_SPEC_SCHEMA_VERSION = 1 as const
export const BREEDING_SPEC_LIMITS = Object.freeze({
  speciesPerFamily: 128,
  evolutionEdgesPerFamily: 256,
  eggGroupsPerSpecies: 2,
  basicAbilitiesPerSpecies: 8,
  eggMovesPerSpecies: 256,
  machineMovesPerSpecies: 256,
  sourceHashesPerSpec: 16,
  adjudicationsPerSpecies: 32,
  sourcePathChars: 240,
  hatchCampaignMinutesMaximum: 31_536_000,
} as const)

export const BREEDING_FORM_KIND_IDS = Object.freeze([
  'base-species', 'regional-form', 'size-form', 'sex-form', 'appliance-form',
  'battle-form', 'transformation-form', 'fusion-form', 'mask-form', 'other-special-form',
] as const)
export type BreedingFormKindId = typeof BREEDING_FORM_KIND_IDS[number]

export const BREEDING_FORM_POLICY_IDS = Object.freeze([
  'own-form-root', 'base-family-root', 'not-breedable-form', 'requires-adjudication',
] as const)
export type BreedingFormPolicyId = typeof BREEDING_FORM_POLICY_IDS[number]

export const BREEDING_ELIGIBILITY_IDS = Object.freeze([
  'breedable', 'no-breeding', 'special-source-only', 'source-gap',
] as const)
export type BreedingEligibilityId = typeof BREEDING_ELIGIBILITY_IDS[number]

export const BREEDING_ELIGIBILITY_EVIDENCE_IDS = Object.freeze([
  'compiled-spec', 'source-bound-species-adjudication', 'typed-campaign-override',
] as const)
export type BreedingEligibilityEvidenceId = typeof BREEDING_ELIGIBILITY_EVIDENCE_IDS[number]

export type BreedingSpeciesGenderPolicy =
  | { readonly kind: 'ratio', readonly femalePercent: number }
  | { readonly kind: 'genderless' }

export interface BreedingSpeciesSpecProvenanceV1 {
  readonly sourcePath: 'data/reference/pokedex.json'
  readonly sourceIndex: number
  readonly sourceRecordSha256: string
  readonly canonicalIdDefinitionSha256: string
  readonly taxonomyDefinitionSha256: string
  readonly familyPolicyDefinitionSha256: string
  readonly hatchPolicyDefinitionSha256: string
  readonly compilerDefinitionSha256: string
  readonly adjudicationIds: readonly string[]
}

export interface BreedingSpeciesSpecV1 {
  readonly schemaVersion: typeof BREEDING_SPEC_SCHEMA_VERSION
  readonly speciesId: BreedingSpeciesId
  readonly familyId: BreedingFamilyId
  readonly familyRootSpeciesId: BreedingSpeciesId
  readonly formKindId: BreedingFormKindId
  readonly formPolicyId: BreedingFormPolicyId
  readonly eligibilityId: BreedingEligibilityId
  readonly eligibilityEvidenceId: BreedingEligibilityEvidenceId
  readonly eggGroupIds: readonly BreedingEggGroupId[]
  readonly genderPolicy: BreedingSpeciesGenderPolicy
  readonly basicAbilityIds: readonly BreedingAbilityId[]
  readonly hatchCampaignMinutes: number
  readonly eggMoveIds: readonly BreedingMoveId[]
  readonly machineCompatibleMoveIds: readonly BreedingMoveId[]
  readonly provenance: BreedingSpeciesSpecProvenanceV1
  readonly sourceHashes: readonly string[]
  readonly definitionSha256: string
}

export type BreedingEvolutionEdgeKind = 'evolves-to' | 'branch-evolves-to'
export interface BreedingFamilyEvolutionEdgeV1 {
  readonly fromSpeciesId: BreedingSpeciesId
  readonly toSpeciesId: BreedingSpeciesId
  readonly kind: BreedingEvolutionEdgeKind
}
export interface BreedingFamilyFormPolicyV1 {
  readonly speciesId: BreedingSpeciesId
  readonly formKindId: BreedingFormKindId
  readonly formPolicyId: BreedingFormPolicyId
}
export interface BreedingFamilySpecV1 {
  readonly schemaVersion: typeof BREEDING_SPEC_SCHEMA_VERSION
  readonly familyId: BreedingFamilyId
  readonly familyRootSpeciesId: BreedingSpeciesId
  readonly offspringRootSpeciesId: BreedingSpeciesId
  readonly memberSpeciesIds: readonly BreedingSpeciesId[]
  readonly evolutionEdges: readonly BreedingFamilyEvolutionEdgeV1[]
  readonly formPolicies: readonly BreedingFamilyFormPolicyV1[]
  readonly sourceHashes: readonly string[]
  readonly definitionSha256: string
}

export interface BreedingSpecIdentityRegistry {
  readonly speciesIds: ReadonlySet<string>
  readonly eggGroupIds: ReadonlySet<string>
  readonly moveIds: ReadonlySet<string>
  readonly abilityIds: ReadonlySet<string>
  readonly formKindIds: ReadonlySet<string>
  readonly formPolicyIds: ReadonlySet<string>
  readonly eligibilityIds: ReadonlySet<string>
  readonly eligibilityEvidenceIds: ReadonlySet<string>
  readonly definitionSha256: (value: unknown) => string
}

export type BreedingSpecValidationCode =
  | 'breeding.spec.not-object'
  | 'breeding.spec.unknown-field'
  | 'breeding.spec.invalid-version'
  | 'breeding.spec.invalid-id'
  | 'breeding.spec.unknown-id'
  | 'breeding.spec.invalid-enum'
  | 'breeding.spec.invalid-number'
  | 'breeding.spec.invalid-array'
  | 'breeding.spec.duplicate-id'
  | 'breeding.spec.invalid-order'
  | 'breeding.spec.invalid-hash'
  | 'breeding.spec.limit-exceeded'
  | 'breeding.spec.invariant'

export class BreedingSpecValidationError extends Error {
  readonly code: BreedingSpecValidationCode
  readonly path: string

  constructor(code: BreedingSpecValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingSpecValidationError'
    this.code = code
    this.path = path
  }
}

export type BreedingSpecDiagnosticAudience = 'public' | 'gm' | 'maintenance'
export type BreedingSpecDiagnosticProjection =
  | { readonly code: BreedingSpecValidationCode }
  | { readonly code: BreedingSpecValidationCode, readonly path: string }
  | { readonly code: BreedingSpecValidationCode, readonly path: string, readonly message: string }

export const projectBreedingSpecDiagnostic = (
  error: BreedingSpecValidationError,
  audience: BreedingSpecDiagnosticAudience,
): BreedingSpecDiagnosticProjection => {
  if (audience === 'public') return Object.freeze({ code: error.code })
  if (audience === 'gm') return Object.freeze({ code: error.code, path: error.path })
  return Object.freeze({ code: error.code, path: error.path, message: error.message })
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const ADJUDICATION_ID = /^BR-SRC-[0-9]{3}$/

const fail = (code: BreedingSpecValidationCode, path: string, message: string): never => {
  throw new BreedingSpecValidationError(code, path, message)
}

const plainRecord = (value: unknown, path: string): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('breeding.spec.not-object', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return fail('breeding.spec.not-object', path, 'must be a plain object.')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.spec.unknown-field', path, 'must contain only declared string fields.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.spec.not-object', path, 'must contain enumerable data fields only.')
    }
  }
  return value as UnknownRecord
}

const exactRecord = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const record = plainRecord(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(record, field))
    || Object.keys(record).some(field => !allowed.has(field))) {
    return fail('breeding.spec.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return record
}

const version = (value: unknown, path: string): 1 => {
  if (value !== BREEDING_SPEC_SCHEMA_VERSION) {
    return fail('breeding.spec.invalid-version', path, 'must be schema version 1.')
  }
  return BREEDING_SPEC_SCHEMA_VERSION
}

const hash = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    return fail('breeding.spec.invalid-hash', path, 'must be a lowercase SHA-256 value.')
  }
  return value
}

const sortedUniqueStrings = <T extends string>(
  value: unknown,
  path: string,
  maximum: number,
  parse: (entry: unknown, entryPath: string) => T,
  minimum = 0,
): readonly T[] => {
  if (!Array.isArray(value)) return fail('breeding.spec.invalid-array', path, 'must be an array.')
  if (value.length < minimum || value.length > maximum) {
    return fail('breeding.spec.limit-exceeded', path, 'has an invalid entry count.')
  }
  const result = value.map((entry, index) => parse(entry, `${path}[${index}]`))
  if (new Set(result).size !== result.length) {
    return fail('breeding.spec.duplicate-id', path, 'must not contain duplicate entries.')
  }
  if (result.some((entry, index) => index > 0 && result[index - 1]! >= entry)) {
    return fail('breeding.spec.invalid-order', path, 'must be in strict code-point order.')
  }
  return Object.freeze(result)
}

const speciesId = (value: unknown, path: string, registry: BreedingSpecIdentityRegistry): BreedingSpeciesId => {
  const parsed = parseBreedingSpeciesIdSyntax(value)
  if (!parsed) return fail('breeding.spec.invalid-id', path, 'must be a canonical Species ID.')
  if (!registry.speciesIds.has(parsed)) return fail('breeding.spec.unknown-id', path, 'must identify a registered Species.')
  return parsed
}
const familyId = (value: unknown, path: string): BreedingFamilyId => (
  parseBreedingFamilyIdSyntax(value)
  ?? fail('breeding.spec.invalid-id', path, 'must be a canonical Family ID.')
)
const eggGroupId = (value: unknown, path: string, registry: BreedingSpecIdentityRegistry): BreedingEggGroupId => {
  const parsed = parseBreedingEggGroupIdSyntax(value)
  if (!parsed) return fail('breeding.spec.invalid-id', path, 'must be a canonical Egg Group ID.')
  if (!registry.eggGroupIds.has(parsed)) return fail('breeding.spec.unknown-id', path, 'must identify a registered Egg Group.')
  return parsed
}
const moveId = (value: unknown, path: string, registry: BreedingSpecIdentityRegistry): BreedingMoveId => {
  const parsed = parseBreedingMoveIdSyntax(value)
  if (!parsed) return fail('breeding.spec.invalid-id', path, 'must be a canonical Move ID.')
  if (!registry.moveIds.has(parsed)) return fail('breeding.spec.unknown-id', path, 'must identify a registered Move.')
  return parsed
}
const abilityId = (value: unknown, path: string, registry: BreedingSpecIdentityRegistry): BreedingAbilityId => {
  const parsed = parseBreedingAbilityIdSyntax(value)
  if (!parsed) return fail('breeding.spec.invalid-id', path, 'must be a canonical Ability ID.')
  if (!registry.abilityIds.has(parsed)) return fail('breeding.spec.unknown-id', path, 'must identify a registered Ability.')
  return parsed
}

const enumId = <T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
  label: string,
): T => {
  if (typeof value !== 'string' || !allowed.has(value)) {
    return fail('breeding.spec.invalid-enum', path, `must be a declared ${label}.`)
  }
  return value as T
}

const genderPolicy = (value: unknown, path: string): BreedingSpeciesGenderPolicy => {
  const input = plainRecord(value, path)
  if (input.kind === 'genderless') {
    exactRecord(input, ['kind'], path)
    return Object.freeze({ kind: 'genderless' })
  }
  if (input.kind === 'ratio') {
    const row = exactRecord(input, ['kind', 'femalePercent'], path)
    const femalePercent = row.femalePercent
    if (typeof femalePercent !== 'number' || !Number.isFinite(femalePercent)
      || femalePercent < 0 || femalePercent > 100
      || !Number.isSafeInteger(femalePercent * 10)) {
      return fail('breeding.spec.invalid-number', `${path}.femalePercent`, 'must be a tenth-percent value from 0 through 100.')
    }
    return Object.freeze({ kind: 'ratio', femalePercent })
  }
  return fail('breeding.spec.invalid-enum', `${path}.kind`, 'must be a declared Gender policy.')
}

const provenance = (
  value: unknown,
  path: string,
): BreedingSpeciesSpecProvenanceV1 => {
  const row = exactRecord(value, [
    'sourcePath', 'sourceIndex', 'sourceRecordSha256', 'canonicalIdDefinitionSha256',
    'taxonomyDefinitionSha256', 'familyPolicyDefinitionSha256', 'hatchPolicyDefinitionSha256',
    'compilerDefinitionSha256', 'adjudicationIds',
  ], path)
  if (row.sourcePath !== 'data/reference/pokedex.json') {
    return fail('breeding.spec.invalid-enum', `${path}.sourcePath`, 'must identify the canonical Pokédex source.')
  }
  if (!Number.isSafeInteger(row.sourceIndex) || (row.sourceIndex as number) < 0 || (row.sourceIndex as number) > 1_000_000) {
    return fail('breeding.spec.invalid-number', `${path}.sourceIndex`, 'must be a bounded non-negative integer.')
  }
  const adjudicationIds = sortedUniqueStrings(
    row.adjudicationIds,
    `${path}.adjudicationIds`,
    BREEDING_SPEC_LIMITS.adjudicationsPerSpecies,
    (entry, entryPath) => typeof entry === 'string' && ADJUDICATION_ID.test(entry)
      ? entry
      : fail('breeding.spec.invalid-id', entryPath, 'must be a canonical source adjudication ID.'),
  )
  return Object.freeze({
    sourcePath: row.sourcePath,
    sourceIndex: row.sourceIndex as number,
    sourceRecordSha256: hash(row.sourceRecordSha256, `${path}.sourceRecordSha256`),
    canonicalIdDefinitionSha256: hash(row.canonicalIdDefinitionSha256, `${path}.canonicalIdDefinitionSha256`),
    taxonomyDefinitionSha256: hash(row.taxonomyDefinitionSha256, `${path}.taxonomyDefinitionSha256`),
    familyPolicyDefinitionSha256: hash(row.familyPolicyDefinitionSha256, `${path}.familyPolicyDefinitionSha256`),
    hatchPolicyDefinitionSha256: hash(row.hatchPolicyDefinitionSha256, `${path}.hatchPolicyDefinitionSha256`),
    compilerDefinitionSha256: hash(row.compilerDefinitionSha256, `${path}.compilerDefinitionSha256`),
    adjudicationIds,
  })
}

export const parseBreedingSpeciesSpecV1 = (
  value: unknown,
  registry: BreedingSpecIdentityRegistry,
  path = 'speciesSpec',
): BreedingSpeciesSpecV1 => {
  const row = exactRecord(value, [
    'schemaVersion', 'speciesId', 'familyId', 'familyRootSpeciesId', 'formKindId',
    'formPolicyId', 'eligibilityId', 'eligibilityEvidenceId', 'eggGroupIds', 'genderPolicy',
    'basicAbilityIds', 'hatchCampaignMinutes', 'eggMoveIds', 'machineCompatibleMoveIds',
    'provenance', 'sourceHashes', 'definitionSha256',
  ], path)
  const parsedSpeciesId = speciesId(row.speciesId, `${path}.speciesId`, registry)
  const parsedFamilyRoot = speciesId(row.familyRootSpeciesId, `${path}.familyRootSpeciesId`, registry)
  const parsedFamilyId = familyId(row.familyId, `${path}.familyId`)
  if (parsedFamilyId !== breedingFamilyIdForRoot(parsedFamilyRoot)) {
    fail('breeding.spec.invariant', `${path}.familyId`, 'must match the declared family root.')
  }
  const eligibilityId = enumId<BreedingEligibilityId>(
    row.eligibilityId,
    `${path}.eligibilityId`,
    registry.eligibilityIds,
    'eligibility ID',
  )
  if (eligibilityId === 'source-gap') {
    fail('breeding.spec.invariant', `${path}.eligibilityId`, 'source-gap rows cannot be emitted as Species specs.')
  }
  const eggGroupIds = sortedUniqueStrings(
    row.eggGroupIds,
    `${path}.eggGroupIds`,
    BREEDING_SPEC_LIMITS.eggGroupsPerSpecies,
    (entry, entryPath) => eggGroupId(entry, entryPath, registry),
    eligibilityId === 'breedable' ? 1 : 0,
  )
  const basicAbilityIds = sortedUniqueStrings(
    row.basicAbilityIds,
    `${path}.basicAbilityIds`,
    BREEDING_SPEC_LIMITS.basicAbilitiesPerSpecies,
    (entry, entryPath) => abilityId(entry, entryPath, registry),
    1,
  )
  const hatchCampaignMinutes = row.hatchCampaignMinutes
  if (!Number.isSafeInteger(hatchCampaignMinutes) || (hatchCampaignMinutes as number) < 1
    || (hatchCampaignMinutes as number) > BREEDING_SPEC_LIMITS.hatchCampaignMinutesMaximum) {
    fail('breeding.spec.invalid-number', `${path}.hatchCampaignMinutes`, 'must be bounded positive campaign minutes.')
  }
  const parsedProvenance = provenance(row.provenance, `${path}.provenance`)
  const sourceHashes = sortedUniqueStrings(
    row.sourceHashes,
    `${path}.sourceHashes`,
    BREEDING_SPEC_LIMITS.sourceHashesPerSpec,
    hash,
    1,
  )
  const requiredHashes = [
    parsedProvenance.sourceRecordSha256,
    parsedProvenance.canonicalIdDefinitionSha256,
    parsedProvenance.taxonomyDefinitionSha256,
    parsedProvenance.familyPolicyDefinitionSha256,
    parsedProvenance.hatchPolicyDefinitionSha256,
    parsedProvenance.compilerDefinitionSha256,
  ]
  if (requiredHashes.some(required => !sourceHashes.includes(required))) {
    fail('breeding.spec.invariant', `${path}.sourceHashes`, 'must include every typed provenance hash.')
  }
  const withoutDefinition = Object.freeze({
    schemaVersion: version(row.schemaVersion, `${path}.schemaVersion`),
    speciesId: parsedSpeciesId,
    familyId: parsedFamilyId,
    familyRootSpeciesId: parsedFamilyRoot,
    formKindId: enumId<BreedingFormKindId>(row.formKindId, `${path}.formKindId`, registry.formKindIds, 'form kind'),
    formPolicyId: enumId<BreedingFormPolicyId>(row.formPolicyId, `${path}.formPolicyId`, registry.formPolicyIds, 'form policy'),
    eligibilityId,
    eligibilityEvidenceId: enumId<BreedingEligibilityEvidenceId>(row.eligibilityEvidenceId, `${path}.eligibilityEvidenceId`, registry.eligibilityEvidenceIds, 'eligibility evidence'),
    eggGroupIds,
    genderPolicy: genderPolicy(row.genderPolicy, `${path}.genderPolicy`),
    basicAbilityIds,
    hatchCampaignMinutes: hatchCampaignMinutes as number,
    eggMoveIds: sortedUniqueStrings(row.eggMoveIds, `${path}.eggMoveIds`, BREEDING_SPEC_LIMITS.eggMovesPerSpecies, (entry, entryPath) => moveId(entry, entryPath, registry)),
    machineCompatibleMoveIds: sortedUniqueStrings(row.machineCompatibleMoveIds, `${path}.machineCompatibleMoveIds`, BREEDING_SPEC_LIMITS.machineMovesPerSpecies, (entry, entryPath) => moveId(entry, entryPath, registry)),
    provenance: parsedProvenance,
    sourceHashes,
  })
  const definitionSha256 = hash(row.definitionSha256, `${path}.definitionSha256`)
  if (registry.definitionSha256(withoutDefinition) !== definitionSha256) {
    fail('breeding.spec.invalid-hash', `${path}.definitionSha256`, 'does not match the parsed Species spec definition.')
  }
  return Object.freeze({ ...withoutDefinition, definitionSha256 })
}

const evolutionEdge = (
  value: unknown,
  registry: BreedingSpecIdentityRegistry,
  path: string,
): BreedingFamilyEvolutionEdgeV1 => {
  const row = exactRecord(value, ['fromSpeciesId', 'toSpeciesId', 'kind'], path)
  const fromSpeciesId = speciesId(row.fromSpeciesId, `${path}.fromSpeciesId`, registry)
  const toSpeciesId = speciesId(row.toSpeciesId, `${path}.toSpeciesId`, registry)
  if (fromSpeciesId === toSpeciesId) fail('breeding.spec.invariant', path, 'evolution edges cannot be self edges.')
  const kind = row.kind
  if (kind !== 'evolves-to' && kind !== 'branch-evolves-to') {
    return fail('breeding.spec.invalid-enum', `${path}.kind`, 'must be a declared evolution edge kind.')
  }
  return Object.freeze({ fromSpeciesId, toSpeciesId, kind: kind as BreedingEvolutionEdgeKind })
}

const formPolicy = (
  value: unknown,
  registry: BreedingSpecIdentityRegistry,
  path: string,
): BreedingFamilyFormPolicyV1 => {
  const row = exactRecord(value, ['speciesId', 'formKindId', 'formPolicyId'], path)
  return Object.freeze({
    speciesId: speciesId(row.speciesId, `${path}.speciesId`, registry),
    formKindId: enumId<BreedingFormKindId>(row.formKindId, `${path}.formKindId`, registry.formKindIds, 'form kind'),
    formPolicyId: enumId<BreedingFormPolicyId>(row.formPolicyId, `${path}.formPolicyId`, registry.formPolicyIds, 'form policy'),
  })
}

export const parseBreedingFamilySpecV1 = (
  value: unknown,
  registry: BreedingSpecIdentityRegistry,
  path = 'familySpec',
): BreedingFamilySpecV1 => {
  const row = exactRecord(value, [
    'schemaVersion', 'familyId', 'familyRootSpeciesId', 'offspringRootSpeciesId',
    'memberSpeciesIds', 'evolutionEdges', 'formPolicies', 'sourceHashes', 'definitionSha256',
  ], path)
  const familyRootSpeciesId = speciesId(row.familyRootSpeciesId, `${path}.familyRootSpeciesId`, registry)
  const parsedFamilyId = familyId(row.familyId, `${path}.familyId`)
  if (parsedFamilyId !== breedingFamilyIdForRoot(familyRootSpeciesId)) {
    fail('breeding.spec.invariant', `${path}.familyId`, 'must match the declared family root.')
  }
  const memberSpeciesIds = sortedUniqueStrings(
    row.memberSpeciesIds,
    `${path}.memberSpeciesIds`,
    BREEDING_SPEC_LIMITS.speciesPerFamily,
    (entry, entryPath) => speciesId(entry, entryPath, registry),
    1,
  )
  const offspringRootSpeciesId = speciesId(row.offspringRootSpeciesId, `${path}.offspringRootSpeciesId`, registry)
  if (!memberSpeciesIds.includes(familyRootSpeciesId) || !memberSpeciesIds.includes(offspringRootSpeciesId)) {
    fail('breeding.spec.invariant', path, 'family and offspring roots must be family members.')
  }
  if (!Array.isArray(row.evolutionEdges)) {
    return fail('breeding.spec.invalid-array', `${path}.evolutionEdges`, 'must be an array.')
  }
  const rawEvolutionEdges = row.evolutionEdges as unknown[]
  if (rawEvolutionEdges.length > BREEDING_SPEC_LIMITS.evolutionEdgesPerFamily) {
    fail('breeding.spec.limit-exceeded', `${path}.evolutionEdges`, 'has too many evolution edges.')
  }
  const edges = rawEvolutionEdges.map((entry, index) => evolutionEdge(entry, registry, `${path}.evolutionEdges[${index}]`))
  const edgeKeys = edges.map(edge => `${edge.fromSpeciesId}\u0000${edge.toSpeciesId}\u0000${edge.kind}`)
  if (new Set(edgeKeys).size !== edgeKeys.length) fail('breeding.spec.duplicate-id', `${path}.evolutionEdges`, 'must not contain duplicate edges.')
  if (edgeKeys.some((key, index) => index > 0 && edgeKeys[index - 1]! >= key)) {
    fail('breeding.spec.invalid-order', `${path}.evolutionEdges`, 'must be in strict edge order.')
  }
  const members = new Set(memberSpeciesIds)
  if (edges.some(edge => !members.has(edge.fromSpeciesId) || !members.has(edge.toSpeciesId))) {
    fail('breeding.spec.invariant', `${path}.evolutionEdges`, 'all edge endpoints must be family members.')
  }
  if (edges.some(edge => edge.toSpeciesId === familyRootSpeciesId)) {
    fail('breeding.spec.invariant', `${path}.evolutionEdges`, 'the family root cannot have an incoming edge.')
  }
  const reachable = new Set<BreedingSpeciesId>([familyRootSpeciesId])
  let changed = true
  while (changed) {
    changed = false
    for (const edge of edges) {
      if (reachable.has(edge.fromSpeciesId) && !reachable.has(edge.toSpeciesId)) {
        reachable.add(edge.toSpeciesId)
        changed = true
      }
    }
  }
  if (reachable.size !== memberSpeciesIds.length) {
    fail('breeding.spec.invariant', `${path}.evolutionEdges`, 'every member must be reachable from the family root.')
  }
  if (!Array.isArray(row.formPolicies)) return fail('breeding.spec.invalid-array', `${path}.formPolicies`, 'must be an array.')
  const rawFormPolicies = row.formPolicies as unknown[]
  if (rawFormPolicies.length !== memberSpeciesIds.length) {
    fail('breeding.spec.invariant', `${path}.formPolicies`, 'must contain one row for every family member.')
  }
  const formPolicies = rawFormPolicies.map((entry, index) => formPolicy(entry, registry, `${path}.formPolicies[${index}]`))
  if (formPolicies.some((entry, index) => entry.speciesId !== memberSpeciesIds[index])) {
    fail('breeding.spec.invalid-order', `${path}.formPolicies`, 'must align in member Species ID order.')
  }
  const sourceHashes = sortedUniqueStrings(row.sourceHashes, `${path}.sourceHashes`, BREEDING_SPEC_LIMITS.sourceHashesPerSpec, hash, 1)
  const withoutDefinition = Object.freeze({
    schemaVersion: version(row.schemaVersion, `${path}.schemaVersion`),
    familyId: parsedFamilyId,
    familyRootSpeciesId,
    offspringRootSpeciesId,
    memberSpeciesIds,
    evolutionEdges: Object.freeze(edges),
    formPolicies: Object.freeze(formPolicies),
    sourceHashes,
  })
  const definitionSha256 = hash(row.definitionSha256, `${path}.definitionSha256`)
  if (registry.definitionSha256(withoutDefinition) !== definitionSha256) {
    fail('breeding.spec.invalid-hash', `${path}.definitionSha256`, 'does not match the parsed Family spec definition.')
  }
  return Object.freeze({ ...withoutDefinition, definitionSha256 })
}
