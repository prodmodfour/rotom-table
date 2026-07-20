import { describe, expect, it } from 'vitest'
import {
  advancePendingTokenMovementPath,
  createPendingTokenMovementPath,
} from '~/utils/isometric/pendingTokenMovementPath'

const route = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 3, y: 0, z: 0 },
] as const

describe('pending token movement path', () => {
  it('rejects a route that does not end at its intended destination', () => {
    expect(createPendingTokenMovementPath({
      destination: { x: 4, y: 0, z: 0 },
      path: route,
    })).toBeNull()
  })

  it('keeps the whole route while a pre-step interruption remains at its origin', () => {
    const pending = createPendingTokenMovementPath({
      destination: route[3],
      path: route,
    })!

    const advanced = advancePendingTokenMovementPath(pending, route[0])

    expect(advanced.animationPath).toBeUndefined()
    expect(advanced.remaining).toEqual(pending)
  })

  it('returns only the committed prefix and retains the forward suffix at a checkpoint', () => {
    const pending = createPendingTokenMovementPath({
      destination: route[3],
      path: route,
    })!

    const checkpoint = advancePendingTokenMovementPath(pending, route[2])

    expect(checkpoint.animationPath).toEqual(route.slice(0, 3))
    expect(checkpoint.remaining).toEqual({
      destination: route[3],
      path: route.slice(2),
    })

    const resumed = advancePendingTokenMovementPath(checkpoint.remaining!, route[3])
    expect(resumed.animationPath).toEqual(route.slice(2))
    expect(resumed.remaining).toBeNull()
  })

  it('drops stale route presentation when authority moves somewhere outside the route', () => {
    const pending = createPendingTokenMovementPath({
      destination: route[3],
      path: route,
    })!

    expect(advancePendingTokenMovementPath(pending, { x: 9, y: 0, z: 9 })).toEqual({
      remaining: null,
    })
  })
})
