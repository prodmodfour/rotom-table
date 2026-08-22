import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import creationFixtures from '../../data/onboarding/fixtures/creation-fixtures.json'
import { openRotomDatabase } from '../../server/storage/database'
import { createSqliteOnboardingRepository } from '../../server/storage/onboardingRepository'
import {
  createOnboardingSlotUseCase,
  publishOnboardingPolicyUseCase,
  saveOnboardingDraftUseCase,
} from '../../server/useCases/onboardingWorkflows'
import { onboardingCreationCatalog } from '../../shared/onboarding/catalog'
import {
  CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION,
  defaultCampaignOnboardingPolicyContent,
  parseCampaignOnboardingPolicyContent,
} from '../../shared/onboarding/policy'
import { validateOnboardingPackage } from '../../shared/onboarding/validate'
import type { PlayerProfile } from '../../shared/playerProfiles'

const PROFILE = { schemaVersion: 1, id: 'profile_backupuser1', displayName: 'Backup', linkedCharacters: [] } as unknown as PlayerProfile

describe('onboarding backup, restore, and provenance durability (P9-079/P9-094)', () => {
  it('survives a byte-for-byte SQLite backup and restore with drafts, submissions, ops, and completions intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rotom-onboarding-backup-'))
    const livePath = join(dir, 'live.sqlite')
    const backupPath = join(dir, 'backup.sqlite')
    try {
      const database = openRotomDatabase({ path: livePath })
      const repository = createSqliteOnboardingRepository(database)
      const dependencies = {
        repository,
        readProfile: () => PROFILE,
        listProfiles: () => [PROFILE],
        publishSlotChanged: () => {},
        publishDraftChanged: () => {},
        publishPolicyPublished: () => {},
      }
      const policy = publishOnboardingPolicyUseCase({
        role: 'gm',
        content: defaultCampaignOnboardingPolicyContent(),
        display: { name: 'Backup campaign' },
      }, dependencies)
      const created = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE.id }, dependencies)
      const saved = saveOnboardingDraftUseCase({
        role: 'player', profile: PROFILE,
        draftId: created.draft.draft.draftId,
        expectedRevision: 0,
        document: {
          ...created.draft.draft,
          trainerBuild: { ...created.draft.draft.trainerBuild, name: 'Backed Up' },
        },
      }, dependencies)
      repository.recordOperation({
        opId: 'onbop_backup-probe',
        scope: 'submit',
        payloadHash: 'a'.repeat(64),
        result: { probe: true },
      })
      const intake = repository.createIntakeSlot({ profileId: PROFILE.id })
      repository.recordCompletion({
        completionId: 'onbdone-backup-probe',
        slotId: intake.slotId,
        draftId: 'onbdraft_backup000',
        submissionRevision: 1,
        refs: { kind: 'intake', trainerSlug: 'vera', pokemonSlugs: [], profileLinksApplied: true },
      })
      database.close()

      // Backup, then mutate the live database, then restore from the copy.
      copyFileSync(livePath, backupPath)
      const mutate = openRotomDatabase({ path: livePath })
      mutate.connection.prepare('DELETE FROM onboarding_completions').run()
      mutate.connection.prepare('DELETE FROM onboarding_ops').run()
      mutate.close()

      const restored = openRotomDatabase({ path: backupPath })
      const restoredRepository = createSqliteOnboardingRepository(restored)
      const draft = restoredRepository.getDraft(created.draft.draft.draftId)
      expect(draft?.draft.trainerBuild.name).toBe('Backed Up')
      expect(draft?.revision).toBe(saved.revision)
      expect(draft?.draft.policyVersion).toBe(policy.policy.identity.version)
      expect(restoredRepository.getPolicy(policy.policy.identity.policyId, 1)?.identity.contentHash)
        .toBe(policy.policy.identity.contentHash)
      expect(restoredRepository.findOperation('onbop_backup-probe')?.result).toEqual({ probe: true })
      expect(restoredRepository.getCompletionBySlot(intake.slotId)?.refs.kind).toBe('intake')
      restored.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('campaign policy variant matrix (P9-092)', () => {
  const catalog = onboardingCreationCatalog()
  const fixture = creationFixtures.fixtures.find(entry => entry.fixtureId === 'default-level1-single-starter')!
  const raw = fixture.trainerBuild as Record<string, any>

  const trainerBuild = {
    name: raw.name,
    identity: {
      playedBy: null, age: null, sex: null, portraitUrl: null, accentColor: null,
      physicalDescription: null, background: null, personality: null, goalsAndDreams: null,
    },
    statAllocation: raw.statAllocation,
    background: raw.background,
    trainingFeatureId: raw.trainingFeature,
    edges: raw.edges.map((edge: any, index: number) => ({
      entryId: `edge-${index + 1}`, canonicalId: edge.name, grantLevel: null, choices: edge.choices ?? {},
    })),
    features: raw.features.map((feature: any, index: number) => ({
      entryId: `feature-${index + 1}`, canonicalId: feature.name, isClassAnchor: feature.isClassAnchor === true, choices: feature.choices ?? {},
    })),
    milestoneChoices: [],
  }
  const pokemonBuilds = (fixture.pokemonBuilds as Record<string, any>[]).map((build, index) => ({
    buildId: `starter-${index + 1}` as const,
    speciesId: build.species,
    nickname: build.nickname,
    natureId: build.nature,
    gender: build.gender,
    abilityIds: build.abilities,
    moveIds: build.moves,
    addedStats: build.addedStats,
    heldItemId: null,
    caughtBallId: null,
    teamSlot: build.teamSlot,
  }))

  const variantPolicy = (patch: (base: ReturnType<typeof defaultCampaignOnboardingPolicyContent>) => unknown) =>
    parseCampaignOnboardingPolicyContent({
      ...(patch(defaultCampaignOnboardingPolicyContent()) as Record<string, unknown>),
      schemaVersion: CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION,
    })

  it('deny-list source restriction blocks the excluded Feature with a stable code', () => {
    const policy = variantPolicy(base => ({
      ...base,
      trainer: { ...base.trainer, featureRestriction: { mode: 'deny-list', canonicalIds: ['Ace Trainer'] } },
    }))
    const summary = validateOnboardingPackage(
      { trainerBuild: trainerBuild as never, pokemonBuilds: pokemonBuilds as never, deferredDecisions: [] },
      policy, catalog, { profileBound: true },
    )
    expect(summary.issues.some(issue => issue.code === 'trainer.feature-restricted-by-policy')).toBe(true)
    expect(summary.submittable).toBe(false)
  })

  it('allow-list edge restriction blocks unlisted Edges', () => {
    const policy = variantPolicy(base => ({
      ...base,
      trainer: { ...base.trainer, edgeRestriction: { mode: 'allow-list', canonicalIds: ['Basic Skills'] } },
    }))
    const summary = validateOnboardingPackage(
      { trainerBuild: trainerBuild as never, pokemonBuilds: pokemonBuilds as never, deferredDecisions: [] },
      policy, catalog, { profileBound: true },
    )
    expect(summary.issues.filter(issue => issue.code === 'trainer.edge-restricted-by-policy').length)
      .toBeGreaterThanOrEqual(2)
  })

  it('curated pools reject species outside the list', () => {
    const policy = variantPolicy(base => ({
      ...base,
      pokemon: { ...base.pokemon, starterPool: { mode: 'curated-list', speciesIds: ['Chikorita'] } },
    }))
    const summary = validateOnboardingPackage(
      { trainerBuild: trainerBuild as never, pokemonBuilds: pokemonBuilds as never, deferredDecisions: [] },
      policy, catalog, { profileBound: true },
    )
    expect(summary.issues.some(issue => issue.code === 'pokemon.species-not-in-pool')).toBe(true)
  })

  it('first-stage restriction and higher starter levels re-scope move requirements automatically', () => {
    const policy = variantPolicy(base => ({
      ...base,
      pokemon: { ...base.pokemon, starterLevel: 9, stageRestriction: 'first-stage-only' },
    }))
    const summary = validateOnboardingPackage(
      { trainerBuild: trainerBuild as never, pokemonBuilds: pokemonBuilds as never, deferredDecisions: [] },
      policy, catalog, { profileBound: true },
    )
    // Bulbasaur remains first-stage; at level 9 the fixture's two moves are no longer complete.
    expect(summary.issues.some(issue => issue.code === 'pokemon.stage-restricted')).toBe(false)
    expect(summary.issues.some(issue => issue.code === 'pokemon.moves-incomplete')).toBe(true)
    expect(summary.issues.some(issue => issue.code === 'pokemon.added-budget-unspent')).toBe(true)
  })

  it('unknown package items fail closed as policy repairs', () => {
    const policy = variantPolicy(base => ({
      ...base,
      packages: { trainerItems: [{ itemId: 'Imaginary Widget', quantity: 1, section: 'keyItems' }], starterHeldItems: [] },
    }))
    const summary = validateOnboardingPackage(
      { trainerBuild: trainerBuild as never, pokemonBuilds: pokemonBuilds as never, deferredDecisions: [] },
      policy, catalog, { profileBound: true },
    )
    const issue = summary.issues.find(entry => entry.code === 'package.item-unknown')
    expect(issue).toBeDefined()
    expect(issue!.resolution.kind).toBe('policy-repair')
  })
})
