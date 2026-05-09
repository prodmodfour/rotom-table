<script setup lang="ts">
import type { TrainerStatEditableField } from '~/composables/sheets/useTrainerSheetRowActions'
import type { ResolvedTrainerStat } from '~/utils/sheets/trainerDerived'
import type { TrainerStatKey } from '~/types/trainerSheet'

defineProps<{
  stats: readonly ResolvedTrainerStat[]
  statPointsLeft: number
  statPointsSpent: number
  statPointsBudget: number
}>()

const emit = defineEmits<{
  setStatField: [key: TrainerStatKey, field: TrainerStatEditableField, value: number | undefined]
}>()
</script>

<template>
  <div class="block">
    <h2 class="block-title">Stats</h2>
    <table class="data-table stats-table">
      <thead>
        <tr>
          <th>Stat</th>
          <th>Base</th>
          <th>Feats</th>
          <th>Bonus</th>
          <th>Lvl-Up</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in stats" :key="s.key">
          <th>{{ s.label }}</th>
          <td>
            <EditableCell
              :model-value="s.base"
              type="number"
              :min="0"
              @update:model-value="(v) => emit('setStatField', s.key, 'base', v as number | undefined)"
            />
          </td>
          <td>
            <EditableCell
              :model-value="s.feats"
              type="number"
              :min="0"
              @update:model-value="(v) => emit('setStatField', s.key, 'feats', v as number | undefined)"
            />
          </td>
          <td>
            <EditableCell
              :model-value="s.bonus"
              type="number"
              :min="0"
              @update:model-value="(v) => emit('setStatField', s.key, 'bonus', v as number | undefined)"
            />
          </td>
          <td>
            <EditableCell
              :model-value="s.levelUp"
              type="number"
              :min="0"
              @update:model-value="(v) => emit('setStatField', s.key, 'levelUp', v as number | undefined)"
            />
          </td>
          <td><strong>{{ s.total }}</strong></td>
        </tr>
      </tbody>
      <tfoot>
        <tr
          class="stat-points-row"
          title="Trainer Lvl-Up Stat Points = Level - 1; the 10 character-creation points live in Base (PTU Core, Character Advancement p.19)."
        >
          <th colspan="4" scope="row">Total points to spend</th>
          <td :class="['stat-points-row__value', { negative: statPointsLeft < 0 }]">
            {{ statPointsLeft }}
          </td>
          <td class="stat-points-row__meta">
            {{ statPointsSpent }} / {{ statPointsBudget }} used
          </td>
        </tr>
      </tfoot>
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

.stats-table tbody th {
  color: var(--accent);
  letter-spacing: 0.04em;
}

.data-table tfoot th,
.data-table tfoot td {
  padding-top: 0.55rem;
  border-bottom: 0;
}

.stat-points-row th {
  text-align: right;
  color: var(--ink-muted);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.stat-points-row__value {
  font-weight: 800;
  color: var(--good);
}

.stat-points-row__value.negative { color: var(--bad); }

.stat-points-row__meta {
  color: var(--ink-muted);
  font-size: 0.72rem;
}
</style>
