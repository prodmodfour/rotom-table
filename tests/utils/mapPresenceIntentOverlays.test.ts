import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_PRESENCE_AUTHORITY,
  LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  type LivePlayPresenceEntry,
  type LivePlayPresenceUpdate,
} from '#shared/livePlayPresence'
import { buildMapPresenceIntentOverlays } from '~/utils/mapPresenceIntentOverlays'

const presenceEntry = (overrides: Partial<LivePlayPresenceEntry> = {}): LivePlayPresenceEntry => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  clientSequence: 4,
  selectedTokenId: null,
  hoveredTokenId: null,
  intent: { kind: 'idle' },
  ping: null,
  participant: {
    role: 'player',
    profileDisplayName: 'Misty',
    clientIdSuffix: 'abcd1234',
    accent: 'cyan',
  },
  lastSeenAt: 10_000,
  expiresAt: 30_000,
  ...overrides,
})

const ownPresence = (overrides: Partial<LivePlayPresenceUpdate> = {}): LivePlayPresenceUpdate => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  clientSequence: 9,
  selectedTokenId: null,
  hoveredTokenId: null,
  intent: { kind: 'idle' },
  ping: null,
  ...overrides,
})

describe('map presence intent overlays', () => {
  it('builds low-noise targeting and movement overlays from display-safe presence summaries', () => {
    const overlays = buildMapPresenceIntentOverlays([
      presenceEntry({
        intent: {
          kind: 'targeting',
          sourceTokenId: 'token-staryu',
          targetCount: 2,
          candidateCount: 5,
          cell: { x: 4, y: 0, z: 6 },
          area: { cellCount: 9 },
        },
      }),
      presenceEntry({
        clientSequence: 5,
        participant: { role: 'gm', clientIdSuffix: 'facefeed', accent: 'violet' },
        intent: { kind: 'moving-token', sourceTokenId: 'token-eevee' },
      }),
    ], {
      visibleTokenIds: new Set(['token-staryu', 'token-eevee']),
      serverNowMs: 12_000,
    })

    expect(overlays).toEqual([
      expect.objectContaining({
        kind: 'targeting',
        label: 'Targeting',
        detail: '2 targets · 9 cells',
        participantLabel: 'Misty',
        anchor: { kind: 'cell', cell: { x: 4, y: 0, z: 6 } },
        accentColor: '#22d3ee',
        stackIndex: 0,
      }),
      expect.objectContaining({
        kind: 'moving-token',
        label: 'Moving',
        detail: 'previewing a route',
        participantLabel: 'GM',
        anchor: { kind: 'token', tokenId: 'token-eevee' },
        accentColor: '#a78bfa',
        stackIndex: 0,
      }),
    ])
    expect(JSON.stringify(overlays)).not.toContain('targetIds')
    expect(JSON.stringify(overlays)).not.toContain('sheet')
    expect(JSON.stringify(overlays)).not.toContain('command')
  })

  it('drops hidden token anchors, stale entries, cancelled idle intent, and own-client intent', () => {
    const visible = presenceEntry({
      clientSequence: 11,
      intent: { kind: 'measuring', sourceTokenId: 'token-visible', candidateCount: 3 },
    })
    const overlays = buildMapPresenceIntentOverlays([
      visible,
      presenceEntry({
        clientSequence: 12,
        intent: { kind: 'targeting', sourceTokenId: 'token-hidden', candidateCount: 1 },
      }),
      presenceEntry({ clientSequence: 13, intent: { kind: 'idle' } }),
      presenceEntry({ clientSequence: 14, lastSeenAt: 1_000, intent: { kind: 'targeting', sourceTokenId: 'token-visible' } }),
      presenceEntry({
        clientSequence: 15,
        participant: { role: 'player', profileDisplayName: 'Self', clientIdSuffix: 'self1234', accent: 'blue' },
        intent: { kind: 'targeting', sourceTokenId: 'token-visible' },
      }),
    ], {
      visibleTokenIds: new Set(['token-visible']),
      ownClientIdSuffix: 'self1234',
      serverNowMs: 14_000,
      staleAfterMs: 4_000,
    })

    expect(overlays).toEqual([
      expect.objectContaining({
        id: expect.stringContaining('measuring'),
        kind: 'measuring',
        detail: '3 options',
        anchor: { kind: 'token', tokenId: 'token-visible' },
      }),
    ])
    expect(JSON.stringify(overlays)).not.toContain('token-hidden')
    expect(JSON.stringify(overlays)).not.toContain('self1234')
  })

  it('suppresses the echoed own presence update when the client suffix is unavailable', () => {
    const own = ownPresence({
      clientSequence: 21,
      selectedTokenId: 'token-pikachu',
      intent: { kind: 'targeting', sourceTokenId: 'token-pikachu', targetCount: 1 },
    })

    const overlays = buildMapPresenceIntentOverlays([
      presenceEntry({
        clientSequence: 21,
        selectedTokenId: 'token-pikachu',
        intent: { kind: 'targeting', sourceTokenId: 'token-pikachu', targetCount: 1 },
      }),
    ], {
      visibleTokenIds: new Set(['token-pikachu']),
      ownPresence: own,
      serverNowMs: 12_000,
    })

    expect(overlays).toEqual([])
  })
})
