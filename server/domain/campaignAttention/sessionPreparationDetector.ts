import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { createOpenCampaignAttentionItem, type CampaignAttentionItem } from '#shared/campaignAttention/model'
import { compareCampaignAttentionItems } from '#shared/campaignAttention/projection'
import { parseSessionPreparationDocumentV1, type SessionPreparationDocumentV1 } from '#shared/gmToolkit/sessionPreparation'

const identity = (prefix: string, value: unknown): string => `${prefix}${createHash('sha256').update(stableJsonStringify(value)).digest('hex')}`
export const projectCampaignSessionPreparationAttention = (input: {
  readonly preparations: readonly SessionPreparationDocumentV1[]
  readonly campaignMinute: number
  readonly completeness: { readonly preparations: true }
}): readonly CampaignAttentionItem[] => {
  if (input.completeness.preparations !== true || !Number.isSafeInteger(input.campaignMinute) || input.campaignMinute < 0) throw new Error('Session preparation attention requires one complete current authority read and campaign time.')
  if (!Array.isArray(input.preparations) || input.preparations.length > 10_000) throw new Error('Session preparation attention exceeds its complete bounded read.')
  const preparations = input.preparations.map(parseSessionPreparationDocumentV1)
  if (new Set(preparations.map(row => row.preparationId)).size !== preparations.length) throw new Error('Session preparation attention requires unique preparation identities.')
  const items = preparations
    .filter(row => !['archived', 'cancelled', 'launched'].includes(row.lifecycle))
    .flatMap(preparation => preparation.unresolvedDecisions.filter(decision => decision.state === 'open').map((decision): CampaignAttentionItem => {
      const authority = Object.freeze({ kind: 'session-preparation' as const, id: preparation.preparationId, revision: preparation.revision })
      const itemId = identity('campaign-attention:v1:', { kind: 'session-preparation', preparationId: preparation.preparationId, decisionId: decision.decisionId })
      return createOpenCampaignAttentionItem({
        itemId,
        reason: 'session-preparation-decision',
        audience: 'gm',
        urgency: preparation.lifecycle === 'review' || preparation.lifecycle === 'ready' ? 'urgent' : 'normal',
        entity: Object.freeze({ kind: 'session-preparation', id: preparation.preparationId }),
        sourceEvent: Object.freeze({ kind: 'session-preparation', eventId: identity('campaign-attention-source:v1:', { preparationId: preparation.preparationId, decisionId: decision.decisionId }), campaignMinute: input.campaignMinute }),
        authority,
        requiredDecision: Object.freeze({ decisionId: identity('campaign-attention-decision:v1:', { itemId, decisionId: decision.decisionId }), kind: 'resolve-session-preparation', authority }),
        legalActions: Object.freeze([{ actionId: identity('campaign-attention-action:v1:', { itemId, intent: 'review-session-preparation' }), intent: 'review-session-preparation', href: `/session-prep?preparation=${encodeURIComponent(preparation.preparationId)}&decision=${encodeURIComponent(decision.decisionId)}`, authority, requiresConfirmation: false }]),
        createdAtCampaignMinute: input.campaignMinute,
      })
    }))
  if (items.length > 10_000 || new Set(items.map(row => row.itemId)).size !== items.length) throw new Error('Session preparation attention produced too many or duplicate items.')
  return Object.freeze(items.sort(compareCampaignAttentionItems))
}
