import { afterEach, describe, expect, it } from 'vitest'
import projectWizardContractJson from '../../data/breeding-automation/project-wizard-presentation-contract.json'
import type { PlayerProfile } from '../../shared/playerProfiles'
import type { BreedingProjectWizardProjectionV1 } from '../../shared/breeding/projectWizard'
import {
  BREEDING_PROJECT_WIZARD_PRESENTATION_POLICY_DEFINITION_SHA256,
  BreedingProjectWizardProjectionAuthorityError,
  createBreedingProjectWizardProjectionV1,
  parseAuthoritativeBreedingProjectWizardProjectionV1,
} from '../../server/domain/breeding/projectWizard'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { loadBreedingProjectWizard } from '../../server/useCases/loadBreedingProjectWizard'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})

const saveTrainer = (
  database: RotomDatabase,
  slug: string,
  currentTeam: readonly string[] = [],
  name = slug,
): void => {
  createSqliteSheetRepository<Record<string, unknown>>(database).saveSetupSheet('trainer', slug, {
    slug,
    revision: 0,
    updatedAt: 100,
    name,
    currentTeam: [...currentTeam],
    boxedPokemon: [],
  })
}
const savePokemon = (
  database: RotomDatabase,
  slug: string,
  species: string,
  gender: string,
  nickname: string,
): void => {
  createSqliteSheetRepository<Record<string, unknown>>(database).saveSetupSheet('pokemon', slug, {
    slug,
    revision: 0,
    updatedAt: 100,
    nickname,
    species,
    gender,
    level: 25,
    serverPrivate: { hidden: true },
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
  destinationTrainerSlug = 'trainer-owner',
  breederTrainerSlug = destinationTrainerSlug,
  parentRefs: readonly { pokemonSheetSlug: string, expectedSheetRevision: number }[] = [],
) => ({
  schemaVersion: 1,
  profileId: 'profile_owner000',
  destinationTrainerSlug,
  breederTrainerSlug,
  parentRefs,
})

const setupOwner = (database: RotomDatabase): void => {
  saveTrainer(database, 'trainer-owner', ['pokemon-parent-a', 'pokemon-parent-b'], 'Mira')
  savePokemon(database, 'pokemon-parent-a', 'Bulbasaur', 'Female', 'Leaf')
  savePokemon(database, 'pokemon-parent-b', 'Ivysaur', 'Male', 'Bloom')
}

describe('BR-071 Breeding Project wizard server projection', () => {
  it('projects current destination, Breeder, parents, consent, and campaign timeline without mutating', () => {
    const database = open()
    setupOwner(database)
    const ownerProfile = profile(['trainer-owner'])
    const initial = loadBreedingProjectWizard({
      role: 'player',
      playerProfile: ownerProfile,
      request: request(),
    }, { database })
    const candidates = initial.parentDiscovery.trainerSheets[0]?.candidates ?? []
    expect(candidates.map(candidate => candidate.label)).toEqual(['Leaf', 'Bloom'])
    const selected = candidates.map(candidate => ({
      pokemonSheetSlug: candidate.parentSheetSlug,
      expectedSheetRevision: candidate.parentSheetRevision!,
    }))

    const result = loadBreedingProjectWizard({
      role: 'player',
      playerProfile: ownerProfile,
      request: request('trainer-owner', 'trainer-owner', selected),
    }, { database })

    expect(result).toMatchObject({
      audience: 'owner',
      destination: { trainerSheetSlug: 'trainer-owner', displayName: 'Mira' },
      breeder: { trainerSheetSlug: 'trainer-owner', displayName: 'Mira' },
      consentStatus: 'not-required',
      reviewStatus: 'requires-final-validation',
      timeline: {
        timeAuthority: 'campaign-clock',
        initialCampaignMinutes: 240,
        breederCheckDifficultyClass: 12,
        additionalCampaignMinutes: 240,
        minimumCampaignMinutesBeforeEgg: 480,
      },
    })
    expect(parseAuthoritativeBreedingProjectWizardProjectionV1(result)).toStrictEqual(result)
    expect(BREEDING_PROJECT_WIZARD_PRESENTATION_POLICY_DEFINITION_SHA256)
      .toBe(projectWizardContractJson.definition.implementation.presentationPolicyDefinitionSha256)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(ownerProfile.id)
    expect(serialized).not.toContain('serverPrivate')
    expect(serialized).not.toMatch(/projectId|eggId|operationId|authenticatedPrincipal/iu)
  })

  it('lets a GM preview a cross-owner pair only as consent review required', () => {
    const database = open()
    saveTrainer(database, 'trainer-alpha', ['pokemon-parent-a'], 'Alpha')
    saveTrainer(database, 'trainer-beta', ['pokemon-parent-b'], 'Beta')
    savePokemon(database, 'pokemon-parent-a', 'Bulbasaur', 'Female', 'Leaf')
    savePokemon(database, 'pokemon-parent-b', 'Ivysaur', 'Male', 'Bloom')

    const initial = loadBreedingProjectWizard({
      role: 'gm',
      playerProfile: null,
      request: { ...request('trainer-alpha'), profileId: null },
    }, { database })
    const selected = initial.parentDiscovery.trainerSheets
      .flatMap(trainer => trainer.candidates)
      .map(candidate => ({
        pokemonSheetSlug: candidate.parentSheetSlug,
        expectedSheetRevision: candidate.parentSheetRevision!,
      }))
    const result = loadBreedingProjectWizard({
      role: 'gm',
      playerProfile: null,
      request: { ...request('trainer-alpha', 'trainer-alpha', selected), profileId: null },
    }, { database })

    expect(result.consentStatus).toBe('review-required')
    expect(result.reviewStatus).toBe('requires-final-validation')
    expect(result.parentDiscovery.trainerSheets.map(row => row.trainerSheetSlug))
      .toEqual(['trainer-alpha', 'trainer-beta'])
  })

  it('allows a Profile-linked distinct Breeder while keeping parent discovery destination-scoped', () => {
    const database = open()
    setupOwner(database)
    saveTrainer(database, 'trainer-breeder', [], 'Brock')
    const result = loadBreedingProjectWizard({
      role: 'player',
      playerProfile: profile(['trainer-breeder', 'trainer-owner']),
      request: request('trainer-owner', 'trainer-breeder'),
    }, { database })

    expect(result.breeder).toMatchObject({
      trainerSheetSlug: 'trainer-breeder',
      displayName: 'Brock',
    })
    expect(result.parentDiscovery.trainerSheets.map(row => row.trainerSheetSlug))
      .toEqual(['trainer-owner'])
  })

  it('rejects stale Profiles, hidden parents, malformed authority, and cross-database repositories', () => {
    const database = open()
    setupOwner(database)
    saveTrainer(database, 'trainer-hidden', ['pokemon-hidden'])
    savePokemon(database, 'pokemon-hidden', 'Bulbasaur', 'Female', 'Hidden')
    const ownerProfile = profile(['trainer-owner'])

    expect(() => loadBreedingProjectWizard({
      role: 'player',
      playerProfile: ownerProfile,
      request: { ...request(), profileId: 'profile_other000' },
    }, { database })).toThrowError(expect.objectContaining({ statusCode: 403 }))
    expect(() => loadBreedingProjectWizard({
      role: 'player',
      playerProfile: ownerProfile,
      request: request('trainer-owner', 'trainer-owner', [{
        pokemonSheetSlug: 'pokemon-hidden', expectedSheetRevision: 0,
      }]),
    }, { database })).toThrowError(expect.objectContaining({ statusCode: 409 }))
    expect(() => loadBreedingProjectWizard({
      role: 'player',
      playerProfile: { ...ownerProfile, privateField: true },
      request: request(),
    }, { database })).toThrowError(expect.objectContaining({ statusCode: 400 }))
    expect(() => loadBreedingProjectWizard({
      role: 'gm',
      playerProfile: null,
      request: { ...request(), profileId: null, extra: true },
    }, { database })).toThrowError(expect.objectContaining({ statusCode: 400 }))

    const other = open()
    expect(() => loadBreedingProjectWizard({
      role: 'gm', playerProfile: null, request: { ...request(), profileId: null },
    }, {
      database,
      sheetRepository: createSqliteSheetRepository<Record<string, unknown>>(other),
    })).toThrowError(expect.objectContaining({ statusCode: 409 }))
    expect(() => loadBreedingProjectWizard({
      role: 'gm', playerProfile: null, request: { ...request(), profileId: null },
    }, {
      database,
      resolveCurrentCampaignOptions: (() => Promise.resolve({})) as never,
    })).toThrowError(expect.objectContaining({ statusCode: 409 }))
  })

  it('rejects enriched builders and hash-tampered projections', () => {
    expect(() => createBreedingProjectWizardProjectionV1({
      audience: 'owner',
      generatedAtCampaignMinute: 0,
      destination: { trainerSheetSlug: 'trainer-owner', trainerRevision: 0, displayName: 'Owner' },
      breeder: { trainerSheetSlug: 'trainer-owner', trainerRevision: 0, displayName: 'Owner' },
      parentDiscovery: {},
      timeline: {},
      consentStatus: 'selection-incomplete',
      reviewStatus: 'selection-incomplete',
      privateId: 'nope',
    } as never)).toThrowError(expect.objectContaining({
      code: 'breeding.project-wizard.invalid-definition',
    }))

    const database = open()
    setupOwner(database)
    const valid = loadBreedingProjectWizard({
      role: 'player', playerProfile: profile(['trainer-owner']), request: request(),
    }, { database })
    const tampered: BreedingProjectWizardProjectionV1 = {
      ...valid,
      destination: { ...valid.destination, displayName: 'Changed' },
    }
    expect(() => parseAuthoritativeBreedingProjectWizardProjectionV1(tampered))
      .toThrow(BreedingProjectWizardProjectionAuthorityError)
  })
})
