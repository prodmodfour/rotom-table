import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  planAbilityEffectLifecycleEvent,
  recoverAbilityEffectLifecycles,
  reduceAbilityEffectLifecycle,
  reduceAbilityEffectLifecycleEncounter,
} from '../../server/domain/abilityAutomation/effectLifecycle'
import {
  AbilityEffectLifecycleValidationError,
  parseAbilityEffectLifecycleState,
  type AbilityEffectDuration,
  type AbilityEffectLifecycleEntry,
} from '#shared/abilityAutomation/durations'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { numericEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const entry = (
  effectId: string,
  duration: AbilityEffectDuration,
  targetPlacementIds: readonly string[] = ['target-token'],
): AbilityEffectLifecycleEntry => ({
  effectId,
  sourcePlacementId: 'actor-token',
  sourceAbilityInstanceId: 'base:actor-token:0',
  targetPlacementIds,
  duration,
})

const state = (entries: readonly AbilityEffectLifecycleEntry[]) => ({
  schemaVersion: 1 as const,
  entries,
})

const context = (
  encounterState: ReturnType<typeof createEmptyEncounterState>,
): AuthoritativeAbilityContext => ({
  map: { slug: 'lifecycle-arena', revision: 9, encounterState },
} as unknown as AuthoritativeAbilityContext)

describe('ability effect game-event lifecycle', () => {
  it('strictly parses all supported duration kinds as detached immutable state', () => {
    const source = state([
      entry('effect.turn', {
        kind: 'turn', subject: 'source', subjectPlacementId: 'actor-token', boundary: 'end', remaining: 2,
      }),
      entry('effect.round', { kind: 'round', boundary: 'start', remaining: 3 }),
      entry('effect.scene', { kind: 'scene' }),
      entry('effect.source-presence', { kind: 'source-presence' }),
      entry('effect.source-ability', { kind: 'source-ability' }),
      entry('effect.target-presence', { kind: 'target-presence', policy: 'any-target-leaves' }),
      entry('effect.weather', { kind: 'weather', fieldId: 'weather.sun' }),
      entry('effect.terrain', { kind: 'terrain', fieldId: 'terrain.grassy' }),
      entry('effect.trigger', { kind: 'until-triggered', triggerId: 'trigger.damage' }),
    ])
    const parsed = parseAbilityEffectLifecycleState(source)
    ;(source.entries as AbilityEffectLifecycleEntry[]).splice(0, 1)

    expect(parsed.entries).toHaveLength(9)
    expect(parsed.entries.map(value => value.duration.kind)).toEqual([
      'turn', 'round', 'scene', 'source-presence', 'source-ability',
      'target-presence', 'weather', 'terrain', 'until-triggered',
    ])
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.entries[0]?.duration)).toBe(true)
  })

  it('advances and expires only matching turn and round boundaries', () => {
    const initial = state([
      entry('effect.turn', {
        kind: 'turn', subject: 'source', subjectPlacementId: 'actor-token', boundary: 'end', remaining: 2,
      }),
      entry('effect.round', { kind: 'round', boundary: 'start', remaining: 1 }),
    ])
    const unrelated = reduceAbilityEffectLifecycle(initial, {
      kind: 'turn-boundary', placementId: 'target-token', boundary: 'end',
    })
    expect(unrelated.transitions).toEqual([])

    const turn = reduceAbilityEffectLifecycle(initial, {
      kind: 'turn-boundary', placementId: 'actor-token', boundary: 'end',
    })
    expect(turn.transitions).toEqual([{
      effectId: 'effect.turn',
      kind: 'advanced',
      reasonCode: 'ability-duration.turn-advanced',
      remaining: 1,
    }])

    const round = reduceAbilityEffectLifecycle(turn.state, {
      kind: 'round-boundary', boundary: 'start',
    })
    expect(round.expiredEffectIds).toEqual(['effect.round'])
    expect(round.transitions[0]).toMatchObject({
      kind: 'expired', reasonCode: 'ability-duration.round-expired',
    })

    const expiredTurn = reduceAbilityEffectLifecycle(round.state, {
      kind: 'turn-boundary', placementId: 'actor-token', boundary: 'end',
    })
    expect(expiredTurn.expiredEffectIds).toEqual(['effect.turn'])
  })

  it('expires source and target presence policies from authoritative snapshots', () => {
    const initial = state([
      entry('effect.source', { kind: 'source-presence' }),
      entry('effect.any', { kind: 'target-presence', policy: 'any-target-leaves' }, ['target-a', 'target-b']),
      entry('effect.all', { kind: 'target-presence', policy: 'all-targets-leave' }, ['target-a', 'target-b']),
    ])
    const oneTarget = reduceAbilityEffectLifecycle(initial, {
      kind: 'presence-snapshot', presentPlacementIds: ['actor-token', 'target-a'],
    })
    expect(oneTarget.expiredEffectIds).toEqual(['effect.any'])

    const none = reduceAbilityEffectLifecycle(oneTarget.state, {
      kind: 'presence-snapshot', presentPlacementIds: [],
    })
    expect(none.expiredEffectIds).toEqual(['effect.source', 'effect.all'])
    expect(none.transitions.map(value => value.reasonCode)).toEqual([
      'ability-duration.source-left',
      'ability-duration.target-left',
    ])
  })

  it('expires source-ability, weather, terrain, and exact triggered dependencies', () => {
    const initial = state([
      entry('effect.ability', { kind: 'source-ability' }),
      entry('effect.weather', { kind: 'weather', fieldId: 'weather.sun' }),
      entry('effect.terrain', { kind: 'terrain', fieldId: 'terrain.grassy' }),
      entry('effect.trigger', { kind: 'until-triggered', triggerId: 'trigger.hit' }),
    ])
    const ability = reduceAbilityEffectLifecycle(initial, {
      kind: 'effective-ability-snapshot',
      placementId: 'actor-token',
      activeAbilityInstanceIds: [],
    })
    expect(ability.expiredEffectIds).toEqual(['effect.ability'])

    const field = reduceAbilityEffectLifecycle(ability.state, {
      kind: 'field-snapshot',
      weatherIds: ['weather.sun'],
      terrainIds: [],
    })
    expect(field.expiredEffectIds).toEqual(['effect.terrain'])

    const wrongTrigger = reduceAbilityEffectLifecycle(field.state, {
      kind: 'triggered', effectId: 'effect.trigger', triggerId: 'trigger.miss',
    })
    expect(wrongTrigger.transitions).toEqual([])
    const trigger = reduceAbilityEffectLifecycle(wrongTrigger.state, {
      kind: 'triggered', effectId: 'effect.trigger', triggerId: 'trigger.hit',
    })
    expect(trigger.expiredEffectIds).toEqual(['effect.trigger'])

    const weather = reduceAbilityEffectLifecycle(trigger.state, {
      kind: 'field-snapshot', weatherIds: [], terrainIds: [],
    })
    expect(weather.expiredEffectIds).toEqual(['effect.weather'])
  })

  it('expires every encounter-local duration on scene end', () => {
    const initial = state([
      entry('effect.scene', { kind: 'scene' }),
      entry('effect.presence', { kind: 'source-presence' }),
      entry('effect.trigger', { kind: 'until-triggered', triggerId: 'trigger.hit' }),
    ])
    const reduced = reduceAbilityEffectLifecycle(initial, { kind: 'scene-end' })

    expect(reduced.expiredEffectIds).toEqual([
      'effect.scene', 'effect.presence', 'effect.trigger',
    ])
    expect(reduced.transitions.every(value => (
      value.reasonCode === 'ability-duration.scene-expired'
    ))).toBe(true)
  })

  it('removes effect payload and lifecycle ownership in one revision-checked plan', () => {
    const effect = numericEncounterEffectFixture()
    const encounter = {
      ...createEmptyEncounterState(),
      effects: [effect],
      abilityEffectLifecycle: state([entry(effect.id, { kind: 'scene' })]),
    }
    const planned = planAbilityEffectLifecycleEvent({
      context: context(encounter),
      event: { kind: 'scene-end' },
      operationId: 'operation.scene-end',
    })
    const change = planned.plan.changes[0]

    expect(change).toMatchObject({
      kind: 'encounter-state',
      expectedRevision: 9,
      reasonCode: 'ability-effects.lifecycle-event',
      current: {
        effects: [],
        abilityEffectLifecycle: { entries: [] },
      },
    })
    expect(planned.transitions).toEqual([expect.objectContaining({ effectId: effect.id })])

    const current = change!.current as ReturnType<typeof createEmptyEncounterState>
    expect(planAbilityEffectLifecycleEvent({
      context: context(current),
      event: { kind: 'scene-end' },
      operationId: 'operation.scene-end-retry',
    }).plan.changes).toEqual([])
  })

  it('reconciles stale persisted dependencies after restart', () => {
    const encounter = {
      ...createEmptyEncounterState(),
      abilityEffectLifecycle: state([
        entry('effect.source', { kind: 'source-presence' }),
        entry('effect.ability', { kind: 'source-ability' }),
        entry('effect.weather', { kind: 'weather', fieldId: 'weather.sun' }),
      ]),
    }
    const recovered = recoverAbilityEffectLifecycles(
      JSON.parse(JSON.stringify(encounter)),
      {
        presentPlacementIds: ['actor-token', 'target-token'],
        activeAbilityInstanceIdsByPlacement: new Map([['actor-token', []]]),
        weatherIds: [],
        terrainIds: [],
      },
    )

    expect(recovered.abilityEffectLifecycle?.entries.map(value => value.effectId)).toEqual([
      'effect.source',
    ])
  })

  it('rejects duplicate IDs, invalid target subjects, unknown fields, and callbacks', () => {
    const valid = entry('effect.valid', { kind: 'target-presence', policy: 'any-target-leaves' })
    expect(() => parseAbilityEffectLifecycleState(state([valid, valid])))
      .toThrow(AbilityEffectLifecycleValidationError)
    expect(() => parseAbilityEffectLifecycleState(state([entry('effect.bad-turn', {
      kind: 'turn', subject: 'target', subjectPlacementId: 'other-token', boundary: 'end', remaining: 1,
    })]))).toThrow(AbilityEffectLifecycleValidationError)
    expect(() => parseAbilityEffectLifecycleState({
      ...state([valid]),
      unknown: true,
    })).toThrow(AbilityEffectLifecycleValidationError)
    expect(() => parseAbilityEffectLifecycleState({
      ...state([valid]),
      callback: () => true,
    })).toThrow(AbilityEffectLifecycleValidationError)
  })

  it('keeps encounter reduction deterministic when payload effects are already absent', () => {
    const encounter = {
      ...createEmptyEncounterState(),
      abilityEffectLifecycle: state([entry('effect.absent', { kind: 'scene' })]),
    }
    const reduced = reduceAbilityEffectLifecycleEncounter(encounter, { kind: 'scene-end' })
    expect(reduced.encounter.abilityEffectLifecycle?.entries).toEqual([])
    expect(reduced.encounter.effects).toEqual([])
  })
})
