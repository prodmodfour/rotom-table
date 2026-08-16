<script setup lang="ts">
import { useId } from 'vue'
import type {
  EquipmentContributionOperation,
  EquipmentContributionProjectionSourceV1,
  EquipmentContributionProjectionV1,
} from '#shared/itemAutomation/equipmentContributions'

defineProps<{
  projection: EquipmentContributionProjectionV1
}>()

const titleId = useId()

const signed = (value: number): string => value > 0 ? `+${value}` : String(value)
const sourceValue = (source: EquipmentContributionProjectionSourceV1): string => {
  if (source.operation === 'multiply-floor') return `×${source.value}`
  if (source.operation === 'set') return `Set ${signed(source.value)}`
  return source.applied === source.value
    ? signed(source.applied)
    : `${signed(source.applied)} of ${signed(source.value)}`
}
const declaredSourceValue = (source: EquipmentContributionProjectionSourceV1): string => {
  if (source.operation === 'multiply-floor') return `×${source.value}`
  if (source.operation === 'set') return `Set ${signed(source.value)}`
  return signed(source.value)
}
const operationLabel = (operation: EquipmentContributionOperation): string => ({
  add: 'adds',
  set: 'sets',
  'multiply-floor': 'multiplies and rounds down by',
})[operation]
const accessibleSummary = (value: EquipmentContributionProjectionV1['values'][number]): string => {
  const sources = value.sources.map(source => (
    `${source.sourceLabel} ${operationLabel(source.operation)} ${source.value}`
      + (source.cap === null ? '' : `, capped at ${source.cap}`)
      + (source.conditionLabels.length === 0 ? '' : `, when ${source.conditionLabels.join(' and ')}`)
  )).join('; ')
  return `${value.label}. Base ${value.base}. ${sources}. Final ${value.final}.`
}
</script>

<template>
  <section class="equipment-contribution-inspector" :aria-labelledby="titleId">
    <header class="equipment-contribution-header">
      <div>
        <h2 :id="titleId">Effective values</h2>
        <p>Active equipment only</p>
      </div>
      <span class="equipment-contribution-count">
        {{ projection.values.length }} {{ projection.values.length === 1 ? 'value' : 'values' }}
      </span>
    </header>

    <p v-if="projection.values.length === 0" class="equipment-contribution-empty">
      No current equipment contribution changes a supported effective value.
    </p>

    <div v-else class="equipment-contribution-list">
      <details
        v-for="value in projection.values"
        :key="value.metricId"
        class="equipment-contribution-row"
        :class="{ 'equipment-contribution-row--conflict': value.conflict }"
        open
      >
        <summary>
          <strong>{{ value.label }}</strong>
          <span class="equipment-contribution-final">
            <small>Final</small>
            <b>{{ signed(value.final) }}</b>
          </span>
        </summary>

        <div
          v-if="!value.conflict"
          class="equipment-contribution-equation"
          :aria-label="accessibleSummary(value)"
        >
          <span class="equipment-contribution-term">
            <small>Base</small>
            <b>{{ signed(value.base) }}</b>
          </span>
          <template v-for="source in value.sources" :key="source.contributionId">
            <span class="equipment-contribution-arrow" aria-hidden="true">→</span>
            <span class="equipment-contribution-term equipment-contribution-source">
              <small>{{ source.sourceLabel }}</small>
              <b>{{ sourceValue(source) }}</b>
              <em v-if="source.conditionLabels.length">{{ source.conditionLabels.join(' · ') }}</em>
            </span>
            <template v-if="source.cap !== null">
              <span class="equipment-contribution-arrow" aria-hidden="true">→</span>
              <span class="equipment-contribution-term">
                <small>Cap</small>
                <b>{{ signed(source.cap) }}</b>
              </span>
            </template>
          </template>
          <span class="equipment-contribution-arrow" aria-hidden="true">→</span>
          <span class="equipment-contribution-term equipment-contribution-term--final">
            <small>Final</small>
            <b>{{ signed(value.final) }}</b>
          </span>
        </div>
        <div v-else class="equipment-contribution-conflict" role="status">
          <p>{{ value.unavailableReason }} Refresh or change the conflicting equipment before relying on this value.</p>
          <ul aria-label="Conflicting equipment sources">
            <li v-for="source in value.sources" :key="source.contributionId">
              <strong>{{ source.sourceLabel }}</strong>
              <span>{{ declaredSourceValue(source) }}</span>
              <small v-if="source.conditionLabels.length">{{ source.conditionLabels.join(' · ') }}</small>
            </li>
          </ul>
        </div>
      </details>
    </div>

    <p v-if="projection.inactiveSourceCount > 0" class="equipment-contribution-inactive" role="status">
      {{ projection.inactiveSourceCount }} inactive {{ projection.inactiveSourceCount === 1 ? 'source contributes' : 'sources contribute' }} no values.
    </p>
    <p class="equipment-contribution-footnote">Calculated from active equipment.</p>
  </section>
</template>

<style scoped>
.equipment-contribution-inspector {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  padding: 1rem 1rem 0.85rem 1.15rem;
}

.equipment-contribution-inspector::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--accent);
  content: '';
}

.equipment-contribution-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.8rem;
}

.equipment-contribution-header h2 {
  margin: 0;
  color: var(--ink-bright);
  font-size: 1.05rem;
}

.equipment-contribution-header p,
.equipment-contribution-footnote,
.equipment-contribution-empty,
.equipment-contribution-inactive {
  margin: 0.2rem 0 0;
  color: var(--ink-muted);
  font-size: 0.76rem;
}

.equipment-contribution-count {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  padding: 0.2rem 0.45rem;
  color: var(--ink-soft);
  font-size: 0.68rem;
  white-space: nowrap;
}

.equipment-contribution-list {
  display: grid;
  gap: 0.5rem;
}

.equipment-contribution-row {
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-soft);
}

.equipment-contribution-row summary {
  display: flex;
  min-height: 2.75rem;
  cursor: pointer;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.65rem;
  color: var(--ink-bright);
}

.equipment-contribution-row summary:focus-visible {
  border-radius: 7px;
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.equipment-contribution-final {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  color: var(--good);
  font-variant-numeric: tabular-nums;
}

.equipment-contribution-final small,
.equipment-contribution-term small {
  color: var(--ink-muted);
  font-size: 0.66rem;
  font-weight: 600;
}

.equipment-contribution-equation {
  display: flex;
  min-height: 3rem;
  align-items: center;
  gap: 0.45rem;
  overflow-x: auto;
  border-top: 1px solid var(--rule-soft);
  padding: 0.55rem 0.65rem 0.65rem;
  scrollbar-width: thin;
}

.equipment-contribution-term {
  display: grid;
  min-width: 3.4rem;
  gap: 0.1rem;
  font-variant-numeric: tabular-nums;
}

.equipment-contribution-term b {
  color: var(--ink-bright);
  font-size: 1rem;
}

.equipment-contribution-term em {
  max-width: 10rem;
  color: var(--ink-muted);
  font-size: 0.61rem;
  font-style: normal;
  line-height: 1.25;
}

.equipment-contribution-source {
  min-width: 6rem;
}

.equipment-contribution-term--final b {
  color: var(--good);
}

.equipment-contribution-arrow {
  color: var(--ink-muted);
  font-size: 1rem;
}

.equipment-contribution-row--conflict {
  border-color: var(--warn);
}

.equipment-contribution-conflict {
  border-top: 1px solid var(--rule-soft);
  padding: 0.55rem 0.65rem;
  color: var(--warn);
  font-size: 0.76rem;
}

.equipment-contribution-conflict p {
  margin: 0;
}

.equipment-contribution-conflict ul {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
}

.equipment-contribution-conflict li {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  padding: 0.25rem 0.4rem;
  color: var(--ink);
}

.equipment-contribution-conflict li span {
  color: var(--warn);
  font-variant-numeric: tabular-nums;
}

.equipment-contribution-inactive {
  padding-top: 0.65rem;
}

.equipment-contribution-footnote {
  margin-top: 0.7rem;
  border-top: 1px solid var(--rule-soft);
  padding-top: 0.6rem;
}

@media (max-width: 720px) {
  .equipment-contribution-equation {
    align-items: stretch;
  }

  .equipment-contribution-term {
    min-width: 4.5rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .equipment-contribution-row summary {
    scroll-behavior: auto;
  }
}
</style>
