import { ref, shallowRef } from 'vue'
import {
  BREEDING_WORKSHOP_ACTIVITY_API_PATH,
  verifyBreedingWorkshopActivityProjectionV1,
  type BreedingWorkshopActivityProjectionV1,
} from '#shared/breeding/workshopActivity'
import { getErrorMessage } from '~/utils/errorMessages'

export const useBreedingWorkshopActivity = () => {
  const { isPlayer } = useAuth()
  const { getJson } = useApiClient()
  const profiles = usePlayerProfiles()
  const projection = shallowRef<BreedingWorkshopActivityProjectionV1 | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let selectedTrainerSlug: string | null = null
  let loadSequence = 0

  const clear = (): void => {
    loadSequence += 1
    selectedTrainerSlug = null
    projection.value = null
    loading.value = false
    error.value = null
  }
  const load = async (trainerSheetSlug: string | null): Promise<void> => {
    if (!trainerSheetSlug) {
      clear()
      return
    }
    const sequence = ++loadSequence
    selectedTrainerSlug = trainerSheetSlug
    loading.value = true
    error.value = null
    try {
      const raw = await getJson<unknown>(BREEDING_WORKSHOP_ACTIVITY_API_PATH, {
        params: {
          profileId: isPlayer.value ? profiles.selectedProfileId.value : undefined,
          trainerSheetSlug,
        },
      })
      const parsed = await verifyBreedingWorkshopActivityProjectionV1(raw)
      if (sequence !== loadSequence || selectedTrainerSlug !== trainerSheetSlug) return
      projection.value = parsed
    }
    catch (cause) {
      if (sequence !== loadSequence || selectedTrainerSlug !== trainerSheetSlug) return
      projection.value = null
      error.value = getErrorMessage(cause)
    }
    finally {
      if (sequence === loadSequence) loading.value = false
    }
  }
  const reload = async (): Promise<void> => load(selectedTrainerSlug)

  return { projection, loading, error, load, reload, clear }
}
