<script setup lang="ts">
import type { ResolvedTrainerSkill } from '~/utils/sheets/trainerDerived'
import type { SkillRank, TrainerSkillKey } from '~/types/trainerSheet'

defineProps<{
  skills: readonly ResolvedTrainerSkill[]
  rankOptions: readonly SkillRank[]
  skillModifier: (key: TrainerSkillKey) => number
}>()

const emit = defineEmits<{
  setSkillRank: [key: TrainerSkillKey, rank: SkillRank | undefined]
  setSkillModifier: [key: TrainerSkillKey, modifier: number | undefined]
}>()

const formatSkillModifier = (value: unknown): string =>
  typeof value === 'number' && value !== 0
    ? value > 0 ? `+${value}` : String(value)
    : '+0'
</script>

<template>
  <div class="block">
    <h2 class="block-title">Skills</h2>
    <div class="skills-grid">
      <div
        v-for="s in skills"
        :key="s.key"
        :class="['skill-row', {
          raised: s.raised,
          lowered: s.lowered,
        }]"
      >
        <span class="skill-label">{{ s.label }}</span>
        <span class="skill-rank">
          <EditableCell
            :model-value="s.rank"
            type="select"
            :options="rankOptions"
            @update:model-value="(v) => emit('setSkillRank', s.key, v as SkillRank | undefined)"
          />
        </span>
        <span class="skill-dice">
          {{ s.dice }}
          <EditableCell
            :model-value="skillModifier(s.key)"
            type="number"
            :format="formatSkillModifier"
            @update:model-value="(v) => emit('setSkillModifier', s.key, v as number | undefined)"
          />
        </span>
      </div>
    </div>
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

.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.3rem;
}

.skill-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: baseline;
  gap: 0.45rem;
  padding: 0.32rem 0.5rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
}

.skill-row.raised {
  border-color: rgba(184, 187, 38, 0.45);
  background: rgba(184, 187, 38, 0.12);
}

.skill-row.lowered {
  border-color: rgba(251, 73, 52, 0.45);
  background: rgba(251, 73, 52, 0.12);
}

.skill-label {
  color: var(--ink);
  font-weight: 500;
  font-size: 0.86rem;
}

.skill-rank {
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
}

.skill-dice {
  color: var(--accent);
  font-weight: 700;
  font-size: 0.82rem;
  display: inline-flex;
  gap: 0.25rem;
  align-items: baseline;
}
</style>
