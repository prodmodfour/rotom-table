<script setup lang="ts">
import { computed } from 'vue'
import { PhBandaids, PhClock, PhHeartbeat, PhHourglass, PhWarning } from '@phosphor-icons/vue'
import type { ItemMedicalTreatmentProjectionV1 } from '#shared/itemAutomation/medicalTreatments'

const props = defineProps<{
  treatments: readonly ItemMedicalTreatmentProjectionV1[] | undefined
}>()

const treatment = computed(() => {
  const rows = props.treatments ?? []
  return rows.find(row => row.status === 'active') ?? rows.at(-1) ?? null
})
const duration = computed(() => treatment.value
  ? Math.max(0, treatment.value.endsAtCampaignMinute - treatment.value.appliedAtCampaignMinute)
  : 360)
const settledMinute = computed(() => treatment.value
  ? treatment.value.appliedAtCampaignMinute + treatment.value.elapsedMinutes
  : 0)
const title = computed(() => treatment.value?.status === 'active'
  ? 'Bandages active'
  : treatment.value?.status === 'completed'
    ? 'Bandages completed'
    : 'Bandages stopped')
const statusClass = computed(() => `medical-treatment--${treatment.value?.status ?? 'active'}`)
</script>

<template>
  <aside
    v-if="treatment"
    class="medical-treatment"
    :class="statusClass"
    :aria-label="title"
  >
    <div class="medical-treatment__header">
      <PhClock v-if="treatment.status === 'active'" :size="25" weight="bold" aria-hidden="true" />
      <PhBandaids v-else :size="25" weight="bold" aria-hidden="true" />
      <div>
        <p>Medical treatment</p>
        <h3>{{ title }}</h3>
      </div>
    </div>

    <template v-if="treatment.status === 'active'">
      <dl class="medical-treatment__facts">
        <div>
          <dt><PhClock :size="18" aria-hidden="true" /> Campaign time</dt>
          <dd>Minute {{ settledMinute }} → {{ treatment.endsAtCampaignMinute }}</dd>
        </div>
        <div class="medical-treatment__progress-row">
          <dt><PhHourglass :size="18" aria-hidden="true" /> Settled progress</dt>
          <dd class="medical-treatment__progress-value">
            <span>{{ treatment.elapsedMinutes }} of {{ duration }} minutes</span>
            <progress :value="treatment.elapsedMinutes" :max="duration">{{ treatment.elapsedMinutes }} of {{ duration }}</progress>
          </dd>
        </div>
        <div>
          <dt>Half-hour boundaries</dt>
          <dd>{{ treatment.ticksApplied }} / 12</dd>
        </div>
        <div>
          <dt><PhHeartbeat :size="18" aria-hidden="true" /> HP restored</dt>
          <dd>{{ treatment.hitPointsRestored }}</dd>
        </div>
        <div>
          <dt><PhBandaids :size="18" aria-hidden="true" /> Full duration</dt>
          <dd>1 Injury · daily limit applies</dd>
        </div>
      </dl>
      <p class="medical-treatment__warning">
        <PhWarning :size="20" weight="fill" aria-hidden="true" />
        <span>Any HP loss stops this treatment.</span>
      </p>
    </template>
    <p v-else class="medical-treatment__terminal" role="status">
      {{ treatment.terminalMessage }}
    </p>
  </aside>
</template>

<style scoped>
.medical-treatment {
  --treatment-signal: var(--rt-pending);
  display: grid;
  gap: 0.8rem;
  border: 1px solid var(--rule-strong);
  border-left: 4px solid var(--treatment-signal);
  padding: 0.9rem 1rem;
  background: var(--paper-soft);
  color: var(--ink);
  box-shadow: var(--shadow-card);
}

.medical-treatment--completed { --treatment-signal: var(--rt-success); }
.medical-treatment--cancelled { --treatment-signal: var(--rt-danger); }

.medical-treatment__header {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  color: var(--treatment-signal);
}

.medical-treatment__header p,
.medical-treatment__header h3 { margin: 0; }
.medical-treatment__header p {
  color: var(--ink-muted);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.medical-treatment__header h3 {
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1rem;
  letter-spacing: 0.04em;
}

.medical-treatment__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  background: var(--rule);
  border: 1px solid var(--rule);
}
.medical-treatment__facts > div {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
  padding: 0.7rem 0.75rem;
  background: var(--paper-inset);
}
.medical-treatment__facts dt {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--ink-muted);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.medical-treatment__facts dd {
  margin: 0;
  color: var(--ink-bright);
  font-size: 0.86rem;
  font-weight: 700;
}
.medical-treatment__progress-row { grid-column: 1 / -1; }
.medical-treatment__progress-value {
  display: grid;
  gap: 0.4rem;
}
.medical-treatment__progress-row progress {
  width: 100%;
  height: 0.35rem;
  border: 0;
  border-radius: 0;
  overflow: hidden;
  color: var(--rt-pending);
  background: var(--paper-hover);
}
.medical-treatment__progress-row progress::-webkit-progress-bar { background: var(--paper-hover); }
.medical-treatment__progress-row progress::-webkit-progress-value { background: var(--rt-pending); }
.medical-treatment__progress-row progress::-moz-progress-bar { background: var(--rt-pending); }

.medical-treatment__warning,
.medical-treatment__terminal {
  margin: 0;
  border: 1px solid color-mix(in srgb, var(--treatment-signal) 55%, var(--rule));
  padding: 0.7rem 0.8rem;
  color: var(--treatment-signal);
  font-size: 0.82rem;
  font-weight: 700;
  line-height: 1.4;
}
.medical-treatment__warning {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

@media (max-width: 46rem) {
  .medical-treatment__facts { grid-template-columns: 1fr; }
  .medical-treatment__progress-row { grid-column: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .medical-treatment progress { transition: none; }
}
</style>
