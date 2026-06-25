import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REALTIME_EVENT_READ_LIMIT,
  MAX_REALTIME_EVENT_JSON_BYTES,
  MAX_REALTIME_EVENT_READ_LIMIT,
  parsePersistedRealtimeEvent,
  parseRealtimeEventAccess,
  parseRealtimeEventCursorValue,
  parseRealtimeEventDraft,
  parseRealtimeEventReadLimit,
} from '#shared/realtimeEventLog'

describe('durable realtime event-log contracts', () => {
  it('parses explicit access descriptors without a permissive default', () => {
    expect(parseRealtimeEventAccess({ kind: 'gm-only' })).toEqual({ kind: 'gm-only' })
    expect(parseRealtimeEventAccess({ kind: 'map-access', mapSlug: 'training-yard' })).toEqual({
      kind: 'map-access',
      mapSlug: 'training-yard',
    })
    expect(parseRealtimeEventAccess({ kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pikachu' })).toEqual({
      kind: 'sheet-access',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
    })

    expect(() => parseRealtimeEventAccess({ kind: 'public' })).toThrow(/kind/)
  })

  it('rejects invalid map and sheet identities', () => {
    expect(() => parseRealtimeEventAccess({ kind: 'map-access', mapSlug: 'Bad Slug' })).toThrow(/mapSlug/)
    expect(() => parseRealtimeEventAccess({ kind: 'sheet-access', sheetKind: 'item', sheetSlug: 'pikachu' })).toThrow(/sheetKind/)
    expect(() => parseRealtimeEventAccess({ kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'Pika Chu' })).toThrow(/sheetSlug/)
  })

  it('validates event drafts and rejects caller-owned sequence or timestamp', () => {
    const draft = {
      channel: 'map:training-yard',
      type: 'live-play-command-accepted',
      revision: 2,
      previousRevision: 1,
      opId: 'op_abcdefgh',
      clientId: 'client-1',
      mapSlug: 'training-yard',
      data: { nested: [{ ok: true }] },
    }

    expect(parseRealtimeEventDraft(draft)).toEqual(draft)
    expect(() => parseRealtimeEventDraft({ ...draft, sequence: 1 })).toThrow(/sequence/)
    expect(() => parseRealtimeEventDraft({ ...draft, timestamp: 1 })).toThrow(/timestamp/)
    expect(() => parseRealtimeEventDraft({ ...draft, revision: -1 })).toThrow(/revision/)
    expect(() => parseRealtimeEventDraft({ ...draft, opId: 'not-an-op' })).toThrow(/opId/)
    expect(() => parseRealtimeEventDraft({ ...draft, channel: '' })).toThrow(/channel/)
    expect(() => parseRealtimeEventDraft({ ...draft, type: ' '.repeat(2) })).toThrow(/type/)
  })

  it('rejects non-JSON, circular, sparse, non-finite and oversized payloads', () => {
    const base = { channel: 'maps', type: 'updated' }
    const circular: Record<string, unknown> = { channel: 'maps', type: 'updated' }
    circular.data = circular
    const sparse = [] as unknown[]
    sparse[1] = 'hole'

    expect(() => parseRealtimeEventDraft({ ...base, data: () => undefined })).toThrow(/function/)
    expect(() => parseRealtimeEventDraft({ ...base, data: Symbol('event') })).toThrow(/symbol/)
    expect(() => parseRealtimeEventDraft({ ...base, data: 1n })).toThrow(/bigint/)
    expect(() => parseRealtimeEventDraft({ ...base, data: Number.NaN })).toThrow(/non-finite/)
    expect(() => parseRealtimeEventDraft({ ...base, data: sparse })).toThrow(/sparse/)
    expect(() => parseRealtimeEventDraft(circular)).toThrow(/circular/)
    expect(() => parseRealtimeEventDraft({ ...base, data: 'x'.repeat(MAX_REALTIME_EVENT_JSON_BYTES + 1) })).toThrow(/at most/)
  })

  it('returns detached parsed records', () => {
    const input = {
      sequence: 1,
      dedupeKey: 'dedupe-key',
      access: { kind: 'map-access', mapSlug: 'training-yard' },
      event: {
        channel: 'map:training-yard',
        type: 'updated',
        sequence: 1,
        timestamp: 10,
        data: { nested: [{ value: 1 }] },
      },
    }

    const parsed = parsePersistedRealtimeEvent(input)
    ;(input.event.data.nested[0] as { value: number }).value = 2

    expect(parsed.event.data).toEqual({ nested: [{ value: 1 }] })
    expect(parsed).toEqual({
      sequence: 1,
      dedupeKey: 'dedupe-key',
      access: { kind: 'map-access', mapSlug: 'training-yard' },
      event: {
        channel: 'map:training-yard',
        type: 'updated',
        sequence: 1,
        timestamp: 10,
        data: { nested: [{ value: 1 }] },
      },
    })
  })

  it('validates cursor values and read limits', () => {
    expect(parseRealtimeEventCursorValue(0)).toBe(0)
    expect(parseRealtimeEventReadLimit()).toBe(DEFAULT_REALTIME_EVENT_READ_LIMIT)
    expect(parseRealtimeEventReadLimit(MAX_REALTIME_EVENT_READ_LIMIT)).toBe(MAX_REALTIME_EVENT_READ_LIMIT)

    expect(() => parseRealtimeEventCursorValue(-1)).toThrow(/safe non-negative/)
    expect(() => parseRealtimeEventReadLimit(0)).toThrow(/at least 1/)
    expect(() => parseRealtimeEventReadLimit(MAX_REALTIME_EVENT_READ_LIMIT + 1)).toThrow(/at most/)
  })
})
