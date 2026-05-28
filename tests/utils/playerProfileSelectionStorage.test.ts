import { describe, expect, it } from 'vitest'
import {
  PLAYER_PROFILE_SELECTION_LOCAL_STORAGE_KEY,
  PLAYER_PROFILE_SELECTION_SCHEMA_VERSION,
  createRememberedPlayerProfileSelection,
  parsePlayerProfileDisplayName,
  parsePlayerProfileId,
  type RememberedPlayerProfileSelection,
} from '#shared/playerProfiles'
import { SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY } from '#shared/sessionClientIdentity'
import {
  createPlayerProfileSelectionStorage,
  type PlayerProfileSelectionStorageAdapter,
} from '~/utils/playerProfileSelectionStorage'

const profileId = parsePlayerProfileId('profile_ash00000')
const displayName = parsePlayerProfileDisplayName('Ash')
const rememberedAt = '2026-05-27T12:00:00.000Z'

const selection: RememberedPlayerProfileSelection = createRememberedPlayerProfileSelection({
  id: profileId,
  displayName,
}, rememberedAt)

const createFakeAdapter = (hasBrowser = true) => {
  const local = new Map<string, string>()
  const adapter: PlayerProfileSelectionStorageAdapter = {
    hasBrowser: () => hasBrowser,
    getLocalItem: (key) => local.get(key) ?? null,
    setLocalItem: (key, value) => {
      local.set(key, value)
    },
    removeLocalItem: (key) => {
      local.delete(key)
    },
  }

  return { adapter, local }
}

describe('player profile selection browser storage', () => {
  it('uses a stable storage key that is separate from live-session identity storage', () => {
    expect(PLAYER_PROFILE_SELECTION_LOCAL_STORAGE_KEY).toBe('rotom:player-profile:selection')
    expect(PLAYER_PROFILE_SELECTION_LOCAL_STORAGE_KEY).not.toBe(SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY)
  })

  it('remembers and loads only the selected profile display summary', () => {
    const fake = createFakeAdapter()
    const storage = createPlayerProfileSelectionStorage({ adapter: fake.adapter })

    expect(storage.remember(selection)).toBe(true)
    expect(storage.load()).toEqual(selection)

    const storedValue = fake.local.get(PLAYER_PROFILE_SELECTION_LOCAL_STORAGE_KEY)
    expect(storedValue).toBe(JSON.stringify({
      schemaVersion: PLAYER_PROFILE_SELECTION_SCHEMA_VERSION,
      profileId,
      displayName,
      rememberedAt,
    }))
    expect(storedValue).not.toContain('linkedCharacters')
    expect(storedValue).not.toContain('sessionId')
  })

  it('clears malformed stored selections instead of treating them as authority', () => {
    const fake = createFakeAdapter()
    fake.local.set(PLAYER_PROFILE_SELECTION_LOCAL_STORAGE_KEY, '{not-json')
    const storage = createPlayerProfileSelectionStorage({ adapter: fake.adapter })

    expect(storage.load()).toBeNull()
    expect(fake.local.has(PLAYER_PROFILE_SELECTION_LOCAL_STORAGE_KEY)).toBe(false)
  })

  it('clears the remembered player profile selection', () => {
    const fake = createFakeAdapter()
    const storage = createPlayerProfileSelectionStorage({ adapter: fake.adapter })
    storage.remember(selection)

    expect(storage.clear()).toBe(true)

    expect(fake.local.has(PLAYER_PROFILE_SELECTION_LOCAL_STORAGE_KEY)).toBe(false)
  })

  it('is a safe no-op when browser storage is unavailable', () => {
    const fake = createFakeAdapter(false)
    const storage = createPlayerProfileSelectionStorage({ adapter: fake.adapter })

    expect(storage.remember(selection)).toBe(false)
    expect(storage.load()).toBeNull()
    expect(storage.clear()).toBe(false)
    expect(fake.local.size).toBe(0)
  })
})
