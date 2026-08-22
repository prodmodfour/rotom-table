import { computed, onScopeDispose, ref, watch } from 'vue'
import type { ContestCommandV1, ContestOperationResultV1 } from '#shared/contests/operations'
import type { ContestRoleProjectionV1 } from '#shared/contests/projections'
import { contestApiPath } from '#shared/contests/routes'
import { contestRealtimeChannel } from '#shared/contests/realtime'
import type { ContestUxMetricId } from '#shared/contests/metrics'
import { subscribeChannel } from '~/composables/useRealtime'

const errorMessage = (error: unknown): string => {
  const row = error as { data?: { statusMessage?: string, message?: string }, statusMessage?: string, message?: string }
  return row?.data?.statusMessage ?? row?.data?.message ?? row?.statusMessage ?? row?.message ?? 'Contest authority is unavailable.'
}
const operationId = (): string => `contest-op:v1:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`
export const allocateContestId = (name: string): string => {
  const slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'new-contest'
  const nonce = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12) ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return `contest:v1:${slug}-${nonce}`
}

type ContestUiCommand = ContestCommandV1 extends infer T
  ? T extends ContestCommandV1
    ? Omit<T, 'schemaVersion' | 'operationId' | 'clientId'> & { readonly operationId?: string }
    : never
  : never

export const useContests = (profileId: { readonly value: string | null }) => {
  const contests = ref<ContestRoleProjectionV1[]>([])
  const contest = ref<ContestRoleProjectionV1 | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)
  const uncertainCommand = ref<ContestUiCommand | null>(null)
  let unsubscribe: (() => void) | null = null
  let subscribedContestId: string | null = null
  let activeContestId: string | null = null
  let decisionOpenedAt = Date.now()
  let roundOpenedAt = Date.now()
  let settlementPreviewOpenedAt: number | null = null
  const recordMetric = async (metricId: ContestUxMetricId, value: number): Promise<void> => {
    await $fetch('/api/contests/metrics', { method: 'POST', body: { schemaVersion: 1, metricId, value: Math.max(0, Math.min(3_600_000, Math.round(value))) } }).catch(() => undefined)
  }

  const query = computed(() => profileId.value ? { profileId: profileId.value } : {})
  let listSequence = 0, loadSequence = 0
  const list = async (): Promise<void> => {
    const sequence = ++listSequence, audience = profileId.value
    loading.value = true; error.value = null
    try { const response = await $fetch<{ ok: true, contests: ContestRoleProjectionV1[] }>('/api/contests/list', { query: query.value }); if (sequence === listSequence && audience === profileId.value) contests.value = response.contests }
    catch (reason) { if (sequence === listSequence && audience === profileId.value) error.value = errorMessage(reason) }
    finally { if (sequence === listSequence) loading.value = false }
  }
  const load = async (contestId: string, silent = false): Promise<void> => {
    activeContestId = contestId
    const sequence = ++loadSequence, audience = profileId.value
    if (!silent) loading.value = true
    if (!silent) error.value = null
    try {
      const response = await $fetch<{ ok: true, contest: ContestRoleProjectionV1 }>(contestApiPath(contestId), { query: query.value })
      if (sequence !== loadSequence || audience !== profileId.value) return
      contest.value = response.contest
      decisionOpenedAt = Date.now(); roundOpenedAt = Date.now()
      if (subscribedContestId !== contestId) { unsubscribe?.(); subscribedContestId = contestId; unsubscribe = subscribeChannel(contestRealtimeChannel(contestId), () => { void load(contestId, true) }) }
    } catch (reason) { if (sequence === loadSequence && audience === profileId.value) error.value = errorMessage(reason) }
    finally { if (!silent && sequence === loadSequence) loading.value = false }
  }
  const execute = async (command: ContestUiCommand): Promise<ContestOperationResultV1 | null> => {
    if (submitting.value) { error.value = 'Wait for the current Contest command to finish.'; return null }
    if (uncertainCommand.value && command.operationId === undefined) { error.value = 'Resolve the uncertain Contest command with exact retry before making another decision.'; return null }
    const finalized = Object.freeze({ ...command, operationId: command.operationId ?? operationId() }) as ContestUiCommand
    submitting.value = true; error.value = null; notice.value = null
    const audience = profileId.value
    try {
      const previous = contest.value
      const response = await $fetch<{ ok: true, result: ContestOperationResultV1, projection: ContestRoleProjectionV1 }>('/api/contests/command', {
        method: 'POST', body: { ...finalized, schemaVersion: 1, clientId: 'contest-ui', ...(profileId.value ? { profileId: profileId.value } : {}) },
      })
      uncertainCommand.value = null
      if (audience !== profileId.value) { await load(response.projection.contestId, true); return null }
      contest.value = response.projection
      notice.value = response.result.exactRetry ? 'Recovered the original accepted result.' : 'Accepted by Contest authority.'
      const acceptedAt = Date.now()
      if (!response.result.exactRetry && finalized.commandKind === 'start-introduction' && import.meta.client) {
        const key = `rotom:contest:workshop-open:${response.projection.contestId}`
        const openedAt = Number(sessionStorage.getItem(key))
        if (Number.isFinite(openedAt) && openedAt > 0) void recordMetric('time-to-contest-start', acceptedAt - openedAt)
        sessionStorage.removeItem(key)
      }
      if (!response.result.exactRetry && finalized.commandKind === 'declare-appeal') void recordMetric('appeal-decision-time', acceptedAt - decisionOpenedAt)
      if (!response.result.exactRetry && previous?.round && response.projection.round !== previous.round) { void recordMetric('round-duration', acceptedAt - roundOpenedAt); roundOpenedAt = acceptedAt }
      if (!response.result.exactRetry && finalized.commandKind === 'prepare-settlement') settlementPreviewOpenedAt = acceptedAt
      if (!response.result.exactRetry && finalized.commandKind === 'commit-settlement' && settlementPreviewOpenedAt !== null) void recordMetric('settlement-completion', acceptedAt - settlementPreviewOpenedAt)
      decisionOpenedAt = acceptedAt
      return response.result
    } catch (reason) {
      if (audience !== profileId.value) return null
      const row = reason as { statusCode?: number, status?: number, response?: { status?: number } }
      const status = row?.statusCode ?? row?.status ?? row?.response?.status ?? 0
      uncertainCommand.value = status >= 400 && status < 500 ? null : finalized
      error.value = uncertainCommand.value ? `${errorMessage(reason)} The outcome is uncertain; use exact retry.` : errorMessage(reason)
      return null
    } finally { submitting.value = false }
  }
  const retryUncertain = async (): Promise<ContestOperationResultV1 | null> => uncertainCommand.value ? execute(uncertainCommand.value) : null
  watch(() => profileId.value, () => {
    // Never retain an owner projection while switching to another table role.
    contest.value = null; contests.value = []; error.value = null; notice.value = null; uncertainCommand.value = null
    if (activeContestId) void load(activeContestId)
    else void list()
  })
  onScopeDispose(() => unsubscribe?.())
  return { contests, contest, loading, submitting, error, notice, uncertainCommand, list, load, execute, retryUncertain, recordMetric, operationId }
}
