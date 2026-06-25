import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  REALTIME_REPLAY_QUERY_PARAMETER,
  isRealtimeReplayControlMessage,
  parseRealtimeConnectionRequest,
  parseRealtimeReplayControlMessage,
  parseRealtimeStreamPayload,
  resolveRealtimeReplayCursorRequest,
} from '#shared/realtimeReplay'

const caughtUpControl = () => ({
  kind: 'realtime-control',
  type: 'replay-caught-up',
  requestedAfterSequence: 4,
  earliestAvailableSequence: 1,
  latestSequence: 8,
  replayedThroughSequence: 8,
} as const)

const gapControl = () => ({
  kind: 'realtime-control',
  type: 'reconcile-required',
  reason: 'gap',
  requestedAfterSequence: 3,
  earliestAvailableSequence: 5,
  latestSequence: 10,
} as const)

const aheadControl = () => ({
  kind: 'realtime-control',
  type: 'reconcile-required',
  reason: 'ahead',
  requestedAfterSequence: 11,
  earliestAvailableSequence: 1,
  latestSequence: 10,
} as const)

describe('realtime replay cursor contracts', () => {
  it('parses Last-Event-ID cursors', () => {
    expect(resolveRealtimeReplayCursorRequest({ lastEventId: '42' })).toEqual({
      afterSequence: 42,
      source: 'last-event-id',
    })
  })

  it('parses query cursors', () => {
    expect(resolveRealtimeReplayCursorRequest({ after: '7' })).toEqual({
      afterSequence: 7,
      source: 'query',
    })
    expect(REALTIME_REPLAY_QUERY_PARAMETER).toBe('after')
  })

  it('lets Last-Event-ID take precedence over the original query cursor', () => {
    expect(resolveRealtimeReplayCursorRequest({ lastEventId: '9', after: '3' })).toEqual({
      afterSequence: 9,
      source: 'last-event-id',
    })
  })

  it('returns no cursor for absent values', () => {
    expect(resolveRealtimeReplayCursorRequest({})).toEqual({ afterSequence: null, source: 'none' })
    expect(resolveRealtimeReplayCursorRequest({ lastEventId: null, after: undefined })).toEqual({
      afterSequence: null,
      source: 'none',
    })
  })

  it('rejects negative, fractional and unsafe cursors', () => {
    for (const value of ['-1', '1.5', `${Number.MAX_SAFE_INTEGER + 1}`]) {
      expect(() => resolveRealtimeReplayCursorRequest({ lastEventId: value })).toThrow(/cursor|safe/)
      expect(() => resolveRealtimeReplayCursorRequest({ after: value })).toThrow(/cursor|safe/)
    }
  })

  it('rejects multiple, empty, control-character, and unsupported query cursor formats', () => {
    expect(() => resolveRealtimeReplayCursorRequest({ after: ['1', '2'] })).toThrow(/at most once/)
    expect(() => resolveRealtimeReplayCursorRequest({ after: '' })).toThrow(/empty/)
    expect(() => resolveRealtimeReplayCursorRequest({ after: '1\n' })).toThrow(/control/)
    expect(() => resolveRealtimeReplayCursorRequest({ after: '01' })).toThrow(/base-10/)
    expect(() => resolveRealtimeReplayCursorRequest({ after: '1e2' })).toThrow(/base-10/)
  })

  it('does not mutate cursor input values', () => {
    const input = { lastEventId: '', after: ['5'] }
    const before = structuredClone(input)

    expect(resolveRealtimeReplayCursorRequest(input)).toEqual({ afterSequence: 5, source: 'query' })
    expect(input).toEqual(before)
  })

  it('parses future connection requests without resolving auth or profiles', () => {
    expect(parseRealtimeConnectionRequest({
      lastEventId: '12',
      after: '3',
      profileId: 'profile_ash00000',
    })).toEqual({
      cursor: { afterSequence: 12, source: 'last-event-id' },
      profileId: 'profile_ash00000',
    })
    expect(parseRealtimeConnectionRequest({})).toEqual({
      cursor: { afterSequence: null, source: 'none' },
      profileId: null,
    })
    expect(() => parseRealtimeConnectionRequest({ profileId: ['profile_ash00000'] })).toThrow(/profileId/)
    expect(() => parseRealtimeConnectionRequest({ profileId: 'not-a-profile' })).toThrow(/profileId/)
  })
})

describe('realtime replay control-message contracts', () => {
  it('parses caught-up control messages', () => {
    expect(parseRealtimeReplayControlMessage(caughtUpControl())).toEqual(caughtUpControl())
    expect(isRealtimeReplayControlMessage(caughtUpControl())).toBe(true)
  })

  it('parses gap reconcile control messages', () => {
    expect(parseRealtimeReplayControlMessage(gapControl())).toEqual(gapControl())
  })

  it('parses ahead reconcile control messages', () => {
    expect(parseRealtimeReplayControlMessage(aheadControl())).toEqual(aheadControl())
  })

  it('rejects invalid cursor-state invariants', () => {
    expect(() => parseRealtimeReplayControlMessage({
      ...caughtUpControl(),
      replayedThroughSequence: 9,
    })).toThrow(/replayedThroughSequence/)
    expect(() => parseRealtimeReplayControlMessage({
      ...caughtUpControl(),
      requestedAfterSequence: 20,
    })).toThrow(/ahead/)
    expect(() => parseRealtimeReplayControlMessage({
      ...caughtUpControl(),
      earliestAvailableSequence: 10,
    })).toThrow(/earliest/)
    expect(() => parseRealtimeReplayControlMessage({
      ...gapControl(),
      requestedAfterSequence: 4,
    })).toThrow(/gap/)
    expect(() => parseRealtimeReplayControlMessage({
      ...aheadControl(),
      requestedAfterSequence: 10,
    })).toThrow(/ahead/)
  })

  it('rejects unknown fields and campaign payload fields', () => {
    expect(() => parseRealtimeReplayControlMessage({
      ...caughtUpControl(),
      extra: true,
    })).toThrow(/extra/)
    expect(() => parseRealtimeReplayControlMessage({
      ...caughtUpControl(),
      access: { kind: 'gm-only' },
    })).toThrow(/access/)
    expect(() => parseRealtimeReplayControlMessage({
      ...caughtUpControl(),
      data: { mapSlug: 'arena' },
    })).toThrow(/data/)
    expect(() => parseRealtimeReplayControlMessage({
      ...caughtUpControl(),
      payload: { sheetSlug: 'pikachu' },
    })).toThrow(/payload/)
  })

  it('requires exact discriminators', () => {
    expect(() => parseRealtimeReplayControlMessage({ ...caughtUpControl(), kind: 'event' })).toThrow(/kind/)
    expect(() => parseRealtimeReplayControlMessage({ ...caughtUpControl(), type: 'caught-up' })).toThrow(/type/)
    expect(isRealtimeReplayControlMessage({ ...caughtUpControl(), type: 'caught-up' })).toBe(false)
  })

  it('returns detached control-message values', () => {
    const input: {
      kind: 'realtime-control'
      type: 'replay-caught-up'
      requestedAfterSequence: number
      earliestAvailableSequence: number
      latestSequence: number
      replayedThroughSequence: number
    } = { ...caughtUpControl() }
    const parsed = parseRealtimeReplayControlMessage(input)
    input.latestSequence = 99

    expect(parsed).not.toBe(input)
    expect(parsed).toEqual(caughtUpControl())
  })

  it('parses sequenced events and controls as one stream-payload union', () => {
    expect(parseRealtimeStreamPayload(caughtUpControl())).toEqual(caughtUpControl())
    expect(parseRealtimeStreamPayload({
      channel: 'maps',
      type: 'updated',
      sequence: 1,
      timestamp: 100,
    })).toEqual({
      channel: 'maps',
      type: 'updated',
      sequence: 1,
      timestamp: 100,
    })
  })
})

describe('realtime replay architecture boundaries', () => {
  it('keeps the shared protocol free of server and client framework imports', () => {
    const source = readFileSync('shared/realtimeReplay.ts', 'utf8')

    expect(source).not.toMatch(/from ['"]h3['"]|from ['"]vue['"]|from ['"]node:/)
    expect(source).not.toMatch(/server\/|src\/composables|useRealtime|sseStream|sqlite/i)
  })
})
