import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_PRESENCE_ACCENTS,
  LIVE_PLAY_PRESENCE_AUTHORITY,
  LIVE_PLAY_PRESENCE_AUTHORITY_DESCRIPTION,
  LIVE_PLAY_PRESENCE_DEFAULT_PING_TTL_MS,
  LIVE_PLAY_PRESENCE_INTENT_KINDS,
  LIVE_PLAY_PRESENCE_MAX_DISPLAY_NAME_CHARS,
  LIVE_PLAY_PRESENCE_MAX_INTENT_AREA_CELLS,
  LIVE_PLAY_PRESENCE_MAX_INTENT_COUNT,
  LIVE_PLAY_PRESENCE_MAX_PING_LABEL_CHARS,
  LIVE_PLAY_PRESENCE_MAX_PING_TTL_MS,
  LIVE_PLAY_PRESENCE_MAX_SNAPSHOT_ENTRIES,
  LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE,
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
  parseLivePlayPresenceRealtimeEvent,
  parseLivePlayPresenceRealtimeEventDraft,
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
  intent: {
    kind: 'targeting',
    sourceTokenId: 'token-pikachu',
    candidateCount: 3,
    targetCount: 1,
    cell: { x: 4, y: 0, z: -2 },
    area: { cellCount: 6 },
  },
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
    expect(LIVE_PLAY_PRESENCE_DEFAULT_PING_TTL_MS).toBe(4_000)
    expect(LIVE_PLAY_PRESENCE_MAX_PING_TTL_MS).toBe(8_000)
    expect(LIVE_PLAY_PRESENCE_MAX_INTENT_COUNT).toBe(256)
    expect(LIVE_PLAY_PRESENCE_MAX_INTENT_AREA_CELLS).toBe(512)
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
    expect(result.payload.intent).toMatchObject({
      kind: 'targeting',
      sourceTokenId: 'token-pikachu',
      candidateCount: 3,
      targetCount: 1,
      cell: { x: 4, y: 0, z: -2 },
      area: { cellCount: 6 },
    })
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

  it('round-trips unsequenced realtime presence snapshots without durable replay fields', () => {
    const draft = {
      channel: 'map:arena-map',
      type: LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE,
      mapSlug: 'arena-map',
      data: validSnapshot(),
    }

    const draftResult = parseLivePlayPresenceRealtimeEventDraft(draft)
    expect(draftResult.valid).toBe(true)
    if (!draftResult.valid) throw new Error('expected valid realtime draft')
    expect(draftResult.payload).toEqual(draft)
    expect(JSON.stringify(draftResult.payload)).not.toContain('sequence')
    expect(JSON.stringify(draftResult.payload)).not.toContain('previousRevision')

    const eventResult = parseLivePlayPresenceRealtimeEvent({ ...draft, timestamp: 1_700_000_002_000 })
    expect(eventResult.valid).toBe(true)
    if (!eventResult.valid) throw new Error('expected valid realtime event')
    expect(eventResult.payload.timestamp).toBe(1_700_000_002_000)

    expect(parseLivePlayPresenceRealtimeEvent({
      ...draft,
      channel: 'map:other-map',
      sequence: 12,
      revision: 8,
      commandBody: { type: 'moveToken' },
      timestamp: 1_700_000_002_000,
    })).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'sequence', code: 'forbidden-authority-field' }),
        expect.objectContaining({ path: 'revision', code: 'forbidden-authority-field' }),
        expect.objectContaining({ path: 'commandBody', code: 'forbidden-authority-field' }),
        expect.objectContaining({ path: 'channel', code: 'invalid-realtime-event' }),
      ]),
    })
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
      intent: {
        kind: 'targeting',
        sourceTokenId: 'token-pikachu',
        moveName: 'Secret Move',
        targetIds: ['token-hidden'],
        hiddenMove: { name: 'Secret Move' },
      },
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
      expect.objectContaining({ path: 'intent.moveName', code: 'forbidden-authority-field' }),
      expect.objectContaining({ path: 'intent.targetIds', code: 'forbidden-authority-field' }),
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
    expect(parseLivePlayPresenceUpdate(validUpdate({
      ping: {
        id: 'ping_abc123',
        cell: { x: 1, y: 0, z: 2 },
        createdAt: 20,
        expiresAt: 20 + LIVE_PLAY_PRESENCE_MAX_PING_TTL_MS + 1,
      },
    }))).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ path: 'ping.expiresAt', code: 'invalid-ping' })],
    })
    expect(parseLivePlayPresenceUpdate(validUpdate({
      intent: {
        kind: 'targeting',
        sourceTokenId: { id: 'token-pikachu' },
        candidateCount: LIVE_PLAY_PRESENCE_MAX_INTENT_COUNT + 1,
        area: { cellCount: LIVE_PLAY_PRESENCE_MAX_INTENT_AREA_CELLS + 1 },
      },
    }))).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'intent.sourceTokenId', code: 'invalid-token-id' }),
        expect.objectContaining({ path: 'intent.candidateCount', code: 'invalid-intent' }),
        expect.objectContaining({ path: 'intent.area.cellCount', code: 'invalid-intent' }),
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
