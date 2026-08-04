import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingEggGroupId, BreedingSpeciesId } from '#shared/breeding/ids'
import { PTU_NATURES } from '../../src/utils/ptuNatures'
import { resolveBreedingCampaignOptionSnapshot } from '../../server/domain/breeding/campaignOptions'
import {
  evaluateBreedingCompatibility,
  type BreedingCompatibilityParentFacts,
} from '../../server/domain/breeding/compatibility'
import { resolveBreedingOffspring } from '../../server/domain/breeding/offspringResolution'
import {
  BREEDING_NATURES,
  BREEDING_NATURE_COUNT,
  BREEDING_NATURE_DEFINITION_SHA256,
  breedingNatureForOrderedDice,
} from '../../server/domain/breeding/natures'
import {
  BREEDING_TRAIT_RESOLUTION_POLICY_DEFINITION_SHA256,
  POKEMON_EDUCATION_RANKS,
  resolveBreedingTraits,
  type PokemonEducationRank,
} from '../../server/domain/breeding/traitResolution'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const hashDefinition = (value: unknown): string => sha256(stableJsonStringify(value))
const natureCatalog = readJson<Record<string, any>>('data/breeding-automation/natures.json')
const policy = readJson<Record<string, any>>('data/breeding-automation/trait-resolution-policy.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const registry = readJson<{ definitionSha256: string }>('data/breeding-automation/compiled-registry.json')

const parent = (
  parentRef: string,
  speciesId: string,
  genderId: 'female' | 'male' | 'genderless',
  eggGroupIds: string[],
): BreedingCompatibilityParentFacts => ({
  parentRef,
  speciesId: speciesId as BreedingSpeciesId,
  genderId,
  level: 30,
  eggGroupIds: eggGroupIds as BreedingEggGroupId[],
  gmMaturityConfirmed: true,
})
const offspring = (
  parents: readonly [BreedingCompatibilityParentFacts, BreedingCompatibilityParentFacts],
  familyRoll: number | null = 5,
) => {
  const options = resolveBreedingCampaignOptionSnapshot()
  const compatibility = evaluateBreedingCompatibility({ parents, options, roleOverride: null })
  return resolveBreedingOffspring({
    parents, options, compatibility, familyRoll, familyChoice: null, speciesOverride: null,
  })
}
const abraOffspring = () => offspring([
  parent('sheet:abra-f', 'abra', 'female', ['humanshape']),
  parent('sheet:kadabra-m', 'kadabra', 'male', ['humanshape']),
])
const OPTION_NATURE = 'option:v1:00000000000000000000000000000001' as const
const OPTION_ABILITY = 'option:v1:00000000000000000000000000000002' as const
const OPTION_GENDER = 'option:v1:00000000000000000000000000000003' as const
const resolveTraits = (
  rank: PokemonEducationRank = 'Untrained',
  overrides: Record<string, unknown> = {},
  resolvedOffspring = abraOffspring(),
) => resolveBreedingTraits({
  offspring: resolvedOffspring,
  pokemonEducationRank: rank,
  natureRoll: { firstDie: 1, secondDie: 1 },
  natureChoice: null,
  abilityRoll: 1,
  abilityChoice: null,
  genderRoll: 25,
  genderChoice: null,
  ...overrides,
} as any)

describe('Nature, Ability, Gender, rank choice, and random trait resolution', () => {
  it('freezes a reviewed Nature migration and trait policy without runtime documentary reads', () => {
    expect(natureCatalog).toMatchObject({
      schemaVersion: 1,
      catalogId: 'ptu-1.05-breeding-natures-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
      definitionSha256: BREEDING_NATURE_DEFINITION_SHA256,
    })
    expect(natureCatalog.definitionSha256).toBe(hashDefinition(natureCatalog.definition))
    expect(natureCatalog.definition.sourceProvenance).toEqual({
      path: 'books/markdown/core/05-pokemon.md',
      sha256: sha256(readFileSync(resolve(ROOT, 'books/markdown/core/05-pokemon.md'))),
      role: 'maintenance-provenance-only-migrated-into-reviewed-artifact',
    })
    expect(natureCatalog.definition.policies.runtimeDocumentaryRead).toBe('forbidden')
    expect(BREEDING_NATURE_COUNT).toBe(36)
    expect(BREEDING_NATURES).toHaveLength(36)
    expect(BREEDING_NATURES.map(row => ({ value: row.value, name: row.label, plus: row.raisesStatId, minus: row.lowersStatId })))
      .toEqual(PTU_NATURES)

    expect(policy).toMatchObject({
      schemaVersion: 1,
      policyId: 'ptu-1.05-breeding-trait-resolution-policy-v1',
      rulesetDefinitionSha256: ruleset.definitionSha256,
      definitionSha256: BREEDING_TRAIT_RESOLUTION_POLICY_DEFINITION_SHA256,
    })
    expect(policy.definitionSha256).toBe(hashDefinition(policy.definition))
    expect(policy.definition.bindings).toMatchObject({
      natureCatalogDefinitionSha256: natureCatalog.definitionSha256,
      compiledRegistryDefinitionSha256: registry.definitionSha256,
    })
    expect(policy.definition.reasonIds).toHaveLength(16)
  })

  it('maps ordered 2d6 Nature rolls across all 36 outcomes instead of summing dice', () => {
    expect(breedingNatureForOrderedDice(1, 1)).toMatchObject({ value: 1, id: 'cuddly' })
    expect(breedingNatureForOrderedDice(1, 6)).toMatchObject({ value: 6, id: 'desperate' })
    expect(breedingNatureForOrderedDice(2, 1)).toMatchObject({ value: 7, id: 'lonely' })
    expect(breedingNatureForOrderedDice(6, 6)).toMatchObject({ value: 36, id: 'serious' })
    const outcomes = new Set<string>()
    for (let firstDie = 1; firstDie <= 6; firstDie += 1) {
      for (let secondDie = 1; secondDie <= 6; secondDie += 1) {
        outcomes.add(breedingNatureForOrderedDice(firstDie, secondDie)!.id)
      }
    }
    expect(outcomes.size).toBe(36)
    expect(breedingNatureForOrderedDice(0, 1)).toBeNull()
    expect(breedingNatureForOrderedDice(1, 7)).toBeNull()
  })

  it('resolves random Nature, sorted Basic Ability, and exact ratio Gender with immutable provenance', () => {
    const result = resolveTraits()
    expect(result).toMatchObject({
      status: 'resolved',
      offspringSpeciesId: 'abra',
      pokemonEducationRank: 'Untrained',
      nature: {
        id: 'cuddly', resolutionKind: 'random', roll: { firstDie: 1, secondDie: 1 }, optionId: null,
      },
      ability: { id: 'inner-focus', resolutionKind: 'random', roll: 1, optionId: null },
      gender: { id: 'female', resolutionKind: 'random', roll: 25, optionId: null },
      natureCatalogDefinitionSha256: natureCatalog.definitionSha256,
      traitPolicyDefinitionSha256: policy.definitionSha256,
    })
    expect(resolveTraits('Untrained', {
      natureRoll: { firstDie: 6, secondDie: 6 },
      abilityRoll: 2,
      genderRoll: 26,
    })).toMatchObject({
      status: 'resolved',
      nature: { id: 'serious' },
      ability: { id: 'synchronize' },
      gender: { id: 'male' },
    })
    expect(resolveTraits()).toEqual(result)
    expect(Object.isFrozen(result)).toBe(true)
    if (result.status === 'resolved') {
      expect(Object.isFrozen(result.nature)).toBe(true)
      expect(Object.isFrozen(result.nature.roll)).toBe(true)
    }
  })

  it('compares integer d100 directly to fractional female percentages without hidden rounding', () => {
    const bulbasaur = offspring([
      parent('sheet:bulbasaur-f', 'bulbasaur', 'female', ['monster', 'plant']),
      parent('sheet:ivysaur-m', 'ivysaur', 'male', ['monster', 'plant']),
    ])
    expect(resolveTraits('Untrained', { genderRoll: 12 }, bulbasaur)).toMatchObject({
      status: 'resolved', gender: { id: 'female', roll: 12 },
    })
    expect(resolveTraits('Untrained', { genderRoll: 13 }, bulbasaur)).toMatchObject({
      status: 'resolved', gender: { id: 'male', roll: 13 },
    })
  })

  it('authorizes optional Nature, Ability, and Gender choices at Adept, Expert, and Master only', () => {
    expect(POKEMON_EDUCATION_RANKS).toEqual(['Untrained', 'Novice', 'Adept', 'Expert', 'Master'])
    expect(resolveTraits('Adept', {
      natureRoll: null,
      natureChoice: { optionId: OPTION_NATURE, natureId: 'calm', evidenceId: 'offer:nature:1' },
    })).toMatchObject({
      status: 'resolved',
      nature: { id: 'calm', resolutionKind: 'rank-choice', optionId: OPTION_NATURE, choiceEvidenceId: 'offer:nature:1' },
    })
    expect(resolveTraits('Novice', {
      natureRoll: null,
      natureChoice: { optionId: OPTION_NATURE, natureId: 'calm', evidenceId: 'offer:nature:1' },
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.traits.nature-choice-unauthorized'] })

    expect(resolveTraits('Expert', {
      abilityRoll: null,
      abilityChoice: { optionId: OPTION_ABILITY, abilityId: 'synchronize', evidenceId: 'offer:ability:1' },
    })).toMatchObject({ status: 'resolved', ability: { id: 'synchronize', resolutionKind: 'rank-choice' } })
    expect(resolveTraits('Adept', {
      abilityRoll: null,
      abilityChoice: { optionId: OPTION_ABILITY, abilityId: 'synchronize', evidenceId: 'offer:ability:1' },
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.traits.ability-choice-unauthorized'] })

    expect(resolveTraits('Master', {
      genderRoll: null,
      genderChoice: { optionId: OPTION_GENDER, genderId: 'male', evidenceId: 'offer:gender:1' },
    })).toMatchObject({ status: 'resolved', gender: { id: 'male', resolutionKind: 'rank-choice' } })
    expect(resolveTraits('Expert', {
      genderRoll: null,
      genderChoice: { optionId: OPTION_GENDER, genderId: 'male', evidenceId: 'offer:gender:1' },
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.traits.gender-choice-unauthorized'] })
  })

  it('fixes genderless offspring without a roll or choice and rejects excess input', () => {
    const magnemite = offspring([
      parent('sheet:ditto', 'ditto', 'genderless', ['ditto']),
      parent('sheet:magnemite', 'magnemite', 'genderless', ['mineral']),
    ], null)
    expect(resolveTraits('Untrained', { genderRoll: null }, magnemite)).toMatchObject({
      status: 'resolved', gender: { id: 'genderless', resolutionKind: 'fixed', roll: null },
    })
    expect(resolveTraits('Master', {
      genderRoll: null,
      genderChoice: { optionId: OPTION_GENDER, genderId: 'genderless', evidenceId: 'offer:gender:fixed' },
    }, magnemite)).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.traits.extraneous-roll-or-choice'],
    })
  })

  it('fails closed on missing, out-of-range, stale, unauthorized, or simultaneous random and choice inputs', () => {
    expect(resolveTraits('Untrained', { natureRoll: null })).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.traits.nature-roll-required'],
    })
    expect(resolveTraits('Untrained', { natureRoll: { firstDie: 7, secondDie: 1 } })).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.traits.nature-roll-invalid'],
    })
    expect(resolveTraits('Untrained', { abilityRoll: 3 })).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.traits.ability-roll-invalid'],
    })
    expect(resolveTraits('Untrained', { genderRoll: 101 })).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.traits.gender-roll-invalid'],
    })
    expect(resolveTraits('Expert', {
      abilityRoll: null,
      abilityChoice: { optionId: OPTION_ABILITY, abilityId: 'overgrow', evidenceId: 'offer:ability:bad' },
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.traits.ability-choice-invalid'] })
    expect(resolveTraits('Adept', {
      natureRoll: { firstDie: 1, secondDie: 1 },
      natureChoice: { optionId: OPTION_NATURE, natureId: 'calm', evidenceId: 'offer:nature:1' },
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.traits.extraneous-roll-or-choice'] })
    expect(resolveTraits('Master', {
      genderRoll: null,
      genderChoice: { optionId: 'option:v1:bad', genderId: 'male', evidenceId: 'offer:gender:bad' },
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.traits.gender-choice-invalid'] })
  })

  it('rejects an unavailable offspring result before resolving any authoritative traits', () => {
    const unavailable = offspring([
      parent('sheet:abra-f', 'abra', 'female', ['humanshape']),
      parent('sheet:bulbasaur-m', 'bulbasaur', 'male', ['monster', 'plant']),
    ])
    const result = resolveTraits('Master', {}, unavailable)
    expect(result.status).toBe('unavailable')
    expect(result.reasonIds).toContain('breeding.traits.offspring-unavailable')
    expect(result).toMatchObject({ nature: null, ability: null, gender: null, offspringSpeciesId: null })
  })
})
