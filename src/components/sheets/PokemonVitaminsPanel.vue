<script setup lang="ts">
import { computed } from 'vue'
import { formatSignedModifier } from '~/utils/evasion'
import {
  POKEMON_RARE_CANDY_LIMIT,
  POKEMON_VITAMIN_LIMIT,
  POKEMON_VITAMIN_STAT_ITEMS,
  type PokemonVitaminNumberKey,
  type PokemonVitaminSummary,
  type PokemonVitaminTextKey,
} from '~/utils/sheets/pokemonVitamins'
import type { CharacterSheet } from '~/types/characterSheet'

const props = defineProps<{
  sheet: CharacterSheet
  vitaminSummary: PokemonVitaminSummary
  tutorPointsEarned: number | null
  tutorPointsLeft: number | null
}>()

const emit = defineEmits<{
  setVitaminNumber: [key: PokemonVitaminNumberKey, value: unknown]
  setVitaminText: [key: PokemonVitaminTextKey, value: string | undefined]
}>()

const statRows = computed(() => POKEMON_VITAMIN_STAT_ITEMS.map((item) => ({
  ...item,
  vitaminCount: props.vitaminSummary.statBoosts[item.stat],
  suppressantCount: props.vitaminSummary.statSuppressants[item.stat],
  netAdjustment: props.vitaminSummary.statNetAdjustments[item.stat],
})))

const vitaminLimitTone = computed(() => (
  props.vitaminSummary.exceedsVitaminLimit ? 'over' : props.vitaminSummary.vitaminSlotsLeft === 0 ? 'full' : 'ok'
))

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
          Accepted permanent items are recorded here. Start new uses from the owning Trainer’s inventory.
        </p>
      </div>
      <span :class="['vitamin-limit-badge', `vitamin-limit-badge--${vitaminLimitTone}`]">
        {{ vitaminSummary.vitaminSlotsUsed }} / {{ POKEMON_VITAMIN_LIMIT }} vitamins
      </span>
    </header>

    <p v-if="vitaminSummary.exceedsVitaminLimit" class="vitamins-panel__warning" role="alert">
      This Pokémon is over the five-Vitamin lifetime limit. Item use is locked until the stored legacy record is reviewed.
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
              <strong class="authoritative-count">{{ row.vitaminCount }}</strong>
            </td>
            <td>
              <span class="item-label">{{ row.suppressantName }}</span>
              <strong class="authoritative-count">{{ row.suppressantCount }}</strong>
            </td>
            <td :class="['net-adjustment', { plus: row.netAdjustment > 0, minus: row.netAdjustment < 0 }]">
              {{ formatSignedModifier(row.netAdjustment) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="vitamins-panel__authority-note">
      Permanent outcomes, lifetime limits, Move Frequency, Experience, and Trainer consent are server-authoritative. Sheet editing cannot rewrite them.
    </p>

    <div class="vitamin-related-grid">
      <div class="vitamin-toggle" :class="{ 'is-used': vitaminSummary.heartBoosterUsed }">
        <span class="vitamin-toggle__status">{{ vitaminSummary.heartBoosterUsed ? 'Used' : 'Not used' }}</span>
        <span>
          <strong>Heart Booster</strong>
          <small>+2 Tutor Points, once per Pokémon.</small>
        </span>
      </div>

      <div class="vitamin-toggle vitamin-toggle--pp-up" :class="{ 'is-used': vitaminSummary.ppUpUsed }">
        <span class="vitamin-toggle__status">{{ vitaminSummary.ppUpUsed ? 'Used' : 'Not used' }}</span>
        <span>
          <strong>PP Up</strong>
          <small>Raises one eligible Move’s Frequency, once per Pokémon.</small>
        </span>
      </div>

      <p class="vitamin-field vitamin-field--pp-up-target">
        <strong>PP Up Move</strong>
        <span>{{ sheet.vitamins?.ppUpMove?.trim() || '—' }}</span>
      </p>

      <p class="vitamin-field" title="Rare Candy use and Experience are committed together by an accepted item operation.">
        <strong>Rare Candies</strong>
        <span class="authoritative-count">{{ vitaminSummary.rareCandies }} / {{ POKEMON_RARE_CANDY_LIMIT }}</span>
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

.vitamins-panel__warning,
.vitamins-panel__authority-note {
  margin: 0;
  border: 1px solid rgba(184, 80, 80, 0.65);
  border-radius: 10px;
  background: rgba(184, 80, 80, 0.08);
  color: var(--bad);
  padding: 0.5rem 0.65rem;
  font-size: 0.78rem;
  font-weight: 700;
}

.vitamins-panel__authority-note {
  border-color: color-mix(in srgb, var(--rt-focus, var(--accent)) 50%, var(--rule));
  background: color-mix(in srgb, var(--rt-focus, var(--accent)) 7%, var(--paper));
  color: var(--ink-soft);
  font-weight: 600;
  line-height: 1.45;
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

.authoritative-count {
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
}

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
  gap: 0.55rem;
  align-items: flex-start;
}

.vitamin-toggle__status {
  flex: 0 0 auto;
  border-left: 2px solid var(--rule-strong);
  padding-left: 0.4rem;
  color: var(--ink-muted);
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
}

.vitamin-toggle.is-used .vitamin-toggle__status {
  border-left-color: var(--good);
  color: var(--good);
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
