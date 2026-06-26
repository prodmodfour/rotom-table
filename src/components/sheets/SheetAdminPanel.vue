<script setup lang="ts">
import GmAdminModalShell from '~/components/admin/GmAdminModalShell.vue'
import GmAdminPanelHeader from '~/components/admin/GmAdminPanelHeader.vue'
import PokemonAddedStatsAdminCard from '~/components/sheets/PokemonAddedStatsAdminCard.vue'

defineProps<{
  errorMessage: string | null
  sheetLabel: string | null
  statPointsBudget: number | null
  statusMessage: string | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'randomize-added-stats'): void
}>()

const titleId = 'sheet-admin-title'
</script>

<template>
  <GmAdminModalShell :title-id="titleId" @close="emit('close')">
    <GmAdminPanelHeader
      :title-id="titleId"
      title="Sheet admin"
      :subtitle="sheetLabel"
      close-label="Close sheet admin panel"
      @close="emit('close')"
    />

    <PokemonAddedStatsAdminCard
      title-id="sheet-admin-randomize-added-stats-title"
      :stat-points-budget="statPointsBudget"
      @randomize-added-stats="emit('randomize-added-stats')"
    />

    <p v-if="errorMessage" class="sheet-admin-panel__message sheet-admin-panel__message--error">
      {{ errorMessage }}
    </p>
    <p v-else-if="statusMessage" class="sheet-admin-panel__message sheet-admin-panel__message--success">
      {{ statusMessage }}
    </p>
  </GmAdminModalShell>
</template>

<style scoped>
.sheet-admin-panel__message {
  margin: 0.8rem 0 0;
  border-radius: 12px;
  padding: 0.7rem 0.8rem;
  font-weight: 700;
}

.sheet-admin-panel__message--error {
  background: color-mix(in srgb, var(--bad) 14%, transparent);
  color: var(--bad);
}

.sheet-admin-panel__message--success {
  background: color-mix(in srgb, var(--good) 14%, transparent);
  color: var(--good);
}
</style>
