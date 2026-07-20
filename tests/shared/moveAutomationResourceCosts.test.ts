import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_ACTION_TYPES,
} from '#shared/moveAutomation/encounterResources'
import {
  MOVE_RESOURCE_COST_LIMITS,
  MoveResourceCostValidationError,
  parseMoveResourceCost,
  validateMoveResourceCostCombination,
  type MoveResourceCost,
} from '#shared/moveAutomation/resourceCosts'

const expectCostError = (
  run: () => unknown,
  code: MoveResourceCostValidationError['code'],
  path?: string,
): void => {
  try {
    run()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveResourceCostValidationError)
    expect(error).toMatchObject({ code, ...(path ? { path } : {}) })
  }
}

describe('reviewed move resource cost contract', () => {
  it('parses and freezes every bounded action and special cost family', () => {
    const costs: MoveResourceCost[] = [
      ...ENCOUNTER_ACTION_TYPES.map(resource => parseMoveResourceCost({
        kind: 'action-resource',
        resource,
        amount: 1,
      })),
      parseMoveResourceCost({ kind: 'movement-distance', amount: 'resolved-distance' }),
      parseMoveResourceCost({ kind: 'movement-distance', amount: 4 }),
      parseMoveResourceCost({ kind: 'once-per-turn', flagId: 'move.test-once' }),
      parseMoveResourceCost({ kind: 'exhaust', timing: 'next-turn', forfeitCommand: true }),
      parseMoveResourceCost({ kind: 'setup-execute', step: 'set-up' }),
      parseMoveResourceCost({ kind: 'setup-execute', step: 'execute' }),
      parseMoveResourceCost({ kind: 'setup-execute', step: 'auto' }),
      parseMoveResourceCost({ kind: 'priority', mode: 'standard' }),
      parseMoveResourceCost({ kind: 'priority', mode: 'limited' }),
      parseMoveResourceCost({ kind: 'priority', mode: 'advanced' }),
      parseMoveResourceCost({ kind: 'no-cost', reasonCode: 'move.triggered-child' }),
    ]

    expect(costs.slice(0, ENCOUNTER_ACTION_TYPES.length).map(cost => (
      cost.kind === 'action-resource' ? cost.resource : null
    ))).toEqual(ENCOUNTER_ACTION_TYPES)
    expect(costs.every(Object.isFrozen)).toBe(true)
    expect(structuredClone(costs)).toEqual(costs)
    expect(JSON.parse(JSON.stringify(costs))).toEqual(costs)
  })

  it('rejects unknown, unbounded, and client-authored mechanics', () => {
    expectCostError(
      () => parseMoveResourceCost({ kind: 'client-script', patch: { standard: 0 } }),
      'unknown-resource-cost',
      'moveResourceCost.kind',
    )
    expectCostError(
      () => parseMoveResourceCost({
        kind: 'action-resource', resource: 'standard', amount: 1, patch: {},
      }),
      'invalid-resource-cost',
      'moveResourceCost',
    )
    expectCostError(
      () => parseMoveResourceCost({ kind: 'action-resource', resource: 'bonus', amount: 1 }),
      'invalid-resource-cost',
      'moveResourceCost.resource',
    )
    expectCostError(
      () => parseMoveResourceCost({ kind: 'movement-distance', amount: 0 }),
      'limit-exceeded',
      'moveResourceCost.amount',
    )
    expectCostError(
      () => parseMoveResourceCost({
        kind: 'movement-distance', amount: MOVE_RESOURCE_COST_LIMITS.amount + 1,
      }),
      'limit-exceeded',
      'moveResourceCost.amount',
    )
    expectCostError(
      () => parseMoveResourceCost({ kind: 'once-per-turn', flagId: 'Not Stable' }),
      'invalid-resource-cost',
      'moveResourceCost.flagId',
    )
  })

  it('does not execute accessors while rejecting non-data fields', () => {
    let accessed = false
    const input = Object.defineProperty({}, 'kind', {
      enumerable: true,
      get: () => {
        accessed = true
        return 'no-cost'
      },
    })

    expectCostError(
      () => parseMoveResourceCost(input),
      'invalid-resource-cost',
      'moveResourceCost.kind',
    )
    expect(accessed).toBe(false)
  })

  it('rejects resource combinations that cannot produce one authoritative plan', () => {
    const action = (resource: typeof ENCOUNTER_ACTION_TYPES[number]): MoveResourceCost => ({
      kind: 'action-resource', resource, amount: 1,
    })

    expectCostError(
      () => validateMoveResourceCostCombination([action('standard'), action('standard')]),
      'duplicate-resource-cost',
      'moveResourceCosts',
    )
    expectCostError(
      () => validateMoveResourceCostCombination([action('full'), action('shift')]),
      'conflicting-resource-cost',
      'moveResourceCosts',
    )
    expectCostError(
      () => validateMoveResourceCostCombination([action('interrupt'), action('reaction')]),
      'conflicting-resource-cost',
      'moveResourceCosts',
    )
    expectCostError(
      () => validateMoveResourceCostCombination([
        action('standard'),
        { kind: 'no-cost', reasonCode: 'move.exception' },
      ]),
      'conflicting-resource-cost',
      'moveResourceCosts',
    )
    expectCostError(
      () => validateMoveResourceCostCombination([
        { kind: 'once-per-turn', flagId: 'move.once' },
        { kind: 'once-per-turn', flagId: 'move.once' },
      ]),
      'duplicate-resource-cost',
      'moveResourceCosts',
    )
  })
})
