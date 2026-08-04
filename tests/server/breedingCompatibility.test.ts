import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_CAMPAIGN_OPTION_COUNT,
  BREEDING_CAMPAIGN_OPTION_IDS,
  BreedingCampaignOptionValidationError,
  DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
  parseBreedingCampaignOptionSnapshotV1,
  resolveBreedingCampaignOptionSnapshot,
} from '../../server/domain/breeding/campaignOptions'
import {
  BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
  evaluateBreedingCompatibility,
  type BreedingCompatibilityParentFacts,
  type BreedingParentGenderId,
} from '../../server/domain/breeding/compatibility'
import type { BreedingEggGroupId, BreedingSpeciesId } from '#shared/breeding/ids'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const hashDefinition = (value: unknown): string => sha256(stableJsonStringify(value))
const policy = readJson<Record<string, any>>('data/breeding-automation/compatibility-policy.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const compiledRegistry = readJson<{ definitionSha256: string }>('data/breeding-automation/compiled-registry.json')

const parent = (
  parentRef: string,
  speciesId: string,
  genderId: BreedingParentGenderId,
  eggGroupIds: string[],
  overrides: Partial<BreedingCompatibilityParentFacts> = {},
): BreedingCompatibilityParentFacts => ({
  parentRef,
  speciesId: speciesId as BreedingSpeciesId,
  genderId,
  level: 20,
  eggGroupIds: eggGroupIds as BreedingEggGroupId[],
  gmMaturityConfirmed: true,
  ...overrides,
})
const femaleAbra = () => parent('sheet:abra-f', 'abra', 'female', ['humanshape'])
const maleKadabra = () => parent('sheet:kadabra-m', 'kadabra', 'male', ['humanshape'])
const options = (overrides: Record<string, unknown> = {}) => resolveBreedingCampaignOptionSnapshot(overrides)
const evaluate = (
  first: BreedingCompatibilityParentFacts,
  second: BreedingCompatibilityParentFacts,
  optionOverrides: Record<string, unknown> = {},
  roleOverride: any = null,
) => evaluateBreedingCompatibility({ parents: [first, second], options: options(optionOverrides), roleOverride })

describe('breeding campaign options and pure compatibility', () => {
  it('freezes the source-bound compatibility policy and closed reason order', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      policyId: 'ptu-1.05-breeding-compatibility-policy-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
      definitionSha256: BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
    })
    expect(policy.definitionSha256).toBe(hashDefinition(policy.definition))
    expect(policy.definition.bindings.compiledRegistryDefinitionSha256).toBe(compiledRegistry.definitionSha256)
    expect(policy.definition.reasonIds).toHaveLength(14)
    expect(new Set(policy.definition.reasonIds).size).toBe(14)
    expect(policy.definition.ditto).toMatchObject({
      speciesId: 'ditto',
      dittoPair: 'incompatible',
      eggGroupIntersection: 'bypassed-for-exactly-one-canonical-ditto',
      offspringFamilyContribution: 'never',
    })
    expect(policy.definition.determinism).toMatchObject({ mutation: 'none', randomness: 'none' })
  })

  it('resolves, validates, hashes, and freezes all 15 ruleset campaign options', () => {
    expect(BREEDING_CAMPAIGN_OPTION_COUNT).toBe(15)
    expect(BREEDING_CAMPAIGN_OPTION_IDS).toEqual(ruleset.definition.campaignOptions.map((row: any) => row.id))
    expect(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT.values).toEqual(Object.fromEntries(
      ruleset.definition.campaignOptions.map((row: any) => [row.id, row.default]),
    ))
    expect(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT.definitionSha256).toBe(hashDefinition({
      schemaVersion: 1,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      values: DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT.values,
    }))
    expect(Object.isFrozen(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT)).toBe(true)
    expect(Object.isFrozen(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT.values)).toBe(true)
    expect(parseBreedingCampaignOptionSnapshotV1(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT))
      .toEqual(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT)

    const minimumLevel = options({
      'breeding.maturity-policy': 'minimum-level',
      'breeding.minimum-maturity-level': 35,
    })
    expect(minimumLevel.values['breeding.maturity-policy']).toBe('minimum-level')
    expect(minimumLevel.values['breeding.minimum-maturity-level']).toBe(35)

    expect(() => options({ 'breeding.unknown': true })).toThrowError(BreedingCampaignOptionValidationError)
    expect(() => options({ 'breeding.minimum-maturity-level': 35 })).toThrowError(expect.objectContaining({
      code: 'breeding.options.inactive-value',
    }))
    expect(() => options({
      'breeding.maturity-policy': 'minimum-level',
      'breeding.minimum-maturity-level': 101,
    })).toThrowError(expect.objectContaining({ code: 'breeding.options.invalid-value' }))

    const drifted = { ...structuredClone(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT), definitionSha256: '0'.repeat(64) }
    expect(() => parseBreedingCampaignOptionSnapshotV1(drifted)).toThrowError(expect.objectContaining({
      code: 'breeding.options.invalid-hash',
    }))
  })

  it('accepts a conventional mature female/male pair with exact shared groups and deterministic roles', () => {
    const first = femaleAbra()
    const second = maleKadabra()
    const before = structuredClone([first, second])
    const result = evaluate(first, second)
    expect(result).toEqual({
      status: 'compatible',
      reasonIds: [],
      compatibilityKind: 'conventional',
      parentRoles: [
        { parentRef: 'sheet:abra-f', roleId: 'female-parent', assignmentKind: 'conventional-gender', evidenceId: null },
        { parentRef: 'sheet:kadabra-m', roleId: 'male-parent', assignmentKind: 'conventional-gender', evidenceId: null },
      ],
      sharedEggGroupIds: ['humanshape'],
      familyContributorParentIndexes: [0, 1],
      maturitySatisfied: [true, true],
      optionSnapshotDefinitionSha256: DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT.definitionSha256,
    })
    expect(evaluate(first, second)).toEqual(result)
    expect([first, second]).toEqual(before)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.parentRoles)).toBe(true)
  })

  it('applies canonical Ditto compatibility, role, and family-contribution semantics by Species ID only', () => {
    const ditto = parent('sheet:ditto', 'ditto', 'genderless', ['ditto'])
    const male = maleKadabra()
    const gendered = evaluate(ditto, male)
    expect(gendered).toMatchObject({
      status: 'compatible',
      compatibilityKind: 'canonical-ditto',
      parentRoles: [
        { parentRef: 'sheet:ditto', roleId: 'female-parent', assignmentKind: 'canonical-ditto' },
        { parentRef: 'sheet:kadabra-m', roleId: 'male-parent', assignmentKind: 'canonical-ditto' },
      ],
      sharedEggGroupIds: [],
      familyContributorParentIndexes: [1],
    })

    const magnemite = parent('sheet:magnemite', 'magnemite', 'genderless', ['mineral'])
    expect(evaluate(ditto, magnemite)).toMatchObject({
      status: 'compatible',
      parentRoles: [
        { parentRef: 'sheet:ditto', roleId: 'male-parent' },
        { parentRef: 'sheet:magnemite', roleId: 'female-parent' },
      ],
      familyContributorParentIndexes: [1],
    })
    expect(evaluate(ditto, parent('sheet:ditto-2', 'ditto', 'genderless', ['ditto']))).toMatchObject({
      status: 'unavailable',
      reasonIds: ['breeding.compatibility.ditto-pair'],
    })
  })

  it('requires explicit complementary GM role evidence for enabled same-sex and genderless overrides', () => {
    const sameSex = evaluate(femaleAbra(), parent('sheet:kadabra-f', 'kadabra', 'female', ['humanshape']))
    expect(sameSex).toMatchObject({
      status: 'unavailable',
      reasonIds: ['breeding.compatibility.same-sex-unavailable'],
    })
    const enabledNoEvidence = evaluate(
      femaleAbra(),
      parent('sheet:kadabra-f', 'kadabra', 'female', ['humanshape']),
      { 'breeding.same-sex-policy': 'gm-role-override' },
    )
    expect(enabledNoEvidence).toMatchObject({
      status: 'unavailable',
      reasonIds: ['breeding.compatibility.role-override-required'],
    })
    const override = { evidenceId: 'gm-override:001', roles: ['female-parent', 'male-parent'] }
    expect(evaluate(
      femaleAbra(),
      parent('sheet:kadabra-f', 'kadabra', 'female', ['humanshape']),
      { 'breeding.same-sex-policy': 'gm-role-override' },
      override,
    )).toMatchObject({
      status: 'compatible',
      compatibilityKind: 'gm-role-override',
      parentRoles: [
        { roleId: 'female-parent', assignmentKind: 'gm-override', evidenceId: 'gm-override:001' },
        { roleId: 'male-parent', assignmentKind: 'gm-override', evidenceId: 'gm-override:001' },
      ],
    })

    const magnemite = parent('sheet:magnemite', 'magnemite', 'genderless', ['mineral'])
    const voltorb = parent('sheet:voltorb', 'voltorb', 'genderless', ['mineral'])
    expect(evaluate(magnemite, voltorb)).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.compatibility.genderless-unavailable'],
    })
    expect(evaluate(
      magnemite,
      voltorb,
      { 'breeding.genderless-policy': 'gm-role-override' },
      { evidenceId: 'gm-override:002', roles: ['male-parent', 'female-parent'] },
    )).toMatchObject({ status: 'compatible', compatibilityKind: 'gm-role-override' })
  })

  it('evaluates explicit confirmation or minimum-Level maturity without inferring from evolution', () => {
    const unconfirmed = { ...femaleAbra(), gmMaturityConfirmed: false }
    expect(evaluate(unconfirmed, maleKadabra())).toMatchObject({
      status: 'unavailable',
      reasonIds: ['breeding.compatibility.maturity-unconfirmed'],
      maturitySatisfied: [false, true],
    })

    let low = { ...femaleAbra(), level: 19, gmMaturityConfirmed: false }
    const high = { ...maleKadabra(), level: 20, gmMaturityConfirmed: false }
    expect(evaluate(low, high, {
      'breeding.maturity-policy': 'minimum-level',
      'breeding.minimum-maturity-level': 20,
    })).toMatchObject({
      status: 'unavailable',
      reasonIds: ['breeding.compatibility.maturity-level-low'],
      maturitySatisfied: [false, true],
    })
    low = { ...low, level: 20 }
    expect(evaluate(low, high, {
      'breeding.maturity-policy': 'minimum-level',
      'breeding.minimum-maturity-level': 20,
    })).toMatchObject({ status: 'compatible', maturitySatisfied: [true, true] })
  })

  it('fails closed with stable ordered reasons for groups, identity, Gender, duplicates, and unnecessary overrides', () => {
    const noGroup = evaluate(femaleAbra(), parent('sheet:bulbasaur', 'bulbasaur', 'male', ['monster', 'plant']))
    expect(noGroup).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.compatibility.no-shared-egg-group'], sharedEggGroupIds: [],
    })

    const unavailable = parent('sheet:mew', 'mew', 'genderless', ['ditto'])
    const unavailableResult = evaluate(unavailable, maleKadabra())
    expect(unavailableResult.reasonIds).toEqual([
      'breeding.compatibility.spec-unavailable',
      'breeding.compatibility.no-shared-egg-group',
      'breeding.compatibility.genderless-unavailable',
    ])

    const mismatch = parent('sheet:abra-genderless', 'abra', 'genderless', ['humanshape'])
    expect(evaluate(mismatch, maleKadabra()).reasonIds).toContain('breeding.compatibility.gender-mismatch')

    const same = femaleAbra()
    expect(evaluate(same, { ...maleKadabra(), parentRef: same.parentRef }).reasonIds[0]).toBe('breeding.compatibility.same-parent')

    expect(evaluate(
      femaleAbra(),
      maleKadabra(),
      {},
      { evidenceId: 'unneeded', roles: ['female-parent', 'male-parent'] },
    )).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.compatibility.role-override-not-allowed'] })

    const malformedGroups = {
      ...femaleAbra(),
      eggGroupIds: ['humanshape', 'humanshape'] as BreedingEggGroupId[],
    }
    expect(evaluate(malformedGroups, maleKadabra()).reasonIds).toContain('breeding.compatibility.invalid-parent-facts')
  })
})
