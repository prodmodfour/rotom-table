<script setup lang="ts">
import { checkedValueFromEvent, finiteNumberFromEvent } from '~/utils/domEvents'
import { COMBAT_STAGE_KEYS, COMBAT_STAGE_SHORT_LABELS } from '~/utils/combatStages'
import type { CombatStageKey } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { MoveAutomationSuggestionKind } from '~/utils/moveAutomationTargetResolution'

const manualUserConditions = defineModel<string[]>('manualUserConditions', { required: true })
const manualTargetConditions = defineModel<string[]>('manualTargetConditions', { required: true })

defineProps<{
  script: MoveAutomationScript
  manualUserStageDeltas: Record<CombatStageKey, number>
  manualTargetStageDeltas: Record<CombatStageKey, number>
  suggestionEnabled: (kind: MoveAutomationSuggestionKind, index: number) => boolean
}>()

const emit = defineEmits<{
  (event: 'set-suggestion-enabled', kind: MoveAutomationSuggestionKind, index: number, value: boolean): void
  (event: 'set-user-stage-delta', key: CombatStageKey, value: number): void
  (event: 'set-target-stage-delta', key: CombatStageKey, value: number): void
}>()

</script>

<template>
  <section class="move-resolution__section">
    <header class="move-resolution__section-header"><h3>Conditions</h3></header>
    <label
      v-for="(item, index) in script.conditionSuggestions"
      :key="`condition-${index}`"
      class="effect-toggle"
    >
      <input :checked="suggestionEnabled('condition', index)" type="checkbox" @change="emit('set-suggestion-enabled', 'condition', index, checkedValueFromEvent($event))" />
      <span>
        {{ item.recipient === 'user' ? 'User' : 'Target' }}:
        {{ item.action === 'remove' ? 'Remove ' : '' }}{{ item.label }}
      </span>
      <small v-if="item.threshold">{{ item.threshold }}</small>
    </label>
    <details class="manual-details">
      <summary>Manual condition additions</summary>
      <div class="manual-condition-grid">
        <div>
          <h4>User</h4>
          <ConditionPicker v-model="manualUserConditions" compact tag-size="xs" />
        </div>
        <div>
          <h4>Selected target(s)</h4>
          <ConditionPicker v-model="manualTargetConditions" compact tag-size="xs" />
        </div>
      </div>
    </details>
  </section>

  <section class="move-resolution__section">
    <header class="move-resolution__section-header"><h3>Combat stages</h3></header>
    <label
      v-for="(item, index) in script.stageSuggestions"
      :key="`stage-${index}`"
      class="effect-toggle"
    >
      <input :checked="suggestionEnabled('stage', index)" type="checkbox" @change="emit('set-suggestion-enabled', 'stage', index, checkedValueFromEvent($event))" />
      <span>{{ item.recipient === 'user' ? 'User' : 'Target' }}: {{ item.label }}</span>
      <small v-if="item.threshold">{{ item.threshold }}</small>
    </label>
    <details class="manual-details">
      <summary>Manual stage deltas</summary>
      <div class="stage-delta-grid">
        <div>
          <h4>User</h4>
          <label v-for="key in COMBAT_STAGE_KEYS" :key="`user-${key}`">
            <span>{{ COMBAT_STAGE_SHORT_LABELS[key] }}</span>
            <input :value="manualUserStageDeltas[key]" type="number" min="-6" max="6" @input="emit('set-user-stage-delta', key, finiteNumberFromEvent($event))" />
          </label>
        </div>
        <div>
          <h4>Selected target(s)</h4>
          <label v-for="key in COMBAT_STAGE_KEYS" :key="`target-${key}`">
            <span>{{ COMBAT_STAGE_SHORT_LABELS[key] }}</span>
            <input :value="manualTargetStageDeltas[key]" type="number" min="-6" max="6" @input="emit('set-target-stage-delta', key, finiteNumberFromEvent($event))" />
          </label>
        </div>
      </div>
    </details>
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

.move-resolution__section input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.65rem;
  font: inherit;
}

.effect-toggle,
.stage-delta-grid label {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.effect-toggle {
  padding: 0.35rem 0;
  color: var(--ink);
}

.effect-toggle small {
  color: var(--accent);
  font-weight: 800;
}

.manual-details {
  margin-top: 0.6rem;
  border-top: 1px solid var(--rule-soft);
  padding-top: 0.6rem;
}

.manual-details summary {
  cursor: pointer;
  color: var(--ink-bright);
  font-weight: 800;
}

.manual-condition-grid,
.stage-delta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.8rem;
  margin-top: 0.65rem;
}

.stage-delta-grid label {
  justify-content: space-between;
  margin-top: 0.3rem;
}

.stage-delta-grid input {
  max-width: 5rem;
}

@media (max-width: 760px) {
  .manual-condition-grid,
  .stage-delta-grid {
    grid-template-columns: 1fr;
  }
}
</style>
