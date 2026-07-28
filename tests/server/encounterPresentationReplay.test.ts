import { describe, expect, it } from 'vitest'
import { acceptedEncounterPresentationsFromPersistedRealtimeEvents } from '../../server/domain/encounterPresentation/replay'
import { acceptedEncounterPresentationFromLivePlayCommand } from '../../server/domain/encounterPresentation/acceptedAdapters'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  type LivePlayCommandEnvelope,
  type LivePlayPatch,
} from '../../shared/livePlayCommands'
import type { PersistedRealtimeEvent } from '../../shared/realtimeEventLog'

const command = {
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_replayhistory1',
  mapSlug: 'arena',
  baseRevision: 1,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [{ kind: 'token', placementId: 'actor:one', field: 'position' }],
  payload: { placementId: 'actor:one', position: { x: 2, y: 0, z: 2 } },
} as LivePlayCommandEnvelope
const patch = {
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
  mapSlug: 'arena',
  revision: 2,
  scopes: command.scopes,
  payload: { placementId: 'actor:one', position: { x: 2, y: 0, z: 2 } },
} as LivePlayPatch
const result = createLivePlayAcceptedResult({
  opId: command.opId,
  mapSlug: command.mapSlug,
  previousRevision: 1,
  revision: 2,
  patches: [patch],
})
const presentation = acceptedEncounterPresentationFromLivePlayCommand({ command, result, occurredAt: 20 })
const record = (sequence: number, mapSlug = 'arena') => ({
  sequence,
  dedupeKey: `accepted:${mapSlug}:${command.opId}:${sequence}`,
  access: { kind: 'map-access', mapSlug },
  event: {
    sequence,
    channel: `map:${mapSlug}`,
    type: 'live-play-command-accepted',
    mapSlug,
    opId: command.opId,
    previousRevision: 1,
    revision: 2,
    patches: [patch],
    presentation,
    timestamp: 21,
  },
}) as unknown as PersistedRealtimeEvent

describe('encounter presentation durable replay projection', () => {
  it('recovers and deduplicates accepted facts for snapshot/replay-gap history', () => {
    const recovered = acceptedEncounterPresentationsFromPersistedRealtimeEvents({
      events: [record(1), record(2)],
      mapSlug: 'arena',
      mapRevision: 2,
    })
    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.presentationId).toBe(presentation.presentationId)
  })

  it('drops other-map and future-revision presentations', () => {
    expect(acceptedEncounterPresentationsFromPersistedRealtimeEvents({
      events: [record(1)], mapSlug: 'other', mapRevision: 2,
    })).toEqual([])
    expect(acceptedEncounterPresentationsFromPersistedRealtimeEvents({
      events: [record(1)], mapSlug: 'arena', mapRevision: 1,
    })).toEqual([])
  })
})
