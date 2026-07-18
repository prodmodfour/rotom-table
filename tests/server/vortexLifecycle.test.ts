import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
  type EncounterTurnEvent,
} from '#shared/moveAutomation/events'
import {
  createEmptyEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import { createAuthoritativeMoveRandom, createFiniteAuthoritativeMoveRandomStream } from '~~/server/domain/moveAutomation/random'
import { reduceEncounterLifecycle } from '~~/server/domain/moveAutomation/reduceLifecycle'
import {
  SAND_TOMB_VORTEX_DEFINITION,
  VORTEX_REASON_CODES,
  createVortexEffect,
  createVortexLifecycleHandler,
  isVortexEffect,
  vortexCurrentEscapeDc,
} from '~~/server/domain/moveAutomation/vortex'
import { applyEncounterEffectLifecycleEvent } from '~~/server/domain/moveAutomation/effectLifecycle'
import { projectEffectiveConditions } from '~/utils/encounterConditions'

const vortex = (overrides: {
  readonly sourcePlacementId?: string
  readonly createdRound?: number
} = {}) => createVortexEffect({
  definition: SAND_TOMB_VORTEX_DEFINITION,
  operationId: 'sand-tomb.vortex',
  moveId: 'move.sand-tomb',
  sourcePlacementId: overrides.sourcePlacementId ?? 'actor-token',
  targetPlacementId: 'target-token',
  createdRound: overrides.createdRound ?? 1,
  createdTurn: 0,
})

const turnEnd = (ordinal: number): EncounterTurnEvent => parseEncounterEvent({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: `event.vortex.turn-end.${ordinal}`,
  kind: 'turn-end',
  sourceOperationId: `initiative.vortex.${ordinal}`,
  causalParentEventId: null,
  reasonCode: 'initiative.turn-end',
  round: ordinal,
  turn: ordinal,
  placementId: 'target-token',
  sideId: null,
}) as EncounterTurnEvent

describe('shared Vortex lifecycle', () => {
  it('projects Slowed and Trapped from one effect and replaces it with refreshed source state', () => {
    const original = vortex()
    const replacement = vortex({ sourcePlacementId: 'replacement-source', createdRound: 3 })
    const projection = projectEffectiveConditions({
      sheetConditions: [],
      encounterEffects: [original],
      target: { placementId: 'target-token' },
    })

    expect(projection.conditions).toEqual(['Slowed', 'Trapped'])
    expect(projection.modifiers.map(({ condition, effect }) => [condition, effect.id])).toEqual([
      ['Slowed', original.id],
      ['Trapped', original.id],
    ])

    const replaced = applyEncounterEffectLifecycleEvent(
      { effects: [original] },
      { kind: 'effect-applied', effect: replacement },
    )
    expect(replaced.transitions.map(transition => transition.kind)).toEqual(['replaced'])
    expect(replaced.effects).toEqual([replacement])
    expect(replaced.effects[0]).toMatchObject({
      source: { placementId: 'replacement-source' },
      createdRound: 3,
      charges: 4,
    })
    expect(original.charges).toBe(4)
  })

  it('ticks once, records the DC 20 roll, consumes an attempt, and escapes on success', () => {
    const effect = vortex()
    const random = createAuthoritativeMoveRandom(createFiniteAuthoritativeMoveRandomStream([0.999]))
    const result = reduceEncounterLifecycle(
      { ...createEmptyEncounterState(), effects: [effect] },
      [turnEnd(1)],
      [createVortexLifecycleHandler()],
      random,
    )
    const ledger = random.complete()

    expect(result.operations).toEqual([
      expect.objectContaining({
        kind: 'direct-hp',
        source: { kind: 'encounter-effect', id: effect.id },
        reasonCode: VORTEX_REASON_CODES.tick,
        payload: expect.objectContaining({
          calculation: { kind: 'percent-max', percent: 10 },
        }),
      }),
    ])
    expect(ledger).toEqual([
      expect.objectContaining({
        parentEffectId: effect.id,
        naturalResult: 20,
        finalValue: 20,
        reason: 'Vortex escape check DC 20',
      }),
    ])
    expect(result.state.effects).toEqual([])
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'trigger', reasonCode: VORTEX_REASON_CODES.escapeSucceeded }),
      expect.objectContaining({ kind: 'operation-enqueued', reasonCode: VORTEX_REASON_CODES.tick }),
    ]))
  })

  it('uses 20, 14, 8, and 2 in order, then wears off after the fourth failed save', () => {
    const random = createAuthoritativeMoveRandom(
      createFiniteAuthoritativeMoveRandomStream([0, 0.6, 0.3, 0]),
    )
    let state: EncounterState = { ...createEmptyEncounterState(), effects: [vortex()] }
    const observedDcs: number[] = []
    const reasons: string[] = []

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const active = state.effects.find(isVortexEffect)
      expect(active).toBeDefined()
      observedDcs.push(vortexCurrentEscapeDc(active!))
      const result = reduceEncounterLifecycle(
        state,
        [turnEnd(attempt)],
        [createVortexLifecycleHandler()],
        random,
      )
      reasons.push(result.trace.find(entry => entry.kind === 'trigger')!.reasonCode)
      expect(result.operations).toHaveLength(1)
      state = result.state
    }

    expect(observedDcs).toEqual([20, 14, 8, 2])
    expect(random.complete().map(entry => entry.naturalResult)).toEqual([1, 13, 7, 1])
    expect(reasons).toEqual([
      VORTEX_REASON_CODES.escapeFailed,
      VORTEX_REASON_CODES.escapeFailed,
      VORTEX_REASON_CODES.escapeFailed,
      VORTEX_REASON_CODES.attemptsExhausted,
    ])
    expect(state.effects).toEqual([])
    expect(projectEffectiveConditions({
      sheetConditions: [],
      encounterEffects: state.effects,
      target: { placementId: 'target-token' },
    }).conditions).toEqual([])
  })

  it('does not tick, roll, or consume a suppressed Vortex', () => {
    const suppressor = {
      ...vortex(),
      id: 'vortex.suppressor',
      kind: 'capability' as const,
      charges: null,
      chargePolicy: { kind: 'none' as const, amount: null },
      tags: ['suppression'],
      payload: { capabilityId: 'vortex-suppression', action: 'grant' as const },
      dispel: { policy: 'none' as const, tags: [] },
    }
    const effect = {
      ...vortex(),
      suppression: {
        sources: [{ effectId: suppressor.id, reasonCode: 'vortex.suppressed' }],
      },
    }
    const random = createAuthoritativeMoveRandom(createFiniteAuthoritativeMoveRandomStream([]))
    const result = reduceEncounterLifecycle(
      { ...createEmptyEncounterState(), effects: [suppressor, effect] },
      [turnEnd(1)],
      [createVortexLifecycleHandler()],
      random,
    )

    expect(result.operations).toEqual([])
    expect(result.state.effects.find(isVortexEffect)?.charges).toBe(4)
    expect(random.complete()).toEqual([])
  })
})
