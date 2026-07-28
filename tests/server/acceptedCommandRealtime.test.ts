import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  type LivePlayCommandEnvelope,
  type LivePlayPatch,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_REALTIME_EVENT_TYPES } from '#shared/realtime'
import {
  acceptedCommandRealtimeAppendInput,
  acceptedCommandRealtimeDedupeKey,
} from '~~/server/livePlay/acceptedCommandRealtime'

const command = (
  overrides: Partial<LivePlayCommandEnvelope> & { readonly clientId?: unknown } = {},
): LivePlayCommandEnvelope & { readonly clientId?: unknown } => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_acceptrt01',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
  scopes: [{ kind: 'map', lane: 'scene' }],
  payload: { scene: 'one' },
  ...overrides,
})

const patch = (overrides: Partial<LivePlayPatch> = {}): LivePlayPatch => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type: LIVE_PLAY_PATCH_TYPES.MAP_SCENE,
  mapSlug: 'arena',
  revision: 5,
  scopes: [{ kind: 'map', lane: 'scene' }],
  payload: { previous: null, current: { name: 'Scene 1' } },
  ...overrides,
})

const accepted = (patches: readonly LivePlayPatch[] = [patch()]) => createLivePlayAcceptedResult({
  opId: 'op_acceptrt01',
  mapSlug: 'arena',
  previousRevision: 4,
  revision: 5,
  patches,
})

describe('accepted command realtime append helper', () => {
  it('builds canonical map-access append input from the accepted result', () => {
    const result = accepted()
    const append = acceptedCommandRealtimeAppendInput({ command: command({ clientId: 'client-1' }), result })

    expect(append).toEqual({
      event: {
        channel: 'map:arena',
        type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
        mapSlug: 'arena',
        previousRevision: 4,
        revision: 5,
        opId: 'op_acceptrt01',
        patches: result.patches,
        presentation: expect.objectContaining({
          operationId: 'op_acceptrt01',
          mapSlug: 'arena',
          previousRevision: 4,
          revision: 5,
        }),
        clientId: 'client-1',
      },
      access: { kind: 'map-access', mapSlug: 'arena' },
      dedupeKey: 'live-play-command:arena:op_acceptrt01:accepted',
    })
    expect('sequence' in append.event).toBe(false)
    expect('timestamp' in append.event).toBe(false)
  })

  it('uses deterministic bounded dedupe keys', () => {
    expect(acceptedCommandRealtimeDedupeKey({ mapSlug: 'arena', opId: 'op_acceptrt01' }))
      .toBe('live-play-command:arena:op_acceptrt01:accepted')
    expect(acceptedCommandRealtimeDedupeKey({ mapSlug: 'arena', opId: 'op_acceptrt01' }))
      .toBe(acceptedCommandRealtimeDedupeKey({ mapSlug: 'arena', opId: 'op_acceptrt01' }))
  })

  it('preserves valid explicit client ids and omits invalid optional client ids', () => {
    const result = accepted()
    expect(acceptedCommandRealtimeAppendInput({ command: command({ clientId: 'command-client' }), result }).event)
      .toMatchObject({ clientId: 'command-client' })
    expect(acceptedCommandRealtimeAppendInput({ command: command({ clientId: 'command-client' }), result, clientId: 'explicit-client' }).event)
      .toMatchObject({ clientId: 'explicit-client' })
    expect(acceptedCommandRealtimeAppendInput({ command: command({ clientId: '' }), result }).event)
      .not.toHaveProperty('clientId')
  })

  it('does not mutate command, result, or patches while validating through event-log contracts', () => {
    const sourceCommand = command({ clientId: 'client-1' })
    const sourcePatch = patch()
    const result = accepted([sourcePatch])
    const before = JSON.stringify({ sourceCommand, result, sourcePatch })

    const append = acceptedCommandRealtimeAppendInput({ command: sourceCommand, result })

    expect(JSON.stringify({ sourceCommand, result, sourcePatch })).toBe(before)
    expect(append.event.patches).toEqual([sourcePatch])
    expect(append.event.patches).not.toBe(result.patches)
  })
})
