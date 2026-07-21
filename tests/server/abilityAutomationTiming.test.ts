import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  AbilityTimingPaymentError,
  planAbilitySceneResourceTransition,
  planAbilityTimingPayment,
  recoverAbilityEncounterResources,
} from '../../server/domain/abilityAutomation/timing'
import {
  AbilityTimingValidationError,
  advanceAbilityTimingWindows,
  beginAbilityTimingScene,
  createEmptyAbilityTimingLedger,
  parseAbilityTimingLedger,
  type AbilityTimingCursor,
} from '#shared/abilityAutomation/timingResources'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseAbilitySceneUsageLedger } from '#shared/abilityAutomation/resources'

const cursor = (input: Partial<AbilityTimingCursor> = {}): AbilityTimingCursor => ({
  sceneId: 'scene.one',
  roundId: 'round.one',
  roundSequence: 1,
  turnId: 'turn.actor.1',
  turnSequence: 1,
  ...input,
})

const context = (
  encounterState = createEmptyEncounterState(),
): AuthoritativeAbilityContext => ({
  runtime: { canonicalId: 'Illusion' },
  actor: {
    placement: { id: 'actor-token' },
    effectiveAbilities: [{
      instanceId: 'base:actor-token:0',
      canonicalId: 'Illusion',
      sourceKind: 'base',
      sourcePlacementId: null,
      definitionHash: null,
      effective: true,
      suppressionReasonCode: null,
    }],
  },
  map: { slug: 'timing-arena', revision: 7, encounterState },
} as unknown as AuthoritativeAbilityContext)

const plan = (input: {
  readonly context?: AuthoritativeAbilityContext
  readonly cursor?: AbilityTimingCursor
  readonly operationId?: string
  readonly constraint?:
    | { readonly id: string; readonly kind: 'round' | 'turn'; readonly limit: number }
    | { readonly id: string; readonly kind: 'cooldown'; readonly unit: 'round' | 'turn'; readonly delay: number }
} = {}) => planAbilityTimingPayment({
  context: input.context ?? context(),
  cursor: input.cursor ?? cursor(),
  abilityInstanceId: 'base:actor-token:0',
  operationId: input.operationId ?? 'operation.timing-1',
  constraint: input.constraint ?? { id: 'assume-guise', kind: 'round', limit: 1 },
})

const currentEncounter = (
  payment: ReturnType<typeof planAbilityTimingPayment>,
): ReturnType<typeof createEmptyEncounterState> => (
  payment.plan.changes[0]!.current as ReturnType<typeof createEmptyEncounterState>
)

const expectPaymentError = (callback: () => unknown, code: string): void => {
  try {
    callback()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityTimingPaymentError)
    expect((error as AbilityTimingPaymentError).code).toBe(code)
  }
}

describe('ability round, turn, and cooldown resources', () => {
  it('parses detached bounded timing state and advances windows monotonically', () => {
    const empty = createEmptyAbilityTimingLedger()
    const scene = beginAbilityTimingScene(empty, 'scene.one')
    const roundOne = advanceAbilityTimingWindows(scene, cursor())
    const roundTwo = advanceAbilityTimingWindows(roundOne, cursor({
      roundId: 'round.two',
      roundSequence: 2,
      turnId: null,
      turnSequence: null,
    }))

    expect(parseAbilityTimingLedger(empty)).not.toBe(empty)
    expect(Object.isFrozen(parseAbilityTimingLedger(empty))).toBe(true)
    expect(roundOne).toMatchObject({
      sceneId: 'scene.one',
      round: { windowId: 'round.one', sequence: 1 },
      turn: { windowId: 'turn.actor.1', sequence: 1 },
    })
    expect(roundTwo.round.uses).toEqual([])
    expect(roundTwo.turn).toEqual({ windowId: null, sequence: null, uses: [] })
    expect(() => advanceAbilityTimingWindows(roundTwo, cursor())).toThrow(AbilityTimingValidationError)
  })

  it('enforces once-per-round and returns exact retries after a reset', () => {
    const first = plan()
    expect(first).toMatchObject({
      status: 'paid',
      constraintKind: 'round',
      spent: 1,
      limit: 1,
      readySequence: null,
    })
    expect(currentEncounter(first).abilityTiming).toMatchObject({
      sceneId: 'scene.one',
      round: { uses: [expect.objectContaining({ constraintId: 'assume-guise', spent: 1 })] },
      receipts: [expect.objectContaining({
        operationId: 'operation.timing-1',
        spent: 1,
        limit: 1,
      })],
    })

    expectPaymentError(() => plan({
      context: context(currentEncounter(first)),
      operationId: 'operation.timing-2',
    }), 'limit-exhausted')

    const secondRound = plan({
      context: context(currentEncounter(first)),
      cursor: cursor({
        roundId: 'round.two',
        roundSequence: 2,
        turnId: 'turn.actor.2',
        turnSequence: 2,
      }),
      operationId: 'operation.timing-2',
    })
    expect(secondRound.status).toBe('paid')

    const retryAfterReset = plan({
      context: context(currentEncounter(secondRound)),
      cursor: cursor({
        roundId: 'round.two',
        roundSequence: 2,
        turnId: 'turn.actor.2',
        turnSequence: 2,
      }),
      operationId: 'operation.timing-1',
    })
    expect(retryAfterReset).toMatchObject({ status: 'duplicate', spent: 1, limit: 1 })
    expect(retryAfterReset.plan.changes).toEqual([])
  })

  it('resets once-per-turn limits at the authoritative turn cursor', () => {
    const constraint = { id: 'berry-trade', kind: 'turn', limit: 1 } as const
    const first = plan({ constraint })
    expectPaymentError(() => plan({
      context: context(currentEncounter(first)),
      operationId: 'operation.turn-2',
      constraint,
    }), 'limit-exhausted')

    const nextTurn = plan({
      context: context(currentEncounter(first)),
      cursor: cursor({ turnId: 'turn.target.1', turnSequence: 2 }),
      operationId: 'operation.turn-2',
      constraint,
    })
    expect(nextTurn).toMatchObject({ status: 'paid', spent: 1, limit: 1 })
  })

  it('delays reavailability by authoritative round or turn sequence', () => {
    const constraint = { id: 'sample-delay', kind: 'cooldown', unit: 'round', delay: 2 } as const
    const first = plan({ constraint })
    expect(first).toMatchObject({ status: 'paid', readySequence: 3 })

    expectPaymentError(() => plan({
      context: context(currentEncounter(first)),
      cursor: cursor({ roundId: 'round.two', roundSequence: 2 }),
      operationId: 'operation.cooldown-2',
      constraint,
    }), 'cooldown-active')

    const ready = plan({
      context: context(currentEncounter(first)),
      cursor: cursor({
        roundId: 'round.three',
        roundSequence: 3,
        turnId: 'turn.actor.3',
        turnSequence: 3,
      }),
      operationId: 'operation.cooldown-2',
      constraint,
    })
    expect(ready).toMatchObject({ status: 'paid', readySequence: 5 })

    const oldRetry = plan({
      context: context(currentEncounter(ready)),
      cursor: cursor({
        roundId: 'round.three',
        roundSequence: 3,
        turnId: 'turn.actor.3',
        turnSequence: 3,
      }),
      operationId: 'operation.timing-1',
      constraint,
    })
    expect(oldRetry).toMatchObject({ status: 'duplicate', readySequence: 3 })
  })

  it('resets Scene and timing resources together at explicit scene transitions', () => {
    const timed = currentEncounter(plan())
    const withSceneUse = {
      ...timed,
      abilityOwnedState: {
        schemaVersion: 1 as const,
        entries: [{
          stateId: 'state.scene-mode',
          version: 1,
          ownerPlacementId: 'actor-token',
          sourceAbilityInstanceId: 'base:actor-token:0',
          canonicalId: 'Illusion',
          targetPlacementIds: [],
          lifecycle: { kind: 'scene' as const, targetPolicy: null },
          payload: { kind: 'mode' as const, modeId: 'active' },
          createdOperationId: 'operation.state-create',
          lastOperationId: 'operation.state-create',
        }],
        receipts: [],
      },
      abilityEffectLifecycle: {
        schemaVersion: 1 as const,
        entries: [{
          effectId: 'effect.scene-bound',
          sourcePlacementId: 'actor-token',
          sourceAbilityInstanceId: 'base:actor-token:0',
          targetPlacementIds: [],
          duration: { kind: 'scene' as const },
        }],
      },
      abilityUsage: parseAbilitySceneUsageLedger({
        schemaVersion: 1,
        sceneId: 'scene.one',
        entries: [{
          ownerId: 'actor-token',
          abilityInstanceId: 'base:actor-token:0',
          canonicalId: 'Illusion',
          clauseId: 'base',
          limit: 1,
          spent: 1,
          operationIds: ['operation.scene-use'],
        }],
      }),
    }
    const transition = planAbilitySceneResourceTransition({
      context: context(withSceneUse),
      sceneId: 'scene.two',
      operationId: 'operation.scene-transition',
    })
    const next = transition.changes[0]!.current as ReturnType<typeof createEmptyEncounterState>

    expect(next.abilityUsage).toEqual({ schemaVersion: 1, sceneId: 'scene.two', entries: [] })
    expect(next.abilityEffectLifecycle?.entries).toEqual([])
    expect(next.abilityOwnedState).toEqual({ schemaVersion: 1, entries: [], receipts: [] })
    expect(next.abilityTiming).toEqual({
      schemaVersion: 1,
      sceneId: 'scene.two',
      round: { windowId: null, sequence: null, uses: [] },
      turn: { windowId: null, sequence: null, uses: [] },
      cooldowns: [],
      receipts: [],
    })
    expect(planAbilitySceneResourceTransition({
      context: context(next),
      sceneId: 'scene.two',
      operationId: 'operation.scene-transition-retry',
    }).changes).toEqual([])
  })

  it('recovers persisted timing state without losing receipts or accepting regression', () => {
    const first = plan()
    const serialized = JSON.parse(JSON.stringify(currentEncounter(first)))
    const recovered = recoverAbilityEncounterResources(serialized, cursor({
      roundId: 'round.two',
      roundSequence: 2,
      turnId: 'turn.actor.2',
      turnSequence: 2,
    }))

    expect(recovered.abilityTiming?.round.uses).toEqual([])
    expect(recovered.abilityTiming?.receipts).toHaveLength(1)
    expect(() => recoverAbilityEncounterResources(recovered, cursor())).toThrow(
      AbilityTimingValidationError,
    )
  })

  it('rejects cross-resource operation reuse and malformed timing state', () => {
    const first = plan()
    expectPaymentError(() => plan({
      context: context(currentEncounter(first)),
      operationId: 'operation.timing-1',
      constraint: { id: 'other-constraint', kind: 'round', limit: 1 },
    }), 'operation-id-conflict')

    expect(() => parseAbilityTimingLedger({
      ...createEmptyAbilityTimingLedger(),
      sceneId: 'scene.one',
      round: { windowId: 'round.one', sequence: null, uses: [] },
    })).toThrow(AbilityTimingValidationError)
  })
})
