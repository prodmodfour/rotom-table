import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_PRESENCE_ACCENTS,
  LIVE_PLAY_PRESENCE_AUTHORITY,
  LIVE_PLAY_PRESENCE_AUTHORITY_DESCRIPTION,
  LIVE_PLAY_PRESENCE_INTENT_KINDS,
  LIVE_PLAY_PRESENCE_MAX_DISPLAY_NAME_CHARS,
  LIVE_PLAY_PRESENCE_MAX_PING_LABEL_CHARS,
  LIVE_PLAY_PRESENCE_MAX_SNAPSHOT_ENTRIES,
  LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  buildLivePlayPresenceParticipantSummary,
  isLivePlayPresenceAccent,
  isLivePlayPresenceEntry,
  isLivePlayPresenceIntentKind,
  isLivePlayPresenceRole,
  isLivePlayPresenceSnapshot,
  isLivePlayPresenceUpdate,
  isLivePlayPresenceValidationCode,
  livePlayPresenceAccentForKey,
  livePlayPresenceClientIdSuffix,
  parseLivePlayPresenceEntry,
  parseLivePlayPresenceParticipantSummary,
  parseLivePlayPresenceSnapshot,
  parseLivePlayPresenceUpdate,
  sanitizeLivePlayPresenceDisplayName,
  sanitizeLivePlayPresencePingLabel,
} from '#shared/livePlayPresence'

const validUpdate = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  clientSequence: 42,
  selectedTokenId: 'token-pikachu',
  hoveredTokenId: null,
  intent: { kind: 'targeting' },
  ping: {
    id: 'ping_abc123',
    cell: { x: 4, y: 0, z: -2 },
    label: 'Look here',
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_004_000,
  },
  ...overrides,
})

const participant = (overrides: Record<string, unknown> = {}) => ({
  role: 'player',
  profileDisplayName: 'Misty',
  clientIdSuffix: 'c0ffee99',
  accent: 'blue',
  ...overrides,
})

const validEntry = (overrides: Record<string, unknown> = {}) => ({
  ...validUpdate(),
  participant: participant(),
  lastSeenAt: 1_700_000_000_500,
  expiresAt: 1_700_000_015_500,
  ...overrides,
})

const validSnapshot = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  mapSlug: 'arena-map',
  serverTime: 1_700_000_001_000,
  entries: [validEntry()],
  ...overrides,
})

describe('live-play presence contract', () => {
  it('declares an explicitly ephemeral, non-authoritative presence vocabulary', () => {
    expect(LIVE_PLAY_PRESENCE_SCHEMA_VERSION).toBe(1)
    expect(LIVE_PLAY_PRESENCE_AUTHORITY).toBe('ephemeral-presentation')
    expect(LIVE_PLAY_PRESENCE_AUTHORITY_DESCRIPTION).toContain('not an authoritative live-play command')
    expect(LIVE_PLAY_PRESENCE_AUTHORITY_DESCRIPTION).toContain('must not mutate')
    expect(LIVE_PLAY_PRESENCE_INTENT_KINDS).toEqual([
      'idle',
      'moving-token',
      'targeting',
      'measuring',
      'placing-ping',
      'viewing-sheet',
    ])
    expect(LIVE_PLAY_PRESENCE_ACCENTS).toContain('blue')
    expect(isLivePlayPresenceRole('gm')).toBe(true)
    expect(isLivePlayPresenceRole('guest')).toBe(false)
    expect(isLivePlayPresenceIntentKind('measuring')).toBe(true)
    expect(isLivePlayPresenceIntentKind('resolving-move')).toBe(false)
    expect(isLivePlayPresenceAccent('violet')).toBe(true)
    expect(isLivePlayPresenceAccent('#ff00ff')).toBe(false)
    expect(isLivePlayPresenceValidationCode('forbidden-authority-field')).toBe(true)
    expect(isLivePlayPresenceValidationCode('permission-denied')).toBe(false)
  })

  it('round-trips strict presence updates with token attention, intent, pings, and client sequence', () => {
    const update = validUpdate()
    const result = parseLivePlayPresenceUpdate(update)

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected valid update')
    expect(result.payload).toEqual(update)
    expect(result.payload.clientSequence).toBe(42)
    expect(result.payload.selectedTokenId).toBe('token-pikachu')
    expect(result.payload.hoveredTokenId).toBeNull()
    expect(result.payload.intent.kind).toBe('targeting')
    expect(result.payload.ping?.cell).toEqual({ x: 4, y: 0, z: -2 })
    expect(parseLivePlayPresenceUpdate(JSON.parse(JSON.stringify(result.payload)))).toEqual(result)
    expect(isLivePlayPresenceUpdate(result.payload)).toBe(true)
  })

  it('parses display-safe participant summaries and derives redacted suffix/accent helpers', () => {
    const result = parseLivePlayPresenceParticipantSummary({
      role: 'player',
      profileDisplayName: ' <Ash\u0000 Ketchum> ',
      clientIdSuffix: 'facefeed',
      accent: 'green',
    })

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected valid participant')
    expect(result.payload).toEqual({
      role: 'player',
      profileDisplayName: 'Ash Ketchum',
      clientIdSuffix: 'facefeed',
      accent: 'green',
    })
    expect(parseLivePlayPresenceParticipantSummary({
      role: 'gm',
      profileDisplayName: '   ',
      clientIdSuffix: 'gm0001',
      accent: 'amber',
    })).toEqual({
      valid: true,
      payload: { role: 'gm', clientIdSuffix: 'gm0001', accent: 'amber' },
      issues: [],
    })

    expect(sanitizeLivePlayPresenceDisplayName(' <Brock\n Slate> ')).toBe('Brock Slate')
    expect(sanitizeLivePlayPresencePingLabel(' <here\u0007 now> ')).toBe('here now')
    expect(livePlayPresenceClientIdSuffix('client_abcdef012345')).toBe('ef012345')
    expect(livePlayPresenceClientIdSuffix('bad')).toBe('anon')
    expect(livePlayPresenceAccentForKey('client_abcdef012345')).toBe(
      livePlayPresenceAccentForKey('client_abcdef012345'),
    )
    expect(LIVE_PLAY_PRESENCE_ACCENTS).toContain(livePlayPresenceAccentForKey('client_abcdef012345'))
    expect(buildLivePlayPresenceParticipantSummary({
      role: 'player',
      clientId: 'client_abcdef012345',
      profileDisplayName: '<May>',
      accentSeed: 'stable-seed',
    })).toEqual({
      role: 'player',
      profileDisplayName: 'May',
      clientIdSuffix: 'ef012345',
      accent: livePlayPresenceAccentForKey('stable-seed'),
    })
  })

  it('round-trips presence entries and snapshots without durable map or sheet data', () => {
    const entryResult = parseLivePlayPresenceEntry(validEntry())
    expect(entryResult.valid).toBe(true)
    if (!entryResult.valid) throw new Error('expected valid entry')
    expect(entryResult.payload.participant.profileDisplayName).toBe('Misty')
    expect(entryResult.payload.lastSeenAt).toBe(1_700_000_000_500)
    expect(entryResult.payload.expiresAt).toBe(1_700_000_015_500)
    expect(isLivePlayPresenceEntry(entryResult.payload)).toBe(true)

    const snapshotResult = parseLivePlayPresenceSnapshot(validSnapshot())
    expect(snapshotResult.valid).toBe(true)
    if (!snapshotResult.valid) throw new Error('expected valid snapshot')
    expect(snapshotResult.payload.mapSlug).toBe('arena-map')
    expect(snapshotResult.payload.entries).toEqual([entryResult.payload])
    expect(isLivePlayPresenceSnapshot(snapshotResult.payload)).toBe(true)
    expect(JSON.stringify(snapshotResult.payload)).not.toContain('profile_')
    expect(JSON.stringify(snapshotResult.payload)).not.toContain('sheetPayload')
    expect(JSON.stringify(snapshotResult.payload)).not.toContain('payload')
  })

  it('rejects command bodies, sheet payloads, profile identifiers, durable state, and unknown records', () => {
    const result = parseLivePlayPresenceUpdate({
      ...validUpdate(),
      type: 'moveToken',
      opId: 'op_secret0001',
      baseRevision: 7,
      revision: 8,
      scopes: [{ kind: 'token', tokenId: 'token-pikachu' }],
      payload: { placementId: 'token-pikachu', privateSheet: 'do-not-render' },
      sheetPayload: { hp: 1 },
      profileId: 'profile_secret000',
      arbitrary: { nested: 'record' },
      intent: { kind: 'targeting', hiddenMove: { name: 'Secret Move' } },
    })

    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('expected invalid command-shaped presence')
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'type', code: 'forbidden-authority-field' }),
      expect.objectContaining({ path: 'opId', code: 'forbidden-authority-field' }),
      expect.objectContaining({ path: 'baseRevision', code: 'forbidden-authority-field' }),
      expect.objectContaining({ path: 'revision', code: 'forbidden-authority-field' }),
      expect.objectContaining({ path: 'scopes', code: 'forbidden-authority-field' }),
      expect.objectContaining({ path: 'payload', code: 'forbidden-authority-field' }),
      expect.objectContaining({ path: 'sheetPayload', code: 'forbidden-authority-field' }),
      expect.objectContaining({ path: 'profileId', code: 'forbidden-authority-field' }),
      expect.objectContaining({ path: 'arbitrary', code: 'unknown-field' }),
      expect.objectContaining({ path: 'intent.hiddenMove', code: 'unknown-field' }),
    ]))
  })

  it('rejects over-large or malformed strings while dropping blank optional display text', () => {
    const tooLongTokenId = `t${'o'.repeat(96)}`
    const tooLongDisplayName = 'D'.repeat(LIVE_PLAY_PRESENCE_MAX_DISPLAY_NAME_CHARS + 1)
    const tooLongPingLabel = 'P'.repeat(LIVE_PLAY_PRESENCE_MAX_PING_LABEL_CHARS + 1)

    expect(parseLivePlayPresenceUpdate(validUpdate({ selectedTokenId: tooLongTokenId }))).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ path: 'selectedTokenId', code: 'invalid-token-id' })],
    })
    expect(parseLivePlayPresenceUpdate(validUpdate({ selectedTokenId: { id: 'token-pikachu' } }))).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ path: 'selectedTokenId', code: 'invalid-token-id' })],
    })
    expect(parseLivePlayPresenceParticipantSummary(participant({
      clientIdSuffix: 'client_secret0000',
    }))).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ path: '$.clientIdSuffix', code: 'invalid-client-id-suffix' })],
    })
    expect(parseLivePlayPresenceParticipantSummary(participant({
      profileDisplayName: tooLongDisplayName,
    }))).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ path: '$.profileDisplayName', code: 'invalid-display-name' })],
    })
    expect(parseLivePlayPresenceUpdate(validUpdate({
      ping: {
        id: 'ping_abc123',
        cell: { x: 1, y: 0, z: 2 },
        label: tooLongPingLabel,
        createdAt: 10,
        expiresAt: 20,
      },
    }))).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ path: 'ping.label', code: 'invalid-ping' })],
    })
    expect(parseLivePlayPresenceUpdate(validUpdate({
      ping: {
        id: 'ping_abc123',
        cell: { x: 1, y: 0, z: 2, sheet: { slug: 'secret' } },
        label: '<\u0000>',
        createdAt: 20,
        expiresAt: 20,
      },
    }))).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'ping.cell.sheet', code: 'forbidden-authority-field' }),
        expect.objectContaining({ path: 'ping.expiresAt', code: 'invalid-ping' }),
      ]),
    })
  })

  it('bounds snapshots to display-safe map presence entries only', () => {
    const manyEntries = Array.from({ length: LIVE_PLAY_PRESENCE_MAX_SNAPSHOT_ENTRIES + 1 }, (_, index) => validEntry({
      clientSequence: index,
      participant: participant({ clientIdSuffix: `c${String(index).padStart(5, '0')}` }),
    }))

    expect(parseLivePlayPresenceSnapshot(validSnapshot({ mapSlug: 'bad map' }))).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ path: 'mapSlug', code: 'invalid-map-slug' })],
    })
    expect(parseLivePlayPresenceSnapshot(validSnapshot({ entries: manyEntries }))).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ path: 'entries', code: 'too-many-entries' })],
    })
  })
})
