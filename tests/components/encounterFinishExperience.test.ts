/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import EncounterFinishExperience from '~/components/encounter/workspace/EncounterFinishExperience.vue'
import type { FinishEncounterView } from '#shared/encounterSettlement/finish'

const command = {
  schemaVersion: 1 as const,
  operationId: 'settlement-commit:v1:0000000001000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  settlementId: 'encounter-settlement:riverside-training',
  expectedSettlementRevision: 2,
  planDefinitionSha256: 'a'.repeat(64),
  confirmed: true as const,
}
const readyView = (): FinishEncounterView => ({
  schemaVersion: 1,
  state: 'ready',
  encounterName: 'Riverside Training',
  participantCount: 2,
  readinessLabel: 'Ready to settle',
  readinessDetail: 'No unresolved decisions. Rewards, consequences, outcomes, and cleanup can commit together.',
  gates: [],
  consequences: [
    { kind: 'hp', label: 'Hit Points', count: 2, detail: 'Current Hit Points remain on each sheet.' },
    { kind: 'injuries', label: 'Injuries', count: 2, detail: 'Current Injuries remain.' },
  ],
  rewards: [
    { kind: 'experience', label: 'Experience', amountLabel: '10 XP', destinationLabel: 'Sprig', detail: null },
    { kind: 'money', label: 'Money', amountLabel: '₽500', destinationLabel: 'Shared inventory', detail: null },
  ],
  outcomes: [{ kind: 'encounter', label: 'Riverside Training', resultLabel: 'Completed', visibility: 'public' }],
  cleanup: [{ kind: 'combat-stages', label: 'Combat stages', sourceCount: 2, actionLabel: 'reset', detail: 'Reset to their encounter-end defaults.' }],
  outstandingWork: [{ kind: 'level-threshold', label: 'Level-up review', detail: 'A reached threshold remains visible.' }],
  continuations: [],
  command,
  accepted: null,
})

const mountView = (props: Record<string, unknown> = {}) => mount(EncounterFinishExperience, {
  attachTo: document.body,
  props: {
    open: true,
    state: 'reviewing',
    view: readyView(),
    error: null,
    online: true,
    canCommit: true,
    canRetry: false,
    canDiscard: false,
    ...props,
  },
  global: {
    stubs: {
      teleport: true,
      NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
    },
  },
})

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.classList.remove('finish-encounter-page-lock')
})

describe('EncounterFinishExperience', () => {
  it('presents the complete GM review and requires explicit irreversible confirmation', async () => {
    const wrapper = mountView()
    await wrapper.vm.$nextTick()
    const text = document.body.textContent ?? ''
    for (const copy of [
      'Finish Encounter', 'Ready to settle', 'No unresolved decisions', 'Persistent consequences',
      'Rewards & allocations', 'Encounter outcome', 'Temporary cleanup', 'Outstanding work',
      'I reviewed this settlement and understand it cannot be partly applied.',
      'Finish encounter', 'Back to encounter', 'Sprig', '10 XP', 'Shared inventory', '₽500',
    ]) expect(text).toContain(copy)
    expect(text).not.toContain(command.operationId)
    expect(text).not.toContain(command.planDefinitionSha256)
    expect(document.activeElement?.id).toBe('finish-encounter-heading')
    expect(document.documentElement.classList.contains('finish-encounter-page-lock')).toBe(true)

    const commit = wrapper.get('.finish-encounter__commit')
    expect(commit.attributes()).toHaveProperty('disabled')
    await wrapper.get('.finish-encounter__confirmation input').setValue(true)
    const enabledCommit = wrapper.get('.finish-encounter__commit')
    expect(enabledCommit.attributes()).not.toHaveProperty('disabled')
    await enabledCommit.trigger('click')
    expect(wrapper.emitted('commit')).toEqual([[]])
    await wrapper.setProps({ open: false })
    expect(document.documentElement.classList.contains('finish-encounter-page-lock')).toBe(false)
  })

  it('shows the first authoritative blocker with a direct action and never enables commit', async () => {
    const blocked: FinishEncounterView = {
      ...readyView(),
      state: 'blocked',
      readinessLabel: '1 outstanding task',
      gates: [{
        kind: 'pending-resolution', title: 'A resolution is waiting',
        detail: 'Finish the exact pending action before settlement.',
        action: 'return-to-encounter', actionLabel: 'Return to encounter',
      }],
      command: null,
    }
    const wrapper = mountView({ view: blocked, canCommit: false })
    expect(document.body.textContent).toContain('Next task')
    expect(document.body.textContent).toContain('A resolution is waiting')
    expect(wrapper.find('.finish-encounter__commit').exists()).toBe(false)
    await wrapper.get('.finish-encounter__gates button').trigger('click')
    expect(wrapper.emitted('gateAction')).toEqual([['return-to-encounter']])
  })

  it('keeps uncertain retries explicit and unavailable while offline', async () => {
    const wrapper = mountView({
      state: 'uncertain', view: null, error: 'The response was interrupted.',
      online: false, canRetry: false,
    })
    expect(document.body.textContent).toContain('Settlement outcome needs recovery')
    expect(document.body.textContent).toContain('Reconnection never submits it automatically.')
    const retry = wrapper.findAll('.finish-encounter__state-actions button').find(row => row.text() === 'Retry exact command')!
    expect(retry.attributes()).toHaveProperty('disabled')
    const check = wrapper.findAll('.finish-encounter__state-actions button').find(row => row.text() === 'Check server')!
    expect(check.attributes()).toHaveProperty('disabled')
  })

  it('announces accepted completion and provides bounded continuation actions', async () => {
    const accepted: FinishEncounterView = {
      ...readyView(),
      state: 'accepted',
      readinessLabel: 'Encounter finished',
      readinessDetail: 'The complete settlement was accepted atomically.',
      command: null,
      accepted: {
        completedAtCampaignMinute: 500, changedSheetCount: 1, changedGroupCount: 1,
        historyFactCount: 6, attentionSourceCount: 1, replayed: false,
      },
      continuations: [{
        kind: 'campaign', label: 'Campaign follow-up', href: '/campaign', detail: 'Continue with advancement and recovery work.',
      }],
    }
    const wrapper = mountView({ state: 'accepted', view: accepted, canCommit: false })
    expect(document.body.textContent).toContain('Settlement complete')
    expect(document.body.textContent).toContain('6 history facts and 1 follow-up items')
    expect(wrapper.get('a').attributes('href')).toBe('/campaign')
    expect(wrapper.find('.finish-encounter__confirmation').exists()).toBe(false)
  })

  it('traps Escape at the blocking layer and requests origin restoration through close', async () => {
    const wrapper = mountView()
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toEqual([[]])
  })
})
