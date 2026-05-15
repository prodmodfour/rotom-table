<script setup lang="ts">
import { formatCombatStage } from '~/utils/combatStageStats'
import { formatSignedModifier } from '~/utils/evasion'
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
          <th>Stage</th>
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
          <td>
            <div class="stage-cell">
              <strong
                v-if="s.conditionStageModifier"
                class="stage-effective"
                :class="{ plus: s.effectiveStage > 0, minus: s.effectiveStage < 0 }"
                title="Effective Combat Stage after condition effects"
              >
                {{ formatCombatStage(s.effectiveStage) }}
              </strong>
              <span class="stage-edit" :class="{ 'stage-edit--with-effective': s.conditionStageModifier }">
                <span v-if="s.conditionStageModifier" class="stage-edit__label">manual</span>
                <EditableCell
                  :model-value="s.stage"
                  type="number"
                  :min="-6"
                  :max="6"
                  @update:model-value="(v) => emit('setStatField', s.key, 'stage', v as number | undefined)"
                />
              </span>
              <small v-if="s.conditionStageModifier" class="stage-condition">
                condition {{ formatSignedModifier(s.conditionStageModifier) }}
              </small>
            </div>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr
          class="stat-points-row"
          title="Trainer Stat Points in Lvl-Up = 10 at Level 1, plus 1 per later Level (PTU Core, Character Creation p.15 and Character Advancement p.19)."
        >
          <th colspan="5" scope="row">Total points to spend</th>
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

.stage-cell {
  display: inline-flex;
  align-items: baseline;
  gap: 0.32rem;
  flex-wrap: wrap;
}

.stage-effective {
  color: var(--ink-bright);
  font-weight: 800;
}

.stage-effective.plus { color: var(--good); }
.stage-effective.minus { color: var(--bad); }

.stage-edit {
  display: inline-flex;
  align-items: baseline;
  gap: 0.2rem;
}

.stage-edit--with-effective { color: var(--ink-muted); }

.stage-edit__label,
.stage-condition {
  color: var(--ink-muted);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
}

.stage-condition {
  color: var(--bad);
  font-weight: 700;
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
