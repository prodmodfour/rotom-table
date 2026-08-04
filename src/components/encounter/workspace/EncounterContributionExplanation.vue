<script setup lang="ts">
import { computed } from 'vue'
import type { EncounterContributionExplanation, EncounterDerivedFactValue } from '#shared/encounterPresentation/contracts'

const props = withDefaults(defineProps<{
  explanation: EncounterContributionExplanation
  open?: boolean
}>(), { open: false })

const valueLabel = (value: EncounterDerivedFactValue | null): string => {
  if (!value) return '—'
  if (value.kind === 'number') return `${value.numberValue ?? '—'}${value.unit ? ` ${value.unit}` : ''}`
  if (value.kind === 'boolean') return value.booleanValue ? 'Yes' : 'No'
  return `${value.textValue ?? '—'}${value.unit ? ` ${value.unit}` : ''}`
}
const result = computed(() => valueLabel(props.explanation.result))
</script>

<template>
  <details class="encounter-contribution-explanation" :open="open">
    <summary>
      <span>{{ explanation.label }}</span>
      <strong class="rt-numeric">{{ result }}</strong>
    </summary>
    <ol>
      <li
        v-for="row in [...explanation.contributions].sort((left, right) => left.order - right.order || left.contributionId.localeCompare(right.contributionId))"
        :key="row.contributionId"
        :data-applied="row.applied"
      >
        <span class="encounter-contribution-explanation__operator" aria-hidden="true">{{ row.kind }}</span>
        <span>
          <strong>{{ row.label }}</strong>
          <small v-if="row.source">{{ row.source.displayName }}</small>
          <small v-if="row.preventionReason">{{ row.preventionReason.label }}</small>
          <small v-else-if="!row.applied">Not applied</small>
        </span>
        <span class="rt-numeric">{{ valueLabel(row.value) }}</span>
      </li>
    </ol>
  </details>
</template>

<style scoped>
.encounter-contribution-explanation { border-top: 1px solid var(--rt-rule); }
.encounter-contribution-explanation > summary { min-height: var(--rt-touch-minimum); display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; cursor: pointer; font-weight: 700; }
.encounter-contribution-explanation ol { display: grid; gap: 0.25rem; margin: 0; padding: 0 0 0.5rem; list-style: none; }
.encounter-contribution-explanation li { display: grid; grid-template-columns: 4rem minmax(0, 1fr) auto; align-items: center; gap: 0.45rem; padding: 0.4rem; border-radius: var(--rt-radius-small); background: var(--rt-surface-2); }
.encounter-contribution-explanation li[data-applied='false'] { opacity: 0.7; text-decoration-color: var(--rt-danger); }
.encounter-contribution-explanation__operator { color: var(--rt-info); font-size: var(--rt-type-meta-xs-size); font-weight: 800; text-transform: uppercase; }
.encounter-contribution-explanation li strong,
.encounter-contribution-explanation li small { display: block; }
.encounter-contribution-explanation li small { color: var(--rt-text-muted); }
</style>
