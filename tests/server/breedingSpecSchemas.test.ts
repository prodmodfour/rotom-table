import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_ELIGIBILITY_EVIDENCE_IDS,
  BREEDING_ELIGIBILITY_IDS,
  BREEDING_FORM_KIND_IDS,
  BREEDING_FORM_POLICY_IDS,
  BREEDING_SPEC_LIMITS,
  BreedingSpecValidationError,
  projectBreedingSpecDiagnostic,
} from '#shared/breeding/specs'
import {
  BREEDING_SPEC_IDENTITY_REGISTRY,
  parseCanonicalBreedingFamilySpecV1,
  parseCanonicalBreedingSpeciesSpecV1,
} from '../../server/domain/breeding/specSchemaContext'
import { canonicalBreedingSpeciesIdentity } from '../../server/domain/breeding/canonicalIds'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const hashDefinition = (value: unknown): string => sha256(stableJsonStringify(value))
const clone = <T>(value: T): T => structuredClone(value)

interface SpecSchemasArtifact {
  schemaVersion: number
  schemaId: string
  rulesetDefinitionSha256: string
  taxonomyDefinitionSha256: string
  canonicalIdDefinitionSha256: string
  familyPolicyDefinitionSha256: string
  hatchPolicyDefinitionSha256: string
  sourceManifestSha256: string
  definitionSha256: string
  definition: {
    specVersion: number
    limits: Record<string, number>
    speciesSpec: Record<string, unknown>
    familySpec: Record<string, unknown>
    invariants: string[]
    validationCodes: string[]
    diagnosticContract: Record<string, unknown>
  }
}

const schema = readJson<SpecSchemasArtifact>('data/breeding-automation/spec-schemas.json')
const canonicalIds = readJson<{ definitionSha256: string }>('data/breeding-automation/canonical-ids.json')
const ruleset = readJson<{ definitionSha256: string }>('data/breeding-automation/ruleset.json')
const taxonomy = readJson<{ definitionSha256: string }>('data/breeding-automation/taxonomies.json')
const familyPolicy = readJson<{ definitionSha256: string }>('data/breeding-automation/family-graph-policy.json')
const hatchPolicy = readJson<{ definitionSha256: string }>('data/breeding-automation/hatch-duration-policy.json')

const compilerHash = 'c'.repeat(64)
const abraSourceHash = canonicalBreedingSpeciesIdentity('abra')!.sourceRecordSha256
const provenanceHashes = [
  abraSourceHash,
  canonicalIds.definitionSha256,
  taxonomy.definitionSha256,
  familyPolicy.definitionSha256,
  hatchPolicy.definitionSha256,
  compilerHash,
].sort()

const withDefinitionHash = <T extends Record<string, unknown>>(definition: T): T & { definitionSha256: string } => ({
  ...definition,
  definitionSha256: hashDefinition(definition),
})

const validSpeciesSpec = () => withDefinitionHash({
  schemaVersion: 1,
  speciesId: 'abra',
  familyId: 'family:abra',
  familyRootSpeciesId: 'abra',
  formKindId: 'base-species',
  formPolicyId: 'own-form-root',
  eligibilityId: 'breedable',
  eligibilityEvidenceId: 'compiled-spec',
  eggGroupIds: ['humanshape'],
  genderPolicy: { kind: 'ratio', femalePercent: 25 },
  basicAbilityIds: ['inner-focus', 'synchronize'],
  hatchCampaignMinutes: 14_400,
  eggMoveIds: ['ally-switch', 'barrier'],
  machineCompatibleMoveIds: ['calm-mind', 'psychic'],
  provenance: {
    sourcePath: 'data/reference/pokedex.json',
    sourceIndex: 0,
    sourceRecordSha256: abraSourceHash,
    canonicalIdDefinitionSha256: canonicalIds.definitionSha256,
    taxonomyDefinitionSha256: taxonomy.definitionSha256,
    familyPolicyDefinitionSha256: familyPolicy.definitionSha256,
    hatchPolicyDefinitionSha256: hatchPolicy.definitionSha256,
    compilerDefinitionSha256: compilerHash,
    adjudicationIds: [],
  },
  sourceHashes: provenanceHashes,
})

const validFamilySpec = () => withDefinitionHash({
  schemaVersion: 1,
  familyId: 'family:abra',
  familyRootSpeciesId: 'abra',
  offspringRootSpeciesId: 'abra',
  memberSpeciesIds: ['abra', 'alakazam', 'kadabra'],
  evolutionEdges: [
    { fromSpeciesId: 'abra', toSpeciesId: 'kadabra', kind: 'evolves-to' },
    { fromSpeciesId: 'kadabra', toSpeciesId: 'alakazam', kind: 'evolves-to' },
  ],
  formPolicies: [
    { speciesId: 'abra', formKindId: 'base-species', formPolicyId: 'own-form-root' },
    { speciesId: 'alakazam', formKindId: 'base-species', formPolicyId: 'base-family-root' },
    { speciesId: 'kadabra', formKindId: 'base-species', formPolicyId: 'base-family-root' },
  ],
  sourceHashes: provenanceHashes,
})

const rehash = <T extends Record<string, unknown> & { definitionSha256: string }>(value: T): T => {
  const { definitionSha256: _old, ...definition } = value
  return { ...definition, definitionSha256: hashDefinition(definition) } as T
}

const expectCode = (callback: () => unknown, code: string, path?: string): BreedingSpecValidationError => {
  let caught: unknown
  try { callback() }
  catch (error) { caught = error }
  expect(caught).toBeInstanceOf(BreedingSpecValidationError)
  expect(caught).toMatchObject({ code, ...(path ? { path } : {}) })
  return caught as BreedingSpecValidationError
}

describe('breeding Species and Family spec schemas', () => {
  it('freezes exact schemas, bounds, diagnostics, and upstream definition links', () => {
    expect(schema).toMatchObject({
      schemaVersion: 1,
      schemaId: 'ptu-1.05-breeding-spec-schemas-v1',
      rulesetDefinitionSha256: ruleset.definitionSha256,
      taxonomyDefinitionSha256: taxonomy.definitionSha256,
      canonicalIdDefinitionSha256: canonicalIds.definitionSha256,
      familyPolicyDefinitionSha256: familyPolicy.definitionSha256,
      hatchPolicyDefinitionSha256: hatchPolicy.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
    })
    expect(schema.definitionSha256).toBe(hashDefinition(schema.definition))
    expect(schema.definition.specVersion).toBe(1)
    expect(schema.definition.limits).toEqual(BREEDING_SPEC_LIMITS)
    expect(schema.definition.invariants).toContain('source-gap-specs-are-never-emitted')
    expect(schema.definition.invariants).toContain('definition-hash-covers-all-fields-except-definitionSha256')
    expect(schema.definition.diagnosticContract).toMatchObject({ rawValue: 'never' })
    expect(BREEDING_FORM_KIND_IDS).toHaveLength(10)
    expect(BREEDING_FORM_POLICY_IDS).toHaveLength(4)
    expect(BREEDING_ELIGIBILITY_IDS).toEqual(['breedable', 'no-breeding', 'special-source-only', 'source-gap'])
    expect(BREEDING_ELIGIBILITY_EVIDENCE_IDS).toEqual([
      'compiled-spec', 'source-bound-species-adjudication', 'typed-campaign-override',
    ])
  })

  it('parses, hashes, clones, and deeply freezes a complete Species spec', () => {
    const input = validSpeciesSpec()
    const parsed = parseCanonicalBreedingSpeciesSpecV1(input)
    expect(parsed).toEqual(input)
    expect(parsed).not.toBe(input)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.eggGroupIds)).toBe(true)
    expect(Object.isFrozen(parsed.genderPolicy)).toBe(true)
    expect(Object.isFrozen(parsed.provenance)).toBe(true)
    expect(Object.isFrozen(parsed.provenance.adjudicationIds)).toBe(true)
    expect(Object.isFrozen(parsed.sourceHashes)).toBe(true)
  })

  it('rejects malformed Species shapes, unknown identities, source gaps, invalid bounds, and hash drift', () => {
    const unknownField = { ...validSpeciesSpec(), privateNote: 'do-not-echo' }
    const shapeError = expectCode(
      () => parseCanonicalBreedingSpeciesSpecV1(unknownField),
      'breeding.spec.unknown-field',
      'speciesSpec',
    )
    expect(shapeError.message).not.toContain('privateNote')
    expect(shapeError.message).not.toContain('do-not-echo')

    const unknownSpecies = clone(validSpeciesSpec())
    unknownSpecies.speciesId = 'unknown-species'
    expectCode(() => parseCanonicalBreedingSpeciesSpecV1(unknownSpecies), 'breeding.spec.unknown-id', 'speciesSpec.speciesId')

    const sourceGap = clone(validSpeciesSpec())
    sourceGap.eligibilityId = 'source-gap'
    expectCode(() => parseCanonicalBreedingSpeciesSpecV1(sourceGap), 'breeding.spec.invariant', 'speciesSpec.eligibilityId')

    const noGroups = clone(validSpeciesSpec())
    noGroups.eggGroupIds = []
    expectCode(() => parseCanonicalBreedingSpeciesSpecV1(noGroups), 'breeding.spec.limit-exceeded', 'speciesSpec.eggGroupIds')

    const badRatio = clone(validSpeciesSpec())
    badRatio.genderPolicy = { kind: 'ratio', femalePercent: 12.55 }
    expectCode(() => parseCanonicalBreedingSpeciesSpecV1(badRatio), 'breeding.spec.invalid-number', 'speciesSpec.genderPolicy.femalePercent')

    const missingSourceHash = clone(validSpeciesSpec())
    missingSourceHash.sourceHashes = missingSourceHash.sourceHashes.filter(value => value !== compilerHash)
    expectCode(() => parseCanonicalBreedingSpeciesSpecV1(missingSourceHash), 'breeding.spec.invariant', 'speciesSpec.sourceHashes')

    const wrongFamily = clone(validSpeciesSpec())
    wrongFamily.familyId = 'family:kadabra'
    expectCode(() => parseCanonicalBreedingSpeciesSpecV1(wrongFamily), 'breeding.spec.invariant', 'speciesSpec.familyId')

    const drift = clone(validSpeciesSpec())
    drift.hatchCampaignMinutes += 1
    expectCode(() => parseCanonicalBreedingSpeciesSpecV1(drift), 'breeding.spec.invalid-hash', 'speciesSpec.definitionSha256')
  })

  it('rejects non-data properties, symbols, duplicate and unsorted arrays before reading attacker values', () => {
    const getter = validSpeciesSpec()
    Object.defineProperty(getter, 'speciesId', { enumerable: true, get: () => { throw new Error('getter executed') } })
    const getterError = expectCode(() => parseCanonicalBreedingSpeciesSpecV1(getter), 'breeding.spec.not-object', 'speciesSpec')
    expect(getterError.message).not.toContain('getter executed')

    const symbol = validSpeciesSpec() as Record<PropertyKey, unknown>
    symbol[Symbol('private')] = 'secret'
    expectCode(() => parseCanonicalBreedingSpeciesSpecV1(symbol), 'breeding.spec.unknown-field', 'speciesSpec')

    const duplicate = clone(validSpeciesSpec())
    duplicate.basicAbilityIds = ['inner-focus', 'inner-focus']
    expectCode(() => parseCanonicalBreedingSpeciesSpecV1(duplicate), 'breeding.spec.duplicate-id', 'speciesSpec.basicAbilityIds')

    const unsorted = clone(validSpeciesSpec())
    unsorted.basicAbilityIds = ['synchronize', 'inner-focus']
    expectCode(() => parseCanonicalBreedingSpeciesSpecV1(unsorted), 'breeding.spec.invalid-order', 'speciesSpec.basicAbilityIds')
  })

  it('parses a complete Family DAG and enforces roots, reachability, endpoints, form closure, order, and hash', () => {
    const input = validFamilySpec()
    const parsed = parseCanonicalBreedingFamilySpecV1(input)
    expect(parsed).toEqual(input)
    expect(parsed).not.toBe(input)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.memberSpeciesIds)).toBe(true)
    expect(Object.isFrozen(parsed.evolutionEdges)).toBe(true)
    expect(Object.isFrozen(parsed.evolutionEdges[0])).toBe(true)
    expect(Object.isFrozen(parsed.formPolicies)).toBe(true)

    const rootIncoming = clone(input)
    rootIncoming.evolutionEdges = [
      { fromSpeciesId: 'abra', toSpeciesId: 'kadabra', kind: 'evolves-to' },
      { fromSpeciesId: 'kadabra', toSpeciesId: 'abra', kind: 'evolves-to' },
      { fromSpeciesId: 'kadabra', toSpeciesId: 'alakazam', kind: 'evolves-to' },
    ]
    expectCode(() => parseCanonicalBreedingFamilySpecV1(rootIncoming), 'breeding.spec.invariant', 'familySpec.evolutionEdges')

    const unreachable = clone(input)
    unreachable.evolutionEdges = [{ fromSpeciesId: 'abra', toSpeciesId: 'kadabra', kind: 'evolves-to' }]
    expectCode(() => parseCanonicalBreedingFamilySpecV1(unreachable), 'breeding.spec.invariant', 'familySpec.evolutionEdges')

    const external = clone(input)
    external.evolutionEdges[0]!.toSpeciesId = 'bulbasaur'
    expectCode(() => parseCanonicalBreedingFamilySpecV1(external), 'breeding.spec.invariant', 'familySpec.evolutionEdges')

    const forms = clone(input)
    forms.formPolicies = forms.formPolicies.slice(0, 2)
    expectCode(() => parseCanonicalBreedingFamilySpecV1(forms), 'breeding.spec.invariant', 'familySpec.formPolicies')

    const order = clone(input)
    order.evolutionEdges.reverse()
    expectCode(() => parseCanonicalBreedingFamilySpecV1(order), 'breeding.spec.invalid-order', 'familySpec.evolutionEdges')

    const drift = clone(input)
    drift.offspringRootSpeciesId = 'kadabra'
    expectCode(() => parseCanonicalBreedingFamilySpecV1(drift), 'breeding.spec.invalid-hash', 'familySpec.definitionSha256')
  })

  it('projects stable diagnostics without exposing source values to public or GM audiences', () => {
    const invalid = clone(validSpeciesSpec())
    invalid.speciesId = 'private-campaign-species'
    const error = expectCode(() => parseCanonicalBreedingSpeciesSpecV1(invalid), 'breeding.spec.unknown-id')
    expect(projectBreedingSpecDiagnostic(error, 'public')).toEqual({ code: 'breeding.spec.unknown-id' })
    expect(projectBreedingSpecDiagnostic(error, 'gm')).toEqual({
      code: 'breeding.spec.unknown-id',
      path: 'speciesSpec.speciesId',
    })
    expect(projectBreedingSpecDiagnostic(error, 'maintenance')).toEqual({
      code: 'breeding.spec.unknown-id',
      path: 'speciesSpec.speciesId',
      message: 'speciesSpec.speciesId: must identify a registered Species.',
    })
    expect(JSON.stringify(projectBreedingSpecDiagnostic(error, 'public'))).not.toContain('private-campaign-species')
    expect(JSON.stringify(projectBreedingSpecDiagnostic(error, 'gm'))).not.toContain('private-campaign-species')
  })

  it('uses exact app-owned identity sets and a deterministic SHA-256 callback', () => {
    expect(BREEDING_SPEC_IDENTITY_REGISTRY.speciesIds.size).toBe(1_149)
    expect(BREEDING_SPEC_IDENTITY_REGISTRY.moveIds.size).toBe(777)
    expect(BREEDING_SPEC_IDENTITY_REGISTRY.abilityIds.size).toBe(483)
    expect(BREEDING_SPEC_IDENTITY_REGISTRY.eggGroupIds.size).toBe(14)
    expect(BREEDING_SPEC_IDENTITY_REGISTRY.definitionSha256({ b: 2, a: 1 }))
      .toBe(hashDefinition({ a: 1, b: 2 }))
  })
})
