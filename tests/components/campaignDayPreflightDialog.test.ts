// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'
import CampaignDayPreflightDialog from '../../src/components/campaign/CampaignDayPreflightDialog.vue'

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', '') }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open') }
  }
})

const impact = {
  totalSheets: 3, affectedSheetCount: 2,
  affectedSheets: [
    { kind: 'pokemon', label: 'Sparky', href: '/sheets/pokemon/sparky', changes: ['hit-points', 'injury', 'daily-moves'] },
    { kind: 'trainer', label: 'Mira', href: '/sheets/trainers/mira', changes: ['injury', 'conditions', 'trainer-ap'] },
  ],
  additionalAffectedSheets: 0, pokemonAffected: 1, trainerAffected: 1,
  hitPointsRestored: 24, injuriesHealed: 2, conditionsCleared: 3,
  dailyMoveUsesCleared: 1, dailyMoveEntriesCleared: 1, trainerApRestored: 4,
  reconciledEggs: 1, creditedEggCampaignMinutes: 1440,
  skippedPausedEggCampaignMinutes: 0, expiredEffects: 1,
} as const
const ready = {
  schemaVersion: 1,
  state: 'ready',
  preflightId: `campaign-day-preflight:v1:${'a'.repeat(64)}`,
  clock: { currentCampaignMinute: 12480, targetCampaignMinute: 13920, minutesAdvanced: 1440 },
  blockers: [], impact, accepted: null,
} as const
const props = {
  open: true, phase: 'ready', projection: ready, postflight: null,
  confirmed: false, error: null, uncertain: false, online: true, canCommit: false,
  remainingAttention: null,
} as const
const global = {
  stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
}

describe('CampaignDayPreflightDialog', () => {
  it('renders the exact preview hierarchy without exposing preflight or row identities', async () => {
    const wrapper = mount(CampaignDayPreflightDialog, { props, global })
    expect(wrapper.text()).toContain('Campaign day preflight')
    expect(wrapper.text()).toContain('Review next day')
    expect(wrapper.text()).toContain('Campaign minute 12,480')
    expect(wrapper.text()).toContain('13,920')
    expect(wrapper.text()).toContain('Ready to advance')
    expect(wrapper.text()).toContain('24HP restored')
    expect(wrapper.text()).toContain('Sparky')
    expect(wrapper.text()).toContain('HP · Injury · Daily Moves')
    expect(wrapper.text()).toContain('I reviewed these campaign-wide changes.')
    expect(wrapper.text()).not.toContain(ready.preflightId)
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('update:confirmed')).toEqual([[true]])
    expect(wrapper.get<HTMLButtonElement>('.day-preflight__commit').element.disabled).toBe(true)
  })

  it('renders authoritative blockers as links and cannot show a confirmation boundary', () => {
    const blocked = {
      ...ready,
      state: 'blocked',
      blockers: [{
        kind: 'active-encounter', reason: null, label: 'Active encounter must be resolved',
        count: 1, href: '/play/harbor',
      }],
    } as const
    const wrapper = mount(CampaignDayPreflightDialog, {
      props: { ...props, phase: 'blocked', projection: blocked }, global,
    })
    expect(wrapper.text()).toContain('Resolve blockers first')
    expect(wrapper.text()).toContain('Active encounter must be resolved')
    expect(wrapper.get('a').attributes('href')).toBe('/play/harbor')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.get<HTMLButtonElement>('.day-preflight__commit').element.disabled).toBe(true)
  })

  it('shows accepted postflight impact and freshly projected remaining attention', () => {
    const accepted = {
      ...ready, state: 'already-accepted', preflightId: null,
      impact: { ...impact, affectedSheets: [], additionalAffectedSheets: 2 },
      accepted: {
        replayed: true,
        impact: { ...impact, affectedSheets: [], additionalAffectedSheets: 2 },
      },
    } as const
    const wrapper = mount(CampaignDayPreflightDialog, {
      props: {
        ...props,
        phase: 'accepted', projection: accepted,
        postflight: { clock: accepted.clock, accepted: accepted.accepted },
        remainingAttention: { total: 2, blocking: 0, urgent: 1, normal: 1, informational: 0 },
      },
      global,
    })
    expect(wrapper.text()).toContain('Next day complete')
    expect(wrapper.text()).toContain('Recovered the exact accepted result.')
    expect(wrapper.text()).toContain('2 open · 0 blocking · 1 urgent')
    expect(wrapper.find('.day-preflight__commit').exists()).toBe(false)
  })

  it('keeps uncertain command recovery explicit and prevents Escape during commit', async () => {
    const wrapper = mount(CampaignDayPreflightDialog, {
      props: {
        ...props, phase: 'error', error: 'The response was lost.', uncertain: true,
      },
      global,
    })
    expect(wrapper.get('[role="alert"]').text()).toContain('Acceptance status is uncertain.')
    expect(wrapper.text()).toContain('Check accepted status')
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.setProps({ phase: 'committing' })
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
