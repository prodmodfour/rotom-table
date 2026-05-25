import { describe, expect, it } from 'vitest'
import {
  SESSION_CLIENT_IDENTITY_COOKIE,
  SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY,
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  deserializeSessionClientIdentity,
  deserializeSessionClientIdentityCookieHint,
  serializeSessionClientIdentity,
  serializeSessionClientIdentityCookieHint,
  toSessionClientIdentityCookieHint,
  updateSessionClientIdentityRevision,
  validateSessionClientIdentity,
  validateSessionClientIdentityCookieHint,
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

const rememberedAt = '2026-05-26T12:00:00.000Z'
const sessionId = parseSessionId('session_cookie000001')
const gmClientId = parseClientId('client_cookieGM01')
const playerClientId = parseClientId('client_cookiePL01')
const gmKey = parseGmKey('gmkey_cookieabcdefghijklmnopqrstuvwxyz')
const playerId = parsePlayerId('player_cookie001')
const displayName = parseSessionDisplayName('Misty')
const revision = parseSessionRevision(7)

const gmIdentity: GmSessionClientIdentity = {
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'gm',
  sessionId,
  clientId: gmClientId,
  gmKey,
  rememberedAt,
  lastSeenRevision: revision,
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

describe('session client identity contract', () => {
  it('defines stable cookie and local-storage keys', () => {
    expect(SESSION_CLIENT_IDENTITY_COOKIE).toBe('rotom-session-identity')
    expect(SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY).toBe('rotom:session:identity')
  })

  it('round-trips a full GM identity through local JSON storage', () => {
    const serialized = serializeSessionClientIdentity(gmIdentity)
    const result = deserializeSessionClientIdentity(serialized)

    expect(result).toEqual({ ok: true, identity: gmIdentity })
    expect(JSON.parse(serialized)).toMatchObject({ role: 'gm', gmKey })
  })

  it('stores only a non-secret GM hint in the cookie value', () => {
    const hint = toSessionClientIdentityCookieHint(gmIdentity)
    const encoded = serializeSessionClientIdentityCookieHint(gmIdentity)
    const decoded = deserializeSessionClientIdentityCookieHint(encoded)

    expect(hint).toEqual({
      schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
      role: 'gm',
      sessionId,
      clientId: gmClientId,
      rememberedAt,
      lastSeenRevision: revision,
    })
    expect(JSON.parse(decodeURIComponent(encoded))).not.toHaveProperty('gmKey')
    expect(decoded).toEqual({ ok: true, identity: hint })
  })

  it('round-trips player identity and cookie hints with display identity', () => {
    expect(validateSessionClientIdentity(playerIdentity)).toEqual({ ok: true, identity: playerIdentity })

    const encoded = serializeSessionClientIdentityCookieHint(playerIdentity)
    expect(deserializeSessionClientIdentityCookieHint(encoded)).toEqual({
      ok: true,
      identity: playerIdentity,
    })
  })

  it('rejects malformed stored identities with stable issue codes', () => {
    const result = validateSessionClientIdentity({
      schemaVersion: 99,
      role: 'player',
      sessionId: 'bad-session',
      clientId: 'client_bad',
      playerId: 'player_bad',
      displayName: '<unsafe>',
      rememberedAt: 'not-a-date',
      lastSeenRevision: -1,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual([
        'unsupported-schema-version',
        'invalid-session-id',
        'invalid-client-id',
        'invalid-remembered-at',
        'invalid-last-seen-revision',
        'invalid-player-id',
        'invalid-display-name',
      ])
    }
  })

  it('rejects cookie hints that contain session secrets', () => {
    const result = validateSessionClientIdentityCookieHint({ ...gmIdentity })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: 'gmKey',
        code: 'secret-in-cookie',
        message: 'session identity cookies must not contain GM keys or join codes',
      })
    }
  })

  it('updates last-seen revision without changing the session-local identity', () => {
    const updatedAt = '2026-05-26T12:05:00.000Z'
    const updated = updateSessionClientIdentityRevision(playerIdentity, revision, updatedAt)

    expect(updated).toEqual({
      ...playerIdentity,
      rememberedAt: updatedAt,
      lastSeenRevision: revision,
    })
  })
})
