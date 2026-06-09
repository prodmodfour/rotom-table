import { describe, expect, it } from 'vitest'
import {
  MAP_ACTION_EVENT_KINDS,
  MAP_ACTION_EVENT_SCHEMA_VERSION,
  MAP_ACTION_REALTIME_EVENT_TYPE,
  isMapActionEventEnvelope,
  isMapActionEventKind,
  isMapActionEventPayloadEnvelope,
  type MapActionEventEnvelope,
  type MapActionEventKind,
  type MapActionEventPayloadByKind,
  type MapActionMoveAnimationsPayload,
  type MapActionMoveFeedbackPayload,
  type MapActionPokeballResultPayload,
} from '#shared/mapActionEvents'

const feedbackState = {
  id: 'feedback-1',
  userId: 'actor-1',
  targetId: 'target-1',
  moveName: 'Ember',
  phase: 'outcome',
  naturalRoll: 17,
  modifiedRoll: 18,
  accuracyCheck: 6,
  userAccuracy: 1,
  targetEvasion: 0,
  targetEvasionLabel: 'Evasion 0',
  hit: true,
  crit: false,
  effectiveness: null,
  damageResolved: true,
  damageLoss: 23,
  conditions: [{ condition: 'Burned', applied: true }],
} satisfies MapActionMoveFeedbackPayload['feedback']

const moveAnimationEvent = {
  id: 'move-vfx-1',
  kind: 'projectile',
  moveName: 'Ember',
  userId: 'actor-1',
  createdAtMs: 1200,
  durationMs: 500,
  targetId: 'target-1',
} satisfies MapActionMoveAnimationsPayload['events'][number]

const captureResult = {
  id: 'capture-1',
  trainerId: 'actor-1',
  trainerName: 'Misty',
  targetId: 'target-1',
  targetName: 'Pidgey',
  targetSpecies: 'Pidgey',
  targetSpriteUrl: null,
  pokeballName: 'Basic Ball',
  success: false,
  hit: true,
  shakeCount: 2,
  accuracyRoll: 14,
  modifiedAccuracyRoll: 15,
  accuracyCheck: 6,
  userAccuracy: 1,
  targetEvasion: 0,
  targetEvasionLabel: 'Evasion 0',
  captureRoll: 78,
  adjustedCaptureRoll: 78,
  captureRate: 45,
  naturalTwentyCaptureBonus: -10,
  naturalCaptureSuccess: false,
  failureReason: null,
  breakdown: {
    captureRate: 45,
    captureRateLines: [{ label: 'Species', value: 45 }],
    rollModifier: 0,
    rollModifierLines: [],
    hitChance: {
      targetId: 'target-1',
      percent: 75,
      label: '75%',
      tone: 'high',
      title: 'AC 6',
    },
    captureChance: 40,
    captureChanceLabel: '40%',
    naturalTwentyCaptureChance: 50,
    naturalTwentyCaptureChanceLabel: '50%',
    combinedChance: 45,
    combinedChanceLabel: '45%',
    capturable: true,
    uncatchableReason: null,
    notes: [],
  },
} satisfies NonNullable<MapActionPokeballResultPayload['result']>

const eventEnvelope = <Kind extends MapActionEventKind>(
  kind: Kind,
  payload: MapActionEventPayloadByKind[Kind],
): MapActionEventEnvelope => ({
  schemaVersion: MAP_ACTION_EVENT_SCHEMA_VERSION,
  id: `event-${kind}`,
  kind,
  actorPlacementId: 'actor-1',
  sourceClientId: 'client-1',
  createdAt: 1_700_000_000_000,
  payload,
}) as MapActionEventEnvelope

describe('map action event contract', () => {
  it('declares the realtime type and supported visual event kinds', () => {
    expect(MAP_ACTION_REALTIME_EVENT_TYPE).toBe('map-action')
    expect(MAP_ACTION_EVENT_KINDS).toEqual([
      'action-splash',
      'move-animations',
      'move-feedback',
      'pokeball-feedback',
      'pokeball-result',
    ])

    expect(isMapActionEventKind('move-feedback')).toBe(true)
    expect(isMapActionEventKind('unknown-kind')).toBe(false)
  })

  it('accepts each typed payload envelope for transient visual replay', () => {
    expect(isMapActionEventEnvelope(eventEnvelope('action-splash', {
      actionName: 'Tackle',
      verb: 'uses',
    }))).toBe(true)
    expect(isMapActionEventEnvelope(eventEnvelope('move-animations', {
      events: [moveAnimationEvent],
    }))).toBe(true)
    expect(isMapActionEventEnvelope(eventEnvelope('move-feedback', {
      feedback: feedbackState,
    }))).toBe(true)
    expect(isMapActionEventEnvelope(eventEnvelope('pokeball-feedback', {
      feedback: { ...feedbackState, id: 'pokeball-feedback-1', moveName: 'Throw Basic Ball' },
    }))).toBe(true)
    expect(isMapActionEventEnvelope(eventEnvelope('pokeball-result', {
      result: captureResult,
      error: null,
    }))).toBe(true)
  })

  it('rejects unknown kinds or incomplete top-level event envelopes', () => {
    const event = eventEnvelope('action-splash', { actionName: 'Tackle' })

    expect(isMapActionEventEnvelope({ ...event, kind: 'unknown-kind' })).toBe(false)
    expect(isMapActionEventEnvelope({ ...event, schemaVersion: 2 })).toBe(false)
    expect(isMapActionEventEnvelope({ ...event, id: '' })).toBe(false)
    expect(isMapActionEventEnvelope({ ...event, actorPlacementId: '' })).toBe(false)
    expect(isMapActionEventEnvelope({ ...event, sourceClientId: '' })).toBe(false)
    expect(isMapActionEventEnvelope({ ...event, createdAt: Number.NaN })).toBe(false)
  })

  it('rejects malformed payload envelopes safely', () => {
    expect(isMapActionEventPayloadEnvelope('action-splash', { actionName: '' })).toBe(false)
    expect(isMapActionEventPayloadEnvelope('move-animations', {
      events: [{ ...moveAnimationEvent, createdAtMs: 'old-clock' }],
    })).toBe(false)
    expect(isMapActionEventPayloadEnvelope('move-feedback', {
      feedback: { ...feedbackState, phase: 'done' },
    })).toBe(false)
    expect(isMapActionEventPayloadEnvelope('pokeball-feedback', {
      feedback: { ...feedbackState, conditions: [{ condition: 'Burned' }] },
    })).toBe(false)
    expect(isMapActionEventPayloadEnvelope('pokeball-result', {
      result: null,
      error: null,
    })).toBe(false)
  })
})
