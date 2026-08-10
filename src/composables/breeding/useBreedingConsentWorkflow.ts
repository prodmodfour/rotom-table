import { computed, ref, shallowRef } from 'vue'
import {
  BREEDING_CONSENT_WORKFLOW_API_PATH,
  verifyBreedingConsentWorkflowProjectionV1,
  type BreedingConsentWorkflowEggTransferV1,
  type BreedingConsentWorkflowIntent,
  type BreedingConsentWorkflowProjectRequestV1,
  type BreedingConsentWorkflowProjectionV1,
} from '#shared/breeding/consentWorkflow'
import { getErrorMessage } from '~/utils/errorMessages'

export const useBreedingConsentWorkflow = () => {
  const { isPlayer } = useAuth()
  const profiles = usePlayerProfiles()
  const { postJson } = useApiClient()
  const projection = shallowRef<BreedingConsentWorkflowProjectionV1 | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const transferSetup = ref<{ readonly eggId: string, readonly eggRevision: number } | null>(null)
  let trainerSheetSlug: string | null = null
  let selectedProfileId: string | null = null
  let requestSequence = 0

  const notificationCount = computed(() => projection.value?.notifications.total ?? 0)
  const profileId = (): string | null => isPlayer.value ? selectedProfileId : null
  const baseRequest = (intent: BreedingConsentWorkflowIntent) => ({
    schemaVersion: 1 as const,
    profileId: profileId(),
    trainerSheetSlug: trainerSheetSlug!,
    intent,
    projectId: null as string | null,
    expectedProjectRevision: null as number | null,
    parentSheetSlug: null as string | null,
    consentId: null as string | null,
    eggId: null as string | null,
    expectedEggRevision: null as number | null,
    destinationTrainerSlug: null as string | null,
    transferConsentId: null as string | null,
    confirmed: intent !== 'view',
  })

  const send = async (body: ReturnType<typeof baseRequest>): Promise<void> => {
    if (!trainerSheetSlug) return
    const sequence = ++requestSequence
    const mutating = body.intent !== 'view'
    if (mutating) submitting.value = true
    else loading.value = true
    error.value = null
    try {
      const raw = await postJson<unknown>(BREEDING_CONSENT_WORKFLOW_API_PATH, body)
      const parsed = await verifyBreedingConsentWorkflowProjectionV1(raw)
      if (sequence !== requestSequence || trainerSheetSlug !== body.trainerSheetSlug) return
      projection.value = parsed
      if (body.intent === 'offer-egg-transfer') transferSetup.value = null
    }
    catch (cause) {
      if (sequence !== requestSequence) return
      error.value = getErrorMessage(cause)
    }
    finally {
      if (sequence === requestSequence) {
        loading.value = false
        submitting.value = false
      }
    }
  }

  const clear = (): void => {
    requestSequence += 1
    trainerSheetSlug = null
    selectedProfileId = null
    projection.value = null
    transferSetup.value = null
    loading.value = false
    submitting.value = false
    error.value = null
  }
  const load = async (nextTrainerSheetSlug: string | null, nextProfileId?: string | null): Promise<void> => {
    if (!nextTrainerSheetSlug) {
      clear()
      return
    }
    trainerSheetSlug = nextTrainerSheetSlug
    selectedProfileId = isPlayer.value
      ? nextProfileId === undefined ? profiles.selectedProfileId.value : nextProfileId
      : null
    transferSetup.value = null
    await send(baseRequest('view'))
  }
  const reload = async (): Promise<void> => trainerSheetSlug ? send(baseRequest('view')) : undefined
  const grantProjectConsent = async (card: BreedingConsentWorkflowProjectRequestV1): Promise<void> => {
    await send({
      ...baseRequest('grant-project-consent'),
      projectId: card.projectId,
      expectedProjectRevision: card.projectRevision,
      parentSheetSlug: card.ownParent.pokemonSheetSlug,
    })
  }
  const revokeProjectConsent = async (card: BreedingConsentWorkflowProjectRequestV1): Promise<void> => {
    if (!card.consent.consentId) return
    await send({
      ...baseRequest('revoke-project-consent'),
      projectId: card.projectId,
      expectedProjectRevision: card.projectRevision,
      consentId: card.consent.consentId,
    })
  }
  const cancelProjectAsGm = async (card: BreedingConsentWorkflowProjectRequestV1): Promise<void> => {
    await send({
      ...baseRequest('gm-cancel-project'),
      projectId: card.projectId,
      expectedProjectRevision: card.projectRevision,
    })
  }
  const openTransferSetup = (eggId: string, eggRevision: number): void => {
    transferSetup.value = Object.freeze({ eggId, eggRevision })
    error.value = null
  }
  const closeTransferSetup = (): void => { transferSetup.value = null }
  const offerEggTransfer = async (destinationTrainerSlug: string): Promise<void> => {
    const setup = transferSetup.value
    if (!setup) return
    await send({
      ...baseRequest('offer-egg-transfer'),
      eggId: setup.eggId,
      expectedEggRevision: setup.eggRevision,
      destinationTrainerSlug,
    })
  }
  const acceptEggTransfer = async (card: BreedingConsentWorkflowEggTransferV1): Promise<void> => {
    await send({
      ...baseRequest('accept-egg-transfer'),
      expectedEggRevision: card.eggRevision,
      transferConsentId: card.offerConsentId,
    })
  }
  const revokeEggTransferConsent = async (card: BreedingConsentWorkflowEggTransferV1): Promise<void> => {
    await send({
      ...baseRequest('revoke-egg-transfer-consent'),
      transferConsentId: card.ownConsentId,
    })
  }
  const completeEggTransfer = async (card: BreedingConsentWorkflowEggTransferV1): Promise<void> => {
    await send({
      ...baseRequest('complete-egg-transfer'),
      expectedEggRevision: card.eggRevision,
      transferConsentId: card.offerConsentId,
    })
  }

  return {
    projection,
    loading,
    submitting,
    error,
    transferSetup,
    notificationCount,
    load,
    reload,
    clear,
    grantProjectConsent,
    revokeProjectConsent,
    cancelProjectAsGm,
    openTransferSetup,
    closeTransferSetup,
    offerEggTransfer,
    acceptEggTransfer,
    revokeEggTransferConsent,
    completeEggTransfer,
  }
}
