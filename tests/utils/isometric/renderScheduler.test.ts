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
  it('requests a render frame with deduplicated dirty reasons', () => {
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
      isDisposed: false,
    })
    expect(driver.pendingFrameCount()).toBe(1)

    queued.dirtyReasons.push('debug')
    expect(scheduler.snapshot().dirtyReasons).toEqual(['resize', 'tokens'])

    expect(driver.flushNextFrame(123)).toBe(true)

    expect(renderFrame).toHaveBeenCalledOnce()
    expect(renderFrame).toHaveBeenCalledWith({
      timestampMs: 123,
      reasons: ['resize', 'tokens'],
      activeAnimation: false,
    })
    expect(scheduler.snapshot()).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
      isDisposed: false,
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
      isDisposed: false,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()

    expect(scheduler.requestRender(['tokens', 'resize', 'camera'])).toEqual({
      isFramePending: true,
      activeAnimation: false,
      dirtyReasons: ['tokens', 'camera', 'resize'],
      isDisposed: false,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()
    expect(driver.pendingFrameCount()).toBe(1)

    expect(driver.flushNextFrame(8)).toBe(true)

    expect(renderFrame).toHaveBeenCalledOnce()
    expect(renderFrame).toHaveBeenCalledWith({
      timestampMs: 8,
      reasons: ['tokens', 'camera', 'resize'],
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
      isDisposed: false,
    })

    expect(driver.flushNextFrame(16)).toBe(true)

    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()
    expect(renderFrame).toHaveBeenCalledOnce()
    expect(renderFrame).toHaveBeenCalledWith({
      timestampMs: 16,
      reasons: ['initial', 'debug', 'animation'],
      activeAnimation: true,
    })
    expect(scheduler.snapshot()).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
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
      activeAnimation: true,
    })
    expect(scheduler.snapshot()).toEqual({
      isFramePending: true,
      activeAnimation: true,
      dirtyReasons: [],
      isDisposed: false,
    })

    expect(driver.flushNextFrame(32)).toBe(true)
    expect(renderFrame).toHaveBeenNthCalledWith(2, {
      timestampMs: 32,
      reasons: ['animation'],
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
      isDisposed: false,
    })

    expect(driver.flushNextFrame(16)).toBe(true)
    expect(renderFrame).toHaveBeenNthCalledWith(1, {
      timestampMs: 16,
      reasons: ['animation'],
      activeAnimation: true,
    })
    expect(scheduler.snapshot()).toEqual({
      isFramePending: true,
      activeAnimation: true,
      dirtyReasons: [],
      isDisposed: false,
    })

    expect(driver.flushNextFrame(32)).toBe(true)
    expect(renderFrame).toHaveBeenNthCalledWith(2, {
      timestampMs: 32,
      reasons: ['animation'],
      activeAnimation: true,
    })
    expect(scheduler.snapshot()).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
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
      isDisposed: false,
    })

    expect(driver.flushNextFrame(24)).toBe(true)
    expect(renderFrame).toHaveBeenCalledWith({
      timestampMs: 24,
      reasons: ['camera'],
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
      isDisposed: false,
    })
    expect(driver.cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(driver.pendingFrameCount()).toBe(0)

    expect(scheduler.requestRender('tokens')).toEqual({
      isFramePending: false,
      activeAnimation: true,
      dirtyReasons: ['initial', 'tokens'],
      isDisposed: false,
    })
    expect(scheduler.setActiveAnimation(true)).toEqual({
      isFramePending: false,
      activeAnimation: true,
      dirtyReasons: ['initial', 'tokens'],
      isDisposed: false,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()

    expect(scheduler.resume()).toEqual({
      isFramePending: true,
      activeAnimation: true,
      dirtyReasons: ['initial', 'tokens'],
      isDisposed: false,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledTimes(2)

    scheduler.requestRender('hidden-tab-resume')
    expect(driver.flushNextFrame(72)).toBe(true)
    expect(renderFrame).toHaveBeenCalledWith({
      timestampMs: 72,
      reasons: ['initial', 'tokens', 'hidden-tab-resume', 'animation'],
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
      isDisposed: false,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledTimes(2)

    expect(driver.flushNextFrame(48)).toBe(true)

    expect(firstRenderFrame).not.toHaveBeenCalled()
    expect(secondRenderFrame).toHaveBeenCalledOnce()
    expect(secondRenderFrame).toHaveBeenCalledWith({
      timestampMs: 48,
      reasons: ['initial'],
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
      isDisposed: false,
    })
    expect(driver.cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(driver.flushNextFrame(40)).toBe(false)
    expect(renderFrame).not.toHaveBeenCalled()

    scheduler.requestRender('debug')
    expect(driver.flushNextFrame(56)).toBe(true)
    expect(renderFrame).toHaveBeenCalledOnce()

    expect(scheduler.dispose()).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
      isDisposed: true,
    })
    expect(scheduler.requestRender('manual')).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
      isDisposed: true,
    })
    expect(scheduler.setActiveAnimation(true)).toEqual({
      isFramePending: false,
      activeAnimation: false,
      dirtyReasons: [],
      isDisposed: true,
    })
    expect(driver.pendingFrameCount()).toBe(0)
  })
})
