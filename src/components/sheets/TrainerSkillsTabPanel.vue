<script setup lang="ts">
import type { ResolvedTrainerSkill } from '~/utils/sheets/trainerDerived'
import type {
  TrainerSheet,
  TrainerSkillKey,
} from '~/types/trainerSheet'

const adeptCsv = defineModel<string>('adeptCsv', { required: true })
const noviceCsv = defineModel<string>('noviceCsv', { required: true })
const patheticCsv = defineModel<string>('patheticCsv', { required: true })

defineProps<{
  sheet: TrainerSheet
  skills: readonly ResolvedTrainerSkill[]
}>()

const emit = defineEmits<{
  setSkillRankBonus: [key: TrainerSkillKey, rankBonus: number | undefined]
  setSkillModifier: [key: TrainerSkillKey, modifier: number | undefined]
}>()

const forwardSetSkillRankBonus = (key: TrainerSkillKey, rankBonus: number | undefined) =>
  emit('setSkillRankBonus', key, rankBonus)

const forwardSetSkillModifier = (key: TrainerSkillKey, modifier: number | undefined) =>
  emit('setSkillModifier', key, modifier)
</script>

<template>
  <section class="tab-panel">
    <TrainerSkillsPanel
      :skills="skills"
      @set-skill-rank-bonus="forwardSetSkillRankBonus"
      @set-skill-modifier="forwardSetSkillModifier"
    />

    <TrainerSkillBackgroundPanel
      v-model:adept-csv="adeptCsv"
      v-model:novice-csv="noviceCsv"
      v-model:pathetic-csv="patheticCsv"
      :sheet="sheet"
    />
  </section>
</template>

<style scoped>
.tab-panel {
  display: grid;
  grid-template-columns: minmax(20rem, 32rem) minmax(18rem, 28rem);
  gap: 0.85rem;
  align-items: start;
}

@media (max-width: 860px) {
  .tab-panel {
    grid-template-columns: 1fr;
  }
}
</style>
