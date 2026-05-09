import { describe, expect, it, vi } from 'vitest'
import { bindIsometricRendererDomEvents } from '~/utils/isometric/lifecycle'

describe('isometric lifecycle helpers', () => {
  it('binds and cleans up renderer DOM event handlers', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    const element = { addEventListener, removeEventListener } as unknown as HTMLElement
    const handlers = {
      pointerdown: vi.fn(),
      pointermove: vi.fn(),
      pointerup: vi.fn(),
      pointerleave: vi.fn(),
      contextmenu: vi.fn(),
      wheel: vi.fn(),
    }

    const cleanup = bindIsometricRendererDomEvents(element, handlers)

    expect(addEventListener).toHaveBeenCalledWith('pointerdown', handlers.pointerdown)
    expect(addEventListener).toHaveBeenCalledWith('pointermove', handlers.pointermove)
    expect(addEventListener).toHaveBeenCalledWith('pointerup', handlers.pointerup)
    expect(addEventListener).toHaveBeenCalledWith('pointerleave', handlers.pointerleave)
    expect(addEventListener).toHaveBeenCalledWith('contextmenu', handlers.contextmenu)
    expect(addEventListener).toHaveBeenCalledWith('wheel', handlers.wheel, { passive: false })

    cleanup()

    expect(removeEventListener).toHaveBeenCalledWith('pointerdown', handlers.pointerdown)
    expect(removeEventListener).toHaveBeenCalledWith('pointermove', handlers.pointermove)
    expect(removeEventListener).toHaveBeenCalledWith('pointerup', handlers.pointerup)
    expect(removeEventListener).toHaveBeenCalledWith('pointerleave', handlers.pointerleave)
    expect(removeEventListener).toHaveBeenCalledWith('contextmenu', handlers.contextmenu)
    expect(removeEventListener).toHaveBeenCalledWith('wheel', handlers.wheel)
  })
})
