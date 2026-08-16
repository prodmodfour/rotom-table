/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TrainerExplorationActivityCard from '~/components/sheets/TrainerExplorationActivityCard.vue'
import type { TrainerItemExplorationAuthority } from '~/composables/sheets/useTrainerItemExploration'

const authority = (gm = false, waiting = false): TrainerItemExplorationAuthority => ({
  schemaVersion: 1,
  kind: 'trainer',
  trainerSlug: 'explorer',
  trainerRevision: 3,
  campaignClockRevision: 2,
  campaignMinute: 115,
  generatedAt: 500,
  projection: {
    schemaVersion: 1,
    routeLures: [{
      activityId: 'item-route-lure:v1:22222222222222222222222222222222',
      itemLabel: 'Fishing Lure',
      status: waiting ? 'awaiting-encounter' : 'active',
      attemptsResolved: waiting ? 1 : 0,
      maximumAttempts: 3,
      nextCheckAtCampaignMinute: waiting ? null : 115,
      outcome: null,
      canResolveCheck: !waiting,
      needsGmEncounter: waiting,
      reusable: true,
    }],
    repels: [{ itemLabel: 'Repel', maximumAffectedWildLevel: 15, expiresAtCampaignMinute: 160, active: true }],
    dowsing: {
      campaignDayIndex: 0, uses: 1, maximumUses: 2,
      latest: { resolvedAtCampaignMinute: 100, successes: 2, shardAwards: ['Red', 'Blue'] },
    },
  },
  permissions: {
    canResolveChecks: true,
    canCancelOwnLure: true,
    canSettleEncounter: gm,
    canAdjudicateLureLoss: gm,
  },
})

describe('TrainerExplorationActivityCard', () => {
  it('presents the due route check as the primary action with secondary Repel and Dowsing summaries', async () => {
    const current = authority()
    const wrapper = mount(TrainerExplorationActivityCard, {
      props: { authority: current, projection: current.projection, status: 'idle', message: null, busy: false },
    })
    expect(wrapper.get('h2').text()).toBe('Route check due')
    expect(wrapper.text()).toContain('Attempt 1 of 3')
    expect(wrapper.text()).toContain('No encounter is selected until the GM accepts')
    expect(wrapper.text()).toContain('Repel · through minute 160 · Level 15 or lower')
    expect(wrapper.text()).toContain('1 of 2 searches · 2 Shards found')
    expect(wrapper.text()).toContain('Red')
    expect(wrapper.text()).toContain('Blue')
    await wrapper.get('.exploration-card__primary-action').trigger('click')
    expect(wrapper.emitted('resolveCheck')).toHaveLength(1)
  })

  it('keeps GM encounter acceptance and fictional Fishing Lure loss explicit and bounded', async () => {
    const current = authority(true, true)
    const wrapper = mount(TrainerExplorationActivityCard, {
      props: { authority: current, projection: current.projection, status: 'idle', message: null, busy: false },
    })
    expect(wrapper.get('h2').text()).toBe('GM encounter decision')
    const encounterButton = wrapper.findAll('button').find(button => button.text().includes('Accept encounter'))!
    expect(encounterButton.attributes('disabled')).toBeDefined()
    await wrapper.get('#exploration-encounter-reference').setValue('route-12-encounter')
    expect(encounterButton.attributes('disabled')).toBeUndefined()
    await encounterButton.trigger('click')
    expect(wrapper.emitted('settleEncounter')).toEqual([['route-12-encounter']])

    const lossButton = wrapper.findAll('button').find(button => button.text().includes('Adjudicate lure lost'))!
    expect(lossButton.attributes('disabled')).toBeDefined()
    await wrapper.get('.exploration-card__loss input').setValue(true)
    expect(lossButton.attributes('disabled')).toBeUndefined()
    await lossButton.trigger('click')
    expect(wrapper.emitted('adjudicateLoss')).toHaveLength(1)
  })

  it('blocks every new activity decision while an exact command is uncertain', async () => {
    const current = authority(true, true)
    const wrapper = mount(TrainerExplorationActivityCard, {
      props: {
        authority: current, projection: current.projection, status: 'uncertain',
        message: 'The result is uncertain.', busy: false,
        recoveryOnline: false, exactRetryAvailable: true,
      },
    })
    expect(wrapper.get('#exploration-encounter-reference').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.exploration-card__loss input').attributes('disabled')).toBeDefined()
    const buttons = wrapper.findAll('button')
    expect(buttons.find(button => button.text().includes('Accept encounter'))?.attributes('disabled')).toBeDefined()
    expect(buttons.find(button => button.text().includes('Adjudicate lure lost'))?.attributes('disabled')).toBeDefined()
    expect(buttons.find(button => button.text().includes('Cancel lure'))?.attributes('disabled')).toBeDefined()
    const retry = buttons.find(button => button.text().includes('Retry exact command'))!
    expect(retry.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Offline — waiting to reconnect')
    expect(wrapper.text()).toContain('Available after reconnection.')
    await wrapper.setProps({ recoveryOnline: true })
    expect(retry.attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('Reconnect never retries automatically.')
  })
})
