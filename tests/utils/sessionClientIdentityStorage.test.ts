import { describe, expect, it } from 'vitest'
import {
  SESSION_CLIENT_IDENTITY_COOKIE,
  SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY,
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  serializeSessionClientIdentityCookieHint,
  type GmSessionClientIdentity,
  type PlayerSessionClientIdentity,
} from '#shared/sessionClientIdentity'
import {
  parseClientId,
  parseGmKey,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import { parseSessionRevision } from '#shared/sessionRevisions'
import {
  buildSessionClientIdentityClearCookie,
  buildSessionClientIdentitySetCookie,
  createSessionClientIdentityStorage,
  readCookieValue,
  type SessionClientIdentityStorageAdapter,
} from '~/utils/sessionClientIdentityStorage'

const sessionId = parseSessionId('session_storage00001')
const gmClientId = parseClientId('client_storageGM')
const playerClientId = parseClientId('client_storagePL')
const gmKey = parseGmKey('gmkey_storageabcdefghijklmnopqrstuvwxyz')
const playerId = parsePlayerId('player_storage1')
const displayName = parseSessionDisplayName('Brock')
const rememberedAt = '2026-05-26T12:00:00.000Z'
const lastSeenRevision = parseSessionRevision(4)

const gmIdentity: GmSessionClientIdentity = {
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'gm',
  sessionId,
  clientId: gmClientId,
  gmKey,
  rememberedAt,
  lastSeenRevision,
}

const playerIdentity: PlayerSessionClientIdentity = {
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'player',
  sessionId,
  clientId: playerClientId,
  playerId,
  displayName,
  rememberedAt,
}

const createFakeAdapter = (hasBrowser = true) => {
  const local = new Map<string, string>()
  let cookie = ''
  const adapter: SessionClientIdentityStorageAdapter = {
    hasBrowser: () => hasBrowser,
    getLocalItem: (key) => local.get(key) ?? null,
    setLocalItem: (key, value) => {
      local.set(key, value)
    },
    removeLocalItem: (key) => {
      local.delete(key)
    },
    getCookieString: () => cookie,
    setCookieString: (value) => {
      cookie = value
    },
  }

  return {
    adapter,
    local,
    get cookie() {
      return cookie
    },
    set cookie(value: string) {
      cookie = value
    },
  }
}

describe('session client identity browser storage', () => {
  it('remembers full GM identity locally and only a non-secret cookie hint', () => {
    const fake = createFakeAdapter()
    const storage = createSessionClientIdentityStorage({ adapter: fake.adapter })

    expect(storage.remember(gmIdentity)).toBe(true)
    expect(storage.load()).toEqual(gmIdentity)

    const localValue = fake.local.get(SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY)
    expect(localValue).toContain(gmKey)
    expect(fake.cookie).toContain(`${SESSION_CLIENT_IDENTITY_COOKIE}=`)
    expect(decodeURIComponent(fake.cookie)).not.toContain(gmKey)
    expect(storage.readCookieHint()).toEqual({
      schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
      role: 'gm',
      sessionId,
      clientId: gmClientId,
      rememberedAt,
      lastSeenRevision,
    })
  })

  it('remembers and loads player identity continuity details', () => {
    const fake = createFakeAdapter()
    const storage = createSessionClientIdentityStorage({ adapter: fake.adapter })

    expect(storage.remember(playerIdentity)).toBe(true)

    expect(storage.load()).toEqual(playerIdentity)
    expect(storage.readCookieHint()).toEqual(playerIdentity)
  })

  it('clears malformed local identity instead of treating it as authority', () => {
    const fake = createFakeAdapter()
    fake.local.set(SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY, '{not-json')
    const storage = createSessionClientIdentityStorage({ adapter: fake.adapter })

    expect(storage.load()).toBeNull()
    expect(fake.local.has(SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY)).toBe(false)
  })

  it('clears malformed cookie hints instead of using them as credentials', () => {
    const fake = createFakeAdapter()
    fake.cookie = `${SESSION_CLIENT_IDENTITY_COOKIE}=${encodeURIComponent(JSON.stringify({
      ...gmIdentity,
    }))}`
    const storage = createSessionClientIdentityStorage({ adapter: fake.adapter })

    expect(storage.readCookieHint()).toBeNull()
    expect(fake.cookie).toBe(`${SESSION_CLIENT_IDENTITY_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`)
  })

  it('clears both local identity storage and the continuity cookie', () => {
    const fake = createFakeAdapter()
    const storage = createSessionClientIdentityStorage({ adapter: fake.adapter })
    storage.remember(playerIdentity)

    expect(storage.clear()).toBe(true)

    expect(fake.local.has(SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY)).toBe(false)
    expect(fake.cookie).toBe(`${SESSION_CLIENT_IDENTITY_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`)
  })

  it('is a safe no-op when browser storage is unavailable', () => {
    const fake = createFakeAdapter(false)
    const storage = createSessionClientIdentityStorage({ adapter: fake.adapter })

    expect(storage.remember(playerIdentity)).toBe(false)
    expect(storage.load()).toBeNull()
    expect(storage.readCookieHint()).toBeNull()
    expect(storage.clear()).toBe(false)
    expect(fake.local.size).toBe(0)
    expect(fake.cookie).toBe('')
  })

  it('builds and reads cookie strings with explicit safe defaults', () => {
    const encoded = serializeSessionClientIdentityCookieHint(playerIdentity)
    const cookie = buildSessionClientIdentitySetCookie(encoded, SESSION_CLIENT_IDENTITY_COOKIE, {
      maxAgeSeconds: 60,
      path: '/table',
      sameSite: 'Strict',
      secure: true,
    })

    expect(cookie).toBe(
      `${SESSION_CLIENT_IDENTITY_COOKIE}=${encoded}; Max-Age=60; Path=/table; SameSite=Strict; Secure`,
    )
    expect(readCookieValue(`other=1; ${cookie}`, SESSION_CLIENT_IDENTITY_COOKIE)).toBe(encoded)
    expect(buildSessionClientIdentityClearCookie(SESSION_CLIENT_IDENTITY_COOKIE, { secure: true })).toBe(
      `${SESSION_CLIENT_IDENTITY_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`,
    )
  })
})
