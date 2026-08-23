/**
 * @vitest-environment happy-dom
 */
import { performance } from 'node:perf_hooks'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKILL_CHECK_SKILL_IDS, type SkillCheckDocumentV1 } from '#shared/skillChecks/contract'
import { SKILL_CHECK_DC_PRESETS } from '#shared/skillChecks/difficulty'
import EncounterGmSkillChecks from '~/components/encounter/workspace/EncounterGmSkillChecks.vue'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { SKILL_CHECK_API_PATHS } from '~/utils/apiRoutes'

const readyCheck = (): SkillCheckDocumentV1 => ({
  schemaVersion: 1,
  checkId: 'skill-check:v1:ravine-ready',
  revision: 3,
  state: 'ready',
  mode: 'group',
  requester: { role: 'gm', principalId: 'gm:session' },
  publicLabel: 'Cross the ravine',
  prompt: 'Make an Athletics check to cross safely.',
  gmNotes: 'The far ledge may collapse.',
  visibility: 'public-results',
  comparison: { kind: 'dc', difficultyClass: 15, concealment: 'subjects-after-acceptance' },
  situationalModifier: -1,
  subjects: [{
    subjectId: 'skill-check-subject:v1:maya-ravine',
    kind: 'trainer',
    sheetSlug: 'maya',
    sheetRevision: 4,
    skillId: 'athletics',
    controllerProfileIds: ['profile_maya0001'],
    response: 'accepted',
    respondedAt: 90,
  }, {
    subjectId: 'skill-check-subject:v1:spark-ravine',
    kind: 'pokemon',
    sheetSlug: 'spark',
    sheetRevision: 7,
    skillId: 'athletics',
    controllerProfileIds: ['profile_maya0001'],
    response: 'accepted',
    respondedAt: 91,
  }],
  journals: [],
  acceptedResults: [],
  corrections: [],
  history: [{
    historyId: 'skill-check-history:v1:requested-ravine',
    kind: 'requested',
    operationId: 'skill-check-op:v1:request_ravine_0001',
    subjectId: null,
    headline: 'Skill Check requested',
    createdAt: 50,
  }],
  createdAt: 50,
  updatedAt: 91,
  expiresAt: 9_999_999_999_999,
  terminalAt: null,
  lastOperationId: 'skill-check-op:v1:respond_ravine_0002',
})

const loadPayload = () => ({
  schemaVersion: 1,
  checks: [readyCheck()],
  subjects: [{
    kind: 'trainer',
    sheetSlug: 'maya',
    sheetRevision: 4,
    label: 'Maya',
    controllerProfileIds: ['profile_maya0001'],
    skillIds: [...SKILL_CHECK_SKILL_IDS],
  }, {
    kind: 'pokemon',
    sheetSlug: 'spark',
    sheetRevision: 7,
    label: 'Spark',
    controllerProfileIds: ['profile_maya0001'],
    skillIds: [...SKILL_CHECK_SKILL_IDS],
  }],
  dcPresets: SKILL_CHECK_DC_PRESETS.map(preset => ({ ...preset })),
})

afterEach(() => {
  resetApiClientForTests()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('EncounterGmSkillChecks', () => {
  it('renders private ready authority and exposes only server resolution and cancellation commands', async () => {
    const postJson = vi.fn(async (request: string) => {
      if (request === SKILL_CHECK_API_PATHS.settleExpired) return { schemaVersion: 1, timedOutCheckIds: [] }
      throw new Error('network outcome unknown')
    })
    configureApiClientForTests({ getJson: vi.fn(async () => loadPayload()), postJson })
    const wrapper = mount(EncounterGmSkillChecks, { attachTo: document.body })
    await flushPromises()

    expect(wrapper.text()).toContain('Private GM authority')
    expect(wrapper.text()).toContain('Ready to resolve')
    expect(wrapper.text()).toContain('Cross the ravine')
    expect(wrapper.text()).toContain('DC 15')
    expect(wrapper.text()).toContain('2 of 2 ready')
    expect(wrapper.findAll('.gm-checks__response--accepted')).toHaveLength(2)
    expect(wrapper.find('input[aria-label*="roll" i]').exists()).toBe(false)

    await wrapper.get('.gm-checks__request .gm-checks__primary').trigger('click')
    await flushPromises()
    const command = postJson.mock.calls[1]![1] as { command: Record<string, unknown> }
    expect(postJson.mock.calls[1]![0]).toBe(SKILL_CHECK_API_PATHS.gm)
    expect(command.command).toMatchObject({
      schemaVersion: 1,
      expectedRevision: 3,
      commandKind: 'resolve',
      checkId: 'skill-check:v1:ravine-ready',
    })
    expect(command.command).not.toHaveProperty('results')
    expect(wrapper.text()).toContain('Retry exact command')
  })

  it('authors reviewed-preset requests and preserves the exact operation after an uncertain delivery', async () => {
    const postJson = vi.fn(async (request: string) => {
      if (request === SKILL_CHECK_API_PATHS.settleExpired) return { schemaVersion: 1, timedOutCheckIds: [] }
      throw new Error('connection reset')
    })
    configureApiClientForTests({ getJson: vi.fn(async () => loadPayload()), postJson })
    const wrapper = mount(EncounterGmSkillChecks, { attachTo: document.body })
    await flushPromises()

    await wrapper.get('#gm-check-public-label').setValue('Climb the spillway')
    await wrapper.get('#gm-check-prompt').setValue('Choose a safe route up the spillway.')
    const mayaRow = wrapper.findAll('.gm-checks__subject-option').find(row => row.text().includes('Maya'))!
    await mayaRow.get('input[type="checkbox"]').setValue(true)
    await mayaRow.get('select').setValue('athletics')
    await wrapper.get('#gm-check-difficulty').setValue('skill-check-dc-preset:v1:hard')
    await wrapper.get('#gm-check-modifier').setValue('-2')
    await wrapper.get('.gm-checks__composer form').trigger('submit')
    await flushPromises()

    const firstBody = postJson.mock.calls[1]![1] as { command: Record<string, unknown> }
    expect(firstBody.command).toMatchObject({
      schemaVersion: 1,
      expectedRevision: 0,
      commandKind: 'request',
      publicLabel: 'Climb the spillway',
      prompt: 'Choose a safe route up the spillway.',
      visibility: 'public-results',
      comparison: {
        kind: 'dc',
        difficulty: { kind: 'preset', presetId: 'skill-check-dc-preset:v1:hard' },
        concealment: 'subjects-after-acceptance',
      },
      situationalModifier: -2,
      subjects: [{ kind: 'trainer', sheetSlug: 'maya', skillId: 'athletics' }],
    })
    expect(firstBody.command).not.toHaveProperty('dice')
    expect(firstBody.command).not.toHaveProperty('sheetRevision')

    await wrapper.findAll('button').find(button => button.text() === 'Retry exact command')!.trigger('click')
    await flushPromises()
    expect(postJson).toHaveBeenCalledTimes(3)
    expect(postJson.mock.calls[2]![1]).toEqual(firstBody)
  })

  it('moves keyboard focus into cancellation and restores it on Escape', async () => {
    configureApiClientForTests({ getJson: vi.fn(async () => loadPayload()), postJson: vi.fn(async () => ({})) })
    const wrapper = mount(EncounterGmSkillChecks, { attachTo: document.body })
    await flushPromises()
    const cancel = wrapper.findAll('.gm-checks__request button').find(button => button.text() === 'Cancel')!
    cancel.element.focus()
    await cancel.trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('.gm-checks__cancel textarea').element)
    expect(wrapper.get('.gm-checks__cancel').attributes('role')).toBe('group')
    await wrapper.get('.gm-checks__cancel textarea').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('.gm-checks__cancel').exists()).toBe(false)
    expect(document.activeElement).toBe(cancel.element)
  })

  it('bounds open-request rendering to one 20-card batch and reveals later requests explicitly', async () => {
    const checks = Array.from({ length: 45 }, (_, index): SkillCheckDocumentV1 => {
      const base = readyCheck()
      const suffix = `scale-${index}`
      return {
        ...base,
        checkId: `skill-check:v1:${suffix}`,
        publicLabel: `Scale check ${index + 1}`,
        subjects: base.subjects.map((subject, subjectIndex) => ({
          ...subject,
          subjectId: `skill-check-subject:v1:${suffix}-${subjectIndex}`,
        })),
        history: [{
          ...base.history[0]!,
          historyId: `skill-check-history:v1:${suffix}`,
          operationId: `skill-check-op:v1:request_${suffix}_0001`,
        }],
        lastOperationId: `skill-check-op:v1:respond_${suffix}_0002`,
      }
    })
    configureApiClientForTests({
      getJson: vi.fn(async () => ({ ...loadPayload(), checks })),
      postJson: vi.fn(async () => ({})),
    })
    const startedAt = performance.now()
    const wrapper = mount(EncounterGmSkillChecks, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.findAll('.gm-checks__request')).toHaveLength(20)
    expect(performance.now() - startedAt).toBeLessThan(250)
    const more = wrapper.get('.gm-checks__more')
    const interactionStartedAt = performance.now()
    await more.trigger('click')
    expect(performance.now() - interactionStartedAt).toBeLessThan(100)
    expect(wrapper.findAll('.gm-checks__request')).toHaveLength(40)
  })

  it('keeps narrow-form labels, private notes, blocked reasons, and touch-sized controls explicit', async () => {
    configureApiClientForTests({ getJson: vi.fn(async () => loadPayload()), postJson: vi.fn(async () => ({})) })
    const wrapper = mount(EncounterGmSkillChecks, {
      attachTo: document.body,
      props: { commandsBlocked: true },
    })
    await flushPromises()

    expect(wrapper.get('#gm-check-public-label').attributes('maxlength')).toBe('120')
    expect(wrapper.get('#gm-check-prompt').attributes('maxlength')).toBe('2000')
    expect(wrapper.text()).toContain('GM notes · private')
    expect(wrapper.text()).toContain('Dice are rolled by the server')
    expect(wrapper.text()).toContain('Commands are paused while authority reconnects.')
    expect(wrapper.get('.gm-checks__composer .gm-checks__primary').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('.gm-checks__request .gm-checks__primary').attributes()).toHaveProperty('disabled')
  })
})
