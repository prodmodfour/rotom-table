/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import EncounterWorkspaceShell from '~/components/encounter/workspace/EncounterWorkspaceShell.vue'
import EncounterWorkspaceSystemStatus from '~/components/encounter/workspace/EncounterWorkspaceSystemStatus.vue'
import { DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES } from '#shared/encounterWorkspace/preferences'
import type { EncounterWorkspaceViewModel } from '#shared/encounterWorkspace/model'

afterEach(() => document.body.replaceChildren())

const workspace = {
  source: { mapRevision: 7 },
  scene: { active: true, name: 'Finale' },
  turn: { round: 3, currentParticipantId: 'actor:one' },
  system: { blockingMessage: null },
} as EncounterWorkspaceViewModel

describe('encounter workspace shell', () => {
  it('keeps navigation, status, timeline, roster, stage, events, and dock as non-overlay landmarks', () => {
    const wrapper = mount(EncounterWorkspaceShell, {
      props: { preferences: DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES },
      slots: {
        navigation: '<nav>Navigation</nav>',
        status: '<section>Status</section>',
        timeline: '<section>Timeline</section>',
        roster: '<p>Roster content</p>',
        stage: '<h1>Battle stage</h1>',
        events: '<p>Event content</p>',
        dock: '<p>Action content</p>',
      },
    })
    expect(wrapper.get('header').text()).toContain('NavigationStatusTimeline')
    expect(wrapper.get('main[aria-label="Battle stage"]').text()).toContain('Battle stage')
    expect(wrapper.findAll('aside')).toHaveLength(2)
    expect(wrapper.get('footer[aria-label="Available actions"]').text()).toContain('Action content')
    expect(wrapper.findAll('[role="separator"]')).toHaveLength(3)
  })

  it('emits bounded resize and collapse preferences from keyboard-accessible controls', async () => {
    const wrapper = mount(EncounterWorkspaceShell, {
      props: { preferences: DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES },
    })
    await wrapper.get('[aria-label="Resize participant roster"]').trigger('keydown', { key: 'ArrowRight' })
    await wrapper.get('[aria-label="Resize encounter history"]').trigger('keydown', { key: 'Home' })
    await wrapper.get('button[aria-label="Toggle participant roster"]').trigger('click')
    await wrapper.get('button[aria-label="Toggle action dock"]').trigger('click')
    expect(wrapper.emitted('update-preferences')).toEqual([
      [{ rosterWidthPx: 304 }],
      [{ eventRailWidthPx: 260 }],
      [{ roster: 'collapsed' }],
      [{ actionDock: 'compact' }],
    ])
  })

  it('announces command-blocking recovery separately from ordinary connection facts', async () => {
    const wrapper = mount(EncounterWorkspaceSystemStatus, {
      props: {
        workspace,
        loadStatus: 'stale',
        connection: 'reconnecting',
        commandsBlocked: true,
        message: 'Reconcile authoritative state.',
      },
    })
    expect(wrapper.text()).toContain('Finale')
    expect(wrapper.text()).toContain('Round 3')
    expect(wrapper.text()).toContain('Reconnecting')
    expect(wrapper.text()).toContain('Stale after revision 7')
    expect(wrapper.get('[role="alert"]').text()).toContain('Reconcile authoritative state.')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([[]])
  })
})
