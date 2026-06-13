<script setup lang="ts">
import {
  MAP_INTERACTION_MODE_LABELS,
  MAP_INTERACTION_MODES,
  type MapInteractionMode,
} from '#shared/mapInteractionMode'

defineProps<{
  interactionMode: MapInteractionMode
  busy?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  (event: 'set-interaction-mode', value: MapInteractionMode): void
}>()

const modeOptions = [
  MAP_INTERACTION_MODES.LIVE_PLAY,
  MAP_INTERACTION_MODES.SETUP_EDIT,
] as const
</script>

<template>
  <section class="admin-mode-control" aria-labelledby="admin-mode-title">
    <div class="admin-mode-control__heading">
      <h3 id="admin-mode-title">Mode</h3>
      <p>{{ interactionMode === MAP_INTERACTION_MODES.SETUP_EDIT ? 'GM prep autosave is active.' : 'Live-play commands are active.' }}</p>
    </div>

    <div class="admin-mode-control__buttons" role="group" aria-label="Map mode">
      <button
        v-for="mode in modeOptions"
        :key="mode"
        type="button"
        class="admin-mode-control__button"
        :class="{ 'is-active': interactionMode === mode }"
        :aria-pressed="interactionMode === mode"
        :disabled="busy"
        @click="emit('set-interaction-mode', mode)"
      >
        {{ MAP_INTERACTION_MODE_LABELS[mode] }}
      </button>
    </div>

    <p v-if="busy" class="admin-mode-control__status">Updating shared map mode…</p>
    <p v-else-if="error" class="admin-mode-control__status admin-mode-control__status--error">{{ error }}</p>
  </section>
</template>

<style scoped>
.admin-mode-control {
  display: grid;
  gap: 0.65rem;
  margin: 0 0 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: color-mix(in srgb, var(--paper) 84%, transparent);
  padding: 0.75rem;
}

.admin-mode-control__heading {
  display: grid;
  gap: 0.2rem;
}

.admin-mode-control__heading h3,
.admin-mode-control__heading p,
.admin-mode-control__status {
  margin: 0;
}

.admin-mode-control__heading h3 {
  color: var(--ink-bright);
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.admin-mode-control__heading p,
.admin-mode-control__status {
  color: var(--ink-muted);
  font-size: 0.78rem;
  line-height: 1.35;
}

.admin-mode-control__buttons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}

.admin-mode-control__button {
  min-height: 2.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.admin-mode-control__button:hover:not(:disabled),
.admin-mode-control__button:focus-visible:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.admin-mode-control__button.is-active {
  border-color: color-mix(in srgb, var(--accent) 72%, transparent);
  background: color-mix(in srgb, var(--accent) 14%, var(--paper-soft));
  color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
}

.admin-mode-control__button:disabled {
  cursor: wait;
  opacity: 0.7;
}

.admin-mode-control__status--error {
  color: var(--bad);
}
</style>
