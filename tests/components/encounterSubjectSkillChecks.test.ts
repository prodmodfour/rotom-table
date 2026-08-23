/**
 * @vitest-environment happy-dom
 */
import { performance } from 'node:perf_hooks'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SkillCheckSubjectRequestViewV1 } from '#shared/skillChecks/subjectWorkflow'
import EncounterSubjectSkillChecks from '~/components/encounter/workspace/EncounterSubjectSkillChecks.vue'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { SKILL_CHECK_API_PATHS } from '~/utils/apiRoutes'

const pending = (overrides: Partial<SkillCheckSubjectRequestViewV1> = {}): SkillCheckSubjectRequestViewV1 => ({
  schemaVersion: 1,
  projection: 'subject',
  checkId: 'skill-check:v1:ravine-prompt',
  revision: 1,
  state: 'pending',
  subjectId: 'skill-check-subject:v1:maya-ravine',
  subjectKind: 'trainer',
  subjectLabel: 'Maya',
  publicLabel: 'Cross the ravine',
  prompt: 'Make an Athletics check to cross safely.',
  response: 'pending',
  skillAuthority: {
    status: 'available',
    skillId: 'athletics',
    diceCount: 2,
    visibleFlatModifier: 1,
    contributors: [{ label: 'Authoritative Trainer skill modifier', value: 1 }],
    privateGmAdjustment: 'may-apply',
  },
  comparison: { kind: 'dc', difficultyClass: null, disclosure: 'after-acceptance' },
  group: { subjectCount: 2, acceptedCount: 0 },
  canRespond: true,
  canDecline: true,
  unavailableReason: null,
  result: null,
  history: [{
    entryId: 'skill-check-subject-history:v1:ravine-requested',
    kind: 'requested',
    headline: 'Skill Check requested',
    createdAt: 100,
  }],
  expiresAt: 10_000,
  updatedAt: 100,
  ...overrides,
})

const payload = (requests: readonly SkillCheckSubjectRequestViewV1[] = [pending()]) => ({
  schemaVersion: 1,
  requests,
  serverNow: 1_000,
})

const wrappers: VueWrapper[] = []
const mountComponent = (props: Record<string, unknown> = {}) => {
  const wrapper = mount(EncounterSubjectSkillChecks, {
    attachTo: document.body,
    props: { profileId: 'profile_maya0001', ...props },
  })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  resetApiClientForTests()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('EncounterSubjectSkillChecks', () => {
  it('presents a role-safe canonical prompt with modifier transparency and no roll input', async () => {
    const getJson = vi.fn(async () => payload())
    const postJson = vi.fn(async () => ({ schemaVersion: 1, timedOutCheckIds: [] }))
    configureApiClientForTests({ getJson, postJson })
    const wrapper = mountComponent()
    await flushPromises()

    expect(getJson).toHaveBeenCalledWith(SKILL_CHECK_API_PATHS.subject, {
      params: { profileId: 'profile_maya0001', limit: 100 },
    })
    expect(wrapper.get('[role="dialog"]').attributes('aria-modal')).toBe('false')
    expect(wrapper.text()).toContain('Skill Check requested')
    expect(wrapper.text()).toContain('Cross the ravine')
    expect(wrapper.text()).toContain('Maya')
    expect(wrapper.text()).toContain('Trainer · Athletics')
    expect(wrapper.text()).toContain('2d6 + 1')
    expect(wrapper.text()).toContain('Authoritative Trainer skill modifier+1')
    expect(wrapper.text()).toContain('A private GM adjustment may apply.')
    expect(wrapper.text()).toContain('Revealed after acceptance')
    expect(wrapper.text()).toContain('0 of 2 ready')
    expect(wrapper.text()).toContain('The server rolls after every required subject accepts.')
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Take the check', 'Decline'])
    expect(wrapper.text()).not.toContain('gmNotes')
    expect(wrapper.text()).not.toContain('situationalModifier')
  })

  it('submits only an opaque accept response and retains exact retry after uncertain delivery', async () => {
    const postJson = vi.fn(async (request: string) => {
      if (request === SKILL_CHECK_API_PATHS.settleExpired) return { schemaVersion: 1, timedOutCheckIds: [] }
      throw new Error('connection reset')
    })
    configureApiClientForTests({ getJson: vi.fn(async () => payload()), postJson })
    const wrapper = mountComponent()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Take the check')!.trigger('click')
    await flushPromises()

    const firstBody = postJson.mock.calls[1]![1] as { command: Record<string, unknown>, profileId: string }
    expect(postJson.mock.calls[1]![0]).toBe(SKILL_CHECK_API_PATHS.subject)
    expect(firstBody).toMatchObject({
      profileId: 'profile_maya0001',
      command: {
        schemaVersion: 1,
        expectedRevision: 1,
        commandKind: 'respond',
        checkId: 'skill-check:v1:ravine-prompt',
        subjectId: 'skill-check-subject:v1:maya-ravine',
        decision: 'accept',
      },
    })
    expect(firstBody.command).not.toHaveProperty('dice')
    expect(firstBody.command).not.toHaveProperty('modifier')
    expect(wrapper.text()).toContain('Retry exact response')

    await wrapper.findAll('button').find(button => button.text() === 'Retry exact response')!.trigger('click')
    await flushPromises()
    expect(postJson.mock.calls[2]![1]).toEqual(firstBody)
  })

  it('submits a durable decline only while the projection authorizes it', async () => {
    const postJson = vi.fn(async (request: string) => {
      if (request === SKILL_CHECK_API_PATHS.settleExpired) return {}
      throw new Error('decline uncertain')
    })
    configureApiClientForTests({ getJson: vi.fn(async () => payload()), postJson })
    const wrapper = mountComponent()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Decline')!.trigger('click')
    await flushPromises()
    expect(postJson.mock.calls[1]![1]).toMatchObject({
      command: { commandKind: 'respond', decision: 'decline' },
      profileId: 'profile_maya0001',
    })
  })

  it('shows only the authorized own terminal total/outcome or an explicit withheld result', async () => {
    const accepted = pending({
      revision: 3,
      state: 'accepted',
      response: 'accepted',
      comparison: { kind: 'dc', difficultyClass: 15, disclosure: 'after-acceptance' },
      group: { subjectCount: 2, acceptedCount: 2 },
      canRespond: false,
      canDecline: false,
      unavailableReason: 'already-responded',
      result: { visibility: 'visible', finalTotal: 17, outcome: 'success' },
      history: [
        pending().history[0]!,
        {
          entryId: 'skill-check-subject-history:v1:ravine-accepted',
          kind: 'accepted',
          headline: 'Skill Check resolved',
          createdAt: 300,
        },
      ],
      updatedAt: 300,
    })
    configureApiClientForTests({
      getJson: vi.fn(async () => payload([accepted])),
      postJson: vi.fn(async () => ({})),
    })
    const wrapper = mountComponent()
    await flushPromises()
    expect(wrapper.text()).toContain('Skill Check resolved')
    expect(wrapper.text()).toContain('Your result')
    expect(wrapper.text()).toContain('17')
    expect(wrapper.text()).toContain('Success')
    expect(wrapper.text()).toContain('DC 15')
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['×', 'Dismiss'])

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    configureApiClientForTests({
      getJson: vi.fn(async () => payload([{ ...accepted, result: { visibility: 'withheld', finalTotal: null, outcome: null } }])),
      postJson: vi.fn(async () => ({})),
    })
    const withheld = mountComponent()
    await flushPromises()
    expect(withheld.text()).toContain('Result withheld')
    expect(withheld.text()).toContain('The GM kept this result private.')
    expect(withheld.text()).not.toContain('17')
  })

  it('labels the non-modal decision, focuses its heading, and pages long safe history without an initial DOM flood', async () => {
    const history = Array.from({ length: 45 }, (_, index) => ({
      entryId: `skill-check-subject-history:v1:ravine-history-${index}` as const,
      kind: 'requested' as const,
      headline: `Skill Check history ${index + 1}`,
      createdAt: 100,
    }))
    configureApiClientForTests({
      getJson: vi.fn(async () => payload([pending({ history })])),
      postJson: vi.fn(async () => ({})),
    })
    const wrapper = mountComponent()
    await flushPromises()
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.attributes('aria-describedby')).toBe('subject-check-prompt subject-check-announcement')
    expect(document.activeElement).toBe(wrapper.get('#subject-check-heading').element)
    expect(wrapper.findAll('.subject-check__history li')).toHaveLength(20)
    const interactionStartedAt = performance.now()
    await wrapper.get('.subject-check__history-more').trigger('click')
    expect(performance.now() - interactionStartedAt).toBeLessThan(100)
    expect(wrapper.findAll('.subject-check__history li')).toHaveLength(40)
  })

  it('dismisses only terminal status with Escape and restores focus to the Action Dock', async () => {
    const dock = document.createElement('section')
    dock.id = 'encounter-action-dock'
    dock.tabIndex = -1
    document.body.append(dock)
    const accepted = pending({
      revision: 3,
      state: 'accepted',
      response: 'accepted',
      comparison: { kind: 'dc', difficultyClass: 15, disclosure: 'after-acceptance' },
      group: { subjectCount: 1, acceptedCount: 1 },
      canRespond: false,
      canDecline: false,
      unavailableReason: 'already-responded',
      result: { visibility: 'visible', finalTotal: 17, outcome: 'success' },
      history: [
        pending().history[0]!,
        { entryId: 'skill-check-subject-history:v1:ravine-terminal', kind: 'accepted', headline: 'Skill Check resolved', createdAt: 300 },
      ],
      updatedAt: 300,
    })
    configureApiClientForTests({
      getJson: vi.fn(async () => payload([accepted])),
      postJson: vi.fn(async () => ({})),
    })
    const wrapper = mountComponent()
    await flushPromises()
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(dock)
  })

  it('renders expired, stale-authority, and reconnect-blocked requests without enabled response controls', async () => {
    const unavailable = pending({
      skillAuthority: { status: 'unavailable', skillId: 'athletics', reason: 'skill-authority-unavailable' },
      canRespond: false,
      canDecline: false,
      unavailableReason: 'skill-authority-unavailable',
    })
    configureApiClientForTests({ getJson: vi.fn(async () => payload([unavailable])), postJson: vi.fn(async () => ({})) })
    const wrapper = mountComponent({ commandsBlocked: true })
    await flushPromises()
    expect(wrapper.text()).toContain('The authoritative sheet or skill changed.')
    expect(wrapper.findAll('button').some(button => button.text() === 'Take the check')).toBe(false)
    expect(wrapper.findAll('button').some(button => button.text() === 'Decline')).toBe(false)
  })
})
