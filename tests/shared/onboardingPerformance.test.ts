import { describe, expect, it } from 'vitest'
import creationFixtures from '../../data/onboarding/fixtures/creation-fixtures.json'
import {
  buildOnboardingCreationCatalog,
  onboardingCreationCatalog,
} from '../../shared/onboarding/catalog'
import { computeOnboardingDecisionNodes } from '../../shared/onboarding/decisions'
import {
  CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION,
  defaultCampaignOnboardingPolicyContent,
  parseCampaignOnboardingPolicyContent,
} from '../../shared/onboarding/policy'
import { createEmptyOnboardingDraft, parseOnboardingDraft } from '../../shared/onboarding/draft'
import { validateOnboardingPackage } from '../../shared/onboarding/validate'
import {
  allocateOnboardingDraftId,
  allocateOnboardingPolicyId,
  allocateOnboardingSlotId,
} from '../../shared/onboarding/ids'

/**
 * Catalog, validation, and rendering-input performance budgets (P9-089).
 * Bounds are deliberately generous CI-safe ceilings that still catch
 * quadratic regressions in catalog compilation and validation.
 */

const median = (samples: number[]): number => {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]!
}

const trioFixture = creationFixtures.fixtures.find(fixture => fixture.fixtureId === 'multiple-starters')!

const sixStarterPolicy = () => {
  const base = defaultCampaignOnboardingPolicyContent()
  return parseCampaignOnboardingPolicyContent({
    ...base,
    schemaVersion: CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION,
    pokemon: { ...base.pokemon, starterCount: 6, starterPool: { mode: 'any-canonical' } },
  })
}

const sixStarterDraft = () => {
  const catalog = onboardingCreationCatalog()
  const raw = trioFixture.trainerBuild as Record<string, any>
  const base = createEmptyOnboardingDraft({
    draftId: allocateOnboardingDraftId(() => 0.5),
    slotId: allocateOnboardingSlotId(() => 0.5),
    profileId: 'profile_perfprobe01' as never,
    policyId: allocateOnboardingPolicyId(() => 0.5),
    policyVersion: 1,
    starterCount: 6,
    catalogFingerprint: catalog.catalogFingerprint,
    now: 1_700_000_000_000,
  })
  const starterSpecies = ['Bulbasaur', 'Charmander', 'Squirtle', 'Chikorita', 'Cyndaquil', 'Totodile']
  return parseOnboardingDraft({
    ...base,
    trainerBuild: {
      ...base.trainerBuild,
      name: 'Perf Probe',
      statAllocation: raw.statAllocation,
      background: raw.background,
      trainingFeatureId: raw.trainingFeature,
      edges: raw.edges.map((edge: any, index: number) => ({
        entryId: `edge-${index + 1}`, canonicalId: edge.name, grantLevel: null, choices: edge.choices ?? {},
      })),
      features: raw.features.map((feature: any, index: number) => ({
        entryId: `feature-${index + 1}`, canonicalId: feature.name, isClassAnchor: feature.isClassAnchor === true, choices: feature.choices ?? {},
      })),
    },
    pokemonBuilds: starterSpecies.map((species, index) => ({
      buildId: `starter-${index + 1}`,
      speciesId: species,
      nickname: null,
      natureId: 'Hardy',
      gender: 'Male',
      abilityIds: [],
      moveIds: [],
      addedStats: { hp: 0, atk: 0, def: 0, satk: 0, sdef: 0, spd: 0 },
      heldItemId: null,
      caughtBallId: null,
      teamSlot: index + 1,
    })),
  })
}

describe('onboarding performance budgets (P9-089)', () => {
  it('compiles the creation catalog within budget', () => {
    const started = performance.now()
    const catalog = buildOnboardingCreationCatalog()
    const elapsed = performance.now() - started
    expect(catalog.species.size).toBeGreaterThan(1000)
    expect(elapsed, `catalog build took ${elapsed.toFixed(0)}ms`).toBeLessThan(3000)
  })

  it('validates a six-starter package within the recompute budget', () => {
    const catalog = onboardingCreationCatalog()
    const policy = sixStarterPolicy()
    const draft = sixStarterDraft()
    const pkg = {
      trainerBuild: draft.trainerBuild,
      pokemonBuilds: draft.pokemonBuilds,
      deferredDecisions: draft.deferredDecisions,
    }
    // Warm up, then sample.
    validateOnboardingPackage(pkg, policy, catalog, { profileBound: true })
    const samples: number[] = []
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now()
      validateOnboardingPackage(pkg, policy, catalog, { profileBound: true })
      samples.push(performance.now() - started)
    }
    expect(median(samples), `validation median ${median(samples).toFixed(1)}ms`).toBeLessThan(250)
  })

  it('filters the full species catalog within the list-interaction budget', () => {
    const catalog = onboardingCreationCatalog()
    const samples: number[] = []
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now()
      const matches = [...catalog.species.values()]
        .filter(species => species.eligible && species.speciesId.toLocaleLowerCase().includes('a'))
      samples.push(performance.now() - started)
      expect(matches.length).toBeGreaterThan(100)
    }
    expect(median(samples), `species filter median ${median(samples).toFixed(1)}ms`).toBeLessThan(100)
  })

  it('computes decision nodes for the largest draft within budget', () => {
    const catalog = onboardingCreationCatalog()
    const policy = sixStarterPolicy()
    const draft = sixStarterDraft()
    const samples: number[] = []
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now()
      const nodes = computeOnboardingDecisionNodes(draft, policy, catalog)
      samples.push(performance.now() - started)
      expect(nodes.length).toBeGreaterThan(30)
    }
    expect(median(samples), `decision graph median ${median(samples).toFixed(1)}ms`).toBeLessThan(50)
  })
})
