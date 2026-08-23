/**
 * @vitest-environment happy-dom
 */
import { performance } from 'node:perf_hooks'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SkillCheckSpectatorProjectionV1 } from '#shared/skillChecks/projections'
import EncounterSkillCheckPublicFeed from '~/components/encounter/workspace/EncounterSkillCheckPublicFeed.vue'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { SKILL_CHECK_API_PATHS } from '~/utils/apiRoutes'

const publicCheck = (overrides: Partial<SkillCheckSpectatorProjectionV1> = {}): SkillCheckSpectatorProjectionV1 => ({
  schemaVersion: 1,
  projection: 'spectator',
  checkId: 'skill-check:v1:public-ravine',
  revision: 1,
  state: 'pending',
  publicLabel: 'Cross the ravine',
  pendingCount: 2,
  result: null,
  history: [{
    entryId: 'skill-check-public-history:v1:ravine-requested',
    kind: 'requested',
    headline: 'Skill Check requested',
    createdAt: 100,
  }],
  updatedAt: 100,
  ...overrides,
})
const payload = (checks: readonly SkillCheckSpectatorProjectionV1[]) => ({
  schemaVersion: 1,
  audience: 'spectator',
  checks,
  serverNow: 500,
})

const wrappers: VueWrapper[] = []
const mountComponent = () => {
  const wrapper = mount(EncounterSkillCheckPublicFeed, { attachTo: document.body })
  wrappers.push(wrapper)
  return wrapper
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  resetApiClientForTests()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('EncounterSkillCheckPublicFeed', () => {
  it('shows only public identity and aggregate pending state with generic history', async () => {
    const getJson = vi.fn(async () => payload([publicCheck()]))
    const postJson = vi.fn(async () => ({ schemaVersion: 1, timedOutCheckIds: [] }))
    configureApiClientForTests({ getJson, postJson })
    const wrapper = mountComponent()
    await flushPromises()

    expect(postJson).toHaveBeenCalledWith(SKILL_CHECK_API_PATHS.settleExpired, {})
    expect(getJson).toHaveBeenCalledWith(SKILL_CHECK_API_PATHS.projections, { params: { limit: 50 } })
    expect(wrapper.text()).toContain('Skill checks')
    expect(wrapper.text()).toContain('Waiting')
    expect(wrapper.text()).toContain('Cross the ravine')
    expect(wrapper.text()).toContain('2 responses pending')
    expect(wrapper.text()).toContain('Public history · 1')
    expect(wrapper.text()).toContain('Skill Check requested')
    expect(wrapper.find('details').attributes('open')).toBeUndefined()
    for (const forbidden of ['Maya', 'Spark', 'Athletics', 'DC 15', 'modifier', 'dice', 'total', 'gmNotes', 'operationId']) {
      expect(wrapper.text()).not.toContain(forbidden)
    }
  })

  it('renders visible aggregate, withheld, cancelled, and timed-out states without subject data', async () => {
    configureApiClientForTests({
      getJson: vi.fn(async () => payload([
        publicCheck({
          checkId: 'skill-check:v1:public-resolved', revision: 3, state: 'accepted', pendingCount: 0,
          publicLabel: 'Scale the cliff',
          result: { visibility: 'visible', successfulSubjects: 1, failedSubjects: 1, winners: 0, losers: 0 },
          history: [
            publicCheck().history[0]!,
            { entryId: 'skill-check-public-history:v1:cliff-resolved', kind: 'accepted', headline: 'Skill Check resolved', createdAt: 200 },
          ],
          updatedAt: 200,
        }),
        publicCheck({
          checkId: 'skill-check:v1:public-withheld', revision: 2, state: 'accepted', pendingCount: 0,
          publicLabel: 'Read the ancient seal',
          result: { visibility: 'withheld', successfulSubjects: null, failedSubjects: null, winners: null, losers: null },
          history: [
            publicCheck().history[0]!,
            { entryId: 'skill-check-public-history:v1:seal-resolved', kind: 'accepted', headline: 'Skill Check resolved', createdAt: 200 },
          ],
          updatedAt: 200,
        }),
        publicCheck({
          checkId: 'skill-check:v1:public-cancelled', state: 'cancelled', pendingCount: 1, publicLabel: 'Cancelled check',
          history: [
            publicCheck().history[0]!,
            { entryId: 'skill-check-public-history:v1:cancelled', kind: 'cancelled', headline: 'Skill Check cancelled', createdAt: 100 },
          ],
        }),
        publicCheck({
          checkId: 'skill-check:v1:public-timeout', state: 'timed-out', pendingCount: 1, publicLabel: 'Expired check',
          history: [
            publicCheck().history[0]!,
            { entryId: 'skill-check-public-history:v1:timed-out', kind: 'timed-out', headline: 'Skill Check timed out', createdAt: 100 },
          ],
        }),
      ])),
      postJson: vi.fn(async () => ({})),
    })
    const wrapper = mountComponent()
    await flushPromises()
    expect(wrapper.text()).toContain('1 success · 1 failure')
    expect(wrapper.text()).toContain('Result kept private')
    expect(wrapper.text()).toContain('The request was cancelled')
    expect(wrapper.text()).toContain('The request expired')
    expect(wrapper.text()).not.toContain('finalTotal')
  })

  it('bounds public cards and collapsed history while preserving explicit keyboard expansion', async () => {
    const many = Array.from({ length: 45 }, (_, index) => publicCheck({
      checkId: `skill-check:v1:public-scale-${index}`,
      publicLabel: `Public scale check ${index + 1}`,
      history: Array.from({ length: 10 }, (__, historyIndex) => ({
        entryId: `skill-check-public-history:v1:scale-${index}-${historyIndex}`,
        kind: 'requested' as const,
        headline: `Skill Check history ${historyIndex + 1}`,
        createdAt: 100,
      })),
    }))
    configureApiClientForTests({
      getJson: vi.fn(async () => payload(many)),
      postJson: vi.fn(async () => ({})),
    })
    const startedAt = performance.now()
    const wrapper = mountComponent()
    await flushPromises()
    expect(performance.now() - startedAt).toBeLessThan(250)
    expect(wrapper.findAll('.public-checks__entry')).toHaveLength(20)
    expect(wrapper.findAll('.public-checks__history li')).toHaveLength(80)
    await wrapper.findAll('.public-checks__history-more')[0]!.trigger('click')
    expect(wrapper.findAll('.public-checks__history')[0]!.findAll('li')).toHaveLength(10)
    const interactionStartedAt = performance.now()
    await wrapper.get('.public-checks__more').trigger('click')
    expect(performance.now() - interactionStartedAt).toBeLessThan(100)
    expect(wrapper.findAll('.public-checks__entry')).toHaveLength(40)
  })

  it('uses a labeled focus-stable refresh, polite status, and alerting load failure', async () => {
    configureApiClientForTests({
      getJson: vi.fn(async () => { throw new Error('projection unavailable') }),
      postJson: vi.fn(async () => ({})),
    })
    const wrapper = mountComponent()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('projection unavailable')
    expect(wrapper.get('[role="status"]').exists()).toBe(true)
    const refresh = wrapper.get('button')
    expect(refresh.text()).toBe('Refresh')
    refresh.element.focus()
    await refresh.trigger('click')
    await flushPromises()
    expect(refresh.attributes('type')).toBe('button')
    expect(document.activeElement).toBe(refresh.element)
  })
})
