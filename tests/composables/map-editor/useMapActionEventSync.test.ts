import { describe, expect, it, beforeEach, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useMapActionEventSync, rebaseMoveAnimationEventsForReceiver } from '~/composables/map-editor/useMapActionEventSync'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import {
  MAP_ACTION_EVENT_SCHEMA_VERSION,
  MAP_ACTION_REALTIME_EVENT_TYPE,
  type MapActionEventEnvelope,
  type MapActionEventKind,
  type MapActionEventPayloadByKind,
  type MapActionMoveAnimationsPayload,
  type MapActionMoveFeedbackPayload,
  type MapActionPokeballResultPayload,
} from '#shared/mapActionEvents'
import { mapChannel, type RealtimeEvent } from '#shared/realtime'

const mocks = vi.hoisted(() => ({
  postJson: vi.fn(),
  realtimeSubscriptions: [] as Array<{ channel: string; handler: (event: RealtimeEvent) => void }>,
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    postJson: mocks.postJson,
  }),
}))

vi.mock('~/composables/useRealtime', () => ({
  useRealtimeChannel: vi.fn((channel: string, handler: (event: RealtimeEvent) => void) => {
    mocks.realtimeSubscriptions.push({ channel, handler })
    return vi.fn()
  }),
}))

const feedbackState = {
  id: 'feedback-1',
  userId: 'actor-1',
  targetId: 'target-1',
  moveName: 'Thunderbolt',
  phase: 'rolling',
  naturalRoll: 18,
  modifiedRoll: 20,
  accuracyCheck: 4,
  userAccuracy: 1,
  targetEvasion: 0,
  targetEvasionLabel: 'Evasion 0',
  hit: true,
  crit: false,
  effectiveness: null,
  damageResolved: true,
  damageLoss: 24,
  conditions: [],
} satisfies MapActionMoveFeedbackPayload['feedback']

const moveAnimationEvent = {
  id: 'vfx-1',
  kind: 'projectile',
  moveName: 'Thunderbolt',
  userId: 'actor-1',
  targetId: 'target-1',
  createdAtMs: 1_000,
  durationMs: 600,
  startOffsetMs: 200,
} satisfies MapActionMoveAnimationsPayload['events'][number]

const captureResult = {
  id: 'capture-actor-1-target-1-100',
  trainerId: 'actor-1',
  trainerName: 'Lenora',
  targetId: 'target-1',
  targetName: 'Pidgey',
  targetSpecies: 'Pidgey',
  targetSpriteUrl: '/pidgey.png',
  pokeballName: 'Basic Ball',
  success: false,
  hit: true,
  shakeCount: 2,
  accuracyRoll: 17,
  modifiedAccuracyRoll: 18,
  accuracyCheck: 6,
  userAccuracy: 1,
  targetEvasion: 0,
  targetEvasionLabel: 'Evasion 0',
  captureRoll: 72,
  adjustedCaptureRoll: 72,
  captureRate: 55,
  naturalTwentyCaptureBonus: 0,
  naturalCaptureSuccess: false,
  failureReason: 'The Pokémon broke free.',
  breakdown: {
    captureRate: 55,
    captureRateLines: [{ label: 'Base', value: 100 }, { label: 'Target Level 20 × 2', value: -40 }],
    rollModifier: 0,
    rollModifierLines: [{ label: 'Basic Ball modifier', value: 0 }],
    hitChance: {
      targetId: 'target-1',
      percent: 45,
      label: '45%',
      tone: 'low',
      title: '45% to hit and capture.',
    },
    captureChance: 55,
    captureChanceLabel: '55%',
    naturalTwentyCaptureChance: 65,
    naturalTwentyCaptureChanceLabel: '65%',
    combinedChance: 45,
    combinedChanceLabel: '45%',
    capturable: true,
    uncatchableReason: null,
    notes: ['Conditional ball modifiers were not inferred.'],
  },
} satisfies NonNullable<MapActionPokeballResultPayload['result']>

const mapActionEvent = <Kind extends MapActionEventKind>(
  kind: Kind,
  payload: MapActionEventPayloadByKind[Kind],
  overrides: Partial<MapActionEventEnvelope> = {},
): MapActionEventEnvelope => ({
  schemaVersion: MAP_ACTION_EVENT_SCHEMA_VERSION,
  id: `event-${kind}`,
  kind,
  actorPlacementId: 'actor-1',
  sourceClientId: 'remote-client',
  createdAt: 1_700_000_000_000,
  payload,
  ...overrides,
} as MapActionEventEnvelope)

const realtimeMapActionEvent = (
  event: MapActionEventEnvelope,
  overrides: Partial<RealtimeEvent<MapActionEventEnvelope>> = {},
): RealtimeEvent<MapActionEventEnvelope> => ({
  channel: mapChannel('arena'),
  type: MAP_ACTION_REALTIME_EVENT_TYPE,
  clientId: event.sourceClientId,
  timestamp: 1_700_000_000_010,
  data: event,
  ...overrides,
})

const uniqueRemoteCopy = (event: MapActionEventEnvelope): MapActionEventEnvelope => ({
  ...event,
  id: `${event.id}-unique`,
} as MapActionEventEnvelope)

const latestHandler = () => {
  const subscription = mocks.realtimeSubscriptions.at(-1)
  if (!subscription) throw new Error('expected realtime subscription')
  return subscription.handler
}

describe('useMapActionEventSync', () => {
  beforeEach(() => {
    mocks.postJson.mockReset()
    mocks.postJson.mockResolvedValue({ ok: true })
    mocks.realtimeSubscriptions.length = 0
  })

  it('subscribes to the current map channel and publishes through the action-event endpoint', async () => {
    const profileId = computed(() => 'profile_ash00000')
    const sync = useMapActionEventSync({
      slug: 'arena',
      profileId,
      clientId: 'local-client',
      wallClockNow: () => 1_700_000_123_000,
    })

    await sync.publishActionSplash({
      actorPlacementId: 'actor-1',
      eventId: 'event-local-1',
      payload: { actionName: 'Quick Attack', verb: 'uses' },
    })

    expect(mocks.realtimeSubscriptions).toEqual([
      expect.objectContaining({ channel: mapChannel('arena') }),
    ])
    expect(mocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.actionEvent, {
      slug: 'arena',
      profileId: 'profile_ash00000',
      event: {
        schemaVersion: MAP_ACTION_EVENT_SCHEMA_VERSION,
        id: 'event-local-1',
        kind: 'action-splash',
        actorPlacementId: 'actor-1',
        sourceClientId: 'local-client',
        createdAt: 1_700_000_123_000,
        payload: { actionName: 'Quick Attack', verb: 'uses' },
      },
    })
  })

  it('ignores non-action realtime events, local echoes, invalid payloads, and duplicate event ids', () => {
    const onActionSplash = vi.fn()
    useMapActionEventSync({
      slug: 'arena',
      clientId: 'local-client',
      handlers: { onActionSplash },
    })
    const handler = latestHandler()
    const splash = mapActionEvent('action-splash', { actionName: 'Tackle' })

    handler({ channel: mapChannel('arena'), type: 'updated', timestamp: 1, data: splash })
    handler(realtimeMapActionEvent({ ...splash, sourceClientId: 'local-client' }, { clientId: 'local-client' }))
    handler(realtimeMapActionEvent({ ...splash, id: '' }))
    handler(realtimeMapActionEvent(splash))
    handler(realtimeMapActionEvent(splash))

    expect(onActionSplash).toHaveBeenCalledTimes(1)
    expect(onActionSplash).toHaveBeenCalledWith(splash)
  })

  it('rebases remote move animation timestamps onto the receiver animation clock', () => {
    const onMoveAnimations = vi.fn()
    const originalEvents = [
      moveAnimationEvent,
      { ...moveAnimationEvent, id: 'vfx-2', createdAtMs: 1_250, startOffsetMs: 0 },
    ] satisfies MapActionMoveAnimationsPayload['events']
    const event = mapActionEvent('move-animations', { events: originalEvents })
    useMapActionEventSync({
      slug: 'arena',
      clientId: 'local-client',
      nowMs: () => 5_000,
      handlers: { onMoveAnimations },
    })

    latestHandler()(realtimeMapActionEvent(event))

    expect(onMoveAnimations).toHaveBeenCalledTimes(1)
    expect(onMoveAnimations.mock.calls[0][0]).toMatchObject({
      id: event.id,
      kind: 'move-animations',
      payload: {
        events: [
          expect.objectContaining({ id: 'vfx-1', createdAtMs: 5_000, startOffsetMs: 200 }),
          expect.objectContaining({ id: 'vfx-2', createdAtMs: 5_250, startOffsetMs: 0 }),
        ],
      },
    })
    expect(originalEvents[0]?.createdAtMs).toBe(1_000)
  })

  it('ignores local echo realtime events before dispatching any supported visual handler', () => {
    const handlers = {
      onActionSplash: vi.fn(),
      onMoveAnimations: vi.fn(),
      onMoveFeedback: vi.fn(),
      onPokeballFeedback: vi.fn(),
      onPokeballResult: vi.fn(),
    }
    useMapActionEventSync({ slug: 'arena', clientId: 'local-client', handlers })
    const handler = latestHandler()
    const events = [
      mapActionEvent('action-splash', { actionName: 'Growl' }),
      mapActionEvent('move-animations', { events: [moveAnimationEvent] }),
      mapActionEvent('move-feedback', { feedback: feedbackState }),
      mapActionEvent('pokeball-feedback', {
        feedback: { ...feedbackState, id: 'pokeball-feedback-1', moveName: 'Throw Basic Ball' },
      }),
      mapActionEvent('pokeball-result', {
        result: null,
        error: 'The Poké Ball missed.',
      }),
    ]

    for (const event of events) {
      const echo = { ...event, sourceClientId: 'local-client' } as MapActionEventEnvelope
      handler(realtimeMapActionEvent(echo, { clientId: 'local-client' }))
    }

    expect(handlers.onActionSplash).not.toHaveBeenCalled()
    expect(handlers.onMoveAnimations).not.toHaveBeenCalled()
    expect(handlers.onMoveFeedback).not.toHaveBeenCalled()
    expect(handlers.onPokeballFeedback).not.toHaveBeenCalled()
    expect(handlers.onPokeballResult).not.toHaveBeenCalled()
  })

  it('dispatches each supported remote visual event kind once per unique event id', () => {
    const handlers = {
      onActionSplash: vi.fn(),
      onMoveAnimations: vi.fn(),
      onMoveFeedback: vi.fn(),
      onPokeballFeedback: vi.fn(),
      onPokeballResult: vi.fn(),
    }
    useMapActionEventSync({
      slug: 'arena',
      clientId: 'local-client',
      nowMs: () => 9_000,
      handlers,
    })
    const handler = latestHandler()

    const splash = mapActionEvent('action-splash', { actionName: 'Growl' })
    const splashUnique = uniqueRemoteCopy(splash)
    const animations = mapActionEvent('move-animations', { events: [moveAnimationEvent] })
    const animationsUnique = uniqueRemoteCopy(animations)
    const moveFeedback = mapActionEvent('move-feedback', { feedback: feedbackState })
    const moveFeedbackUnique = uniqueRemoteCopy(moveFeedback)
    const pokeballFeedback = mapActionEvent('pokeball-feedback', {
      feedback: { ...feedbackState, id: 'pokeball-feedback-1', moveName: 'Throw Basic Ball' },
    })
    const pokeballFeedbackUnique = uniqueRemoteCopy(pokeballFeedback)
    const pokeballResult = mapActionEvent('pokeball-result', {
      result: null,
      error: 'The Poké Ball missed.',
    })
    const pokeballResultUnique = uniqueRemoteCopy(pokeballResult)

    for (const [event, uniqueEvent] of [
      [splash, splashUnique],
      [animations, animationsUnique],
      [moveFeedback, moveFeedbackUnique],
      [pokeballFeedback, pokeballFeedbackUnique],
      [pokeballResult, pokeballResultUnique],
    ] as const) {
      handler(realtimeMapActionEvent(event))
      handler(realtimeMapActionEvent(event))
      handler(realtimeMapActionEvent(uniqueEvent))
    }

    expect(handlers.onActionSplash).toHaveBeenCalledTimes(2)
    expect(handlers.onActionSplash).toHaveBeenNthCalledWith(1, splash)
    expect(handlers.onActionSplash).toHaveBeenNthCalledWith(2, splashUnique)

    expect(handlers.onMoveAnimations).toHaveBeenCalledTimes(2)
    expect(handlers.onMoveAnimations).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: animations.id,
      kind: 'move-animations',
      payload: {
        events: [expect.objectContaining({ id: moveAnimationEvent.id, createdAtMs: 9_000 })],
      },
    }))
    expect(handlers.onMoveAnimations).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: animationsUnique.id,
      kind: 'move-animations',
      payload: {
        events: [expect.objectContaining({ id: moveAnimationEvent.id, createdAtMs: 9_000 })],
      },
    }))

    expect(handlers.onMoveFeedback).toHaveBeenCalledTimes(2)
    expect(handlers.onMoveFeedback).toHaveBeenNthCalledWith(1, moveFeedback)
    expect(handlers.onMoveFeedback).toHaveBeenNthCalledWith(2, moveFeedbackUnique)

    expect(handlers.onPokeballFeedback).toHaveBeenCalledTimes(2)
    expect(handlers.onPokeballFeedback).toHaveBeenNthCalledWith(1, pokeballFeedback)
    expect(handlers.onPokeballFeedback).toHaveBeenNthCalledWith(2, pokeballFeedbackUnique)

    expect(handlers.onPokeballResult).toHaveBeenCalledTimes(2)
    expect(handlers.onPokeballResult).toHaveBeenNthCalledWith(1, pokeballResult)
    expect(handlers.onPokeballResult).toHaveBeenNthCalledWith(2, pokeballResultUnique)
  })

  it('publishes pokeball-result events with the full capture result payload', async () => {
    const sync = useMapActionEventSync({
      slug: 'arena',
      clientId: 'local-client',
      wallClockNow: () => 1_700_000_555_000,
    })

    await sync.publishPokeballResult({
      actorPlacementId: 'actor-1',
      eventId: 'event-capture-result',
      result: captureResult,
      error: null,
    })

    expect(mocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.actionEvent, expect.objectContaining({
      slug: 'arena',
      event: {
        schemaVersion: MAP_ACTION_EVENT_SCHEMA_VERSION,
        id: 'event-capture-result',
        kind: 'pokeball-result',
        actorPlacementId: 'actor-1',
        sourceClientId: 'local-client',
        createdAt: 1_700_000_555_000,
        payload: { result: captureResult, error: null },
      },
    }))
    expect(mocks.postJson.mock.calls[0]?.[1].event.payload.result).toBe(captureResult)
  })

  it('uses reactive slug/profile values when publishing future local events', async () => {
    const slug = ref('arena')
    const profileId = ref<string | null>('profile_ash00000')
    const sync = useMapActionEventSync({ slug, profileId, clientId: 'local-client' })

    slug.value = 'second-arena'
    profileId.value = null
    await sync.publishMapActionEvent('pokeball-result', {
      actorPlacementId: 'actor-1',
      eventId: 'event-capture-error',
      createdAt: 42,
      payload: { result: null, error: 'Choose a Poké Ball with quantity remaining.' },
    })

    expect(mocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.actionEvent, expect.objectContaining({
      slug: 'second-arena',
      profileId: null,
    }))
  })
})

describe('rebaseMoveAnimationEventsForReceiver', () => {
  it('preserves in-batch timing offsets without mutating the input batch', () => {
    const events = [
      moveAnimationEvent,
      { ...moveAnimationEvent, id: 'vfx-2', createdAtMs: 1_090 },
    ] satisfies MapActionMoveAnimationsPayload['events']

    expect(rebaseMoveAnimationEventsForReceiver(events, 8_000)).toEqual([
      expect.objectContaining({ id: 'vfx-1', createdAtMs: 8_000 }),
      expect.objectContaining({ id: 'vfx-2', createdAtMs: 8_090 }),
    ])
    expect(events[1]?.createdAtMs).toBe(1_090)
  })
})
