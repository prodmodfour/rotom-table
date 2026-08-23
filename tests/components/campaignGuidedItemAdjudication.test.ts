// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CampaignGuidedItemAdjudication from '../../src/components/campaign/CampaignGuidedItemAdjudication.vue'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { retainPendingItemGuidedOperation } from '~/utils/itemGuidedOperationStorage'
import { SKILL_CHECK_API_PATHS } from '~/utils/apiRoutes'

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
const fishingRequest = {
  ...request,
  requestId: 'item-guided:v1:22222222222222222222222222222222',
  requestKind: 'fishing-adjudication',
  canonicalItemId: 'Old Rod', itemLabel: 'Old Rod', targetLabel: 'Adjacent water', targetKindLabel: 'Water',
  timingLabel: '15-minute Extended Action', prompt: 'Resolve this bounded fishing attempt.', choices: [],
  resolution: {
    kind: 'fishing',
    actorKind: 'trainer',
    actorSheetSlug: 'maya',
    skillOptions: [{ skillId: 'survival', label: 'Survival' }],
    hookOptions: [{ speciesId: 'Bulbasaur', label: 'Bulbasaur' }],
    maximumHookLevel: 10,
    allowNoHook: true,
  },
  settlementFacts: ['Record either no hook or one bounded hook outcome.'],
  reservationLabel: 'Exact equipped Old Rod reserved',
  boundaryLabel: 'No hook exists until this adjudication settles.',
} as const
const acceptedFishingCheck = {
  schemaVersion: 1,
  projection: 'gm',
  document: {
    schemaVersion: 1,
    checkId: 'skill-check:v1:fishing-accepted',
    revision: 3,
    state: 'accepted',
    mode: 'single',
    requester: { role: 'gm', principalId: 'gm:director' },
    publicLabel: 'Catch the current',
    prompt: 'Make a Survival check for this fishing declaration.',
    gmNotes: 'Private fishing check evidence.',
    visibility: 'participants-results',
    comparison: { kind: 'dc', difficultyClass: 5, concealment: 'subjects-after-acceptance' },
    situationalModifier: 0,
    subjects: [{
      subjectId: 'skill-check-subject:v1:fishing-maya', kind: 'trainer', sheetSlug: 'maya', sheetRevision: 3,
      skillId: 'survival', controllerProfileIds: [], response: 'accepted', respondedAt: 150,
    }],
    journals: [{
      journalId: 'skill-check-journal:v1:fishing-maya-attempt-1',
      subjectId: 'skill-check-subject:v1:fishing-maya', attempt: 1, diceCount: 2, dieSides: 6,
      flatModifier: 0, contributors: [], results: [4, 4], dieTotal: 8, finalTotal: 8, rolledAt: 200,
    }],
    acceptedResults: [{
      subjectId: 'skill-check-subject:v1:fishing-maya',
      journalIds: ['skill-check-journal:v1:fishing-maya-attempt-1'], finalTotal: 8, outcome: 'success', acceptedAt: 200,
    }],
    corrections: [],
    history: [
      { historyId: 'history:fishing-requested', kind: 'requested', operationId: 'skill-check-op:v1:fishing-request-0001', subjectId: null, headline: 'Requested', createdAt: 100 },
      { historyId: 'history:fishing-responded', kind: 'responded', operationId: 'skill-check-op:v1:fishing-respond-0001', subjectId: 'skill-check-subject:v1:fishing-maya', headline: 'Responded', createdAt: 150 },
      { historyId: 'history:fishing-accepted', kind: 'accepted', operationId: 'skill-check-op:v1:fishing-resolve-0001', subjectId: null, headline: 'Accepted', createdAt: 200 },
    ],
    createdAt: 100, updatedAt: 200, expiresAt: 1_000, terminalAt: 200,
    lastOperationId: 'skill-check-op:v1:fishing-resolve-0001',
  },
  subjects: [{
    subjectId: 'skill-check-subject:v1:fishing-maya', label: 'Mira',
    modifierAuthority: { status: 'available', diceCount: 2, flatModifier: 0, contributors: [] },
  }],
} as const
const acceptedFishingChecks = {
  schemaVersion: 1,
  audience: 'gm',
  checks: [acceptedFishingCheck],
  serverNow: 250,
} as const

const snagRequest = {
  ...request,
  requestId: 'item-guided:v1:33333333333333333333333333333333',
  requestKind: 'snag-conversion-adjudication',
  canonicalItemId: 'Snag Machine', itemLabel: 'Snag Machine', targetLabel: 'Reserved Poké Ball', targetKindLabel: 'Poké Ball',
  timingLabel: 'Swift Action', prompt: 'Approve or deny this bounded Snag Ball conversion.', choices: [],
  resolution: {
    kind: 'snag-conversion',
    decisions: [
      { decision: 'deny', label: 'Deny conversion', description: 'Leave the reserved Poké Ball unchanged.' },
      { decision: 'approve', label: 'Approve conversion', description: 'Create the bounded conversion authority.' },
    ],
  },
  settlementFacts: ['Apply only the chosen conversion decision.'],
  reservationLabel: 'One exact Poké Ball reserved privately',
  boundaryLabel: 'No conversion exists until this adjudication settles.',
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

  it('submits only selected accepted generic check evidence while keeping the private integration identity off the page and command', async () => {
    const postJson = vi.fn(async (_path: string, body: any) => ({
      result: {
        schemaVersion: 1, operationId: body.command.operationId, exactReplay: false,
        request: { ...fishingRequest, revision: 1, status: 'accepted', choices: [], resolution: null, canCancel: false, acceptedSummary: 'Old Rod fishing attempt resolved with no hook.' },
      },
      sheets: [],
    }))
    configureApiClientForTests({
      getJson: vi.fn(async (path: string) => path === SKILL_CHECK_API_PATHS.projections
        ? acceptedFishingChecks
        : { schemaVersion: 1, requests: [fishingRequest], reBreatherOffers: [] }),
      postJson,
    })
    const wrapper = mount(CampaignGuidedItemAdjudication)
    await flush()
    expect(wrapper.text()).toContain('Accepted Skill Check evidence')
    expect(wrapper.text()).toContain('Catch the current · Survival · Total 8 · Success')
    expect(wrapper.text()).toContain('Request and resolve this actor’s check')
    expect(wrapper.text()).not.toContain('skill-check-integration')
    expect(wrapper.text()).not.toContain('maya')
    const checkSelect = wrapper.get('.guided-fishing select')
    expect(checkSelect.attributes('aria-describedby')).toContain('guided-fishing-check-instructions')
    expect(wrapper.get('button.guided-fishing__accept').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.guided-fishing fieldset').attributes('disabled')).toBeDefined()
    await checkSelect.setValue('skill-check:v1:fishing-accepted')
    expect(wrapper.get('.guided-fishing__linked[role="status"]').text()).toContain('Accepted check linked')
    await wrapper.get('button.guided-fishing__accept').trigger('click')
    await flush()
    expect((postJson.mock.calls[0]![1] as any).command).toMatchObject({
      action: 'resolve-fishing-intent', requestId: fishingRequest.requestId,
      expectedRevision: 0, skillId: 'survival', skillCheckId: 'skill-check:v1:fishing-accepted',
      hookSpeciesId: null, hookLevel: null, gmNote: null,
    })
    expect((postJson.mock.calls[0]![1] as any).command).not.toHaveProperty('skillCheckIntegrationId')
  })

  it('requires one explicit bounded Snag Machine legality decision and keeps its note private', async () => {
    const postJson = vi.fn(async (_path: string, body: any) => ({
      result: {
        schemaVersion: 1, operationId: body.command.operationId, exactReplay: false,
        request: { ...snagRequest, revision: 1, status: 'accepted', choices: [], resolution: null, canCancel: false, acceptedSummary: 'Conversion denied.' },
      },
      sheets: [],
    }))
    configureApiClientForTests({
      getJson: vi.fn(async () => ({ schemaVersion: 1, requests: [snagRequest], reBreatherOffers: [] })),
      postJson,
    })
    const wrapper = mount(CampaignGuidedItemAdjudication)
    await flush()
    const submit = wrapper.get('button.guided-snag__accept')
    expect(submit.attributes('disabled')).toBeDefined()
    const radios = wrapper.findAll<HTMLInputElement>('.guided-snag input[type="radio"]')
    await radios[0]!.setValue(true)
    await wrapper.get('.guided-snag textarea').setValue('Private denial evidence')
    await submit.trigger('click')
    await flush()
    expect((postJson.mock.calls[0]![1] as any).command).toMatchObject({
      action: 'resolve-snag-conversion', requestId: snagRequest.requestId,
      decision: 'deny', gmNote: 'Private denial evidence',
    })
    expect(wrapper.text()).not.toContain('Private denial evidence')
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
