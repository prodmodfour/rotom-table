import { describe, expect, it, vi } from 'vitest'
import {
  createIsometricHazardInteractionController,
  hazardPreviewAnchorKey,
} from '~/utils/isometric/hazardInteraction'
import type { HazardInteractionState } from '~/utils/isometric/hazardInteraction'
import type { HazardTarget } from '~/utils/isometric/types'

const pointer = { clientX: 10, clientY: 20 } as PointerEvent

const makeController = (overrides: Partial<Parameters<typeof createIsometricHazardInteractionController>[0]> = {}) => {
  const state: HazardInteractionState = {
    hazardMode: true,
    hazardTool: 'pencil',
    hazardKind: 'spikes',
  }
  const pickTarget = vi.fn<(event: MouseEvent | PointerEvent, tool: 'pencil' | 'eraser') => HazardTarget | null>()
  const updateGhost = vi.fn()
  const hideGhost = vi.fn()
  const placeHazard = vi.fn()
  const removeHazard = vi.fn()

  const controller = createIsometricHazardInteractionController({
    getState: () => state,
    pickTarget,
    updateGhost,
    hideGhost,
    placeHazard,
    removeHazard,
    ...overrides,
  })

  return {
    controller,
    state,
    pickTarget,
    updateGhost,
    hideGhost,
    placeHazard,
    removeHazard,
  }
}

describe('isometric hazard interaction', () => {
  it('hides the hazard ghost when hazard mode is inactive', () => {
    const { controller, state, hideGhost, pickTarget } = makeController()
    state.hazardMode = false

    controller.updatePreviewFromPointer(pointer)

    expect(hideGhost).toHaveBeenCalledOnce()
    expect(pickTarget).not.toHaveBeenCalled()
  })

  it('picks and updates the hazard ghost with the active tool and kind', () => {
    const { controller, pickTarget, updateGhost } = makeController()
    const target: HazardTarget = { action: 'place', cell: { x: 1, y: 2, z: 3 }, valid: true }
    pickTarget.mockReturnValue(target)

    controller.updatePreviewFromPointer(pointer)

    expect(pickTarget).toHaveBeenCalledWith(pointer, 'pencil')
    expect(updateGhost).toHaveBeenCalledWith(target, { hazardMode: true, kind: 'spikes' })
  })

  it('skips hazard ghost updates while the effective preview anchor is unchanged', () => {
    const { controller, pickTarget, updateGhost } = makeController()
    pickTarget.mockReturnValue({ action: 'place', cell: { x: 1, y: 2, z: 3 }, valid: true })

    controller.updatePreviewFromPointer(pointer)
    controller.updatePreviewFromPointer({ clientX: 11, clientY: 21 } as PointerEvent)

    expect(pickTarget).toHaveBeenCalledTimes(2)
    expect(updateGhost).toHaveBeenCalledOnce()
  })

  it('refreshes the hazard ghost when target output or active kind changes', () => {
    const { controller, state, pickTarget, updateGhost } = makeController()
    pickTarget.mockReturnValue({ action: 'place', cell: { x: 1, y: 2, z: 3 }, valid: true })

    controller.updatePreviewFromPointer(pointer)
    state.hazardKind = 'toxic-spikes'
    controller.updatePreviewFromPointer(pointer)
    pickTarget.mockReturnValue({ action: 'place', cell: { x: 1, y: 2, z: 3 }, valid: false })
    controller.updatePreviewFromPointer(pointer)
    pickTarget.mockReturnValue({ action: 'remove', cell: { x: 1, y: 2, z: 3 }, kind: 'spikes', valid: true })
    controller.updatePreviewFromPointer(pointer)
    pickTarget.mockReturnValue(null)
    controller.updatePreviewFromPointer(pointer)

    expect(updateGhost).toHaveBeenCalledTimes(5)
  })

  it('resets the hazard preview anchor cache when the ghost is hidden', () => {
    const { controller, pickTarget, updateGhost, hideGhost } = makeController()
    pickTarget.mockReturnValue({ action: 'place', cell: { x: 1, y: 2, z: 3 }, valid: true })

    controller.updatePreviewFromPointer(pointer)
    controller.hideGhost()
    controller.updatePreviewFromPointer(pointer)

    expect(hideGhost).toHaveBeenCalledOnce()
    expect(updateGhost).toHaveBeenCalledTimes(2)
  })

  it('builds stable preview anchor keys from output-relevant hazard target state', () => {
    const target: HazardTarget = { action: 'place', cell: { x: 1, y: 2, z: 3 }, valid: true }

    expect(hazardPreviewAnchorKey(target, { hazardMode: true, hazardKind: 'spikes' }))
      .toBe(hazardPreviewAnchorKey(
        { ...target, cell: { ...target.cell } },
        { hazardMode: true, hazardKind: 'spikes' },
      ))
    expect(hazardPreviewAnchorKey(target, { hazardMode: true, hazardKind: 'toxic-spikes' }))
      .not.toBe(hazardPreviewAnchorKey(target, { hazardMode: true, hazardKind: 'spikes' }))
    expect(hazardPreviewAnchorKey(
      { ...target, valid: false },
      { hazardMode: true, hazardKind: undefined },
    )).toBe(hazardPreviewAnchorKey(
      { ...target, valid: false },
      { hazardMode: true, hazardKind: 'spikes' },
    ))
    expect(hazardPreviewAnchorKey(target, { hazardMode: false, hazardKind: 'spikes' }))
      .toBe(hazardPreviewAnchorKey(
        null,
        { hazardMode: false, hazardKind: 'toxic-spikes' },
      ))
  })

  it('places valid hazards using the current kind', () => {
    const { controller, state, pickTarget, placeHazard } = makeController()
    state.hazardKind = 'toxic-spikes'
    pickTarget.mockReturnValue({ action: 'place', cell: { x: 2, y: 0, z: 4 }, valid: true })

    controller.performAction(pointer, 'pencil')

    expect(placeHazard).toHaveBeenCalledWith({
      kind: 'toxic-spikes',
      x: 2,
      y: 0,
      z: 4,
      layer: 1,
    })
  })

  it('removes hazard targets and ignores invalid placements', () => {
    const { controller, pickTarget, removeHazard, placeHazard } = makeController()
    pickTarget.mockReturnValueOnce({
      action: 'remove',
      cell: { x: 1, y: 0, z: 1 },
      kind: 'spikes',
      valid: true,
    })
    pickTarget.mockReturnValueOnce({ action: 'place', cell: { x: 9, y: 0, z: 9 }, valid: false })

    controller.performAction(pointer, 'eraser')
    controller.performAction(pointer, 'pencil')

    expect(removeHazard).toHaveBeenCalledWith({ x: 1, y: 0, z: 1 })
    expect(placeHazard).not.toHaveBeenCalled()
  })

  it('falls back to the default hazard kind and only replays while active', () => {
    const { controller, state, pickTarget, updateGhost } = makeController()
    state.hazardKind = undefined
    pickTarget.mockReturnValue({ action: 'place', cell: { x: 0, y: 0, z: 0 }, valid: true })

    controller.replayPreview({ clientX: 1, clientY: 2 })
    state.hazardMode = false
    controller.replayPreview({ clientX: 3, clientY: 4 })
    controller.replayPreview(null)

    expect(pickTarget).toHaveBeenCalledOnce()
    expect(updateGhost).toHaveBeenCalledWith(
      expect.anything(),
      { hazardMode: true, kind: 'spikes' },
    )
  })
})
