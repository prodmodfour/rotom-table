import { describe, expect, it } from 'vitest'
import type { MoveSpecCostDeclaration } from '#shared/moveAutomation/spec'
import {
  resolveAuthoritativeMoveActionTiming,
} from '~~/server/domain/moveAutomation/actionTiming'

const reviewedCost = (
  resource: 'standard' | 'interrupt' | 'reaction',
): MoveSpecCostDeclaration => ({
  id: `cost.${resource}`,
  phase: 'pay',
  cost: { kind: 'action-resource', resource, amount: 1 },
})

describe('authoritative move action timing', () => {
  it.each([
    ['Melee, 1 Target, Priority', 'priority'],
    ['Melee, 1 Target, Priority (Advanced)', 'priority'],
    ['Trigger, Interrupt', 'interrupt'],
    ['Trigger, Reaction', 'reaction'],
    ['Melee, 1 Target', 'ordinary'],
  ] as const)('classifies reviewed legacy range %s as %s', (range, expected) => {
    expect(resolveAuthoritativeMoveActionTiming({ range })).toBe(expected)
  })

  it('prefers native reviewed costs over compatibility range text', () => {
    expect(resolveAuthoritativeMoveActionTiming({
      range: 'Melee, 1 Target',
      reviewedCosts: [{
        id: 'cost.priority',
        phase: 'pay',
        cost: { kind: 'priority', mode: 'standard' },
      }],
    })).toBe('priority')
    expect(resolveAuthoritativeMoveActionTiming({
      range: 'Melee, 1 Target',
      reviewedCosts: [reviewedCost('interrupt')],
    })).toBe('interrupt')
    expect(resolveAuthoritativeMoveActionTiming({
      range: 'Melee, 1 Target',
      reviewedCosts: [reviewedCost('reaction')],
    })).toBe('reaction')
    expect(resolveAuthoritativeMoveActionTiming({
      range: 'Melee, 1 Target, Priority',
      reviewedCosts: [reviewedCost('standard')],
    })).toBe('ordinary')
  })
})
