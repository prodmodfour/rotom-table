// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CampaignGuidedItemAdjudication from '../../src/components/campaign/CampaignGuidedItemAdjudication.vue'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { retainPendingItemGuidedOperation } from '~/utils/itemGuidedOperationStorage'

vi.mock('~/utils/clientId', () => ({ getClientId: () => 'guided-component' }))
vi.mock('~/composables/useRealtime', () => ({ subscribeChannel: () => () => undefined }))

const requestId = 'item-guided:v1:11111111111111111111111111111111'
const request = {
  schemaVersion: 1, requestId, revision: 0, status: 'pending', requestKind: 'loyalty-consequence',
  canonicalItemId: 'Energy Powder', itemLabel: 'Energy Powder', actorLabel: 'Mira', targetLabel: 'Sparky',
  targetKindLabel: 'Pokémon', timingLabel: 'Standard Action', prompt: 'How does this Repulsive Medicine use affect Loyalty?',
  canonicalFacts: ['Restores 25 HP when accepted.', 'Persistent Repulsive Medicine use may lower Loyalty at GM discretion.'],
  choices: [
    { optionId: 'record-no-loyalty-change', label: 'Record use; no Loyalty Rank change', description: 'Apply deterministic mechanics with no rank change.' },
    { optionId: 'lower-loyalty-by-one', label: 'Lower Loyalty by 1', description: 'Lower current Loyalty by exactly 1.' },
  ],
  settlementFacts: ['Restore 25 HP.', 'Consume 1 reserved Energy Powder.', 'Record the GM decision privately.'],
  reservationLabel: '1 Energy Powder reserved',
  boundaryLabel: 'No HP, Loyalty, or inventory change until accepted.', canCancel: true, acceptedSummary: null,
} as const
const campaignToolRequest = {
  ...request,
  requestKind: 'campaign-tool-adjudication',
  canonicalItemId: 'Smoke Ball',
  itemLabel: 'Smoke Ball',
  targetLabel: 'Mira',
  targetKindLabel: 'Trainer',
  prompt: 'Confirm one legal current use of this exact interpretive combat item.',
  canonicalFacts: [
    'Targeting, placement, checks, and battlefield consequences require bounded GM adjudication.',
    'No target, hazard, condition, Move, or modifier is inferred from the item name or prose.',
  ],
  choices: [{
    optionId: 'accept-reviewed-use',
    label: 'Accept reviewed use',
    description: 'Settle the exact reviewed source disposition and record this bounded GM decision.',
  }],
  settlementFacts: [
    'Record one bounded GM-approved use and its Standard Action boundary.',
    'Consume one exact reserved source unit.',
    'Apply no unselected target or battlefield mutation.',
  ],
  reservationLabel: '1 Smoke Ball reserved',
  boundaryLabel: 'No reviewed outcome, action cost, or source disposition settles until the GM accepts.',
} as const
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

afterEach(() => {
  resetApiClientForTests()
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('CampaignGuidedItemAdjudication', () => {
  it('renders the accepted 40/60 decision hierarchy and submits exactly one server-issued radio outcome', async () => {
    const postJson = vi.fn(async (_path: string, body: any) => ({
      result: {
        schemaVersion: 1, operationId: body.command.operationId, exactReplay: false,
        request: { ...request, revision: 1, status: 'accepted', choices: [], canCancel: false, acceptedSummary: 'Energy Powder accepted.' },
      },
      sheets: [],
    }))
    configureApiClientForTests({
      getJson: vi.fn(async () => ({ schemaVersion: 1, requests: [request], reBreatherOffers: [] })),
      postJson,
    })
    const wrapper = mount(CampaignGuidedItemAdjudication)
    await flush()
    expect(wrapper.text()).toContain('Guided item adjudication')
    expect(wrapper.text()).toContain('Mira → Sparky')
    expect(wrapper.text()).toContain('Canonical rule context')
    expect(wrapper.text()).toContain('Settlement on acceptance')
    expect(wrapper.text()).toContain('No HP, Loyalty, or inventory change until accepted.')
    expect(wrapper.text()).not.toContain(requestId)
    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]')
    expect(radios).toHaveLength(2)
    await radios[1]!.setValue(true)
    const accept = wrapper.findAll('button').find(button => button.text().includes('Accept lower loyalty by 1 outcome'))!
    await accept.trigger('click')
    await flush()
    expect(postJson).toHaveBeenCalledOnce()
    expect((postJson.mock.calls[0]![1] as any).command).toMatchObject({
      action: 'resolve', requestId, expectedRevision: 0, optionId: 'lower-loyalty-by-one',
    })
  })

  it('renders one bounded campaign-tool outcome without exposing private exact-source authority', async () => {
    const postJson = vi.fn(async (_path: string, body: any) => ({
      result: {
        schemaVersion: 1, operationId: body.command.operationId, exactReplay: false,
        request: {
          ...campaignToolRequest, revision: 1, status: 'accepted', choices: [], canCancel: false,
          acceptedSummary: 'Smoke Ball accepted. Reviewed use and exact source disposition recorded.',
        },
      },
      sheets: [],
    }))
    configureApiClientForTests({
      getJson: vi.fn(async () => ({ schemaVersion: 1, requests: [campaignToolRequest], reBreatherOffers: [] })),
      postJson,
    })
    const wrapper = mount(CampaignGuidedItemAdjudication)
    await flush()
    expect(wrapper.text()).toContain('Smoke Ball')
    expect(wrapper.text()).toContain('No target, hazard, condition, Move, or modifier is inferred')
    expect(wrapper.text()).toContain('Consume one exact reserved source unit.')
    expect(wrapper.text()).not.toContain(requestId)
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(1)
    const accept = wrapper.findAll('button').find(button => button.text() === 'Accept reviewed use')!
    await accept.trigger('click')
    await flush()
    expect(postJson).toHaveBeenCalledOnce()
    expect((postJson.mock.calls[0]![1] as any).command).toMatchObject({
      action: 'resolve', requestId, expectedRevision: 0, optionId: 'accept-reviewed-use',
    })
  })

  it('makes uncertain exact retry the only dominant mutation and disables refresh competition', async () => {
    retainPendingItemGuidedOperation({
      schemaVersion: 1,
      scope: 'gm',
      profileId: null,
      command: {
        schemaVersion: 1,
        operationId: 'item-guided-operation:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        action: 'resolve', requestId, expectedRevision: 0, optionId: 'record-no-loyalty-change',
      },
    })
    configureApiClientForTests({ getJson: vi.fn(async () => ({ schemaVersion: 1, requests: [], reBreatherOffers: [] })), postJson: vi.fn() })
    const wrapper = mount(CampaignGuidedItemAdjudication)
    await flush()
    expect(wrapper.text()).toContain('Result uncertain')
    expect(wrapper.text()).toContain('Retry exact command')
    expect(wrapper.find('button.guided-workshop__refresh').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('Cancel request')
  })
})
