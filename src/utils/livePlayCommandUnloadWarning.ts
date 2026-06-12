export const LIVE_PLAY_PENDING_COMMAND_UNLOAD_MESSAGE = 'A live-play command is still being sent to the server.'

export interface LivePlayCommandUnloadWarningTarget {
  addEventListener: (type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void) => void
  removeEventListener: (type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void) => void
}

/**
 * Warns when a browser close/refresh could interrupt an in-flight live-play
 * command. This does not attempt any beacon or keepalive write; the command's
 * original HTTP request and server-side opId idempotency remain the only live
 * mutation path.
 */
export const bindPendingLivePlayCommandUnloadWarning = (
  hasPendingCommand: () => boolean,
  target: LivePlayCommandUnloadWarningTarget | undefined =
    typeof window !== 'undefined' ? window : undefined,
): (() => void) | null => {
  if (!target) return null

  const warnBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!hasPendingCommand()) return
    event.preventDefault()
    event.returnValue = LIVE_PLAY_PENDING_COMMAND_UNLOAD_MESSAGE
  }

  target.addEventListener('beforeunload', warnBeforeUnload)

  let removed = false
  return () => {
    if (removed) return
    removed = true
    target.removeEventListener('beforeunload', warnBeforeUnload)
  }
}
