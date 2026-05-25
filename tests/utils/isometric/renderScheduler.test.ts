import { describe, expect, it, vi } from 'vitest'
import { createIsometricRenderScheduler } from '~/utils/isometric/renderScheduler'

const createAnimationFrameDriver = () => {
  let nextFrameHandle = 1
  const callbacks = new Map<number, (timestampMs: number) => void>()
  const requestAnimationFrame = vi.fn((callback: (timestampMs: number) => void) => {
    const frameHandle = nextFrameHandle
    nextFrameHandle += 1
    callbacks.set(frameHandle, callback)

    return frameHandle
  })
  const cancelAnimationFrame = vi.fn((frameHandle: number) => {
    callbacks.delete(frameHandle)
  })
  const flushNextFrame = (timestampMs = 0) => {
    const [nextEntry] = callbacks.entries()

    if (!nextEntry) return false

    const [frameHandle, callback] = nextEntry
    callbacks.delete(frameHandle)
    callback(timestampMs)

    return true
  }

  return {
    requestAnimationFrame,
    cancelAnimationFrame,
    flushNextFrame,
    pendingFrameCount: () => callbacks.size,
  }
}

describe('isometric render scheduler', () => {
  it('requests a render frame with deduplicated dirty reasons and layer state', () => {
    const driver = createAnimationFrameDriver()
    const renderFrame = vi.fn()
    const scheduler = createIsometricRenderScheduler({
      renderFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    const queued = scheduler.requestRender(['resize', 'tokens', 'resize'])

    expect(queued).toEqual({
      isFramePending: true,
      activeAnimation: false,
      dirtyReasons: ['resize', 'tokens'],
      dirtyLayers: ['webgl', 'css3d'],
      isDisposed: false,
    })
    expect(driver.pendingFrameCount()).toBe(1)

    queued.dirtyReasons.push('debug')
    queued.dirtyLayers.push('webgl')
    expect(scheduler.snapshot().dirtyReasons).toEqual(['resize', 'tokens'])
    expect(scheduler.snapshot().dirtyLayers).toEqual(['webgl', 'css3d'])

    expect(driver.flushNextFrame(123)).toBe(true)

    expect(renderFrame).toHaveBeenCalledOnce()
    expect(renderFrame).toHaveBeenCalledWith({
      timestampMs: 123,
      reasons: ['resize', 'tokens'],
      dirtyLayers: ['webgl', 'css3d'],
      activeAnimation: false,
    })
    expect(scheduler.snapshot()).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
      dirtyLayers: [],
      isDisposed: false,
    })
  })

  it('tracks WebGL-only, CSS3D-only, and both-dirty scheduler state', () => {
    const driver = createAnimationFrameDriver()
    const renderFrame = vi.fn()
    const scheduler = createIsometricRenderScheduler({
      renderFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    expect(scheduler.requestRender('weather')).toEqual({
      isFramePending: true,
      activeAnimation: false,
      dirtyReasons: ['weather'],
      dirtyLayers: ['webgl'],
      isDisposed: false,
    })
    expect(driver.flushNextFrame(1)).toBe(true)
    expect(renderFrame).toHaveBeenNthCalledWith(1, {
      timestampMs: 1,
      reasons: ['weather'],
      dirtyLayers: ['webgl'],
      activeAnimation: false,
    })

    expect(scheduler.requestRender({ reasons: 'manual', dirtyLayers: 'css3d' })).toEqual({
      isFramePending: true,
      activeAnimation: false,
      dirtyReasons: ['manual'],
      dirtyLayers: ['css3d'],
      isDisposed: false,
    })
    expect(driver.flushNextFrame(2)).toBe(true)
    expect(renderFrame).toHaveBeenNthCalledWith(2, {
      timestampMs: 2,
      reasons: ['manual'],
      dirtyLayers: ['css3d'],
      activeAnimation: false,
    })

    expect(scheduler.requestRender('camera')).toEqual({
      isFramePending: true,
      activeAnimation: false,
      dirtyReasons: ['camera'],
      dirtyLayers: ['webgl', 'css3d'],
      isDisposed: false,
    })
    expect(driver.flushNextFrame(3)).toBe(true)
    expect(renderFrame).toHaveBeenNthCalledWith(3, {
      timestampMs: 3,
      reasons: ['camera'],
      dirtyLayers: ['webgl', 'css3d'],
      activeAnimation: false,
    })
  })

  it('coalesces duplicate invalidations across requests before the pending frame runs', () => {
    const driver = createAnimationFrameDriver()
    const renderFrame = vi.fn()
    const scheduler = createIsometricRenderScheduler({
      renderFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    expect(scheduler.requestRender(['tokens', 'camera'])).toEqual({
      isFramePending: true,
      activeAnimation: false,
      dirtyReasons: ['tokens', 'camera'],
      dirtyLayers: ['webgl', 'css3d'],
      isDisposed: false,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()

    expect(scheduler.requestRender(['tokens', 'resize', 'camera'])).toEqual({
      isFramePending: true,
      activeAnimation: false,
      dirtyReasons: ['tokens', 'camera', 'resize'],
      dirtyLayers: ['webgl', 'css3d'],
      isDisposed: false,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()
    expect(driver.pendingFrameCount()).toBe(1)

    expect(driver.flushNextFrame(8)).toBe(true)

    expect(renderFrame).toHaveBeenCalledOnce()
    expect(renderFrame).toHaveBeenCalledWith({
      timestampMs: 8,
      reasons: ['tokens', 'camera', 'resize'],
      dirtyLayers: ['webgl', 'css3d'],
      activeAnimation: false,
    })
  })

  it('does not schedule duplicate RAFs while one is pending', () => {
    const driver = createAnimationFrameDriver()
    const renderFrame = vi.fn(() => ({ activeAnimation: false }))
    const scheduler = createIsometricRenderScheduler({
      renderFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    scheduler.requestRender('initial')
    scheduler.setActiveAnimation(true)
    scheduler.requestRender(['initial', 'debug'])
    scheduler.setActiveAnimation(true)

    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()
    expect(driver.pendingFrameCount()).toBe(1)
    expect(scheduler.snapshot()).toEqual({
      isFramePending: true,
      activeAnimation: true,
      dirtyReasons: ['initial', 'debug'],
      dirtyLayers: ['webgl', 'css3d'],
      isDisposed: false,
    })

    expect(driver.flushNextFrame(16)).toBe(true)

    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()
    expect(renderFrame).toHaveBeenCalledOnce()
    expect(renderFrame).toHaveBeenCalledWith({
      timestampMs: 16,
      reasons: ['initial', 'debug', 'animation'],
      dirtyLayers: ['webgl', 'css3d'],
      activeAnimation: true,
    })
    expect(scheduler.snapshot()).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
      dirtyLayers: [],
      isDisposed: false,
    })
  })

  it('keeps scheduling while frame results report active animation', () => {
    const driver = createAnimationFrameDriver()
    const renderFrame = vi.fn(() => ({ activeAnimation: true }))
    const scheduler = createIsometricRenderScheduler({
      renderFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    scheduler.requestRender('initial')
    scheduler.setActiveAnimation(true)

    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()
    expect(driver.flushNextFrame(16)).toBe(true)
    expect(renderFrame).toHaveBeenNthCalledWith(1, {
      timestampMs: 16,
      reasons: ['initial', 'animation'],
      dirtyLayers: ['webgl', 'css3d'],
      activeAnimation: true,
    })
    expect(scheduler.snapshot()).toEqual({
      isFramePending: true,
      activeAnimation: true,
      dirtyReasons: [],
      dirtyLayers: [],
      isDisposed: false,
    })

    expect(driver.flushNextFrame(32)).toBe(true)
    expect(renderFrame).toHaveBeenNthCalledWith(2, {
      timestampMs: 32,
      reasons: ['animation'],
      dirtyLayers: ['webgl'],
      activeAnimation: true,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledTimes(3)

    scheduler.dispose()
    expect(driver.pendingFrameCount()).toBe(0)
  })

  it('continues scheduling frames while active animation remains true', () => {
    const driver = createAnimationFrameDriver()
    const renderFrame = vi.fn()
      .mockReturnValueOnce({ activeAnimation: true })
      .mockReturnValueOnce({ activeAnimation: false })
    const scheduler = createIsometricRenderScheduler({
      renderFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    expect(scheduler.setActiveAnimation(true)).toEqual({
      isFramePending: true,
      activeAnimation: true,
      dirtyReasons: [],
      dirtyLayers: [],
      isDisposed: false,
    })

    expect(driver.flushNextFrame(16)).toBe(true)
    expect(renderFrame).toHaveBeenNthCalledWith(1, {
      timestampMs: 16,
      reasons: ['animation'],
      dirtyLayers: ['webgl'],
      activeAnimation: true,
    })
    expect(scheduler.snapshot()).toEqual({
      isFramePending: true,
      activeAnimation: true,
      dirtyReasons: [],
      dirtyLayers: [],
      isDisposed: false,
    })

    expect(driver.flushNextFrame(32)).toBe(true)
    expect(renderFrame).toHaveBeenNthCalledWith(2, {
      timestampMs: 32,
      reasons: ['animation'],
      dirtyLayers: ['webgl'],
      activeAnimation: true,
    })
    expect(scheduler.snapshot()).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
      dirtyLayers: [],
      isDisposed: false,
    })
  })

  it('keeps a dirty one-shot render when animation settles before the frame fires', () => {
    const driver = createAnimationFrameDriver()
    const renderFrame = vi.fn()
    const scheduler = createIsometricRenderScheduler({
      renderFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    scheduler.requestRender('camera')
    scheduler.setActiveAnimation(true)

    expect(scheduler.setActiveAnimation(false)).toEqual({
      isFramePending: true,
      activeAnimation: false,
      dirtyReasons: ['camera'],
      dirtyLayers: ['webgl', 'css3d'],
      isDisposed: false,
    })

    expect(driver.flushNextFrame(24)).toBe(true)
    expect(renderFrame).toHaveBeenCalledWith({
      timestampMs: 24,
      reasons: ['camera'],
      dirtyLayers: ['webgl', 'css3d'],
      activeAnimation: false,
    })
  })

  it('pauses hidden-tab animation work without clearing dirty state and resumes safely', () => {
    const driver = createAnimationFrameDriver()
    const renderFrame = vi.fn(() => ({ activeAnimation: true }))
    const scheduler = createIsometricRenderScheduler({
      renderFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    scheduler.requestRender('initial')
    scheduler.setActiveAnimation(true)

    expect(scheduler.pause()).toEqual({
      isFramePending: false,
      activeAnimation: true,
      dirtyReasons: ['initial'],
      dirtyLayers: ['webgl', 'css3d'],
      isDisposed: false,
    })
    expect(driver.cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(driver.pendingFrameCount()).toBe(0)

    expect(scheduler.requestRender('tokens')).toEqual({
      isFramePending: false,
      activeAnimation: true,
      dirtyReasons: ['initial', 'tokens'],
      dirtyLayers: ['webgl', 'css3d'],
      isDisposed: false,
    })
    expect(scheduler.setActiveAnimation(true)).toEqual({
      isFramePending: false,
      activeAnimation: true,
      dirtyReasons: ['initial', 'tokens'],
      dirtyLayers: ['webgl', 'css3d'],
      isDisposed: false,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()

    expect(scheduler.resume()).toEqual({
      isFramePending: true,
      activeAnimation: true,
      dirtyReasons: ['initial', 'tokens'],
      dirtyLayers: ['webgl', 'css3d'],
      isDisposed: false,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledTimes(2)

    scheduler.requestRender('hidden-tab-resume')
    expect(driver.flushNextFrame(72)).toBe(true)
    expect(renderFrame).toHaveBeenCalledWith({
      timestampMs: 72,
      reasons: ['initial', 'tokens', 'hidden-tab-resume', 'animation'],
      dirtyLayers: ['webgl', 'css3d'],
      activeAnimation: true,
    })
  })

  it('cancels a mounted scheduler pending frame before a remounted scheduler renders', () => {
    const driver = createAnimationFrameDriver()
    const firstRenderFrame = vi.fn()
    const firstScheduler = createIsometricRenderScheduler({
      renderFrame: firstRenderFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    firstScheduler.requestRender('initial')
    firstScheduler.setActiveAnimation(true)

    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()
    expect(firstScheduler.dispose()).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
      dirtyLayers: [],
      isDisposed: true,
    })
    expect(driver.cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(driver.pendingFrameCount()).toBe(0)

    const secondRenderFrame = vi.fn()
    const secondScheduler = createIsometricRenderScheduler({
      renderFrame: secondRenderFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    expect(secondScheduler.requestRender('initial')).toEqual({
      isFramePending: true,
      activeAnimation: false,
      dirtyReasons: ['initial'],
      dirtyLayers: ['webgl', 'css3d'],
      isDisposed: false,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledTimes(2)

    expect(driver.flushNextFrame(48)).toBe(true)

    expect(firstRenderFrame).not.toHaveBeenCalled()
    expect(secondRenderFrame).toHaveBeenCalledOnce()
    expect(secondRenderFrame).toHaveBeenCalledWith({
      timestampMs: 48,
      reasons: ['initial'],
      dirtyLayers: ['webgl', 'css3d'],
      activeAnimation: false,
    })
  })

  it('cancels queued work and can be disposed to ignore future requests', () => {
    const driver = createAnimationFrameDriver()
    const renderFrame = vi.fn()
    const scheduler = createIsometricRenderScheduler({
      renderFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    scheduler.requestRender('camera')

    expect(scheduler.cancel()).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
      dirtyLayers: [],
      isDisposed: false,
    })
    expect(driver.cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(driver.flushNextFrame(40)).toBe(false)
    expect(renderFrame).not.toHaveBeenCalled()

    scheduler.requestRender('debug')
    expect(scheduler.snapshot().dirtyLayers).toEqual(['webgl'])
    expect(driver.flushNextFrame(56)).toBe(true)
    expect(renderFrame).toHaveBeenCalledOnce()

    expect(scheduler.dispose()).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
      dirtyLayers: [],
      isDisposed: true,
    })
    expect(scheduler.requestRender('manual')).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
      dirtyLayers: [],
      isDisposed: true,
    })
    expect(scheduler.setActiveAnimation(true)).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
      dirtyLayers: [],
      isDisposed: true,
    })
    expect(driver.pendingFrameCount()).toBe(0)
  })
})
