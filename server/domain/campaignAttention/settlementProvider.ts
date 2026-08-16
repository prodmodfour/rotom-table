import { createHash } from 'node:crypto'
import {
  campaignAttentionAuthorityFromSettlement,
  createOpenCampaignAttentionItem,
  parseCampaignAttentionItem,
  type CampaignAttentionActionIntent,
  type CampaignAttentionDecisionKind,
  type CampaignAttentionEntityKind,
  type CampaignAttentionItem,
  type CampaignAttentionReason,
  type CampaignAttentionUrgency,
} from '../../../shared/campaignAttention/model'
import type { StoredEncounterSettlementAttentionSource } from '../../storage/encounterSettlementRepository'

const SOURCE_LIMIT = 10_000

const identity = (prefix: string, ...parts: readonly string[]): string =>
  `${prefix}${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`

interface ReasonDefinition {
  readonly urgency: CampaignAttentionUrgency
  readonly decision: CampaignAttentionDecisionKind
  readonly action: CampaignAttentionActionIntent
}

const DEFINITIONS = Object.freeze({
  'level-threshold': {
    urgency: 'normal', decision: 'allocate-advancement', action: 'review-advancement',
  },
  'advancement-review': {
    urgency: 'normal', decision: 'allocate-advancement', action: 'review-advancement',
  },
  'capture-review': {
    urgency: 'normal', decision: 'review-capture', action: 'review-capture',
  },
  'medical-review': {
    urgency: 'urgent', decision: 'choose-treatment', action: 'start-treatment',
  },
  'equipment-review': {
    urgency: 'normal', decision: 'repair-equipment', action: 'review-equipment',
  },
  'continuation-review': {
    urgency: 'informational', decision: 'review-continuation', action: 'continue-campaign',
  },
} satisfies Readonly<Record<StoredEncounterSettlementAttentionSource['reason'], ReasonDefinition>>)

const entityKind = (
  kind: StoredEncounterSettlementAttentionSource['entityKind'],
): CampaignAttentionEntityKind => kind

const entityHref = (source: StoredEncounterSettlementAttentionSource): string => {
  const entityId = encodeURIComponent(source.entityId)
  if (source.entityKind === 'pokemon-sheet') return `/sheets/pokemon/${entityId}`
  if (source.entityKind === 'trainer-sheet') return `/sheets/trainers/${entityId}`
  return '/campaign'
}

export const campaignAttentionItemFromSettlementSource = (
  source: StoredEncounterSettlementAttentionSource,
): CampaignAttentionItem => {
  const definition = DEFINITIONS[source.reason]
  const authority = campaignAttentionAuthorityFromSettlement(source.authority)
  const itemId = identity('campaign-attention:v1:', source.sourceId)
  const item = createOpenCampaignAttentionItem({
    itemId,
    reason: source.reason satisfies CampaignAttentionReason,
    audience: source.audience,
    urgency: definition.urgency,
    entity: Object.freeze({ kind: entityKind(source.entityKind), id: source.entityId }),
    sourceEvent: Object.freeze({
      kind: 'encounter-settlement',
      eventId: source.sourceFactId,
      campaignMinute: source.createdAtCampaignMinute,
    }),
    authority,
    requiredDecision: Object.freeze({
      decisionId: identity('campaign-attention-decision:v1:', source.sourceId),
      kind: definition.decision,
      authority,
    }),
    legalActions: Object.freeze([Object.freeze({
      actionId: identity('campaign-attention-action:v1:', source.sourceId, definition.action),
      intent: definition.action,
      href: entityHref(source),
      authority,
      requiresConfirmation: false,
    })]),
    createdAtCampaignMinute: source.createdAtCampaignMinute,
  })
  if (source.status === 'open') {
    if (source.revision !== 0 || source.resolvedAtCampaignMinute !== null || source.resolutionOperationId !== null) {
      throw new Error('Open settlement attention source contains terminal resolution evidence.')
    }
    return item
  }
  if (source.revision < 1 || source.resolvedAtCampaignMinute === null || source.resolutionOperationId === null) {
    throw new Error('Resolved settlement attention source is missing complete resolution evidence.')
  }
  return parseCampaignAttentionItem({
    ...item,
    requiredDecision: null,
    legalActions: [],
    resolution: {
      state: 'resolved',
      revision: source.revision,
      code: 'completed',
      resolutionEventId: source.resolutionOperationId,
      resolvedAtCampaignMinute: source.resolvedAtCampaignMinute,
    },
  })
}

export const campaignAttentionItemsFromSettlementSources = (
  sources: readonly StoredEncounterSettlementAttentionSource[],
): readonly CampaignAttentionItem[] => {
  if (sources.length > SOURCE_LIMIT) {
    throw new Error(`Settlement attention source projection is limited to ${SOURCE_LIMIT} records.`)
  }
  const items = sources.map(campaignAttentionItemFromSettlementSource)
  if (new Set(items.map(item => item.itemId)).size !== items.length) {
    throw new Error('Settlement attention sources must project unique campaign attention identities.')
  }
  const urgencyRank: Readonly<Record<CampaignAttentionUrgency, number>> = {
    blocking: 0, urgent: 1, normal: 2, informational: 3,
  }
  return Object.freeze([...items].sort((left, right) => (
    urgencyRank[left.urgency] - urgencyRank[right.urgency]
    || left.createdAtCampaignMinute - right.createdAtCampaignMinute
    || left.itemId.localeCompare(right.itemId)
  )))
}
