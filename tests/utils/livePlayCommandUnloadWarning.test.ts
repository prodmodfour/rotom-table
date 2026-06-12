import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_PENDING_COMMAND_UNLOAD_MESSAGE,
  bindPendingLivePlayCommandUnloadWarning,
  type LivePlayCommandUnloadWarningTarget,
} from '~/utils/livePlayCommandUnloadWarning'

describe('bindPendingLivePlayCommandUnloadWarning', () => {
  const createTarget = () => {
    const listeners = new Map<string, (event: BeforeUnloadEvent) => void>()
    const target: LivePlayCommandUnloadWarningTarget = {
      addEventListener: vi.fn((type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void) => {
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void) => {
        if (listeners.get(type) === listener) listeners.delete(type)
      }),
    }
    return { target, listeners }
  }

  const createBeforeUnloadEvent = () => ({
    preventDefault: vi.fn(),
    returnValue: undefined as string | undefined,
  }) as unknown as BeforeUnloadEvent & { returnValue?: string }

  it('binds only beforeunload and warns when a live-play command is pending', () => {
    const { target, listeners } = createTarget()
    let pending = false

    const remove = bindPendingLivePlayCommandUnloadWarning(() => pending, target)

    expect(remove).toEqual(expect.any(Function))
    expect(target.addEventListener).toHaveBeenCalledTimes(1)
    expect(target.addEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    expect(listeners.has('pagehide')).toBe(false)

    const idleEvent = createBeforeUnloadEvent()
    listeners.get('beforeunload')?.(idleEvent)
    expect(idleEvent.preventDefault).not.toHaveBeenCalled()
    expect(idleEvent.returnValue).toBeUndefined()

    pending = true
    const pendingEvent = createBeforeUnloadEvent()
    listeners.get('beforeunload')?.(pendingEvent)
    expect(pendingEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(pendingEvent.returnValue).toBe(LIVE_PLAY_PENDING_COMMAND_UNLOAD_MESSAGE)
  })

  it('removes the pending-command warning listener idempotently', () => {
    const { target, listeners } = createTarget()
    const remove = bindPendingLivePlayCommandUnloadWarning(() => true, target)

    remove?.()
    remove?.()

    expect(target.removeEventListener).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(0)
  })
})
