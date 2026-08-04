import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import pokedex from '../../data/reference/pokedex.json'
import familyResolutions from '../../data/breeding-automation/family-resolutions.json'
import compiledRegistry from '../../data/breeding-automation/compiled-registry.json'
import validationReport from '../../data/breeding-automation/compiler-validation-report.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_COMPILER_DEFINITION_SHA256,
  BreedingCompilerInputError,
  compileBreedingRegistry,
} from '../../server/domain/breeding/compiler'
import { BREEDING_SPEC_IDENTITY_REGISTRY } from '../../server/domain/breeding/specSchemaContext'
import { parseBreedingFamilySpecV1 } from '#shared/breeding/specs'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const hashDefinition = (value: unknown): string => sha256(stableJsonStringify(value))
const compilerDefinition = readJson<Record<string, any>>('data/breeding-automation/compiler-definition.json')
const ruleset = readJson<{ rulesetId: string }>('data/breeding-automation/ruleset.json')
const canonicalIds = readJson<{ definitionSha256: string }>('data/breeding-automation/canonical-ids.json')
const familyPolicy = readJson<{ definitionSha256: string }>('data/breeding-automation/family-graph-policy.json')
const targetAdjudications = readJson<{ definitionSha256: string }>('data/breeding-automation/evolution-target-adjudications.json')
const formAdjudications = readJson<{ definitionSha256: string }>('data/breeding-automation/form-adjudications.json')
const resolutionDefinition = readJson<{ definitionSha256: string }>('data/breeding-automation/family-resolution-definition.json')

const makeAerodactylResolution = () => {
  const sourceHashes = [
    BREEDING_COMPILER_DEFINITION_SHA256,
    compilerDefinition.definition.source.sha256 as string,
    canonicalIds.definitionSha256,
    familyPolicy.definitionSha256,
    targetAdjudications.definitionSha256,
    formAdjudications.definitionSha256,
    resolutionDefinition.definitionSha256,
  ].sort()
  const familyDefinition = {
    schemaVersion: 1 as const,
    familyId: 'family:aerodactyl',
    familyRootSpeciesId: 'aerodactyl',
    offspringRootSpeciesId: 'aerodactyl',
    memberSpeciesIds: ['aerodactyl'],
    evolutionEdges: [],
    formPolicies: [{ speciesId: 'aerodactyl', formKindId: 'base-species', formPolicyId: 'own-form-root' }],
    sourceHashes,
  }
  const family = parseBreedingFamilySpecV1(
    { ...familyDefinition, definitionSha256: hashDefinition(familyDefinition) },
    BREEDING_SPEC_IDENTITY_REGISTRY,
  )
  const definition = {
    status: 'reviewed-complete' as const,
    familySpecs: [family],
    policies: {
      missingResolution: 'fail-closed-exclude' as const,
      runtimeDerivation: 'forbidden' as const,
      nextOwnerTicket: 'BR-013' as const,
    },
  }
  return {
    schemaVersion: 1,
    resolutionSetId: 'ptu-1.05-breeding-family-resolutions-v1',
    rulesetId: ruleset.rulesetId,
    compilerDefinitionSha256: BREEDING_COMPILER_DEFINITION_SHA256,
    resolutionDefinitionSha256: resolutionDefinition.definitionSha256,
    definitionSha256: hashDefinition(definition),
    definition,
  }
}

describe('deterministic Pokédex-to-breeding-spec compiler', () => {
  it('freezes the source-bound compiler pipeline and diagnostic vocabulary', () => {
    expect(compilerDefinition).toMatchObject({
      schemaVersion: 1,
      compilerId: 'ptu-1.05-breeding-spec-compiler-v1',
      rulesetId: ruleset.rulesetId,
      definitionSha256: BREEDING_COMPILER_DEFINITION_SHA256,
    })
    expect(compilerDefinition.definitionSha256).toBe(hashDefinition(compilerDefinition.definition))
    expect(compilerDefinition.definition.source).toMatchObject({
      path: 'data/reference/pokedex.json',
      sha256: sha256(readFileSync(resolve(ROOT, 'data/reference/pokedex.json'))),
      expectedRows: 1_149,
    })
    expect(compilerDefinition.definition.pipeline).toHaveLength(13)
    expect(compilerDefinition.definition.diagnostics).toHaveLength(16)
    expect(new Set(compilerDefinition.definition.diagnostics.map((row: any) => row.code)).size).toBe(16)
    expect(compilerDefinition.definition.policies).toMatchObject({
      sourceLabelRuntimeFallback: 'forbidden',
      documentarySupplementation: 'forbidden',
      unknownMachineMove: 'warning-and-exclude-move-only',
      missingFamilyResolution: 'exclude-species',
      partialFamilyEmission: 'forbidden',
    })
  })

  it('reproduces the checked-in fail-closed registry and complete validation report byte-for-byte', () => {
    const first = compileBreedingRegistry(pokedex, familyResolutions)
    const second = compileBreedingRegistry(pokedex, familyResolutions)
    expect(first).toEqual(second)
    expect(first.registry).toEqual(compiledRegistry)
    expect(first.report).toEqual(validationReport)
    expect(first.registry.definitionSha256).toBe(hashDefinition({
      schemaVersion: first.registry.schemaVersion,
      registryId: first.registry.registryId,
      rulesetId: first.registry.rulesetId,
      compilerDefinitionSha256: first.registry.compilerDefinitionSha256,
      sourcePokedexSha256: first.registry.sourcePokedexSha256,
      familyResolutionDefinitionSha256: first.registry.familyResolutionDefinitionSha256,
      familySpecs: first.registry.familySpecs,
      speciesSpecs: first.registry.speciesSpecs,
    }))
    expect(first.report.definitionSha256).toBe(hashDefinition({
      schemaVersion: first.report.schemaVersion,
      reportId: first.report.reportId,
      compilerDefinitionSha256: first.report.compilerDefinitionSha256,
      registryDefinitionSha256: first.report.registryDefinitionSha256,
      familyResolutionDefinitionSha256: first.report.familyResolutionDefinitionSha256,
      summary: first.report.summary,
      diagnostics: first.report.diagnostics,
      excludedSpecies: first.report.excludedSpecies,
    }))
  })

  it('reports every current source gap without silently supplementing or repairing it', () => {
    expect(validationReport.summary).toEqual({
      sourceRecordCount: 1_149,
      completeSourceRecordCount: 1_020,
      sourceValidCandidateCount: 875,
      familyResolutionInputCount: 480,
      compiledFamilyCount: 407,
      compiledSpeciesCount: 862,
      excludedSpeciesCount: 287,
      errorCount: 425,
      warningCount: 947,
      diagnosticCounts: {
        'breeding.compiler.family-resolution-missing': 6,
        'breeding.compiler.family-resolution-source-mismatch': 87,
        'breeding.compiler.invalid-basic-ability': 6,
        'breeding.compiler.invalid-egg-groups': 119,
        'breeding.compiler.invalid-egg-move': 0,
        'breeding.compiler.invalid-evolution-source': 1,
        'breeding.compiler.invalid-gender': 0,
        'breeding.compiler.invalid-hatch-duration': 0,
        'breeding.compiler.missing-hatch-duration': 28,
        'breeding.compiler.non-ditto-ditto-group': 1,
        'breeding.compiler.source-identity-drift': 0,
        'breeding.compiler.sparse-record': 129,
        'breeding.compiler.spec-validation-failed': 0,
        'breeding.compiler.unknown-evolution-target': 48,
        'breeding.compiler.unknown-source-field': 0,
        'breeding.compiler.unresolved-machine-move': 947,
      },
    })
    expect(validationReport.excludedSpecies).toHaveLength(287)
    expect(validationReport.excludedSpecies.every(row => row.reasonCodes.length > 0)).toBe(true)
    expect(validationReport.diagnostics).toHaveLength(1_372)
    expect(validationReport.diagnostics.every(row => !Object.hasOwn(row, 'rawValue'))).toBe(true)
    expect(JSON.stringify(validationReport.diagnostics)).not.toContain('Facade')
    expect(validationReport.diagnostics.filter(row => row.code === 'breeding.compiler.unknown-evolution-target')).toHaveLength(48)
  })

  it('emits a strict source-hash-bound spec only when an explicit complete Family resolution is supplied', () => {
    const result = compileBreedingRegistry(pokedex, makeAerodactylResolution())
    expect(result.report.summary).toMatchObject({
      familyResolutionInputCount: 1,
      compiledFamilyCount: 1,
      compiledSpeciesCount: 1,
      excludedSpeciesCount: 1_148,
    })
    expect(result.registry.familySpecs.map(row => row.familyId)).toEqual(['family:aerodactyl'])
    expect(result.registry.speciesSpecs).toHaveLength(1)
    expect(result.registry.speciesSpecs[0]).toMatchObject({
      speciesId: 'aerodactyl',
      familyId: 'family:aerodactyl',
      familyRootSpeciesId: 'aerodactyl',
      formKindId: 'base-species',
      formPolicyId: 'own-form-root',
      eligibilityId: 'breedable',
      hatchCampaignMinutes: 28_800,
    })
    expect(result.registry.speciesSpecs[0]!.machineCompatibleMoveIds).not.toContain('facade')
    expect(result.registry.speciesSpecs[0]!.sourceHashes).toContain(result.registry.familySpecs[0]!.definitionSha256)
  })

  it('fails closed on source drift, malformed resolution envelopes, and source-inconsistent Families', () => {
    const drifted = structuredClone(pokedex) as any[]
    drifted[0] = { ...drifted[0], species: 'Private Abra' }
    const driftResult = compileBreedingRegistry(drifted, familyResolutions)
    expect(driftResult.report.diagnostics.find(row => (
      row.sourceIndex === 0 && row.code === 'breeding.compiler.source-identity-drift'
    ))).toMatchObject({ speciesId: 'abra' })
    expect(JSON.stringify(driftResult.report.diagnostics)).not.toContain('Private Abra')

    const malformed = structuredClone(makeAerodactylResolution())
    malformed.definitionSha256 = '0'.repeat(64)
    expect(() => compileBreedingRegistry(pokedex, malformed)).toThrowError(BreedingCompilerInputError)

    const unresolved = structuredClone(makeAerodactylResolution())
    unresolved.definition.familySpecs[0]!.formPolicies[0]!.formPolicyId = 'requires-adjudication'
    const familyDefinition = { ...unresolved.definition.familySpecs[0] }
    delete (familyDefinition as any).definitionSha256
    unresolved.definition.familySpecs[0]!.definitionSha256 = hashDefinition(familyDefinition)
    unresolved.definitionSha256 = hashDefinition(unresolved.definition)
    const unresolvedResult = compileBreedingRegistry(pokedex, unresolved)
    expect(unresolvedResult.registry.familySpecs).toEqual([])
    expect(unresolvedResult.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'breeding.compiler.family-resolution-source-mismatch',
      speciesId: 'aerodactyl',
    }))
  })

  it('keeps generated artifacts deterministic through the standalone check command contract', () => {
    const packageJson = readJson<{ scripts: Record<string, string> }>('package.json')
    expect(packageJson.scripts['compile:breeding-registry']).toContain('--write')
    expect(packageJson.scripts['check:breeding-compiler']).toContain('--check')
  })
})
