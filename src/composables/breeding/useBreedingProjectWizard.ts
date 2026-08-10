import { computed, ref, shallowRef } from 'vue'
import type { BreedingProjectWizardProjectionV1 } from '#shared/breeding/projectWizard'
import type { BreedingProjectGuidanceProjectionV1 } from '#shared/breeding/projectGuidance'
import {
  BREEDING_PROJECT_CHOICES_API_PATH,
  createBreedingProjectDraftId,
  verifyBreedingProjectChoicesProjectionV1,
  type BreedingProjectChoicesProjectionV1,
} from '#shared/breeding/projectChoices'
import type { BreedingParentSelectionRefV1 } from '#shared/breeding/parentDiscovery'
import { getErrorMessage } from '~/utils/errorMessages'

export const BREEDING_PROJECT_WIZARD_STEPS = Object.freeze([
  'Destination',
  'Breeder',
  'Parents',
  'Review',
] as const)

const newProjectDraftId = (): string => createBreedingProjectDraftId((length) => {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure Project draft identity is unavailable.')
  return globalThis.crypto.getRandomValues(new Uint8Array(length))
})

export const useBreedingProjectWizard = () => {
  const { isPlayer } = useAuth()
  const profiles = usePlayerProfiles()
  const { postJson } = useApiClient()
  const projection = shallowRef<BreedingProjectWizardProjectionV1 | null>(null)
  const guidance = shallowRef<BreedingProjectGuidanceProjectionV1 | null>(null)
  const choices = shallowRef<BreedingProjectChoicesProjectionV1 | null>(null)
  const destinationTrainerSlug = ref<string | null>(null)
  const breederTrainerSlug = ref<string | null>(null)
  const parentRefs = ref<readonly BreedingParentSelectionRefV1[]>([])
  const selectedOptionIds = ref<readonly string[]>([])
  const draftId = ref(newProjectDraftId())
  const activeStep = ref(0)
  const open = ref(false)
  const loading = ref(false)
  const confirming = ref(false)
  const error = ref<string | null>(null)
  let requestSequence = 0

  const parentCandidates = computed(() => projection.value?.parentDiscovery.trainerSheets
    .flatMap(trainer => trainer.candidates) ?? [])
  const selectedParentSlugs = computed(() => new Set(
    parentRefs.value.map(ref => ref.pokemonSheetSlug),
  ))
  const canReview = computed(() => projection.value?.reviewStatus === 'requires-final-validation'
    || (parentRefs.value.length === 2
      && choices.value?.parentRoleChoice.status !== undefined
      && choices.value.parentRoleChoice.status !== 'not-required'))
  const projectCreated = computed(() => choices.value?.confirmation.status === 'created')

  const reload = async (confirmed = false): Promise<void> => {
    const destination = destinationTrainerSlug.value
    const breeder = breederTrainerSlug.value
    if (!destination || !breeder) return
    const sequence = ++requestSequence
    loading.value = true
    error.value = null
    try {
      const raw = await postJson<unknown>(BREEDING_PROJECT_CHOICES_API_PATH, {
        schemaVersion: 1,
        draftId: draftId.value,
        profileId: isPlayer.value ? profiles.selectedProfileId.value : null,
        destinationTrainerSlug: destination,
        breederTrainerSlug: breeder,
        parentRefs: parentRefs.value,
        selectedOptionIds: selectedOptionIds.value,
        confirmed,
      })
      const parsed = await verifyBreedingProjectChoicesProjectionV1(raw)
      if (sequence !== requestSequence) return
      choices.value = parsed
      guidance.value = parsed.guidance
      projection.value = parsed.guidance.wizard
      parentRefs.value = parsed.guidance.wizard.parentDiscovery.selectedParentRefs
      selectedOptionIds.value = Object.freeze([
        ...parsed.skillChoice.options,
        ...parsed.maturityChoices.flatMap(choice => choice.option ? [choice.option] : []),
        ...parsed.parentRoleChoice.options,
      ].filter(option => option.selected).map(option => option.optionId).sort())
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
    selectedOptionIds.value = []
    draftId.value = newProjectDraftId()
    projection.value = null
    guidance.value = null
    choices.value = null
    await reload()
  }

  const close = (): void => {
    requestSequence += 1
    open.value = false
    loading.value = false
    error.value = null
    projection.value = null
    guidance.value = null
    choices.value = null
    parentRefs.value = []
    selectedOptionIds.value = []
    confirming.value = false
    activeStep.value = 0
  }

  const selectDestination = async (trainerSheetSlug: string): Promise<void> => {
    if (destinationTrainerSlug.value === trainerSheetSlug) return
    destinationTrainerSlug.value = trainerSheetSlug
    breederTrainerSlug.value ??= trainerSheetSlug
    parentRefs.value = []
    selectedOptionIds.value = []
    projection.value = null
    guidance.value = null
    choices.value = null
    activeStep.value = Math.min(activeStep.value, 1)
    await reload()
  }

  const selectBreeder = async (trainerSheetSlug: string): Promise<void> => {
    if (breederTrainerSlug.value === trainerSheetSlug) return
    breederTrainerSlug.value = trainerSheetSlug
    selectedOptionIds.value = []
    projection.value = null
    guidance.value = null
    choices.value = null
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
    selectedOptionIds.value = []
    choices.value = null
    await reload()
  }

  const selectOption = async (
    selectedOptionId: string,
    siblingOptionIds: readonly string[],
  ): Promise<void> => {
    if (loading.value || projectCreated.value || !siblingOptionIds.includes(selectedOptionId)) return
    const current = new Set(selectedOptionIds.value)
    const wasSelected = current.has(selectedOptionId)
    for (const optionId of siblingOptionIds) current.delete(optionId)
    if (!wasSelected) current.add(selectedOptionId)
    selectedOptionIds.value = Object.freeze([...current].sort())
    await reload()
  }

  const confirmProject = async (): Promise<void> => {
    if (!choices.value?.confirmation.canConfirm || loading.value || confirming.value) return
    confirming.value = true
    try { await reload(true) }
    finally { confirming.value = false }
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
    guidance,
    choices,
    destinationTrainerSlug,
    breederTrainerSlug,
    parentRefs,
    activeStep,
    open,
    loading,
    confirming,
    error,
    parentCandidates,
    selectedParentSlugs,
    canReview,
    projectCreated,
    start,
    close,
    reload,
    selectDestination,
    selectBreeder,
    toggleParent,
    selectOption,
    confirmProject,
    nextStep,
    previousStep,
  }
}
