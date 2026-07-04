import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_PRESENCE_AUTHORITY,
  LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  type LivePlayPresenceEntry,
} from '#shared/livePlayPresence'
import { buildMapTokenRemoteAttention } from '~/utils/mapPresenceTokenAttention'

const presenceEntry = (overrides: Partial<LivePlayPresenceEntry> = {}): LivePlayPresenceEntry => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  clientSequence: 1,
  selectedTokenId: null,
  hoveredTokenId: null,
  intent: { kind: 'idle' },
  ping: null,
  participant: {
    role: 'player',
    profileDisplayName: 'Ash',
    clientIdSuffix: 'facefeed',
    accent: 'blue',
  },
  lastSeenAt: 10_000,
  expiresAt: 25_000,
  ...overrides,
})

describe('map presence token attention', () => {
  it('aggregates selected and hovered token attention by visible token', () => {
    const attention = buildMapTokenRemoteAttention([
      presenceEntry({ selectedTokenId: 'token-pikachu', hoveredTokenId: 'token-eevee' }),
      presenceEntry({
        selectedTokenId: 'token-pikachu',
        participant: {
          role: 'gm',
          clientIdSuffix: 'gm000001',
          accent: 'violet',
        },
      }),
    ], new Set(['token-pikachu', 'token-eevee']))

    expect(attention).toEqual([
      expect.objectContaining({
        tokenId: 'token-eevee',
        selectedCount: 0,
        hoveredCount: 1,
        totalCount: 1,
        accents: ['blue'],
        primaryColor: '#60a5fa',
      }),
      expect.objectContaining({
        tokenId: 'token-pikachu',
        selectedCount: 2,
        hoveredCount: 0,
        totalCount: 2,
        accents: ['blue', 'violet'],
        primaryColor: '#60a5fa',
      }),
    ])
  })

  it('drops token attention for tokens outside the current visible map view', () => {
    const attention = buildMapTokenRemoteAttention([
      presenceEntry({ selectedTokenId: 'token-visible', hoveredTokenId: 'token-hidden' }),
    ], new Set(['token-visible']))

    expect(attention).toEqual([
      expect.objectContaining({
        tokenId: 'token-visible',
        selectedCount: 1,
        hoveredCount: 0,
        totalCount: 1,
      }),
    ])
  })

  it('counts one participant once when they select and hover the same token', () => {
    const attention = buildMapTokenRemoteAttention([
      presenceEntry({ selectedTokenId: 'token-pikachu', hoveredTokenId: 'token-pikachu' }),
    ])

    expect(attention).toEqual([
      expect.objectContaining({
        tokenId: 'token-pikachu',
        selectedCount: 1,
        hoveredCount: 1,
        totalCount: 1,
      }),
    ])
  })
})
