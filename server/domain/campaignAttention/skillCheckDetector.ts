import { createHash } from 'node:crypto'
import { stableJsonStringify } from '../../../shared/automation/stableJson'
import {
  createOpenCampaignAttentionItem,
  type CampaignAttentionItem,
} from '../../../shared/campaignAttention/model'
import { compareCampaignAttentionItems } from '../../../shared/campaignAttention/projection'
import { parseSkillCheckDocument } from '../../../shared/skillChecks/persistence'
import type { StoredSkillCheckV1 } from '../../storage/skillCheckRepository'

export const CAMPAIGN_SKILL_CHECK_ATTENTION_LIMIT = 10_000

const hash = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const identity = (prefix: string, value: unknown): string => `${prefix}${hash(value)}`

const common = (input: {
  readonly stored: StoredSkillCheckV1
  readonly campaignMinute: number
}) => {
  const document = parseSkillCheckDocument(input.stored.document)
  const authority = Object.freeze({
    kind: 'resource' as const,
    id: document.checkId,
    revision: document.revision,
  })
  return Object.freeze({
    document,
    authority,
    sourceEvent: Object.freeze({
      kind: 'skill-check' as const,
      eventId: identity('campaign-attention-source:v1:', {
        kind: 'skill-check',
        checkId: document.checkId,
        createdAt: document.createdAt,
      }),
      campaignMinute: input.campaignMinute,
    }),
  })
}

const actionFor = (input: {
  readonly itemId: string
  readonly authority: { readonly kind: 'resource', readonly id: string, readonly revision: number }
}) => Object.freeze({
  actionId: identity('campaign-attention-action:v1:', { itemId: input.itemId, intent: 'continue-campaign' }),
  intent: 'continue-campaign' as const,
  href: '/play',
  authority: input.authority,
  requiresConfirmation: false,
})

const gmItem = (stored: StoredSkillCheckV1, campaignMinute: number): CampaignAttentionItem => {
  const needsGmReview = stored.document.state === 'ready'
    || stored.document.subjects.some(subject => subject.response === 'declined')
  const reason = needsGmReview ? 'skill-check-resolution' as const : 'skill-check-response' as const
  const values = common({ stored, campaignMinute })
  const itemId = identity('campaign-attention:v1:', {
    kind: 'skill-check-gm',
    checkId: values.document.checkId,
    reason,
  })
  return createOpenCampaignAttentionItem({
    itemId,
    reason,
    audience: 'gm',
    urgency: needsGmReview ? 'urgent' : 'informational',
    entity: Object.freeze({ kind: 'campaign' as const, id: 'campaign' }),
    sourceEvent: values.sourceEvent,
    authority: values.authority,
    requiredDecision: Object.freeze({
      decisionId: identity('campaign-attention-decision:v1:', { itemId, kind: 'review-continuation' }),
      kind: 'review-continuation' as const,
      authority: values.authority,
    }),
    legalActions: Object.freeze([actionFor({ itemId, authority: values.authority })]),
    createdAtCampaignMinute: campaignMinute,
  })
}

const ownerItems = (stored: StoredSkillCheckV1, campaignMinute: number): readonly CampaignAttentionItem[] => {
  const values = common({ stored, campaignMinute })
  const rows: CampaignAttentionItem[] = []
  for (const subject of values.document.subjects.filter(candidate => candidate.response === 'pending')) {
    for (const profileId of [...new Set(subject.controllerProfileIds)].sort()) {
      const itemId = identity('campaign-attention:v1:', {
        kind: 'skill-check-owner',
        checkId: values.document.checkId,
        subjectId: subject.subjectId,
        profileId,
      })
      rows.push(createOpenCampaignAttentionItem({
        itemId,
        reason: 'skill-check-response',
        audience: 'owner',
        urgency: 'normal',
        entity: Object.freeze({ kind: 'profile' as const, id: profileId }),
        sourceEvent: values.sourceEvent,
        authority: values.authority,
        requiredDecision: Object.freeze({
          decisionId: identity('campaign-attention-decision:v1:', { itemId, kind: 'review-continuation' }),
          kind: 'review-continuation' as const,
          authority: values.authority,
        }),
        legalActions: Object.freeze([actionFor({ itemId, authority: values.authority })]),
        createdAtCampaignMinute: campaignMinute,
      }))
    }
  }
  return Object.freeze(rows)
}

export const projectCampaignSkillCheckAttention = (input: {
  readonly skillChecks: readonly StoredSkillCheckV1[]
  readonly campaignMinute: number
  readonly completeness: { readonly skillChecks: true }
}): readonly CampaignAttentionItem[] => {
  if (input.completeness.skillChecks !== true) {
    throw new Error('Skill Check attention requires one complete current Skill Check authority read.')
  }
  if (!Number.isSafeInteger(input.campaignMinute) || input.campaignMinute < 0) {
    throw new Error('Skill Check attention requires current non-negative campaign time.')
  }
  if (!Array.isArray(input.skillChecks) || input.skillChecks.length > CAMPAIGN_SKILL_CHECK_ATTENTION_LIMIT) {
    throw new Error(`Skill Check attention is bounded to ${CAMPAIGN_SKILL_CHECK_ATTENTION_LIMIT} checks.`)
  }
  const checkIds = input.skillChecks.map(stored => parseSkillCheckDocument(stored.document).checkId)
  if (new Set(checkIds).size !== checkIds.length) {
    throw new Error('Skill Check attention requires unique current check identities.')
  }
  const unresolved = input.skillChecks.filter(stored => stored.state === 'pending' || stored.state === 'ready')
  const items = unresolved.flatMap(stored => [
    gmItem(stored, input.campaignMinute),
    ...ownerItems(stored, input.campaignMinute),
  ])
  if (items.length > CAMPAIGN_SKILL_CHECK_ATTENTION_LIMIT) {
    throw new Error(`Skill Check attention is bounded to ${CAMPAIGN_SKILL_CHECK_ATTENTION_LIMIT} items.`)
  }
  if (new Set(items.map(item => item.itemId)).size !== items.length) {
    throw new Error('Skill Check attention produced duplicate item identities.')
  }
  return Object.freeze(items.sort(compareCampaignAttentionItems))
}
