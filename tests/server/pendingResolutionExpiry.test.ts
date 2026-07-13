import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
} from '#shared/moveAutomation/events'
import { pendingResolutionGameEventExpiry } from '~~/server/domain/moveAutomation/pendingResolutionExpiry'
import { createPendingMoveResolutionFixture } from '../fixtures/moveAutomation/pendingResolution'

describe('pending resolution game-event expiry', () => {
  it('expires from authoritative scene end and never from elapsed wall-clock time', () => {
    const pending = createPendingMoveResolutionFixture({
      createdAt: 1,
      updatedAt: 1,
    })
    const turnEnd = parseEncounterEvent({
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId: 'event.turn-end.1',
      kind: 'turn-end',
      sourceOperationId: 'op_turnadvance001',
      causalParentEventId: null,
      reasonCode: 'initiative.turn-end',
      round: 1,
      turn: 1,
      placementId: 'actor-token',
      sideId: null,
    })
    const sceneEnd = parseEncounterEvent({
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId: 'event.scene-end.1',
      kind: 'scene-end',
      sourceOperationId: 'op_sceneend0001',
      causalParentEventId: null,
      reasonCode: 'scene.scene-end',
      sceneId: 'scene.pending.1',
    })

    expect(pendingResolutionGameEventExpiry(pending, [])).toBeNull()
    expect(pendingResolutionGameEventExpiry(pending, [turnEnd])).toBeNull()
    expect(pendingResolutionGameEventExpiry(pending, [sceneEnd])).toEqual({
      status: 'expired',
      reasonCode: 'pending-resolution.scene-ended',
      sourceOperationId: 'op_sceneend0001',
      eventId: 'event.scene-end.1',
      eventKind: 'scene-end',
    })
  })
})
