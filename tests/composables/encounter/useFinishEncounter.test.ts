/**
 * @vitest-environment happy-dom
 */
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFinishEncounter } from '~/composables/encounter/useFinishEncounter'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { ENCOUNTER_SETTLEMENT_API_PATHS } from '~/utils/apiRoutes'
import { readPendingEncounterSettlementOperation } from '~/utils/encounterSettlementOperationStorage'

const command = {
  schemaVersion: 1 as const,
  operationId: 'settlement-commit:v1:0000000001000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  settlementId: 'encounter-settlement:riverside-training',
  expectedSettlementRevision: 2,
  planDefinitionSha256: 'a'.repeat(64),
  confirmed: true as const,
}
const view = (state: 'ready' | 'accepted' = 'ready') => ({
  schemaVersion: 1 as const,
  state,
  encounterName: 'Riverside Training',
  participantCount: 1,
  readinessLabel: state === 'accepted' ? 'Encounter finished' : 'Ready to settle',
  readinessDetail: state === 'accepted' ? 'Accepted atomically.' : 'No unresolved decisions.',
  gates: [],
  consequences: [{ kind: 'hp' as const, label: 'Hit Points', count: 1, detail: 'Preserved.' }],
  rewards: [],
  outcomes: [{ kind: 'encounter' as const, label: 'Riverside Training', resultLabel: 'completed', visibility: 'public' as const }],
  cleanup: [{ kind: 'initiative' as const, label: 'Initiative', sourceCount: 1, actionLabel: 'reset', detail: 'Reset.' }],
  outstandingWork: [],
  continuations: state === 'accepted'
    ? [{ kind: 'campaign' as const, label: 'Campaign', href: '/campaign', detail: 'Continue.' }]
    : [],
  command: state === 'ready' ? command : null,
  accepted: state === 'accepted' ? {
    completedAtCampaignMinute: 500, changedSheetCount: 1, changedGroupCount: 0,
    historyFactCount: 3, attentionSourceCount: 0, replayed: false,
  } : null,
})
const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  resetApiClientForTests()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('useFinishEncounter', () => {
  it('durably retains an interrupted command and only exact-retries after explicit recovery', async () => {
    let commitAttempts = 0
    const postJson = vi.fn(async (path: string, body: unknown): Promise<unknown> => {
      if (path === ENCOUNTER_SETTLEMENT_API_PATHS.prepareFinish) return view('ready')
      if (path === ENCOUNTER_SETTLEMENT_API_PATHS.operationStatus) {
        return { status: 'unknown', retry: 'explicit-only' }
      }
      expect(path).toBe(ENCOUNTER_SETTLEMENT_API_PATHS.commitFinish)
      expect(body).toEqual({ command })
      commitAttempts += 1
      if (commitAttempts === 1) throw new TypeError('response lost')
      return { ...view('accepted'), accepted: { ...view('accepted').accepted, replayed: true } }
    })
    configureApiClientForTests({ getJson: vi.fn(), postJson })
    const encounterId = ref('encounter-riverside-training')
    let finish!: ReturnType<typeof useFinishEncounter>
    const wrapper = mount(defineComponent({
      setup() {
        finish = useFinishEncounter({ encounterId, enabled: ref(true) })
        return () => h('div')
      },
    }))
    await finish.open()
    expect(finish.state.value).toBe('reviewing')
    await finish.commit()
    expect(finish.state.value).toBe('uncertain')
    expect(finish.canDiscard.value).toBe(false)
    expect(readPendingEncounterSettlementOperation(window.localStorage, encounterId.value)?.command).toEqual(command)

    window.dispatchEvent(new Event('online'))
    await flush()
    expect(commitAttempts).toBe(1)
    await finish.checkServer()
    expect(finish.state.value).toBe('uncertain')
    expect(finish.canDiscard.value).toBe(true)
    expect(finish.error.value).toContain('explicitly retry')
    await finish.retryExact()
    expect(finish.state.value).toBe('accepted')
    expect(finish.view.value?.accepted?.replayed).toBe(true)
    expect(readPendingEncounterSettlementOperation(window.localStorage, encounterId.value)).toBeNull()
    expect(commitAttempts).toBe(2)
    wrapper.unmount()
  })

  it('adopts an accepted status without replay and reloads the authoritative summary', async () => {
    window.localStorage.setItem(
      'rotom-table:encounter-settlement:pending:v1:encounter-riverside-training',
      JSON.stringify({ schemaVersion: 1, encounterId: 'encounter-riverside-training', command, createdAt: 1_000 }),
    )
    let accepted = false
    const postJson = vi.fn(async (path: string): Promise<unknown> => {
      if (path === ENCOUNTER_SETTLEMENT_API_PATHS.operationStatus) {
        accepted = true
        return { status: 'accepted', operationKind: 'commit', settlementRevision: 3, acceptedAtCampaignMinute: 500, retry: 'not-needed' }
      }
      if (path === ENCOUNTER_SETTLEMENT_API_PATHS.prepareFinish) return view(accepted ? 'accepted' : 'ready')
      throw new Error('unexpected mutation')
    })
    configureApiClientForTests({ getJson: vi.fn(), postJson })
    let finish!: ReturnType<typeof useFinishEncounter>
    const wrapper = mount(defineComponent({
      setup() {
        finish = useFinishEncounter({ encounterId: ref('encounter-riverside-training'), enabled: ref(true) })
        return () => h('div')
      },
    }))
    await flush()
    await finish.open()
    expect(finish.state.value).toBe('uncertain')
    await finish.checkServer()
    expect(finish.state.value).toBe('accepted')
    expect(postJson).not.toHaveBeenCalledWith(ENCOUNTER_SETTLEMENT_API_PATHS.commitFinish, expect.anything())
    wrapper.unmount()
  })
})
