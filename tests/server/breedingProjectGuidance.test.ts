import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerProfile } from '../../shared/playerProfiles'
import type { TrainerSheet } from '../../src/types/trainerSheet'
import {
  BREEDING_PROJECT_GUIDANCE_PRESENTATION_POLICY_DEFINITION_SHA256,
  BreedingProjectGuidanceProjectionAuthorityError,
  parseAuthoritativeBreedingProjectGuidanceProjectionV1,
} from '../../server/domain/breeding/projectGuidance'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { loadBreedingProjectGuidance } from '../../server/useCases/loadBreedingProjectGuidance'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})

const trainerDocument = (
  slug: string,
  parentSlugs: readonly string[] = [],
  overrides: Partial<TrainerSheet> = {},
): TrainerSheet => ({
  slug,
  name: slug === 'trainer-owner' ? 'Mira' : slug,
  level: 10,
  skillBackground: { novice: 'pokeEd' },
  edges: [],
  features: [],
  currentTeam: [...parentSlugs],
  boxedPokemon: [],
  ...overrides,
})
const saveTrainer = (
  database: RotomDatabase,
  slug: string,
  parentSlugs: readonly string[] = [],
  overrides: Partial<TrainerSheet> = {},
): void => {
  createSqliteSheetRepository(database).save({
    kind: 'trainer',
    slug,
    document: trainerDocument(slug, parentSlugs, overrides),
    revision: 3,
    updatedAt: 100,
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
    document: { slug, nickname, species, gender, level: 25, serverPrivate: { hidden: true } },
    revision: 2,
    updatedAt: 100,
  })
}
const profile = (trainerSlugs: readonly string[]): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_owner000' as never,
  displayName: 'Owner' as never,
  linkedCharacters: [...trainerSlugs].sort().map(sheetSlug => ({
    sheetKind: 'trainer' as const,
    sheetSlug,
  })),
})
const request = (
  parentRefs: readonly { pokemonSheetSlug: string, expectedSheetRevision: number }[] = [],
  destinationTrainerSlug = 'trainer-owner',
  breederTrainerSlug = destinationTrainerSlug,
  profileId: string | null = 'profile_owner000',
) => ({
  schemaVersion: 1,
  profileId,
  destinationTrainerSlug,
  breederTrainerSlug,
  parentRefs,
})
const selectedRefs = (result: ReturnType<typeof loadBreedingProjectGuidance>) => (
  result.wizard.parentDiscovery.trainerSheets
    .flatMap(trainer => trainer.candidates)
    .filter(candidate => candidate.availability.status === 'selectable')
    .map(candidate => ({
      pokemonSheetSlug: candidate.parentSheetSlug,
      expectedSheetRevision: candidate.parentSheetRevision!,
    }))
)

describe('BR-072 Breeding Project guidance server projection', () => {
  it('explains compatibility, maturity, and missing Breeder authority without exposing private evidence', () => {
    const database = open()
    saveTrainer(database, 'trainer-owner', ['pokemon-parent-a', 'pokemon-parent-b'])
    savePokemon(database, 'pokemon-parent-a', 'Bulbasaur', 'Female', 'Leaf')
    savePokemon(database, 'pokemon-parent-b', 'Ivysaur', 'Male', 'Bloom')
    const ownerProfile = profile(['trainer-owner'])
    const initial = loadBreedingProjectGuidance({
      role: 'player', playerProfile: ownerProfile, request: request(),
    }, { database })
    const result = loadBreedingProjectGuidance({
      role: 'player', playerProfile: ownerProfile, request: request(selectedRefs(initial)),
    }, { database })

    expect(result.wizard.reviewStatus).toBe('requires-final-validation')
    expect(result.applicableReasonIds).toEqual([
      'breeding.project-guidance.breeder-edge-unavailable',
      'breeding.project-guidance.maturity-confirmation-required',
      'breeding.project-guidance.pair-requires-final-validation',
    ])
    expect(result.sourceContributions).toEqual([expect.objectContaining({
      sourceCanonicalId: 'Breeder',
      status: 'unavailable',
      reasonId: 'breeding.project-guidance.breeder-edge-unavailable',
    })])
    expect(result.gmDiagnostics).toBeNull()
    expect(parseAuthoritativeBreedingProjectGuidanceProjectionV1(result)).toStrictEqual(result)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(ownerProfile.id)
    expect(serialized).not.toContain('serverPrivate')
    expect(serialized).not.toMatch(/operationId|definitionSha256s|principalSha256|edgeInstanceId/iu)
    expect(BREEDING_PROJECT_GUIDANCE_PRESENTATION_POLICY_DEFINITION_SHA256)
      .toMatch(/^[0-9a-f]{64}$/u)
  })

  it('projects one active direct Breeder contribution and bounded Skill application', () => {
    const database = open()
    saveTrainer(database, 'trainer-owner', [], { edges: [{ name: 'Breeder' }] })
    const result = loadBreedingProjectGuidance({
      role: 'player', playerProfile: profile(['trainer-owner']), request: request(),
    }, { database })

    expect(result.sourceContributions).toEqual([{
      sourceKind: 'trainer-edge',
      sourceCanonicalId: 'Breeder',
      status: 'active',
      contributionIds: ['breeding-project-request', 'breeder-dc12-timeline'],
      skillApplication: {
        skillId: 'pokemon-education',
        rank: 'Novice',
        skillTotal: expect.any(Number),
      },
      reasonId: null,
    }])
    expect(result.applicableReasonIds).toEqual([
      'breeding.project-guidance.parent-selection-incomplete',
    ])
  })

  it('attributes a current Dilettante grant while requiring its server-offered Skill choice', () => {
    const database = open()
    saveTrainer(database, 'trainer-owner', [], {
      edges: [],
      skillBackground: { novice: ['pokeEd', 'generalEd'] },
      features: [{
        name: 'Dilettante',
        choices: { edge: 'Breeder', feature: 'Tutoring', 'feature.move': 'Tackle' },
      }],
    })
    const result = loadBreedingProjectGuidance({
      role: 'player', playerProfile: profile(['trainer-owner']), request: request(),
    }, { database })

    expect(result.sourceContributions).toEqual([
      expect.objectContaining({
        sourceCanonicalId: 'Breeder',
        status: 'choice-required',
        reasonId: 'breeding.project-guidance.dilettante-choice-required',
      }),
      expect.objectContaining({
        sourceCanonicalId: 'Dilettante',
        status: 'active',
        contributionIds: ['effective-breeder-edge-grant'],
      }),
    ])
  })

  it('gives only GMs bounded topology, candidate, policy, facility, and final-validation diagnostics', () => {
    const database = open()
    saveTrainer(database, 'trainer-alpha', ['pokemon-parent-a'])
    saveTrainer(database, 'trainer-beta', ['pokemon-parent-b', 'pokemon-missing'])
    savePokemon(database, 'pokemon-parent-a', 'Bulbasaur', 'Female', 'Leaf')
    savePokemon(database, 'pokemon-parent-b', 'Ivysaur', 'Male', 'Bloom')
    const initial = loadBreedingProjectGuidance({
      role: 'gm', playerProfile: null, request: request([], 'trainer-alpha', 'trainer-alpha', null),
    }, { database })
    const result = loadBreedingProjectGuidance({
      role: 'gm',
      playerProfile: null,
      request: request(selectedRefs(initial).slice(0, 2), 'trainer-alpha', 'trainer-alpha', null),
    }, { database })

    expect(result.wizard.consentStatus).toBe('review-required')
    expect(result.applicableReasonIds).toContain('breeding.project-guidance.consent-review-required')
    expect(result.gmDiagnostics).toEqual(expect.objectContaining({
      candidateCount: 3,
      selectableCandidateCount: 2,
      unavailableCandidateCount: 1,
      selectedParentCount: 2,
      ownershipTopology: 'cross-owner',
      maturityPolicy: 'gm-confirmed-per-parent',
      minimumMaturityLevel: null,
      consentStatus: 'review-required',
      compatibilityPreviewStatus: 'requires-validation',
      locationPolicyId: 'campaign-workshop-off-map-v1',
      facilityRegistryState: 'empty-no-authority',
      finalValidationStatus: 'required-before-creation',
    }))
    expect(JSON.stringify(result.gmDiagnostics)).not.toMatch(/parent-a|parent-b|trainer-alpha|pokemon|hash/iu)
  })

  it('fails closed to a safe unavailable source when providers are malformed, asynchronous, or throw', () => {
    const database = open()
    saveTrainer(database, 'trainer-owner')
    const input = {
      role: 'player' as const,
      playerProfile: profile(['trainer-owner']),
      request: request(),
    }
    for (const resolver of [
      (() => Promise.resolve({})) as never,
      (() => ({ schemaVersion: 1 })) as never,
      (() => { throw new Error('private provider failure') }) as never,
    ]) {
      const result = loadBreedingProjectGuidance(input, {
        database,
        resolveCurrentFeatureProviderHandoff: resolver,
      })
      expect(result.sourceContributions).toEqual([expect.objectContaining({
        status: 'unavailable',
        reasonId: 'breeding.project-guidance.breeder-provider-unavailable',
      })])
      expect(JSON.stringify(result)).not.toContain('private provider failure')
    }
  })

  it('detects hash tampering after a structurally valid guidance change', () => {
    const database = open()
    saveTrainer(database, 'trainer-owner')
    const result = loadBreedingProjectGuidance({
      role: 'player', playerProfile: profile(['trainer-owner']), request: request(),
    }, { database })
    expect(() => parseAuthoritativeBreedingProjectGuidanceProjectionV1({
      ...result,
      applicableReasonIds: [
        'breeding.project-guidance.breeder-edge-unavailable',
        'breeding.project-guidance.maturity-confirmation-required',
        'breeding.project-guidance.parent-selection-incomplete',
      ],
    })).toThrow(BreedingProjectGuidanceProjectionAuthorityError)
  })
})
