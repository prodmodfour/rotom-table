import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  createLivePlayRejectedResult,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
  parseLivePlayOperationStatusResponse,
} from '#shared/livePlayOperationStatus'

const opId = 'op_status0001'
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

describe('live-play operation-status parser', () => {
  it('parses valid unknown responses', () => {
    expect(parseLivePlayOperationStatusResponse({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'unknown',
      mapSlug,
      opId,
    })).toEqual({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'unknown',
      mapSlug,
      opId,
    })
  })

  it('parses valid accepted terminal responses', () => {
    const result = acceptedResult()

    expect(parseLivePlayOperationStatusResponse({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'terminal',
      mapSlug,
      opId,
      result,
    })).toEqual({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'terminal',
      mapSlug,
      opId,
      result,
    })
  })

  it('parses valid rejected terminal responses', () => {
    const result = rejectedResult()

    expect(parseLivePlayOperationStatusResponse({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'terminal',
      mapSlug,
      opId,
      result,
    })).toEqual({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'terminal',
      mapSlug,
      opId,
      result,
    })
  })

  it('rejects outer/result operation mismatches', () => {
    expect(() => parseLivePlayOperationStatusResponse({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'terminal',
      mapSlug,
      opId: 'op_status9999',
      result: acceptedResult(),
    })).toThrow(/opId must match/)
  })

  it('rejects outer/result map mismatches', () => {
    expect(() => parseLivePlayOperationStatusResponse({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'terminal',
      mapSlug: 'other-map',
      opId,
      result: acceptedResult(),
    })).toThrow(/mapSlug must match/)
  })

  it('rejects malformed terminal results and duplicate-result wrappers', () => {
    expect(() => parseLivePlayOperationStatusResponse({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'terminal',
      mapSlug,
      opId,
      result: {
        ok: true,
        duplicate: true,
        opId,
        original: acceptedResult(),
      },
    })).toThrow(/duplicate-result/)

    expect(() => parseLivePlayOperationStatusResponse({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'terminal',
      mapSlug,
      opId,
      result: {
        ok: true,
        opId,
        mapSlug,
        previousRevision: 4,
        revision: 5,
        patches: [{
          schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
          type: 'not-a-patch',
          mapSlug,
          revision: 5,
          scopes: [],
          payload: {},
        }],
      },
    })).toThrow(/must be one of/)
  })

  it('returns detached data without mutating input', () => {
    const input = {
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'terminal',
      mapSlug,
      opId,
      result: acceptedResult(),
    }
    const before = JSON.stringify(input)

    const parsed = parseLivePlayOperationStatusResponse(input)
    if (parsed.status !== 'terminal' || parsed.result.ok !== true) throw new Error('Expected terminal accepted status')
    ;(parsed.result.patches[0]!.payload as Record<string, unknown>).placementId = 'changed-token'

    expect(JSON.stringify(input)).toBe(before)
    expect((input.result.patches[0]!.payload as Record<string, unknown>).placementId).toBe('token-1')
  })

  it('rejects route presentation extras on terminal results', () => {
    expect(() => parseLivePlayOperationStatusResponse({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'terminal',
      mapSlug,
      opId,
      result: {
        ...acceptedResult(),
        move: { type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE },
      },
    })).toThrow(/not allowed/)
  })
})
