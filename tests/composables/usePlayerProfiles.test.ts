import { describe, expect, it, vi } from 'vitest'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  createRememberedPlayerProfileSelection,
  parsePlayerProfileDisplayName,
  parsePlayerProfileId,
  type PlayerProfile,
  type RememberedPlayerProfileSelection,
} from '#shared/playerProfiles'
import { PLAYER_PROFILE_API_PATHS } from '~/utils/apiRoutes'
import type { ApiClient } from '~/utils/apiClient'
import type { PlayerProfileSelectionStorage } from '~/utils/playerProfileSelectionStorage'
import {
  playerProfileErrorMessage,
  usePlayerProfiles,
} from '~/composables/usePlayerProfiles'

const REMEMBERED_AT = '2026-05-27T12:00:00.000Z'
const SELECTED_AT = '2026-05-27T12:05:00.000Z'

const ashProfile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: parsePlayerProfileId('profile_ash00000'),
  displayName: parsePlayerProfileDisplayName('Ash'),
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
}

const renamedAshProfile: PlayerProfile = {
  ...ashProfile,
  displayName: parsePlayerProfileDisplayName('Ash Ketchum'),
}

const mistyProfile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: parsePlayerProfileId('profile_misty000'),
  displayName: parsePlayerProfileDisplayName('Misty'),
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'misty' }],
}

const brockProfile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: parsePlayerProfileId('profile_brock000'),
  displayName: parsePlayerProfileDisplayName('Brock'),
  linkedCharacters: [],
}

const rememberedAsh = createRememberedPlayerProfileSelection(ashProfile, REMEMBERED_AT)

const makeStorage = (initial: RememberedPlayerProfileSelection | null = null) => {
  let stored = initial
  const storage: PlayerProfileSelectionStorage = {
    remember: vi.fn((selection: RememberedPlayerProfileSelection) => {
      stored = selection
      return true
    }),
    load: vi.fn(() => stored),
    clear: vi.fn(() => {
      stored = null
      return true
    }),
  }

  return {
    storage,
    stored: () => stored,
  }
}

const makeApiClient = (handlers: Record<string, () => unknown | Promise<unknown>>) => {
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
      return await handler()
    }) as ApiClient['postJson'],
  }

  return { apiClient, calls }
}

describe('usePlayerProfiles', () => {
  it('loads a remembered browser profile summary without touching role or live-session state', () => {
    const { storage } = makeStorage(rememberedAsh)
    const { apiClient, calls } = makeApiClient({})
    const profiles = usePlayerProfiles({ apiClient, selectionStorage: storage })

    expect(profiles.loadRememberedProfile()).toEqual(rememberedAsh)

    expect(profiles.selectedProfileSummary.value).toEqual(rememberedAsh)
    expect(profiles.selectedProfile.value).toBeNull()
    expect(profiles.selectedProfileId.value).toBe(ashProfile.id)
    expect(profiles.selectedProfileDisplayName.value).toBe(ashProfile.displayName)
    expect(profiles.selectedLinkedCharacters.value).toEqual([])
    expect(profiles.hasSelectedProfile.value).toBe(true)
    expect(storage.load).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([])
  })

  it('reloads persistent profiles and hydrates linked characters for the remembered selection', async () => {
    const staleRememberedAsh = createRememberedPlayerProfileSelection({
      id: ashProfile.id,
      displayName: parsePlayerProfileDisplayName('Ash Old'),
    }, REMEMBERED_AT)
    const { storage, stored } = makeStorage(staleRememberedAsh)
    const { apiClient, calls } = makeApiClient({
      [PLAYER_PROFILE_API_PATHS.list]: () => ({ profiles: [mistyProfile, renamedAshProfile] }),
    })
    const profiles = usePlayerProfiles({ apiClient, selectionStorage: storage })

    await expect(profiles.reloadProfiles()).resolves.toEqual([mistyProfile, renamedAshProfile])

    expect(calls).toEqual([{ request: PLAYER_PROFILE_API_PATHS.list, method: 'GET' }])
    expect(profiles.selectedProfile.value).toEqual(renamedAshProfile)
    expect(profiles.selectedProfileId.value).toBe(ashProfile.id)
    expect(profiles.selectedProfileDisplayName.value).toBe(renamedAshProfile.displayName)
    expect(profiles.selectedLinkedCharacters.value).toEqual(renamedAshProfile.linkedCharacters)
    expect(stored()).toEqual(createRememberedPlayerProfileSelection(renamedAshProfile, REMEMBERED_AT))
    expect(storage.remember).toHaveBeenCalledWith(createRememberedPlayerProfileSelection(
      renamedAshProfile,
      REMEMBERED_AT,
    ))
  })

  it('remembers a selected profile through separate profile-selection storage', () => {
    const { storage, stored } = makeStorage()
    const { apiClient, calls } = makeApiClient({})
    const profiles = usePlayerProfiles({
      apiClient,
      selectionStorage: storage,
      clock: () => SELECTED_AT,
    })

    const selection = profiles.rememberProfile(mistyProfile)

    expect(selection).toEqual(createRememberedPlayerProfileSelection(mistyProfile, SELECTED_AT))
    expect(stored()).toEqual(selection)
    expect(profiles.profiles.value).toEqual([mistyProfile])
    expect(profiles.selectedProfile.value).toEqual(mistyProfile)
    expect(profiles.selectedLinkedCharacters.value).toEqual(mistyProfile.linkedCharacters)
    expect(profiles.lastNotice.value).toBe('Selected player profile Misty.')
    expect(calls).toEqual([])
  })

  it('can remember a loaded profile by id for picker UIs', async () => {
    const { storage } = makeStorage()
    const { apiClient } = makeApiClient({
      [PLAYER_PROFILE_API_PATHS.list]: () => ({ profiles: [mistyProfile, brockProfile] }),
    })
    const profiles = usePlayerProfiles({
      apiClient,
      selectionStorage: storage,
      clock: () => SELECTED_AT,
    })

    await profiles.reloadProfiles({ silent: true })
    profiles.rememberProfileById(brockProfile.id)

    expect(profiles.selectedProfile.value).toEqual(brockProfile)
    expect(profiles.selectedProfileSummary.value).toEqual(createRememberedPlayerProfileSelection(
      brockProfile,
      SELECTED_AT,
    ))
  })

  it('clears a missing remembered profile after reload so players can recover gracefully', async () => {
    const { storage, stored } = makeStorage(rememberedAsh)
    const { apiClient } = makeApiClient({
      [PLAYER_PROFILE_API_PATHS.list]: () => ({ profiles: [mistyProfile] }),
    })
    const profiles = usePlayerProfiles({ apiClient, selectionStorage: storage })

    await profiles.reloadProfiles()

    expect(stored()).toBeNull()
    expect(storage.clear).toHaveBeenCalledTimes(1)
    expect(profiles.selectedProfile.value).toBeNull()
    expect(profiles.selectedProfileSummary.value).toBeNull()
    expect(profiles.selectedProfileId.value).toBeNull()
    expect(profiles.selectedLinkedCharacters.value).toEqual([])
    expect(profiles.lastNotice.value).toBe(
      'The remembered player profile no longer exists. Choose a profile to continue.',
    )
  })

  it('clears the selected profile summary and loaded profile state', () => {
    const { storage, stored } = makeStorage(rememberedAsh)
    const { apiClient } = makeApiClient({})
    const profiles = usePlayerProfiles({ apiClient, selectionStorage: storage })
    profiles.loadRememberedProfile()

    profiles.clearSelectedProfile()

    expect(stored()).toBeNull()
    expect(storage.clear).toHaveBeenCalledTimes(1)
    expect(profiles.selectedProfile.value).toBeNull()
    expect(profiles.selectedProfileSummary.value).toBeNull()
    expect(profiles.hasSelectedProfile.value).toBe(false)
    expect(profiles.lastNotice.value).toBe('Cleared the selected player profile for this browser.')
  })

  it('records safe errors for malformed profile reloads and picker misses', async () => {
    const { storage } = makeStorage()
    const { apiClient } = makeApiClient({
      [PLAYER_PROFILE_API_PATHS.list]: () => ({ profiles: [{ ...ashProfile, id: 'bad-id' }] }),
    })
    const profiles = usePlayerProfiles({ apiClient, selectionStorage: storage })

    await expect(profiles.reloadProfiles()).rejects.toThrow('profiles[0].id must match')
    expect(profiles.lastError.value).toContain('profiles[0].id must match')

    await expect(() => profiles.rememberProfileById(mistyProfile.id)).toThrow(
      `Player profile ${mistyProfile.id} has not been loaded.`,
    )
    expect(profiles.lastError.value).toBe(`Player profile ${mistyProfile.id} has not been loaded.`)
  })
})

describe('playerProfileErrorMessage', () => {
  it('prefers useful API error message fields', () => {
    expect(playerProfileErrorMessage({ data: { statusMessage: 'GM login required' } })).toBe(
      'GM login required',
    )
    expect(playerProfileErrorMessage({ message: 'Network failed' })).toBe('Network failed')
    expect(playerProfileErrorMessage(null)).toBe('The player profile request failed.')
  })
})
