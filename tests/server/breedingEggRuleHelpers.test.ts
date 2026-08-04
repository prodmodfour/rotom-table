import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingSpeciesId } from '#shared/breeding/ids'
import { resolveBreedingCampaignOptionSnapshot } from '../../server/domain/breeding/campaignOptions'
import {
  BREEDING_EGG_RULE_HELPERS_POLICY_DEFINITION_SHA256,
  BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256,
  resolveBreedingBabyTemplate,
  resolveBreedingHatchDuration,
  resolveBreedingHatchSpecial,
  resolveBreedingHatchStartingLevel,
} from '../../server/domain/breeding/eggRuleHelpers'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const hashDefinition = (value: unknown): string => sha256(stableJsonStringify(value))
const policy = readJson<Record<string, any>>('data/breeding-automation/egg-rule-helpers-policy.json')
const durationPolicy = readJson<Record<string, any>>('data/breeding-automation/hatch-duration-policy.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const registry = readJson<{ definitionSha256: string }>('data/breeding-automation/compiled-registry.json')
const modifierInventory = readJson<{ definitionSha256: string }>('data/breeding-automation/modifier-inventory.json')
const OPTION = 'option:v1:1234567890abcdef1234567890abcdef' as const
const speciesId = 'bulbasaur' as BreedingSpeciesId
const defaultOptions = () => resolveBreedingCampaignOptionSnapshot()
const duration = (overrides: Record<string, unknown> = {}, input: Record<string, unknown> = {}) => resolveBreedingHatchDuration({
  speciesId,
  sourceKind: 'breeding',
  options: resolveBreedingCampaignOptionSnapshot(overrides),
  durationOverride: null,
  variationRoll: null,
  gmTarget: null,
  ...input,
} as any)

const hashResolvedDefinition = (result: Record<string, any>): string => {
  const { status: _status, reasonIds: _reasonIds, resultDefinitionSha256: _hash, ...definition } = result
  return hashDefinition(definition)
}

describe('hatch duration, fossil level, Baby Template, and special-result helpers', () => {
  it('freezes the source-, ruleset-, registry-, and provider-inventory-bound helper policy', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      policyId: 'ptu-1.05-breeding-egg-rule-helpers-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
      definitionSha256: BREEDING_EGG_RULE_HELPERS_POLICY_DEFINITION_SHA256,
    })
    expect(policy.definitionSha256).toBe(hashDefinition(policy.definition))
    expect(policy.definition.bindings).toMatchObject({
      hatchDurationPolicyDefinitionSha256: durationPolicy.definitionSha256,
      compiledRegistryDefinitionSha256: registry.definitionSha256,
      sourceAdjudicationsFileSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-adjudications.json'))),
      modifierInventoryDefinitionSha256: modifierInventory.definitionSha256,
    })
    expect(BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256).toBe(durationPolicy.definitionSha256)
    expect(policy.definition.specialResult).toMatchObject({
      roll: 'one-persisted-1d100-at-hatch',
      rollTriggerTotals: [1, 100],
      automaticShiny: false,
      configuredBoundedTable: 'unavailable-until-reviewed-app-owned-table-registry-exists',
    })
    expect(policy.definition.reasonIds).toHaveLength(20)
  })

  it('resolves fixed compiled hatch duration in campaign minutes with immutable hashes', () => {
    const result = duration()
    expect(result).toMatchObject({
      status: 'resolved',
      speciesId: 'bulbasaur',
      sourceKind: 'breeding',
      averageCampaignMinutes: 14_400,
      durationSourceKind: 'compiled-spec',
      durationSourceEvidence: null,
      variationPolicyId: 'fixed-average',
      variationRoll: null,
      targetCampaignMinutes: 14_400,
      hatchDurationPolicyDefinitionSha256: durationPolicy.definitionSha256,
    })
    expect(result.resultDefinitionSha256).toBe(hashResolvedDefinition(result as any))
    expect(Object.isFrozen(result)).toBe(true)
    if (result.status === 'resolved') expect(result.speciesSpecDefinitionSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(duration()).toEqual(result)
  })

  it('uses only injected persisted random variation and exact ceil half-to-double boundaries', () => {
    expect(duration({ 'breeding.hatch-duration-variation': 'server-random-half-to-double' }, {
      variationRoll: { rollId: 'roll:duration:50', total: 50 },
    })).toMatchObject({
      status: 'resolved', variationPolicyId: 'server-random-half-to-double',
      variationRoll: { rollId: 'roll:duration:50', total: 50 }, targetCampaignMinutes: 7_200,
    })
    expect(duration({ 'breeding.hatch-duration-variation': 'server-random-half-to-double' }, {
      variationRoll: { rollId: 'roll:duration:200', total: 200 },
    })).toMatchObject({ status: 'resolved', targetCampaignMinutes: 28_800 })
    expect(duration({ 'breeding.hatch-duration-variation': 'server-random-half-to-double' }))
      .toMatchObject({ status: 'unavailable', reasonIds: ['breeding.hatch-duration.roll-missing'] })
    expect(duration({ 'breeding.hatch-duration-variation': 'server-random-half-to-double' }, {
      variationRoll: { rollId: 'roll:duration:bad', total: 49 },
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.hatch-duration.roll-invalid'] })
    expect(duration({}, { variationRoll: { rollId: 'roll:duration:extra', total: 100 } }))
      .toMatchObject({ status: 'unavailable', reasonIds: ['breeding.hatch-duration.extraneous-input'] })
  })

  it('requires a server-issued audited GM target within ceil-half and double bounds', () => {
    const options = { 'breeding.hatch-duration-variation': 'gm-within-half-to-double' }
    expect(duration(options, {
      gmTarget: { optionId: OPTION, evidenceId: 'gm-duration:1', targetCampaignMinutes: 7_200 },
    })).toMatchObject({
      status: 'resolved', variationPolicyId: 'gm-within-half-to-double', targetCampaignMinutes: 7_200,
      gmTargetOptionId: OPTION, gmTargetEvidenceId: 'gm-duration:1',
    })
    expect(duration(options, {
      gmTarget: { optionId: OPTION, evidenceId: 'gm-duration:2', targetCampaignMinutes: 28_800 },
    })).toMatchObject({ status: 'resolved', targetCampaignMinutes: 28_800 })
    expect(duration(options)).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.hatch-duration.gm-target-required'],
    })
    expect(duration(options, {
      gmTarget: { optionId: OPTION, evidenceId: 'gm-duration:bad', targetCampaignMinutes: 7_199 },
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.hatch-duration.gm-target-invalid'] })
    expect(duration(options, {
      variationRoll: { rollId: 'roll:extra', total: 100 },
      gmTarget: { optionId: OPTION, evidenceId: 'gm-duration:1', targetCampaignMinutes: 14_400 },
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.hatch-duration.extraneous-input'] })
  })

  it('enforces source-specific typed duration overrides and never grants browser override authority', () => {
    const provider = {
      authorityKind: 'authoritative-provider',
      authorityId: 'provider:fossil-lab',
      evidenceId: 'provider-evidence:1',
      authorityDefinitionSha256: 'a'.repeat(64),
      campaignMinutes: 600,
    } as const
    expect(duration({}, { sourceKind: 'fossil', durationOverride: provider })).toMatchObject({
      status: 'resolved', sourceKind: 'fossil', averageCampaignMinutes: 600,
      durationSourceKind: 'authoritative-provider', durationSourceEvidence: provider,
      targetCampaignMinutes: 600,
    })
    expect(duration({}, { sourceKind: 'fossil' })).toMatchObject({
      status: 'resolved', durationSourceKind: 'compiled-spec', targetCampaignMinutes: 14_400,
    })
    expect(duration({}, { durationOverride: provider })).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.hatch-duration.override-not-allowed'],
    })
    expect(duration({}, { sourceKind: 'feature-artificial' })).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.hatch-duration.override-required'],
    })
    expect(duration({}, { sourceKind: 'feature-artificial', durationOverride: provider })).toMatchObject({
      status: 'resolved', durationSourceKind: 'authoritative-provider', targetCampaignMinutes: 600,
    })
    const gm = { ...provider, authorityKind: 'gm-adjudication', authorityId: 'gm:duration', campaignMinutes: 1_440 } as const
    expect(duration({}, { sourceKind: 'gm', durationOverride: gm })).toMatchObject({
      status: 'resolved', durationSourceKind: 'gm-adjudication', targetCampaignMinutes: 1_440,
    })
    expect(duration({}, { sourceKind: 'gm', durationOverride: provider })).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.hatch-duration.override-invalid'],
    })
  })

  it('resolves fossil-only configurable starting Level and defaults every other source to Level 1', () => {
    const options = resolveBreedingCampaignOptionSnapshot({ 'breeding.fossil-hatch-level': 42 })
    expect(resolveBreedingHatchStartingLevel('fossil', options)).toMatchObject({
      status: 'resolved', sourceKind: 'fossil', startingLevel: 42,
    })
    for (const sourceKind of ['breeding', 'gm', 'feature-artificial'] as const) {
      expect(resolveBreedingHatchStartingLevel(sourceKind, options)).toMatchObject({
        status: 'resolved', sourceKind, startingLevel: 1,
      })
    }
    expect(resolveBreedingHatchStartingLevel('browser-authored', options)).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.egg-rules.source-kind-invalid'],
    })
    const fossil = resolveBreedingHatchStartingLevel('fossil', options)
    expect(fossil.resultDefinitionSha256).toBe(hashResolvedDefinition(fossil as any))
  })

  it('keeps Baby Template disabled by default and freezes bounded per-Egg GM effects when enabled', () => {
    expect(resolveBreedingBabyTemplate(defaultOptions(), null)).toMatchObject({
      status: 'resolved', applied: false, choiceOptionId: null, effects: null,
    })
    expect(resolveBreedingBabyTemplate(defaultOptions(), {
      optionId: OPTION, evidenceId: 'baby:forbidden', apply: true, sizePercentOfAdult: 50,
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.baby-template.choice-not-allowed'] })

    const enabled = resolveBreedingCampaignOptionSnapshot({
      'breeding.baby-template-policy': 'per-egg-gm-choice',
      'breeding.baby-template-stat-penalty': 4,
    })
    expect(resolveBreedingBabyTemplate(enabled, null)).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.baby-template.choice-required'],
    })
    expect(resolveBreedingBabyTemplate(enabled, {
      optionId: OPTION, evidenceId: 'baby:decline', apply: false, sizePercentOfAdult: null,
    })).toMatchObject({
      status: 'resolved', applied: false, choiceOptionId: OPTION, choiceEvidenceId: 'baby:decline', effects: null,
    })
    const applied = resolveBreedingBabyTemplate(enabled, {
      optionId: OPTION, evidenceId: 'baby:apply', apply: true, sizePercentOfAdult: 65,
    })
    expect(applied).toMatchObject({
      status: 'resolved', applied: true, choiceOptionId: OPTION, choiceEvidenceId: 'baby:apply',
      effects: {
        baseStatPenaltyEach: 4,
        skillRankPenalty: 1,
        capabilityPenalty: 2,
        sizePercentOfAdult: 65,
        recoveryBaseStatPointsEachInterval: 1,
        recoveryIntervalLevels: 5,
        recoveryStepCount: 4,
        removeSkillAndCapabilityPenaltyAfterFinalRecovery: true,
      },
    })
    expect(Object.isFrozen(applied)).toBe(true)
    expect(applied.effects && Object.isFrozen(applied.effects)).toBe(true)
    expect(resolveBreedingBabyTemplate(enabled, {
      optionId: OPTION, evidenceId: 'baby:bad', apply: true, sizePercentOfAdult: 49,
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.baby-template.choice-invalid'] })
  })

  it('opens a bounded special workflow only for 1, 100, or authoritative provider force and never auto-Shiny', () => {
    const options = defaultOptions()
    expect(resolveBreedingHatchSpecial(options, { rollId: 'roll:special:50', total: 50 }, null)).toMatchObject({
      status: 'resolved', isSpecial: false, workflow: 'none', triggerIds: [], automaticShiny: false,
    })
    expect(resolveBreedingHatchSpecial(options, { rollId: 'roll:special:1', total: 1 }, null)).toMatchObject({
      status: 'resolved', isSpecial: true, workflow: 'bounded-gm-adjudication-pending',
      triggerIds: ['roll-1'], automaticShiny: false,
    })
    expect(resolveBreedingHatchSpecial(options, { rollId: 'roll:special:100', total: 100 }, null)).toMatchObject({
      status: 'resolved', isSpecial: true, triggerIds: ['roll-100'], automaticShiny: false,
    })
    const forced = {
      providerId: 'provider:innovation', evidenceId: 'special-force:1', providerDefinitionSha256: 'c'.repeat(64),
    }
    expect(resolveBreedingHatchSpecial(options, { rollId: 'roll:special:50', total: 50 }, forced)).toMatchObject({
      status: 'resolved', isSpecial: true, triggerIds: ['provider-force'], forcedByProvider: forced,
      workflow: 'bounded-gm-adjudication-pending', automaticShiny: false,
    })
    expect(resolveBreedingHatchSpecial(options, { rollId: 'roll:special:1', total: 1 }, forced)).toMatchObject({
      status: 'resolved', triggerIds: ['roll-1', 'provider-force'],
    })
  })

  it('fails closed for missing/bad special rolls, malformed providers, stale options, and absent configured tables', () => {
    const options = defaultOptions()
    expect(resolveBreedingHatchSpecial(options, null, null)).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.hatch-special.roll-required'],
    })
    expect(resolveBreedingHatchSpecial(options, { rollId: 'roll:special:0', total: 0 }, null)).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.hatch-special.roll-invalid'],
    })
    expect(resolveBreedingHatchSpecial(options, { rollId: 'roll:special:50', total: 50 }, {
      providerId: 'provider:bad', evidenceId: 'force:bad', providerDefinitionSha256: 'bad',
    })).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.hatch-special.provider-evidence-invalid'],
    })
    const table = resolveBreedingCampaignOptionSnapshot({ 'breeding.hatch-special-policy': 'configured-bounded-table' })
    expect(resolveBreedingHatchSpecial(table, { rollId: 'roll:special:1', total: 1 }, null)).toMatchObject({
      status: 'unavailable', reasonIds: ['breeding.hatch-special.table-unavailable'],
      automaticShiny: false,
    })
    expect(resolveBreedingHatchSpecial({ ...options, definitionSha256: '0'.repeat(64) }, { rollId: 'roll:special:50', total: 50 }, null))
      .toMatchObject({ status: 'unavailable', reasonIds: ['breeding.egg-rules.options-invalid'] })
  })
})
