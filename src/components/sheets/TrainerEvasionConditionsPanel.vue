<script setup lang="ts">
import {
  EVASION_BONUS_MAX,
  EVASION_BONUS_MIN,
  formatSignedModifier,
} from '~/utils/evasion'
import type { TrainerEvasionBonusKey } from '~/composables/sheets/useTrainerSheetRowActions'
import type { SheetAccuracySummary } from '~/utils/sheetAccuracy'
import type { ConditionEffectSummary } from '~/utils/sheetConditionEffects'

type TrainerEvasionEntry = {
  total: number
  base: number
  bonus: number
  suppressedByCondition?: string | null
}

type TrainerEvasionSummary = {
  speed: TrainerEvasionEntry
  physical: TrainerEvasionEntry
  special: TrainerEvasionEntry
}

defineProps<{
  trainerEvasion: TrainerEvasionSummary
  trainerAccuracy: SheetAccuracySummary
  conditionEffects: readonly ConditionEffectSummary[]
  availableMoves?: string[]
}>()

const conditions = defineModel<string[] | undefined>('conditions', { required: true })
const digestion = defineModel<string | undefined>('digestion', { required: true })

const emit = defineEmits<{
  setEvasionBonus: [key: TrainerEvasionBonusKey, value: number | undefined]
  setAccuracyStage: [value: unknown]
}>()
</script>

<template>
  <div class="block">
    <h2 class="block-title">Evasion</h2>
    <ul class="kv-list evasion-list">
      <li title="Stat evasion = floor(Speed Total / 5), capped at +6 from stats.">
        <span class="evasion-list__label">
          Speed Evasion
          <small>stat {{ trainerEvasion.speed.base }}</small>
        </span>
        <span class="evasion-list__value">
          <strong>{{ trainerEvasion.speed.total }}</strong>
          <span class="evasion-list__bonus">
            bonus
            <EditableCell
              :model-value="trainerEvasion.speed.bonus"
              type="number"
              :min="EVASION_BONUS_MIN"
              :max="EVASION_BONUS_MAX"
              :format="formatSignedModifier"
              @update:model-value="(v) => emit('setEvasionBonus', 'speedBonus', v as number | undefined)"
            />
            <span
              v-if="trainerEvasion.speed.suppressedByCondition"
              class="evasion-list__condition"
              :title="`${trainerEvasion.speed.suppressedByCondition} prevents this Evasion from applying`"
            >
              suppressed by {{ trainerEvasion.speed.suppressedByCondition }}
            </span>
          </span>
        </span>
      </li>
      <li title="Stat evasion = floor(Defense Total / 5), capped at +6 from stats.">
        <span class="evasion-list__label">
          Physical Evasion
          <small>stat {{ trainerEvasion.physical.base }}</small>
        </span>
        <span class="evasion-list__value">
          <strong>{{ trainerEvasion.physical.total }}</strong>
          <span class="evasion-list__bonus">
            bonus
            <EditableCell
              :model-value="trainerEvasion.physical.bonus"
              type="number"
              :min="EVASION_BONUS_MIN"
              :max="EVASION_BONUS_MAX"
              :format="formatSignedModifier"
              @update:model-value="(v) => emit('setEvasionBonus', 'physicalBonus', v as number | undefined)"
            />
            <span
              v-if="trainerEvasion.physical.suppressedByCondition"
              class="evasion-list__condition"
              :title="`${trainerEvasion.physical.suppressedByCondition} prevents this Evasion from applying`"
            >
              suppressed by {{ trainerEvasion.physical.suppressedByCondition }}
            </span>
          </span>
        </span>
      </li>
      <li title="Stat evasion = floor(Special Defense Total / 5), capped at +6 from stats.">
        <span class="evasion-list__label">
          Special Evasion
          <small>stat {{ trainerEvasion.special.base }}</small>
        </span>
        <span class="evasion-list__value">
          <strong>{{ trainerEvasion.special.total }}</strong>
          <span class="evasion-list__bonus">
            bonus
            <EditableCell
              :model-value="trainerEvasion.special.bonus"
              type="number"
              :min="EVASION_BONUS_MIN"
              :max="EVASION_BONUS_MAX"
              :format="formatSignedModifier"
              @update:model-value="(v) => emit('setEvasionBonus', 'specialBonus', v as number | undefined)"
            />
            <span
              v-if="trainerEvasion.special.suppressedByCondition"
              class="evasion-list__condition"
              :title="`${trainerEvasion.special.suppressedByCondition} prevents this Evasion from applying`"
            >
              suppressed by {{ trainerEvasion.special.suppressedByCondition }}
            </span>
          </span>
        </span>
      </li>
    </ul>
    <p
      class="accuracy-line"
      title="Accuracy Roll modifier = Accuracy Combat Stage + condition modifiers + passive ability bonuses such as No Guard. A natural 1 still always misses."
    >
      <strong>Accuracy Rolls:</strong>
      <span class="accuracy-line__total">{{ formatSignedModifier(trainerAccuracy.total) }}</span>
      <small class="accuracy-line__stage">
        stage
        <EditableCell
          :model-value="trainerAccuracy.stage"
          type="number"
          :min="-6"
          :max="6"
          :format="formatSignedModifier"
          @update:model-value="(v) => emit('setAccuracyStage', v)"
        />
      </small>
      <small v-if="trainerAccuracy.conditionModifier" class="accuracy-line__condition">
        condition {{ formatSignedModifier(trainerAccuracy.conditionModifier) }}
      </small>
      <small v-if="trainerAccuracy.abilityBonus" class="accuracy-line__ability">
        ability {{ formatSignedModifier(trainerAccuracy.abilityBonus) }}
      </small>
    </p>
    <div class="muted condition-block">
      <strong>Conditions:</strong>
      <ConditionPicker v-model="conditions" :available-moves="availableMoves" />
      <ul v-if="conditionEffects.length" class="condition-effects" aria-label="Condition effects">
        <li v-for="effect in conditionEffects" :key="effect.id">
          <strong>{{ effect.label }}:</strong> {{ effect.description }}
        </li>
      </ul>
    </div>
    <p class="muted">
      <strong>Digestion:</strong>
      <EditableCell v-model="digestion" placeholder="—" />
    </p>
  </div>
</template>

<style scoped>
.block {
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.7rem 0.85rem;
}

.block-title {
  margin: 0 0 0.5rem;
  font-family: var(--font-book);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.muted { color: var(--ink-muted); font-size: 0.85rem; }

.kv-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.kv-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.28rem 0;
  border-bottom: 1px dashed var(--rule);
  font-size: 0.88rem;
}

.kv-list li:last-child { border-bottom: 0; }

.evasion-list li {
  align-items: flex-start;
}

.evasion-list__label {
  display: inline-flex;
  flex-direction: column;
  gap: 0.08rem;
}

.evasion-list__label small,
.evasion-list__bonus {
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 400;
}

.evasion-list__value {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
}

.evasion-list__condition {
  color: var(--bad);
  font-weight: 700;
}

.evasion-list__value strong {
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
}

.accuracy-line {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0.55rem 0;
  color: var(--ink-muted);
  font-size: 0.85rem;
}

.accuracy-line > strong,
.accuracy-line__total {
  color: var(--ink-bright);
  font-weight: 800;
}

.accuracy-line__stage {
  display: inline-flex;
  align-items: baseline;
  gap: 0.2rem;
}

.accuracy-line__condition {
  color: var(--bad);
  font-weight: 700;
}

.accuracy-line__ability {
  color: var(--accent);
  font-weight: 700;
}

.condition-block {
  display: grid;
  gap: 0.45rem;
  margin: 0.55rem 0;
}

.condition-block > strong { color: var(--ink-bright); }

.condition-effects {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--ink-soft);
  font-size: 0.8rem;
}

.condition-effects li + li { margin-top: 0.25rem; }

.condition-effects strong { color: var(--ink-bright); }
</style>
