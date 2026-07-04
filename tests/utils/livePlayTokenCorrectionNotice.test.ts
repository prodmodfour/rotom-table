import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_TOKEN_CORRECTION_NOTICE_DURATION_MS,
  createLivePlayTokenCorrectionNoticeController,
} from '~/utils/livePlayTokenCorrectionNotice'

describe('live-play token correction notices', () => {
  it('auto-dismisses correction notices after the bounded lifetime', () => {
    vi.useFakeTimers()
    try {
      const controller = createLivePlayTokenCorrectionNoticeController()

      controller.show({
        opId: 'op-timeout',
        placementId: 'token-a',
        message: 'Move corrected by the server.',
      })

      expect(controller.notice.value).toMatchObject({ opId: 'op-timeout', placementId: 'token-a' })
      vi.advanceTimersByTime(LIVE_PLAY_TOKEN_CORRECTION_NOTICE_DURATION_MS - 1)
      expect(controller.notice.value).not.toBeNull()
      vi.advanceTimersByTime(1)
      expect(controller.notice.value).toBeNull()

      controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('deduplicates repeated correction notices for the same operation', () => {
    vi.useFakeTimers()
    try {
      const controller = createLivePlayTokenCorrectionNoticeController()

      expect(controller.show({
        opId: 'op-duplicate',
        placementId: 'token-a',
        message: 'First correction.',
      })).toBe(true)
      expect(controller.show({
        opId: 'op-duplicate',
        placementId: 'token-a',
        message: 'Repeated correction.',
      })).toBe(false)
      expect(controller.notice.value?.message).toBe('First correction.')

      vi.advanceTimersByTime(LIVE_PLAY_TOKEN_CORRECTION_NOTICE_DURATION_MS)
      expect(controller.notice.value).toBeNull()
      expect(controller.hasCorrectedOpId('op-duplicate')).toBe(true)
      expect(controller.show({
        opId: 'op-duplicate',
        placementId: 'token-a',
        message: 'Repeated correction after timeout.',
      })).toBe(false)
      expect(controller.notice.value).toBeNull()

      controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the visible correction when the same token receives an accepted action', () => {
    vi.useFakeTimers()
    try {
      const controller = createLivePlayTokenCorrectionNoticeController()

      controller.show({
        opId: 'op-token-a-rejected',
        placementId: 'token-a',
        message: 'Move corrected by the server.',
      })
      controller.clearForPlacement('token-b')
      expect(controller.notice.value?.placementId).toBe('token-a')

      controller.clearForPlacement('token-a')
      expect(controller.notice.value).toBeNull()

      controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
