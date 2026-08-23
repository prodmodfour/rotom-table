// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { CampaignAttentionItem } from '../../shared/campaignAttention/model'
import type { CampaignContinuationProjectionV1 } from '../../shared/campaignContinuation'
import CampaignContinuationDashboard from '../../src/components/campaign/CampaignContinuationDashboard.vue'

const item = (overrides: Partial<CampaignAttentionItem> = {}): CampaignAttentionItem => ({
  schemaVersion: 1,
  itemId: 'campaign-attention:v1:private-stable-identity',
  reason: 'team-overflow',
  audience: 'owner',
  urgency: 'blocking',
  entity: { kind: 'trainer-sheet', id: 'mira' },
  sourceEvent: { kind: 'sheet-authority', eventId: 'private-event', campaignMinute: 90 },
  authority: { kind: 'sheet', id: 'private-authority', revision: 4 },
  requiredDecision: {
    decisionId: 'private-decision', kind: 'repair-team',
    authority: { kind: 'sheet', id: 'private-authority', revision: 4 },
  },
  legalActions: [{
    actionId: 'private-action', intent: 'review-team', href: '/sheets/trainers/mira',
    authority: { kind: 'sheet', id: 'private-authority', revision: 4 }, requiresConfirmation: false,
  }],
  resolution: { state: 'open', revision: 0, code: null, resolutionEventId: null, resolvedAtCampaignMinute: null },
  createdAtCampaignMinute: 90,
  ...overrides,
})

const projection: CampaignContinuationProjectionV1 = {
  schemaVersion: 1,
  snapshotId: `campaign-continuation-snapshot:v1:${'a'.repeat(64)}`,
  attention: {
    schemaVersion: 1,
    snapshotId: `campaign-attention-snapshot:v1:${'b'.repeat(64)}`,
    scope: 'owner', campaignMinute: 100,
    items: [item()],
    summary: { total: 1, blocking: 1, urgent: 0, normal: 0, informational: 0 },
  },
  activeEncounter: { label: 'Harbor duel', state: 'active', round: 3, participantCount: 4, href: '/play/harbor-duel' },
  additionalActiveEncounters: 0,
  unfinishedSettlement: { label: 'Harbor duel', state: 'needs-review', openWorkCount: null, href: '/play/harbor-duel' },
  additionalUnfinishedSettlements: 0,
  eggs: { active: 1, incubating: 1, ready: 0, needsAdjudication: 0, hatching: 0, href: '/breeding' },
}

const mountDashboard = () => mount(CampaignContinuationDashboard, {
  props: { projection, status: 'ready', error: null, hasSelectedProfile: true },
  global: {
    stubs: {
      NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
    },
  },
})

describe('CampaignContinuationDashboard', () => {
  it('prioritizes authoritative resumptions and the highest-priority next action before grouped work', () => {
    const wrapper = mountDashboard()
    expect(wrapper.text()).toContain('What needs attention')
    expect(wrapper.text()).toContain('Harbor duel')
    expect(wrapper.text()).toContain('Return to encounter')
    expect(wrapper.text()).toContain('Review settlement')
    expect(wrapper.text()).toContain('Recommended next action')
    expect(wrapper.text()).toContain('Team over capacity')
    expect(wrapper.text()).toContain('Review team')
    expect(wrapper.text()).toContain('Team, captures & eggs')
    expect(wrapper.text()).toContain('1 active Egg')
    expect(wrapper.text()).toContain('Equipment')
    expect(wrapper.text()).toContain('Nothing needs equipment attention.')
  })

  it('does not render operation, authority, source-event, action, Profile, or stable attention identities', () => {
    const profileHash = `campaign-profile-authority:v1:${'f'.repeat(64)}`
    const profileItem = item({
      reason: 'ownership-review',
      entity: { kind: 'profile', id: profileHash },
      legalActions: [{
        actionId: 'private-action', intent: 'review-ownership', href: '/campaign?attention=profiles',
        authority: { kind: 'profile', id: profileHash, revision: 0 }, requiresConfirmation: false,
      }],
    })
    const privateProjection = {
      ...projection,
      attention: {
        ...projection.attention,
        items: [profileItem],
        summary: { total: 1, blocking: 1, urgent: 0, normal: 0, informational: 0 },
      },
    }
    const wrapper = mount(CampaignContinuationDashboard, {
      props: { projection: privateProjection, status: 'ready', error: null, hasSelectedProfile: true },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    })
    const text = wrapper.text()
    expect(text).toContain('Player Profile')
    for (const privateValue of [
      'private-stable-identity', 'private-event', 'private-authority', 'private-decision',
      'private-action', profileHash,
    ]) expect(text).not.toContain(privateValue)
  })

  it('routes unresolved Skill Checks back to Live Encounter with explicit response copy', () => {
    const skillProjection = {
      ...projection,
      attention: {
        ...projection.attention,
        items: [item({
          reason: 'skill-check-response',
          urgency: 'normal',
          entity: { kind: 'campaign', id: 'campaign' },
          legalActions: [{
            actionId: 'private-skill-action', intent: 'continue-campaign', href: '/play',
            authority: { kind: 'resource', id: 'private-check', revision: 1 }, requiresConfirmation: false,
          }],
        })],
        summary: { total: 1, blocking: 0, urgent: 0, normal: 1, informational: 0 },
      },
    }
    const wrapper = mount(CampaignContinuationDashboard, {
      props: { projection: skillProjection, status: 'ready', error: null, hasSelectedProfile: true },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    })
    expect(wrapper.text()).toContain('Skill Check response')
    expect(wrapper.text()).toContain('A requested Skill Check still needs a subject response.')
    expect(wrapper.text()).toContain('Open Live Encounter')
    expect(wrapper.get('a[href="/play"]').text()).toContain('Open Live Encounter')
    expect(wrapper.text()).not.toContain('private-check')
  })

  it('uses a semantic alert and emits retry without replacing a retained complete snapshot', async () => {
    const wrapper = mount(CampaignContinuationDashboard, {
      props: {
        projection, status: 'error', error: 'Fresh authority is temporarily unavailable.', hasSelectedProfile: true,
      },
      global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
    })
    expect(wrapper.get('[role="alert"]').text()).toContain('Fresh authority is temporarily unavailable.')
    expect(wrapper.text()).toContain('Harbor duel')
    await wrapper.get('[role="alert"] button').trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('announces empty owner scope when no Profile is selected', () => {
    const empty = {
      ...projection,
      attention: {
        ...projection.attention,
        items: [],
        summary: { total: 0, blocking: 0, urgent: 0, normal: 0, informational: 0 },
      },
    }
    const wrapper = mount(CampaignContinuationDashboard, {
      props: { projection: empty, status: 'ready', error: null, hasSelectedProfile: false },
      global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
    })
    expect(wrapper.text()).toContain('Campaign ready')
    expect(wrapper.text()).toContain('Choose a Player Profile')
  })
})
