import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import pokedex from '../../data/reference/pokedex.json'
import targetAdjudications from '../../data/breeding-automation/evolution-target-adjudications.json'
import formAdjudications from '../../data/breeding-automation/form-adjudications.json'
import familyResolutions from '../../data/breeding-automation/family-resolutions.json'
import familyInventory from '../../data/breeding-automation/family-resolution-inventory.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_FORM_KIND_IDS,
  parseBreedingFamilySpecV1,
} from '#shared/breeding/specs'
import { canonicalBreedingSpeciesIdentity } from '../../server/domain/breeding/canonicalIds'
import { BREEDING_SPEC_IDENTITY_REGISTRY } from '../../server/domain/breeding/specSchemaContext'
import { buildBreedingFamilyResolutions } from '../../server/domain/breeding/familyResolutionBuilder'
import {
  COMPILED_BREEDING_FAMILY_COUNT,
  COMPILED_BREEDING_SPECIES_COUNT,
  compiledBreedingFamilySpec,
  compiledBreedingMaintenanceExclusionReasons,
  compiledBreedingSpeciesAvailability,
  compiledBreedingSpeciesSpec,
} from '../../server/domain/breeding/registry'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const hashDefinition = (value: unknown): string => sha256(stableJsonStringify(value))
const resolutionDefinition = readJson<Record<string, any>>('data/breeding-automation/family-resolution-definition.json')
const canonicalIds = readJson<{ definitionSha256: string }>('data/breeding-automation/canonical-ids.json')
const familyPolicy = readJson<{ definitionSha256: string }>('data/breeding-automation/family-graph-policy.json')
const compilerDefinition = readJson<{ definitionSha256: string }>('data/breeding-automation/compiler-definition.json')

const inventoryBySpecies = new Map(familyInventory.definition.rows.map(row => [row.speciesId, row]))
const familyById = new Map(familyResolutions.definition.familySpecs.map(family => [family.familyId, family]))

describe('reviewed breeding Family, branch, regional-form, and special-form resolution', () => {
  it('freezes exact source-bound target and form adjudications with complete closure', () => {
    expect(targetAdjudications).toMatchObject({
      schemaVersion: 1,
      adjudicationSetId: 'ptu-1.05-breeding-evolution-target-adjudications-v1',
      canonicalIdDefinitionSha256: canonicalIds.definitionSha256,
      familyPolicyDefinitionSha256: familyPolicy.definitionSha256,
      sourcePokedexSha256: sha256(readFileSync(resolve(ROOT, 'data/reference/pokedex.json'))),
    })
    expect(targetAdjudications.definitionSha256).toBe(hashDefinition(targetAdjudications.definition))
    expect(targetAdjudications.definition.counts).toEqual({
      uniqueUnknownSourceTargets: 127,
      resolvedTargets: 108,
      excludedTargets: 19,
      unknownTargetOccurrences: 254,
      resolvedOccurrences: 206,
      excludedOccurrences: 48,
    })
    expect(targetAdjudications.definition.entries).toHaveLength(127)
    expect(new Set(targetAdjudications.definition.entries.map(row => row.sourceValue)).size).toBe(127)
    for (const row of targetAdjudications.definition.entries) {
      expect(row.id).toMatch(/^BR-FAM-TARGET-\d{3}$/)
      expect(row.sourceValueSha256).toBe(hashDefinition(row.sourceValue))
      expect(row.occurrenceCount).toBeGreaterThan(0)
      if (row.status === 'resolved') expect(canonicalBreedingSpeciesIdentity(row.speciesId)).not.toBeNull()
      else expect(row).toMatchObject({ status: 'excluded-ambiguous', speciesId: null })
    }
    expect(targetAdjudications.definition.policies).toMatchObject({
      runtimeNormalization: 'forbidden',
      conditionStrippingAtRuntime: 'forbidden',
      excludedTarget: 'exclude-source-sequence',
    })

    expect(formAdjudications.definitionSha256).toBe(hashDefinition(formAdjudications.definition))
    expect(formAdjudications.definition.rows).toHaveLength(1_149)
    expect(new Set(formAdjudications.definition.rows.map(row => row.speciesId)).size).toBe(1_149)
    expect(formAdjudications.definition.dispositionCounts).toEqual({
      'family-eligible': 1_079,
      'not-breedable-form': 67,
      'source-gap': 3,
    })
    const formKinds = new Set<string>(BREEDING_FORM_KIND_IDS)
    for (const row of formAdjudications.definition.rows) {
      const identity = canonicalBreedingSpeciesIdentity(row.speciesId)!
      expect(row.sourceIndex, row.speciesId).toBe(identity.sourceIndex)
      expect(row.sourceName, row.speciesId).toBe(identity.sourceName)
      expect(row.sourceRecordSha256, row.speciesId).toBe(identity.sourceRecordSha256)
      expect(formKinds.has(row.formKindId), row.speciesId).toBe(true)
    }
    expect(formAdjudications.definition.policies.runtimeNamePatternInference).toBe('forbidden')
  })

  it('reproduces the complete checked-in resolution and disposition inventory deterministically', () => {
    const first = buildBreedingFamilyResolutions(pokedex)
    const second = buildBreedingFamilyResolutions(pokedex)
    expect(first).toEqual(second)
    expect(first.resolutionSet).toEqual(familyResolutions)
    expect(first.inventory).toEqual(familyInventory)
    expect(familyResolutions).toMatchObject({
      schemaVersion: 1,
      resolutionSetId: 'ptu-1.05-breeding-family-resolutions-v1',
      compilerDefinitionSha256: compilerDefinition.definitionSha256,
      resolutionDefinitionSha256: resolutionDefinition.definitionSha256,
    })
    expect(familyResolutions.definitionSha256).toBe(hashDefinition(familyResolutions.definition))
    expect(familyInventory.definitionSha256).toBe(hashDefinition(familyInventory.definition))
    expect(familyInventory.resolutionSetDefinitionSha256).toBe(familyResolutions.definitionSha256)
  })

  it('resolves 949 Species into 480 strict Families and gives every excluded Species a closed reason', () => {
    expect(familyInventory.definition.summary).toEqual({
      speciesCount: 1_149,
      resolvedSpeciesCount: 949,
      excludedSpeciesCount: 200,
      familyCount: 480,
      branchFamilyCount: 32,
      regionalFormMemberCount: 54,
      sexFormMemberCount: 4,
      sizeFormMemberCount: 0,
      maximumFamilySize: 9,
      'resolved-family': 949,
      'excluded-sparse-source': 115,
      'excluded-unresolved-target': 7,
      'excluded-form-policy': 70,
      'excluded-stage-conflict': 0,
      'excluded-graph-invalid': 2,
      'excluded-no-family-evidence': 6,
    })
    expect(familyInventory.definition.rows).toHaveLength(1_149)
    expect(new Set(familyInventory.definition.rows.map(row => row.speciesId)).size).toBe(1_149)
    for (const row of familyInventory.definition.rows) {
      if (row.status === 'resolved-family') {
        expect(row.reasonIds, row.speciesId).toEqual([])
        expect(familyById.get(row.familyId!)?.memberSpeciesIds, row.speciesId).toContain(row.speciesId)
        expect(row.familyRootSpeciesId).toBe(familyById.get(row.familyId!)?.familyRootSpeciesId)
      }
      else {
        expect(row.familyId, row.speciesId).toBeNull()
        expect(row.familyRootSpeciesId, row.speciesId).toBeNull()
        expect(row.reasonIds, row.speciesId).toEqual([row.status])
      }
      expect(row.sourceEvidenceHashes).toEqual([...row.sourceEvidenceHashes].sort())
      expect(new Set(row.sourceEvidenceHashes).size).toBe(row.sourceEvidenceHashes.length)
    }
  })

  it('enforces unique roots, complete reachability, exact membership, sorted edges, and no cross-Family members', () => {
    expect(familyResolutions.definition.familySpecs).toHaveLength(480)
    const owner = new Map<string, string>()
    for (const [index, rawFamily] of familyResolutions.definition.familySpecs.entries()) {
      const family = parseBreedingFamilySpecV1(rawFamily, BREEDING_SPEC_IDENTITY_REGISTRY, `families[${index}]`)
      expect(family.familyId).toBe(`family:${family.familyRootSpeciesId}`)
      expect(family.offspringRootSpeciesId).toBe(family.familyRootSpeciesId)
      expect(family.memberSpeciesIds).toEqual([...family.memberSpeciesIds].sort())
      expect(family.formPolicies.map(row => row.speciesId)).toEqual(family.memberSpeciesIds)
      expect(family.formPolicies.find(row => row.speciesId === family.familyRootSpeciesId)?.formPolicyId).toBe('own-form-root')
      expect(family.formPolicies.filter(row => row.speciesId !== family.familyRootSpeciesId).every(row => row.formPolicyId === 'base-family-root')).toBe(true)
      for (const member of family.memberSpeciesIds) {
        expect(owner.has(member), member).toBe(false)
        owner.set(member, family.familyId)
      }
      const reachable = new Set([family.familyRootSpeciesId])
      let changed = true
      while (changed) {
        changed = false
        for (const edge of family.evolutionEdges) {
          if (reachable.has(edge.fromSpeciesId) && !reachable.has(edge.toSpeciesId)) {
            reachable.add(edge.toSpeciesId)
            changed = true
          }
        }
      }
      expect([...reachable].sort(), family.familyId).toEqual(family.memberSpeciesIds)
    }
    expect(owner.size).toBe(949)
  })

  it('resolves reviewed branches and regional/sex forms without creating special-form runtime fallbacks', () => {
    expect(familyById.get('family:eevee')?.memberSpeciesIds).toEqual([
      'eevee', 'espeon', 'flareon', 'glaceon', 'jolteon', 'leafeon', 'sylveon', 'umbreon', 'vaporeon',
    ])
    const wurmple = familyById.get('family:wurmple')!
    expect(wurmple.memberSpeciesIds).toEqual(['beautifly', 'cascoon', 'dustox', 'silcoon', 'wurmple'])
    expect(wurmple.evolutionEdges).toContainEqual({ fromSpeciesId: 'silcoon', toSpeciesId: 'beautifly', kind: 'evolves-to' })
    expect(wurmple.evolutionEdges).toContainEqual({ fromSpeciesId: 'cascoon', toSpeciesId: 'dustox', kind: 'evolves-to' })
    expect(wurmple.evolutionEdges).not.toContainEqual(expect.objectContaining({ fromSpeciesId: 'silcoon', toSpeciesId: 'dustox' }))
    expect(wurmple.evolutionEdges).not.toContainEqual(expect.objectContaining({ fromSpeciesId: 'cascoon', toSpeciesId: 'beautifly' }))

    expect(familyById.get('family:pichu')?.memberSpeciesIds).toContain('raichu-alola')
    expect(familyById.get('family:goomy')?.memberSpeciesIds).toEqual([
      'goodra', 'goodra-hisuian', 'goomy', 'sliggoo', 'sliggoo-hisuian',
    ])
    expect(familyById.get('family:rockruff')?.memberSpeciesIds).toEqual([
      'lycanroc-dusk', 'lycanroc-midday', 'lycanroc-midnight', 'rockruff',
    ])
    expect(familyById.get('family:basculin')?.memberSpeciesIds).toEqual([
      'basculegion-female', 'basculegion-male', 'basculin',
    ])

    for (const id of ['rotom-fan', 'deoxys-attack-forme', 'kyurem-reshiram-fusion-forme', 'ogerpon-teal-mask']) {
      expect(inventoryBySpecies.get(id)).toMatchObject({ status: 'excluded-form-policy', familyId: null })
    }
    expect(inventoryBySpecies.get('darmanitan-galar-standard-mode')).toMatchObject({ status: 'excluded-unresolved-target' })
    expect(inventoryBySpecies.get('gourgeist-super-size')).toMatchObject({ status: 'excluded-no-family-evidence' })
  })

  it('loads only strict compiled records and keeps maintenance exclusion detail out of normal availability', () => {
    expect(COMPILED_BREEDING_SPECIES_COUNT).toBe(862)
    expect(COMPILED_BREEDING_FAMILY_COUNT).toBe(407)
    expect(compiledBreedingSpeciesSpec('abra')).toMatchObject({
      speciesId: 'abra',
      familyId: 'family:abra',
      familyRootSpeciesId: 'abra',
      hatchCampaignMinutes: 14_400,
    })
    expect(compiledBreedingFamilySpec('family:eevee')?.memberSpeciesIds).toHaveLength(9)
    expect(compiledBreedingSpeciesAvailability('abra')).toMatchObject({ status: 'available', speciesId: 'abra' })
    expect(compiledBreedingSpeciesAvailability('darmanitan-galar-standard-mode')).toEqual({
      status: 'unavailable',
      speciesId: 'darmanitan-galar-standard-mode',
      reasonId: 'breeding.species-spec-missing',
    })
    expect(compiledBreedingSpeciesAvailability('Abra')).toEqual({
      status: 'unavailable', speciesId: null, reasonId: 'breeding.species-spec-missing',
    })
    expect(compiledBreedingMaintenanceExclusionReasons('darmanitan-galar-standard-mode')).toContain(
      'breeding.compiler.unknown-evolution-target',
    )
  })

  it('fails closed when app-owned source bytes drift and exposes write/check command contracts', () => {
    const drifted = structuredClone(pokedex) as any[]
    drifted[0] = { ...drifted[0], evolutions: [] }
    expect(() => buildBreedingFamilyResolutions(drifted)).toThrowError()

    const packageJson = readJson<{ scripts: Record<string, string> }>('package.json')
    expect(packageJson.scripts['compile:breeding-family-resolutions']).toContain('--write')
    expect(packageJson.scripts['check:breeding-family-resolutions']).toContain('--check')
  })
})
