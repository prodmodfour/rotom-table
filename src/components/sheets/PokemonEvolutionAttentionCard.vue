<script setup lang="ts">
import { computed } from 'vue'
import {
  PhArrowRight,
  PhCheckCircle,
  PhShieldWarning,
  PhSparkle,
  PhWarning,
} from '@phosphor-icons/vue'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SaveStatus } from '~/composables/useEditableSheet'

const props = withDefaults(defineProps<{
  sheet: CharacterSheet
  statPointsSpent: number
  statPointsBudget: number
  statPointsLeft: number
  saveStatus?: SaveStatus
}>(), {
  saveStatus: 'idle',
})

const attention = computed(() => props.sheet.itemEvolutionAttention ?? null)
const allocationCompleteLocally = computed(() => Boolean(attention.value)
  && props.statPointsSpent === attention.value!.statAllocation.required
  && props.statPointsLeft === 0)
const allocationTone = computed(() => attention.value?.statAllocation.status === 'resolved'
  ? 'resolved'
  : allocationCompleteLocally.value ? 'ready' : 'open')
const allocationMessage = computed(() => {
  const value = attention.value
  if (!value) return ''
  if (value.statAllocation.status === 'resolved') return `${value.statAllocation.allocated} Stat Points allocated`
  if (allocationCompleteLocally.value) {
    return props.saveStatus === 'saving'
      ? 'Certifying the exact allocation…'
      : `All ${value.statAllocation.required} Stat Points allocated · save to certify`
  }
  return `${props.statPointsSpent} / ${value.statAllocation.required} Stat Points allocated`
})
</script>

<template>
  <section
    v-if="attention"
    class="panel-card evolution-attention"
    :class="`evolution-attention--${allocationTone}`"
    aria-labelledby="evolution-attention-title"
  >
    <header class="evolution-attention__header">
      <div class="evolution-attention__heading">
        <PhSparkle :size="24" weight="fill" aria-hidden="true" />
        <div>
          <p>{{ attention.statAllocation.status === 'resolved' ? 'Evolution record' : 'Follow-up required' }}</p>
          <h2 id="evolution-attention-title">
            {{ attention.fromSpecies }}
            <PhArrowRight :size="19" weight="bold" aria-hidden="true" />
            {{ attention.toSpecies }}
          </h2>
        </div>
      </div>
      <span class="evolution-attention__item">{{ attention.canonicalItemName }}</span>
    </header>

    <div class="evolution-attention__work-grid">
      <article class="evolution-attention__work" :class="`is-${allocationTone}`">
        <component
          :is="attention.statAllocation.status === 'resolved' ? PhCheckCircle : allocationCompleteLocally ? PhCheckCircle : PhWarning"
          :size="21"
          :weight="attention.statAllocation.status === 'resolved' || allocationCompleteLocally ? 'fill' : 'bold'"
          aria-hidden="true"
        />
        <div>
          <h3>Stat allocation</h3>
          <p aria-live="polite">{{ allocationMessage }}</p>
          <small v-if="attention.statAllocation.status === 'open'">
            Allocate the full {{ attention.statAllocation.required }}-point budget below while preserving Base Relations.
          </small>
        </div>
      </article>

      <article class="evolution-attention__work" :class="attention.moveOpportunities.length ? 'is-open' : 'is-resolved'">
        <PhWarning v-if="attention.moveOpportunities.length" :size="21" weight="bold" aria-hidden="true" />
        <PhCheckCircle v-else :size="21" weight="fill" aria-hidden="true" />
        <div>
          <h3>New-form Moves</h3>
          <p v-if="!attention.moveOpportunities.length">No new Move decision</p>
          <template v-else>
            <p>{{ attention.moveOpportunities.length }} bounded Move {{ attention.moveOpportunities.length === 1 ? 'opportunity' : 'opportunities' }}</p>
            <ul>
              <li v-for="move in attention.moveOpportunities" :key="move">{{ move }}</li>
            </ul>
          </template>
        </div>
      </article>
    </div>

    <details v-if="attention.abilityChanges.length || attention.inactiveEquipmentItems.length" class="evolution-attention__details">
      <summary>Evolution changes</summary>
      <dl>
        <div v-if="attention.abilityChanges.length">
          <dt>Abilities</dt>
          <dd>{{ attention.abilityChanges.map(change => `${change.from} → ${change.to}`).join(', ') }}</dd>
        </div>
        <div v-if="attention.inactiveEquipmentItems.length">
          <dt><PhShieldWarning :size="17" weight="bold" aria-hidden="true" /> Equipment needs review</dt>
          <dd>{{ attention.inactiveEquipmentItems.join(', ') }}</dd>
        </div>
      </dl>
    </details>
  </section>
</template>

<style scoped>
.evolution-attention {
  --evolution-signal: var(--rt-pending);
  border-left: 4px solid var(--evolution-signal);
  padding: 0;
  overflow: hidden;
}

.evolution-attention--ready { --evolution-signal: var(--rt-focus); }
.evolution-attention--resolved { --evolution-signal: var(--rt-success); }

.evolution-attention__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--rule);
  padding: 0.9rem 1rem;
}

.evolution-attention__heading {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  color: var(--evolution-signal);
}

.evolution-attention__heading p {
  margin: 0 0 0.15rem;
  color: var(--ink-muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.evolution-attention__heading h2 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.25rem;
}

.evolution-attention__item {
  border: 1px solid color-mix(in srgb, var(--evolution-signal) 52%, var(--rule));
  border-radius: 999px;
  padding: 0.22rem 0.6rem;
  color: var(--evolution-signal);
  font-size: 0.72rem;
  white-space: nowrap;
}

.evolution-attention__work-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  padding: 0.9rem 1rem;
}

.evolution-attention__work {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.55rem;
  border: 1px solid var(--rule);
  background: var(--paper-inset);
  padding: 0.75rem;
  color: var(--ink-soft);
}

.evolution-attention__work.is-open { color: var(--rt-pending); }
.evolution-attention__work.is-ready { color: var(--rt-focus); }
.evolution-attention__work.is-resolved { color: var(--rt-success); }

.evolution-attention__work h3,
.evolution-attention__work p {
  margin: 0;
}

.evolution-attention__work h3 {
  color: var(--ink-bright);
  font-size: 0.86rem;
}

.evolution-attention__work p,
.evolution-attention__work small,
.evolution-attention__work li {
  color: var(--ink-soft);
  line-height: 1.4;
}

.evolution-attention__work p { margin-top: 0.18rem; font-size: 0.8rem; }
.evolution-attention__work small { display: block; margin-top: 0.3rem; font-size: 0.72rem; }
.evolution-attention__work ul { margin: 0.3rem 0 0; padding-left: 1.1rem; font-size: 0.76rem; }

.evolution-attention__details {
  border-top: 1px solid var(--rule);
  padding: 0.75rem 1rem 0.9rem;
}

.evolution-attention__details summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  color: var(--ink-bright);
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
}

.evolution-attention__details dl,
.evolution-attention__details div { margin: 0; }
.evolution-attention__details div { display: grid; grid-template-columns: minmax(7rem, 0.3fr) 1fr; gap: 0.75rem; border-top: 1px solid var(--rule-soft); padding: 0.55rem 0; }
.evolution-attention__details dt { display: flex; align-items: center; gap: 0.35rem; color: var(--ink-muted); font-size: 0.75rem; }
.evolution-attention__details dd { margin: 0; color: var(--ink-soft); font-size: 0.78rem; }

@media (max-width: 720px) {
  .evolution-attention__header { align-items: stretch; flex-direction: column; }
  .evolution-attention__item { width: fit-content; }
  .evolution-attention__work-grid { grid-template-columns: 1fr; }
  .evolution-attention__details div { grid-template-columns: 1fr; gap: 0.25rem; }
}
</style>
