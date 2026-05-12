<script setup lang="ts">
import { COMBAT_STAGE_KEYS, COMBAT_STAGE_SHORT_LABELS } from '~/utils/combatStages'
import { stageDeltaLabel } from '~/utils/moveAutomationDialog'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const props = defineProps<{
  transaction: MoveAutomationTransaction
  allTokens: SpawnedPokemon[]
}>()

const tokenLabel = (id: string): string =>
  props.allTokens.find((token) => token.id === id)?.species ?? id
</script>

<template>
  <div class="move-automation__review">
    <h3>Transaction preview</h3>
    <div v-if="transaction.scriptKind === 'manual-fallback'" class="manual-fallback-warning manual-fallback-warning--review">
      <strong>Manual fallback transaction.</strong>
      <span>Review carefully; this was not produced by an explicit per-move script.</span>
    </div>
    <div class="review-grid">
      <section>
        <h4>HP</h4>
        <p v-if="!transaction.hpUpdates.length" class="muted">No HP changes.</p>
        <ul v-else>
          <li v-for="update in transaction.hpUpdates" :key="`hp-${update.id}`">
            {{ tokenLabel(update.id) }} → {{ update.currentHp }} HP
          </li>
        </ul>
      </section>
      <section>
        <h4>Conditions</h4>
        <p v-if="!transaction.conditionUpdates.length" class="muted">No condition changes.</p>
        <ul v-else>
          <li v-for="update in transaction.conditionUpdates" :key="`cond-${update.id}`">
            {{ tokenLabel(update.id) }}: {{ update.conditions.join(', ') || 'none' }}
          </li>
        </ul>
      </section>
      <section>
        <h4>Combat stages</h4>
        <p v-if="!transaction.combatStageUpdates.length" class="muted">No combat stage changes.</p>
        <ul v-else>
          <li v-for="update in transaction.combatStageUpdates" :key="`stage-${update.id}`">
            {{ tokenLabel(update.id) }}:
            <span v-for="key in COMBAT_STAGE_KEYS" :key="key">
              {{ COMBAT_STAGE_SHORT_LABELS[key] }} {{ stageDeltaLabel(update.stages[key]) }}
            </span>
          </li>
        </ul>
      </section>
      <section>
        <h4>Map</h4>
        <p v-if="!transaction.hazardsToAdd.length && !transaction.fieldEffectsToApply.length" class="muted">No map effects.</p>
        <ul v-else>
          <li v-for="effect in transaction.fieldEffectsToApply" :key="`${effect.kind}-${effect.value}`">{{ effect.kind }}: {{ effect.value }}</li>
          <li v-for="(hazard, index) in transaction.hazardsToAdd" :key="`hazard-${index}`">{{ hazard.kind }} at {{ hazard.x }},{{ hazard.y }},{{ hazard.z }}</li>
        </ul>
      </section>
    </div>
    <section class="review-log">
      <h4>Log</h4>
      <ul>
        <li v-for="line in transaction.logLines" :key="line">{{ line }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.move-automation__review {
  min-height: 0;
  overflow: auto;
  padding: 1rem;
}

.move-automation__review h3,
.review-grid h4,
.review-log h4 {
  margin: 0;
}

.manual-fallback-warning {
  display: grid;
  gap: 0.2rem;
  margin: 0.7rem 0;
  padding: 0.65rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--rule-soft));
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 10%, var(--paper));
  color: var(--ink);
  font-size: 0.84rem;
}

.manual-fallback-warning--review {
  margin-top: 0;
}

.muted {
  color: var(--ink-muted);
  font-size: 0.84rem;
}

.review-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.8rem;
  margin-top: 0.65rem;
}

.review-grid section,
.review-log {
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper);
}

.review-log {
  margin-top: 0.8rem;
}

.review-grid ul,
.review-log ul {
  margin: 0.45rem 0 0;
  padding-left: 1.1rem;
}
</style>
