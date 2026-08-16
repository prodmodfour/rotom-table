import { describe, expect, it } from 'vitest'
import {
  initialItemReBreatherState,
  materializeItemReBreatherState,
  parseItemGuidedAdjudicationCommand,
  parseItemGuidedAdjudicationProjection,
  parseItemReBreatherState,
} from '#shared/itemAutomation/guidedAdjudication'

const op = 'item-guided-operation:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const request = 'item-guided:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

describe('guided item shared contracts', () => {
  it('accepts only exact bounded declaration, resolution, and cancellation commands', () => {
    expect(parseItemGuidedAdjudicationCommand({
      schemaVersion: 1, operationId: op, action: 'declare-re-breather',
      ownerKind: 'trainer', ownerSlug: 'mira', ownerRevision: 4, offerId: 'offer-safe',
    })).toMatchObject({ action: 'declare-re-breather', ownerKind: 'trainer', ownerSlug: 'mira' })
    expect(parseItemGuidedAdjudicationCommand({
      schemaVersion: 1, operationId: op, action: 'resolve', requestId: request,
      expectedRevision: 0, optionId: 'record-no-loyalty-change',
    })).toMatchObject({ action: 'resolve', optionId: 'record-no-loyalty-change' })
    expect(parseItemGuidedAdjudicationCommand({
      schemaVersion: 1, operationId: op, action: 'cancel', requestId: request, expectedRevision: 0,
    })).toMatchObject({ action: 'cancel' })
    expect(() => parseItemGuidedAdjudicationCommand({
      schemaVersion: 1, operationId: op, action: 'resolve', requestId: request,
      expectedRevision: 0, optionId: 'record-no-loyalty-change', loyaltyDelta: -6,
    })).toThrow('invalid shape')
  })

  it('materializes exact 60-minute activation and 5-minute refill boundaries without client timers', () => {
    const active = parseItemReBreatherState({
      ...initialItemReBreatherState(), mode: 'active',
      activeFromCampaignMinute: 20, activeUntilCampaignMinute: 80,
      lastTransition: { requestId: request, transition: 'activated', campaignMinute: 20 },
    })
    expect(materializeItemReBreatherState({ state: active, campaignMinute: 79 }).mode).toBe('active')
    expect(materializeItemReBreatherState({ state: active, campaignMinute: 80 })).toMatchObject({
      mode: 'depleted', lastTransition: { transition: 'depleted', campaignMinute: 80 },
    })
    const refilling = parseItemReBreatherState({
      ...initialItemReBreatherState(), mode: 'refilling',
      refillStartedAtCampaignMinute: 80, refillCompletesAtCampaignMinute: 85,
      lastTransition: { requestId: request, transition: 'refill-started', campaignMinute: 80 },
    })
    expect(materializeItemReBreatherState({ state: refilling, campaignMinute: 84 }).mode).toBe('refilling')
    expect(materializeItemReBreatherState({ state: refilling, campaignMinute: 85 })).toMatchObject({
      mode: 'ready', lastTransition: { transition: 'refilled', campaignMinute: 85 },
    })
  })

  it('parses privacy-safe projections and rejects private evidence fields', () => {
    const projection = {
      schemaVersion: 1,
      requests: [{
        schemaVersion: 1, requestId: request, revision: 0, status: 'pending',
        requestKind: 'loyalty-consequence', canonicalItemId: 'Energy Powder', itemLabel: 'Energy Powder',
        actorLabel: 'Mira', targetLabel: 'Sparky', targetKindLabel: 'Pokémon', timingLabel: 'Standard Action',
        prompt: 'Choose one outcome.', canonicalFacts: ['Restores 25 HP when accepted.'],
        choices: [], settlementFacts: ['Consume one reserved item.'], reservationLabel: 'Item reserved',
        boundaryLabel: 'No mechanics apply until accepted.', canCancel: true, acceptedSummary: null,
      }],
      reBreatherOffers: [],
    }
    expect(parseItemGuidedAdjudicationProjection(projection).requests).toHaveLength(1)
    expect(() => parseItemGuidedAdjudicationProjection({
      ...projection,
      requests: [{ ...projection.requests[0], sourceInventoryRowId: 'private-row' }],
    })).toThrow('invalid shape')
  })
})
