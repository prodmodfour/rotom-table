import { describe, expect, it } from 'vitest'
import {
  parseEncounterEffect,
  type EncounterEffect,
  type EncounterEffectBoundary,
  type EncounterEffectTurnSubject,
} from '#shared/moveAutomation/encounterEffects'
import {
  applyEncounterEffectLifecycleEvent,
  EncounterEffectLifecycleError,
  type EncounterEffectLifecycleEvent,
} from '~~/server/domain/moveAutomation/effectLifecycle'
import {
  capabilityEncounterEffectFixture,
  conditionEncounterEffectFixture,
  numericEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const effectFrom = (
  base: EncounterEffect,
  overrides: Record<string, unknown>,
): EncounterEffect => parseEncounterEffect({ ...base, ...overrides })

const uncharged = {
  charges: null,
  chargePolicy: { kind: 'none', amount: null },
} as const

const permanent = { kind: 'permanent', remaining: null } as const

describe('encounter effect lifecycle policies', () => {
  it('advances fixed source/target turn counts only at the declared boundary', () => {
    const cases: ReadonlyArray<{
      subject: EncounterEffectTurnSubject
      boundary: EncounterEffectBoundary
      placementId: string
      eventKind: 'turn-start' | 'turn-end'
    }> = [
      { subject: 'source', boundary: 'start', placementId: 'actor-token', eventKind: 'turn-start' },
      { subject: 'source', boundary: 'end', placementId: 'actor-token', eventKind: 'turn-end' },
      { subject: 'target', boundary: 'start', placementId: 'target-token', eventKind: 'turn-start' },
      { subject: 'target', boundary: 'end', placementId: 'target-token', eventKind: 'turn-end' },
    ]

    cases.forEach(({ subject, boundary, placementId, eventKind }, index) => {
      const effect = effectFrom(conditionEncounterEffectFixture(), {
        id: `effect.turn-policy-${index}`,
        duration: { kind: 'turns', subject, boundary, remaining: 2 },
        ...uncharged,
      })
      const wrongBoundary = applyEncounterEffectLifecycleEvent(
        { effects: [effect] },
        {
          kind: eventKind === 'turn-start' ? 'turn-end' : 'turn-start',
          placementId,
        },
      )
      const wrongParticipant = applyEncounterEffectLifecycleEvent(
        { effects: [effect] },
        { kind: eventKind, placementId: 'unrelated-token' },
      )

      expect(wrongBoundary.changed).toBe(false)
      expect(wrongParticipant.changed).toBe(false)
      expect(wrongBoundary.effects[0]?.duration).toEqual(effect.duration)

      const decremented = applyEncounterEffectLifecycleEvent(
        { effects: [effect] },
        { kind: eventKind, placementId },
      )
      expect(decremented.effects[0]?.duration).toEqual({
        kind: 'turns',
        subject,
        boundary,
        remaining: 1,
      })
      expect(decremented.transitions).toMatchObject([{
        kind: 'duration-decremented',
        reasonCode: 'effect-duration-decremented',
      }])

      const expired = applyEncounterEffectLifecycleEvent(
        { effects: decremented.effects },
        { kind: eventKind, placementId },
      )
      expect(expired.effects).toEqual([])
      expect(expired.transitions).toMatchObject([{
        kind: 'expired',
        reasonCode: 'effect-duration-expired',
      }])
    })
  })

  it('matches target-side turns and fixed start/end round counts deterministically', () => {
    const sideEffect = effectFrom(conditionEncounterEffectFixture(), {
      id: 'effect.side-turn',
      affected: { placementIds: [], sideIds: ['allies'], cells: [] },
      duration: { kind: 'turns', subject: 'target', boundary: 'start', remaining: 1 },
      ...uncharged,
    })
    const sideResult = applyEncounterEffectLifecycleEvent(
      { effects: [sideEffect] },
      { kind: 'turn-start', placementId: 'new-ally', sideId: 'allies' },
    )
    expect(sideResult.effects).toEqual([])

    for (const boundary of ['start', 'end'] as const) {
      const effect = effectFrom(capabilityEncounterEffectFixture(), {
        id: `effect.round-${boundary}`,
        duration: { kind: 'rounds', boundary, remaining: 2 },
      })
      const wrongEvent: EncounterEffectLifecycleEvent = {
        kind: boundary === 'start' ? 'round-end' : 'round-start',
      }
      expect(applyEncounterEffectLifecycleEvent({ effects: [effect] }, wrongEvent).changed)
        .toBe(false)

      const event: EncounterEffectLifecycleEvent = { kind: `round-${boundary}` }
      const decremented = applyEncounterEffectLifecycleEvent({ effects: [effect] }, event)
      expect(decremented.effects[0]?.duration).toEqual({
        kind: 'rounds',
        boundary,
        remaining: 1,
      })
      expect(applyEncounterEffectLifecycleEvent({ effects: decremented.effects }, event).effects)
        .toEqual([])
    }
  })

  it('expires scene and until-triggered effects while permanent effects require removal', () => {
    const scene = effectFrom(conditionEncounterEffectFixture(), {
      id: 'effect.scene',
      duration: { kind: 'scene', remaining: null },
      ...uncharged,
    })
    const triggered = effectFrom(numericEncounterEffectFixture(), {
      id: 'effect.triggered',
      ...uncharged,
    })
    const permanentEffect = effectFrom(capabilityEncounterEffectFixture(), {
      id: 'effect.permanent',
      duration: permanent,
    })

    const sceneEnded = applyEncounterEffectLifecycleEvent(
      { effects: [scene, triggered, permanentEffect] },
      { kind: 'scene-end' },
    )
    expect(sceneEnded.effects.map(effect => effect.id)).toEqual([
      'effect.triggered',
      'effect.permanent',
    ])

    const wrongTrigger = applyEncounterEffectLifecycleEvent(
      { effects: sceneEnded.effects },
      { kind: 'effect-triggered', effectId: 'effect.permanent' },
    )
    expect(wrongTrigger.changed).toBe(false)

    const consumed = applyEncounterEffectLifecycleEvent(
      { effects: wrongTrigger.effects },
      { kind: 'effect-triggered', effectId: 'effect.triggered' },
    )
    expect(consumed.effects.map(effect => effect.id)).toEqual(['effect.permanent'])
    expect(consumed.transitions[0]).toMatchObject({
      kind: 'expired',
      reasonCode: 'effect-triggered-expiry',
    })

    const afterBoundaries = [
      { kind: 'turn-start', placementId: 'actor-token' },
      { kind: 'turn-end', placementId: 'actor-token' },
      { kind: 'round-start' },
      { kind: 'round-end' },
      { kind: 'scene-end' },
    ].reduce(
      (state, event) => applyEncounterEffectLifecycleEvent(
        state,
        event as EncounterEffectLifecycleEvent,
      ),
      consumed,
    )
    expect(afterBoundaries.effects.map(effect => effect.id)).toEqual(['effect.permanent'])

    const removed = applyEncounterEffectLifecycleEvent(
      afterBoundaries,
      { kind: 'effect-removed', effectId: 'effect.permanent' },
    )
    expect(removed.effects).toEqual([])
    expect(removed.transitions[0]).toMatchObject({
      kind: 'removed',
      reasonCode: 'effect-explicitly-removed',
    })
  })

  it('consumes configured charges once per exact trigger and expires at depletion', () => {
    const charged = effectFrom(numericEncounterEffectFixture(), {
      id: 'effect.three-charges',
      duration: permanent,
      charges: 3,
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
    })

    const unrelated = applyEncounterEffectLifecycleEvent(
      { effects: [charged] },
      { kind: 'effect-triggered', effectId: 'effect.other' },
    )
    expect(unrelated.changed).toBe(false)
    expect(unrelated.effects[0]?.charges).toBe(3)

    const first = applyEncounterEffectLifecycleEvent(
      unrelated,
      { kind: 'effect-triggered', effectId: charged.id },
    )
    expect(first.effects[0]?.charges).toBe(2)
    expect(first.transitions[0]).toMatchObject({
      kind: 'charge-consumed',
      reasonCode: 'effect-charge-consumed',
    })

    const second = applyEncounterEffectLifecycleEvent(
      first,
      { kind: 'effect-triggered', effectId: charged.id },
    )
    const depleted = applyEncounterEffectLifecycleEvent(
      second,
      { kind: 'effect-triggered', effectId: charged.id },
    )
    expect(depleted.effects).toEqual([])
    expect(depleted.transitions[0]).toMatchObject({
      kind: 'expired',
      reasonCode: 'effect-charges-depleted',
    })
  })

  it('applies replace, refresh, additive max-stack, and independent-instance policies', () => {
    const replace = effectFrom(conditionEncounterEffectFixture(), {
      id: 'effect.replace',
      duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      ...uncharged,
      stackPolicy: { kind: 'replace', maxStacks: null },
    })
    const added = applyEncounterEffectLifecycleEvent(
      { effects: [] },
      { kind: 'effect-applied', effect: replace },
    )
    const replacement = effectFrom(replace, {
      createdTurn: 9,
      duration: { kind: 'rounds', boundary: 'end', remaining: 4 },
    })
    const replaced = applyEncounterEffectLifecycleEvent(
      added,
      { kind: 'effect-applied', effect: replacement },
    )
    expect(replaced.effects[0]).toEqual(replacement)
    expect(replaced.transitions[0]?.kind).toBe('replaced')

    const refresh = effectFrom(numericEncounterEffectFixture(), {
      id: 'effect.refresh',
      duration: { kind: 'rounds', boundary: 'start', remaining: 1 },
      charges: 2,
      stackPolicy: { kind: 'refresh', maxStacks: null },
    })
    const refreshInput = effectFrom(refresh, {
      source: { ...refresh.source, operationId: 'op_refresh_02' },
      createdRound: 8,
      createdTurn: 20,
      duration: { kind: 'rounds', boundary: 'start', remaining: 5 },
      charges: 9,
    })
    const refreshed = applyEncounterEffectLifecycleEvent(
      { effects: [refresh] },
      { kind: 'effect-applied', effect: refreshInput },
    )
    expect(refreshed.effects[0]).toMatchObject({
      source: { operationId: 'op_refresh_02' },
      createdRound: 8,
      createdTurn: 20,
      duration: { kind: 'rounds', boundary: 'start', remaining: 5 },
      charges: 2,
    })
    expect(refreshed.transitions[0]?.kind).toBe('refreshed')

    const stack = effectFrom(capabilityEncounterEffectFixture(), {
      id: 'effect.stack',
      duration: permanent,
      stacks: 1,
      stackPolicy: { kind: 'add-stack', maxStacks: 3 },
    })
    const stackInput = effectFrom(stack, { stacks: 2 })
    const stacked = applyEncounterEffectLifecycleEvent(
      { effects: [stack] },
      { kind: 'effect-applied', effect: stackInput },
    )
    expect(stacked.effects[0]?.stacks).toBe(3)
    expect(stacked.transitions[0]?.kind).toBe('stack-added')

    const capped = applyEncounterEffectLifecycleEvent(
      stacked,
      { kind: 'effect-applied', effect: stackInput },
    )
    expect(capped.changed).toBe(false)
    expect(capped.effects[0]?.stacks).toBe(3)
    expect(capped.transitions[0]?.kind).toBe('stack-capped')

    const independentA = effectFrom(capabilityEncounterEffectFixture(), {
      id: 'effect.independent-a',
      duration: permanent,
    })
    const independentB = effectFrom(independentA, { id: 'effect.independent-b' })
    const independent = applyEncounterEffectLifecycleEvent(
      { effects: [independentA] },
      { kind: 'effect-applied', effect: independentB },
    )
    expect(independent.effects.map(effect => effect.id)).toEqual([
      'effect.independent-a',
      'effect.independent-b',
    ])
    expect(() => applyEncounterEffectLifecycleEvent(
      independent,
      { kind: 'effect-applied', effect: independentB },
    )).toThrowError(expect.objectContaining({
      name: EncounterEffectLifecycleError.name,
      code: 'duplicate-independent-effect',
    }))
  })

  it('clears dangling suppression sources and returns immutable repeatable results', () => {
    const suppressor = effectFrom(capabilityEncounterEffectFixture(), {
      id: 'effect.suppressor',
      duration: permanent,
    })
    const suppressed = effectFrom(numericEncounterEffectFixture(), {
      id: 'effect.suppressed',
      duration: permanent,
      ...uncharged,
      suppression: {
        sources: [{ effectId: suppressor.id, reasonCode: 'effect.suppressed' }],
      },
    })
    const state = { effects: [suppressor, suppressed] }
    const event = { kind: 'effect-removed', effectId: suppressor.id } as const

    const first = applyEncounterEffectLifecycleEvent(state, event)
    const replay = applyEncounterEffectLifecycleEvent(state, event)

    expect(first).toEqual(replay)
    expect(first.effects).toHaveLength(1)
    expect(first.effects[0]?.suppression.sources).toEqual([])
    expect(first.transitions.map(entry => entry.kind)).toEqual([
      'removed',
      'suppression-cleared',
    ])
    expect(state.effects).toEqual([suppressor, suppressed])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.effects)).toBe(true)
    expect(Object.isFrozen(first.effects[0]?.suppression.sources)).toBe(true)
  })
})
