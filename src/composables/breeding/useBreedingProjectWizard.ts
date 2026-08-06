import { computed, ref, shallowRef } from 'vue'
import {
  BREEDING_PROJECT_WIZARD_API_PATH,
  verifyBreedingProjectWizardProjectionV1,
  type BreedingProjectWizardProjectionV1,
} from '#shared/breeding/projectWizard'
import type { BreedingParentSelectionRefV1 } from '#shared/breeding/parentDiscovery'
import { getErrorMessage } from '~/utils/errorMessages'

export const BREEDING_PROJECT_WIZARD_STEPS = Object.freeze([
  'Destination',
  'Breeder',
  'Parents',
  'Review',
] as const)

export const useBreedingProjectWizard = () => {
  const { isPlayer } = useAuth()
  const profiles = usePlayerProfiles()
  const { postJson } = useApiClient()
  const projection = shallowRef<BreedingProjectWizardProjectionV1 | null>(null)
  const destinationTrainerSlug = ref<string | null>(null)
  const breederTrainerSlug = ref<string | null>(null)
  const parentRefs = ref<readonly BreedingParentSelectionRefV1[]>([])
  const activeStep = ref(0)
  const open = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let requestSequence = 0

  const parentCandidates = computed(() => projection.value?.parentDiscovery.trainerSheets
    .flatMap(trainer => trainer.candidates) ?? [])
  const selectedParentSlugs = computed(() => new Set(
    parentRefs.value.map(ref => ref.pokemonSheetSlug),
  ))
  const canReview = computed(() => projection.value?.reviewStatus
    === 'requires-final-validation')

  const reload = async (): Promise<void> => {
    const destination = destinationTrainerSlug.value
    const breeder = breederTrainerSlug.value
    if (!destination || !breeder) return
    const sequence = ++requestSequence
    loading.value = true
    error.value = null
    try {
      const raw = await postJson<unknown>(BREEDING_PROJECT_WIZARD_API_PATH, {
        schemaVersion: 1,
        profileId: isPlayer.value ? profiles.selectedProfileId.value : null,
        destinationTrainerSlug: destination,
        breederTrainerSlug: breeder,
        parentRefs: parentRefs.value,
      })
      const parsed = await verifyBreedingProjectWizardProjectionV1(raw)
      if (sequence !== requestSequence) return
      projection.value = parsed
      parentRefs.value = parsed.parentDiscovery.selectedParentRefs
    }
    catch (cause) {
      if (sequence !== requestSequence) return
      error.value = getErrorMessage(cause)
    }
    finally {
      if (sequence === requestSequence) loading.value = false
    }
  }

  const start = async (defaultTrainerSlug: string): Promise<void> => {
    open.value = true
    activeStep.value = 0
    destinationTrainerSlug.value = defaultTrainerSlug
    breederTrainerSlug.value = defaultTrainerSlug
    parentRefs.value = []
    projection.value = null
    await reload()
  }

  const close = (): void => {
    requestSequence += 1
    open.value = false
    loading.value = false
    error.value = null
    projection.value = null
    parentRefs.value = []
    activeStep.value = 0
  }

  const selectDestination = async (trainerSheetSlug: string): Promise<void> => {
    if (destinationTrainerSlug.value === trainerSheetSlug) return
    destinationTrainerSlug.value = trainerSheetSlug
    breederTrainerSlug.value ??= trainerSheetSlug
    parentRefs.value = []
    projection.value = null
    activeStep.value = Math.min(activeStep.value, 1)
    await reload()
  }

  const selectBreeder = async (trainerSheetSlug: string): Promise<void> => {
    if (breederTrainerSlug.value === trainerSheetSlug) return
    breederTrainerSlug.value = trainerSheetSlug
    projection.value = null
    await reload()
  }

  const toggleParent = async (pokemonSheetSlug: string): Promise<void> => {
    const candidate = parentCandidates.value.find(entry => entry.parentSheetSlug === pokemonSheetSlug)
    if (!candidate || candidate.availability.status !== 'selectable'
      || candidate.parentSheetRevision === null) return
    const current = parentRefs.value
    const existing = current.findIndex(ref => ref.pokemonSheetSlug === pokemonSheetSlug)
    if (existing >= 0) {
      parentRefs.value = Object.freeze(current.filter((_, index) => index !== existing))
    }
    else if (current.length < 2) {
      parentRefs.value = Object.freeze([
        ...current,
        Object.freeze({
          pokemonSheetSlug: candidate.parentSheetSlug,
          expectedSheetRevision: candidate.parentSheetRevision,
        }),
      ])
    }
    else return
    await reload()
  }

  const nextStep = (): void => {
    if (activeStep.value < 2 || (activeStep.value === 2 && canReview.value)) {
      activeStep.value = Math.min(BREEDING_PROJECT_WIZARD_STEPS.length - 1, activeStep.value + 1)
    }
  }
  const previousStep = (): void => {
    activeStep.value = Math.max(0, activeStep.value - 1)
  }

  return {
    projection,
    destinationTrainerSlug,
    breederTrainerSlug,
    parentRefs,
    activeStep,
    open,
    loading,
    error,
    parentCandidates,
    selectedParentSlugs,
    canReview,
    start,
    close,
    reload,
    selectDestination,
    selectBreeder,
    toggleParent,
    nextStep,
    previousStep,
  }
}
