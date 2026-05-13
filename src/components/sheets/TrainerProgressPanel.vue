<script setup lang="ts">
import type { TrainerSheet } from '~/types/trainerSheet'

const currentTeamCsv = defineModel<string>('currentTeamCsv', { required: true })
const wishlistCsv = defineModel<string>('wishlistCsv', { required: true })

defineProps<{
  sheet: TrainerSheet
}>()

const emit = defineEmits<{
  addClass: []
  removeClass: [index: number]
}>()
</script>

<template>
  <div class="trainer-progress-panel">
    <TrainerClassesPanel
      :classes="sheet.classes"
      @add-class="emit('addClass')"
      @remove-class="emit('removeClass', $event)"
    />

    <TrainerTeamWishlistPanel
      v-model:current-team-csv="currentTeamCsv"
      v-model:wishlist-csv="wishlistCsv"
      :current-team="sheet.currentTeam"
    />

    <TrainerNarrativePanel
      v-model:physical-description="sheet.physicalDescription"
      v-model:background="sheet.background"
      v-model:personality="sheet.personality"
      v-model:goals-and-dreams="sheet.goalsAndDreams"
    />
  </div>
</template>

<style scoped>
.trainer-progress-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
</style>
