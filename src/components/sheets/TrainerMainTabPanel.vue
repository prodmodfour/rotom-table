<script setup lang="ts">
import type {
  TrainerStatEditableField,
} from '~/composables/sheets/useTrainerSheetRowActions'
import type {
  ResolvedTrainerSkill,
  ResolvedTrainerStat,
} from '~/utils/sheets/trainerDerived'
import type {
  SkillRank,
  TrainerSheet,
  TrainerSkillKey,
  TrainerStatKey,
} from '~/types/trainerSheet'

const adeptCsv = defineModel<string>('adeptCsv', { required: true })
const noviceCsv = defineModel<string>('noviceCsv', { required: true })
const patheticCsv = defineModel<string>('patheticCsv', { required: true })
const currentTeamCsv = defineModel<string>('currentTeamCsv', { required: true })
const wishlistCsv = defineModel<string>('wishlistCsv', { required: true })

defineProps<{
  sheet: TrainerSheet
  stats: readonly ResolvedTrainerStat[]
  skills: readonly ResolvedTrainerSkill[]
  rankOptions: readonly SkillRank[]
  statPointsLeft: number
  statPointsSpent: number
  statPointsBudget: number
  skillModifier: (key: TrainerSkillKey) => number
}>()

const emit = defineEmits<{
  setStatField: [key: TrainerStatKey, field: TrainerStatEditableField, value: number | undefined]
  setSkillRank: [key: TrainerSkillKey, rank: SkillRank | undefined]
  setSkillModifier: [key: TrainerSkillKey, modifier: number | undefined]
  addClass: []
  removeClass: [index: number]
}>()

const forwardSetStatField = (
  key: TrainerStatKey,
  field: TrainerStatEditableField,
  value: number | undefined,
) => emit('setStatField', key, field, value)

const forwardSetSkillRank = (key: TrainerSkillKey, rank: SkillRank | undefined) =>
  emit('setSkillRank', key, rank)

const forwardSetSkillModifier = (key: TrainerSkillKey, modifier: number | undefined) =>
  emit('setSkillModifier', key, modifier)
</script>

<template>
  <section class="tab-panel">
    <div class="grid-two">
      <TrainerStatsPanel
        :stats="stats"
        :stat-points-left="statPointsLeft"
        :stat-points-spent="statPointsSpent"
        :stat-points-budget="statPointsBudget"
        @set-stat-field="forwardSetStatField"
      />

      <TrainerSkillBackgroundPanel
        v-model:adept-csv="adeptCsv"
        v-model:novice-csv="noviceCsv"
        v-model:pathetic-csv="patheticCsv"
        :sheet="sheet"
      />
    </div>

    <TrainerSkillsPanel
      :skills="skills"
      :rank-options="rankOptions"
      :skill-modifier="skillModifier"
      @set-skill-rank="forwardSetSkillRank"
      @set-skill-modifier="forwardSetSkillModifier"
    />

    <TrainerProgressPanel
      v-model:current-team-csv="currentTeamCsv"
      v-model:wishlist-csv="wishlistCsv"
      :sheet="sheet"
      @add-class="emit('addClass')"
      @remove-class="emit('removeClass', $event)"
    />
  </section>
</template>

<style scoped>
.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.grid-two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 0.85rem;
}
</style>
