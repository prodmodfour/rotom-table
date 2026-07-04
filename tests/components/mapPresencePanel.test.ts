/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MapPresencePanel from '~/components/map/MapPresencePanel.vue'
import {
  LIVE_PLAY_PRESENCE_AUTHORITY,
  LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  type LivePlayPresenceEntry,
} from '#shared/livePlayPresence'

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

describe('MapPresencePanel', () => {
  it('renders an empty state when no participants are present', () => {
    const wrapper = mount(MapPresencePanel, {
      props: { entries: [], nowMs: 12_000 },
    })

    expect(wrapper.text()).toContain('At table')
    expect(wrapper.text()).toContain('0 here')
    expect(wrapper.text()).toContain('Waiting for table presence.')
  })

  it('renders one display-safe connected participant with role, accent, freshness, and intent', () => {
    const wrapper = mount(MapPresencePanel, {
      props: {
        nowMs: 12_000,
        entries: [presenceEntry({ intent: { kind: 'targeting' } })],
      },
    })

    const text = wrapper.text()
    expect(text).toContain('1 here')
    expect(text).toContain('Ash')
    expect(text).toContain('Player · tab facefeed')
    expect(text).toContain('Targeting')
    expect(text).toContain('Fresh · 2s ago')
    expect(wrapper.find('[data-presence-freshness="fresh"]').exists()).toBe(true)
  })

  it('renders multiple participants and visually distinguishes stale entries before expiry', () => {
    const wrapper = mount(MapPresencePanel, {
      props: {
        nowMs: 22_000,
        entries: [
          presenceEntry({
            participant: {
              role: 'gm',
              clientIdSuffix: 'gm000001',
              accent: 'violet',
            },
            intent: { kind: 'measuring' },
            lastSeenAt: 21_500,
            expiresAt: 36_500,
          }),
          presenceEntry({
            participant: {
              role: 'player',
              profileDisplayName: 'Misty',
              clientIdSuffix: 'misty999',
              accent: 'cyan',
            },
            intent: { kind: 'viewing-sheet' },
            lastSeenAt: 10_000,
            expiresAt: 24_000,
          }),
        ],
      },
    })

    const text = wrapper.text()
    expect(text).toContain('2 here')
    expect(text).toContain('GM')
    expect(text).toContain('Measuring')
    expect(text).toContain('Misty')
    expect(text).toContain('Viewing sheet')
    expect(wrapper.find('[data-presence-freshness="fresh"]').exists()).toBe(true)
    expect(wrapper.find('[data-presence-freshness="stale"]').exists()).toBe(true)
    expect(wrapper.find('[data-presence-freshness="stale"]').text()).toContain('Stale')
  })

  it('does not render raw profile ids, command bodies, sheet payloads, or token ids', () => {
    const unsafeEntry = presenceEntry({
      selectedTokenId: 'token-secret-pikachu',
      hoveredTokenId: 'token-secret-eevee',
      participant: {
        role: 'player',
        profileDisplayName: 'Brock',
        clientIdSuffix: 'safe9999',
        accent: 'amber',
      },
    }) as LivePlayPresenceEntry & Record<string, unknown>
    unsafeEntry.profileId = 'profile_secret_raw_id'
    unsafeEntry.commandBody = { type: 'moveToken', note: 'command body private data' }
    unsafeEntry.sheetPayload = { privateNote: 'hidden sheet payload' }

    const wrapper = mount(MapPresencePanel, {
      props: { entries: [unsafeEntry], nowMs: 12_000 },
    })
    const text = wrapper.text()

    expect(text).toContain('Brock')
    expect(text).toContain('Player · tab safe9999')
    expect(text).not.toContain('profile_secret_raw_id')
    expect(text).not.toContain('command body private data')
    expect(text).not.toContain('hidden sheet payload')
    expect(text).not.toContain('token-secret-pikachu')
    expect(text).not.toContain('token-secret-eevee')
  })
})
