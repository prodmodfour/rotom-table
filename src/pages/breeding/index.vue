<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import BreedingConsentCenter from '~/components/breeding/BreedingConsentCenter.vue'
import BreedingHatchDecisionFlow from '~/components/breeding/BreedingHatchDecisionFlow.vue'
import BreedingItemWorkflowPanel from '~/components/breeding/BreedingItemWorkflowPanel.vue'
import BreedingProjectWizard from '~/components/breeding/BreedingProjectWizard.vue'
import BreedingWorkshopActivityCards from '~/components/breeding/BreedingWorkshopActivityCards.vue'
import BreedingWorkshopShell from '~/components/breeding/BreedingWorkshopShell.vue'
import { useBreedingConsentWorkflow } from '~/composables/breeding/useBreedingConsentWorkflow'
import { useBreedingHatchWorkflow } from '~/composables/breeding/useBreedingHatchWorkflow'
import { useBreedingItemWorkflows } from '~/composables/breeding/useBreedingItemWorkflows'
import { useBreedingProjectWizard } from '~/composables/breeding/useBreedingProjectWizard'
import { useBreedingWorkshop } from '~/composables/breeding/useBreedingWorkshop'
import { useBreedingWorkshopActivity } from '~/composables/breeding/useBreedingWorkshopActivity'

useHead({
  title: 'Breeding Workshop · Rotom Table',
})

const workshop = useBreedingWorkshop()
const activity = useBreedingWorkshopActivity()
const consent = useBreedingConsentWorkflow()
const hatchWorkflow = useBreedingHatchWorkflow()
const projectWizard = useBreedingProjectWizard()
const selectedTrainerSlug = computed(() => {
  const selected = workshop.selectedOwnershipContext.value
  return selected?.availability === 'available' ? selected.trainerSheetSlug : null
})
const itemWorkflows = useBreedingItemWorkflows({
  trainerSheetSlug: selectedTrainerSlug,
  profileId: workshop.selectedProfileId,
})
let initialized = false

const loadSelectedData = async (): Promise<void> => {
  const selected = workshop.selectedOwnershipContext.value
  const trainerSheetSlug = selected?.availability === 'available' ? selected.trainerSheetSlug : null
  const profileId = workshop.selectedProfileId.value
  await Promise.all([activity.load(trainerSheetSlug, profileId), consent.load(trainerSheetSlug, profileId)])
}

onMounted(async () => {
  await workshop.initialize()
  initialized = true
  await loadSelectedData()
})

watch(workshop.selectedOwnershipContext, () => {
  hatchWorkflow.close()
  if (initialized) void loadSelectedData()
})
watch(workshop.selectedProfileId, () => {
  projectWizard.close()
  hatchWorkflow.close()
  activity.clear()
  consent.clear()
  if (initialized) void workshop.reloadForProfile()
})
watch(() => projectWizard.choices.value?.confirmation.status, (status, previous) => {
  if (status === 'created' && previous !== 'created') {
    void workshop.reload().then(loadSelectedData)
  }
})
watch(() => hatchWorkflow.projection.value?.transition, (transition) => {
  if (transition && transition !== 'none') void loadSelectedData()
})
watch(() => itemWorkflows.lastResult.value?.operationId, (operationId, previous) => {
  if (operationId && operationId !== previous && itemWorkflows.lastResult.value?.egg) {
    void Promise.all([workshop.reload(), activity.reload()])
  }
})
watch(() => consent.projection.value?.transition, (transition) => {
  if (transition && transition !== 'none' && transition !== 'exact-replay') {
    void Promise.all([workshop.reload(), activity.reload()])
  }
})
const startProject = (trainerSheetSlug: string): void => {
  void projectWizard.start(trainerSheetSlug, workshop.selectedProfileId.value)
}
const openHatch = (eggId: string, revision: number): void => {
  const selected = workshop.selectedOwnershipContext.value
  if (selected?.availability === 'available') {
    void hatchWorkflow.openFor(selected.trainerSheetSlug, eggId, revision, workshop.selectedProfileId.value)
  }
}
</script>

<template>
  <main class="breeding-workshop-page rt-design-system" data-rt-design-system="1" data-rt-context="workshop">
    <AppNavigation />
    <BreedingWorkshopShell
      :projection="workshop.projection.value"
      :ownership-contexts="workshop.ownershipContexts.value"
      :loading="workshop.loading.value"
      :loading-more="workshop.loadingMore.value"
      :error="workshop.error.value"
      :profile-switch-path="workshop.profileSwitchPath.value"
      @retry="workshop.reload"
      @select-ownership="workshop.selectOwnershipContext"
      @load-more="workshop.loadMoreOwnershipContexts"
      @start-project="startProject"
    />
    <BreedingItemWorkflowPanel
      v-if="workshop.selectedOwnershipContext.value?.availability === 'available'"
      :projection="itemWorkflows.projection.value"
      :preview="itemWorkflows.preview.value"
      :status="itemWorkflows.status.value"
      :message="itemWorkflows.message.value"
      @retry="itemWorkflows.retryExact"
      @dismiss="itemWorkflows.dismiss"
      @save-warmer="itemWorkflows.saveWarmerAssignment"
      @preview-fossil="itemWorkflows.previewFossil"
      @preview-artificial="itemWorkflows.previewArtificial"
      @commit-preview="itemWorkflows.commitPreview"
      @cancel-preview="itemWorkflows.cancelPreview"
    />
    <BreedingWorkshopActivityCards
      v-if="workshop.selectedOwnershipContext.value?.availability === 'available'"
      :projection="activity.projection.value"
      :loading="activity.loading.value"
      :error="activity.error.value"
      @retry="activity.reload"
      @request-transfer="consent.openTransferSetup"
      @request-hatch="openHatch"
    />
    <BreedingConsentCenter
      v-if="workshop.selectedOwnershipContext.value?.availability === 'available'"
      :projection="consent.projection.value"
      :loading="consent.loading.value"
      :submitting="consent.submitting.value"
      :error="consent.error.value"
      :transfer-setup="consent.transferSetup.value"
      @retry="consent.reload"
      @grant-project-consent="consent.grantProjectConsent"
      @revoke-project-consent="consent.revokeProjectConsent"
      @cancel-project-as-gm="consent.cancelProjectAsGm"
      @close-transfer-setup="consent.closeTransferSetup"
      @offer-egg-transfer="consent.offerEggTransfer"
      @accept-egg-transfer="consent.acceptEggTransfer"
      @revoke-egg-transfer-consent="consent.revokeEggTransferConsent"
      @complete-egg-transfer="consent.completeEggTransfer"
    />
    <BreedingHatchDecisionFlow
      :open="hatchWorkflow.open.value"
      :projection="hatchWorkflow.projection.value"
      :loading="hatchWorkflow.loading.value"
      :submitting="hatchWorkflow.submitting.value"
      :error="hatchWorkflow.error.value"
      @close="hatchWorkflow.close"
      @retry="hatchWorkflow.retry"
      @begin="hatchWorkflow.begin"
      @resolve-special="hatchWorkflow.resolveSpecial"
      @complete="hatchWorkflow.complete"
    />
    <BreedingProjectWizard
      :open="projectWizard.open.value"
      :projection="projectWizard.projection.value"
      :guidance="projectWizard.guidance.value"
      :choices="projectWizard.choices.value"
      :ownership-contexts="workshop.ownershipContexts.value"
      :destination-trainer-slug="projectWizard.destinationTrainerSlug.value"
      :breeder-trainer-slug="projectWizard.breederTrainerSlug.value"
      :selected-parent-slugs="projectWizard.selectedParentSlugs.value"
      :active-step="projectWizard.activeStep.value"
      :loading="projectWizard.loading.value"
      :confirming="projectWizard.confirming.value"
      :error="projectWizard.error.value"
      :can-review="projectWizard.canReview.value"
      @close="projectWizard.close"
      @retry="projectWizard.reload"
      @select-destination="projectWizard.selectDestination"
      @select-breeder="projectWizard.selectBreeder"
      @toggle-parent="projectWizard.toggleParent"
      @select-option="projectWizard.selectOption"
      @confirm-project="projectWizard.confirmProject"
      @next="projectWizard.nextStep"
      @previous="projectWizard.previousStep"
    />
  </main>
</template>

<style scoped>
.breeding-workshop-page {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: clamp(1rem, 2vw, 1.5rem);
  padding: clamp(0.75rem, 2vw, 1.5rem);
  background: var(--rt-context-background, var(--rt-bg-canvas));
  color: var(--rt-text);
}

.breeding-workshop-page > * {
  width: min(100%, 96rem);
  margin-inline: auto;
}

@media (max-width: 520px) {
  .breeding-workshop-page {
    padding: 0.5rem;
  }
}
</style>
