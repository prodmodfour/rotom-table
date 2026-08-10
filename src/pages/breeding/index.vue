<script setup lang="ts">
import { onMounted, watch } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import BreedingProjectWizard from '~/components/breeding/BreedingProjectWizard.vue'
import BreedingWorkshopActivityCards from '~/components/breeding/BreedingWorkshopActivityCards.vue'
import BreedingWorkshopShell from '~/components/breeding/BreedingWorkshopShell.vue'
import { useBreedingProjectWizard } from '~/composables/breeding/useBreedingProjectWizard'
import { useBreedingWorkshop } from '~/composables/breeding/useBreedingWorkshop'
import { useBreedingWorkshopActivity } from '~/composables/breeding/useBreedingWorkshopActivity'

useHead({
  title: 'Breeding Workshop · Rotom Table',
})

const workshop = useBreedingWorkshop()
const activity = useBreedingWorkshopActivity()
const projectWizard = useBreedingProjectWizard()
let initialized = false

const loadSelectedActivity = (): Promise<void> => {
  const selected = workshop.selectedOwnershipContext.value
  return activity.load(selected?.availability === 'available' ? selected.trainerSheetSlug : null)
}

onMounted(async () => {
  await workshop.initialize()
  initialized = true
  await loadSelectedActivity()
})

watch(workshop.selectedOwnershipContext, () => {
  if (initialized) void loadSelectedActivity()
})
watch(workshop.selectedProfileId, () => {
  projectWizard.close()
  activity.clear()
  if (initialized) void workshop.reloadForProfile()
})
watch(() => projectWizard.choices.value?.confirmation.status, (status, previous) => {
  if (status === 'created' && previous !== 'created') {
    void workshop.reload().then(loadSelectedActivity)
  }
})
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
      @start-project="projectWizard.start"
    />
    <BreedingWorkshopActivityCards
      v-if="workshop.selectedOwnershipContext.value?.availability === 'available'"
      :projection="activity.projection.value"
      :loading="activity.loading.value"
      :error="activity.error.value"
      @retry="activity.reload"
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
  align-content: start;
  gap: clamp(1rem, 2vw, 1.5rem);
  padding: clamp(0.75rem, 2vw, 1.5rem);
  background: var(--rt-context-background, var(--rt-bg-canvas));
  color: var(--rt-text);
}

.breeding-workshop-page > :deep(*) {
  width: min(100%, 96rem);
  margin-inline: auto;
}

@media (max-width: 520px) {
  .breeding-workshop-page {
    padding: 0.5rem;
  }
}
</style>
