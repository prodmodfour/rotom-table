import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EVENT_KINDS,
  ENCOUNTER_EVENT_LIMITS,
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  EncounterEventValidationError,
  parseEncounterEvent,
  parseEncounterEvents,
  type EncounterEventKind,
  type EncounterEventValidationCode,
} from '#shared/moveAutomation/events'
import { conditionEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const common = (
  kind: EncounterEventKind,
  eventId = `event.${kind}`,
): Record<string, unknown> => ({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId,
  kind,
  sourceOperationId: 'op.lifecycle.1',
  causalParentEventId: null,
  reasonCode: `${kind}.fact`,
})

const moveIdentity = (): Record<string, unknown> => ({
  resolutionId: 'resolution.move.1',
  canonicalId: 'Nature’s Madness',
  actorPlacementId: 'actor-token',
})

const movementIdentity = (): Record<string, unknown> => ({
  movementId: 'movement.path.1',
  mode: 'voluntary',
  step: 1,
})

const effectForEvent = () => {
  const effect = conditionEncounterEffectFixture()
  return {
    ...effect,
    source: {
      ...effect.source,
      operationId: 'op.lifecycle.1',
    },
  }
}

const validEvents = (): Record<string, unknown>[] => [
  { ...common('scene-start'), sceneId: 'scene.encounter.1' },
  { ...common('scene-end'), sceneId: 'scene.encounter.1' },
  { ...common('round-start'), round: 2 },
  { ...common('round-end'), round: 2 },
  {
    ...common('turn-start'),
    round: 2,
    turn: 4,
    placementId: 'actor-token',
    sideId: 'heroes',
  },
  {
    ...common('turn-end'),
    round: 2,
    turn: 4,
    placementId: 'actor-token',
    sideId: null,
  },
  {
    ...common('move-declared'),
    move: moveIdentity(),
    targetPlacementIds: ['target-token'],
  },
  {
    ...common('move-hit'),
    move: moveIdentity(),
    targetPlacementId: 'target-token',
    hitIndex: 1,
  },
  {
    ...common('move-damaged'),
    move: moveIdentity(),
    targetPlacementId: 'target-token',
    hitIndex: 1,
    damage: {
      hitPointLoss: 12,
      temporaryHitPointLoss: 3,
      damageClass: 'physical',
      moveType: 'normal',
    },
  },
  {
    ...common('move-ko'),
    move: moveIdentity(),
    targetPlacementId: 'target-token',
    hitIndex: null,
  },
  {
    ...common('move-completed'),
    move: moveIdentity(),
    attackedTargetIds: ['target-token'],
    hitTargetIds: ['target-token'],
    outcome: 'hit',
  },
  {
    ...common('placement-entering'),
    placementId: 'actor-token',
    movement: movementIdentity(),
    cell: { x: 2, y: 0, z: 1 },
  },
  {
    ...common('placement-leaving'),
    placementId: 'actor-token',
    movement: movementIdentity(),
    cell: { x: 1, y: 0, z: 1 },
  },
  {
    ...common('placement-moving'),
    placementId: 'actor-token',
    movement: movementIdentity(),
    from: { x: 1, y: 0, z: 1 },
    to: { x: 2, y: 0, z: 1 },
  },
  {
    ...common('switch'),
    recalledPlacementId: 'actor-token',
    sentOutPlacementId: 'replacement-token',
  },
  { ...common('recall'), placementId: 'actor-token', sideId: 'heroes' },
  { ...common('send-out'), placementId: 'replacement-token', sideId: null },
  { ...common('effect-added'), effect: effectForEvent() },
  { ...common('effect-removed'), effectId: 'effect.condition.target-token' },
  {
    ...common('resource-spent'),
    placementId: 'actor-token',
    resourceId: 'action.standard',
    amount: 1,
  },
  {
    ...common('resource-restored'),
    placementId: 'actor-token',
    resourceId: 'reaction.available',
    amount: 1,
  },
]

const eventOfKind = (kind: EncounterEventKind): Record<string, unknown> => {
  const event = validEvents().find(candidate => candidate.kind === kind)
  if (!event) throw new Error(`Missing event fixture for ${kind}`)
  return event
}

const expectEventError = (
  value: unknown,
  code: EncounterEventValidationCode,
  path?: string,
): EncounterEventValidationError => {
  try {
    parseEncounterEvent(value)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(EncounterEventValidationError)
    expect((error as EncounterEventValidationError).code).toBe(code)
    if (path) expect((error as EncounterEventValidationError).path).toBe(path)
    return error as EncounterEventValidationError
  }
}

const expectDeeplyFrozen = (value: unknown, seen = new WeakSet<object>()): void => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen)
}

describe('authoritative encounter events', () => {
  it('defines and strictly parses every server-internal lifecycle fact', () => {
    expect(ENCOUNTER_EVENT_KINDS).toEqual([
      'scene-start',
      'scene-end',
      'round-start',
      'round-end',
      'turn-start',
      'turn-end',
      'move-declared',
      'move-hit',
      'move-damaged',
      'move-ko',
      'move-completed',
      'placement-entering',
      'placement-leaving',
      'placement-moving',
      'switch',
      'recall',
      'send-out',
      'effect-added',
      'effect-removed',
      'resource-spent',
      'resource-restored',
    ])

    const input = validEvents()
    const parsed = parseEncounterEvents(input)

    expect(parsed.map(event => event.kind)).toEqual(ENCOUNTER_EVENT_KINDS)
    expect(parsed).toEqual(input)
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed)
    expect(parsed).not.toBe(input)
    expect(parsed[6]).not.toBe(input[6])
    expect(parsed[6]?.kind === 'move-declared' && parsed[6].move)
      .not.toBe(input[6]?.move)
    parsed.forEach(event => expectDeeplyFrozen(event))

    ;(input[6]?.targetPlacementIds as string[])[0] = 'changed-target'
    expect(parsed[6]?.kind === 'move-declared' && parsed[6].targetPlacementIds)
      .toEqual(['target-token'])
  })

  it('requires source-operation and causal-parent identity on every exact schema', () => {
    const root = eventOfKind('round-start')
    const child = {
      ...eventOfKind('turn-start'),
      eventId: 'event.turn.child',
      causalParentEventId: root.eventId,
    }

    expect(parseEncounterEvents([root, child])[1]).toMatchObject({
      sourceOperationId: 'op.lifecycle.1',
      causalParentEventId: 'event.round-start',
    })

    const missingSource: Record<string, unknown> = { ...child }
    delete missingSource.sourceOperationId
    expectEventError(missingSource, 'invalid-encounter-event', 'encounterEvent')

    expectEventError({
      ...child,
      causalParentEventId: child.eventId,
    }, 'invalid-causality', 'encounterEvent.causalParentEventId')

    expect(() => parseEncounterEvents([
      { ...root, causalParentEventId: child.eventId },
      child,
    ])).toThrow('a causal parent from the same batch must precede its child')

    expect(parseEncounterEvents([{
      ...child,
      causalParentEventId: 'event.from-prior-batch',
    }])[0]?.causalParentEventId).toBe('event.from-prior-batch')
  })

  it('rejects duplicates, unknown kinds, and unsupported versions', () => {
    const event = eventOfKind('round-start')

    expect(() => parseEncounterEvents([event, structuredClone(event)]))
      .toThrow('encounterEvents[1].eventId: duplicates event.round-start')
    expectEventError({ ...event, kind: 'arbitrary-script' }, 'unknown-event-kind', 'encounterEvent.kind')
    expectEventError({ ...event, schemaVersion: 2 }, 'unsupported-schema-version', 'encounterEvent.schemaVersion')
  })

  it('provides no generic payload or arbitrary state-patch escape hatch', () => {
    const round = eventOfKind('round-start')
    expectEventError({ ...round, patch: { encounterState: {} } }, 'invalid-encounter-event')
    expectEventError({ ...round, payload: { execute: 'anything' } }, 'invalid-encounter-event')

    const declared = eventOfKind('move-declared')
    expectEventError({
      ...declared,
      move: { ...(declared.move as object), statePatch: { hp: 0 } },
    }, 'invalid-encounter-event', 'encounterEvent.move')

    const added = eventOfKind('effect-added')
    const effect = added.effect as Record<string, unknown>
    expectEventError({
      ...added,
      effect: {
        ...effect,
        payload: { ...(effect.payload as object), arbitraryPatch: { conditions: [] } },
      },
    }, 'invalid-encounter-event', 'encounterEvent.effect.payload')
  })

  it('validates move targets, outcomes, damage facts, and hit bounds', () => {
    const completed = eventOfKind('move-completed')
    expect(parseEncounterEvent({
      ...completed,
      attackedTargetIds: [],
      hitTargetIds: [],
      outcome: 'no-target',
    })).toMatchObject({ outcome: 'no-target' })
    expect(parseEncounterEvent({
      ...completed,
      attackedTargetIds: ['target-a', 'target-b'],
      hitTargetIds: ['target-a'],
      outcome: 'mixed',
    })).toMatchObject({ outcome: 'mixed' })

    expectEventError({
      ...completed,
      attackedTargetIds: ['target-a'],
      hitTargetIds: ['target-b'],
    }, 'invalid-encounter-event', 'encounterEvent.hitTargetIds')
    expectEventError({
      ...completed,
      attackedTargetIds: ['target-a'],
      hitTargetIds: [],
      outcome: 'hit',
    }, 'invalid-encounter-event', 'encounterEvent.outcome')
    expectEventError({
      ...completed,
      attackedTargetIds: ['target-a', 'target-a'],
      hitTargetIds: [],
      outcome: 'miss',
    }, 'duplicate-id', 'encounterEvent.attackedTargetIds')

    const damaged = eventOfKind('move-damaged')
    expectEventError({
      ...damaged,
      damage: {
        ...(damaged.damage as object),
        hitPointLoss: 0,
        temporaryHitPointLoss: 0,
      },
    }, 'invalid-encounter-event', 'encounterEvent.damage')
    expectEventError({
      ...damaged,
      damage: { ...(damaged.damage as object), damageClass: 'scripted' },
    }, 'invalid-encounter-event', 'encounterEvent.damage.damageClass')
    expectEventError({
      ...eventOfKind('move-hit'),
      hitIndex: ENCOUNTER_EVENT_LIMITS.hitIndex + 1,
    }, 'limit-exceeded', 'encounterEvent.hitIndex')
  })

  it('validates authoritative movement, switch, effect, and resource facts', () => {
    const moving = eventOfKind('placement-moving')
    expectEventError({
      ...moving,
      to: structuredClone(moving.from),
    }, 'invalid-encounter-event', 'encounterEvent')
    expectEventError({
      ...moving,
      movement: { ...(moving.movement as object), mode: 'client-path' },
    }, 'invalid-encounter-event', 'encounterEvent.movement.mode')
    expectEventError({
      ...moving,
      to: { x: -1, y: 0, z: 0 },
    }, 'limit-exceeded', 'encounterEvent.to.x')

    const switched = eventOfKind('switch')
    expectEventError({
      ...switched,
      sentOutPlacementId: switched.recalledPlacementId,
    }, 'invalid-encounter-event', 'encounterEvent')

    const added = eventOfKind('effect-added')
    const effect = added.effect as Record<string, unknown>
    expectEventError({
      ...added,
      effect: {
        ...effect,
        source: { ...(effect.source as object), operationId: 'op.other.1' },
      },
    }, 'invalid-encounter-event', 'encounterEvent.effect.source.operationId')

    expectEventError({
      ...eventOfKind('resource-spent'),
      amount: 0,
    }, 'limit-exceeded', 'encounterEvent.amount')
    expectEventError({
      ...eventOfKind('turn-start'),
      sideId: 'Unknown Side',
    }, 'invalid-encounter-event', 'encounterEvent.sideId')
  })

  it('enforces event, target, identifier, and numeric bounds', () => {
    const oversizedBatch = Array.from(
      { length: ENCOUNTER_EVENT_LIMITS.events + 1 },
      (_, index) => ({
        ...eventOfKind('round-start'),
        eventId: `event.round.${index}`,
      }),
    )
    expect(() => parseEncounterEvents(oversizedBatch))
      .toThrow(`must contain at most ${ENCOUNTER_EVENT_LIMITS.events} entries`)

    expectEventError({
      ...eventOfKind('move-declared'),
      targetPlacementIds: Array.from(
        { length: ENCOUNTER_EVENT_LIMITS.targetPlacements + 1 },
        (_, index) => `target-${index}`,
      ),
    }, 'limit-exceeded', 'encounterEvent.targetPlacementIds')
    expectEventError({
      ...eventOfKind('effect-removed'),
      effectId: `effect.${'a'.repeat(ENCOUNTER_EVENT_LIMITS.identifierChars)}`,
    }, 'limit-exceeded', 'encounterEvent.effectId')
    expectEventError({
      ...eventOfKind('round-start'),
      round: ENCOUNTER_EVENT_LIMITS.round + 1,
    }, 'limit-exceeded', 'encounterEvent.round')
  })

  it('rejects executable, lossy, sparse, circular, and decorated non-JSON input', () => {
    let getterCalled = false
    const getterEvent = eventOfKind('round-start')
    Object.defineProperty(getterEvent, 'reasonCode', {
      enumerable: true,
      configurable: true,
      get: () => {
        getterCalled = true
        return 'forged.getter'
      },
    })
    expectEventError(getterEvent, 'not-json', 'encounterEvent.reasonCode')
    expect(getterCalled).toBe(false)

    class ForgedMove {
      resolutionId = 'resolution.forged'
      canonicalId = 'Scratch'
      actorPlacementId = 'actor-token'
    }
    expectEventError({
      ...eventOfKind('move-declared'),
      move: new ForgedMove(),
    }, 'not-json', 'encounterEvent.move')

    const sparseTargets = ['target-a']
    sparseTargets.length = 2
    expectEventError({
      ...eventOfKind('move-declared'),
      targetPlacementIds: sparseTargets,
    }, 'not-json', 'encounterEvent.targetPlacementIds[1]')

    const decoratedTargets = ['target-a'] as string[] & { patch?: unknown }
    decoratedTargets.patch = { hp: 0 }
    expectEventError({
      ...eventOfKind('move-declared'),
      targetPlacementIds: decoratedTargets,
    }, 'not-json', 'encounterEvent.targetPlacementIds.patch')

    const symbolEvent = eventOfKind('round-start')
    Object.defineProperty(symbolEvent, Symbol('patch'), { value: {}, enumerable: true })
    expectEventError(symbolEvent, 'not-json', 'encounterEvent')

    const circular = eventOfKind('round-start')
    circular.loop = circular
    expectEventError(circular, 'not-json', 'encounterEvent.loop')
    expectEventError({
      ...eventOfKind('round-start'),
      round: Number.NaN,
    }, 'not-json', 'encounterEvent.round')
  })
})
