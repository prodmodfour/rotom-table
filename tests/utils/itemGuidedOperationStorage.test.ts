// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingItemGuidedOperation,
  createItemGuidedOperationId,
  loadPendingItemGuidedOperation,
  retainPendingItemGuidedOperation,
} from '~/utils/itemGuidedOperationStorage'

afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks() })

describe('guided item pending-command storage', () => {
  it('retains and clears one exact scope-bound command', () => {
    const command = {
      schemaVersion: 1 as const,
      operationId: 'item-guided-operation:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      action: 'cancel' as const,
      requestId: 'item-guided:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      expectedRevision: 0,
    }
    retainPendingItemGuidedOperation({ schemaVersion: 1, scope: 'trainer:mira', profileId: 'profile_mira0001', command })
    expect(loadPendingItemGuidedOperation('trainer:mira')).toEqual({
      schemaVersion: 1, scope: 'trainer:mira', profileId: 'profile_mira0001', command,
    })
    clearPendingItemGuidedOperation('trainer:mira', 'item-guided-operation:v1:cccccccccccccccccccccccccccccccc')
    expect(loadPendingItemGuidedOperation('trainer:mira')).not.toBeNull()
    clearPendingItemGuidedOperation('trainer:mira', command.operationId)
    expect(loadPendingItemGuidedOperation('trainer:mira')).toBeNull()
  })

  it('creates an opaque secure operation identity', () => {
    expect(createItemGuidedOperationId()).toMatch(/^item-guided-operation:v1:[a-f0-9]{32}$/)
  })
})
