import { describe, expect, it, vi } from 'vitest'
import {
  buildPreviewAnchorKey,
  createIsometricBuildInteractionController,
} from '~/utils/isometric/buildInteraction'
import type { BuildInteractionState } from '~/utils/isometric/buildInteraction'
import type { BuildTarget } from '~/utils/isometric/types'

const pointer = { clientX: 10, clientY: 20 } as PointerEvent

const makeController = (overrides: Partial<Parameters<typeof createIsometricBuildInteractionController>[0]> = {}) => {
  const state: BuildInteractionState = {
    buildMode: true,
    buildTool: 'pencil',
    buildMaterial: 'grass',
    buildColor: null,
    buildGhostVoxel: false,
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

  it('skips build ghost updates while the effective preview anchor is unchanged', () => {
    const { controller, pickTarget, updateGhost } = makeController()
    pickTarget.mockReturnValue({ action: 'place', cell: { x: 1, y: 2, z: 3 }, valid: true })

    controller.updatePreviewFromPointer(pointer)
    controller.updatePreviewFromPointer({ clientX: 11, clientY: 21 } as PointerEvent)

    expect(pickTarget).toHaveBeenCalledTimes(2)
    expect(updateGhost).toHaveBeenCalledOnce()
  })

  it('refreshes the build ghost when target output or valid-place style changes', () => {
    const { controller, state, pickTarget, updateGhost } = makeController()
    pickTarget.mockReturnValue({ action: 'place', cell: { x: 1, y: 2, z: 3 }, valid: true })

    controller.updatePreviewFromPointer(pointer)
    state.buildColor = '#123456'
    controller.updatePreviewFromPointer(pointer)
    pickTarget.mockReturnValue({ action: 'place', cell: { x: 1, y: 2, z: 3 }, valid: false })
    controller.updatePreviewFromPointer(pointer)
    state.buildColor = '#654321'
    controller.updatePreviewFromPointer(pointer)
    pickTarget.mockReturnValue({ action: 'remove', cell: { x: 1, y: 2, z: 3 }, valid: true })
    controller.updatePreviewFromPointer(pointer)

    expect(updateGhost).toHaveBeenCalledTimes(4)
  })

  it('resets the build preview anchor cache when the ghost is hidden', () => {
    const { controller, pickTarget, updateGhost, hideGhost } = makeController()
    pickTarget.mockReturnValue({ action: 'place', cell: { x: 1, y: 2, z: 3 }, valid: true })

    controller.updatePreviewFromPointer(pointer)
    controller.hideGhost()
    controller.updatePreviewFromPointer(pointer)

    expect(hideGhost).toHaveBeenCalledOnce()
    expect(updateGhost).toHaveBeenCalledTimes(2)
  })

  it('builds stable preview anchor keys from output-relevant target state', () => {
    const target: BuildTarget = { action: 'place', cell: { x: 1, y: 2, z: 3 }, valid: true }

    expect(buildPreviewAnchorKey(target, { buildMode: true, buildMaterial: 'grass', buildColor: null }))
      .toBe(buildPreviewAnchorKey(
        { ...target, cell: { ...target.cell } },
        { buildMode: true, buildMaterial: 'grass', buildColor: null },
      ))
    expect(buildPreviewAnchorKey(target, { buildMode: true, buildMaterial: 'grass', buildColor: '#123456' }))
      .not.toBe(buildPreviewAnchorKey(
        target,
        { buildMode: true, buildMaterial: 'grass', buildColor: null },
      ))
    expect(buildPreviewAnchorKey(
      { ...target, valid: false },
      { buildMode: true, buildMaterial: 'grass', buildColor: '#123456' },
    )).toBe(buildPreviewAnchorKey(
      { ...target, valid: false },
      { buildMode: true, buildMaterial: 'ice', buildColor: null },
    ))
    expect(buildPreviewAnchorKey(target, { buildMode: false, buildMaterial: 'grass', buildColor: null }))
      .toBe(buildPreviewAnchorKey(
        null,
        { buildMode: false, buildMaterial: 'ice', buildColor: '#123456' },
      ))
  })

  it('places valid voxels using the current material, color, and ghost flag', () => {
    const { controller, state, pickTarget, placeVoxel } = makeController()
    state.buildMaterial = 'custom'
    state.buildColor = '#123456'
    state.buildGhostVoxel = true
    pickTarget.mockReturnValue({ action: 'place', cell: { x: 2, y: 0, z: 4 }, valid: true })

    controller.performAction(pointer, 'pencil')

    expect(placeVoxel).toHaveBeenCalledWith({
      x: 2,
      y: 0,
      z: 4,
      materialId: 'custom',
      color: '#123456',
      ghost: true,
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
