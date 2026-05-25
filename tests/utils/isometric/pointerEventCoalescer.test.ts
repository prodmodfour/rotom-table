import { describe, expect, it, vi } from 'vitest'
import {
  copyCoalescedPointerEventData,
  createPointerEventCoalescer,
  type CoalescedPointerEventFrame,
} from '~/utils/isometric/pointerEventCoalescer'

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

const pointerEvent = (overrides: Partial<PointerEvent> = {}) => ({
  clientX: 10,
  clientY: 20,
  pageX: 30,
  pageY: 40,
  screenX: 50,
  screenY: 60,
  movementX: 1,
  movementY: 2,
  button: 0,
  buttons: 1,
  pointerId: 7,
  pointerType: 'mouse',
  isPrimary: true,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  timeStamp: 1234,
  ...overrides,
} as PointerEvent)

describe('isometric pointer event coalescer', () => {
  it('copies pointer event data without retaining the original event object', () => {
    const event = pointerEvent({ clientX: 12, pointerType: 'pen', shiftKey: true })

    const copied = copyCoalescedPointerEventData(event)

    expect(copied).toEqual({
      clientX: 12,
      clientY: 20,
      pageX: 30,
      pageY: 40,
      screenX: 50,
      screenY: 60,
      movementX: 1,
      movementY: 2,
      button: 0,
      buttons: 1,
      pointerId: 7,
      pointerType: 'pen',
      isPrimary: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      timeStamp: 1234,
    })
  })

  it('coalesces multiple queued pointer events into the latest event for one frame', () => {
    const driver = createAnimationFrameDriver()
    const processFrame = vi.fn()
    const coalescer = createPointerEventCoalescer({
      processFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    expect(coalescer.queue(pointerEvent({ clientX: 1 }))).toMatchObject({
      isFramePending: true,
      hasPendingEvent: true,
      pendingEventCount: 1,
      latestEvent: expect.objectContaining({ clientX: 1 }),
      isDisposed: false,
    })
    coalescer.queue(pointerEvent({ clientX: 2, pointerType: 'touch' }))
    const queued = coalescer.queue(pointerEvent({ clientX: 3, clientY: 4 }))

    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()
    expect(driver.pendingFrameCount()).toBe(1)
    expect(queued).toMatchObject({
      isFramePending: true,
      hasPendingEvent: true,
      pendingEventCount: 3,
      latestEvent: expect.objectContaining({ clientX: 3, clientY: 4 }),
      isDisposed: false,
    })

    expect(driver.flushNextFrame(16)).toBe(true)

    expect(processFrame).toHaveBeenCalledOnce()
    expect(processFrame).toHaveBeenCalledWith({
      timestampMs: 16,
      event: expect.objectContaining({ clientX: 3, clientY: 4, pointerType: 'mouse' }),
      coalescedEventCount: 3,
    })
    expect(coalescer.snapshot()).toEqual({
      isFramePending: false,
      hasPendingEvent: false,
      pendingEventCount: 0,
      latestEvent: null,
      isDisposed: false,
    })
  })

  it('processes later pointer events on later animation frames', () => {
    const driver = createAnimationFrameDriver()
    const processFrame = vi.fn()
    const coalescer = createPointerEventCoalescer({
      processFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    coalescer.queue(pointerEvent({ clientX: 1 }))
    expect(driver.flushNextFrame(16)).toBe(true)
    coalescer.queue(pointerEvent({ clientX: 2 }))
    expect(driver.flushNextFrame(32)).toBe(true)

    expect(processFrame).toHaveBeenNthCalledWith(1, {
      timestampMs: 16,
      event: expect.objectContaining({ clientX: 1 }),
      coalescedEventCount: 1,
    })
    expect(processFrame).toHaveBeenNthCalledWith(2, {
      timestampMs: 32,
      event: expect.objectContaining({ clientX: 2 }),
      coalescedEventCount: 1,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledTimes(2)
  })

  it('returns defensive snapshots for pending pointer data', () => {
    const driver = createAnimationFrameDriver()
    const coalescer = createPointerEventCoalescer({
      processFrame: vi.fn(),
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    const queued = coalescer.queue(pointerEvent({ clientX: 42 }))

    ;(queued.latestEvent as { clientX: number }).clientX = 99
    expect(coalescer.snapshot().latestEvent).toMatchObject({ clientX: 42 })
  })

  it('flushes pending pointer work immediately when callers need current state before an action', () => {
    const driver = createAnimationFrameDriver()
    const processFrame = vi.fn()
    const coalescer = createPointerEventCoalescer({
      processFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    coalescer.queue(pointerEvent({ clientX: 1 }))
    coalescer.queue(pointerEvent({ clientX: 2, clientY: 3 }))
    const flushed = coalescer.flush(24)

    expect(flushed).toEqual({
      isFramePending: false,
      hasPendingEvent: false,
      pendingEventCount: 0,
      latestEvent: null,
      isDisposed: false,
    })
    expect(driver.cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(driver.flushNextFrame(32)).toBe(false)
    expect(processFrame).toHaveBeenCalledOnce()
    expect(processFrame).toHaveBeenCalledWith({
      timestampMs: 24,
      event: expect.objectContaining({ clientX: 2, clientY: 3 }),
      coalescedEventCount: 2,
    })
  })

  it('cancels pending pointer work before it is processed', () => {
    const driver = createAnimationFrameDriver()
    const processFrame = vi.fn()
    const coalescer = createPointerEventCoalescer({
      processFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    coalescer.queue(pointerEvent())
    const cancelled = coalescer.cancel()

    expect(cancelled).toEqual({
      isFramePending: false,
      hasPendingEvent: false,
      pendingEventCount: 0,
      latestEvent: null,
      isDisposed: false,
    })
    expect(driver.cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(driver.flushNextFrame(16)).toBe(false)
    expect(processFrame).not.toHaveBeenCalled()
  })

  it('disposes pending work and ignores future pointer events', () => {
    const driver = createAnimationFrameDriver()
    const processFrame = vi.fn()
    const coalescer = createPointerEventCoalescer({
      processFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    coalescer.queue(pointerEvent({ clientX: 1 }))
    expect(coalescer.dispose()).toEqual({
      isFramePending: false,
      hasPendingEvent: false,
      pendingEventCount: 0,
      latestEvent: null,
      isDisposed: true,
    })

    expect(coalescer.queue(pointerEvent({ clientX: 2 }))).toEqual({
      isFramePending: false,
      hasPendingEvent: false,
      pendingEventCount: 0,
      latestEvent: null,
      isDisposed: true,
    })
    expect(driver.requestAnimationFrame).toHaveBeenCalledOnce()
    expect(driver.pendingFrameCount()).toBe(0)
    expect(processFrame).not.toHaveBeenCalled()
  })

  it('allows callers to queue the next pointer event while processing the current frame', () => {
    const driver = createAnimationFrameDriver()
    let coalescer: ReturnType<typeof createPointerEventCoalescer>
    const processFrame = vi.fn((frame: CoalescedPointerEventFrame) => {
      if (frame.event.clientX === 1) {
        coalescer.queue(pointerEvent({ clientX: 2 }))
      }
    })
    coalescer = createPointerEventCoalescer({
      processFrame,
      requestAnimationFrame: driver.requestAnimationFrame,
      cancelAnimationFrame: driver.cancelAnimationFrame,
    })

    coalescer.queue(pointerEvent({ clientX: 1 }))
    expect(driver.flushNextFrame(16)).toBe(true)

    expect(driver.requestAnimationFrame).toHaveBeenCalledTimes(2)
    expect(coalescer.snapshot()).toMatchObject({
      isFramePending: true,
      hasPendingEvent: true,
      pendingEventCount: 1,
      latestEvent: expect.objectContaining({ clientX: 2 }),
    })

    expect(driver.flushNextFrame(32)).toBe(true)
    expect(processFrame).toHaveBeenNthCalledWith(2, {
      timestampMs: 32,
      event: expect.objectContaining({ clientX: 2 }),
      coalescedEventCount: 1,
    })
  })
})
