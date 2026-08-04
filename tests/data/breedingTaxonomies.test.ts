import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')

interface TaxonomyRow { id: string }
interface EggGroup extends TaxonomyRow { label: string, sourceValues: string[] }
interface EggGroupSourceCell { sourceValue: string, eggGroupIds: string[], parseKind: string }
interface Gender extends TaxonomyRow { legacyLabels: string[] }
interface ParentRole extends TaxonomyRow {
  conventionalGenderId: string
  familyRollRange: { minimum: number, maximum: number }
}
interface FormKind extends TaxonomyRow { mayDefineFamilyRoot: boolean }
interface Eligibility extends TaxonomyRow { mayBeConventionalParent: boolean, mayBeEggSpecies: boolean }
interface Taxonomies {
  schemaVersion: number
  taxonomyId: string
  rulesetId: string
  rulesetDefinitionSha256: string
  sourceManifestSha256: string
  definitionSha256: string
  definition: {
    eggGroups: EggGroup[]
    eggGroupSourceCells: EggGroupSourceCell[]
    genders: Gender[]
    genderPolicies: Array<TaxonomyRow & { outcomeIds: string[] }>
    parentRoles: ParentRole[]
    parentRoleAssignmentKinds: Array<TaxonomyRow & { requiresAudit: boolean }>
    formKinds: FormKind[]
    formRootPolicies: Array<TaxonomyRow & { result: string }>
    breedingEligibility: Eligibility[]
    eligibilityEvidenceKinds: Array<TaxonomyRow & { authoritative: boolean }>
    unavailableReasonIds: string[]
    policies: Record<string, string>
  }
}
interface PokedexRow { egg_groups?: string[] }

const taxonomy = readJson<Taxonomies>('data/breeding-automation/taxonomies.json')
const ruleset = readJson<{ rulesetId: string, definitionSha256: string }>('data/breeding-automation/ruleset.json')

const idsAreStableAndUnique = (rows: readonly TaxonomyRow[]): void => {
  expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
  expect(rows.every(row => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id))).toBe(true)
}

describe('breeding taxonomies', () => {
  it('freezes a source- and ruleset-bound taxonomy definition', () => {
    expect(taxonomy).toMatchObject({
      schemaVersion: 1,
      taxonomyId: 'ptu-1.05-breeding-taxonomy-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
    })
    expect(taxonomy.sourceManifestSha256).toBe(sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))))
    expect(taxonomy.definitionSha256).toBe(sha256(stableJsonStringify(taxonomy.definition)))
    expect(taxonomy.definition.policies).toMatchObject({
      unknownEggGroup: 'fail-closed',
      missingEggGroups: 'source-gap-not-no-breeding',
      formNameInference: 'forbidden',
      legacyLabelAuthority: 'none',
      canonicalIdentityComparison: 'exact-id-only',
    })
  })

  it('maps every app-owned Egg Group source cell through one reviewed exact mapping', () => {
    const expectedGroupIds = [
      'bug', 'dragon', 'fairy', 'flying', 'ground', 'humanshape', 'indeterminate',
      'mineral', 'monster', 'plant', 'water-1', 'water-2', 'water-3', 'ditto',
    ]
    expect(taxonomy.definition.eggGroups.map(group => group.id)).toEqual(expectedGroupIds)
    idsAreStableAndUnique(taxonomy.definition.eggGroups)

    const pokedex = readJson<PokedexRow[]>('data/reference/pokedex.json')
    const sourceValues = [...new Set(pokedex.flatMap(row => row.egg_groups ?? []))].sort()
    const sourceCells = taxonomy.definition.eggGroupSourceCells
    expect(sourceCells.map(cell => cell.sourceValue).sort()).toEqual(sourceValues)
    expect(new Set(sourceCells.map(cell => cell.sourceValue)).size).toBe(sourceCells.length)

    const ids = new Set(expectedGroupIds)
    for (const cell of sourceCells) {
      expect(cell.eggGroupIds.length, cell.sourceValue).toBeGreaterThan(0)
      expect(new Set(cell.eggGroupIds).size, cell.sourceValue).toBe(cell.eggGroupIds.length)
      expect(cell.eggGroupIds.every(id => ids.has(id)), cell.sourceValue).toBe(true)
      expect(['exact', 'reviewed-alias', 'reviewed-composite'], cell.sourceValue).toContain(cell.parseKind)
    }
    expect(sourceCells.find(cell => cell.sourceValue === 'Field')).toMatchObject({ eggGroupIds: ['ground'], parseKind: 'reviewed-alias' })
    expect(sourceCells.find(cell => cell.sourceValue === 'Human-Like')).toMatchObject({ eggGroupIds: ['humanshape'], parseKind: 'reviewed-alias' })
    expect(sourceCells.find(cell => cell.sourceValue === 'Amorphous')).toMatchObject({ eggGroupIds: ['indeterminate'], parseKind: 'reviewed-alias' })
    expect(sourceCells.find(cell => cell.sourceValue === 'Grass')).toMatchObject({ eggGroupIds: ['plant'], parseKind: 'reviewed-alias' })
    expect(sourceCells.find(cell => cell.sourceValue === 'Field, Human-Like')).toEqual({
      sourceValue: 'Field, Human-Like',
      eggGroupIds: ['ground', 'humanshape'],
      parseKind: 'reviewed-composite',
    })
  })

  it('separates Gender outcomes from parent roles and closes Ditto and override evidence', () => {
    expect(taxonomy.definition.genders.map(row => row.id)).toEqual(['female', 'male', 'genderless'])
    idsAreStableAndUnique(taxonomy.definition.genders)
    expect(taxonomy.definition.genderPolicies).toEqual([
      { id: 'ratio', requiredFields: ['male_pct', 'female_pct'], outcomeIds: ['female', 'male'] },
      { id: 'genderless', requiredFields: ['genderless'], outcomeIds: ['genderless'] },
    ])
    expect(taxonomy.definition.parentRoles.map(row => row.id)).toEqual(['female-parent', 'male-parent'])
    idsAreStableAndUnique(taxonomy.definition.parentRoles)
    expect(taxonomy.definition.parentRoles.map(role => role.conventionalGenderId)).toEqual(['female', 'male'])

    const rollOutcomes = taxonomy.definition.parentRoles.flatMap(role => {
      const { minimum, maximum } = role.familyRollRange
      return Array.from({ length: maximum - minimum + 1 }, (_value, index) => minimum + index)
    }).sort((left, right) => left - right)
    expect(rollOutcomes).toEqual(Array.from({ length: 20 }, (_value, index) => index + 1))
    expect(taxonomy.definition.parentRoleAssignmentKinds).toEqual([
      { id: 'conventional-gender', requiresAudit: false },
      { id: 'canonical-ditto', requiresAudit: false },
      { id: 'gm-override', requiresAudit: true },
    ])
  })

  it('freezes form, eligibility, evidence, and unavailable-reason vocabularies without inference escape hatches', () => {
    expect(taxonomy.definition.formKinds.map(row => row.id)).toEqual([
      'base-species', 'regional-form', 'size-form', 'sex-form', 'appliance-form',
      'battle-form', 'transformation-form', 'fusion-form', 'mask-form', 'other-special-form',
    ])
    idsAreStableAndUnique(taxonomy.definition.formKinds)
    expect(taxonomy.definition.formRootPolicies.map(row => row.id)).toEqual([
      'own-form-root', 'base-family-root', 'not-breedable-form', 'requires-adjudication',
    ])
    idsAreStableAndUnique(taxonomy.definition.formRootPolicies)

    expect(taxonomy.definition.breedingEligibility).toEqual([
      { id: 'breedable', mayBeConventionalParent: true, mayBeEggSpecies: true },
      { id: 'no-breeding', mayBeConventionalParent: false, mayBeEggSpecies: false },
      { id: 'special-source-only', mayBeConventionalParent: false, mayBeEggSpecies: true },
      { id: 'source-gap', mayBeConventionalParent: false, mayBeEggSpecies: false },
    ])
    idsAreStableAndUnique(taxonomy.definition.breedingEligibility)
    expect(taxonomy.definition.eligibilityEvidenceKinds.find(row => row.id === 'missing-field-inference')?.authoritative).toBe(false)
    expect(taxonomy.definition.eligibilityEvidenceKinds.find(row => row.id === 'legacy-sheet-label')?.authoritative).toBe(false)
    expect(new Set(taxonomy.definition.unavailableReasonIds).size).toBe(taxonomy.definition.unavailableReasonIds.length)
    expect(taxonomy.definition.unavailableReasonIds.every(id => /^breeding\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toBe(true)
  })
})
