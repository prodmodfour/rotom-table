import { describe, expect, it } from 'vitest'
import {
  moveAutomationAreaDirectionFromDelta,
  moveAutomationAreaDirectionFromPoint,
} from '~/utils/moveAutomationAreaAiming'

describe('move automation area aiming', () => {
  it.each([
    [{ x: 1, z: 0 }, 'east'],
    [{ x: 1, z: 1 }, 'south-east'],
    [{ x: 0, z: 1 }, 'south'],
    [{ x: -1, z: 1 }, 'south-west'],
    [{ x: -1, z: 0 }, 'west'],
    [{ x: -1, z: -1 }, 'north-west'],
    [{ x: 0, z: -1 }, 'north'],
    [{ x: 1, z: -1 }, 'north-east'],
  ] as const)('maps a pointer delta %o to %s', (delta, direction) => {
    expect(moveAutomationAreaDirectionFromDelta(delta)).toBe(direction)
  })

  it('uses the nearest octant for off-axis pointer positions', () => {
    expect(moveAutomationAreaDirectionFromDelta({ x: 5, z: 1 })).toBe('east')
    expect(moveAutomationAreaDirectionFromDelta({ x: 2, z: 5 })).toBe('south')
    expect(moveAutomationAreaDirectionFromDelta({ x: -4, z: -2 })).toBe('north-west')
  })

  it('ignores points inside the aim dead zone', () => {
    expect(moveAutomationAreaDirectionFromDelta({ x: 0.1, z: 0.1 })).toBeNull()
    expect(moveAutomationAreaDirectionFromPoint({ x: 3, z: 3 }, { x: 3.1, z: 3.1 })).toBeNull()
  })

  it('derives the pointer direction around an origin point', () => {
    expect(moveAutomationAreaDirectionFromPoint({ x: 3.5, z: 3.5 }, { x: 2, z: 2 })).toBe('north-west')
  })
})
