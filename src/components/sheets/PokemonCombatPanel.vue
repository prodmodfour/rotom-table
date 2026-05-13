<script setup lang="ts">
import type { PokemonEvasionBonusKey } from '~/composables/sheets/usePokemonSheetRowActions'
import type { CharacterSheet } from '~/types/characterSheet'

interface HpThresholds {
  half: number
  third: number
  quarter: number
}

interface EvasionEntry {
  total: number
  base: number
  bonus: number
  abilityBonus: number
}

interface PokemonEvasionSummary {
  vsAtk: EvasionEntry
  vsSatk: EvasionEntry
  vsAny: EvasionEntry & { itemBonus: number }
}

defineProps<{
  sheet: CharacterSheet
  currentHp: number
  maxHp: number
  fullMaxHp: number
  tickValue: number
  hpThresholds: HpThresholds
  pokemonEvasion: PokemonEvasionSummary
}>()

const emit = defineEmits<{
  setCurrentHp: [value: unknown]
  setEvasionBonus: [key: PokemonEvasionBonusKey, value: number | undefined]
}>()

const forwardEvasionBonus = (key: PokemonEvasionBonusKey, value: number | undefined) => {
  emit('setEvasionBonus', key, value)
}
</script>

<template>
  <section class="panel-card">
    <h2 class="panel-title">Combat</h2>
    <PokemonCombatVitalsStrip
      :combat="sheet.combat!"
      :current-hp="currentHp"
      :max-hp="maxHp"
      :full-max-hp="fullMaxHp"
      :tick-value="tickValue"
      :hp-thresholds="hpThresholds"
      @set-current-hp="emit('setCurrentHp', $event)"
    />

    <PokemonEvasionConditionsPanel
      :combat="sheet.combat!"
      :pokemon-evasion="pokemonEvasion"
      @set-evasion-bonus="forwardEvasionBonus"
    />
  </section>
</template>

<style scoped>
.panel-title {
  margin: 0 0 0.6rem;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}
</style>
