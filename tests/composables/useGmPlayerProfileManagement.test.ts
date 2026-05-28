import { describe, expect, it, vi } from 'vitest'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  parsePlayerProfileDisplayName,
  parsePlayerProfileId,
  type PlayerProfile,
} from '#shared/playerProfiles'
import { useGmPlayerProfileManagement } from '~/composables/useGmPlayerProfileManagement'
import { PLAYER_PROFILE_API_PATHS, SHEET_API_PATHS } from '~/utils/apiRoutes'
import type { ApiClient } from '~/utils/apiClient'

const ashProfile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: parsePlayerProfileId('profile_ash00000'),
  displayName: parsePlayerProfileDisplayName('Ash'),
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
}

const mistyProfile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: parsePlayerProfileId('profile_misty000'),
  displayName: parsePlayerProfileDisplayName('Misty'),
  linkedCharacters: [],
}

const brockProfile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: parsePlayerProfileId('profile_brock000'),
  displayName: parsePlayerProfileDisplayName('Brock'),
  linkedCharacters: [],
}

const makeApiClient = (handlers: Record<string, (body?: unknown) => unknown | Promise<unknown>>) => {
  const calls: { request: string; method: 'GET' | 'POST'; body?: unknown }[] = []
  const apiClient: ApiClient = {
    getJson: vi.fn(async (request: string) => {
      calls.push({ request, method: 'GET' })
      const handler = handlers[request]
      if (handler === undefined) throw new Error(`unexpected GET request: ${request}`)
      return await handler()
    }) as ApiClient['getJson'],
    postJson: vi.fn(async (request: string, body: unknown) => {
      calls.push({ request, method: 'POST', body })
      const handler = handlers[request]
      if (handler === undefined) throw new Error(`unexpected POST request: ${request}`)
      return await handler(body)
    }) as ApiClient['postJson'],
  }

  return { apiClient, calls }
}

describe('useGmPlayerProfileManagement', () => {
  it('loads profiles for the GM management shell without selecting one automatically', async () => {
    const { apiClient, calls } = makeApiClient({
      [PLAYER_PROFILE_API_PATHS.list]: () => ({ profiles: [mistyProfile, ashProfile] }),
    })
    const management = useGmPlayerProfileManagement({ apiClient })

    await expect(management.loadProfiles()).resolves.toEqual([ashProfile, mistyProfile])

    expect(calls).toEqual([{ request: PLAYER_PROFILE_API_PATHS.list, method: 'GET' }])
    expect(management.profiles.value).toEqual([ashProfile, mistyProfile])
    expect(management.profileCount.value).toBe(2)
    expect(management.hasProfiles.value).toBe(true)
    expect(management.selectedProfile.value).toBeNull()
    expect(management.lastNotice.value).toBe('Loaded 2 player profiles.')
    expect(management.lastError.value).toBeNull()
  })

  it('selects a loaded profile for the detail view', async () => {
    const { apiClient } = makeApiClient({
      [PLAYER_PROFILE_API_PATHS.list]: () => ({ profiles: [ashProfile] }),
    })
    const management = useGmPlayerProfileManagement({ apiClient })

    await management.loadProfiles()
    expect(management.selectProfile(ashProfile.id)).toEqual(ashProfile)

    expect(management.selectedProfileId.value).toBe(ashProfile.id)
    expect(management.selectedProfile.value).toEqual(ashProfile)
    expect(management.lastNotice.value).toBe('Opened player profile Ash.')
  })

  it('shows a clear empty state notice when no profiles exist', async () => {
    const { apiClient } = makeApiClient({
      [PLAYER_PROFILE_API_PATHS.list]: () => ({ profiles: [] }),
    })
    const management = useGmPlayerProfileManagement({ apiClient })

    await expect(management.loadProfiles()).resolves.toEqual([])

    expect(management.hasProfiles.value).toBe(false)
    expect(management.profileCount.value).toBe(0)
    expect(management.lastNotice.value).toBe('No player profiles found.')
  })

  it('creates a profile through the GM-only profile creation API and selects it', async () => {
    const { apiClient, calls } = makeApiClient({
      [PLAYER_PROFILE_API_PATHS.list]: () => ({ profiles: [ashProfile] }),
      [PLAYER_PROFILE_API_PATHS.create]: (body) => {
        expect(body).toEqual({ displayName: '  Brock  ' })
        return { profile: brockProfile }
      },
    })
    const management = useGmPlayerProfileManagement({ apiClient })

    await management.loadProfiles()
    await expect(management.createProfile('  Brock  ')).resolves.toEqual(brockProfile)

    expect(calls).toEqual([
      { request: PLAYER_PROFILE_API_PATHS.list, method: 'GET' },
      { request: PLAYER_PROFILE_API_PATHS.create, method: 'POST', body: { displayName: '  Brock  ' } },
    ])
    expect(management.profiles.value).toEqual([ashProfile, brockProfile])
    expect(management.selectedProfileId.value).toBe(brockProfile.id)
    expect(management.selectedProfile.value).toEqual(brockProfile)
    expect(management.lastNotice.value).toBe('Created player profile Brock.')
    expect(management.lastError.value).toBeNull()
    expect(management.creatingProfile.value).toBe(false)
  })

  it('clears a stale detail selection after profiles are reloaded', async () => {
    const responses = [
      { profiles: [ashProfile] },
      { profiles: [mistyProfile] },
    ]
    const { apiClient } = makeApiClient({
      [PLAYER_PROFILE_API_PATHS.list]: () => responses.shift() ?? { profiles: [] },
    })
    const management = useGmPlayerProfileManagement({ apiClient })

    await management.loadProfiles()
    management.selectProfile(ashProfile.id)
    await management.loadProfiles()

    expect(management.profiles.value).toEqual([mistyProfile])
    expect(management.selectedProfileId.value).toBeNull()
    expect(management.selectedProfile.value).toBeNull()
  })

  it('records safe errors for failed loads and missing profile selections', async () => {
    const { apiClient } = makeApiClient({
      [PLAYER_PROFILE_API_PATHS.list]: () => {
        throw { data: { statusMessage: 'GM login required' } }
      },
    })
    const management = useGmPlayerProfileManagement({ apiClient })

    await expect(management.loadProfiles()).rejects.toMatchObject({
      data: { statusMessage: 'GM login required' },
    })
    expect(management.lastError.value).toBe('GM login required')

    expect(() => management.selectProfile(ashProfile.id)).toThrow(
      `Player profile ${ashProfile.id} has not been loaded.`,
    )
    expect(management.lastError.value).toBe(`Player profile ${ashProfile.id} has not been loaded.`)
  })

  it('loads linkable character sheet options and filters already linked sheets', async () => {
    const { apiClient, calls } = makeApiClient({
      [PLAYER_PROFILE_API_PATHS.list]: () => ({ profiles: [ashProfile] }),
      [SHEET_API_PATHS.list]: () => ({
        pokemonSheets: [{ slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', folder: 'party' }],
        trainerSheets: [{ slug: 'brock', name: 'Brock', folder: 'leaders' }],
      }),
    })
    const management = useGmPlayerProfileManagement({ apiClient })

    await management.loadProfiles()
    management.selectProfile(ashProfile.id)
    await expect(management.loadLinkableCharacters()).resolves.toMatchObject([
      { key: 'trainer:brock', label: 'Brock · Trainer sheet', detailsLabel: 'brock · leaders' },
      { key: 'pokemon:pikachu', label: 'Pikachu · Pokémon sheet', detailsLabel: 'pikachu · party' },
    ])

    expect(calls).toEqual([
      { request: PLAYER_PROFILE_API_PATHS.list, method: 'GET' },
      { request: SHEET_API_PATHS.list, method: 'GET' },
    ])
    expect(management.availableLinkOptions.value.map((option) => option.key)).toEqual(['trainer:brock'])
    expect(management.lastNotice.value).toBe('Loaded 2 linkable character sheets.')
  })

  it('links and unlinks selected profile characters through the profile update API', async () => {
    const ashWithTrainer: PlayerProfile = {
      ...ashProfile,
      linkedCharacters: [
        { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
        { sheetKind: 'trainer', sheetSlug: 'brock' },
      ],
    }
    const ashTrainerOnly: PlayerProfile = {
      ...ashProfile,
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'brock' }],
    }
    const updateBodies: unknown[] = []
    const { apiClient } = makeApiClient({
      [PLAYER_PROFILE_API_PATHS.list]: () => ({ profiles: [ashProfile] }),
      [SHEET_API_PATHS.list]: () => ({
        pokemonSheets: [{ slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu' }],
        trainerSheets: [{ slug: 'brock', name: 'Brock' }],
      }),
      [PLAYER_PROFILE_API_PATHS.update]: (body) => {
        updateBodies.push(body)
        const linkedCharacters = (body as { linkedCharacters: unknown[] }).linkedCharacters
        return {
          profile: linkedCharacters.some((ref) => (
            (ref as { sheetKind?: unknown; sheetSlug?: unknown }).sheetKind === 'pokemon'
          )) ? ashWithTrainer : ashTrainerOnly,
        }
      },
    })
    const management = useGmPlayerProfileManagement({ apiClient })

    await management.loadProfiles()
    management.selectProfile(ashProfile.id)
    await management.loadLinkableCharacters()

    await expect(management.linkCharacterToSelectedProfile({
      sheetKind: 'trainer',
      sheetSlug: 'brock',
    })).resolves.toEqual(ashWithTrainer)
    expect(updateBodies[0]).toEqual({
      profileId: 'profile_ash00000',
      linkedCharacters: [
        { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
        { sheetKind: 'trainer', sheetSlug: 'brock' },
      ],
    })
    expect(management.selectedProfile.value).toEqual(ashWithTrainer)
    expect(management.availableLinkOptions.value).toEqual([])
    expect(management.lastNotice.value).toBe('Linked Brock · Trainer sheet to Ash.')

    await expect(management.unlinkCharacterFromSelectedProfile({
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
    })).resolves.toEqual(ashTrainerOnly)
    expect(updateBodies[1]).toEqual({
      profileId: 'profile_ash00000',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'brock' }],
    })
    expect(management.selectedProfile.value).toEqual(ashTrainerOnly)
    expect(management.availableLinkOptions.value.map((option) => option.key)).toEqual(['pokemon:pikachu'])
    expect(management.lastNotice.value).toBe('Unlinked Pikachu · Pokémon sheet from Ash.')
  })
})
