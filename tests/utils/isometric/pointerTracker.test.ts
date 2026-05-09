import { describe, expect, it } from 'vitest'
import {
  ISOMETRIC_CLICK_TRAVEL_THRESHOLD,
  createPointerTravelTracker,
} from '~/utils/isometric/pointerTracker'

describe('isometric pointer travel tracker', () => {
  it('starts at zero travel and treats stationary pointers as clicks', () => {
    const tracker = createPointerTravelTracker()
    tracker.start({ clientX: 10, clientY: 20 })

    expect(tracker.travel()).toBe(0)
    expect(tracker.isClick()).toBe(true)
  })

  it('tracks maximum travel from pointer down', () => {
    const tracker = createPointerTravelTracker()
    tracker.start({ clientX: 0, clientY: 0 })

    expect(tracker.move({ clientX: 3, clientY: 4 })).toBe(5)
    expect(tracker.move({ clientX: 1, clientY: 1 })).toBe(5)
    expect(tracker.move({ clientX: 6, clientY: 8 })).toBe(10)
    expect(tracker.travel()).toBe(10)
  })

  it('uses the isometric click threshold by default and supports overrides', () => {
    const tracker = createPointerTravelTracker()
    tracker.start({ clientX: 0, clientY: 0 })
    tracker.move({ clientX: ISOMETRIC_CLICK_TRAVEL_THRESHOLD, clientY: 0 })

    expect(tracker.isClick()).toBe(true)

    tracker.move({ clientX: ISOMETRIC_CLICK_TRAVEL_THRESHOLD + 1, clientY: 0 })
    expect(tracker.isClick()).toBe(false)
    expect(tracker.isClick(8)).toBe(true)
  })

  it('resets travel on each new pointer start', () => {
    const tracker = createPointerTravelTracker()
    tracker.start({ clientX: 0, clientY: 0 })
    tracker.move({ clientX: 20, clientY: 0 })
    expect(tracker.isClick()).toBe(false)

    tracker.start({ clientX: 100, clientY: 100 })
    expect(tracker.travel()).toBe(0)
    expect(tracker.isClick()).toBe(true)
  })
})
