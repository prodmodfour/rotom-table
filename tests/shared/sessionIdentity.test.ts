import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  isClientId,
  isGmKey,
  isJoinCode,
  isPlayerId,
  isSessionDisplayName,
  isSessionId,
  normalizeJoinCodeInput,
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
  sanitizeSessionDisplayName,
  type ClientId,
  type DisplayNameSafeValue,
  type GmKey,
  type JoinCode,
  type PlayerId,
  type SessionDisplayName,
  type SessionId,
} from '#shared/sessionIdentity'

describe('session identity types', () => {
  it('brands validated protocol identifiers', () => {
    const sessionId = parseSessionId('session_abcDEF123_-z')
    const playerId = parsePlayerId('player_p1234567')
    const clientId = parseClientId('client_c1234567')
    const gmKey = parseGmKey('gmkey_abcdefghijklmnopqrstuvwxyzAB')

    expect(sessionId).toBe('session_abcDEF123_-z')
    expect(playerId).toBe('player_p1234567')
    expect(clientId).toBe('client_c1234567')
    expect(gmKey).toBe('gmkey_abcdefghijklmnopqrstuvwxyzAB')

    expectTypeOf(sessionId).toEqualTypeOf<SessionId>()
    expectTypeOf(playerId).toEqualTypeOf<PlayerId>()
    expectTypeOf(clientId).toEqualTypeOf<ClientId>()
    expectTypeOf(gmKey).toEqualTypeOf<GmKey>()
  })

  it('rejects malformed identifiers and non-string values', () => {
    expect(isSessionId('session_short')).toBe(false)
    expect(isSessionId('player_abcDEF123_-z')).toBe(false)
    expect(isPlayerId('player_p1234567')).toBe(true)
    expect(isPlayerId('player_with/slash')).toBe(false)
    expect(isClientId('client_c1234567')).toBe(true)
    expect(isClientId('c-old-realtime')).toBe(false)
    expect(isGmKey('gmkey_abcdefghijklmnopqrstuvwxyzAB')).toBe(true)
    expect(isGmKey('gmkey_too-short')).toBe(false)
    expect(isSessionId(null)).toBe(false)

    expect(() => parseSessionId('session_short')).toThrow('sessionId must match')
    expect(() => parseClientId({ clientId: 'client_c1234567' })).toThrow('clientId must match')
  })

  it('normalizes manually entered join codes without broadening the stored shape', () => {
    const joinCode = parseJoinCode(' abcd-23 ')

    expect(joinCode).toBe('ABCD23')
    expect(normalizeJoinCodeInput('ab cd-23')).toBe('ABCD23')
    expect(isJoinCode(joinCode)).toBe(true)
    expect(isJoinCode('abcd23')).toBe(false)
    expect(isJoinCode('ABC123')).toBe(false)
    expect(isJoinCode('ABCO23')).toBe(false)
    expect(() => parseJoinCode('ABCO23')).toThrow('joinCode must match')

    expectTypeOf(joinCode).toEqualTypeOf<JoinCode>()
  })

  it('sanitizes display names into safe human-readable values', () => {
    const displayName = sanitizeSessionDisplayName('  Ash\n<Ketchum>\t  ')
    const collapsedName = sanitizeSessionDisplayName('Misty\u00A0  Water')
    const fallbackName = sanitizeSessionDisplayName(' \n\t ', 'Guest')
    const clippedName = sanitizeSessionDisplayName('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi')

    expect(displayName).toBe('Ash Ketchum')
    expect(collapsedName).toBe('Misty Water')
    expect(fallbackName).toBe('Guest')
    expect(clippedName).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef')
    expect(Array.from(clippedName)).toHaveLength(32)
    expect(isSessionDisplayName(displayName)).toBe(true)
    expect(isSessionDisplayName(' Ash')).toBe(false)
    expect(isSessionDisplayName('Ash\nKetchum')).toBe(false)
    expect(isSessionDisplayName('')).toBe(false)

    expectTypeOf(displayName).toEqualTypeOf<SessionDisplayName>()
    expectTypeOf(displayName).toEqualTypeOf<DisplayNameSafeValue>()
  })

  it('parses only already-safe display names at protocol boundaries', () => {
    const displayName = parseSessionDisplayName('Brock')

    expect(displayName).toBe('Brock')
    expect(() => parseSessionDisplayName('  Brock')).toThrow('displayName must be')
    expect(() => parseSessionDisplayName('Brock\n')).toThrow('displayName must be')
    expect(() => parseSessionDisplayName('B'.repeat(33))).toThrow('displayName must be')
  })
})
