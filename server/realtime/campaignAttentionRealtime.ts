import {
  CAMPAIGN_ATTENTION_REALTIME_EVENT_TYPES,
  campaignAttentionChannel,
} from '../../shared/realtime'
import {
  createRealtimeEventMaterial,
  type RealtimeEventMaterial,
} from '../../shared/realtimeEventLog'
import {
  parsePlayerProfileId,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
import {
  publishTransientRealtime,
  type TransientRealtimePublicationInput,
} from '../utils/realtime'

export const CAMPAIGN_ATTENTION_INVALIDATION_SCHEMA_VERSION = 1 as const
export const CAMPAIGN_ATTENTION_INVALIDATION_CAUSES = [
  'profile-authority',
  'sheet-authority',
  'settlement-authority',
  'campaign-day',
  'item-operation',
  'equipment-operation',
  'breeding-operation',
] as const
export type CampaignAttentionInvalidationCause = typeof CAMPAIGN_ATTENTION_INVALIDATION_CAUSES[number]

export interface CampaignAttentionInvalidationDataV1 {
  readonly schemaVersion: typeof CAMPAIGN_ATTENTION_INVALIDATION_SCHEMA_VERSION
  readonly cause: CampaignAttentionInvalidationCause
}

const cause = (value: unknown): CampaignAttentionInvalidationCause => (
  typeof value === 'string' && CAMPAIGN_ATTENTION_INVALIDATION_CAUSES.includes(value as CampaignAttentionInvalidationCause)
    ? value as CampaignAttentionInvalidationCause
    : (() => { throw new Error('Campaign attention invalidation cause is not registered.') })()
)

export const campaignAttentionInvalidationMaterials = (input: {
  readonly cause: CampaignAttentionInvalidationCause
  readonly profileIds?: readonly (PlayerProfileId | string)[]
  readonly includeGm?: boolean
}): readonly RealtimeEventMaterial[] => {
  const parsedCause = cause(input.cause)
  const profileIds = [...new Set((input.profileIds ?? []).map((id, index) => (
    parsePlayerProfileId(id, `profileIds[${index}]`)
  )))].sort()
  if (profileIds.length > 10_000) {
    throw new Error('Campaign attention invalidation is limited to 10000 Profile audiences.')
  }
  const data: CampaignAttentionInvalidationDataV1 = Object.freeze({
    schemaVersion: CAMPAIGN_ATTENTION_INVALIDATION_SCHEMA_VERSION,
    cause: parsedCause,
  })
  const event = Object.freeze({
    channel: campaignAttentionChannel,
    type: CAMPAIGN_ATTENTION_REALTIME_EVENT_TYPES.INVALIDATED,
    data,
  })
  const materials: RealtimeEventMaterial[] = []
  if (input.includeGm !== false) {
    materials.push(createRealtimeEventMaterial({ event, access: { kind: 'gm-only' } }))
  }
  for (const profileId of profileIds) {
    materials.push(createRealtimeEventMaterial({
      event,
      access: { kind: 'player-profile-access', profileId },
    }))
  }
  return Object.freeze(materials)
}

export const publishCampaignAttentionInvalidation = (input: {
  readonly cause: CampaignAttentionInvalidationCause
  readonly profileIds?: readonly (PlayerProfileId | string)[]
  readonly includeGm?: boolean
  readonly publish?: (publication: TransientRealtimePublicationInput) => void
}): void => {
  const publish = input.publish ?? publishTransientRealtime
  for (const material of campaignAttentionInvalidationMaterials(input)) {
    publish({ event: material.event, access: material.access })
  }
}
