<script setup lang="ts">
import { computed } from 'vue'
import type { CharacterSheet } from '~/types/characterSheet'
import {
  getHpBarDisplayMetrics,
  hpBarPercentFromRatio,
  hpTierForRatio,
} from '~/utils/hpBarDisplay'
import { resolvePokemonVitalsProgress } from '~/utils/sheets/pokemonVitals'

const props = defineProps<{
  sheet: CharacterSheet | null
}>()

const vitals = computed(() => resolvePokemonVitalsProgress(props.sheet))
const hp = computed(() => vitals.value?.hp ?? null)
const experience = computed(() => vitals.value?.experience ?? null)

const formatInteger = (value: number): string => Math.floor(value).toLocaleString()
const barStyle = (percent: number): Record<string, string> => ({ inlineSize: `${percent}%` })
const meterMax = (value: number): number => Math.max(1, Math.floor(value))
const meterNow = (value: number, max: number): number => Math.min(meterMax(max), Math.max(0, Math.floor(value)))

const hpMetrics = computed(() => (
  hp.value ? getHpBarDisplayMetrics(hp.value) : null
))

const hpTier = computed(() => (
  hpTierForRatio(hpMetrics.value?.currentRatio ?? 0)
))

const hpFillClass = computed(() => `pokemon-vitals-bars__fill--hp-${hpTier.value}`)
const hpFillStyle = computed(() => ({
  inlineSize: hpBarPercentFromRatio(hpMetrics.value?.currentRatio ?? 0),
}))
const hpBlockedStyle = computed(() => ({
  inlineSize: hpBarPercentFromRatio(hpMetrics.value?.blockedRatio ?? 0),
}))
const hasHpBlocked = computed(() => (hpMetrics.value?.blockedRatio ?? 0) > 0)
const hpMeterMax = computed(() => meterMax(hpMetrics.value?.trackMaxHp ?? hp.value?.maxHp ?? 0))
const hpMeterNow = computed(() => meterNow(hp.value?.currentHp ?? 0, hpMeterMax.value))

const hpAriaText = computed(() => {
  const model = hp.value
  if (!model) return ''
  const fullMax = model.fullMaxHp !== model.maxHp ? `; full maximum ${formatInteger(model.fullMaxHp)}` : ''
  const blockedHp = Math.max(0, Math.floor(model.fullMaxHp) - Math.floor(model.maxHp))
  const injuries = blockedHp > 0 ? `; injuries block ${formatInteger(blockedHp)} HP` : ''
  return `HP ${formatInteger(model.currentHp)} of ${formatInteger(model.maxHp)}${fullMax}${injuries}`
})

const experienceAriaText = computed(() => {
  const model = experience.value
  if (!model) return ''
  if (model.isMaxLevel) return `Level ${model.level}; maximum level`
  return `Level ${model.level}; ${formatInteger(model.currentExp)} of ${formatInteger(model.neededExp)} EXP toward level ${model.nextLevel}; ${formatInteger(model.remainingExp)} EXP to next level`
})
</script>

<template>
  <span v-if="vitals" class="pokemon-vitals-bars">
    <span
      v-if="hp"
      class="pokemon-vitals-bars__row pokemon-vitals-bars__row--hp"
      :data-hp-tier="hpTier"
      :title="hpAriaText"
    >
      <span class="pokemon-vitals-bars__label">HP</span>
      <span
        class="pokemon-vitals-bars__track"
        role="meter"
        aria-label="Current HP"
        aria-valuemin="0"
        :aria-valuemax="hpMeterMax"
        :aria-valuenow="hpMeterNow"
        :aria-valuetext="hpAriaText"
        :data-hp-tier="hpTier"
      >
        <span
          class="pokemon-vitals-bars__fill pokemon-vitals-bars__fill--hp"
          :class="hpFillClass"
          :style="hpFillStyle"
        />
        <span
          v-if="hasHpBlocked"
          class="pokemon-vitals-bars__blocked hp-bar__blocked"
          :style="hpBlockedStyle"
        />
      </span>
      <span class="pokemon-vitals-bars__value">{{ formatInteger(hp.currentHp) }}/{{ formatInteger(hp.maxHp) }}</span>
    </span>

    <span
      v-if="experience"
      class="pokemon-vitals-bars__row"
      :title="experienceAriaText"
    >
      <span class="pokemon-vitals-bars__label">XP</span>
      <span
        class="pokemon-vitals-bars__track"
        role="meter"
        aria-label="Experience to next level"
        aria-valuemin="0"
        :aria-valuemax="experience.isMaxLevel ? 1 : meterMax(experience.neededExp)"
        :aria-valuenow="experience.isMaxLevel ? 1 : meterNow(experience.currentExp, experience.neededExp)"
        :aria-valuetext="experienceAriaText"
      >
        <span
          class="pokemon-vitals-bars__fill pokemon-vitals-bars__fill--xp"
          :style="barStyle(experience.percent)"
        />
      </span>
      <span v-if="experience.isMaxLevel" class="pokemon-vitals-bars__value">Max</span>
      <span v-else class="pokemon-vitals-bars__value">
        {{ formatInteger(experience.currentExp) }}/{{ formatInteger(experience.neededExp) }}
      </span>
    </span>
  </span>
</template>

<style scoped>
.pokemon-vitals-bars {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.22rem;
}

.pokemon-vitals-bars__row {
  display: grid;
  grid-template-columns: 1.65rem minmax(0, 1fr) auto;
  gap: 0.35rem;
  align-items: center;
  min-width: 0;
}

.pokemon-vitals-bars__label,
.pokemon-vitals-bars__value {
  color: var(--ink-muted);
  font-size: 0.62rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  line-height: 1;
  text-transform: uppercase;
}

.pokemon-vitals-bars__value {
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  text-transform: none;
}

.pokemon-vitals-bars__track {
  position: relative;
  display: block;
  min-width: 0;
  height: 0.42rem;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(5, 6, 8, 0.42);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.42);
}

.pokemon-vitals-bars__fill {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  min-inline-size: 0;
  border-radius: inherit;
  transition: inline-size 0.18s ease;
}

.pokemon-vitals-bars__blocked {
  position: absolute;
  inset-block: 0;
  inset-inline: auto 0;
  inline-size: 0;
  block-size: 100%;
  border-radius: 0 999px 999px 0;
  transition: inline-size 0.18s ease;
}

.pokemon-vitals-bars__fill--hp-healthy {
  background: var(--map-hp-healthy);
}

.pokemon-vitals-bars__fill--hp-wounded {
  background: var(--map-hp-wounded);
}

.pokemon-vitals-bars__fill--hp-critical {
  background: var(--map-hp-critical);
}

.pokemon-vitals-bars__fill--xp {
  background: linear-gradient(90deg, #4d7dff, #81d4ff);
}
</style>
