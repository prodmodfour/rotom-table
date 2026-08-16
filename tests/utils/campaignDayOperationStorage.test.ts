import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY,
  clearPendingCampaignDayOperation,
  loadPendingCampaignDayOperation,
  pendingCampaignDayOperation,
  retainPendingCampaignDayOperation,
} from '~/utils/campaignDayOperationStorage'
import { parseCampaignDayOperationCommandV1 } from '#shared/campaignDay'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: new MemoryStorage() })
})
afterEach(() => vi.unstubAllGlobals())

describe('campaign-day browser operation retention', () => {
  it('retains one logical identity across uncertain retries and clears only its acceptance', () => {
    const first = pendingCampaignDayOperation()
    const retry = pendingCampaignDayOperation()
    expect(retry).toEqual(first)
    expect(first.operationId).toMatch(/^campaign-day:v1:[0-9a-f]{32}$/)

    clearPendingCampaignDayOperation('campaign-day:v1:ffffffffffffffffffffffffffffffff')
    expect(loadPendingCampaignDayOperation()).toEqual(first)
    clearPendingCampaignDayOperation(first.operationId)
    expect(loadPendingCampaignDayOperation()).toBeNull()
    expect(pendingCampaignDayOperation().operationId).not.toBe(first.operationId)
  })

  it('strictly validates retained evidence and discards corrupt storage', () => {
    window.localStorage.setItem(CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY, '{bad json')
    expect(loadPendingCampaignDayOperation()).toBeNull()
    expect(window.localStorage.getItem(CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY)).toBeNull()

    const command = parseCampaignDayOperationCommandV1({
      schemaVersion: 1,
      operationId: 'campaign-day:v1:11111111111111111111111111111111',
      kind: 'advance-one-day',
      days: 1,
    })
    expect(retainPendingCampaignDayOperation(command)).toEqual(command)
    expect(loadPendingCampaignDayOperation()).toEqual(command)
  })
})
