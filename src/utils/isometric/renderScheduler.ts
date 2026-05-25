import {
  mergeIsometricRenderDirtyLayers,
  mergeRenderInvalidationReasons,
  resolveRenderInvalidationLayers,
  type IsometricRenderDirtyLayer,
  type RenderInvalidationReason,
} from './renderInvalidation'

export type IsometricRenderSchedulerFrameCallback = (timestampMs: number) => void

export type IsometricRenderSchedulerRequestAnimationFrame = (
  callback: IsometricRenderSchedulerFrameCallback,
) => number

export type IsometricRenderSchedulerCancelAnimationFrame = (frameHandle: number) => void

export type IsometricRenderSchedulerReasonCollection =
  | RenderInvalidationReason
  | Iterable<RenderInvalidationReason>

export type IsometricRenderSchedulerDirtyLayerInput =
  | IsometricRenderDirtyLayer
  | Iterable<IsometricRenderDirtyLayer>

export interface IsometricRenderSchedulerRenderRequest {
  /** Reasons kept for metrics/debug labelling. Defaults to `manual` when omitted. */
  reasons?: IsometricRenderSchedulerReasonCollection
  /** Optional explicit dirty render layer override for CSS-only or WebGL-only invalidations. */
  dirtyLayers?: IsometricRenderSchedulerDirtyLayerInput
}

export type IsometricRenderSchedulerReasonInput =
  | IsometricRenderSchedulerReasonCollection
  | IsometricRenderSchedulerRenderRequest

interface NormalizedRenderSchedulerRequest {
  reasons: RenderInvalidationReason[]
  dirtyLayers: IsometricRenderDirtyLayer[]
}

export interface IsometricScheduledRenderFrame {
  timestampMs: number
  reasons: RenderInvalidationReason[]
  dirtyLayers: IsometricRenderDirtyLayer[]
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
  dirtyLayers: IsometricRenderDirtyLayer[]
  isDisposed: boolean
}

export interface IsometricRenderScheduler {
  requestRender: (reasons?: IsometricRenderSchedulerReasonInput) => IsometricRenderSchedulerSnapshot
  setActiveAnimation: (active: boolean) => IsometricRenderSchedulerSnapshot
  pause: () => IsometricRenderSchedulerSnapshot
  resume: () => IsometricRenderSchedulerSnapshot
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
  dirtyLayers: IsometricRenderDirtyLayer[],
  isDisposed: boolean,
): IsometricRenderSchedulerSnapshot => ({
  isFramePending: frameHandle !== null,
  activeAnimation,
  dirtyReasons: [...dirtyReasons],
  dirtyLayers: [...dirtyLayers],
  isDisposed,
})

const isSchedulerRenderRequest = (
  input: IsometricRenderSchedulerReasonInput,
): input is IsometricRenderSchedulerRenderRequest => (
  typeof input === 'object'
  && input !== null
  && ('reasons' in input || 'dirtyLayers' in input)
)

const normalizeReasonCollection = (
  reasons: IsometricRenderSchedulerReasonCollection = 'manual',
): RenderInvalidationReason[] => {
  if (typeof reasons === 'string') {
    return [reasons]
  }

  return mergeRenderInvalidationReasons(reasons)
}

const normalizeDirtyLayerInput = (
  dirtyLayers: IsometricRenderSchedulerDirtyLayerInput,
): IsometricRenderDirtyLayer[] => {
  if (typeof dirtyLayers === 'string') {
    return [dirtyLayers]
  }

  return mergeIsometricRenderDirtyLayers(dirtyLayers)
}

const normalizeRenderRequest = (
  input: IsometricRenderSchedulerReasonInput = 'manual',
): NormalizedRenderSchedulerRequest => {
  const isExplicitRequest = isSchedulerRenderRequest(input)
  const rawReasons = isExplicitRequest ? input.reasons : input
  const reasons = normalizeReasonCollection(rawReasons ?? 'manual')
  const normalizedReasons: RenderInvalidationReason[] = reasons.length > 0 ? reasons : ['manual']
  const explicitDirtyLayers = isExplicitRequest && input.dirtyLayers !== undefined
    ? normalizeDirtyLayerInput(input.dirtyLayers)
    : []

  return {
    reasons: normalizedReasons,
    dirtyLayers: explicitDirtyLayers.length > 0
      ? explicitDirtyLayers
      : resolveRenderInvalidationLayers(normalizedReasons),
  }
}

const hasFrameWork = (
  dirtyReasons: RenderInvalidationReason[],
  dirtyLayers: IsometricRenderDirtyLayer[],
  activeAnimation: boolean,
): boolean => dirtyReasons.length > 0 || dirtyLayers.length > 0 || activeAnimation

export const createIsometricRenderScheduler = ({
  renderFrame,
  requestAnimationFrame = browserSafeRequestAnimationFrame,
  cancelAnimationFrame = browserSafeCancelAnimationFrame,
}: IsometricRenderSchedulerOptions): IsometricRenderScheduler => {
  let frameHandle: number | null = null
  let dirtyReasons: RenderInvalidationReason[] = []
  let dirtyLayers: IsometricRenderDirtyLayer[] = []
  let activeAnimation = false
  let isPaused = false
  let isDisposed = false

  const snapshot = () => copySnapshot(frameHandle, activeAnimation, dirtyReasons, dirtyLayers, isDisposed)

  const cancelFrameHandle = () => {
    if (frameHandle === null) return

    cancelAnimationFrame(frameHandle)
    frameHandle = null
  }

  const scheduleFrame = () => {
    if (isDisposed || isPaused || frameHandle !== null || !hasFrameWork(dirtyReasons, dirtyLayers, activeAnimation)) {
      return
    }

    frameHandle = requestAnimationFrame(runFrame)
  }

  const cancelIdlePendingFrame = () => {
    if (hasFrameWork(dirtyReasons, dirtyLayers, activeAnimation)) return

    cancelFrameHandle()
  }

  const runFrame = (timestampMs: number) => {
    frameHandle = null

    if (isDisposed || isPaused) {
      return
    }

    const frameActiveAnimation = activeAnimation
    const animationReasons: RenderInvalidationReason[] | undefined = frameActiveAnimation ? ['animation'] : undefined
    const reasons = mergeRenderInvalidationReasons(
      dirtyReasons,
      animationReasons,
    )
    const frameDirtyLayers = mergeIsometricRenderDirtyLayers(
      dirtyLayers,
      animationReasons ? resolveRenderInvalidationLayers(animationReasons) : undefined,
    )
    dirtyReasons = []
    dirtyLayers = []

    if (!hasFrameWork(reasons, frameDirtyLayers, frameActiveAnimation)) {
      return
    }

    const frameResult = renderFrame({
      timestampMs,
      reasons,
      dirtyLayers: frameDirtyLayers,
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

    const nextRequest = normalizeRenderRequest(reasons)
    dirtyReasons = mergeRenderInvalidationReasons(
      dirtyReasons,
      nextRequest.reasons,
    )
    dirtyLayers = mergeIsometricRenderDirtyLayers(
      dirtyLayers,
      nextRequest.dirtyLayers,
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

  const pause = (): IsometricRenderSchedulerSnapshot => {
    if (isDisposed) {
      return snapshot()
    }

    isPaused = true
    cancelFrameHandle()

    return snapshot()
  }

  const resume = (): IsometricRenderSchedulerSnapshot => {
    if (isDisposed) {
      return snapshot()
    }

    isPaused = false
    scheduleFrame()

    return snapshot()
  }

  const cancel = (): IsometricRenderSchedulerSnapshot => {
    cancelFrameHandle()
    dirtyReasons = []
    dirtyLayers = []
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
    pause,
    resume,
    cancel,
    dispose,
    snapshot,
  }
}
