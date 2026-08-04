import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingEggGroupId, BreedingSpeciesId } from '#shared/breeding/ids'
import { resolveBreedingCampaignOptionSnapshot } from '../../server/domain/breeding/campaignOptions'
import {
  evaluateBreedingCompatibility,
  type BreedingCompatibilityParentFacts,
} from '../../server/domain/breeding/compatibility'
import {
  BREEDING_OFFSPRING_RESOLUTION_POLICY_DEFINITION_SHA256,
  resolveBreedingOffspring,
} from '../../server/domain/breeding/offspringResolution'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const hashDefinition = (value: unknown): string => sha256(stableJsonStringify(value))
const policy = readJson<Record<string, any>>('data/breeding-automation/offspring-resolution-policy.json')
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
const OPTION_A = 'option:v1:0123456789abcdef0123456789abcdef' as const
const OPTION_B = 'option:v1:abcdef0123456789abcdef0123456789' as const

const setup = (
  parents: readonly [BreedingCompatibilityParentFacts, BreedingCompatibilityParentFacts],
  overrides: Record<string, unknown> = {},
) => {
  const options = resolveBreedingCampaignOptionSnapshot(overrides)
  const compatibility = evaluateBreedingCompatibility({ parents, options, roleOverride: null })
  return { parents, options, compatibility }
}

describe('pure offspring Family and lowest-stage Species resolution', () => {
  it('freezes the ruleset-, compatibility-, registry-, and Family-bound policy', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      policyId: 'ptu-1.05-breeding-offspring-resolution-policy-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
      definitionSha256: BREEDING_OFFSPRING_RESOLUTION_POLICY_DEFINITION_SHA256,
    })
    expect(policy.definitionSha256).toBe(hashDefinition(policy.definition))
    expect(policy.definition.bindings.compiledRegistryDefinitionSha256).toBe(registry.definitionSha256)
    expect(policy.definition.selectionPolicies['core-d20']).toMatchObject({
      rollMinimum: 1,
      rollMaximum: 20,
      maleParentRange: [1, 4],
      femaleParentRange: [5, 20],
    })
    expect(policy.definition.lowestStage.operationTimeGraphTraversal).toBe('forbidden')
    expect(policy.definition.reasonIds).toHaveLength(13)
  })

  it('uses only the injected core d20 and exact 1–4/5–20 role boundaries', () => {
    const context = setup([
      parent('sheet:abra-f', 'abra', 'female', ['humanshape']),
      parent('sheet:machop-m', 'machop', 'male', ['humanshape']),
    ])
    expect(context.compatibility.status).toBe('compatible')
    const resolveRoll = (familyRoll: number) => resolveBreedingOffspring({
      ...context,
      familyRoll,
      familyChoice: null,
      speciesOverride: null,
    })
    expect(resolveRoll(1)).toMatchObject({
      status: 'resolved',
      selectionKind: 'core-d20',
      selectedParentIndex: 1,
      selectedRoleId: 'male-parent',
      familyRoll: 1,
      selectedFamilyId: 'family:machop',
      compiledRootSpeciesId: 'machop',
      offspringSpeciesId: 'machop',
    })
    expect(resolveRoll(4)).toMatchObject({ selectedFamilyId: 'family:machop', offspringSpeciesId: 'machop' })
    expect(resolveRoll(5)).toMatchObject({
      selectedParentIndex: 0,
      selectedRoleId: 'female-parent',
      selectedFamilyId: 'family:abra',
      offspringSpeciesId: 'abra',
    })
    expect(resolveRoll(20)).toMatchObject({ selectedFamilyId: 'family:abra', offspringSpeciesId: 'abra' })
    expect(resolveRoll(5)).toEqual(resolveRoll(5))
  })

  it('fails closed for missing, invalid, or extraneous rolls and choices', () => {
    const context = setup([
      parent('sheet:abra-f', 'abra', 'female', ['humanshape']),
      parent('sheet:machop-m', 'machop', 'male', ['humanshape']),
    ])
    const resolve = (familyRoll: number | null, familyChoice: any = null) => resolveBreedingOffspring({
      ...context, familyRoll, familyChoice, speciesOverride: null,
    })
    expect(resolve(null)).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.offspring.core-roll-required'],
    })
    expect(resolve(0)).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.offspring.core-roll-invalid'],
    })
    expect(resolve(21)).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.offspring.core-roll-invalid'],
    })
    expect(resolve(5, { optionId: OPTION_A, familyId: 'family:abra', evidenceId: 'choice:1' })).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.offspring.family-choice-not-allowed'],
    })
  })

  it('supports maternal and bounded GM contributor-family policies without a roll', () => {
    const parents = [
      parent('sheet:abra-f', 'abra', 'female', ['humanshape']),
      parent('sheet:machop-m', 'machop', 'male', ['humanshape']),
    ] as const
    const maternal = setup(parents, { 'breeding.parent-family-policy': 'maternal-family' })
    expect(resolveBreedingOffspring({
      ...maternal, familyRoll: null, familyChoice: null, speciesOverride: null,
    })).toMatchObject({
      status: 'resolved',
      selectionKind: 'maternal-family',
      selectedParentIndex: 0,
      selectedRoleId: 'female-parent',
      selectedFamilyId: 'family:abra',
      offspringSpeciesId: 'abra',
    })

    const gm = setup(parents, { 'breeding.parent-family-policy': 'gm-family-choice' })
    expect(resolveBreedingOffspring({
      ...gm,
      familyRoll: null,
      familyChoice: { optionId: OPTION_A, familyId: 'family:machop', evidenceId: 'gm-family:001' },
      speciesOverride: null,
    })).toMatchObject({
      status: 'resolved',
      selectionKind: 'gm-family-choice',
      selectedParentIndex: 1,
      selectedRoleId: 'male-parent',
      selectedFamilyId: 'family:machop',
      familyChoiceOptionId: OPTION_A,
      familyChoiceEvidenceId: 'gm-family:001',
    })
    expect(resolveBreedingOffspring({
      ...gm, familyRoll: null, familyChoice: null, speciesOverride: null,
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.offspring.family-choice-required'] })
    expect(resolveBreedingOffspring({
      ...gm,
      familyRoll: null,
      familyChoice: { optionId: OPTION_A, familyId: 'family:bulbasaur', evidenceId: 'gm-family:bad' },
      speciesOverride: null,
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.offspring.family-choice-invalid'] })
  })

  it('always selects the non-Ditto contributor Family without consuming a roll or Family choice', () => {
    const context = setup([
      parent('sheet:ditto', 'ditto', 'genderless', ['ditto']),
      parent('sheet:machop-m', 'machop', 'male', ['humanshape']),
    ])
    expect(resolveBreedingOffspring({
      ...context, familyRoll: null, familyChoice: null, speciesOverride: null,
    })).toMatchObject({
      status: 'resolved',
      selectionKind: 'canonical-ditto',
      selectedParentIndex: 1,
      selectedFamilyId: 'family:machop',
      offspringSpeciesId: 'machop',
      familyRoll: null,
    })
    expect(resolveBreedingOffspring({
      ...context, familyRoll: 1, familyChoice: null, speciesOverride: null,
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.offspring.core-roll-invalid'] })
    expect(resolveBreedingOffspring({
      ...context,
      familyRoll: null,
      familyChoice: { optionId: OPTION_A, familyId: 'family:machop', evidenceId: 'gm-family:001' },
      speciesOverride: null,
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.offspring.family-choice-not-allowed'] })
  })

  it('uses the compiled lowest-stage root by default and bounds audited form override to Family members', () => {
    const parents = [
      parent('sheet:rockruff-f', 'rockruff', 'female', ['ground']),
      parent('sheet:rockruff-m', 'rockruff', 'male', ['ground']),
    ] as const
    const normal = setup(parents)
    expect(resolveBreedingOffspring({
      ...normal, familyRoll: 5, familyChoice: null, speciesOverride: null,
    })).toMatchObject({
      status: 'resolved',
      selectedFamilyId: 'family:rockruff',
      compiledRootSpeciesId: 'rockruff',
      offspringSpeciesId: 'rockruff',
      speciesOverrideOptionId: null,
    })
    expect(resolveBreedingOffspring({
      ...normal,
      familyRoll: 5,
      familyChoice: null,
      speciesOverride: { optionId: OPTION_B, speciesId: 'lycanroc-dusk', evidenceId: 'gm-form:001' },
    })).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.offspring.species-override-not-allowed'],
    })

    const enabled = setup(parents, { 'breeding.form-root-policy': 'gm-species-override' })
    expect(resolveBreedingOffspring({
      ...enabled,
      familyRoll: 5,
      familyChoice: null,
      speciesOverride: { optionId: OPTION_B, speciesId: 'lycanroc-dusk', evidenceId: 'gm-form:001' },
    })).toMatchObject({
      status: 'resolved',
      compiledRootSpeciesId: 'rockruff',
      offspringSpeciesId: 'lycanroc-dusk',
      speciesOverrideOptionId: OPTION_B,
      speciesOverrideEvidenceId: 'gm-form:001',
    })
    expect(resolveBreedingOffspring({
      ...enabled,
      familyRoll: 5,
      familyChoice: null,
      speciesOverride: { optionId: OPTION_B, speciesId: 'abra', evidenceId: 'gm-form:bad' },
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.offspring.species-override-invalid'] })
  })

  it('rejects unavailable/stale compatibility and preserves pure immutable provenance', () => {
    const parents = [
      parent('sheet:abra-f', 'abra', 'female', ['humanshape']),
      parent('sheet:bulbasaur-m', 'bulbasaur', 'male', ['monster', 'plant']),
    ] as const
    const unavailable = setup(parents)
    const result = resolveBreedingOffspring({
      ...unavailable, familyRoll: 5, familyChoice: null, speciesOverride: null,
    })
    expect(result).toMatchObject({
      status: 'unavailable',
      reasonIds: ['breeding.offspring.compatibility-unavailable'],
      compiledRegistryDefinitionSha256: registry.definitionSha256,
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.reasonIds)).toBe(true)

    const compatible = setup([
      parent('sheet:abra-f', 'abra', 'female', ['humanshape']),
      parent('sheet:machop-m', 'machop', 'male', ['humanshape']),
    ])
    const changedOptions = resolveBreedingCampaignOptionSnapshot({ 'breeding.parent-family-policy': 'maternal-family' })
    expect(resolveBreedingOffspring({
      parents: compatible.parents,
      compatibility: compatible.compatibility,
      options: changedOptions,
      familyRoll: null,
      familyChoice: null,
      speciesOverride: null,
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.offspring.compatibility-unavailable'] })
  })
})
