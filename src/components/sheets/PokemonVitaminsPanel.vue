<script setup lang="ts">
import { computed } from 'vue'
import { formatSignedModifier } from '~/utils/evasion'
import {
  POKEMON_RARE_CANDY_LIMIT,
  POKEMON_VITAMIN_LIMIT,
  POKEMON_VITAMIN_STAT_ITEMS,
  type PokemonVitaminFlagKey,
  type PokemonVitaminNumberKey,
  type PokemonVitaminStatCountKind,
  type PokemonVitaminSummary,
  type PokemonVitaminTextKey,
} from '~/utils/sheets/pokemonVitamins'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'

const props = defineProps<{
  sheet: CharacterSheet
  vitaminSummary: PokemonVitaminSummary
  tutorPointsEarned: number | null
  tutorPointsLeft: number | null
}>()

const emit = defineEmits<{
  setVitaminStatCount: [kind: PokemonVitaminStatCountKind, key: StatKey, value: unknown]
  setVitaminFlag: [key: PokemonVitaminFlagKey, value: boolean]
  setVitaminNumber: [key: PokemonVitaminNumberKey, value: unknown]
  setVitaminText: [key: PokemonVitaminTextKey, value: string | undefined]
}>()

const vitaminSlotsLeftForIncrease = computed(() => Math.max(0, props.vitaminSummary.vitaminSlotsLeft))
const canAddVitaminSlot = computed(() => props.vitaminSummary.vitaminSlotsLeft > 0)
const moveOptions = computed(() => (
  props.sheet.movelist
    ?.map((move) => move.name?.trim())
    .filter((name): name is string => Boolean(name))
    ?? []
))

const statRows = computed(() => POKEMON_VITAMIN_STAT_ITEMS.map((item) => {
  const vitaminCount = props.vitaminSummary.statBoosts[item.stat]
  const suppressantCount = props.vitaminSummary.statSuppressants[item.stat]
  return {
    ...item,
    vitaminCount,
    suppressantCount,
    netAdjustment: props.vitaminSummary.statNetAdjustments[item.stat],
    maxVitaminCount: vitaminCount + vitaminSlotsLeftForIncrease.value,
  }
}))

const vitaminLimitTone = computed(() => (
  props.vitaminSummary.exceedsVitaminLimit ? 'over' : props.vitaminSummary.vitaminSlotsLeft === 0 ? 'full' : 'ok'
))

const checkedFromEvent = (event: Event): boolean => event.target instanceof HTMLInputElement && event.target.checked

const updateVitaminFlag = (key: PokemonVitaminFlagKey, event: Event) => {
  emit('setVitaminFlag', key, checkedFromEvent(event))
}

const formatTutorPointTotal = computed(() => {
  if (props.tutorPointsEarned == null) return '—'
  const left = props.tutorPointsLeft == null ? '' : ` (${props.tutorPointsLeft} left)`
  return `${props.tutorPointsEarned} earned${left}`
})
</script>

<template>
  <section class="panel-card vitamins-panel">
    <header class="vitamins-panel__header">
      <div>
        <h2 class="panel-title">Vitamins</h2>
        <p class="vitamins-panel__intro">
          Track permanent nutrition items. Stat Vitamins raise Base Stats; stat suppressants lower Base Stats.
        </p>
      </div>
      <span :class="['vitamin-limit-badge', `vitamin-limit-badge--${vitaminLimitTone}`]">
        {{ vitaminSummary.vitaminSlotsUsed }} / {{ POKEMON_VITAMIN_LIMIT }} vitamins
      </span>
    </header>

    <p v-if="vitaminSummary.exceedsVitaminLimit" class="vitamins-panel__warning" role="alert">
      This Pokémon is over the five-Vitamin lifetime limit. Existing values are still shown and applied so you can correct the sheet without losing data.
    </p>

    <div class="vitamins-table-wrap">
      <table class="vitamins-table">
        <thead>
          <tr>
            <th>Stat</th>
            <th>Vitamin</th>
            <th>Suppressants</th>
            <th title="Net permanent Base Stat adjustment from Vitamins minus suppressants">Net Base</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in statRows" :key="row.stat">
            <th scope="row">{{ row.label }}</th>
            <td>
              <span class="item-label">{{ row.vitaminName }}</span>
              <EditableCell
                :model-value="row.vitaminCount"
                type="number"
                :min="0"
                :max="row.maxVitaminCount"
                @update:model-value="(value) => emit('setVitaminStatCount', 'statBoosts', row.stat, value)"
              />
            </td>
            <td>
              <span class="item-label">{{ row.suppressantName }}</span>
              <EditableCell
                :model-value="row.suppressantCount"
                type="number"
                :min="0"
                @update:model-value="(value) => emit('setVitaminStatCount', 'statSuppressants', row.stat, value)"
              />
            </td>
            <td :class="['net-adjustment', { plus: row.netAdjustment > 0, minus: row.netAdjustment < 0 }]">
              {{ formatSignedModifier(row.netAdjustment) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="vitamin-related-grid">
      <label class="vitamin-toggle">
        <input
          type="checkbox"
          :checked="vitaminSummary.heartBoosterUsed"
          :disabled="!vitaminSummary.heartBoosterUsed && !canAddVitaminSlot"
          @change="updateVitaminFlag('heartBooster', $event)"
        >
        <span>
          <strong>Heart Booster</strong>
          <small>+2 Tutor Points, once per Pokémon.</small>
        </span>
      </label>

      <label class="vitamin-toggle vitamin-toggle--pp-up">
        <input
          type="checkbox"
          :checked="vitaminSummary.ppUpUsed"
          :disabled="!vitaminSummary.ppUpUsed && !canAddVitaminSlot"
          @change="updateVitaminFlag('ppUp', $event)"
        >
        <span>
          <strong>PP Up</strong>
          <small>Raises one move’s Frequency one step, once per Pokémon.</small>
        </span>
      </label>

      <p class="vitamin-field vitamin-field--pp-up-target">
        <strong>PP Up Move</strong>
        <EditableCell
          :model-value="sheet.vitamins?.ppUpMove"
          type="text"
          :options="moveOptions"
          placeholder="Move boosted"
          @update:model-value="(value) => emit('setVitaminText', 'ppUpMove', value as string | undefined)"
        />
      </p>

      <p class="vitamin-field" title="Rare Candies have their own five-use lifetime limit and should be applied by editing Level/EXP when consumed.">
        <strong>Rare Candies</strong>
        <EditableCell
          :model-value="vitaminSummary.rareCandies"
          type="number"
          :min="0"
          :max="POKEMON_RARE_CANDY_LIMIT"
          @update:model-value="(value) => emit('setVitaminNumber', 'rareCandies', value)"
        />
        <small>{{ vitaminSummary.rareCandiesLeft }} left</small>
      </p>

      <p class="vitamin-field" title="Heart Scales are related crafting materials for Heart Boosters; they do not directly change stats.">
        <strong>Heart Scales</strong>
        <EditableCell
          :model-value="vitaminSummary.heartScales"
          type="number"
          :min="0"
          @update:model-value="(value) => emit('setVitaminNumber', 'heartScales', value)"
        />
      </p>

      <p class="vitamin-field vitamin-field--tutor-points">
        <strong>Tutor Points</strong>
        <span>{{ formatTutorPointTotal }}</span>
      </p>
    </div>

    <p class="vitamin-notes">
      <strong>Notes:</strong>
      <EditableCell
        :model-value="sheet.vitamins?.notes"
        type="textarea"
        placeholder="Vitamin, suppressant, Heart Scale, or apothecary notes…"
        multiline
        @update:model-value="(value) => emit('setVitaminText', 'notes', value as string | undefined)"
      />
    </p>
  </section>
</template>

<style scoped>
.panel-title {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
}

.vitamins-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.vitamins-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.vitamins-panel__intro {
  margin: 0.25rem 0 0;
  color: var(--ink-muted);
  font-size: 0.82rem;
}

.vitamin-limit-badge {
  flex: 0 0 auto;
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.vitamin-limit-badge--ok { color: var(--good); }
.vitamin-limit-badge--full { color: var(--accent); }
.vitamin-limit-badge--over { color: var(--bad); }

.vitamins-panel__warning {
  margin: 0;
  border: 1px solid rgba(184, 80, 80, 0.65);
  border-radius: 10px;
  background: rgba(184, 80, 80, 0.08);
  color: var(--bad);
  padding: 0.5rem 0.65rem;
  font-size: 0.78rem;
  font-weight: 700;
}

.vitamins-table-wrap { overflow: auto; }

.vitamins-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.vitamins-table th,
.vitamins-table td {
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--rule);
  text-align: right;
}

.vitamins-table thead th {
  color: var(--ink-muted);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.vitamins-table thead th:first-child,
.vitamins-table tbody th {
  text-align: left;
}

.vitamins-table tbody th {
  color: var(--ink-bright);
  font-weight: 700;
}

.item-label {
  color: var(--ink-muted);
  font-size: 0.72rem;
  margin-right: 0.35rem;
}

.net-adjustment {
  color: var(--ink-muted);
  font-weight: 800;
}

.net-adjustment.plus { color: var(--good); }
.net-adjustment.minus { color: var(--bad); }

.vitamin-related-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
}

.vitamin-toggle,
.vitamin-field {
  min-width: 0;
  margin: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  padding: 0.55rem 0.65rem;
}

.vitamin-toggle {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  cursor: pointer;
}

.vitamin-toggle input {
  margin-top: 0.18rem;
  accent-color: var(--accent);
}

.vitamin-toggle input:disabled,
.vitamin-toggle input:disabled + span {
  cursor: not-allowed;
  opacity: 0.55;
}

.vitamin-toggle strong,
.vitamin-field strong,
.vitamin-notes strong {
  color: var(--ink-bright);
}

.vitamin-toggle small,
.vitamin-field small {
  display: block;
  margin-top: 0.15rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
}

.vitamin-field {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.vitamin-field--pp-up-target,
.vitamin-field--tutor-points {
  grid-column: span 2;
}

.vitamin-notes {
  margin: 0;
  display: flex;
  gap: 0.35rem;
  align-items: baseline;
  flex-wrap: wrap;
}

@media (max-width: 980px) {
  .vitamins-panel__header,
  .vitamin-related-grid {
    grid-template-columns: 1fr;
  }

  .vitamins-panel__header {
    flex-direction: column;
    align-items: stretch;
  }

  .vitamin-limit-badge {
    align-self: flex-start;
  }

  .vitamin-field--pp-up-target,
  .vitamin-field--tutor-points {
    grid-column: auto;
  }
}
</style>
