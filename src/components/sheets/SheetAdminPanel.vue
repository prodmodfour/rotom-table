<script setup lang="ts">
import GmAdminModalShell from '~/components/admin/GmAdminModalShell.vue'
import GmAdminPanelHeader from '~/components/admin/GmAdminPanelHeader.vue'

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

    <section class="sheet-admin-panel__action-card" aria-labelledby="randomize-added-stats-title">
      <div>
        <h3 id="randomize-added-stats-title">Randomise Added Stats</h3>
        <p>
          Overwrite the Added column with a random legal allocation of this Pokémon's
          {{ statPointsBudget ?? 'Level + 10' }} Stat Points. Combat Stages are unchanged.
        </p>
      </div>
      <button
        type="button"
        class="sheet-admin-panel__primary-action"
        @click="emit('randomize-added-stats')"
      >
        Randomise added stats
      </button>
    </section>

    <p v-if="errorMessage" class="sheet-admin-panel__message sheet-admin-panel__message--error">
      {{ errorMessage }}
    </p>
    <p v-else-if="statusMessage" class="sheet-admin-panel__message sheet-admin-panel__message--success">
      {{ statusMessage }}
    </p>
  </GmAdminModalShell>
</template>

<style scoped>
.sheet-admin-panel__action-card {
  display: grid;
  gap: 0.85rem;
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-inset);
}

.sheet-admin-panel__action-card h3 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1rem;
}

.sheet-admin-panel__action-card p {
  margin: 0.3rem 0 0;
  color: var(--ink-soft);
  font-size: 0.82rem;
  line-height: 1.45;
}

.sheet-admin-panel__primary-action {
  width: 100%;
  border: 1px solid var(--accent);
  border-radius: 14px;
  background: var(--accent);
  color: var(--accent-contrast);
  cursor: pointer;
  font: inherit;
  font-weight: 900;
  padding: 0.8rem 1rem;
}

.sheet-admin-panel__primary-action:hover,
.sheet-admin-panel__primary-action:focus-visible {
  filter: brightness(1.08);
  outline: none;
}

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
