export const GM_CAMPAIGN_TOOLKIT_CHANNEL = 'gm-campaign-toolkit'

export type GmCampaignToolkitDomain = 'encounter-table' | 'wild-generation' | 'npc-generation' | 'session-preparation'

export interface GmCampaignToolkitInvalidationV1 {
  readonly schemaVersion: 1
  readonly domain: GmCampaignToolkitDomain
  readonly documentId: string
  readonly revision: number
}

export interface GmCampaignToolkitInvalidationPayloadV1 {
  readonly documentId: string
  readonly revision: number
}

export const isGmCampaignToolkitInvalidationV1 = (value: unknown): value is GmCampaignToolkitInvalidationPayloadV1 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Object.keys(row).length === 2
    && typeof row.documentId === 'string'
    && Number.isSafeInteger(row.revision)
    && Number(row.revision) >= 0
}
