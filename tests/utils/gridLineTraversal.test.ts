import { describe, expect, it } from 'vitest'
import {
  gridCellKey,
  gridCellsBetweenCellCenters,
} from '~/utils/gridLineTraversal'

describe('grid line traversal', () => {
  it('includes both endpoints and every crossed axial cell', () => {
    expect(gridCellsBetweenCellCenters(
      { x: 0, y: 1, z: 0 },
      { x: 3, y: 1, z: 0 },
    )).toEqual([
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 },
      { x: 3, y: 1, z: 0 },
    ])
  })

  it('advances tied axes together under the established diagonal policy', () => {
    expect(gridCellsBetweenCellCenters(
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 2, z: 2 },
    )).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 2, z: 2 },
    ])
  })

  it('does not mutate anchors and produces stable cell keys', () => {
    const from = { x: 2, y: 3, z: 4 }
    const to = { x: 2, y: 1, z: 4 }

    expect(gridCellsBetweenCellCenters(from, to)).toEqual([
      { x: 2, y: 3, z: 4 },
      { x: 2, y: 2, z: 4 },
      { x: 2, y: 1, z: 4 },
    ])
    expect(from).toEqual({ x: 2, y: 3, z: 4 })
    expect(to).toEqual({ x: 2, y: 1, z: 4 })
    expect(gridCellKey(from)).toBe('2,3,4')
  })
})
