import { createHash } from 'node:crypto'
import compilerDefinitionJson from '../../../data/breeding-automation/compiler-definition.json'
import familyPolicyJson from '../../../data/breeding-automation/family-graph-policy.json'
import familyResolutionDefinitionJson from '../../../data/breeding-automation/family-resolution-definition.json'
import hatchPolicyJson from '../../../data/breeding-automation/hatch-duration-policy.json'
import canonicalIdsJson from '../../../data/breeding-automation/canonical-ids.json'
import taxonomyJson from '../../../data/breeding-automation/taxonomies.json'
import evolutionTargetAdjudicationsJson from '../../../data/breeding-automation/evolution-target-adjudications.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingFamilySpecV1,
  parseBreedingSpeciesSpecV1,
  type BreedingFamilySpecV1,
  type BreedingSpeciesSpecV1,
} from '#shared/breeding/specs'
import type {
  BreedingAbilityId,
  BreedingEggGroupId,
  BreedingMoveId,
  BreedingSpeciesId,
} from '#shared/breeding/ids'
import {
  BREEDING_CANONICAL_ABILITIES,
  BREEDING_CANONICAL_MOVES,
  BREEDING_CANONICAL_SPECIES,
} from './canonicalIds'
import { BREEDING_SPEC_IDENTITY_REGISTRY } from './specSchemaContext'

export const BREEDING_COMPILER_VERSION = 1 as const
export const BREEDING_COMPILER_DEFINITION_SHA256 = compilerDefinitionJson.definitionSha256
export const BREEDING_COMPILED_REGISTRY_SCHEMA_VERSION = 1 as const
export const BREEDING_COMPILER_REPORT_SCHEMA_VERSION = 1 as const

export type BreedingCompilerDiagnosticSeverity = 'error' | 'warning'
export type BreedingCompilerDiagnosticCode =
  | 'breeding.compiler.sparse-record'
  | 'breeding.compiler.unknown-source-field'
  | 'breeding.compiler.source-identity-drift'
  | 'breeding.compiler.invalid-egg-groups'
  | 'breeding.compiler.non-ditto-ditto-group'
  | 'breeding.compiler.invalid-gender'
  | 'breeding.compiler.invalid-basic-ability'
  | 'breeding.compiler.missing-hatch-duration'
  | 'breeding.compiler.invalid-hatch-duration'
  | 'breeding.compiler.invalid-egg-move'
  | 'breeding.compiler.unresolved-machine-move'
  | 'breeding.compiler.invalid-evolution-source'
  | 'breeding.compiler.unknown-evolution-target'
  | 'breeding.compiler.family-resolution-missing'
  | 'breeding.compiler.family-resolution-source-mismatch'
  | 'breeding.compiler.spec-validation-failed'

export interface BreedingCompilerDiagnostic {
  readonly code: BreedingCompilerDiagnosticCode
  readonly severity: BreedingCompilerDiagnosticSeverity
  readonly speciesId: BreedingSpeciesId
  readonly sourceIndex: number
  readonly path: string
}
export interface BreedingCompilerExcludedSpecies {
  readonly speciesId: BreedingSpeciesId
  readonly sourceIndex: number
  readonly reasonCodes: readonly BreedingCompilerDiagnosticCode[]
}
export interface BreedingCompilerSummary {
  readonly sourceRecordCount: number
  readonly completeSourceRecordCount: number
  readonly sourceValidCandidateCount: number
  readonly familyResolutionInputCount: number
  readonly compiledFamilyCount: number
  readonly compiledSpeciesCount: number
  readonly excludedSpeciesCount: number
  readonly errorCount: number
  readonly warningCount: number
  readonly diagnosticCounts: Readonly<Record<string, number>>
}
export interface BreedingCompiledRegistryV1 {
  readonly schemaVersion: 1
  readonly registryId: 'ptu-1.05-breeding-compiled-registry-v1'
  readonly rulesetId: string
  readonly compilerDefinitionSha256: string
  readonly sourcePokedexSha256: string
  readonly familyResolutionDefinitionSha256: string
  readonly familySpecs: readonly BreedingFamilySpecV1[]
  readonly speciesSpecs: readonly BreedingSpeciesSpecV1[]
  readonly definitionSha256: string
}
export interface BreedingCompilerValidationReportV1 {
  readonly schemaVersion: 1
  readonly reportId: 'ptu-1.05-breeding-compiler-validation-v1'
  readonly compilerDefinitionSha256: string
  readonly registryDefinitionSha256: string
  readonly familyResolutionDefinitionSha256: string
  readonly summary: BreedingCompilerSummary
  readonly diagnostics: readonly BreedingCompilerDiagnostic[]
  readonly excludedSpecies: readonly BreedingCompilerExcludedSpecies[]
  readonly definitionSha256: string
}
export interface CompileBreedingRegistryResult {
  readonly registry: BreedingCompiledRegistryV1
  readonly report: BreedingCompilerValidationReportV1
}

export class BreedingCompilerInputError extends Error {
  readonly code: 'invalid-source-catalog' | 'invalid-family-resolutions'
  constructor(code: BreedingCompilerInputError['code'], message: string) {
    super(message)
    this.name = 'BreedingCompilerInputError'
    this.code = code
  }
}

interface EvolutionSource { readonly stage: number, readonly speciesId: BreedingSpeciesId }
interface SourceCandidate {
  readonly speciesId: BreedingSpeciesId
  readonly sourceIndex: number
  readonly sourceRecordSha256: string
  readonly eggGroupIds: readonly BreedingEggGroupId[]
  readonly genderPolicy: { readonly kind: 'ratio', readonly femalePercent: number } | { readonly kind: 'genderless' }
  readonly basicAbilityIds: readonly BreedingAbilityId[]
  readonly hatchCampaignMinutes: number | null
  readonly eggMoveIds: readonly BreedingMoveId[]
  readonly machineCompatibleMoveIds: readonly BreedingMoveId[]
  readonly evolutions: readonly EvolutionSource[]
}
interface RawFamilyResolutionSet {
  readonly schemaVersion: number
  readonly resolutionSetId: string
  readonly rulesetId: string
  readonly compilerDefinitionSha256: string
  readonly resolutionDefinitionSha256: string
  readonly definitionSha256: string
  readonly definition: {
    readonly status: 'awaiting-reviewed-family-resolution' | 'reviewed-complete'
    readonly familySpecs: readonly unknown[]
    readonly policies: {
      readonly missingResolution: 'fail-closed-exclude'
      readonly runtimeDerivation: 'forbidden'
      readonly nextOwnerTicket: 'BR-013'
    }
  }
}

const sourceDefinition = compilerDefinitionJson.definition.source
const SOURCE_FIELDS = new Set(sourceDefinition.exactKnownFields)
const REQUIRED_FIELDS = sourceDefinition.requiredBreedingFields as readonly string[]
const SOURCE_POKEDEX_SHA256 = sourceDefinition.sha256
const CANONICAL_ID_DEFINITION_SHA256 = canonicalIdsJson.definitionSha256
const TAXONOMY_DEFINITION_SHA256 = taxonomyJson.definitionSha256
const FAMILY_POLICY_DEFINITION_SHA256 = familyPolicyJson.definitionSha256
const HATCH_POLICY_DEFINITION_SHA256 = hatchPolicyJson.definitionSha256
const EVOLUTION_TARGET_ADJUDICATIONS_DEFINITION_SHA256 = evolutionTargetAdjudicationsJson.definitionSha256
const FORM_ADJUDICATIONS_DEFINITION_SHA256 = compilerDefinitionJson.definition.bindings.formAdjudicationsDefinitionSha256
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const definitionSha256 = (value: unknown): string => sha256(stableJsonStringify(value))
const codePointSort = (left: string, right: string): number => left === right ? 0 : left < right ? -1 : 1
const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
const exactDataRecord = (value: unknown): value is Record<string, unknown> => {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return false
  return Object.getOwnPropertyNames(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor?.enumerable && 'value' in descriptor)
  })
}

const severityByCode = new Map<string, BreedingCompilerDiagnosticSeverity>(
  compilerDefinitionJson.definition.diagnostics.map(row => [row.code, row.severity as BreedingCompilerDiagnosticSeverity]),
)
const speciesBySourceName = new Map(BREEDING_CANONICAL_SPECIES.map(row => [row.sourceName, row]))
const speciesById = new Map(BREEDING_CANONICAL_SPECIES.map(row => [row.id, row]))
const evolutionTargetAdjudications = new Map(
  evolutionTargetAdjudicationsJson.definition.entries.map(row => [row.sourceValue, row]),
)
const moveBySourceName = new Map(BREEDING_CANONICAL_MOVES.map(row => [row.sourceName, row]))
const abilityBySourceName = new Map(BREEDING_CANONICAL_ABILITIES.map(row => [row.sourceName, row]))
const eggGroupsBySourceCell = new Map(
  taxonomyJson.definition.eggGroupSourceCells.map(row => [row.sourceValue, row.eggGroupIds as BreedingEggGroupId[]]),
)
const hatchMinutesBySourceValue = new Map(
  hatchPolicyJson.definition.parser.acceptedSourceValues.map(row => [row.sourceValue, row.campaignMinutes]),
)

const freezeDiagnostic = (
  code: BreedingCompilerDiagnosticCode,
  speciesId: BreedingSpeciesId,
  sourceIndex: number,
  path: string,
): BreedingCompilerDiagnostic => Object.freeze({
  code,
  severity: severityByCode.get(code) ?? 'error',
  speciesId,
  sourceIndex,
  path: path.slice(0, 160),
})

const parseFamilyResolutions = (input: RawFamilyResolutionSet): {
  definitionSha256: string
  families: readonly BreedingFamilySpecV1[]
} => {
  if (!exactDataRecord(input)
    || Object.keys(input).sort().join(',') !== 'compilerDefinitionSha256,definition,definitionSha256,resolutionDefinitionSha256,resolutionSetId,rulesetId,schemaVersion'
    || input.schemaVersion !== 1
    || input.resolutionSetId !== 'ptu-1.05-breeding-family-resolutions-v1'
    || input.rulesetId !== compilerDefinitionJson.rulesetId
    || input.compilerDefinitionSha256 !== BREEDING_COMPILER_DEFINITION_SHA256
    || input.resolutionDefinitionSha256 !== familyResolutionDefinitionJson.definitionSha256
    || !/^[0-9a-f]{64}$/.test(input.definitionSha256)
    || !exactDataRecord(input.definition)
    || Object.keys(input.definition).sort().join(',') !== 'familySpecs,policies,status'
    || !['awaiting-reviewed-family-resolution', 'reviewed-complete'].includes(input.definition.status)
    || !exactDataRecord(input.definition.policies)
    || Object.keys(input.definition.policies).sort().join(',') !== 'missingResolution,nextOwnerTicket,runtimeDerivation'
    || input.definition.policies.missingResolution !== 'fail-closed-exclude'
    || input.definition.policies.runtimeDerivation !== 'forbidden'
    || input.definition.policies.nextOwnerTicket !== 'BR-013'
    || definitionSha256(input.definition) !== input.definitionSha256
    || !Array.isArray(input.definition.familySpecs)
    || (input.definition.status === 'awaiting-reviewed-family-resolution' && input.definition.familySpecs.length !== 0)) {
    throw new BreedingCompilerInputError('invalid-family-resolutions', 'Family resolution set identity or definition hash is invalid.')
  }
  const families = input.definition.familySpecs.map((value, index) => {
    try { return parseBreedingFamilySpecV1(value, BREEDING_SPEC_IDENTITY_REGISTRY, `familyResolutions[${index}]`) }
    catch { throw new BreedingCompilerInputError('invalid-family-resolutions', 'Family resolution set contains an invalid Family spec.') }
  })
  if (families.some((family, index) => index > 0 && families[index - 1]!.familyId >= family.familyId)) {
    throw new BreedingCompilerInputError('invalid-family-resolutions', 'Family resolutions must be in strict Family ID order.')
  }
  const memberOwners = new Map<string, string>()
  for (const family of families) {
    for (const member of family.memberSpeciesIds) {
      if (memberOwners.has(member)) {
        throw new BreedingCompilerInputError('invalid-family-resolutions', 'A Species belongs to more than one Family resolution.')
      }
      memberOwners.set(member, family.familyId)
    }
  }
  return { definitionSha256: input.definitionSha256, families: Object.freeze(families) }
}

const parseStringArray = (value: unknown): readonly string[] | null => (
  Array.isArray(value) && value.every(entry => typeof entry === 'string') ? value : null
)

export const compileBreedingRegistry = (
  source: unknown,
  familyResolutionSet: RawFamilyResolutionSet,
): CompileBreedingRegistryResult => {
  if (!Array.isArray(source) || source.length !== sourceDefinition.expectedRows) {
    throw new BreedingCompilerInputError('invalid-source-catalog', 'Canonical Pokédex row count is invalid.')
  }
  const familyResolutions = parseFamilyResolutions(familyResolutionSet)
  const diagnostics: BreedingCompilerDiagnostic[] = []
  const candidates = new Map<BreedingSpeciesId, SourceCandidate>()
  const completeSourceSpecies = new Set<BreedingSpeciesId>()
  const missingHatchSpecies = new Set<BreedingSpeciesId>()
  const errorsBySpecies = new Map<BreedingSpeciesId, Set<BreedingCompilerDiagnosticCode>>()
  const add = (code: BreedingCompilerDiagnosticCode, speciesId: BreedingSpeciesId, sourceIndex: number, path: string): void => {
    diagnostics.push(freezeDiagnostic(code, speciesId, sourceIndex, path))
    if ((severityByCode.get(code) ?? 'error') === 'error') {
      const errors = errorsBySpecies.get(speciesId) ?? new Set<BreedingCompilerDiagnosticCode>()
      errors.add(code)
      errorsBySpecies.set(speciesId, errors)
    }
  }

  for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
    const expectedIdentity = BREEDING_CANONICAL_SPECIES.find(row => row.sourceIndex === sourceIndex)
    if (!expectedIdentity) throw new BreedingCompilerInputError('invalid-source-catalog', 'Canonical Species source index coverage is invalid.')
    const speciesId = expectedIdentity.id
    const path = `pokedex[${sourceIndex}]`
    const raw = source[sourceIndex]
    if (!exactDataRecord(raw)) {
      add('breeding.compiler.sparse-record', speciesId, sourceIndex, path)
      continue
    }
    if (Object.keys(raw).some(key => !SOURCE_FIELDS.has(key))) {
      add('breeding.compiler.unknown-source-field', speciesId, sourceIndex, path)
      continue
    }
    if (raw.species !== expectedIdentity.sourceName
      || definitionSha256(raw) !== expectedIdentity.sourceRecordSha256) {
      add('breeding.compiler.source-identity-drift', speciesId, sourceIndex, path)
      continue
    }
    if (REQUIRED_FIELDS.some(field => !Object.prototype.hasOwnProperty.call(raw, field))) {
      add('breeding.compiler.sparse-record', speciesId, sourceIndex, path)
      continue
    }
    completeSourceSpecies.add(speciesId)

    let sourceValid = true
    const sourceError = (code: BreedingCompilerDiagnosticCode, field: string): void => {
      add(code, speciesId, sourceIndex, `${path}.${field}`)
      sourceValid = false
    }

    const rawGroups = parseStringArray(raw.egg_groups)
    const eggGroupIds: BreedingEggGroupId[] = []
    if (!rawGroups || rawGroups.length < 1) sourceError('breeding.compiler.invalid-egg-groups', 'egg_groups')
    else {
      for (const sourceCell of rawGroups) {
        const resolved = eggGroupsBySourceCell.get(sourceCell)
        if (!resolved) sourceError('breeding.compiler.invalid-egg-groups', 'egg_groups')
        else eggGroupIds.push(...resolved)
      }
    }
    const canonicalEggGroupIds = [...new Set(eggGroupIds)].sort(codePointSort)
    if (speciesId !== 'ditto' && canonicalEggGroupIds.includes('ditto' as BreedingEggGroupId)) {
      sourceError('breeding.compiler.non-ditto-ditto-group', 'egg_groups')
    }

    let genderPolicy: SourceCandidate['genderPolicy'] | null = null
    if (raw.genderless === true && raw.male_pct === null && raw.female_pct === null) {
      genderPolicy = Object.freeze({ kind: 'genderless' })
    }
    else if (raw.genderless === false
      && typeof raw.male_pct === 'number' && Number.isFinite(raw.male_pct)
      && typeof raw.female_pct === 'number' && Number.isFinite(raw.female_pct)
      && raw.male_pct >= 0 && raw.female_pct >= 0
      && raw.male_pct + raw.female_pct === 100
      && Number.isSafeInteger(raw.female_pct * 10)) {
      genderPolicy = Object.freeze({ kind: 'ratio', femalePercent: raw.female_pct })
    }
    else sourceError('breeding.compiler.invalid-gender', 'genderless')

    const rawAbilities = exactDataRecord(raw.abilities) ? raw.abilities : null
    const rawBasicAbilities = rawAbilities ? parseStringArray(rawAbilities.basic) : null
    const basicAbilityIds: BreedingAbilityId[] = []
    if (!rawBasicAbilities || rawBasicAbilities.length < 1) sourceError('breeding.compiler.invalid-basic-ability', 'abilities.basic')
    else {
      for (const sourceName of rawBasicAbilities) {
        const identity = abilityBySourceName.get(sourceName)
        if (!identity) sourceError('breeding.compiler.invalid-basic-ability', 'abilities.basic')
        else basicAbilityIds.push(identity.id)
      }
    }

    let hatchCampaignMinutes: number | null = null
    if (raw.hatch_rate === null) missingHatchSpecies.add(speciesId)
    else if (typeof raw.hatch_rate !== 'string' || !hatchMinutesBySourceValue.has(raw.hatch_rate)) {
      sourceError('breeding.compiler.invalid-hatch-duration', 'hatch_rate')
    }
    else hatchCampaignMinutes = hatchMinutesBySourceValue.get(raw.hatch_rate)!

    const rawEggMoves = parseStringArray(raw.egg_moves)
    const eggMoveIds: BreedingMoveId[] = []
    if (!rawEggMoves) sourceError('breeding.compiler.invalid-egg-move', 'egg_moves')
    else {
      for (const sourceName of rawEggMoves) {
        const identity = moveBySourceName.get(sourceName)
        if (!identity) sourceError('breeding.compiler.invalid-egg-move', 'egg_moves')
        else eggMoveIds.push(identity.id)
      }
    }

    const machineMoveIds: BreedingMoveId[] = []
    if (!Array.isArray(raw.tm_hm_moves)) sourceError('breeding.compiler.unresolved-machine-move', 'tm_hm_moves')
    else {
      for (const entry of raw.tm_hm_moves) {
        if (!exactDataRecord(entry)
          || Object.keys(entry).length !== 3
          || !['kind', 'number', 'name'].every(key => Object.prototype.hasOwnProperty.call(entry, key))
          || typeof entry.kind !== 'string' || typeof entry.number !== 'string' || typeof entry.name !== 'string') {
          sourceError('breeding.compiler.unresolved-machine-move', 'tm_hm_moves')
          continue
        }
        const identity = moveBySourceName.get(entry.name)
        if (!identity) add('breeding.compiler.unresolved-machine-move', speciesId, sourceIndex, `${path}.tm_hm_moves`)
        else machineMoveIds.push(identity.id)
      }
    }

    const evolutions: EvolutionSource[] = []
    if (!Array.isArray(raw.evolutions) || raw.evolutions.length < 1) {
      sourceError('breeding.compiler.invalid-evolution-source', 'evolutions')
    }
    else {
      for (const entry of raw.evolutions) {
        if (!exactDataRecord(entry)
          || Object.keys(entry).some(key => !['stage', 'species', 'min_level', 'condition'].includes(key))
          || !['stage', 'species', 'min_level'].every(key => Object.prototype.hasOwnProperty.call(entry, key))
          || !Number.isSafeInteger(entry.stage) || (entry.stage as number) < 1 || (entry.stage as number) > 3
          || typeof entry.species !== 'string') {
          sourceError('breeding.compiler.invalid-evolution-source', 'evolutions')
          continue
        }
        const adjudication = evolutionTargetAdjudications.get(entry.species)
        const target = speciesBySourceName.get(entry.species)
          ?? (adjudication?.status === 'resolved' && adjudication.speciesId
            ? speciesById.get(adjudication.speciesId)
            : undefined)
        if (!target) sourceError('breeding.compiler.unknown-evolution-target', 'evolutions')
        else evolutions.push(Object.freeze({ stage: entry.stage as number, speciesId: target.id }))
      }
    }

    if (sourceValid && genderPolicy) {
      candidates.set(speciesId, Object.freeze({
        speciesId,
        sourceIndex,
        sourceRecordSha256: expectedIdentity.sourceRecordSha256,
        eggGroupIds: Object.freeze(canonicalEggGroupIds),
        genderPolicy,
        basicAbilityIds: Object.freeze([...new Set(basicAbilityIds)].sort(codePointSort)),
        hatchCampaignMinutes,
        eggMoveIds: Object.freeze([...new Set(eggMoveIds)].sort(codePointSort)),
        machineCompatibleMoveIds: Object.freeze([...new Set(machineMoveIds)].sort(codePointSort)),
        evolutions: Object.freeze(evolutions),
      }))
    }
  }

  const familyByMember = new Map<BreedingSpeciesId, BreedingFamilySpecV1>()
  const validFamilies = new Set<string>()
  for (const family of familyResolutions.families) {
    family.memberSpeciesIds.forEach(member => familyByMember.set(member, family))
    const requiredResolutionHashes = [
      SOURCE_POKEDEX_SHA256,
      BREEDING_COMPILER_DEFINITION_SHA256,
      CANONICAL_ID_DEFINITION_SHA256,
      FAMILY_POLICY_DEFINITION_SHA256,
      EVOLUTION_TARGET_ADJUDICATIONS_DEFINITION_SHA256,
      FORM_ADJUDICATIONS_DEFINITION_SHA256,
    ]
    const valid = family.memberSpeciesIds.every(member => candidates.has(member))
      && candidates.get(family.offspringRootSpeciesId)?.hatchCampaignMinutes !== null
      && family.formPolicies.every(policy => policy.formPolicyId !== 'requires-adjudication' && policy.formPolicyId !== 'not-breedable-form')
      && requiredResolutionHashes.every(hash => family.sourceHashes.includes(hash))
    if (valid) validFamilies.add(family.familyId)
    else {
      for (const member of family.memberSpeciesIds) {
        const identity = BREEDING_CANONICAL_SPECIES.find(row => row.id === member)!
        add('breeding.compiler.family-resolution-source-mismatch', member, identity.sourceIndex, `family:${family.familyId}`)
      }
    }
  }

  for (const speciesId of missingHatchSpecies) {
    const family = familyByMember.get(speciesId)
    const resolvedFromOffspringRoot = Boolean(
      family
      && validFamilies.has(family.familyId)
      && candidates.get(family.offspringRootSpeciesId)?.hatchCampaignMinutes !== null,
    )
    if (!resolvedFromOffspringRoot) {
      const identity = BREEDING_CANONICAL_SPECIES.find(row => row.id === speciesId)!
      add('breeding.compiler.missing-hatch-duration', speciesId, identity.sourceIndex, `pokedex[${identity.sourceIndex}].hatch_rate`)
    }
  }

  const speciesSpecs: BreedingSpeciesSpecV1[] = []
  for (const candidate of [...candidates.values()].sort((left, right) => codePointSort(left.speciesId, right.speciesId))) {
    if ((errorsBySpecies.get(candidate.speciesId)?.size ?? 0) > 0) continue
    const family = familyByMember.get(candidate.speciesId)
    if (!family) {
      add('breeding.compiler.family-resolution-missing', candidate.speciesId, candidate.sourceIndex, `pokedex[${candidate.sourceIndex}].evolutions`)
      continue
    }
    if (!validFamilies.has(family.familyId)) continue
    const form = family.formPolicies.find(policy => policy.speciesId === candidate.speciesId)!
    const resolvedHatchCampaignMinutes = candidates.get(family.offspringRootSpeciesId)?.hatchCampaignMinutes
    if (resolvedHatchCampaignMinutes === null || resolvedHatchCampaignMinutes === undefined) {
      add('breeding.compiler.missing-hatch-duration', candidate.speciesId, candidate.sourceIndex, `compiledSpecies.${candidate.speciesId}.hatchCampaignMinutes`)
      continue
    }
    const sourceHashes = [...new Set([
      candidate.sourceRecordSha256,
      CANONICAL_ID_DEFINITION_SHA256,
      TAXONOMY_DEFINITION_SHA256,
      FAMILY_POLICY_DEFINITION_SHA256,
      HATCH_POLICY_DEFINITION_SHA256,
      EVOLUTION_TARGET_ADJUDICATIONS_DEFINITION_SHA256,
      FORM_ADJUDICATIONS_DEFINITION_SHA256,
      BREEDING_COMPILER_DEFINITION_SHA256,
      family.definitionSha256,
    ])].sort(codePointSort)
    const definition = {
      schemaVersion: 1 as const,
      speciesId: candidate.speciesId,
      familyId: family.familyId,
      familyRootSpeciesId: family.familyRootSpeciesId,
      formKindId: form.formKindId,
      formPolicyId: form.formPolicyId,
      eligibilityId: form.formPolicyId === 'not-breedable-form' ? 'no-breeding' as const : 'breedable' as const,
      eligibilityEvidenceId: 'compiled-spec' as const,
      eggGroupIds: candidate.eggGroupIds,
      genderPolicy: candidate.genderPolicy,
      basicAbilityIds: candidate.basicAbilityIds,
      hatchCampaignMinutes: resolvedHatchCampaignMinutes,
      eggMoveIds: candidate.eggMoveIds,
      machineCompatibleMoveIds: candidate.machineCompatibleMoveIds,
      provenance: Object.freeze({
        sourcePath: 'data/reference/pokedex.json' as const,
        sourceIndex: candidate.sourceIndex,
        sourceRecordSha256: candidate.sourceRecordSha256,
        canonicalIdDefinitionSha256: CANONICAL_ID_DEFINITION_SHA256,
        taxonomyDefinitionSha256: TAXONOMY_DEFINITION_SHA256,
        familyPolicyDefinitionSha256: FAMILY_POLICY_DEFINITION_SHA256,
        hatchPolicyDefinitionSha256: HATCH_POLICY_DEFINITION_SHA256,
        compilerDefinitionSha256: BREEDING_COMPILER_DEFINITION_SHA256,
        adjudicationIds: Object.freeze([] as string[]),
      }),
      sourceHashes: Object.freeze(sourceHashes),
    }
    const input = { ...definition, definitionSha256: definitionSha256(definition) }
    try { speciesSpecs.push(parseBreedingSpeciesSpecV1(input, BREEDING_SPEC_IDENTITY_REGISTRY, `compiledSpecies.${candidate.speciesId}`)) }
    catch { add('breeding.compiler.spec-validation-failed', candidate.speciesId, candidate.sourceIndex, `compiledSpecies.${candidate.speciesId}`) }
  }

  const emittedSpeciesIds = new Set(speciesSpecs.map(spec => spec.speciesId))
  const familySpecs = familyResolutions.families.filter(family => (
    validFamilies.has(family.familyId) && family.memberSpeciesIds.every(member => emittedSpeciesIds.has(member))
  ))
  const emittedFamilyIds = new Set(familySpecs.map(family => family.familyId))
  const finalSpeciesSpecs = speciesSpecs.filter(spec => emittedFamilyIds.has(spec.familyId))
  for (const spec of speciesSpecs) {
    if (!emittedFamilyIds.has(spec.familyId)) {
      add('breeding.compiler.family-resolution-source-mismatch', spec.speciesId, spec.provenance.sourceIndex, `compiledSpecies.${spec.speciesId}.familyId`)
    }
  }

  diagnostics.sort((left, right) => left.sourceIndex - right.sourceIndex
    || codePointSort(left.code, right.code)
    || codePointSort(left.path, right.path))
  const excludedSpecies: BreedingCompilerExcludedSpecies[] = BREEDING_CANONICAL_SPECIES
    .filter(identity => !finalSpeciesSpecs.some(spec => spec.speciesId === identity.id))
    .map(identity => Object.freeze({
      speciesId: identity.id,
      sourceIndex: identity.sourceIndex,
      reasonCodes: Object.freeze([
        ...new Set(diagnostics
          .filter(diagnostic => diagnostic.speciesId === identity.id && diagnostic.severity === 'error')
          .map(diagnostic => diagnostic.code)),
      ].sort(codePointSort)),
    }))
    .sort((left, right) => codePointSort(left.speciesId, right.speciesId))
  const diagnosticCounts = Object.fromEntries([...severityByCode.keys()].sort(codePointSort).map(code => [
    code,
    diagnostics.filter(diagnostic => diagnostic.code === code).length,
  ]))
  const summary: BreedingCompilerSummary = Object.freeze({
    sourceRecordCount: source.length,
    completeSourceRecordCount: completeSourceSpecies.size,
    sourceValidCandidateCount: candidates.size,
    familyResolutionInputCount: familyResolutions.families.length,
    compiledFamilyCount: familySpecs.length,
    compiledSpeciesCount: finalSpeciesSpecs.length,
    excludedSpeciesCount: excludedSpecies.length,
    errorCount: diagnostics.filter(diagnostic => diagnostic.severity === 'error').length,
    warningCount: diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length,
    diagnosticCounts: Object.freeze(diagnosticCounts),
  })
  const registryDefinition = Object.freeze({
    schemaVersion: BREEDING_COMPILED_REGISTRY_SCHEMA_VERSION,
    registryId: 'ptu-1.05-breeding-compiled-registry-v1' as const,
    rulesetId: compilerDefinitionJson.rulesetId,
    compilerDefinitionSha256: BREEDING_COMPILER_DEFINITION_SHA256,
    sourcePokedexSha256: SOURCE_POKEDEX_SHA256,
    familyResolutionDefinitionSha256: familyResolutions.definitionSha256,
    familySpecs: Object.freeze(familySpecs),
    speciesSpecs: Object.freeze(finalSpeciesSpecs),
  })
  const registry: BreedingCompiledRegistryV1 = Object.freeze({
    ...registryDefinition,
    definitionSha256: definitionSha256(registryDefinition),
  })
  const reportDefinition = Object.freeze({
    schemaVersion: BREEDING_COMPILER_REPORT_SCHEMA_VERSION,
    reportId: 'ptu-1.05-breeding-compiler-validation-v1' as const,
    compilerDefinitionSha256: BREEDING_COMPILER_DEFINITION_SHA256,
    registryDefinitionSha256: registry.definitionSha256,
    familyResolutionDefinitionSha256: familyResolutions.definitionSha256,
    summary,
    diagnostics: Object.freeze(diagnostics),
    excludedSpecies: Object.freeze(excludedSpecies),
  })
  const report: BreedingCompilerValidationReportV1 = Object.freeze({
    ...reportDefinition,
    definitionSha256: definitionSha256(reportDefinition),
  })
  return Object.freeze({ registry, report })
}
