import {
  CAMPAIGN_ATTENTION_URGENCIES,
  parseCampaignAttentionItem,
  type CampaignAttentionItem,
  type CampaignAttentionUrgency,
} from './model'

export const CAMPAIGN_ATTENTION_PROJECTION_SCHEMA_VERSION = 1 as const
export const CAMPAIGN_ATTENTION_PROJECTION_LIMIT = 10_000
export const CAMPAIGN_ATTENTION_SNAPSHOT_ID_RE = /^campaign-attention-snapshot:v1:[a-f0-9]{64}$/
export const CAMPAIGN_ATTENTION_PROJECTION_SCOPES = ['gm', 'owner'] as const
export type CampaignAttentionProjectionScope = typeof CAMPAIGN_ATTENTION_PROJECTION_SCOPES[number]

export interface CampaignAttentionProjectionSummary {
  readonly total: number
  readonly blocking: number
  readonly urgent: number
  readonly normal: number
  readonly informational: number
}

export interface CampaignAttentionProjectionV1 {
  readonly schemaVersion: typeof CAMPAIGN_ATTENTION_PROJECTION_SCHEMA_VERSION
  readonly snapshotId: string
  readonly scope: CampaignAttentionProjectionScope
  readonly campaignMinute: number
  readonly items: readonly CampaignAttentionItem[]
  readonly summary: CampaignAttentionProjectionSummary
}

export const CAMPAIGN_ATTENTION_URGENCY_RANK: Readonly<Record<CampaignAttentionUrgency, number>> = Object.freeze({
  blocking: 0,
  urgent: 1,
  normal: 2,
  informational: 3,
})

export const compareCampaignAttentionItems = (
  left: CampaignAttentionItem,
  right: CampaignAttentionItem,
): number => (
  CAMPAIGN_ATTENTION_URGENCY_RANK[left.urgency] - CAMPAIGN_ATTENTION_URGENCY_RANK[right.urgency]
  || left.entity.kind.localeCompare(right.entity.kind)
  || left.entity.id.localeCompare(right.entity.id)
  || left.reason.localeCompare(right.reason)
  || left.createdAtCampaignMinute - right.createdAtCampaignMinute
  || left.itemId.localeCompare(right.itemId)
)

const object = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`)
  }
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, fields: readonly string[], path: string): void => {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new Error(`${path} must contain exactly ${fields.join(', ')}.`)
  }
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${path} must be a non-negative safe integer.`)
  }
  return Number(value)
}

export const campaignAttentionProjectionSummary = (
  items: readonly CampaignAttentionItem[],
): CampaignAttentionProjectionSummary => Object.freeze({
  total: items.length,
  blocking: items.filter(item => item.urgency === 'blocking').length,
  urgent: items.filter(item => item.urgency === 'urgent').length,
  normal: items.filter(item => item.urgency === 'normal').length,
  informational: items.filter(item => item.urgency === 'informational').length,
})

export const parseCampaignAttentionProjection = (
  value: unknown,
  path = 'campaignAttentionProjection',
): CampaignAttentionProjectionV1 => {
  const input = object(value, path)
  exact(input, ['schemaVersion', 'snapshotId', 'scope', 'campaignMinute', 'items', 'summary'], path)
  if (input.schemaVersion !== CAMPAIGN_ATTENTION_PROJECTION_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion must be 1.`)
  }
  if (typeof input.snapshotId !== 'string' || !CAMPAIGN_ATTENTION_SNAPSHOT_ID_RE.test(input.snapshotId)) {
    throw new Error(`${path}.snapshotId must be one stable v1 snapshot identity.`)
  }
  if (input.scope !== 'gm' && input.scope !== 'owner') {
    throw new Error(`${path}.scope must be gm or owner.`)
  }
  const scope = input.scope
  const campaignMinute = integer(input.campaignMinute, `${path}.campaignMinute`)
  if (!Array.isArray(input.items) || input.items.length > CAMPAIGN_ATTENTION_PROJECTION_LIMIT) {
    throw new Error(`${path}.items must be a complete array bounded to ${CAMPAIGN_ATTENTION_PROJECTION_LIMIT} items.`)
  }
  const items = input.items.map((item, index) => parseCampaignAttentionItem(item, `${path}.items[${index}]`))
  if (new Set(items.map(item => item.itemId)).size !== items.length) {
    throw new Error(`${path}.items must contain unique attention identities.`)
  }
  if (items.some(item => item.resolution.state !== 'open')) {
    throw new Error(`${path}.items may contain only current open attention.`)
  }
  if (scope === 'owner' && items.some(item => item.audience !== 'owner')) {
    throw new Error(`${path}.items may not expose GM attention in an owner projection.`)
  }
  for (let index = 1; index < items.length; index += 1) {
    if (compareCampaignAttentionItems(items[index - 1]!, items[index]!) > 0) {
      throw new Error(`${path}.items must use deterministic campaign attention order.`)
    }
  }
  const summaryInput = object(input.summary, `${path}.summary`)
  exact(summaryInput, ['total', ...CAMPAIGN_ATTENTION_URGENCIES], `${path}.summary`)
  const summary: CampaignAttentionProjectionSummary = Object.freeze({
    total: integer(summaryInput.total, `${path}.summary.total`),
    blocking: integer(summaryInput.blocking, `${path}.summary.blocking`),
    urgent: integer(summaryInput.urgent, `${path}.summary.urgent`),
    normal: integer(summaryInput.normal, `${path}.summary.normal`),
    informational: integer(summaryInput.informational, `${path}.summary.informational`),
  })
  const expected = campaignAttentionProjectionSummary(items)
  if (Object.keys(expected).some(key => expected[key as keyof CampaignAttentionProjectionSummary]
    !== summary[key as keyof CampaignAttentionProjectionSummary])) {
    throw new Error(`${path}.summary must exactly count the projected items.`)
  }
  if (items.some(item => item.createdAtCampaignMinute > campaignMinute)) {
    throw new Error(`${path}.items cannot contain future campaign authority.`)
  }
  return Object.freeze({
    schemaVersion: CAMPAIGN_ATTENTION_PROJECTION_SCHEMA_VERSION,
    snapshotId: input.snapshotId,
    scope,
    campaignMinute,
    items: Object.freeze(items),
    summary,
  })
}
