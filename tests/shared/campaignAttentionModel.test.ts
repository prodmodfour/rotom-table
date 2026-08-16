import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_ATTENTION_ITEM_SCHEMA_VERSION,
  CampaignAttentionValidationError,
  createOpenCampaignAttentionItem,
  parseCampaignAttentionItem,
  resolveCampaignAttentionItem,
  type CampaignAttentionItem,
} from '../../shared/campaignAttention/model'

const openItem = (): CampaignAttentionItem => createOpenCampaignAttentionItem({
  itemId: `campaign-attention:v1:${'a'.repeat(64)}`,
  reason: 'medical-review',
  audience: 'owner',
  urgency: 'urgent',
  entity: { kind: 'pokemon-sheet', id: 'sprig' },
  sourceEvent: {
    kind: 'encounter-settlement',
    eventId: `settlement-fact:v1:${'b'.repeat(64)}`,
    campaignMinute: 500,
  },
  authority: { kind: 'sheet', id: 'sprig', revision: 9 },
  requiredDecision: {
    decisionId: `campaign-attention-decision:v1:${'c'.repeat(64)}`,
    kind: 'choose-treatment',
    authority: { kind: 'sheet', id: 'sprig', revision: 9 },
  },
  legalActions: [{
    actionId: `campaign-attention-action:v1:${'d'.repeat(64)}`,
    intent: 'start-treatment',
    href: '/sheets/pokemon/sprig',
    authority: { kind: 'sheet', id: 'sprig', revision: 9 },
    requiresConfirmation: false,
  }],
  createdAtCampaignMinute: 500,
})

describe('campaign attention item model', () => {
  it('represents only stable reason, audience, urgency, entity, event, authority, decision, actions, and resolution pointers', () => {
    const item = openItem()
    expect(item).toEqual({
      schemaVersion: CAMPAIGN_ATTENTION_ITEM_SCHEMA_VERSION,
      itemId: `campaign-attention:v1:${'a'.repeat(64)}`,
      reason: 'medical-review',
      audience: 'owner',
      urgency: 'urgent',
      entity: { kind: 'pokemon-sheet', id: 'sprig' },
      sourceEvent: {
        kind: 'encounter-settlement',
        eventId: `settlement-fact:v1:${'b'.repeat(64)}`,
        campaignMinute: 500,
      },
      authority: { kind: 'sheet', id: 'sprig', revision: 9 },
      requiredDecision: {
        decisionId: `campaign-attention-decision:v1:${'c'.repeat(64)}`,
        kind: 'choose-treatment',
        authority: { kind: 'sheet', id: 'sprig', revision: 9 },
      },
      legalActions: [{
        actionId: `campaign-attention-action:v1:${'d'.repeat(64)}`,
        intent: 'start-treatment',
        href: '/sheets/pokemon/sprig',
        authority: { kind: 'sheet', id: 'sprig', revision: 9 },
        requiresConfirmation: false,
      }],
      resolution: {
        state: 'open', revision: 0, code: null,
        resolutionEventId: null, resolvedAtCampaignMinute: null,
      },
      createdAtCampaignMinute: 500,
    })
    expect(Object.isFrozen(item)).toBe(true)
    expect(Object.isFrozen(item.authority)).toBe(true)
    expect(Object.isFrozen(item.requiredDecision)).toBe(true)
    expect(Object.isFrozen(item.legalActions)).toBe(true)
    expect(Object.isFrozen(item.legalActions[0])).toBe(true)
  })

  it('resolves once with versioned source-event evidence and rejects terminal replay as a new transition', () => {
    const resolved = resolveCampaignAttentionItem({
      current: openItem(),
      code: 'completed',
      resolutionEventId: `treatment-operation:v1:${'e'.repeat(64)}`,
      resolvedAtCampaignMinute: 520,
    })
    expect(resolved.resolution).toEqual({
      state: 'resolved', revision: 1, code: 'completed',
      resolutionEventId: `treatment-operation:v1:${'e'.repeat(64)}`,
      resolvedAtCampaignMinute: 520,
    })
    expect(resolved.requiredDecision).toBeNull()
    expect(resolved.legalActions).toEqual([])
    expect(() => resolveCampaignAttentionItem({
      current: resolved,
      code: 'completed',
      resolutionEventId: `treatment-operation:v1:${'e'.repeat(64)}`,
      resolvedAtCampaignMinute: 520,
    })).toThrow('only an open attention item may resolve')
  })

  it('allows a source to state that no irreversible decision is required', () => {
    const input = JSON.parse(JSON.stringify(openItem())) as Record<string, unknown>
    input.requiredDecision = null
    expect(parseCampaignAttentionItem(input).requiredDecision).toBeNull()
  })

  it('fails closed on copied mutable sheet data, malformed routes, duplicate actions, and incomplete resolution evidence', () => {
    const copied = { ...JSON.parse(JSON.stringify(openItem())), mutableSnapshot: { currentHp: 3 } }
    expect(() => parseCampaignAttentionItem(copied)).toThrow(CampaignAttentionValidationError)
    expect(() => parseCampaignAttentionItem(copied)).toThrow('must contain exactly')

    const freeform = JSON.parse(JSON.stringify(openItem()))
    freeform.legalActions[0].label = 'Sprig has 3 Hit Points'
    expect(() => parseCampaignAttentionItem(freeform)).toThrow('must contain exactly')

    const external = JSON.parse(JSON.stringify(openItem()))
    external.legalActions[0].href = 'https://example.test/sprig'
    expect(() => parseCampaignAttentionItem(external)).toThrow('must be one app-relative route')

    const duplicate = JSON.parse(JSON.stringify(openItem()))
    duplicate.legalActions.push(duplicate.legalActions[0])
    expect(() => parseCampaignAttentionItem(duplicate)).toThrow('unique action identities')

    const partial = JSON.parse(JSON.stringify(openItem()))
    partial.resolution = {
      state: 'resolved', revision: 1, code: 'completed',
      resolutionEventId: null, resolvedAtCampaignMinute: 520,
    }
    expect(() => parseCampaignAttentionItem(partial)).toThrow('complete resolution evidence')
  })

  it('rejects future source events, retroactive resolution, and invalid supersession codes', () => {
    const future = JSON.parse(JSON.stringify(openItem()))
    future.sourceEvent.campaignMinute = 501
    expect(() => parseCampaignAttentionItem(future)).toThrow('cannot precede the immutable source event')

    const retroactive = JSON.parse(JSON.stringify(openItem()))
    retroactive.requiredDecision = null
    retroactive.legalActions = []
    retroactive.resolution = {
      state: 'resolved', revision: 1, code: 'completed',
      resolutionEventId: `operation:v1:${'f'.repeat(64)}`,
      resolvedAtCampaignMinute: 499,
    }
    expect(() => parseCampaignAttentionItem(retroactive)).toThrow('cannot precede item creation')

    const superseded = JSON.parse(JSON.stringify(openItem()))
    superseded.requiredDecision = null
    superseded.legalActions = []
    superseded.resolution = {
      state: 'superseded', revision: 1, code: 'completed',
      resolutionEventId: `operation:v1:${'f'.repeat(64)}`,
      resolvedAtCampaignMinute: 501,
    }
    expect(() => parseCampaignAttentionItem(superseded)).toThrow('requires superseded-by-authority')
  })
})
