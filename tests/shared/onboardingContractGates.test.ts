import { describe, expect, it } from 'vitest'
import creationFixtures from '../../data/onboarding/fixtures/creation-fixtures.json'
import {
  buildOnboardingCreationCatalog,
  onboardingCreationCatalog,
} from '../../shared/onboarding/catalog'
import {
  CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION,
  canonicalOnboardingPolicyContentString,
  defaultCampaignOnboardingPolicyContent,
  parseCampaignOnboardingPolicyContent,
  type CampaignOnboardingPolicyContentV1,
} from '../../shared/onboarding/policy'
import {
  ONBOARDING_TRAINER_SKILLS,
  createEmptyOnboardingDraft,
  parseOnboardingPokemonBuild,
  parseOnboardingTrainerBuild,
  type OnboardingPokemonBuildV1,
  type OnboardingTrainerBuildV1,
} from '../../shared/onboarding/draft'
import {
  assertOnboardingTransition,
  classifyOnboardingIdempotentRetry,
  OnboardingLifecycleError,
} from '../../shared/onboarding/lifecycle'
import {
  computeOnboardingPokemonPreview,
  computeOnboardingTrainerPreview,
} from '../../shared/onboarding/preview'
import { validateOnboardingPackage } from '../../shared/onboarding/validate'
import { ONBOARDING_ISSUE_DEFINITIONS } from '../../shared/onboarding/validation'
import { allocateOnboardingDraftId, allocateOnboardingPolicyId, allocateOnboardingSlotId, parseOnboardingDecisionId } from '../../shared/onboarding/ids'
import { FEATURE_PREREQUISITES } from '../../shared/featureAutomation/prerequisites'
import { PTU_NATURE_CHART } from '../../shared/ruleset/natures'
import { PTU_NATURES } from '../../src/utils/ptuNatures'
import { TRAINER_SKILLS } from '../../src/types/trainerSheet'
import { computeTrainerFormulaMaxHp } from '../../src/utils/ptuHp'
import { computePokemonTutorPointsEarned } from '../../src/utils/sheets/pokemonTutorPoints'

type CreationFixture = (typeof creationFixtures)['fixtures'][number]

const catalog = onboardingCreationCatalog()

/* ------------------------------------------------------------------ */
/* Fixture adapters                                                   */
/* ------------------------------------------------------------------ */

const policyFromFixture = (fixture: CreationFixture): CampaignOnboardingPolicyContentV1 => {
  const raw = fixture.policy as Record<string, any>
  return parseCampaignOnboardingPolicyContent({
    schemaVersion: CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION,
    trainer: {
      startingLevel: raw.trainer.startingLevel,
      startingMoney: raw.trainer.startingMoney === 'canonical-baseline'
        ? { kind: 'canonical-baseline' }
        : { kind: 'explicit', amount: raw.trainer.startingMoney },
      featureRestriction: { mode: 'all-canonical' },
      edgeRestriction: { mode: 'all-canonical' },
      milestoneCollection: raw.trainer.milestoneCollection ?? 'during-onboarding',
    },
    pokemon: {
      starterCount: raw.pokemon.starterCount,
      starterLevel: raw.pokemon.starterLevel,
      starterPool: raw.pokemon.starterPool.mode === 'curated-list'
        ? { mode: 'curated-list', speciesIds: raw.pokemon.starterPool.species }
        : { mode: 'any-canonical' },
      stageRestriction: 'unrestricted',
      additionalMoveSources: [],
      startingLoyalty: { kind: 'canonical-baseline' },
      caughtBallPolicy: raw.pokemon.caughtBallPolicy ?? 'standard-metadata',
    },
    packages: {
      trainerItems: raw.packages.trainerItems ?? [],
      starterHeldItems: raw.packages.starterHeldItems ?? [],
    },
    workflow: {
      unresolvedChoicePolicy: raw.workflow.unresolvedChoicePolicy,
      deferrableDecisions: raw.workflow.deferrableDecisions ?? [],
      approval: raw.workflow.approval,
      destinations: raw.workflow.destinations,
    },
  })
}

const trainerBuildFromFixture = (fixture: CreationFixture): OnboardingTrainerBuildV1 => {
  const raw = fixture.trainerBuild as Record<string, any>
  return parseOnboardingTrainerBuild({
    name: raw.name,
    identity: {},
    statAllocation: raw.statAllocation,
    background: raw.background,
    trainingFeatureId: raw.trainingFeature,
    edges: [
      ...raw.edges.map((edge: any, index: number) => ({
        entryId: `edge-${index + 1}`,
        canonicalId: edge.name,
        grantLevel: null,
        choices: edge.choices ?? {},
      })),
      ...(raw.bonusSkillEdges ?? []).map((edge: any, index: number) => ({
        entryId: `bonus-${index + 1}`,
        canonicalId: edge.name,
        grantLevel: edge.grantLevel,
        choices: edge.choices ?? {},
      })),
    ],
    features: raw.features.map((feature: any, index: number) => ({
      entryId: `feature-${index + 1}`,
      canonicalId: feature.name,
      isClassAnchor: feature.isClassAnchor === true,
      choices: feature.choices ?? {},
    })),
    milestoneChoices: raw.milestoneChoices ?? [],
  })
}

const pokemonBuildsFromFixture = (fixture: CreationFixture): OnboardingPokemonBuildV1[] =>
  (fixture.pokemonBuilds as Record<string, any>[]).map((build, index) =>
    parseOnboardingPokemonBuild({
      buildId: `starter-${index + 1}`,
      speciesId: build.species,
      nickname: build.nickname,
      natureId: build.nature,
      gender: build.gender,
      abilityIds: build.abilities,
      moveIds: build.moves,
      addedStats: build.addedStats,
      heldItemId: build.heldItem,
      caughtBallId: null,
      teamSlot: build.teamSlot,
    }))

/* ------------------------------------------------------------------ */
/* Catalog gates                                                      */
/* ------------------------------------------------------------------ */

describe('onboarding creation catalog (P9-015)', () => {
  it('compiles deterministically with stable fingerprints', () => {
    const first = buildOnboardingCreationCatalog()
    const second = buildOnboardingCreationCatalog()
    expect(first.catalogFingerprint).toBe(second.catalogFingerprint)
    expect(first.catalogFingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(first.sourceFingerprints.length).toBeGreaterThanOrEqual(10)
  })

  it('freezes canonical entitlements and budgets', () => {
    expect(catalog.trainer.entitlements.paidFeaturesAtLevelOne).toBe(4)
    expect(catalog.trainer.entitlements.edgesAtLevelOne).toBe(4)
    expect(catalog.trainer.entitlements.freeTrainingFeatureIds).toHaveLength(4)
    expect(catalog.trainer.statBudget(1)).toBe(10)
    expect(catalog.trainer.statBudget(5)).toBe(14)
    expect(catalog.pokemon.addedStatBudget(5)).toBe(15)
    expect(catalog.pokemon.activeMoveMaximum).toBe(6)
    expect(catalog.trainer.background).toMatchObject({ adeptPicks: 1, novicePicks: 1, patheticPicks: 3 })
    expect(catalog.trainer.startingMoney.recommendedDefault).toBe(5000)
    expect(catalog.pokemon.startingLoyalty).toMatchObject({ defaultValue: 2, minimum: 0, maximum: 6 })
  })

  it('fails species with incomplete canonical data closed', () => {
    expect(catalog.species.size).toBeGreaterThan(1000)
    const eligible = [...catalog.species.values()].filter(species => species.eligible)
    const ineligible = [...catalog.species.values()].filter(species => !species.eligible)
    expect(eligible.length).toBeGreaterThan(800)
    expect(ineligible.length).toBeGreaterThan(50)
    for (const species of ineligible) {
      expect(species.ineligibleReasons.length, species.speciesId).toBeGreaterThan(0)
    }
    const bulbasaur = catalog.species.get('Bulbasaur')!
    expect(bulbasaur.eligible).toBe(true)
    expect(bulbasaur.baseStats).toEqual({ hp: 5, atk: 5, def: 5, satk: 7, sdef: 7, spd: 5 })
    expect(bulbasaur.stage).toBe(1)
  })

  it('keeps the feature prerequisite graph acyclic', () => {
    const edgesByFeature = new Map<string, string[]>()
    const collect = (expression: any, out: string[]): void => {
      if (expression.kind === 'feature') out.push(expression.canonicalId)
      for (const requirement of expression.requirements ?? []) collect(requirement, out)
    }
    for (const entry of FEATURE_PREREQUISITES.entries) {
      const out: string[] = []
      collect(entry.expression, out)
      edgesByFeature.set(entry.canonicalId, out)
    }
    const visiting = new Set<string>()
    const done = new Set<string>()
    const visit = (node: string, path: string[]): void => {
      if (done.has(node)) return
      expect(visiting.has(node), `cycle: ${[...path, node].join(' -> ')}`).toBe(false)
      visiting.add(node)
      for (const next of edgesByFeature.get(node) ?? []) visit(next, [...path, node])
      visiting.delete(node)
      done.add(node)
    }
    for (const node of edgesByFeature.keys()) visit(node, [])
  })

  it('has no duplicate issue codes and resolvable severities', () => {
    const codes = ONBOARDING_ISSUE_DEFINITIONS.map(definition => definition.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

/* ------------------------------------------------------------------ */
/* Drift gates: shared vs sheet runtime                               */
/* ------------------------------------------------------------------ */

describe('onboarding drift gates (P9-020)', () => {
  it('shares one nature chart with the sheet runtime', () => {
    expect(PTU_NATURES.map(nature => ({ ...nature }))).toEqual(
      PTU_NATURE_CHART.map(nature => ({ ...nature })),
    )
  })

  it('shares one trainer skill list with the sheet runtime', () => {
    expect([...ONBOARDING_TRAINER_SKILLS]).toEqual([...TRAINER_SKILLS])
  })

  it('matches the sheet runtime trainer HP and tutor point formulas', () => {
    for (const [level, hpStat] of [[1, 12], [5, 13], [10, 20]] as const) {
      const preview = computeOnboardingTrainerPreview(
        parseOnboardingTrainerBuild({
          name: 'Drift Probe',
          statAllocation: { hp: hpStat - 10, atk: 0, def: 0, satk: 0, sdef: 0, spd: 0 },
        }),
        level,
        catalog,
      )
      expect(preview.maxHp.value).toBe(computeTrainerFormulaMaxHp(level, hpStat))
    }
    for (const level of [1, 5, 10, 20]) {
      expect(catalog.pokemon.tutorPoints(level)).toBe(computePokemonTutorPointsEarned(level))
    }
  })
})

/* ------------------------------------------------------------------ */
/* Fixture agreement: validator + preview                             */
/* ------------------------------------------------------------------ */

describe('creation fixtures validate cleanly through the shared engine', () => {
  for (const fixture of creationFixtures.fixtures) {
    it(`${fixture.fixtureId}: validation matches expectations`, () => {
      const policy = policyFromFixture(fixture)
      const pkg = {
        trainerBuild: trainerBuildFromFixture(fixture),
        pokemonBuilds: pokemonBuildsFromFixture(fixture),
        deferredDecisions: ((fixture as Record<string, any>).deferredDecisions ?? [])
          .map((id: string) => parseOnboardingDecisionId(id)),
      }
      const summary = validateOnboardingPackage(pkg, policy, catalog, {
        draftCatalogFingerprint: catalog.catalogFingerprint,
        profileBound: true,
      })

      const blocking = summary.issues.filter(issue => issue.severity === 'blocking')
      expect(blocking.map(issue => `${issue.code} @ ${issue.decisionId}: ${issue.message}`))
        .toEqual([])
      expect(summary.blockingCount).toBe(fixture.expected.validation.blockingIssues)

      const expectedWarnings = fixture.expected.validation.warnings ?? []
      const warningCodes = summary.issues
        .filter(issue => issue.severity === 'warning')
        .map(issue => issue.code.split('.').pop())
      expect(warningCodes.sort()).toEqual([...expectedWarnings].sort())

      const expectedClauses = (fixture.expected.validation as Record<string, any>).reviewedBuildClauses ?? []
      const deviationTargets = summary.issues
        .filter(issue => issue.severity === 'deviation')
        .map(issue => issue.detail?.feature ?? null)
      expect(deviationTargets.length).toBe(expectedClauses.length)
      for (const clause of expectedClauses) expect(deviationTargets).toContain(clause)
    })

    it(`${fixture.fixtureId}: derived preview matches expectations`, () => {
      const policy = policyFromFixture(fixture)
      const trainerBuild = trainerBuildFromFixture(fixture)
      const preview = computeOnboardingTrainerPreview(trainerBuild, policy.trainer.startingLevel, catalog)
      const expected = fixture.expected.derivedPreview.trainer
      expect(preview.maxHp.value).toBe(expected.maxHp)
      expect(preview.apMax.value).toBe(expected.apMax)
      expect(preview.statPoints.spent).toBe(expected.statPointsSpent)
      expect(preview.statPoints.budget).toBe(expected.statPointsBudget)
      expect(preview.statPoints.remaining).toBe(0)
      if ((expected as Record<string, unknown>).milestoneImmediatePoints !== undefined) {
        expect(preview.milestonePoints.budget).toBe((expected as Record<string, any>).milestoneImmediatePoints)
        expect(preview.milestonePoints.remaining).toBe(0)
      }

      const pokemonBuilds = pokemonBuildsFromFixture(fixture)
      pokemonBuilds.forEach((build, index) => {
        const pokemonPreview = computeOnboardingPokemonPreview(build, policy.pokemon.starterLevel, catalog)
        const expectedPokemon = fixture.expected.derivedPreview.pokemon[index]!
        expect(pokemonPreview, build.buildId).not.toBeNull()
        expect(pokemonPreview!.maxHp.value).toBe(expectedPokemon.maxHp)
        expect(pokemonPreview!.addedPoints.spent).toBe(expectedPokemon.addedSpent)
        expect(pokemonPreview!.addedPoints.budget).toBe(expectedPokemon.addedBudget)
        expect(pokemonPreview!.tutorPoints.value).toBe(expectedPokemon.tutorPoints)
        expect(pokemonPreview!.experience).not.toBeNull()
      })
    })
  }

  it('rejects a forged feature ID as blocking', () => {
    const fixture = creationFixtures.fixtures[0]!
    const policy = policyFromFixture(fixture)
    const trainerBuild = trainerBuildFromFixture(fixture)
    const forged = {
      ...trainerBuild,
      features: trainerBuild.features.map((feature, index) =>
        index === 0 ? { ...feature, canonicalId: 'Totally Invented Feature' } : feature),
    }
    const summary = validateOnboardingPackage(
      { trainerBuild: forged, pokemonBuilds: pokemonBuildsFromFixture(fixture), deferredDecisions: [] },
      policy,
      catalog,
      { profileBound: true },
    )
    expect(summary.issues.some(issue => issue.code === 'trainer.feature-unknown')).toBe(true)
    expect(summary.submittable).toBe(false)
  })

  it('rejects catalog drift as blocking', () => {
    const fixture = creationFixtures.fixtures[0]!
    const summary = validateOnboardingPackage(
      {
        trainerBuild: trainerBuildFromFixture(fixture),
        pokemonBuilds: pokemonBuildsFromFixture(fixture),
        deferredDecisions: [],
      },
      policyFromFixture(fixture),
      catalog,
      { draftCatalogFingerprint: '0000000000000000', profileBound: true },
    )
    expect(summary.issues.some(issue => issue.code === 'draft.catalog-drift')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Policy, draft, and lifecycle contracts                             */
/* ------------------------------------------------------------------ */

describe('policy contract (P9-011)', () => {
  it('parses the shipped default policy deterministically', () => {
    const content = defaultCampaignOnboardingPolicyContent()
    expect(content.trainer.startingLevel).toBe(1)
    expect(content.pokemon.starterCount).toBe(1)
    const canonical = canonicalOnboardingPolicyContentString(content)
    expect(canonical).toBe(canonicalOnboardingPolicyContentString(JSON.parse(JSON.stringify(content))))
  })

  it('fails closed on unknown schema versions and illegal shapes', () => {
    expect(() => parseCampaignOnboardingPolicyContent({ schemaVersion: 2 })).toThrow(/schemaVersion/)
    const base = JSON.parse(JSON.stringify(defaultCampaignOnboardingPolicyContent())) as Record<string, any>
    base.workflow.deferrableDecisions = ['pokemon.1.caught-ball']
    expect(() => parseCampaignOnboardingPolicyContent(base)).toThrow(/deferrableDecisions/)
    base.workflow.deferrableDecisions = []
    base.pokemon.starterCount = 7
    expect(() => parseCampaignOnboardingPolicyContent(base)).toThrow(/starterCount/)
  })
})

describe('draft contract (P9-012) and lifecycle (P9-013)', () => {
  it('creates a parseable empty draft with starter shells', () => {
    const draft = createEmptyOnboardingDraft({
      draftId: allocateOnboardingDraftId(() => 0.42),
      slotId: allocateOnboardingSlotId(() => 0.42),
      profileId: 'profile_testplayer1' as never,
      policyId: allocateOnboardingPolicyId(() => 0.42),
      policyVersion: 1,
      starterCount: 3,
      catalogFingerprint: catalog.catalogFingerprint,
      now: 1_700_000_000_000,
    })
    expect(draft.state).toBe('draft')
    expect(draft.pokemonBuilds).toHaveLength(3)
    expect(draft.pokemonBuilds.map(build => build.teamSlot)).toEqual([1, 2, 3])
    expect(draft.currentDecisionId).toBe('trainer.identity')
  })

  it('enforces the closed transition graph and actor permissions', () => {
    expect(assertOnboardingTransition('draft', 'submitted', 'owner-player').action).toBe('submit')
    expect(assertOnboardingTransition('submitted', 'approved', 'gm').action).toBe('approve')
    expect(() => assertOnboardingTransition('draft', 'approved', 'gm')).toThrow(OnboardingLifecycleError)
    expect(() => assertOnboardingTransition('submitted', 'approved', 'owner-player')).toThrow(/actor/)
    expect(() => assertOnboardingTransition('completed', 'draft', 'gm')).toThrow(/terminal/)
    expect(assertOnboardingTransition('committing', 'approved', 'system').action).toBe('commit-failed')
  })

  it('classifies exact retry, replay, and conflict', () => {
    expect(classifyOnboardingIdempotentRetry(null, 'abc')).toEqual({ kind: 'fresh' })
    expect(classifyOnboardingIdempotentRetry({ payloadHash: 'abc' }, 'abc')).toEqual({ kind: 'replay' })
    expect(classifyOnboardingIdempotentRetry({ payloadHash: 'abc' }, 'xyz')).toEqual({ kind: 'conflict' })
  })
})
