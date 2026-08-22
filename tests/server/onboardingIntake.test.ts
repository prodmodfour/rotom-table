import { describe, expect, it } from 'vitest'
import { openRotomDatabase } from '../../server/storage/database'
import { createSqliteOnboardingRepository } from '../../server/storage/onboardingRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import {
  commitOnboardingIntakeUseCase,
  previewOnboardingIntakeUseCase,
} from '../../server/useCases/onboardingIntake'
import { publishOnboardingPolicyUseCase } from '../../server/useCases/onboardingWorkflows'
import { defaultCampaignOnboardingPolicyContent } from '../../shared/onboarding/policy'
import type { LinkedCharacterRef, PlayerProfile } from '../../shared/playerProfiles'

const makeProfile = (id: string, displayName: string, linkedCharacters: LinkedCharacterRef[] = []): PlayerProfile => ({
  schemaVersion: 1,
  id,
  displayName,
  linkedCharacters,
} as unknown as PlayerProfile)

const harness = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  const repository = createSqliteOnboardingRepository(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)

  const profileStore = new Map<string, PlayerProfile>()
  profileStore.set('profile_veteranowner', makeProfile('profile_veteranowner', 'Veteran Owner'))
  profileStore.set('profile_previousowner', makeProfile('profile_previousowner', 'Previous Owner'))

  const dependencies = {
    repository,
    sheetRepository,
    listProfiles: () => [...profileStore.values()],
    updateProfile: (profileId: string, update: { linkedCharacters: readonly LinkedCharacterRef[] }) => {
      const existing = profileStore.get(profileId)
      if (!existing) throw new Error(`profile ${profileId} missing`)
      profileStore.set(profileId, { ...existing, linkedCharacters: [...update.linkedCharacters] } as PlayerProfile)
    },
    readProfile: (profileId: string) => profileStore.get(profileId) ?? null,
    publishAttention: () => {},
    publishSlotChanged: () => {},
    publishDraftChanged: () => {},
    publishPolicyPublished: () => {},
  }

  publishOnboardingPolicyUseCase({
    role: 'gm',
    content: defaultCampaignOnboardingPolicyContent(),
    display: { name: 'Intake campaign' },
  }, dependencies)

  const seedTrainer = (slug: string, overrides: Record<string, unknown> = {}) =>
    sheetRepository.saveSetupSheet('trainer', slug, {
      slug,
      name: 'Veteran Vera',
      level: 12,
      money: 3210,
      currentInjuries: 2,
      currentTeam: [],
      boxedPokemon: [],
      revision: 0,
      updatedAt: 1_700_000_000_000,
      ...overrides,
    })

  const seedPokemon = (slug: string, overrides: Record<string, unknown> = {}) =>
    sheetRepository.saveSetupSheet('pokemon', slug, {
      slug,
      nickname: slug,
      species: 'Bulbasaur',
      level: 23,
      revision: 0,
      updatedAt: 1_700_000_000_000,
      ...overrides,
    })

  return { database, repository, sheetRepository, dependencies, profileStore, seedTrainer, seedPokemon }
}

describe('existing-character intake (P9-061..P9-070)', () => {
  it('adopts a clean veteran without misclassifying advancement as a defect', () => {
    const { database, repository, dependencies, profileStore, seedTrainer, seedPokemon } = harness()
    seedPokemon('ivy')
    seedPokemon('rocky', { species: 'Squirtle', level: 19 })
    seedTrainer('vera', { currentTeam: ['ivy', 'rocky'] })

    const preview = previewOnboardingIntakeUseCase({
      role: 'gm', trainerSlug: 'vera', profileId: 'profile_veteranowner',
    }, dependencies)
    expect(preview.canCommit).toBe(true)
    expect(preview.proposedRepairs).toHaveLength(0)
    expect(preview.findings.filter(entry => entry.kind === 'blocking-structural')).toHaveLength(0)
    // Level 12 vs policy level 1 is a deviation note, never a repair.
    expect(preview.findings.some(entry => entry.kind === 'campaign-policy-deviation')).toBe(true)

    const committed = commitOnboardingIntakeUseCase({
      role: 'gm', trainerSlug: 'vera', profileId: 'profile_veteranowner',
      acceptedRepairIds: [], resolveOwnershipConflicts: false, operationId: 'onbop_intake-clean',
    }, dependencies)
    expect(committed.pokemonSlugs.sort()).toEqual(['ivy', 'rocky'])

    const owner = profileStore.get('profile_veteranowner')!
    expect(owner.linkedCharacters).toHaveLength(3)
    const completion = repository.getCompletionBySlot(committed.slotId)
    expect(completion?.refs.kind).toBe('intake')
    expect(completion?.refs.profileLinksApplied).toBe(true)
    database.close()
  })

  it('repairs dangling and duplicate roster references without touching history fields', () => {
    const { database, sheetRepository, dependencies, seedTrainer, seedPokemon } = harness()
    seedPokemon('ivy')
    seedTrainer('vera', {
      currentTeam: ['ivy', 'ghost-friend', 'ivy'],
      boxedPokemon: ['ghost-friend'],
    })

    const preview = previewOnboardingIntakeUseCase({
      role: 'gm', trainerSlug: 'vera', profileId: 'profile_veteranowner',
    }, dependencies)
    const danglingRepairs = preview.proposedRepairs.filter(repair => repair.kind === 'remove-dangling-team-ref')
    const dedupeRepairs = preview.proposedRepairs.filter(repair => repair.kind === 'dedupe-team-refs')
    expect(danglingRepairs.length).toBeGreaterThan(0)
    expect(dedupeRepairs.length).toBeGreaterThan(0)

    // Structural repairs must be accepted before commit.
    expect(() => commitOnboardingIntakeUseCase({
      role: 'gm', trainerSlug: 'vera', profileId: 'profile_veteranowner',
      acceptedRepairIds: [], resolveOwnershipConflicts: false, operationId: 'onbop_intake-refuse',
    }, dependencies)).toThrow(/must be accepted/)

    const committed = commitOnboardingIntakeUseCase({
      role: 'gm', trainerSlug: 'vera', profileId: 'profile_veteranowner',
      acceptedRepairIds: preview.proposedRepairs.map(repair => repair.repairId),
      resolveOwnershipConflicts: false,
      operationId: 'onbop_intake-repair',
    }, dependencies)
    expect(committed.repairsApplied.length).toBe(preview.proposedRepairs.length)

    const trainer = sheetRepository.getByRef('trainer', 'vera')!.sheet as Record<string, unknown>
    expect(trainer.currentTeam).toEqual(['ivy'])
    expect(trainer.boxedPokemon).toEqual([])
    // History untouched (P9-068): money, injuries, level survive exactly.
    expect(trainer.money).toBe(3210)
    expect(trainer.currentInjuries).toBe(2)
    expect(trainer.level).toBe(12)
    database.close()
  })

  it('blocks cross-profile conflicts until the GM explicitly resolves them', () => {
    const { database, dependencies, profileStore, seedTrainer, seedPokemon } = harness()
    seedPokemon('ivy')
    seedTrainer('vera', { currentTeam: ['ivy'] })
    profileStore.set('profile_previousowner', makeProfile('profile_previousowner', 'Previous Owner', [
      { sheetKind: 'pokemon', sheetSlug: 'ivy' },
    ]))

    const preview = previewOnboardingIntakeUseCase({
      role: 'gm', trainerSlug: 'vera', profileId: 'profile_veteranowner',
    }, dependencies)
    expect(preview.ownershipConflicts).toHaveLength(1)
    expect(preview.ownershipConflicts[0]).toMatchObject({ sheetSlug: 'ivy', profileDisplayName: 'Previous Owner' })

    expect(() => commitOnboardingIntakeUseCase({
      role: 'gm', trainerSlug: 'vera', profileId: 'profile_veteranowner',
      acceptedRepairIds: [], resolveOwnershipConflicts: false, operationId: 'onbop_intake-conflict',
    }, dependencies)).toThrow(/explicit GM resolution/)

    const committed = commitOnboardingIntakeUseCase({
      role: 'gm', trainerSlug: 'vera', profileId: 'profile_veteranowner',
      acceptedRepairIds: [], resolveOwnershipConflicts: true, operationId: 'onbop_intake-conflict-2',
    }, dependencies)
    expect(committed.relinkedFromProfiles).toEqual(['profile_previousowner'])

    // The sheet moved: removed from the previous owner, linked to the new one.
    expect(profileStore.get('profile_previousowner')!.linkedCharacters).toHaveLength(0)
    expect(profileStore.get('profile_veteranowner')!.linkedCharacters.map(ref => ref.sheetSlug).sort())
      .toEqual(['ivy', 'vera'])
    database.close()
  })

  it('fails closed on non-canonical species and replays commits exactly', () => {
    const { database, dependencies, seedTrainer, seedPokemon, profileStore } = harness()
    seedPokemon('mystery', { species: 'Totally Invented Species' })
    seedTrainer('vera', { currentTeam: ['mystery'] })

    const preview = previewOnboardingIntakeUseCase({
      role: 'gm', trainerSlug: 'vera', profileId: 'profile_veteranowner',
    }, dependencies)
    expect(preview.canCommit).toBe(false)
    expect(() => commitOnboardingIntakeUseCase({
      role: 'gm', trainerSlug: 'vera', profileId: 'profile_veteranowner',
      acceptedRepairIds: [], resolveOwnershipConflicts: false, operationId: 'onbop_intake-blocked',
    }, dependencies)).toThrow(/blocked/)

    // Repair the sheet through ordinary authority, then intake succeeds and replays.
    seedPokemon('mystery', { species: 'Bulbasaur', revision: 1 })
    const committed = commitOnboardingIntakeUseCase({
      role: 'gm', trainerSlug: 'vera', profileId: 'profile_veteranowner',
      acceptedRepairIds: [], resolveOwnershipConflicts: false, operationId: 'onbop_intake-ok',
    }, dependencies)
    const replay = commitOnboardingIntakeUseCase({
      role: 'gm', trainerSlug: 'vera', profileId: 'profile_veteranowner',
      acceptedRepairIds: [], resolveOwnershipConflicts: false, operationId: 'onbop_intake-ok',
    }, dependencies)
    expect(replay).toEqual(committed)
    expect(profileStore.get('profile_veteranowner')!.linkedCharacters).toHaveLength(2)
    database.close()
  })
})
