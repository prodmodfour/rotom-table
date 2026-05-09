<script setup lang="ts">
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { MoveAutomationSuggestionKind } from '~/utils/moveAutomationTransaction'

const hazardCellsText = defineModel<string>('hazardCellsText', { required: true })

defineProps<{
  script: MoveAutomationScript
  canApplyMapEffects?: boolean
  hpSuggestionAmounts: Record<string, string>
  suggestionEnabled: (kind: MoveAutomationSuggestionKind, index: number) => boolean
  suggestionKey: (kind: MoveAutomationSuggestionKind, index: number) => string
}>()

const emit = defineEmits<{
  (event: 'set-suggestion-enabled', kind: MoveAutomationSuggestionKind, index: number, value: boolean): void
  (event: 'set-hp-suggestion-amount', index: number, value: string): void
  (event: 'add-user-cell-to-hazard-text'): void
}>()

const checkboxValue = (event: Event): boolean => (event.target as HTMLInputElement).checked
const inputValue = (event: Event): string => (event.target as HTMLInputElement | HTMLTextAreaElement).value
</script>

<template>
  <section v-if="script.hpSuggestions.length" class="move-resolution__section">
    <header class="move-resolution__section-header"><h3>HP effects</h3></header>
    <label v-for="(item, index) in script.hpSuggestions" :key="`hp-${index}`" class="effect-toggle effect-toggle--with-input">
      <input :checked="suggestionEnabled('hp', index)" type="checkbox" @change="emit('set-suggestion-enabled', 'hp', index, checkboxValue($event))" />
      <span>{{ item.recipient === 'user' ? 'User' : 'Target' }}: {{ item.label }}</span>
      <input :value="hpSuggestionAmounts[suggestionKey('hp', index)] ?? ''" type="number" min="0" placeholder="auto" @input="emit('set-hp-suggestion-amount', index, inputValue($event))" />
    </label>
  </section>

  <section v-if="script.fieldSuggestions.length || script.hazardSuggestions.length" class="move-resolution__section">
    <header class="move-resolution__section-header"><h3>Map effects</h3></header>
    <p v-if="!canApplyMapEffects" class="move-resolution__hint">Only the GM can persist map-level field effects and hazards.</p>
    <label v-for="(item, index) in script.fieldSuggestions" :key="`field-${index}`" class="effect-toggle">
      <input :checked="suggestionEnabled('field', index)" type="checkbox" :disabled="!canApplyMapEffects" @change="emit('set-suggestion-enabled', 'field', index, checkboxValue($event))" />
      <span>{{ item.label }}</span>
    </label>
    <label v-for="(item, index) in script.hazardSuggestions" :key="`hazard-${index}`" class="effect-toggle">
      <input :checked="suggestionEnabled('hazard', index)" type="checkbox" :disabled="!canApplyMapEffects" @change="emit('set-suggestion-enabled', 'hazard', index, checkboxValue($event))" />
      <span>{{ item.label }}</span>
    </label>
    <div v-if="script.hazardSuggestions.length" class="hazard-cell-input">
      <div class="move-resolution__section-header">
        <span>Hazard cells</span>
        <button type="button" class="mini-button" @click="emit('add-user-cell-to-hazard-text')">Add user cell</button>
      </div>
      <textarea v-model="hazardCellsText" :disabled="!canApplyMapEffects" rows="4" placeholder="x,y,z per line (or x,z using user's elevation)" />
    </div>
  </section>
</template>

<style scoped>
.move-resolution__section {
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper);
}

.move-resolution__section h3 {
  margin: 0;
}

.move-resolution__section-header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: center;
}

.move-resolution__hint {
  color: var(--ink-muted);
  font-size: 0.84rem;
}

.move-resolution__section input,
.move-resolution__section textarea,
.hazard-cell-input textarea {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.65rem;
  font: inherit;
}

.mini-button {
  padding: 0.55rem 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

.effect-toggle {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  padding: 0.35rem 0;
  color: var(--ink);
}

.effect-toggle--with-input input[type='number'] {
  max-width: 7rem;
  margin-left: auto;
}

.hazard-cell-input {
  margin-top: 0.6rem;
}
</style>
