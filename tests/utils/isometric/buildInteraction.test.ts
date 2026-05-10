import { describe, expect, it, vi } from 'vitest'
import { createIsometricBuildInteractionController } from '~/utils/isometric/buildInteraction'
import type { BuildInteractionState } from '~/utils/isometric/buildInteraction'
import type { BuildTarget } from '~/utils/isometric/types'

const pointer = { clientX: 10, clientY: 20 } as PointerEvent

const makeController = (overrides: Partial<Parameters<typeof createIsometricBuildInteractionController>[0]> = {}) => {
  const state: BuildInteractionState = {
    buildMode: true,
    buildTool: 'pencil',
    buildMaterial: 'grass',
    buildColor: null,
  }
  const pickTarget = vi.fn<(event: MouseEvent | PointerEvent, tool: 'pencil' | 'eraser') => BuildTarget | null>()
  const updateGhost = vi.fn()
  const hideGhost = vi.fn()
  const placeVoxel = vi.fn()
  const removeVoxel = vi.fn()

  const controller = createIsometricBuildInteractionController({
    getState: () => state,
    pickTarget,
    updateGhost,
    hideGhost,
    placeVoxel,
    removeVoxel,
    ...overrides,
  })

  return {
    controller,
    state,
    pickTarget,
    updateGhost,
    hideGhost,
    placeVoxel,
    removeVoxel,
  }
}

describe('isometric build interaction', () => {
  it('hides the build ghost when build mode is inactive', () => {
    const { controller, state, hideGhost, pickTarget } = makeController()
    state.buildMode = false

    controller.updatePreviewFromPointer(pointer)

    expect(hideGhost).toHaveBeenCalledOnce()
    expect(pickTarget).not.toHaveBeenCalled()
  })

  it('picks and updates the build ghost with the active tool', () => {
    const { controller, pickTarget, updateGhost } = makeController()
    const target: BuildTarget = { action: 'place', cell: { x: 1, y: 2, z: 3 }, valid: true }
    pickTarget.mockReturnValue(target)

    controller.updatePreviewFromPointer(pointer)

    expect(pickTarget).toHaveBeenCalledWith(pointer, 'pencil')
    expect(updateGhost).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ buildMode: true, styleForCell: expect.any(Function) }),
    )
  })

  it('places valid voxels using the current material and color', () => {
    const { controller, state, pickTarget, placeVoxel } = makeController()
    state.buildMaterial = 'custom'
    state.buildColor = '#123456'
    pickTarget.mockReturnValue({ action: 'place', cell: { x: 2, y: 0, z: 4 }, valid: true })

    controller.performAction(pointer, 'pencil')

    expect(placeVoxel).toHaveBeenCalledWith({
      x: 2,
      y: 0,
      z: 4,
      materialId: 'custom',
      color: '#123456',
    })
  })

  it('removes voxel targets and ignores invalid placements', () => {
    const { controller, pickTarget, removeVoxel, placeVoxel } = makeController()
    pickTarget.mockReturnValueOnce({ action: 'remove', cell: { x: 1, y: 0, z: 1 }, valid: true })
    pickTarget.mockReturnValueOnce({ action: 'place', cell: { x: 9, y: 0, z: 9 }, valid: false })

    controller.performAction(pointer, 'eraser')
    controller.performAction(pointer, 'pencil')

    expect(removeVoxel).toHaveBeenCalledWith({ x: 1, y: 0, z: 1 })
    expect(placeVoxel).not.toHaveBeenCalled()
  })

  it('replays the last pointer only while build mode remains active', () => {
    const { controller, state, pickTarget } = makeController()

    controller.replayPreview({ clientX: 1, clientY: 2 })
    state.buildMode = false
    controller.replayPreview({ clientX: 3, clientY: 4 })
    controller.replayPreview(null)

    expect(pickTarget).toHaveBeenCalledOnce()
  })
})
