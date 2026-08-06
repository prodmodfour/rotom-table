import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import modifierProviderContractJson from '../../data/breeding-automation/modifier-provider-handoff-contract.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { createPokemonEggOffspringBlueprintV1 } from '../../server/domain/breeding/lineage'
import { createBreedingRollRecordFromInjectedValues } from '../../server/domain/breeding/ledgers'
import { createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import {
  breedingEggWarmerCapabilityRollSourceDefinitionHashesV1,
  deriveBreedingEggWarmerCapabilityRollRecordIdV1,
  planBreedingEggWarmerCapabilityV1,
} from '../../server/domain/breeding/eggWarmerCapability'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import {
  BREEDING_MODIFIER_PROVIDER_HANDOFF_POLICY_DEFINITION_SHA256,
  createBreedingChemistrySetHandoffV1,
  createBreedingCoreHatchRuleHandoffV1,
  createBreedingEggWarmerCapabilityHandoffV1,
  createBreedingEggWarmerItemHandoffV1,
  createBreedingMarsupialHandoffV1,
  createBreedingParentalBondHandoffV1,
  createBreedingReanimationMachineHandoffV1,
  createBreedingProviderSnapshotFromModifierHandoffV1,
  createBreedingSerpentsMarkHandoffV1,
  parseAuthoritativeBreedingModifierProviderHandoffV1,
} from '../../server/domain/breeding/modifierProviderHandoff'
import { resolveBreedingIncubationModifierContributionsV1 } from '../../server/domain/breeding/incubation'

const hash = (digit: string): string => digit.repeat(64)
const operationId = 'breeding-operation:v1:00000000000000000000000000000001'
const eggId = 'pokemon-egg:v1:00000000000000000000000000000001'
const abilityAutomation = (pattern: string) => ({
  schemaVersion: 1 as const,
  instanceId: 'sheet:ability:serpents-mark',
  canonicalId: 'Serpent’s Mark',
  definitionVersion: 1,
  selections: [{ parameterId: 'pattern', optionIds: [pattern] }],
})
const parent = (slug: string, revision: number, pattern: string, species = 'Arbok') => ({
  slug,
  revision,
  document: {
    slug,
    revision,
    nickname: slug,
    species,
    level: 30,
    abilities: [{ name: 'Serpent’s Mark', automation: abilityAutomation(pattern) }],
  },
})
const blueprint = createPokemonEggOffspringBlueprintV1({
  schemaVersion: 1,
  speciesId: 'ekans' as never,
  familyRootSpeciesId: 'ekans' as never,
  speciesSpecDefinitionSha256: hash('1'),
  nature: { valueId: 'cuddly', resolutionKind: 'random', rollRecordId: 'breeding-roll:v1:00000000000000000000000000000001' as never, optionId: null, choiceEvidenceId: null },
  ability: { valueId: 'intimidate' as never, resolutionKind: 'random', rollRecordId: 'breeding-roll:v1:00000000000000000000000000000002' as never, optionId: null, choiceEvidenceId: null },
  gender: { valueId: 'female', resolutionKind: 'random', rollRecordId: 'breeding-roll:v1:00000000000000000000000000000003' as never, optionId: null, choiceEvidenceId: null },
  inheritanceCandidates: [],
  startingLevel: 1,
  babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
})
const egg = {
  schemaVersion: 1,
  eggId,
  revision: 2,
  status: 'incubating',
  ownerTrainerSlug: 'trainer-owner',
  source: { kind: 'fossil', sourceId: 'fossil:helix', evidenceDefinitionSha256: hash('7') },
  ruleset: { rulesetId: 'ptu-1.05-breeding-v1', definitionSha256: hash('2') },
  definitionHashes: [hash('3')],
  parents: [],
  breeder: null,
  offspring: blueprint,
  incubation: {
    averageCampaignMinutes: 10_000, targetCampaignMinutes: 10_000, accumulatedCampaignMinutes: 100,
    variationPolicyId: 'fixed-average', durationResultDefinitionSha256: hash('4'),
    lastAppliedClockRevision: 2, lastAppliedClockMinute: 100, readyAtCampaignMinute: null,
    readinessKind: null, readyOperationId: null, paused: false, pauseReasonId: null, pauseOperationId: null,
  },
  special: { state: 'not-rolled', rollRecordId: null, rollTotal: null, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false },
  hatchOperationId: null, childSheetSlug: null, terminal: null,
  createdAtCampaignMinute: 0, updatedAtCampaignMinute: 100, statusChangedAtCampaignMinute: 0,
  lastOperationId: operationId,
}

describe('BR-062 modifier-provider handoffs', () => {
  it('binds the closed reviewed modifier-provider and downstream-reservation contract', () => {
    expect(createHash('sha256').update(stableJsonStringify(modifierProviderContractJson.definition)).digest('hex')).toBe(modifierProviderContractJson.definitionSha256)
    expect(modifierProviderContractJson.definition.bindings.runtimePolicyDefinitionSha256).toBe(BREEDING_MODIFIER_PROVIDER_HANDOFF_POLICY_DEFINITION_SHA256)
    expect(modifierProviderContractJson.definition.closedPolicies).toHaveLength(9)
    expect(modifierProviderContractJson.definition.reserved).toMatchObject({ 'BR-065': expect.any(Array), 'BR-067': expect.any(Array), 'BR-068': expect.any(Array) })
  })

  it('rebuilds exact effective parameter-ready Serpent’s Mark patterns and converts them to an Egg-acceptance snapshot', () => {
    const handoff = createBreedingSerpentsMarkHandoffV1({
      parentSheets: [parent('pokemon-arbok-a', 4, 'life'), parent('pokemon-arbok-b', 7, 'speed')],
      capturedAtCampaignMinute: 600,
    })
    expect(handoff.evidence.map(entry => [entry.contribution.subjectId, entry.contribution.value])).toEqual([
      ['pokemon-arbok-a', { kind: 'canonical-id-set', values: ['life'] }],
      ['pokemon-arbok-b', { kind: 'canonical-id-set', values: ['speed'] }],
    ])
    expect(handoff.dependencyEvidence).toHaveLength(2)
    expect(parseAuthoritativeBreedingModifierProviderHandoffV1(handoff)).toEqual(handoff)
    expect(createBreedingProviderSnapshotFromModifierHandoffV1(handoff)).toMatchObject({
      checkpoint: 'egg-acceptance', capturedAtCampaignMinute: 600,
      contributions: [{ inventoryEntryId: 'ability:Serpent’s Mark' }, { inventoryEntryId: 'ability:Serpent’s Mark' }],
    })
  })

  it('ignores the Arbok-only mechanic on other Species and fails closed on malformed or unresolved relevant authority', () => {
    expect(createBreedingSerpentsMarkHandoffV1({
      parentSheets: [parent('pokemon-other', 1, 'life', 'Bulbasaur'), parent('pokemon-plain', 1, 'life', 'Bulbasaur')],
      capturedAtCampaignMinute: 1,
    }).evidence).toEqual([])
    const malformed = parent('pokemon-arbok', 1, 'life')
    ;(malformed.document.abilities[0] as { name: string }).name = "Serpent's Mark"
    expect(() => createBreedingSerpentsMarkHandoffV1({ parentSheets: [malformed, parent('pokemon-plain', 1, 'life', 'Bulbasaur')], capturedAtCampaignMinute: 1 }))
      .toThrowError(expect.objectContaining({ code: 'breeding.modifier-provider-handoff.provider-ambiguous' }))
    expect(() => createBreedingSerpentsMarkHandoffV1({ parentSheets: [parent('pokemon-arbok', 1, 'unknown'), parent('pokemon-plain', 1, 'life', 'Bulbasaur')], capturedAtCampaignMinute: 1 }))
      .toThrow()
  })

  it('binds exact Trainer inventory custody, one warmer unit, four-Egg capacity, and continuous 2x rate', () => {
    const handoff = createBreedingEggWarmerItemHandoffV1({
      egg,
      ownerTrainerSheet: {
        slug: 'trainer-owner', revision: 3,
        document: { slug: 'trainer-owner', revision: 3, name: 'Owner', inventory: { pokemonItems: [{ id: 'item-row-warmer', name: 'Egg Warmer', qty: 1 }] } },
      },
      custody: { inventoryEntryId: 'item-row-warmer', unitOrdinal: 0, assignedEggIds: [eggId] },
      capturedAtCampaignMinute: 100,
    })
    expect(handoff.evidence.map(entry => [entry.contribution.contributionId, entry.contribution.value])).toEqual([
      ['egg-capacity-4', { kind: 'integer', value: 4 }],
      ['incubation-rate-times-2', { kind: 'ratio', numerator: 2, denominator: 1 }],
    ])
    expect(resolveBreedingIncubationModifierContributionsV1({ egg, contributions: handoff })).toMatchObject({
      rateNumerator: 2, rateDenominator: 1, modifierMode: 'authoritative-rate',
      contributions: [{ providerKind: 'item', effect: 'progress-rate-multiplier', numerator: 2, denominator: 1 }],
    })
    expect(() => createBreedingEggWarmerItemHandoffV1({
      egg,
      ownerTrainerSheet: { slug: 'trainer-owner', revision: 3, document: { slug: 'trainer-owner', revision: 3, inventory: { pokemonItems: [] } } },
      custody: { inventoryEntryId: 'item-row-warmer', unitOrdinal: 0, assignedEggIds: [eggId] },
      capturedAtCampaignMinute: 100,
    })).toThrowError(expect.objectContaining({ code: 'breeding.modifier-provider-handoff.provider-unavailable' }))
  })

  it('accepts one synchronous current effective Egg Warmer Capability and binds its daily resource evidence', () => {
    const resolveEffectiveCapabilities = () => ({
      actorPlacementId: 'breeding-source:pokemon-fire',
      unresolved: [],
      instances: [{
        instanceId: 'capability:egg-warmer:source', canonicalId: 'Egg Warmer', parameters: {}, value: null,
        effective: true, suppressionReasons: [], sources: [{ kind: 'species-default', sourceId: 'species:fire', precedence: 1, label: 'Egg Warmer', value: null }],
        primarySource: { kind: 'species-default', sourceId: 'species:fire', precedence: 1, label: 'Egg Warmer', value: null },
        sourceEffectSha256: hash('5'),
      }],
    }) as any
    const input = {
      egg,
      sourcePokemonSheet: { slug: 'pokemon-fire', revision: 8, document: { slug: 'pokemon-fire', revision: 8, nickname: 'Fire', species: 'Ponyta', level: 20 } },
      capturedAtCampaignMinute: 100,
      resourceEvidenceDefinitionSha256: hash('6'),
    }
    const handoff = createBreedingEggWarmerCapabilityHandoffV1(input, { resolveEffectiveCapabilities })
    expect(handoff.evidence[0]).toMatchObject({
      disposition: 'active-br-062',
      contribution: { providerId: 'capability.egg-warmer', contributionId: 'once-per-24-hours-hatch-reduction-d10', value: { kind: 'flag', enabled: true } },
    })
    expect(() => createBreedingEggWarmerCapabilityHandoffV1(input, { resolveEffectiveCapabilities: (() => Promise.resolve(resolveEffectiveCapabilities())) as any }))
      .toThrowError(expect.objectContaining({ code: 'breeding.modifier-provider-handoff.provider-failure' }))
  })

  it('carries hatch-checkpoint Parental Bond and Marsupial authority for the BR-067 reducer', () => {
    const source = {
      slug: 'pokemon-kangaskhan', revision: 4,
      document: { slug: 'pokemon-kangaskhan', revision: 4, nickname: 'Mother', species: 'Kangaskhan', level: 30, abilities: [{ name: 'Parental Bond' }] },
    }
    const parental = createBreedingParentalBondHandoffV1({ sourcePokemonSheet: source, capturedAtCampaignMinute: 200 })
    expect(parental.evidence).toEqual([expect.objectContaining({
      disposition: 'reserved-br-067',
      contribution: expect.objectContaining({ contributionId: 'kangaskhan-baby-template-interaction', value: { kind: 'flag', enabled: true } }),
    })])
    const resolveEffectiveCapabilities = () => ({
      actorPlacementId: 'breeding-source:pokemon-kangaskhan', unresolved: [], instances: [{
        instanceId: 'capability:marsupial:source', canonicalId: 'Marsupial', parameters: {}, value: null,
        effective: true, suppressionReasons: [], sources: [], primarySource: { kind: 'species-default', sourceId: 'species:kangaskhan', precedence: 1, label: 'Marsupial', value: null }, sourceEffectSha256: hash('4'),
      }],
    }) as any
    const marsupial = createBreedingMarsupialHandoffV1({ sourcePokemonSheet: source, capturedAtCampaignMinute: 200 }, { resolveEffectiveCapabilities })
    expect(marsupial.evidence.map(entry => [entry.disposition, entry.contribution.contributionId])).toEqual([
      ['reserved-br-067', 'kangaskhan-forced-baby-template-minus-5'],
      ['reserved-br-067', 'level-25-template-removal'],
      ['reserved-br-067', 'mother-pouch-link'],
    ])
    expect(() => createBreedingMarsupialHandoffV1({ sourcePokemonSheet: source, capturedAtCampaignMinute: 200 }, {
      resolveEffectiveCapabilities: (() => Promise.resolve(resolveEffectiveCapabilities())) as any,
    })).toThrowError(expect.objectContaining({ code: 'breeding.modifier-provider-handoff.provider-failure' }))
  })

  it('binds reserved exact tool custody and current canonical core hatch rules without executing downstream sources', () => {
    const trainer = {
      slug: 'trainer-owner', revision: 9,
      document: { slug: 'trainer-owner', revision: 9, name: 'Owner', inventory: { pokemonItems: [
        { id: 'chemistry-row', name: 'Chemistry Set', qty: 1 },
        { id: 'reanimation-row', name: 'Reanimation Machine', qty: 2 },
      ] } },
    }
    const chemistry = createBreedingChemistrySetHandoffV1({ egg, ownerTrainerSheet: trainer, custody: { inventoryEntryId: 'chemistry-row', unitOrdinal: 0 }, capturedAtCampaignMinute: 100 })
    const reanimation = createBreedingReanimationMachineHandoffV1({ egg, ownerTrainerSheet: trainer, custody: { inventoryEntryId: 'reanimation-row', unitOrdinal: 1 }, capturedAtCampaignMinute: 100 })
    expect(chemistry.evidence[0]).toMatchObject({ disposition: 'reserved-br-065', contribution: { contributionId: 'artificial-egg-required-tool' } })
    expect(reanimation.evidence[0]).toMatchObject({ disposition: 'reserved-br-065', contribution: { contributionId: 'fossil-reanimation-tool' } })
    expect(() => createBreedingReanimationMachineHandoffV1({ egg, ownerTrainerSheet: trainer, custody: { inventoryEntryId: 'reanimation-row', unitOrdinal: 2 }, capturedAtCampaignMinute: 100 }))
      .toThrowError(expect.objectContaining({ code: 'breeding.modifier-provider-handoff.provider-unavailable' }))
    const core = createBreedingCoreHatchRuleHandoffV1({ egg, capturedAtCampaignMinute: 100 })
    expect(core.evidence.map(entry => [entry.disposition, entry.contribution.contributionId, entry.contribution.value])).toEqual([
      ['active-core-rule', 'bounded-starting-loyalty-offer-rank-3', { kind: 'integer', value: 3 }],
      ['active-core-rule', 'hatch-starting-tutor-point-1', { kind: 'integer', value: 1 }],
    ])
    expect(parseAuthoritativeBreedingModifierProviderHandoffV1(core)).toEqual(core)
  })

  it('consumes only one persisted d10 and applies a target-equivalent hourly reduction without changing the frozen target', () => {
    const source = { slug: 'pokemon-fire', revision: 8, document: { slug: 'pokemon-fire', revision: 8, nickname: 'Fire', species: 'Ponyta', level: 20 } }
    const resolveEffectiveCapabilities = () => ({
      actorPlacementId: 'breeding-source:pokemon-fire', unresolved: [], instances: [{
        instanceId: 'capability:egg-warmer:source', canonicalId: 'Egg Warmer', parameters: {}, value: null,
        effective: true, suppressionReasons: [], sources: [], primarySource: { kind: 'species-default', sourceId: 'species:fire', precedence: 1, label: 'Egg Warmer', value: null }, sourceEffectSha256: hash('5'),
      }],
    }) as any
    const command = parseBreedingOperationCommandV1({
      schemaVersion: 1,
      operationId: 'breeding-operation:v1:00000000000000000000000000000002',
      commandKind: 'apply-egg-warmer-capability',
      actor: { profileId: 'profile-owner', selectedTrainerSlug: 'trainer-owner' },
      ruleset: egg.ruleset,
      scopes: [{ kind: 'pokemon-egg', eggId, expectedRevision: 2 }],
      payload: { eggId, sourcePokemonSheetSlug: source.slug, expectedSourcePokemonSheetRevision: source.revision, requestReductionRoll: true },
    })
    const handoff = createBreedingEggWarmerCapabilityHandoffV1({ egg, sourcePokemonSheet: source, capturedAtCampaignMinute: 100, resourceEvidenceDefinitionSha256: hash('6') }, { resolveEffectiveCapabilities })
    const roll = createBreedingRollRecordFromInjectedValues({
      schemaVersion: 1,
      rollRecordId: deriveBreedingEggWarmerCapabilityRollRecordIdV1(command.operationId, eggId),
      operationId: command.operationId,
      commandSha256: createBreedingOperationCommandHash(command),
      operationRollOrdinal: 0,
      purpose: 'provider-bounded',
      target: { kind: 'pokemon-egg', eggId: eggId as never, revision: 2 },
      formula: 'provider-bounded', dieCount: 1, dieSides: 10, ordered: false, modifier: 0, values: [5], generatorId: 'server-rng-v1',
      sourceDefinitionHashes: breedingEggWarmerCapabilityRollSourceDefinitionHashesV1({ egg: egg as any, handoff }),
      generatedAtCampaignMinute: 100,
    })
    const planned = planBreedingEggWarmerCapabilityV1({ egg, command, campaignClock: { revision: 2, campaignMinute: 100, lastOperationId: operationId }, handoff, roll })
    expect(planned).toMatchObject({ rolledHours: 5, creditedCampaignMinutes: 300, overflowCampaignMinutes: 0, reachedReady: false })
    expect(planned.egg.incubation).toMatchObject({ targetCampaignMinutes: 10_000, accumulatedCampaignMinutes: 400 })
    expect(planned.egg.revision).toBe(3)
    const extraneous = { ...roll, values: [6], total: 6 }
    expect(() => planBreedingEggWarmerCapabilityV1({ egg, command, campaignClock: { revision: 2, campaignMinute: 100, lastOperationId: operationId }, handoff, roll: extraneous }))
      .toThrow()
  })
})
