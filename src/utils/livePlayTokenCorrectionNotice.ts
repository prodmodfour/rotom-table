import { ref, type Ref } from 'vue'
import type { LivePlayTokenCorrectionNotice } from '~/types/livePlayUi'

export const LIVE_PLAY_TOKEN_CORRECTION_NOTICE_DURATION_MS = 5_000

export interface LivePlayTokenCorrectionNoticeInput {
  readonly opId: string
  readonly placementId: string
  readonly message: string
}

export interface LivePlayTokenCorrectionNoticeTimerApi {
  readonly setTimeout: (handler: () => void, timeoutMs: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}

export interface LivePlayTokenCorrectionNoticeController {
  readonly notice: Ref<LivePlayTokenCorrectionNotice | null>
  readonly hasCorrectedOpId: (opId: string) => boolean
  readonly show: (notice: LivePlayTokenCorrectionNoticeInput) => boolean
  readonly clear: () => void
  readonly clearForPlacement: (placementId: string) => void
  readonly dispose: () => void
}

export interface CreateLivePlayTokenCorrectionNoticeControllerOptions {
  readonly durationMs?: number
  readonly timerApi?: LivePlayTokenCorrectionNoticeTimerApi
}

const defaultTimerApi: LivePlayTokenCorrectionNoticeTimerApi = {
  setTimeout: (handler, timeoutMs) => globalThis.setTimeout(handler, timeoutMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

export const createLivePlayTokenCorrectionNoticeController = (
  options: CreateLivePlayTokenCorrectionNoticeControllerOptions = {},
): LivePlayTokenCorrectionNoticeController => {
  const durationMs = options.durationMs ?? LIVE_PLAY_TOKEN_CORRECTION_NOTICE_DURATION_MS
  const timerApi = options.timerApi ?? defaultTimerApi
  const notice = ref<LivePlayTokenCorrectionNotice | null>(null)
  const correctedOpIdSet = new Set<string>()
  let dismissTimer: unknown = null

  const clearDismissTimer = (): void => {
    if (dismissTimer === null) return
    timerApi.clearTimeout(dismissTimer)
    dismissTimer = null
  }

  const clear = (): void => {
    clearDismissTimer()
    notice.value = null
  }

  const rememberCorrectedOpId = (opId: string): void => {
    correctedOpIdSet.add(opId)
  }

  const scheduleDismissal = (): void => {
    clearDismissTimer()
    if (durationMs <= 0) return
    dismissTimer = timerApi.setTimeout(() => {
      dismissTimer = null
      notice.value = null
    }, durationMs)
  }

  const hasCorrectedOpId = (opId: string): boolean => correctedOpIdSet.has(opId)

  const show = (input: LivePlayTokenCorrectionNoticeInput): boolean => {
    if (hasCorrectedOpId(input.opId)) return false
    rememberCorrectedOpId(input.opId)
    notice.value = {
      opId: input.opId,
      placementId: input.placementId,
      message: input.message,
    }
    scheduleDismissal()
    return true
  }

  const clearForPlacement = (placementId: string): void => {
    if (notice.value?.placementId !== placementId) return
    clear()
  }

  return {
    notice,
    hasCorrectedOpId,
    show,
    clear,
    clearForPlacement,
    dispose: clear,
  }
}
