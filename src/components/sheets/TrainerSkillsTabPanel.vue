<script setup lang="ts">
import type { ResolvedTrainerSkill } from '~/utils/sheets/trainerDerived'
import type {
  SkillRank,
  TrainerSheet,
  TrainerSkillKey,
} from '~/types/trainerSheet'

const adeptCsv = defineModel<string>('adeptCsv', { required: true })
const noviceCsv = defineModel<string>('noviceCsv', { required: true })
const patheticCsv = defineModel<string>('patheticCsv', { required: true })

defineProps<{
  sheet: TrainerSheet
  skills: readonly ResolvedTrainerSkill[]
  rankOptions: readonly SkillRank[]
  skillModifier: (key: TrainerSkillKey) => number
}>()

const emit = defineEmits<{
  setSkillRank: [key: TrainerSkillKey, rank: SkillRank | undefined]
  setSkillModifier: [key: TrainerSkillKey, modifier: number | undefined]
}>()

const forwardSetSkillRank = (key: TrainerSkillKey, rank: SkillRank | undefined) =>
  emit('setSkillRank', key, rank)

const forwardSetSkillModifier = (key: TrainerSkillKey, modifier: number | undefined) =>
  emit('setSkillModifier', key, modifier)
</script>

<template>
  <section class="tab-panel">
    <TrainerSkillBackgroundPanel
      v-model:adept-csv="adeptCsv"
      v-model:novice-csv="noviceCsv"
      v-model:pathetic-csv="patheticCsv"
      :sheet="sheet"
    />

    <TrainerSkillsPanel
      :skills="skills"
      :rank-options="rankOptions"
      :skill-modifier="skillModifier"
      @set-skill-rank="forwardSetSkillRank"
      @set-skill-modifier="forwardSetSkillModifier"
    />
  </section>
</template>

<style scoped>
.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
</style>
