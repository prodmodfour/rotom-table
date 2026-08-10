import { computed, ref, shallowRef } from 'vue'
import {
  BREEDING_HATCH_WORKFLOW_API_PATH,
  verifyBreedingHatchWorkflowProjectionV1,
  type BreedingHatchWorkflowIntent,
  type BreedingHatchWorkflowProjectionV1,
} from '#shared/breeding/hatchWorkflow'
import { getErrorMessage } from '~/utils/errorMessages'

export const useBreedingHatchWorkflow = () => {
  const { isPlayer } = useAuth()
  const profiles = usePlayerProfiles()
  const { postJson } = useApiClient()
  const projection = shallowRef<BreedingHatchWorkflowProjectionV1 | null>(null)
  const open = ref(false)
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  let trainerSheetSlug: string | null = null
  let selectedProfileId: string | null = null
  let eggId: string | null = null
  let expectedEggRevision: number | null = null
  let requestSequence = 0

  const canAct = computed(() => Boolean(projection.value?.decision.canSubmit)
    && !loading.value && !submitting.value)

  const request = async (
    intent: BreedingHatchWorkflowIntent,
    selectedOptionId: string | null = null,
    destinationOptionId: string | null = null,
  ): Promise<void> => {
    if (!trainerSheetSlug || !eggId || expectedEggRevision === null) return
    const sequence = ++requestSequence
    const mutating = intent !== 'inspect'
    loading.value = !mutating
    submitting.value = mutating
    error.value = null
    try {
      const raw = await postJson<unknown>(BREEDING_HATCH_WORKFLOW_API_PATH, {
        schemaVersion: 1,
        profileId: isPlayer.value ? selectedProfileId : null,
        trainerSheetSlug,
        eggId,
        expectedEggRevision,
        intent,
        destinationOptionId,
        selectedOptionId,
        confirmed: mutating,
      })
      const parsed = await verifyBreedingHatchWorkflowProjectionV1(raw)
      if (sequence !== requestSequence) return
      projection.value = parsed
      expectedEggRevision = parsed.egg.revision
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
  const openFor = async (
    nextTrainerSheetSlug: string,
    nextEggId: string,
    revision: number,
    profileId?: string | null,
  ): Promise<void> => {
    requestSequence += 1
    trainerSheetSlug = nextTrainerSheetSlug
    selectedProfileId = isPlayer.value
      ? profileId === undefined ? profiles.selectedProfileId.value : profileId
      : null
    eggId = nextEggId
    expectedEggRevision = revision
    projection.value = null
    error.value = null
    open.value = true
    await request('inspect')
  }
  const close = (): void => {
    requestSequence += 1
    trainerSheetSlug = null
    selectedProfileId = null
    eggId = null
    expectedEggRevision = null
    projection.value = null
    error.value = null
    loading.value = false
    submitting.value = false
    open.value = false
  }
  const retry = async (): Promise<void> => request('inspect')
  const begin = async (destinationOptionId: string): Promise<void> => {
    if (projection.value?.decision.kind === 'begin-hatch' && canAct.value) {
      await request('begin', null, destinationOptionId)
    }
  }
  const resolveSpecial = async (optionId: string): Promise<void> => {
    if (projection.value?.decision.kind === 'resolve-special' && canAct.value) await request('resolve-special', optionId)
  }
  const complete = async (): Promise<void> => {
    if (projection.value?.decision.kind === 'complete-hatch' && canAct.value) await request('complete')
  }

  return {
    projection,
    open,
    loading,
    submitting,
    error,
    canAct,
    openFor,
    close,
    retry,
    begin,
    resolveSpecial,
    complete,
  }
}
