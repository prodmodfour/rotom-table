<script setup lang="ts">
import type { ResolvedSkill } from '~/utils/sheets/pokemonDerived'
import type { CharacterSheet } from '~/types/characterSheet'

const props = defineProps<{
  sheet: CharacterSheet
  skills: readonly ResolvedSkill[]
}>()

const setSkillOverride = (skill: ResolvedSkill, value: unknown) => {
  const next = typeof value === 'string' ? value : value == null ? '' : String(value)
  const skills = props.sheet.skills ?? {}
  if (next.trim()) skills[skill.key] = next
  else delete skills[skill.key]
  props.sheet.skills = skills
}
</script>

<template>
  <section class="panel-card">
    <h2 class="panel-title">
      Pokémon Skills
      <span class="panel-subtle">bold = species-given · click any value to override</span>
    </h2>
    <dl class="skills-grid">
      <div
        v-for="skill in skills"
        :key="skill.key"
        :class="['skill-cell', { 'skill-cell--given': skill.speciesGiven }]"
      >
        <dt>{{ skill.label }}</dt>
        <dd>
          <EditableCell
            :model-value="sheet.skills?.[skill.key] ?? skill.value"
            :placeholder="skill.value"
            @update:model-value="(v) => setSkillOverride(skill, v)"
          />
        </dd>
      </div>
    </dl>
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

.panel-subtle {
  font-size: 0.74rem;
  color: var(--ink-muted);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
  font-family: var(--font-ui);
}

.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.4rem;
  margin: 0;
}

.skill-cell {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  padding: 0.38rem 0.55rem;
  background: var(--paper-inset);
}

.skill-cell--given {
  background: rgba(255, 255, 255, 0.14);
  border-color: var(--rule-strong);
}

.skill-cell--given dt {
  color: var(--ink-bright);
  font-weight: 700;
}

.skill-cell dt {
  margin: 0;
  font-size: 0.85rem;
  color: var(--ink);
}

.skill-cell dd {
  margin: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ink-bright);
}
</style>
