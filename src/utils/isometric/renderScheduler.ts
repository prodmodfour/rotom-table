import {
  mergeRenderInvalidationReasons,
  type RenderInvalidationReason,
} from './renderInvalidation'

export type IsometricRenderSchedulerFrameCallback = (timestampMs: number) => void

export type IsometricRenderSchedulerRequestAnimationFrame = (
  callback: IsometricRenderSchedulerFrameCallback,
) => number

export type IsometricRenderSchedulerCancelAnimationFrame = (frameHandle: number) => void

export type IsometricRenderSchedulerReasonInput =
  | RenderInvalidationReason
  | Iterable<RenderInvalidationReason>

export interface IsometricScheduledRenderFrame {
  timestampMs: number
  reasons: RenderInvalidationReason[]
  activeAnimation: boolean
}

export interface IsometricRenderSchedulerFrameResult {
  /** Whether animation sources still need another frame after this render step. */
  activeAnimation?: boolean
}

export interface IsometricRenderSchedulerOptions {
  renderFrame: (
    frame: IsometricScheduledRenderFrame,
  ) => IsometricRenderSchedulerFrameResult | void
  requestAnimationFrame?: IsometricRenderSchedulerRequestAnimationFrame
  cancelAnimationFrame?: IsometricRenderSchedulerCancelAnimationFrame
}

export interface IsometricRenderSchedulerSnapshot {
  isFramePending: boolean
  activeAnimation: boolean
  dirtyReasons: RenderInvalidationReason[]
  isDisposed: boolean
}

export interface IsometricRenderScheduler {
  requestRender: (reasons?: IsometricRenderSchedulerReasonInput) => IsometricRenderSchedulerSnapshot
  setActiveAnimation: (active: boolean) => IsometricRenderSchedulerSnapshot
  cancel: () => IsometricRenderSchedulerSnapshot
  dispose: () => IsometricRenderSchedulerSnapshot
  snapshot: () => IsometricRenderSchedulerSnapshot
}

const browserSafeRequestAnimationFrame: IsometricRenderSchedulerRequestAnimationFrame = (callback) => {
  const requestFrame = globalThis.requestAnimationFrame

  if (typeof requestFrame === 'function') {
    return requestFrame.call(globalThis, callback)
  }

  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number
}

const browserSafeCancelAnimationFrame: IsometricRenderSchedulerCancelAnimationFrame = (frameHandle) => {
  const cancelFrame = globalThis.cancelAnimationFrame

  if (typeof cancelFrame === 'function') {
    cancelFrame.call(globalThis, frameHandle)
    return
  }

  globalThis.clearTimeout(frameHandle as unknown as ReturnType<typeof setTimeout>)
}

const copySnapshot = (
  frameHandle: number | null,
  activeAnimation: boolean,
  dirtyReasons: RenderInvalidationReason[],
  isDisposed: boolean,
): IsometricRenderSchedulerSnapshot => ({
  isFramePending: frameHandle !== null,
  activeAnimation,
  dirtyReasons: [...dirtyReasons],
  isDisposed,
})

const normalizeReasonInput = (
  reasons: IsometricRenderSchedulerReasonInput = 'manual',
): RenderInvalidationReason[] => {
  if (typeof reasons === 'string') {
    return [reasons]
  }

  return mergeRenderInvalidationReasons(reasons)
}

const hasFrameWork = (
  dirtyReasons: RenderInvalidationReason[],
  activeAnimation: boolean,
): boolean => dirtyReasons.length > 0 || activeAnimation

export const createIsometricRenderScheduler = ({
  renderFrame,
  requestAnimationFrame = browserSafeRequestAnimationFrame,
  cancelAnimationFrame = browserSafeCancelAnimationFrame,
}: IsometricRenderSchedulerOptions): IsometricRenderScheduler => {
  let frameHandle: number | null = null
  let dirtyReasons: RenderInvalidationReason[] = []
  let activeAnimation = false
  let isDisposed = false

  const snapshot = () => copySnapshot(frameHandle, activeAnimation, dirtyReasons, isDisposed)

  const cancelFrameHandle = () => {
    if (frameHandle === null) return

    cancelAnimationFrame(frameHandle)
    frameHandle = null
  }

  const scheduleFrame = () => {
    if (isDisposed || frameHandle !== null || !hasFrameWork(dirtyReasons, activeAnimation)) {
      return
    }

    frameHandle = requestAnimationFrame(runFrame)
  }

  const cancelIdlePendingFrame = () => {
    if (hasFrameWork(dirtyReasons, activeAnimation)) return

    cancelFrameHandle()
  }

  const runFrame = (timestampMs: number) => {
    frameHandle = null

    if (isDisposed) {
      return
    }

    const frameActiveAnimation = activeAnimation
    const reasons = mergeRenderInvalidationReasons(
      dirtyReasons,
      frameActiveAnimation ? ['animation'] : undefined,
    )
    dirtyReasons = []

    if (!hasFrameWork(reasons, frameActiveAnimation)) {
      return
    }

    const frameResult = renderFrame({
      timestampMs,
      reasons,
      activeAnimation: frameActiveAnimation,
    })

    if (typeof frameResult?.activeAnimation === 'boolean') {
      activeAnimation = frameResult.activeAnimation
    }

    scheduleFrame()
  }

  const requestRender = (
    reasons: IsometricRenderSchedulerReasonInput = 'manual',
  ): IsometricRenderSchedulerSnapshot => {
    if (isDisposed) {
      return snapshot()
    }

    const nextReasons = normalizeReasonInput(reasons)
    dirtyReasons = mergeRenderInvalidationReasons(
      dirtyReasons,
      nextReasons.length > 0 ? nextReasons : ['manual'],
    )
    scheduleFrame()

    return snapshot()
  }

  const setActiveAnimation = (active: boolean): IsometricRenderSchedulerSnapshot => {
    if (isDisposed) {
      return snapshot()
    }

    activeAnimation = active

    if (activeAnimation) {
      scheduleFrame()
    } else {
      cancelIdlePendingFrame()
    }

    return snapshot()
  }

  const cancel = (): IsometricRenderSchedulerSnapshot => {
    cancelFrameHandle()
    dirtyReasons = []
    activeAnimation = false

    return snapshot()
  }

  const dispose = (): IsometricRenderSchedulerSnapshot => {
    cancel()
    isDisposed = true

    return snapshot()
  }

  return {
    requestRender,
    setActiveAnimation,
    cancel,
    dispose,
    snapshot,
  }
}
