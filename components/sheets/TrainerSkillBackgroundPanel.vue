<script setup lang="ts">
import type { TrainerSheet } from '~/types/trainerSheet'

const adeptCsv = defineModel<string>('adeptCsv', { required: true })
const noviceCsv = defineModel<string>('noviceCsv', { required: true })
const patheticCsv = defineModel<string>('patheticCsv', { required: true })

defineProps<{
  sheet: TrainerSheet
}>()
</script>

<template>
  <div class="block">
    <h2 class="block-title">Skill Background</h2>
    <div class="bg-card">
      <div class="bg-name">
        <EditableCell v-model="sheet.skillBackground!.name" placeholder="Background name" />
      </div>
      <p class="bg-desc">
        <EditableCell
          v-model="sheet.skillBackground!.description"
          type="textarea"
          placeholder="Background description"
          multiline
        />
      </p>
      <ul class="bg-list">
        <li>
          <span class="bg-tag adept">Adept</span>
          <EditableCell v-model="adeptCsv" placeholder="survival" />
        </li>
        <li>
          <span class="bg-tag novice">Novice</span>
          <EditableCell v-model="noviceCsv" placeholder="medicineEd" />
        </li>
        <li>
          <span class="bg-tag pathetic">Pathetic</span>
          <EditableCell v-model="patheticCsv" placeholder="combat, intimidate" />
        </li>
      </ul>
    </div>

    <h2 class="block-title block-title--spaced">Milestones</h2>
    <ul class="kv-list">
      <li>
        <span>Milestones</span>
        <strong><EditableCell v-model="sheet.milestones" type="number" :min="0" /></strong>
      </li>
      <li>
        <span>Dex EXP</span>
        <strong><EditableCell v-model="sheet.dexExp" type="number" :min="0" /></strong>
      </li>
      <li>
        <span>Misc EXP</span>
        <strong><EditableCell v-model="sheet.miscExp" type="number" :min="0" /></strong>
      </li>
      <li>
        <span>Bonus Skill Edges</span>
        <strong><EditableCell v-model="sheet.bonusSkillEdges" type="number" :min="0" /></strong>
      </li>
      <li>
        <span>Features remaining</span>
        <strong><EditableCell v-model="sheet.remainingFeatures" type="number" :min="0" /></strong>
      </li>
      <li>
        <span>Edges remaining</span>
        <strong><EditableCell v-model="sheet.remainingEdges" type="number" :min="0" /></strong>
      </li>
    </ul>
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

.block-title--spaced { margin-top: 0.85rem; }

.bg-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.bg-name {
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--accent);
}

.bg-desc {
  margin: 0;
  color: var(--ink-soft);
  font-style: italic;
  font-size: 0.88rem;
}

.bg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.bg-list li {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.85rem;
}

.bg-tag {
  display: inline-flex;
  padding: 0.12rem 0.55rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 1px solid transparent;
}

.bg-tag.adept {
  background: rgba(184, 187, 38, 0.16);
  color: var(--good);
  border-color: rgba(184, 187, 38, 0.45);
}

.bg-tag.novice {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: rgba(250, 189, 47, 0.4);
}

.bg-tag.pathetic {
  background: rgba(251, 73, 52, 0.16);
  color: var(--bad);
  border-color: rgba(251, 73, 52, 0.45);
}

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
</style>
