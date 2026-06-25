import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_COMMAND_SCHEMA_VERSION, LIVE_PLAY_COMMAND_TYPES, type LivePlayCommandEnvelope } from '#shared/livePlayCommands'
import { sheetsChannel } from '#shared/realtime'
import { MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH } from '#shared/realtimeEventLog'
import {
  livePlaySheetUpdateRealtimeAppendInputs,
  livePlaySheetUpdateRealtimeDedupeKey,
  type AuthoritativeLivePlaySheetUpdate,
} from '~~/server/livePlay/sheetUpdateRealtime'

const command = (opId = 'op_sheetrt001'): LivePlayCommandEnvelope & { readonly clientId?: string } => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId,
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
  scopes: [{ kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'hp' }],
  payload: { placementId: 'token-1', currentHp: 10 },
  clientId: 'command-client',
})

const update = (
  kind: AuthoritativeLivePlaySheetUpdate['kind'],
  slug: string,
  sheet: Record<string, unknown>,
): AuthoritativeLivePlaySheetUpdate => ({ kind, slug, sheet })

describe('live-play sheet update realtime append inputs', () => {
  it('creates deterministic sheet-specific and global sheet-access events with complete detached sheets', () => {
    const sheet = { slug: 'pikachu', revision: 7, updatedAt: 1234, hp: { current: 10 }, moves: ['Quick Attack'] }
    const inputs = livePlaySheetUpdateRealtimeAppendInputs({
      command: command(),
      updates: [update('pokemon', 'pikachu', sheet)],
      clientId: 'actor-client',
    })

    expect(inputs).toHaveLength(2)
    expect(inputs[0]).toMatchObject({
      event: {
        channel: 'sheet:pokemon:pikachu',
        type: 'updated',
        clientId: 'actor-client',
        data: { kind: 'pokemon', slug: 'pikachu', sheet },
      },
      access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
    })
    expect(inputs[1]).toMatchObject({
      event: {
        channel: sheetsChannel,
        type: 'updated',
        clientId: 'actor-client',
        data: { kind: 'pokemon', slug: 'pikachu', sheet },
      },
      access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
    })
    expect(inputs[0]?.event).not.toHaveProperty('sequence')
    expect(inputs[0]?.event).not.toHaveProperty('timestamp')
    expect((inputs[0]?.event.data as { sheet: unknown }).sheet).not.toBe(sheet)
    expect(inputs[0]?.dedupeKey).not.toEqual(inputs[1]?.dedupeKey)
    expect(inputs[0]?.dedupeKey?.length).toBeLessThanOrEqual(MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH)
  })

  it('orders by sheet kind, slug, and destination independent of input order', () => {
    const inputs = livePlaySheetUpdateRealtimeAppendInputs({
      command: command('op_sheetrt002'),
      updates: [
        update('trainer', 'brock', { slug: 'brock', revision: 2, updatedAt: 20 }),
        update('pokemon', 'zubat', { slug: 'zubat', revision: 2, updatedAt: 20 }),
        update('pokemon', 'abra', { slug: 'abra', revision: 2, updatedAt: 20 }),
      ],
    })

    expect(inputs.map((input) => input.event.channel)).toEqual([
      'sheet:pokemon:abra',
      'sheets',
      'sheet:pokemon:zubat',
      'sheets',
      'sheet:trainer:brock',
      'sheets',
    ])
  })

  it('uses deterministic distinct dedupe keys for command, sheet identity, and destination', () => {
    const specific = livePlaySheetUpdateRealtimeDedupeKey({
      mapSlug: 'arena',
      opId: 'op_sheetrt003',
      kind: 'pokemon',
      slug: 'pikachu',
      destination: 'specific',
    })
    const global = livePlaySheetUpdateRealtimeDedupeKey({
      mapSlug: 'arena',
      opId: 'op_sheetrt003',
      kind: 'pokemon',
      slug: 'pikachu',
      destination: 'global',
    })
    expect(specific).toBe(livePlaySheetUpdateRealtimeDedupeKey({
      mapSlug: 'arena',
      opId: 'op_sheetrt003',
      kind: 'pokemon',
      slug: 'pikachu',
      destination: 'specific',
    }))
    expect(specific).not.toBe(global)
    expect(specific).not.toBe(livePlaySheetUpdateRealtimeDedupeKey({
      mapSlug: 'arena',
      opId: 'op_sheetrt003',
      kind: 'pokemon',
      slug: 'eevee',
      destination: 'specific',
    }))
  })

  it('deduplicates semantically identical duplicate sheets and rejects divergent duplicates', () => {
    const identical = livePlaySheetUpdateRealtimeAppendInputs({
      command: command('op_sheetrt004'),
      updates: [
        update('pokemon', 'pikachu', { slug: 'pikachu', revision: 1, updatedAt: 10, a: 1, b: 2 }),
        update('pokemon', 'pikachu', { b: 2, updatedAt: 10, revision: 1, slug: 'pikachu', a: 1 }),
      ],
    })
    expect(identical).toHaveLength(2)

    expect(() => livePlaySheetUpdateRealtimeAppendInputs({
      command: command('op_sheetrt005'),
      updates: [
        update('pokemon', 'pikachu', { slug: 'pikachu', revision: 1, updatedAt: 10, hp: 10 }),
        update('pokemon', 'pikachu', { slug: 'pikachu', revision: 1, updatedAt: 10, hp: 11 }),
      ],
    })).toThrow(/Divergent authoritative live-play sheet documents/)
  })

  it('validates authoritative sheet identity and JSON-safe revisioned documents without mutating inputs', () => {
    const sheet = { slug: 'pikachu', revision: 1, updatedAt: 10, nested: { hp: 10 } }
    const before = JSON.stringify(sheet)
    expect(() => livePlaySheetUpdateRealtimeAppendInputs({
      command: command('op_sheetrt006'),
      updates: [update('pokemon', 'eevee', sheet)],
    })).toThrow(/sheet\.slug/)
    expect(() => livePlaySheetUpdateRealtimeAppendInputs({
      command: command('op_sheetrt007'),
      updates: [update('pokemon', 'pikachu', { slug: 'pikachu', revision: -1, updatedAt: 10 })],
    })).toThrow(/revision/)
    expect(() => livePlaySheetUpdateRealtimeAppendInputs({
      command: command('op_sheetrt008'),
      updates: [update('pokemon', 'pikachu', { slug: 'pikachu', revision: 1, updatedAt: Number.NaN })],
    })).toThrow(/updatedAt/)
    expect(() => livePlaySheetUpdateRealtimeAppendInputs({
      command: command('op_sheetrt009'),
      updates: [update('pokemon', 'pikachu', { slug: 'pikachu', revision: 1, updatedAt: 10, bad: undefined })],
    })).toThrow(/JSON-serializable/)
    expect(JSON.stringify(sheet)).toBe(before)
  })
})
