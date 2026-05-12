<script setup lang="ts">
import type { TrainerApPool } from '~/types/trainerSheet'

defineProps<{
  ap: TrainerApPool
  maxAp: number
}>()
</script>

<template>
  <div class="block">
    <h2 class="block-title">Action Points</h2>
    <table class="data-table ap-table">
      <thead>
        <tr>
          <th>Left</th>
          <th>Spent</th>
          <th>Bound</th>
          <th>Drained</th>
          <th>Max</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><EditableCell v-model="ap.left" type="number" :min="0" /></td>
          <td><EditableCell v-model="ap.spent" type="number" :min="0" /></td>
          <td><EditableCell v-model="ap.bound" type="number" :min="0" /></td>
          <td><EditableCell v-model="ap.drained" type="number" :min="0" /></td>
          <td><strong>{{ maxAp }}</strong></td>
        </tr>
      </tbody>
    </table>
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

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.data-table th,
.data-table td {
  padding: 0.35rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--rule);
  vertical-align: top;
}

.data-table th {
  font-weight: 600;
  color: var(--ink-bright);
}

.data-table thead th {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: transparent;
  font-weight: 600;
}
</style>
