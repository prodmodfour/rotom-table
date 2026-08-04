import { createHash } from 'node:crypto'
import compiledRegistryJson from '../../../data/breeding-automation/compiled-registry.json'
import compilerReportJson from '../../../data/breeding-automation/compiler-validation-report.json'
import compilerDefinitionJson from '../../../data/breeding-automation/compiler-definition.json'
import familyResolutionsJson from '../../../data/breeding-automation/family-resolutions.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingFamilySpecV1,
  parseBreedingSpeciesSpecV1,
  type BreedingFamilySpecV1,
  type BreedingSpeciesSpecV1,
} from '#shared/breeding/specs'
import {
  parseBreedingFamilyIdSyntax,
  parseBreedingSpeciesIdSyntax,
  type BreedingFamilyId,
  type BreedingSpeciesId,
} from '#shared/breeding/ids'
import { isCanonicalBreedingSpeciesId } from './canonicalIds'
import { BREEDING_SPEC_IDENTITY_REGISTRY } from './specSchemaContext'

export const COMPILED_BREEDING_REGISTRY_SCHEMA_VERSION = 1 as const
export const COMPILED_BREEDING_SPECIES_COUNT = 862 as const
export const COMPILED_BREEDING_FAMILY_COUNT = 407 as const

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const definitionSha256 = (value: unknown): string => sha256(stableJsonStringify(value))
const compare = (left: string, right: string): number => left === right ? 0 : left < right ? -1 : 1
const raw = compiledRegistryJson as Record<string, any>
const report = compilerReportJson as Record<string, any>
const { definitionSha256: rawDefinitionSha256, ...rawDefinition } = raw
if (raw.schemaVersion !== COMPILED_BREEDING_REGISTRY_SCHEMA_VERSION
  || raw.registryId !== 'ptu-1.05-breeding-compiled-registry-v1'
  || raw.compilerDefinitionSha256 !== compilerDefinitionJson.definitionSha256
  || raw.familyResolutionDefinitionSha256 !== familyResolutionsJson.definitionSha256
  || definitionSha256(rawDefinition) !== rawDefinitionSha256
  || !Array.isArray(raw.familySpecs)
  || !Array.isArray(raw.speciesSpecs)) {
  throw new Error('Compiled breeding registry identity, provenance, or definition hash is invalid.')
}

const families = raw.familySpecs.map((value: unknown, index: number) => (
  parseBreedingFamilySpecV1(value, BREEDING_SPEC_IDENTITY_REGISTRY, `compiledRegistry.familySpecs[${index}]`)
))
const species = raw.speciesSpecs.map((value: unknown, index: number) => (
  parseBreedingSpeciesSpecV1(value, BREEDING_SPEC_IDENTITY_REGISTRY, `compiledRegistry.speciesSpecs[${index}]`)
))
if (families.length !== COMPILED_BREEDING_FAMILY_COUNT
  || species.length !== COMPILED_BREEDING_SPECIES_COUNT
  || families.some((family: BreedingFamilySpecV1, index: number) => index > 0 && families[index - 1]!.familyId >= family.familyId)
  || species.some((spec: BreedingSpeciesSpecV1, index: number) => index > 0 && species[index - 1]!.speciesId >= spec.speciesId)) {
  throw new Error('Compiled breeding registry counts or deterministic order are invalid.')
}
const familyById = new Map<BreedingFamilyId, BreedingFamilySpecV1>(families.map((family: BreedingFamilySpecV1) => [family.familyId, family]))
const speciesById = new Map<BreedingSpeciesId, BreedingSpeciesSpecV1>(species.map((spec: BreedingSpeciesSpecV1) => [spec.speciesId, spec]))
if (familyById.size !== families.length || speciesById.size !== species.length) {
  throw new Error('Compiled breeding registry contains duplicate identities.')
}
for (const family of families as BreedingFamilySpecV1[]) {
  if (family.memberSpeciesIds.some(member => speciesById.get(member)?.familyId !== family.familyId)) {
    throw new Error('Compiled breeding Family membership does not close over Species specs.')
  }
}
for (const spec of species as BreedingSpeciesSpecV1[]) {
  if (!familyById.has(spec.familyId)) throw new Error('Compiled breeding Species references an unavailable Family.')
}
const { definitionSha256: reportDefinitionSha256, ...reportDefinition } = report
if (report.schemaVersion !== 1
  || report.reportId !== 'ptu-1.05-breeding-compiler-validation-v1'
  || report.registryDefinitionSha256 !== raw.definitionSha256
  || definitionSha256(reportDefinition) !== reportDefinitionSha256
  || report.summary?.compiledSpeciesCount !== species.length
  || report.summary?.compiledFamilyCount !== families.length
  || !Array.isArray(report.excludedSpecies)) {
  throw new Error('Compiled breeding validation report is inconsistent with the registry.')
}
const excludedReasons = new Map<BreedingSpeciesId, readonly string[]>(report.excludedSpecies.map((row: any) => {
  if (!isCanonicalBreedingSpeciesId(row.speciesId)
    || !Array.isArray(row.reasonCodes)
    || row.reasonCodes.length < 1
    || row.reasonCodes.some((reason: unknown) => typeof reason !== 'string')) {
    throw new Error('Compiled breeding exclusion row is invalid.')
  }
  return [row.speciesId, Object.freeze([...row.reasonCodes].sort(compare))]
}))
if (excludedReasons.size + speciesById.size !== BREEDING_SPEC_IDENTITY_REGISTRY.speciesIds.size) {
  throw new Error('Compiled breeding availability does not close over canonical Species IDs.')
}

export const COMPILED_BREEDING_FAMILIES: readonly BreedingFamilySpecV1[] = Object.freeze(families)
export const COMPILED_BREEDING_SPECIES: readonly BreedingSpeciesSpecV1[] = Object.freeze(species)
export const COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256 = raw.definitionSha256 as string
export const COMPILED_BREEDING_REPORT_DEFINITION_SHA256 = report.definitionSha256 as string

export const compiledBreedingSpeciesSpec = (value: unknown): BreedingSpeciesSpecV1 | null => {
  const speciesId = parseBreedingSpeciesIdSyntax(value)
  return speciesId ? speciesById.get(speciesId) ?? null : null
}
export const compiledBreedingFamilySpec = (value: unknown): BreedingFamilySpecV1 | null => {
  const familyId = parseBreedingFamilyIdSyntax(value)
  return familyId ? familyById.get(familyId) ?? null : null
}

export type CompiledBreedingSpeciesAvailability =
  | { readonly status: 'available', readonly speciesId: BreedingSpeciesId, readonly spec: BreedingSpeciesSpecV1 }
  | { readonly status: 'unavailable', readonly speciesId: BreedingSpeciesId | null, readonly reasonId: 'breeding.species-spec-missing' }

export const compiledBreedingSpeciesAvailability = (value: unknown): CompiledBreedingSpeciesAvailability => {
  const speciesId = parseBreedingSpeciesIdSyntax(value)
  if (!speciesId || !isCanonicalBreedingSpeciesId(speciesId)) {
    return Object.freeze({ status: 'unavailable', speciesId: null, reasonId: 'breeding.species-spec-missing' })
  }
  const spec = speciesById.get(speciesId)
  return spec
    ? Object.freeze({ status: 'available', speciesId, spec })
    : Object.freeze({ status: 'unavailable', speciesId, reasonId: 'breeding.species-spec-missing' })
}

/** Maintenance-only reason detail; never include this array in public or owner projections. */
export const compiledBreedingMaintenanceExclusionReasons = (value: unknown): readonly string[] => {
  const speciesId = parseBreedingSpeciesIdSyntax(value)
  return speciesId ? excludedReasons.get(speciesId) ?? Object.freeze([]) : Object.freeze([])
}
