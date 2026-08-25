import { onScopeDispose, ref, watch } from 'vue'
import type {
  BattleContestLiveplayProjectionV1,
  BattleContestLiveplayResponseV1,
  BattleContestLiveplaySpendV1,
} from '#shared/contests/battleLiveplay'
import { contestRealtimeChannel } from '#shared/contests/realtime'
import { subscribeChannel } from '~/composables/useRealtime'

const statusFor = (error: unknown): number => {
  const row = error as { statusCode?: number, status?: number, response?: { status?: number } }
  return row?.statusCode ?? row?.status ?? row?.response?.status ?? 0
}

const messageFor = (error: unknown): string => {
  const row = error as { data?: { statusMessage?: string, message?: string }, statusMessage?: string, message?: string }
  return row?.data?.statusMessage ?? row?.data?.message ?? row?.statusMessage ?? row?.message ?? 'Battle Contest authority is unavailable.'
}

interface PendingRetry {
  readonly encounterId: string
  readonly expectedContestRevision: number
  readonly spentDice: BattleContestLiveplaySpendV1
}

export const useBattleContestLiveplay = (
  profileId: { readonly value: string | null },
  audience?: { readonly value: string | null },
) => {
  const battleContest = ref<BattleContestLiveplayProjectionV1 | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)
  const uncertainDecision = ref<PendingRetry | null>(null)
  let activeEncounterId: string | null = null
  let unsubscribe: (() => void) | null = null
  let subscribedContestId: string | null = null
  let sequence = 0

  const attachRealtime = (projection: BattleContestLiveplayProjectionV1 | null): void => {
    const contestId = projection?.contestId ?? null
    if (contestId === subscribedContestId) return
    unsubscribe?.(); unsubscribe = null; subscribedContestId = contestId
    if (contestId) unsubscribe = subscribeChannel(contestRealtimeChannel(contestId), () => {
      if (activeEncounterId) void load(activeEncounterId, true, true)
    })
  }

  const acceptResponse = (response: BattleContestLiveplayResponseV1): void => {
    battleContest.value = response.battleContest
    attachRealtime(response.battleContest)
  }

  const synchronize = async (encounterId: string, silent = false): Promise<void> => {
    if (submitting.value || uncertainDecision.value) return
    submitting.value = true
    if (!silent) error.value = null
    try {
      const response = await $fetch<BattleContestLiveplayResponseV1>('/api/contests/battle-liveplay', {
        method: 'POST',
        body: {
          schemaVersion: 1,
          command: 'synchronize',
          encounterId,
          ...(profileId.value ? { profileId: profileId.value } : {}),
          ...(audience?.value === 'public' ? { view: 'public' } : {}),
        },
      })
      acceptResponse(response)
    } catch (reason) {
      error.value = messageFor(reason)
    } finally { submitting.value = false }
  }

  const load = async (encounterId: string, silent = false, reconcile = true): Promise<void> => {
    activeEncounterId = encounterId
    const request = ++sequence
    const profileAtRequest = profileId.value
    const viewAtRequest = audience?.value ?? null
    if (!silent) loading.value = true
    if (!silent) error.value = null
    try {
      const response = await $fetch<BattleContestLiveplayResponseV1>('/api/contests/battle-liveplay', {
        query: { encounterId, ...(profileId.value ? { profileId: profileId.value } : {}), ...(audience?.value === 'public' ? { view: 'public' } : {}) },
      })
      if (request !== sequence || profileAtRequest !== profileId.value || viewAtRequest !== (audience?.value ?? null)) return
      acceptResponse(response)
      if (reconcile && response.battleContest?.synchronizing) await synchronize(encounterId, true)
    } catch (reason) {
      if (request === sequence && profileAtRequest === profileId.value && viewAtRequest === (audience?.value ?? null)) {
        if (statusFor(reason) === 404) {
          battleContest.value = null
          attachRealtime(null)
          error.value = null
        }
        else error.value = messageFor(reason)
      }
    } finally {
      if (!silent && request === sequence) loading.value = false
    }
  }

  const clear = (): void => {
    sequence += 1
    activeEncounterId = null
    battleContest.value = null
    loading.value = false
    error.value = null
    notice.value = null
    uncertainDecision.value = null
    attachRealtime(null)
  }

  const scoreAppeal = async (spentDice: BattleContestLiveplaySpendV1, retry?: PendingRetry): Promise<boolean> => {
    const projection = battleContest.value
    const encounterId = retry?.encounterId ?? activeEncounterId
    if (!projection?.pendingAppeal || !projection.pendingAppeal.canResolve || !encounterId || submitting.value) return false
    const command: PendingRetry = retry ?? Object.freeze({
      encounterId,
      expectedContestRevision: projection.revision,
      spentDice: Object.freeze({ ...spentDice }),
    })
    submitting.value = true; error.value = null; notice.value = null
    try {
      const response = await $fetch<BattleContestLiveplayResponseV1>('/api/contests/battle-liveplay', {
        method: 'POST',
        body: {
          schemaVersion: 1,
          command: 'score-appeal',
          encounterId: command.encounterId,
          expectedContestRevision: command.expectedContestRevision,
          spentDice: command.spentDice,
          ...(profileId.value ? { profileId: profileId.value } : {}),
          ...(audience?.value === 'public' ? { view: 'public' } : {}),
        },
      })
      uncertainDecision.value = null
      acceptResponse(response)
      notice.value = response.battleContest?.exactRetry
        ? 'Recovered the original accepted Contest Appeal.'
        : 'Contest Appeal accepted.'
      return true
    } catch (reason) {
      const status = statusFor(reason)
      uncertainDecision.value = status >= 400 && status < 500 ? null : command
      error.value = uncertainDecision.value
        ? `${messageFor(reason)} The outcome is uncertain; retry the same allocation.`
        : messageFor(reason)
      return false
    } finally { submitting.value = false }
  }

  const retryUncertain = async (): Promise<boolean> => {
    const retry = uncertainDecision.value
    return retry ? scoreAppeal(retry.spentDice, retry) : false
  }

  watch([() => profileId.value, () => audience?.value ?? null], () => {
    battleContest.value = null; error.value = null; notice.value = null; uncertainDecision.value = null
    if (activeEncounterId) void load(activeEncounterId)
  })
  onScopeDispose(() => unsubscribe?.())

  return {
    battleContest,
    loading,
    submitting,
    error,
    notice,
    uncertainDecision,
    load,
    clear,
    synchronize,
    scoreAppeal,
    retryUncertain,
  }
}
