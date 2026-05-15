<script setup lang="ts">
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { MoveAutomationMoveEntry } from '~/utils/moveAutomationMoves'

defineProps<{
  script: MoveAutomationScript
  selectedEntry: MoveAutomationMoveEntry | null
  selectedMoveFormula: string | null
}>()
</script>

<template>
  <aside class="move-summary">
    <div class="move-summary__heading">
      <h3>{{ script.moveName }}</h3>
      <div class="move-summary__pills">
        <TypeBadge :type="script.type" size="xs" />
        <DamageClassBadge v-if="script.damageClass" :category="script.damageClass" size="xs" />
        <span v-if="script.damageBase != null" class="move-card__badge">DB {{ script.damageBase }}</span>
        <span v-if="selectedEntry?.hasStab" class="move-card__badge move-card__badge--stab">STAB</span>
        <span v-if="script.ac != null" class="move-card__badge">AC {{ script.ac }}</span>
      </div>
    </div>
    <dl class="move-summary__stats">
      <div v-if="selectedEntry?.move.frequency"><dt>Frequency</dt><dd>{{ selectedEntry.move.frequency }}</dd></div>
      <div v-if="selectedMoveFormula"><dt>Damage Roll</dt><dd>{{ selectedMoveFormula }}</dd></div>
      <div v-if="script.range"><dt>Range</dt><dd>{{ script.range }}</dd></div>
      <div v-if="script.criticalRange"><dt>Crit</dt><dd>{{ script.criticalRange }}+</dd></div>
    </dl>
    <div v-if="script.kind === 'manual-fallback'" class="manual-fallback-warning">
      <strong>No explicit automation script exists for this move yet.</strong>
      <span>This wizard is only a manual resolver. It does not count as move automation coverage.</span>
    </div>
    <div v-else class="explicit-script-banner">
      Explicit reviewed script v{{ script.version }}.
    </div>
    <p v-if="script.effect" class="move-summary__effect">{{ script.effect }}</p>
    <p v-if="script.special" class="move-summary__effect"><strong>Special:</strong> {{ script.special }}</p>
    <p v-if="!script.effect && !script.special" class="move-summary__effect is-muted">No effect or special text in moves.json.</p>
  </aside>
</template>

<style scoped>
.move-summary {
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper);
}

.move-summary h3 {
  margin: 0;
}

.move-summary__heading {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: center;
}

.move-summary__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}

.move-card__badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.35rem;
  padding: 0.12rem 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
}

.move-card__badge--stab {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--rule-soft));
  color: var(--accent);
}

.move-summary__stats {
  display: grid;
  gap: 0.35rem;
  margin: 0.7rem 0;
}

.move-summary__stats div {
  display: grid;
  grid-template-columns: 6rem minmax(0, 1fr);
  gap: 0.45rem;
}

.move-summary__stats dt {
  color: var(--ink-muted);
  font-size: 0.74rem;
  font-weight: 800;
  text-transform: uppercase;
}

.move-summary__stats dd {
  margin: 0;
}

.manual-fallback-warning,
.explicit-script-banner {
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

.explicit-script-banner {
  border-color: color-mix(in srgb, #b8bb26 45%, var(--rule-soft));
  background: color-mix(in srgb, #b8bb26 9%, var(--paper));
  color: #b8bb26;
  font-weight: 800;
}

.move-summary__effect {
  color: var(--ink-muted);
  font-size: 0.84rem;
}
</style>
