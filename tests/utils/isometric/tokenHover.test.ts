import { describe, expect, it, vi } from 'vitest'
import { createIsometricTokenHoverController } from '~/utils/isometric/tokenHover'

const makeObject = () => ({ elevationBadge: { visible: true } })

describe('isometric token hover controller', () => {
  it('tracks hovered ids, updates the active render object, and reports changes', () => {
    const objects = new Map([
      ['a', makeObject()],
      ['b', makeObject()],
    ])
    const updateHoveredRenderObject = vi.fn()
    const onHoverChange = vi.fn()
    const controller = createIsometricTokenHoverController({
      getRenderObject: (id) => objects.get(id),
      updateHoveredRenderObject,
      onHoverChange,
    })

    controller.set('a')

    expect(controller.id()).toBe('a')
    expect(updateHoveredRenderObject).toHaveBeenCalledWith(objects.get('a'))
    expect(onHoverChange).toHaveBeenCalledWith('a', null)
  })

  it('hides the previous badge when the hover target changes or clears', () => {
    const first = makeObject()
    const second = makeObject()
    const objects = new Map([
      ['a', first],
      ['b', second],
    ])
    const controller = createIsometricTokenHoverController({
      getRenderObject: (id) => objects.get(id),
      updateHoveredRenderObject: vi.fn(),
    })

    controller.set('a')
    controller.set('b')
    expect(first.elevationBadge.visible).toBe(false)

    controller.clear()
    expect(second.elevationBadge.visible).toBe(false)
    expect(controller.id()).toBeNull()
  })

  it('ignores repeated ids and only clears matching stale tokens', () => {
    const current = makeObject()
    const objects = new Map([['a', current]])
    const updateHoveredRenderObject = vi.fn()
    const onHoverChange = vi.fn()
    const controller = createIsometricTokenHoverController({
      getRenderObject: (id) => objects.get(id),
      updateHoveredRenderObject,
      onHoverChange,
    })

    controller.set('a')
    controller.set('a')
    controller.clearIfHovered('b')

    expect(updateHoveredRenderObject).toHaveBeenCalledOnce()
    expect(onHoverChange).toHaveBeenCalledOnce()
    expect(controller.id()).toBe('a')

    controller.clearIfHovered('a')

    expect(controller.id()).toBeNull()
    expect(current.elevationBadge.visible).toBe(false)
    expect(onHoverChange).toHaveBeenLastCalledWith(null, 'a')
  })
})
