import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_PRESENCE_AUTHORITY,
  LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
} from '#shared/livePlayPresence'
import {
  LivePlayPresenceRegistryError,
  createLivePlayPresenceRegistry,
  type LivePlayPresenceRegistryPrincipalContext,
} from '~~/server/livePlay/presenceRegistry'

const update = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  clientSequence: 1,
  selectedTokenId: 'token-pikachu',
  hoveredTokenId: null,
  intent: { kind: 'idle' },
  ping: null,
  ...overrides,
})

const playerPrincipal = (
  overrides: Partial<LivePlayPresenceRegistryPrincipalContext> = {},
): LivePlayPresenceRegistryPrincipalContext => ({
  role: 'player',
  clientId: 'client_abcdef012345',
  profileContextKey: 'profile_private_ash',
  profileDisplayName: ' <Ash\u0000 Ketchum> ',
  ...overrides,
})

describe('live-play presence registry', () => {
  it('stores sanitized, process-local entries keyed by map and principal context', () => {
    const registry = createLivePlayPresenceRegistry({ ttlMs: 5_000 })

    const entry = registry.update({
      mapSlug: 'arena-map',
      principal: playerPrincipal(),
      update: update({
        selectedTokenId: 'token-pikachu',
        hoveredTokenId: 'token-eevee',
        intent: { kind: 'targeting' },
      }),
      now: 1_000,
    })

    expect(entry).toMatchObject({
      clientSequence: 1,
      selectedTokenId: 'token-pikachu',
      hoveredTokenId: 'token-eevee',
      intent: { kind: 'targeting' },
      lastSeenAt: 1_000,
      expiresAt: 6_000,
      participant: {
        role: 'player',
        profileDisplayName: 'Ash Ketchum',
        clientIdSuffix: 'ef012345',
      },
    })
    expect(registry.list({ mapSlug: 'arena-map', now: 1_001 })).toEqual([entry])
    expect(registry.list({ mapSlug: 'other-map', now: 1_001 })).toEqual([])

    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain('profile_private_ash')
    expect(serialized).not.toContain('client_abcdef012345')
    expect(serialized).not.toContain('sheetPayload')
    expect(serialized).not.toContain('commandBody')
  })

  it('refreshes TTL when the same map principal updates presence', () => {
    const registry = createLivePlayPresenceRegistry({ ttlMs: 1_000 })
    const principal = playerPrincipal()

    registry.update({
      mapSlug: 'arena-map',
      principal,
      update: update({ clientSequence: 1, selectedTokenId: 'token-one' }),
      now: 100,
    })
    const refreshed = registry.update({
      mapSlug: 'arena-map',
      principal,
      update: update({ clientSequence: 2, selectedTokenId: 'token-two' }),
      now: 900,
    })

    expect(refreshed).toMatchObject({
      clientSequence: 2,
      selectedTokenId: 'token-two',
      lastSeenAt: 900,
      expiresAt: 1_900,
    })
    expect(registry.list({ mapSlug: 'arena-map', now: 1_100 })).toHaveLength(1)
    expect(registry.list({ mapSlug: 'arena-map', now: 1_100 })[0]?.clientSequence).toBe(2)
  })

  it('expires entries after TTL and prunes expired maps on list or explicit prune', () => {
    const registry = createLivePlayPresenceRegistry({ ttlMs: 100 })

    registry.update({ mapSlug: 'arena-map', principal: playerPrincipal(), update: update(), now: 1_000 })
    registry.update({
      mapSlug: 'arena-map',
      principal: playerPrincipal({ clientId: 'client_other0001', profileContextKey: 'profile_private_misty' }),
      update: update({ clientSequence: 2, selectedTokenId: 'token-misty' }),
      now: 1_050,
    })
    registry.update({
      mapSlug: 'side-map',
      principal: playerPrincipal({ clientId: 'client_brock0001', profileContextKey: 'profile_private_brock' }),
      update: update({ clientSequence: 3, selectedTokenId: 'token-brock' }),
      now: 1_050,
    })

    expect(registry.list({ mapSlug: 'arena-map', now: 1_099 })).toHaveLength(2)
    expect(registry.list({ mapSlug: 'arena-map', now: 1_100 })).toHaveLength(1)
    expect(registry.prune({ now: 1_150 })).toBe(2)
    expect(registry.list({ mapSlug: 'arena-map', now: 1_151 })).toEqual([])
    expect(registry.list({ mapSlug: 'side-map', now: 1_151 })).toEqual([])
  })

  it('removes only the requested map principal context', () => {
    const registry = createLivePlayPresenceRegistry({ ttlMs: 5_000 })
    const ash = playerPrincipal()
    const misty = playerPrincipal({ clientId: 'client_misty0001', profileContextKey: 'profile_private_misty' })

    registry.update({ mapSlug: 'arena-map', principal: ash, update: update({ clientSequence: 1 }), now: 1_000 })
    registry.update({ mapSlug: 'arena-map', principal: misty, update: update({ clientSequence: 2 }), now: 1_000 })
    registry.update({ mapSlug: 'side-map', principal: ash, update: update({ clientSequence: 3 }), now: 1_000 })

    expect(registry.remove({ mapSlug: 'arena-map', principal: ash })).toBe(true)
    expect(registry.remove({ mapSlug: 'arena-map', principal: ash })).toBe(false)
    expect(registry.list({ mapSlug: 'arena-map', now: 1_001 }).map((entry) => entry.clientSequence)).toEqual([2])
    expect(registry.list({ mapSlug: 'side-map', now: 1_001 }).map((entry) => entry.clientSequence)).toEqual([3])
  })

  it('rejects malformed or durable-state-shaped updates without mutating existing presence', () => {
    const registry = createLivePlayPresenceRegistry({ ttlMs: 5_000 })
    const principal = playerPrincipal()

    const previous = registry.update({ mapSlug: 'arena-map', principal, update: update({ clientSequence: 1 }), now: 1_000 })

    expect(() => registry.update({
      mapSlug: 'arena-map',
      principal,
      update: update({
        clientSequence: 2,
        commandBody: { type: 'moveToken', payload: { sheetPayload: { hp: 1 } } },
        sheetDocument: { private: true },
        secret: 'do-not-store',
        intent: { kind: 'targeting', hiddenMove: { name: 'Private Move' } },
      }),
      now: 2_000,
    })).toThrow(LivePlayPresenceRegistryError)

    expect(registry.list({ mapSlug: 'arena-map', now: 2_001 })).toEqual([previous])
    const serialized = JSON.stringify(registry.list({ mapSlug: 'arena-map', now: 2_001 }))
    expect(serialized).not.toContain('do-not-store')
    expect(serialized).not.toContain('sheetDocument')
    expect(serialized).not.toContain('hiddenMove')
  })

  it('keeps the registry process-local with no SQLite or campaign persistence writes', () => {
    const source = readFileSync(join(process.cwd(), 'server/livePlay/presenceRegistry.ts'), 'utf8')

    expect(source).toContain('new Map')
    expect(source).not.toMatch(/from ['"].*server\/storage/)
    expect(source).not.toMatch(/sqlite|SQLite|appendMany|withTransaction|writeFile|saveSetupMap|replaceSetupMap/)
  })
})
