import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_COMMAND_SCHEMA_VERSION, LIVE_PLAY_PATCH_TYPES } from '#shared/livePlayCommands'
import { parseAcceptedLivePlayRealtimeEvent } from '#shared/livePlayRealtimeEvents'
import { LIVE_PLAY_REALTIME_EVENT_TYPES } from '#shared/realtime'

const validAcceptedEvent = (overrides: Record<string, unknown> = {}) => ({
  channel: 'map:arena-map',
  type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
  mapSlug: 'arena-map',
  opId: 'op_realtime0001',
  previousRevision: 4,
  revision: 5,
  timestamp: 1_000,
  clientId: 'client-a',
  patches: [{
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
    mapSlug: 'arena-map',
    revision: 5,
    scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
    payload: { placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } },
  }],
  ...overrides,
})

describe('accepted live-play realtime event parsing', () => {
  it('parses a valid accepted command event into detached data', () => {
    const source = validAcceptedEvent()
    const result = parseAcceptedLivePlayRealtimeEvent(source)

    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.event).toEqual(source)
    expect(result.event).not.toBe(source)
    expect(result.event.patches).not.toBe(source.patches)
    expect(result.event.patches[0]).not.toBe(source.patches[0])
    expect(result.event.patches[0]?.payload).not.toBe(source.patches[0]?.payload)
  })

  it('rejects a missing operation ID', () => {
    const { opId: _opId, ...event } = validAcceptedEvent()

    const result = parseAcceptedLivePlayRealtimeEvent(event)

    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.issues.map((issue) => issue.path)).toContain('opId')
  })

  it('rejects channel and map slug mismatches', () => {
    const result = parseAcceptedLivePlayRealtimeEvent(validAcceptedEvent({ channel: 'map:other-map' }))

    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.issues.map((issue) => issue.path)).toContain('channel')
  })

  it('rejects invalid revisions', () => {
    const unsafe = parseAcceptedLivePlayRealtimeEvent(validAcceptedEvent({ revision: -1 }))
    const notNewer = parseAcceptedLivePlayRealtimeEvent(validAcceptedEvent({ previousRevision: 5, revision: 5 }))

    expect(unsafe.valid).toBe(false)
    expect(notNewer.valid).toBe(false)
    if (!notNewer.valid) expect(notNewer.issues.map((issue) => issue.path)).toContain('revision')
  })

  it('rejects patch map or revision mismatches', () => {
    const patchMapMismatch = parseAcceptedLivePlayRealtimeEvent(validAcceptedEvent({
      patches: [{
        ...validAcceptedEvent().patches[0],
        mapSlug: 'other-map',
      }],
    }))
    const patchRevisionMismatch = parseAcceptedLivePlayRealtimeEvent(validAcceptedEvent({
      patches: [{
        ...validAcceptedEvent().patches[0],
        revision: 6,
      }],
    }))

    expect(patchMapMismatch.valid).toBe(false)
    expect(patchRevisionMismatch.valid).toBe(false)
  })

  it('rejects unsupported patch types', () => {
    const result = parseAcceptedLivePlayRealtimeEvent(validAcceptedEvent({
      patches: [{
        ...validAcceptedEvent().patches[0],
        type: 'map.unsupported',
      }],
    }))

    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.issues.map((issue) => issue.path)).toContain('patches[0].type')
  })

  it('does not mutate the incoming event while parsing', () => {
    const source = validAcceptedEvent()
    const before = JSON.stringify(source)

    parseAcceptedLivePlayRealtimeEvent(source)

    expect(JSON.stringify(source)).toBe(before)
  })
})
