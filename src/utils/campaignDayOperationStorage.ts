import {
  parseCampaignDayOperationCommandV1,
  type CampaignDayOperationCommandV1,
} from '#shared/campaignDay'

export const CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY = 'rotom-table:campaign-day:pending:v1'

const randomHex32 = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    const value = globalThis.crypto.randomUUID().replace(/-/g, '').toLowerCase()
    if (/^[0-9a-f]{32}$/.test(value)) return value
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure browser randomness is required for campaign-day operation identity.')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

export const createCampaignDayOperationCommand = (): CampaignDayOperationCommandV1 => (
  parseCampaignDayOperationCommandV1({
    schemaVersion: 1,
    operationId: `campaign-day:v1:${randomHex32()}`,
    kind: 'advance-one-day',
    days: 1,
  })
)

export const loadPendingCampaignDayOperation = (): CampaignDayOperationCommandV1 | null => {
  if (typeof window === 'undefined') return null
  const stored = window.localStorage.getItem(CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY)
  if (stored === null) return null
  try {
    return parseCampaignDayOperationCommandV1(JSON.parse(stored))
  }
  catch {
    window.localStorage.removeItem(CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY)
    return null
  }
}

export const retainPendingCampaignDayOperation = (
  command: CampaignDayOperationCommandV1,
): CampaignDayOperationCommandV1 => {
  const parsed = parseCampaignDayOperationCommandV1(command)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY,
      JSON.stringify(parsed),
    )
  }
  return parsed
}

export const pendingCampaignDayOperation = (): CampaignDayOperationCommandV1 => (
  loadPendingCampaignDayOperation()
  ?? retainPendingCampaignDayOperation(createCampaignDayOperationCommand())
)

export const clearPendingCampaignDayOperation = (operationId: string): void => {
  if (typeof window === 'undefined') return
  const pending = loadPendingCampaignDayOperation()
  if (pending?.operationId === operationId) {
    window.localStorage.removeItem(CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY)
  }
}
