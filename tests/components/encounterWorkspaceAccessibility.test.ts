/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EncounterWorkspaceAnnouncements from '~/components/encounter/workspace/EncounterWorkspaceAnnouncements.vue'
import EncounterWorkspaceSettings from '~/components/encounter/workspace/EncounterWorkspaceSettings.vue'
import EncounterWorkspaceShell from '~/components/encounter/workspace/EncounterWorkspaceShell.vue'
import { DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES } from '#shared/encounterWorkspace/preferences'
import type { EncounterWorkspaceViewModel } from '#shared/encounterWorkspace/model'

vi.stubGlobal('scrollTo', vi.fn())
afterEach(() => document.body.replaceChildren())

const workspace = {
  participants: [{ participantId: 'visible-one', displayName: 'Visible Hero' }],
  turn: { currentParticipantId: 'visible-one', round: 2 },
  pending: [{ interactionId: 'pending-one', prompt: 'Choose whether to respond.' }],
  accepted: [{
    presentationId: 'accepted-one',
    headline: { label: 'Visible Hero acted.' },
    announcements: [{ announcementId: 'announcement-one', priority: 'polite', message: 'Visible Hero acted.', dedupeKey: 'visible-action' }],
    correction: null,
  }],
} as EncounterWorkspaceViewModel

describe('encounter workspace accessibility controls', () => {
  it('provides narrow-screen region tabs and returns to the battle when a blocking decision appears', async () => {
    const wrapper = mount(EncounterWorkspaceShell, {
      props: { preferences: DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES, primaryDecisionActive: false },
    })
    const body = wrapper.get('.encounter-workspace-shell__body')
    expect(body.attributes('data-mobile-panel')).toBe('stage')
    await wrapper.get('button[aria-current="page"]').trigger('click')
    await wrapper.findAll('.encounter-workspace-shell__mobile-tabs button')[1]!.trigger('click')
    expect(body.attributes('data-mobile-panel')).toBe('roster')
    await wrapper.setProps({ primaryDecisionActive: true })
    expect(body.attributes('data-mobile-panel')).toBe('stage')
  })

  it('edits only the closed local presentation preference shape and supports Escape dismissal', async () => {
    const wrapper = mount(EncounterWorkspaceSettings, {
      attachTo: document.body,
      props: { open: true, preferences: DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES },
    })
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    const text = dialog.textContent ?? ''
    expect(text).toContain('never store maps, sheets, choices, commands, or authority data')
    const selects = dialog.querySelectorAll('select')
    const layout = selects[0] as HTMLSelectElement
    layout.value = 'table-display'
    layout.dispatchEvent(new Event('change', { bubbles: true }))
    expect(wrapper.emitted('update')?.[0]).toEqual([{ layout: 'table-display' }])
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('announces projected actor, response, and accepted facts without rendering an interactive duplicate', async () => {
    const wrapper = mount(EncounterWorkspaceAnnouncements, { props: { workspace } })
    const regions = wrapper.findAll('p')
    expect(regions).toHaveLength(2)
    expect(regions[0]!.attributes('aria-live')).toBe('polite')
    expect(regions[1]!.attributes('aria-live')).toBe('assertive')
    expect(wrapper.text()).toContain('Visible Hero is the current actor')
    expect(wrapper.text()).toContain('Response required. Choose whether to respond.')
    await wrapper.setProps({
      workspace: {
        ...workspace,
        accepted: [{
          ...workspace.accepted[0]!,
          presentationId: 'accepted-two',
          headline: { label: 'A new accepted result.' },
          announcements: [],
        }],
      },
    })
    expect(wrapper.text()).toContain('A new accepted result.')
    expect(wrapper.findAll('button')).toHaveLength(0)
  })
})
