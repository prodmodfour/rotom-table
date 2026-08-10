import { afterEach, describe, expect, it } from 'vitest'
import type { TrainerSheet } from '../../src/types/trainerSheet'
import type { PlayerProfile } from '../../shared/playerProfiles'
import {
  parseAuthoritativeBreedingProjectChoicesProjectionV1,
} from '../../server/domain/breeding/projectChoices'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteBreedingProjectRepository } from '../../server/storage/breedingProjectRepository'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { loadBreedingProjectChoices } from '../../server/useCases/loadBreedingProjectChoices'
import { resolveBreedingCampaignOptionSnapshot } from '../../server/domain/breeding/campaignOptions'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})

const saveTrainer = (database: RotomDatabase): void => {
  const document: TrainerSheet = {
    slug: 'trainer-owner',
    name: 'Mira',
    level: 20,
    skillBackground: { adept: 'pokeEd' },
    edges: [{ name: 'Breeder' }],
    features: [],
    currentTeam: ['pokemon-parent-a', 'pokemon-parent-b'],
    boxedPokemon: [],
  }
  createSqliteSheetRepository(database).save({
    kind: 'trainer', slug: 'trainer-owner', document, revision: 3, updatedAt: 100,
  })
}
const savePokemon = (
  database: RotomDatabase,
  slug: string,
  species: string,
  gender: string,
  nickname: string,
): void => {
  createSqliteSheetRepository(database).save({
    kind: 'pokemon',
    slug,
    document: { slug, nickname, species, gender, level: 25 },
    revision: 2,
    updatedAt: 100,
  })
}
const request = (input: {
  readonly parentRefs?: readonly { pokemonSheetSlug: string, expectedSheetRevision: number }[]
  readonly selectedOptionIds?: readonly string[]
  readonly confirmed?: boolean
} = {}) => ({
  schemaVersion: 1,
  draftId: 'breeding-project-draft:v1:11111111111111111111111111111111',
  profileId: null,
  destinationTrainerSlug: 'trainer-owner',
  breederTrainerSlug: 'trainer-owner',
  parentRefs: input.parentRefs ?? [],
  selectedOptionIds: input.selectedOptionIds ?? [],
  confirmed: input.confirmed ?? false,
})

const setup = (database: RotomDatabase): void => {
  saveTrainer(database)
  savePokemon(database, 'pokemon-parent-a', 'Bulbasaur', 'Female', 'Leaf')
  savePokemon(database, 'pokemon-parent-b', 'Ivysaur', 'Male', 'Bloom')
}

describe('BR-073 authoritative Breeding Project choices and creation', () => {
  it('issues rank-bound traits and explicit GM maturity choices, then creates one replay-safe Project', () => {
    const database = open()
    setup(database)
    const initial = loadBreedingProjectChoices({
      role: 'gm', playerProfile: null, request: request(),
    }, { database, realtimeTimestamp: 10 })
    const refs = initial.guidance.wizard.parentDiscovery.trainerSheets[0]!.candidates.map(candidate => ({
      pokemonSheetSlug: candidate.parentSheetSlug,
      expectedSheetRevision: candidate.parentSheetRevision!,
    }))
    const choices = loadBreedingProjectChoices({
      role: 'gm', playerProfile: null, request: request({ parentRefs: refs }),
    }, { database, realtimeTimestamp: 10 })

    expect(choices.traitChoices).toEqual([
      expect.objectContaining({ traitKind: 'nature', requiredRank: 'Adept', status: 'choice-authorised' }),
      expect.objectContaining({ traitKind: 'ability', requiredRank: 'Expert', status: 'random-only' }),
      expect.objectContaining({ traitKind: 'gender', requiredRank: 'Master', status: 'random-only' }),
    ])
    expect(choices.maturityChoices).toHaveLength(2)
    expect(choices.confirmation.canConfirm).toBe(false)
    expect(parseAuthoritativeBreedingProjectChoicesProjectionV1(choices)).toStrictEqual(choices)

    const selectedOptionIds = choices.maturityChoices.map(choice => choice.option!.optionId).sort()
    const ready = loadBreedingProjectChoices({
      role: 'gm', playerProfile: null,
      request: request({ parentRefs: refs, selectedOptionIds }),
    }, { database, realtimeTimestamp: 10 })
    expect(ready.confirmation).toMatchObject({ status: 'ready', canConfirm: true })

    const created = loadBreedingProjectChoices({
      role: 'gm', playerProfile: null,
      request: request({ parentRefs: refs, selectedOptionIds, confirmed: true }),
    }, { database, realtimeTimestamp: 10 })
    expect(created.confirmation).toMatchObject({
      status: 'created',
      canConfirm: false,
      project: { status: 'initial-time-in-progress' },
    })
    expect(createSqliteBreedingProjectRepository(database).listByOwner('trainer-owner')).toHaveLength(1)
    const project = createSqliteBreedingProjectRepository(database).listByOwner('trainer-owner')[0]!
    expect(project.timeline.initialAccumulatedCampaignMinutes).toBe(0)
    expect(project.timeline.initialStartedAtCampaignMinute).toBe(0)
    expect(createSqliteCampaignClockRepository(database).get().campaignMinute).toBe(0)

    const realtimeSequence = createSqliteRealtimeEventRepository({ database }).cursorState().latestSequence
    const replay = loadBreedingProjectChoices({
      role: 'gm', playerProfile: null,
      request: request({ parentRefs: refs, selectedOptionIds, confirmed: true }),
    }, { database, realtimeTimestamp: 10 })
    expect(replay.confirmation.project?.projectId).toBe(project.projectId)
    expect(createSqliteBreedingProjectRepository(database).listByOwner('trainer-owner')).toHaveLength(1)
    expect(createSqliteRealtimeEventRepository({ database }).cursorState().latestSequence).toBe(realtimeSequence)
  })

  it('settles only one bounded current parent-role option before authoritative creation', () => {
    const database = open()
    saveTrainer(database)
    savePokemon(database, 'pokemon-parent-a', 'Bulbasaur', 'Female', 'Leaf')
    savePokemon(database, 'pokemon-parent-b', 'Ivysaur', 'Female', 'Bloom')
    const options = resolveBreedingCampaignOptionSnapshot({
      'breeding.same-sex-policy': 'gm-role-override',
    })
    const dependencies = { database, resolveCurrentCampaignOptions: () => options }
    const initial = loadBreedingProjectChoices({
      role: 'gm', playerProfile: null, request: request(),
    }, dependencies)
    const refs = initial.guidance.wizard.parentDiscovery.trainerSheets[0]!.candidates.map(candidate => ({
      pokemonSheetSlug: candidate.parentSheetSlug,
      expectedSheetRevision: candidate.parentSheetRevision!,
    }))
    const choices = loadBreedingProjectChoices({
      role: 'gm', playerProfile: null, request: request({ parentRefs: refs }),
    }, dependencies)
    expect(choices.parentRoleChoice.status).toBe('required')
    expect(choices.parentRoleChoice.options).toHaveLength(2)
    const selectedOptionIds = [
      ...choices.maturityChoices.map(choice => choice.option!.optionId),
      choices.parentRoleChoice.options[0]!.optionId,
    ].sort()
    const ready = loadBreedingProjectChoices({
      role: 'gm', playerProfile: null,
      request: request({ parentRefs: refs, selectedOptionIds }),
    }, dependencies)
    expect(ready.parentRoleChoice.status).toBe('selected')
    expect(ready.confirmation.canConfirm).toBe(true)
    const created = loadBreedingProjectChoices({
      role: 'gm', playerProfile: null,
      request: request({ parentRefs: refs, selectedOptionIds, confirmed: true }),
    }, dependencies)
    expect(created.confirmation.status).toBe('created')
    expect(createSqliteBreedingProjectRepository(database).listByOwner('trainer-owner')).toHaveLength(1)
  })

  it('accepts only an opaque server-issued Dilettante Skill choice and derives rank gates from the current handoff', () => {
    const database = open()
    createSqliteSheetRepository(database).save({
      kind: 'trainer',
      slug: 'trainer-owner',
      document: {
        slug: 'trainer-owner',
        name: 'Mira',
        level: 20,
        skillBackground: { adept: 'generalEd', novice: 'pokeEd' },
        edges: [],
        features: [{
          name: 'Dilettante',
          choices: { edge: 'Breeder', feature: 'Tutoring', 'feature.move': 'Tackle' },
        }],
        currentTeam: ['pokemon-parent-a', 'pokemon-parent-b'],
        boxedPokemon: [],
      },
      revision: 3,
      updatedAt: 100,
    })
    savePokemon(database, 'pokemon-parent-a', 'Bulbasaur', 'Female', 'Leaf')
    savePokemon(database, 'pokemon-parent-b', 'Ivysaur', 'Male', 'Bloom')
    const ownerProfile: PlayerProfile = {
      schemaVersion: 1,
      id: 'profile_owner000' as never,
      displayName: 'Owner' as never,
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
    }
    const baseRequest = { ...request(), profileId: 'profile_owner000' }
    const initial = loadBreedingProjectChoices({
      role: 'player', playerProfile: ownerProfile, request: baseRequest,
    }, { database })
    expect(initial.skillChoice.status).toBe('required')
    expect(initial.skillChoice.options.map(option => option.label)).toEqual([
      'General Education', 'Perception',
    ].sort((left, right) => left.localeCompare(right)))
    const selected = initial.skillChoice.options.find(option => option.label === 'General Education')!
    const refs = initial.guidance.wizard.parentDiscovery.trainerSheets[0]!.candidates.map(candidate => ({
      pokemonSheetSlug: candidate.parentSheetSlug,
      expectedSheetRevision: candidate.parentSheetRevision!,
    }))
    const result = loadBreedingProjectChoices({
      role: 'player',
      playerProfile: ownerProfile,
      request: { ...baseRequest, parentRefs: refs, selectedOptionIds: [selected.optionId] },
    }, { database })
    expect(result.skillChoice.status).toBe('selected')
    expect(result.traitChoices[0]).toMatchObject({
      traitKind: 'nature', effectiveRank: 'Adept', status: 'choice-authorised',
    })
    expect(result.maturityChoices.every(choice => choice.status === 'unavailable')).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/featureInstanceId|providerDefinition|generalEd|serverPrivate/u)

    expect(() => loadBreedingProjectChoices({
      role: 'player',
      playerProfile: ownerProfile,
      request: {
        ...baseRequest,
        selectedOptionIds: ['option:v1:ffffffffffffffffffffffffffffffff'],
      },
    }, { database })).toThrowError(expect.objectContaining({ statusCode: 400 }))
  })

  it('lets an authorised player explicitly create under the current minimum-Level policy and rejects stale parent revisions', () => {
    const database = open()
    setup(database)
    const ownerProfile: PlayerProfile = {
      schemaVersion: 1,
      id: 'profile_owner000' as never,
      displayName: 'Owner' as never,
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
    }
    const options = resolveBreedingCampaignOptionSnapshot({
      'breeding.maturity-policy': 'minimum-level',
      'breeding.minimum-maturity-level': 20,
    })
    const dependencies = { database, resolveCurrentCampaignOptions: () => options, realtimeTimestamp: 10 }
    const refs = [
      { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 },
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 2 },
    ]
    const playerRequest = { ...request({ parentRefs: refs }), profileId: 'profile_owner000' }
    const ready = loadBreedingProjectChoices({
      role: 'player', playerProfile: ownerProfile, request: playerRequest,
    }, dependencies)
    expect(ready.maturityChoices).toEqual([])
    expect(ready.confirmation).toMatchObject({ status: 'ready', canConfirm: true })
    const created = loadBreedingProjectChoices({
      role: 'player', playerProfile: ownerProfile, request: { ...playerRequest, confirmed: true },
    }, dependencies)
    expect(created.confirmation.project?.status).toBe('initial-time-in-progress')

    const staleDraftRequest = {
      ...playerRequest,
      draftId: 'breeding-project-draft:v1:99999999999999999999999999999999',
    }
    expect(loadBreedingProjectChoices({
      role: 'player', playerProfile: ownerProfile, request: staleDraftRequest,
    }, dependencies).confirmation.canConfirm).toBe(true)
    createSqliteSheetRepository(database).save({
      kind: 'pokemon', slug: 'pokemon-parent-a',
      document: { slug: 'pokemon-parent-a', nickname: 'Leaf', species: 'Bulbasaur', gender: 'Female', level: 26 },
      revision: 3, updatedAt: 101,
    })
    expect(() => loadBreedingProjectChoices({
      role: 'player', playerProfile: ownerProfile,
      request: { ...staleDraftRequest, confirmed: true },
    }, dependencies)).toThrowError(expect.objectContaining({ statusCode: 409 }))
    expect(createSqliteBreedingProjectRepository(database).listByOwner('trainer-owner')).toHaveLength(1)
  })

  it('never resolves cross-owner private mechanics before consent', () => {
    const database = open()
    createSqliteSheetRepository(database).save({
      kind: 'trainer', slug: 'trainer-alpha',
      document: { slug: 'trainer-alpha', name: 'Alpha', level: 20, skillBackground: { adept: 'pokeEd' }, edges: [{ name: 'Breeder' }], features: [], currentTeam: ['pokemon-parent-a'], boxedPokemon: [] },
      revision: 3, updatedAt: 100,
    })
    createSqliteSheetRepository(database).save({
      kind: 'trainer', slug: 'trainer-beta',
      document: { slug: 'trainer-beta', name: 'Beta', currentTeam: ['pokemon-parent-b'], boxedPokemon: [] },
      revision: 3, updatedAt: 100,
    })
    savePokemon(database, 'pokemon-parent-a', 'Bulbasaur', 'Female', 'Leaf')
    savePokemon(database, 'pokemon-parent-b', 'Ivysaur', 'Male', 'Bloom')
    const initial = loadBreedingProjectChoices({
      role: 'gm', playerProfile: null,
      request: { ...request(), destinationTrainerSlug: 'trainer-alpha', breederTrainerSlug: 'trainer-alpha' },
    }, { database })
    const refs = initial.guidance.wizard.parentDiscovery.trainerSheets
      .flatMap(row => row.candidates)
      .filter(candidate => candidate.parentSheetRevision !== null)
      .map(candidate => ({ pokemonSheetSlug: candidate.parentSheetSlug, expectedSheetRevision: candidate.parentSheetRevision! }))
    const result = loadBreedingProjectChoices({
      role: 'gm', playerProfile: null,
      request: { ...request({ parentRefs: refs }), destinationTrainerSlug: 'trainer-alpha', breederTrainerSlug: 'trainer-alpha' },
    }, { database })
    expect(result.confirmation).toMatchObject({
      status: 'blocked',
      messageId: 'breeding.project-choices.cross-owner-consent-required',
    })
    expect(result.maturityChoices).toEqual([])
    expect(result.parentRoleChoice).toEqual({ status: 'unavailable', options: [] })
    expect(JSON.stringify(result)).not.toMatch(/parentFacts|eggGroup|serverPrivate|adjudicationId/u)
    expect(createSqliteBreedingProjectRepository(database).listByOwner('trainer-alpha')).toEqual([])
  })
})
