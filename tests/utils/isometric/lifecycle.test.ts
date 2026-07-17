import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindIsometricDocumentVisibilityChange,
  bindIsometricRendererDomEvents,
  disposeIsometricRendererResources,
  observeIsometricResize,
} from '~/utils/isometric/lifecycle'

describe('isometric lifecycle helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('binds document visibility changes for hidden-tab render pause and resume', () => {
    const visibilityHandlers: Array<() => void> = []
    const documentTarget = {
      hidden: false,
      addEventListener: vi.fn((_type: 'visibilitychange', listener: () => void) => {
        visibilityHandlers.push(listener)
      }),
      removeEventListener: vi.fn(),
    }
    const pause = vi.fn()
    const resume = vi.fn()

    const cleanup = bindIsometricDocumentVisibilityChange(documentTarget, { pause, resume })
    const visibilityHandler = visibilityHandlers[0]

    expect(documentTarget.addEventListener).toHaveBeenCalledWith('visibilitychange', visibilityHandler)
    expect(pause).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()

    documentTarget.hidden = true
    visibilityHandler?.()
    visibilityHandler?.()

    expect(pause).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()

    documentTarget.hidden = false
    visibilityHandler?.()

    expect(resume).toHaveBeenCalledOnce()

    cleanup()

    expect(documentTarget.removeEventListener).toHaveBeenCalledWith('visibilitychange', visibilityHandler)
  })

  it('applies the hidden document visibility state at bind time', () => {
    const documentTarget = {
      hidden: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const pause = vi.fn()
    const resume = vi.fn()

    bindIsometricDocumentVisibilityChange(documentTarget, { pause, resume })

    expect(pause).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
  })

  it('binds and cleans up renderer DOM event handlers', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    const element = { addEventListener, removeEventListener } as unknown as HTMLElement
    const handlers = {
      pointerdown: vi.fn(),
      pointermove: vi.fn(),
      pointerup: vi.fn(),
      pointerleave: vi.fn(),
      pointercancel: vi.fn(),
      contextmenu: vi.fn(),
      wheel: vi.fn(),
    }

    const cleanup = bindIsometricRendererDomEvents(element, handlers)

    expect(addEventListener).toHaveBeenCalledWith('pointerdown', handlers.pointerdown)
    expect(addEventListener).toHaveBeenCalledWith('pointermove', handlers.pointermove)
    expect(addEventListener).toHaveBeenCalledWith('pointerup', handlers.pointerup)
    expect(addEventListener).toHaveBeenCalledWith('pointerleave', handlers.pointerleave)
    expect(addEventListener).toHaveBeenCalledWith('pointercancel', handlers.pointercancel)
    expect(addEventListener).toHaveBeenCalledWith('contextmenu', handlers.contextmenu)
    expect(addEventListener).toHaveBeenCalledWith('wheel', handlers.wheel, { passive: false })

    cleanup()

    expect(removeEventListener).toHaveBeenCalledWith('pointerdown', handlers.pointerdown)
    expect(removeEventListener).toHaveBeenCalledWith('pointermove', handlers.pointermove)
    expect(removeEventListener).toHaveBeenCalledWith('pointerup', handlers.pointerup)
    expect(removeEventListener).toHaveBeenCalledWith('pointerleave', handlers.pointerleave)
    expect(removeEventListener).toHaveBeenCalledWith('pointercancel', handlers.pointercancel)
    expect(removeEventListener).toHaveBeenCalledWith('contextmenu', handlers.contextmenu)
    expect(removeEventListener).toHaveBeenCalledWith('wheel', handlers.wheel)
  })

  it('disconnects resize observers during renderer unmount cleanup', () => {
    const instances: Array<{
      callback: ResizeObserverCallback
      observe: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
    }> = []
    class FakeResizeObserver {
      readonly callback: ResizeObserverCallback
      readonly observe = vi.fn()
      readonly disconnect = vi.fn()

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        instances.push(this)
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const element = {} as Element
    const onResize = vi.fn()

    const cleanup = observeIsometricResize(element, onResize)

    expect(instances).toHaveLength(1)
    expect(instances[0].observe).toHaveBeenCalledWith(element)

    instances[0].callback([], instances[0] as unknown as ResizeObserver)
    expect(onResize).toHaveBeenCalledOnce()

    cleanup()

    expect(instances[0].disconnect).toHaveBeenCalledOnce()
  })

  it('disposes renderer-owned resources and clears token render objects', () => {
    const calls: string[] = []
    const disposable = (name: string) => ({ dispose: vi.fn(() => calls.push(name)) })
    const renderObjectA = { id: 'a' }
    const renderObjectB = { id: 'b' }
    const renderObjects = new Map([
      ['a', renderObjectA],
      ['b', renderObjectB],
    ])
    const disposeRenderObject = vi.fn((renderObject: { id: string }) => {
      calls.push(`token:${renderObject.id}`)
    })
    const cssRenderer = {
      domElement: { remove: vi.fn(() => calls.push('css-remove')) },
    }

    disposeIsometricRendererResources({
      clearPreviewVisuals: vi.fn(() => calls.push('clear-preview')),
      tokenMovePreviewRenderer: disposable('move-preview'),
      disposeBuildGhost: vi.fn(() => calls.push('build-ghost')),
      disposeHazardGhost: vi.fn(() => calls.push('hazard-ghost')),
      hazardRenderer: disposable('hazards'),
      groundItemRenderer: disposable('ground-items'),
      fieldEffectRenderer: disposable('field-effects'),
      voxelRenderer: disposable('voxels'),
      moveVfxRenderer: disposable('move-vfx'),
      renderObjects,
      disposeRenderObject,
      gridRenderer: disposable('grid'),
      controls: disposable('controls'),
      renderer: disposable('webgl'),
      cssRenderer,
    })

    expect(disposeRenderObject).toHaveBeenCalledTimes(2)
    expect(disposeRenderObject).toHaveBeenNthCalledWith(1, renderObjectA)
    expect(disposeRenderObject).toHaveBeenNthCalledWith(2, renderObjectB)
    expect(renderObjects.size).toBe(0)
    expect(cssRenderer.domElement.remove).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      'clear-preview',
      'move-preview',
      'build-ghost',
      'hazard-ghost',
      'hazards',
      'ground-items',
      'field-effects',
      'voxels',
      'move-vfx',
      'token:a',
      'token:b',
      'grid',
      'controls',
      'webgl',
      'css-remove',
    ])
  })
})
