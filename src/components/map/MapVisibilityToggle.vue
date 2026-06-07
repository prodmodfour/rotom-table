<script setup lang="ts">
import { checkedValueFromEvent } from '~/utils/domEvents'

withDefaults(defineProps<{
  playerVisible?: boolean
  label?: string
}>(), {
  label: 'Player visible',
})

const emit = defineEmits<{
  (event: 'update-player-visible', value: boolean): void
}>()
</script>

<template>
  <label class="visibility-toggle" :class="{ active: playerVisible }">
    <input
      :checked="playerVisible === true"
      type="checkbox"
      @change="emit('update-player-visible', checkedValueFromEvent($event))"
    />
    {{ label }}
  </label>
</template>

<style scoped>
.visibility-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  width: fit-content;
  margin: 0 0 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.35rem 0.7rem;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.visibility-toggle.active {
  border-color: rgba(184, 187, 38, 0.55);
  background: rgba(184, 187, 38, 0.12);
  color: var(--good);
}

.visibility-toggle input {
  width: auto;
}
</style>
