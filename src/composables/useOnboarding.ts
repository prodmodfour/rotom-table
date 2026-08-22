import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type {
  GmOnboardingOverview,
  PlayerOnboardingHome,
} from '~~/server/useCases/onboardingWorkflows'
import type { OnboardingDraftV1 } from '#shared/onboarding/draft'
import type { PublishedOnboardingPolicyV1 } from '#shared/onboarding/policy'
import type { OnboardingDraftState } from '#shared/onboarding/lifecycle'
import { onboardingGmChannel, onboardingProfileChannel } from '#shared/onboarding/realtime'
import { subscribeChannel, useRealtimeChannel } from '~/composables/useRealtime'
import { usePlayerProfiles } from '~/composables/usePlayerProfiles'

const errorMessage = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const data = (error as { data?: { statusMessage?: string }, statusMessage?: string, message?: string })
    return data.data?.statusMessage ?? data.statusMessage ?? data.message ?? 'Request failed'
  }
  return error instanceof Error ? error.message : 'Request failed'
}

const operationId = (scope: string): string =>
  `onbop_${scope}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

export const useOnboardingOverview = () => {
  const { getJson, postJson } = useApiClient()
  const { isGm } = useAuth()
  const profiles = usePlayerProfiles()
  if (import.meta.client && !isGm.value) profiles.loadRememberedProfile()

  const gmOverview = ref<GmOnboardingOverview | null>(null)
  const playerHome = ref<PlayerOnboardingHome | null>(null)
  const loading = ref(false)
  const lastError = ref<string | null>(null)
  const busy = ref(false)

  const selectedProfileId = computed(() => profiles.selectedProfileId.value)

  const load = async (): Promise<void> => {
    loading.value = true
    lastError.value = null
    try {
      if (isGm.value) {
        gmOverview.value = await getJson<GmOnboardingOverview>('/api/onboarding/overview')
      } else {
        if (!selectedProfileId.value) {
          profiles.loadRememberedProfile()
        }
        if (!selectedProfileId.value) {
          playerHome.value = null
          return
        }
        playerHome.value = await getJson<PlayerOnboardingHome>(
          `/api/onboarding/overview?profileId=${encodeURIComponent(selectedProfileId.value)}`,
        )
      }
    } catch (error) {
      lastError.value = errorMessage(error)
    } finally {
      loading.value = false
    }
  }

  const createSlot = async (input: { profileId?: string, newProfileDisplayName?: string }): Promise<boolean> => {
    busy.value = true
    lastError.value = null
    try {
      await postJson('/api/onboarding/slots/create', input)
      await load()
      return true
    } catch (error) {
      lastError.value = errorMessage(error)
      return false
    } finally {
      busy.value = false
    }
  }

  const cancelSlot = async (slotId: string): Promise<boolean> => {
    busy.value = true
    lastError.value = null
    try {
      await postJson('/api/onboarding/slots/cancel', {
        slotId,
        profileId: selectedProfileId.value ?? undefined,
        operationId: operationId('cancel'),
      })
      await load()
      return true
    } catch (error) {
      lastError.value = errorMessage(error)
      return false
    } finally {
      busy.value = false
    }
  }

  const restartSlot = async (slotId: string): Promise<boolean> => {
    busy.value = true
    lastError.value = null
    try {
      await postJson('/api/onboarding/slots/restart', {
        slotId,
        operationId: operationId('restart'),
      })
      await load()
      return true
    } catch (error) {
      lastError.value = errorMessage(error)
      return false
    } finally {
      busy.value = false
    }
  }

  useRealtimeChannel(onboardingGmChannel, () => { if (isGm.value) void load() })
  let unsubscribeProfileChannel: (() => void) | null = null
  watch(selectedProfileId, (profileId) => {
    unsubscribeProfileChannel?.()
    unsubscribeProfileChannel = profileId
      ? subscribeChannel(onboardingProfileChannel(profileId), () => { if (!isGm.value) void load() })
      : null
  }, { immediate: true })
  onBeforeUnmount(() => { unsubscribeProfileChannel?.() })

  return {
    isGm,
    profiles,
    gmOverview,
    playerHome,
    loading,
    busy,
    lastError,
    load,
    createSlot,
    cancelSlot,
    restartSlot,
  }
}

export interface OnboardingDraftHandle {
  readonly draft: OnboardingDraftV1
  readonly revision: number
  readonly state: OnboardingDraftState
  readonly policy: PublishedOnboardingPolicyV1 | null
}

export const useOnboardingDraft = () => {
  const { getJson, postJson } = useApiClient()
  const { isGm } = useAuth()
  const profiles = usePlayerProfiles()
  if (import.meta.client && !isGm.value) profiles.loadRememberedProfile()

  const handle = ref<OnboardingDraftHandle | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const lastError = ref<string | null>(null)
  const conflict = ref(false)

  const selectedProfileId = computed(() => profiles.selectedProfileId.value)

  const load = async (draftId: string): Promise<void> => {
    loading.value = true
    lastError.value = null
    conflict.value = false
    try {
      const query = isGm.value || !selectedProfileId.value
        ? `draftId=${encodeURIComponent(draftId)}`
        : `draftId=${encodeURIComponent(draftId)}&profileId=${encodeURIComponent(selectedProfileId.value)}`
      handle.value = await getJson<OnboardingDraftHandle>(`/api/onboarding/draft/load?${query}`)
    } catch (error) {
      lastError.value = errorMessage(error)
      handle.value = null
    } finally {
      loading.value = false
    }
  }

  const save = async (document: OnboardingDraftV1): Promise<boolean> => {
    if (!handle.value) return false
    saving.value = true
    lastError.value = null
    try {
      const result = await postJson<{ draft: OnboardingDraftV1, revision: number, state: OnboardingDraftState }>(
        '/api/onboarding/draft/save',
        {
          draftId: handle.value.draft.draftId,
          profileId: selectedProfileId.value ?? undefined,
          expectedRevision: handle.value.revision,
          document,
        },
      )
      handle.value = { ...handle.value, draft: result.draft, revision: result.revision, state: result.state }
      conflict.value = false
      return true
    } catch (error) {
      const message = errorMessage(error)
      lastError.value = message
      if (/revision/i.test(message)) conflict.value = true
      return false
    } finally {
      saving.value = false
    }
  }

  return {
    isGm,
    profiles,
    handle,
    loading,
    saving,
    lastError,
    conflict,
    load,
    save,
  }
}
