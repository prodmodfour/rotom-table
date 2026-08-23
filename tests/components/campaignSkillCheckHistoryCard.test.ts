// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CampaignSkillCheckHistoryCard from '../../src/components/campaign/CampaignSkillCheckHistoryCard.vue'

const response = (count = 6) => ({
  schemaVersion: 1,
  projection: 'campaign-skill-check-history',
  audience: 'owner',
  entries: Array.from({ length: count }, (_, index) => ({
    entryId: `campaign-skill-check-history:v1:${index.toString(16).padStart(64, '0')}`,
    publicLabel: `Crossing check ${index + 1}`,
    state: index % 3 === 0 ? 'accepted' : index % 3 === 1 ? 'cancelled' : 'timed-out',
    outcome: index % 3 === 0 ? 'success' : null,
    terminalAt: 10_000 - index,
  })),
  serverNow: 20_000,
})

const mountCard = (props: { profileId?: string | null, gm?: boolean } = { profileId: 'profile_maya0001' }) => mount(
  CampaignSkillCheckHistoryCard,
  {
    props,
    attachTo: document.body,
    global: {
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  },
)

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('CampaignSkillCheckHistoryCard', () => {
  it('strictly renders four owner-safe records initially and reveals later bounded batches explicitly', async () => {
    const fetch = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mountCard()
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/skill-checks/campaign-history', {
      query: { profileId: 'profile_maya0001', limit: 20 },
    })
    expect(wrapper.findAll('.skill-history__row')).toHaveLength(4)
    expect(wrapper.text()).toContain('Skill Check history')
    expect(wrapper.text()).toContain('Resolved')
    expect(wrapper.text()).toContain('Cancelled')
    expect(wrapper.text()).toContain('Timed out')
    expect(wrapper.text()).not.toContain('Crossing check 5')
    await wrapper.get('.skill-history__more').trigger('click')
    expect(wrapper.findAll('.skill-history__row')).toHaveLength(6)
    expect(wrapper.get('.skill-history__action').attributes('href')).toBe('/play')

    const rendered = wrapper.html()
    for (const privateField of [
      'gmNotes', 'finalTotal', 'situationalModifier', 'controllerProfileIds', 'sheetRevision',
      'skill-check-subject', 'skill-check-op',
    ]) expect(rendered).not.toContain(privateField)
  })

  it('keeps refresh focus stable and retains the last complete projection on malformed refresh', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(1))
      .mockResolvedValueOnce({ ...response(1), gmNotes: 'private' })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mountCard()
    await flushPromises()
    const refresh = wrapper.get<HTMLButtonElement>('.skill-history__refresh')
    refresh.element.focus()
    await refresh.trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(refresh.element)
    expect(wrapper.text()).toContain('Skill Check history is temporarily unavailable.')
    expect(wrapper.text()).toContain('Crossing check 1')
  })

  it('does not request owner history until a Profile is selected and uses generic GM history authority', async () => {
    const fetch = vi.fn().mockResolvedValue({ ...response(0), audience: 'gm' })
    vi.stubGlobal('$fetch', fetch)
    const player = mountCard({ profileId: null })
    await flushPromises()
    expect(fetch).not.toHaveBeenCalled()
    expect(player.text()).toContain('Select a Player Profile')

    const gm = mountCard({ gm: true })
    await flushPromises()
    expect(fetch).toHaveBeenCalledWith('/api/skill-checks/campaign-history', { query: { limit: 20 } })
    expect(gm.text()).toContain('No terminal Skill Checks are recorded yet.')
  })
})
