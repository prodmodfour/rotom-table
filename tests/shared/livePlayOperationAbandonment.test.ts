import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  createLivePlayRejectedResult,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
  parseLivePlayOperationAbandonmentResponse,
} from '#shared/livePlayOperationAbandonment'

const opId = 'op_abandon001'
const mapSlug = 'arena-map'

const acceptedResult = () => createLivePlayAcceptedResult({
  opId,
  mapSlug,
  previousRevision: 4,
  revision: 5,
  patches: [{
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
    mapSlug,
    revision: 5,
    scopes: [{ kind: 'token', placementId: 'token-1', field: 'position' }],
    payload: { placementId: 'token-1', position: { x: 2, y: 0, z: 1 } },
  }],
})

const rejectedResult = () => createLivePlayRejectedResult({
  opId,
  mapSlug,
  reason: 'stale-revision',
  message: 'Refresh the map before retrying.',
  currentRevision: 6,
})

const abandonedResult = () => createLivePlayRejectedResult({
  opId,
  mapSlug,
  reason: 'abandoned',
  message: 'This live-play operation was abandoned before execution.',
  currentRevision: 4,
  currentState: { note: 'original' },
})

describe('live-play operation-abandonment parser', () => {
  it('parses new abandoned responses', () => {
    const result = abandonedResult()

    expect(parseLivePlayOperationAbandonmentResponse({
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'abandoned',
      mapSlug,
      opId,
      result,
    })).toEqual({
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'abandoned',
      mapSlug,
      opId,
      result,
    })
  })

  it('parses existing accepted terminal responses', () => {
    const result = acceptedResult()

    expect(parseLivePlayOperationAbandonmentResponse({
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'already-terminal',
      mapSlug,
      opId,
      result,
    })).toEqual({
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'already-terminal',
      mapSlug,
      opId,
      result,
    })
  })

  it('parses existing rejected terminal responses', () => {
    const result = rejectedResult()

    expect(parseLivePlayOperationAbandonmentResponse({
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'already-terminal',
      mapSlug,
      opId,
      result,
    })).toEqual({
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'already-terminal',
      mapSlug,
      opId,
      result,
    })
  })

  it('rejects abandoned disposition with a non-abandoned result', () => {
    expect(() => parseLivePlayOperationAbandonmentResponse({
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'abandoned',
      mapSlug,
      opId,
      result: rejectedResult(),
    })).toThrow(/reason must be abandoned/)
  })

  it('rejects outer/result operation mismatches', () => {
    expect(() => parseLivePlayOperationAbandonmentResponse({
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'already-terminal',
      mapSlug,
      opId: 'op_abandon999',
      result: acceptedResult(),
    })).toThrow(/opId must match/)
  })

  it('rejects outer/result map mismatches', () => {
    expect(() => parseLivePlayOperationAbandonmentResponse({
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'already-terminal',
      mapSlug: 'other-map',
      opId,
      result: acceptedResult(),
    })).toThrow(/mapSlug must match/)
  })

  it('returns detached data without mutating input', () => {
    const input = {
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'abandoned',
      mapSlug,
      opId,
      result: abandonedResult(),
    }
    const before = JSON.stringify(input)

    const parsed = parseLivePlayOperationAbandonmentResponse(input)
    if (parsed.result.ok !== false) throw new Error('Expected rejected result')
    ;(parsed.result.currentState as Record<string, unknown>).note = 'changed'

    expect(JSON.stringify(input)).toBe(before)
    expect(input.result.currentState).toEqual({ note: 'original' })
  })

  it('rejects duplicate-result wrappers and route presentation extras', () => {
    expect(() => parseLivePlayOperationAbandonmentResponse({
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'already-terminal',
      mapSlug,
      opId,
      result: {
        ok: true,
        duplicate: true,
        opId,
        original: acceptedResult(),
      },
    })).toThrow(/duplicate-result/)

    expect(() => parseLivePlayOperationAbandonmentResponse({
      schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
      disposition: 'already-terminal',
      mapSlug,
      opId,
      result: {
        ...acceptedResult(),
        map: { slug: mapSlug },
      },
    })).toThrow(/not allowed/)
  })
})
