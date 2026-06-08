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
    <h2 class="block-title">Background</h2>
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
          <EditableCell v-model="adeptCsv" placeholder="e.g. Survival" />
        </li>
        <li>
          <span class="bg-tag novice">Novice</span>
          <EditableCell v-model="noviceCsv" placeholder="e.g. Medicine Ed" />
        </li>
        <li>
          <span class="bg-tag pathetic">Pathetic</span>
          <EditableCell v-model="patheticCsv" placeholder="e.g. Combat, Intimidate" />
        </li>
      </ul>
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
  border-color: rgba(var(--accent-rgb), 0.4);
}

.bg-tag.pathetic {
  background: rgba(255, 31, 45, 0.16);
  color: var(--bad);
  border-color: rgba(255, 31, 45, 0.45);
}
</style>
