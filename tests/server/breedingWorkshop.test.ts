import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import workshopContractJson from '../../data/breeding-automation/workshop-presentation-contract.json'
import type { PlayerProfile } from '../../shared/playerProfiles'
import {
  BREEDING_PERFORMANCE_BUDGET_POLICY_V1,
  breedingPerformanceJsonUtf8Bytes,
} from '../../shared/breeding/performanceBudgets'
import {
  BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT,
  type BreedingWorkshopProjectionV1,
} from '../../shared/breeding/workshop'
import {
  BREEDING_WORKSHOP_PRESENTATION_POLICY_DEFINITION_SHA256,
  BreedingWorkshopProjectionAuthorityError,
  createBreedingWorkshopProjectionV1,
  parseAuthoritativeBreedingWorkshopProjectionV1,
} from '../../server/domain/breeding/workshop'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import {
  LoadBreedingWorkshopError,
  loadBreedingWorkshop,
} from '../../server/useCases/loadBreedingWorkshop'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})

const profile = (trainerSlugs: readonly string[]): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_owner000' as never,
  displayName: 'Owner' as never,
  linkedCharacters: trainerSlugs.map(sheetSlug => ({ sheetKind: 'trainer' as const, sheetSlug })),
})
const saveTrainer = (database: RotomDatabase, slug: string, name = slug): void => {
  createSqliteSheetRepository<Record<string, unknown>>(database).saveSetupSheet('trainer', slug, {
    slug,
    revision: 0,
    updatedAt: 100,
    name,
    currentTeam: [],
    boxedPokemon: [],
  })
}
const query = (trainerSheetSlug: string | null = null, ownershipCursor: string | null = null) => ({
  trainerSheetSlug,
  ownershipCursor,
})

describe('BR-070 Breeding Workshop server projection', () => {
  it('returns a self-hashed profile-required state without ownership facts', () => {
    const database = open()
    saveTrainer(database, 'trainer-hidden', 'Hidden Trainer')
    const result = loadBreedingWorkshop({
      role: 'player',
      playerProfile: null,
      query: query(),
    }, { database })

    expect(result).toMatchObject({
      audience: 'owner',
      profileSelectionRequired: true,
      ownershipContexts: [],
      selectedOwnershipContext: null,
      emptyState: 'profile-required',
    })
    expect(parseAuthoritativeBreedingWorkshopProjectionV1(result)).toStrictEqual(result)
    expect(BREEDING_WORKSHOP_PRESENTATION_POLICY_DEFINITION_SHA256)
      .toBe(workshopContractJson.definition.implementation.presentationPolicyDefinitionSha256)
  })

  it('shows players only exact Profile-linked Trainers and rejects foreign selection', () => {
    const database = open()
    saveTrainer(database, 'trainer-owner', 'Mira')
    saveTrainer(database, 'trainer-hidden', 'Secret GM Trainer')
    const result = loadBreedingWorkshop({
      role: 'player',
      playerProfile: profile(['trainer-owner']),
      query: query(),
    }, { database })

    expect(result.ownershipContexts).toEqual([expect.objectContaining({
      trainerSheetSlug: 'trainer-owner',
      displayName: 'Mira',
      availability: 'available',
      hasProjects: false,
      hasEggs: false,
    })])
    expect(JSON.stringify(result)).not.toContain('trainer-hidden')
    expect(result.emptyState).toBe('selected-context-empty')

    expect(() => loadBreedingWorkshop({
      role: 'player',
      playerProfile: profile(['trainer-owner']),
      query: query('trainer-hidden'),
    }, { database })).toThrowError(expect.objectContaining({ statusCode: 403 }))
  })

  it('keeps a stale linked Trainer visible only as a safe unavailable context', () => {
    const database = open()
    const result = loadBreedingWorkshop({
      role: 'player',
      playerProfile: profile(['trainer-missing']),
      query: query(),
    }, { database })

    expect(result).toMatchObject({
      emptyState: 'selected-context-unavailable',
      selectedOwnershipContext: {
        trainerSheetSlug: 'trainer-missing',
        trainerRevision: null,
        displayName: 'trainer-missing',
        availability: 'unavailable',
        unavailableReasonId: 'breeding.workshop.trainer-unavailable',
        hasProjects: false,
        hasEggs: false,
      },
    })
  })

  it('projects GM activity as booleans without aggregate identities or mechanics', () => {
    const database = open()
    saveTrainer(database, 'trainer-ash', 'Ash')
    saveTrainer(database, 'trainer-misty', 'Misty')
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const result = loadBreedingWorkshop({
      role: 'gm',
      playerProfile: null,
      query: query('trainer-misty'),
    }, {
      database,
      sheetRepository: sheets,
      projectRepository: {
        database,
        listByOwner: slug => slug === 'trainer-misty' ? [{} as never] : [],
      },
      eggRepository: {
        database,
        listByOwner: slug => slug === 'trainer-misty' ? [{} as never] : [],
      },
    })

    expect(result).toMatchObject({
      audience: 'gm',
      profileSelectionRequired: false,
      emptyState: null,
      selectedOwnershipContext: {
        trainerSheetSlug: 'trainer-misty',
        hasProjects: true,
        hasEggs: true,
      },
    })
    expect(result.ownershipContexts.map(context => context.trainerSheetSlug))
      .toEqual(['trainer-ash', 'trainer-misty'])
    expect(JSON.stringify(result)).not.toMatch(/projectId|eggId|speciesId|parent/i)
  })

  it('pages a bounded Trainer directory with a non-authorizing cursor', () => {
    const database = open()
    for (let index = 0; index <= BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT; index += 1) {
      saveTrainer(database, `trainer-${String(index).padStart(3, '0')}`)
    }
    const startedAt = performance.now()
    const first = loadBreedingWorkshop({
      role: 'gm', playerProfile: null, query: query(),
    }, { database })
    const elapsed = performance.now() - startedAt
    expect(first.ownershipContexts).toHaveLength(BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT)
    expect(breedingPerformanceJsonUtf8Bytes(first)).toBeLessThanOrEqual(
      BREEDING_PERFORMANCE_BUDGET_POLICY_V1.workshop.maximumProjectionUtf8Bytes,
    )
    expect(elapsed).toBeLessThanOrEqual(
      BREEDING_PERFORMANCE_BUDGET_POLICY_V1.workshop.maximumElapsedMilliseconds,
    )
    expect(first.nextOwnershipCursor).toBe('trainer-099')

    const second = loadBreedingWorkshop({
      role: 'gm',
      playerProfile: null,
      query: query(first.selectedOwnershipContext!.trainerSheetSlug, first.nextOwnershipCursor),
    }, { database })
    expect(second.ownershipContexts.map(context => context.trainerSheetSlug))
      .toEqual(['trainer-100'])
    expect(second.nextOwnershipCursor).toBeNull()
    expect(second.selectedOwnershipContext?.trainerSheetSlug).toBe('trainer-000')
  })

  it('fails closed on malformed Profiles, queries, repository connections, and projection hashes', () => {
    const database = open()
    saveTrainer(database, 'trainer-owner')
    expect(() => loadBreedingWorkshop({
      role: 'player',
      playerProfile: { ...profile(['trainer-owner']), extra: true },
      query: query(),
    }, { database })).toThrow(LoadBreedingWorkshopError)
    expect(() => loadBreedingWorkshop({
      role: 'gm',
      playerProfile: null,
      query: { ...query(), aggregateId: 'private' },
    }, { database })).toThrowError(expect.objectContaining({ statusCode: 400 }))

    const other = open()
    expect(() => loadBreedingWorkshop({
      role: 'gm', playerProfile: null, query: query(),
    }, {
      database,
      sheetRepository: createSqliteSheetRepository<Record<string, unknown>>(other),
    })).toThrowError(expect.objectContaining({ statusCode: 409 }))

    const accessorInput: Record<string, unknown> = {
      playerProfile: null,
      query: query(),
    }
    Object.defineProperty(accessorInput, 'role', {
      enumerable: true,
      get: () => 'gm',
    })
    expect(() => loadBreedingWorkshop(accessorInput as never, { database }))
      .toThrowError(expect.objectContaining({ statusCode: 400 }))

    expect(() => loadBreedingWorkshop({
      role: 'gm', playerProfile: null, query: query(),
    }, {
      database,
      projectRepository: {
        database,
        listByOwner: (() => Promise.resolve([])) as never,
      },
    })).toThrowError(expect.objectContaining({ statusCode: 409 }))

    const sparseRows = Array(1)
    expect(() => loadBreedingWorkshop({
      role: 'gm', playerProfile: null, query: query(),
    }, {
      database,
      sheetRepository: {
        database,
        getByRef: () => null,
        list: () => sparseRows as never,
      },
    })).toThrowError(expect.objectContaining({ statusCode: 409 }))

    const oversizedDirectory = Array.from({
      length: BREEDING_PERFORMANCE_BUDGET_POLICY_V1.workshop.maximumAuthorizedTrainers + 1,
    }, (_, index) => ({ kind: 'trainer', slug: `trainer-overflow-${index}` }))
    expect(() => loadBreedingWorkshop({
      role: 'gm', playerProfile: null, query: query(),
    }, {
      database,
      sheetRepository: {
        database,
        getByRef: () => null,
        list: () => oversizedDirectory as never,
      },
    })).toThrowError(expect.objectContaining({ statusCode: 409 }))

    expect(() => createBreedingWorkshopProjectionV1({
      audience: 'gm',
      generatedAtCampaignMinute: 0,
      profileSelectionRequired: false,
      ownershipCursor: null,
      nextOwnershipCursor: null,
      ownershipContexts: [],
      selectedOwnershipContext: null,
      emptyState: 'no-authorized-trainers',
      extra: true,
    } as never)).toThrowError(expect.objectContaining({
      code: 'breeding.workshop.invalid-definition',
    }))

    const valid = loadBreedingWorkshop({
      role: 'gm', playerProfile: null, query: query(),
    }, { database })
    const tampered: BreedingWorkshopProjectionV1 = {
      ...valid,
      generatedAtCampaignMinute: valid.generatedAtCampaignMinute + 1,
    }
    expect(() => parseAuthoritativeBreedingWorkshopProjectionV1(tampered))
      .toThrow(BreedingWorkshopProjectionAuthorityError)
  })
})
