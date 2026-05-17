<script setup lang="ts">
import { textValueFromEvent } from '~/utils/domEvents'

defineProps<{
  groundLevelYMax: number
  mapGroundLevelY: number
}>()

const emit = defineEmits<{
  (event: 'set-ground-level-y', value: string): void
}>()
</script>

<template>
  <div class="admin-field">
    <label for="admin-ground-level-y">
      <span>Map-specific Y=0 / ground level</span>
      <input
        id="admin-ground-level-y"
        type="number"
        min="0"
        :max="groundLevelYMax"
        :value="mapGroundLevelY"
        @input="emit('set-ground-level-y', textValueFromEvent($event))"
      />
    </label>
    <p class="admin-field__hint">
      Set the absolute Y layer that should be shown as ground Y=0.
      Absolute Y=0 remains the lowest layer of the map.
    </p>
  </div>
</template>

<style scoped>
.admin-field label {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.admin-field label span {
  color: var(--ink-muted);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.admin-field__hint {
  margin: 0.55rem 0 0;
  color: var(--ink-soft);
  font-size: 0.86rem;
  line-height: 1.45;
}

input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.65rem 0.8rem;
  outline: none;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(255, 31, 45, 0.18);
}
</style>
