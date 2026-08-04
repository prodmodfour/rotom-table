import { createHash } from 'node:crypto'
import taxonomyJson from '../../../data/breeding-automation/taxonomies.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_ELIGIBILITY_EVIDENCE_IDS,
  BREEDING_ELIGIBILITY_IDS,
  BREEDING_FORM_KIND_IDS,
  BREEDING_FORM_POLICY_IDS,
  parseBreedingFamilySpecV1,
  parseBreedingSpeciesSpecV1,
  type BreedingFamilySpecV1,
  type BreedingSpeciesSpecV1,
  type BreedingSpecIdentityRegistry,
} from '#shared/breeding/specs'
import {
  BREEDING_CANONICAL_ABILITIES,
  BREEDING_CANONICAL_EGG_GROUPS,
  BREEDING_CANONICAL_MOVES,
  BREEDING_CANONICAL_SPECIES,
} from './canonicalIds'

interface TaxonomyIdRow { id: string }
interface TaxonomySource {
  definition: {
    formKinds: TaxonomyIdRow[]
    formRootPolicies: TaxonomyIdRow[]
    breedingEligibility: TaxonomyIdRow[]
    eligibilityEvidenceKinds: Array<TaxonomyIdRow & { authoritative: boolean }>
  }
}
const taxonomy = taxonomyJson as TaxonomySource
const exactIds = (actual: readonly TaxonomyIdRow[], expected: readonly string[], label: string): ReadonlySet<string> => {
  const values = actual.map(row => row.id)
  if (values.length !== expected.length || values.some((value, index) => value !== expected[index])) {
    throw new Error(`Breeding ${label} taxonomy does not match the spec schema.`)
  }
  return new Set(values)
}

const formKindIds = exactIds(taxonomy.definition.formKinds, BREEDING_FORM_KIND_IDS, 'form-kind')
const formPolicyIds = exactIds(taxonomy.definition.formRootPolicies, BREEDING_FORM_POLICY_IDS, 'form-policy')
const eligibilityIds = exactIds(taxonomy.definition.breedingEligibility, BREEDING_ELIGIBILITY_IDS, 'eligibility')
const authoritativeEvidence = taxonomy.definition.eligibilityEvidenceKinds.filter(row => row.authoritative)
const eligibilityEvidenceIds = exactIds(authoritativeEvidence, BREEDING_ELIGIBILITY_EVIDENCE_IDS, 'eligibility-evidence')

export const BREEDING_SPEC_IDENTITY_REGISTRY: BreedingSpecIdentityRegistry = Object.freeze({
  speciesIds: new Set(BREEDING_CANONICAL_SPECIES.map(row => row.id)),
  eggGroupIds: new Set(BREEDING_CANONICAL_EGG_GROUPS.map(row => row.id)),
  moveIds: new Set(BREEDING_CANONICAL_MOVES.map(row => row.id)),
  abilityIds: new Set(BREEDING_CANONICAL_ABILITIES.map(row => row.id)),
  formKindIds,
  formPolicyIds,
  eligibilityIds,
  eligibilityEvidenceIds,
  definitionSha256: (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex'),
})

export const parseCanonicalBreedingSpeciesSpecV1 = (value: unknown, path?: string): BreedingSpeciesSpecV1 => (
  parseBreedingSpeciesSpecV1(value, BREEDING_SPEC_IDENTITY_REGISTRY, path)
)

export const parseCanonicalBreedingFamilySpecV1 = (value: unknown, path?: string): BreedingFamilySpecV1 => (
  parseBreedingFamilySpecV1(value, BREEDING_SPEC_IDENTITY_REGISTRY, path)
)
