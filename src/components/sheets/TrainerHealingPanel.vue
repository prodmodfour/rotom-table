<script setup lang="ts">
import { computed } from 'vue'
import {
  applyTrainerExtendedRest,
  applyTrainerFullRecovery,
  applyTrainerNextDay,
  clearSheetDailyMoveUsage,
  clearTrainerConditions,
  computeTrainerHealingVitals,
  healTrainerHp,
  healingFractionAmount,
  removeTrainerInjuries,
  restoreTrainerAp,
  setTrainerCurrentHp,
  setTrainerInjuries,
} from '~/utils/sheets/healing'
import type { TrainerSheet } from '~/types/trainerSheet'

const props = defineProps<{
  sheet: TrainerSheet
  currentHp: number
  maxHp: number
  fullMaxHp: number
  tickValue: number
  maxAp: number
}>()

const vitals = computed(() => computeTrainerHealingVitals(props.sheet))
const injuriesModel = computed({
  get: () => vitals.value.injuries,
  set: (value: unknown) => setTrainerInjuries(props.sheet, value),
})
const naturalRestHp = computed(() => vitals.value.naturalRestHp)
const quarterHp = computed(() => healingFractionAmount(props.fullMaxHp, 4))
const halfHp = computed(() => healingFractionAmount(props.fullMaxHp, 2))
const canHeal = computed(() => props.currentHp < props.maxHp)
const canRestHeal = computed(() => canHeal.value && vitals.value.injuries < 5)
const apLeft = computed(() => props.sheet.ap?.left ?? props.maxAp)
const apBound = computed(() => props.sheet.ap?.bound ?? 0)
const conditionCount = computed(() => {
  const conditions = Array.isArray(props.sheet.conditions) ? props.sheet.conditions.length : 0
  const freeform = typeof props.sheet.statusAfflictions === 'string' && props.sheet.statusAfflictions.trim()
    ? 1
    : 0
  return conditions + freeform
})

const heal = (amount: number) => healTrainerHp(props.sheet, amount)
const fullHeal = () => setTrainerCurrentHp(props.sheet, props.maxHp, props.maxHp)
const resetDailyMoves = () => clearSheetDailyMoveUsage(props.sheet)
const restoreAp = () => restoreTrainerAp(props.sheet, props.maxAp)
</script>

<template>
  <section class="panel-card healing-panel">
    <div class="healing-panel__heading">
      <div>
        <h2 class="panel-title">Healing</h2>
        <p class="healing-panel__lede">
          Rest, injury care, AP recovery, and daily move refresh controls for this Trainer.
        </p>
      </div>
      <button type="button" class="healing-button healing-button--primary" @click="applyTrainerNextDay(sheet)">
        Next day for this sheet
      </button>
    </div>

    <div class="healing-vitals" aria-label="Healing vitals">
      <div class="healing-vital healing-vital--hp">
        <span>Current HP</span>
        <strong>
          <EditableCell
            :model-value="currentHp"
            type="number"
            :max="maxHp"
            @update:model-value="(value) => setTrainerCurrentHp(sheet, value, maxHp)"
          />
        </strong>
      </div>
      <div class="healing-vital">
        <span>Max HP</span>
        <strong>{{ maxHp }}<small v-if="maxHp !== fullMaxHp">full {{ fullMaxHp }}</small></strong>
      </div>
      <div class="healing-vital">
        <span>Injuries</span>
        <strong><EditableCell v-model="injuriesModel" type="number" :min="0" :max="10" /></strong>
      </div>
      <div class="healing-vital">
        <span>Tick</span>
        <strong>{{ tickValue }}</strong>
      </div>
      <div class="healing-vital">
        <span>AP</span>
        <strong>{{ apLeft }} / {{ maxAp }}<small v-if="apBound">{{ apBound }} bound</small></strong>
      </div>
      <div class="healing-vital">
        <span>Daily moves spent</span>
        <strong>{{ vitals.dailyMoveUses }}<small>{{ vitals.dailyMoveCount }} move{{ vitals.dailyMoveCount === 1 ? '' : 's' }}</small></strong>
      </div>
    </div>

    <div class="healing-grid">
      <section class="healing-block">
        <h3>HP recovery</h3>
        <div class="healing-actions">
          <button type="button" class="healing-button" :disabled="!canRestHeal" @click="heal(naturalRestHp)">
            Rest 30m (+{{ naturalRestHp }})
          </button>
          <button type="button" class="healing-button" :disabled="!canHeal || tickValue <= 0" @click="heal(tickValue)">
            Heal tick (+{{ tickValue }})
          </button>
          <button type="button" class="healing-button" :disabled="!canHeal || quarterHp <= 0" @click="heal(quarterHp)">
            Heal 25% (+{{ quarterHp }})
          </button>
          <button type="button" class="healing-button" :disabled="!canHeal || halfHp <= 0" @click="heal(halfHp)">
            Heal 50% (+{{ halfHp }})
          </button>
          <button type="button" class="healing-button" :disabled="!canHeal" @click="fullHeal">
            Full HP
          </button>
        </div>
        <p v-if="vitals.injuries >= 5" class="healing-note healing-note--warning">
          Natural rest healing is blocked at 5+ Injuries until medical care lowers Injuries.
        </p>
      </section>

      <section class="healing-block">
        <h3>Injury care</h3>
        <div class="healing-actions">
          <button type="button" class="healing-button" :disabled="vitals.injuries <= 0" @click="removeTrainerInjuries(sheet, 1)">
            Remove 1 Injury
          </button>
          <button type="button" class="healing-button" :disabled="vitals.injuries <= 0" @click="removeTrainerInjuries(sheet, 3)">
            Remove up to 3
          </button>
          <button type="button" class="healing-button" :disabled="vitals.injuries <= 0" @click="setTrainerInjuries(sheet, 0)">
            Clear Injuries
          </button>
        </div>
        <p class="healing-note">
          Injury removal raises the effective HP cap by 10% of full Max HP per Injury.
        </p>
      </section>

      <section class="healing-block">
        <h3>Rest and daily resources</h3>
        <div class="healing-actions">
          <button type="button" class="healing-button" :disabled="vitals.dailyMoveUses <= 0" @click="resetDailyMoves">
            Reset Daily moves
          </button>
          <button type="button" class="healing-button" :disabled="conditionCount <= 0" @click="clearTrainerConditions(sheet)">
            Clear conditions
          </button>
          <button type="button" class="healing-button" :disabled="apLeft >= maxAp && !sheet.ap?.spent && !sheet.ap?.drained" @click="restoreAp">
            Restore AP
          </button>
          <button type="button" class="healing-button" @click="applyTrainerExtendedRest(sheet)">
            Extended Rest
          </button>
          <button type="button" class="healing-button healing-button--danger" @click="applyTrainerFullRecovery(sheet)">
            Full recovery
          </button>
        </div>
        <p class="healing-note">
          Extended Rest clears conditions and Daily move use, restores drained/spent AP, and restores HP when below 5 Injuries.
        </p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.healing-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.healing-panel__heading {
  display: flex;
  justify-content: space-between;
  gap: 0.85rem;
  align-items: flex-start;
}

.panel-title {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
}

.healing-panel__lede,
.healing-note {
  margin: 0.25rem 0 0;
  color: var(--ink-soft);
  font-size: 0.86rem;
  line-height: 1.45;
}

.healing-note--warning {
  color: #f2b67b;
}

.healing-vitals,
.healing-grid {
  display: grid;
  gap: 0.55rem;
}

.healing-vitals {
  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
}

.healing-grid {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.healing-vital,
.healing-block {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
}

.healing-vital {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  padding: 0.5rem 0.6rem;
}

.healing-vital--hp {
  border-color: var(--rule-strong);
  background: rgba(255, 255, 255, 0.12);
}

.healing-vital span,
.healing-block h3 {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.healing-vital strong {
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}

.healing-vital small {
  display: block;
  color: var(--ink-muted);
  font-family: var(--font-ui);
  font-size: 0.68rem;
  font-weight: 400;
  letter-spacing: 0.04em;
}

.healing-block {
  padding: 0.75rem;
}

.healing-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.55rem;
}

.healing-button {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-bright);
  cursor: pointer;
  font-weight: 700;
  letter-spacing: 0.035em;
  padding: 0.45rem 0.72rem;
  transition: background 0.12s, border-color 0.12s, color 0.12s, transform 0.12s;
}

.healing-button:hover:not(:disabled),
.healing-button:focus-visible:not(:disabled) {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.16);
  transform: translateY(-1px);
}

.healing-button--primary {
  background: rgba(var(--accent-rgb), 0.18);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--rule-soft));
}

.healing-button--danger {
  color: #ffb3b3;
  border-color: rgba(220, 80, 80, 0.4);
}

.healing-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 720px) {
  .healing-panel__heading {
    flex-direction: column;
  }
}
</style>
