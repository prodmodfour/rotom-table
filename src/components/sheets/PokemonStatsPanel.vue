<script setup lang="ts">
import { formatCombatStage } from '~/utils/combatStageStats'
import { formatSignedModifier } from '~/utils/evasion'
import type {
  BaseRelationViolation,
  ResolvedStat,
} from '~/utils/sheets/pokemonDerived'
import type { PokemonStatEditableField } from '~/composables/sheets/usePokemonSheetRowActions'
import type { StatKey } from '~/types/characterSheet'

defineProps<{
  stats: readonly ResolvedStat[]
  statPointsLeft: number
  statPointsSpent: number
  statPointsBudget: number
  baseRelationViolations: readonly BaseRelationViolation[]
  visibleBaseRelationViolations: readonly BaseRelationViolation[]
  remainingBaseRelationViolationCount: number
}>()

const emit = defineEmits<{
  setStat: [key: StatKey, field: PokemonStatEditableField, value: number | undefined]
}>()
</script>

<template>
  <section class="panel-card">
    <h2 class="panel-title">Stats</h2>
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead>
          <tr>
            <th>Stat</th>
            <th>Species</th>
            <th title="Nature adjustment">Mod</th>
            <th title="Vitamins and stat suppressants applied to Base Stat">Items</th>
            <th>Base</th>
            <th>Added</th>
            <th title="Current stat after Combat Stages">Total</th>
            <th>Stage</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in stats" :key="row.key">
            <th>{{ row.label }}</th>
            <td>{{ row.species || '—' }}</td>
            <td :class="['mod', { plus: row.mod > 0, minus: row.mod < 0 }]">
              {{ row.mod > 0 ? `+${row.mod}` : row.mod }}
            </td>
            <td :class="['vitamin-adjustment', { plus: row.vitaminAdjustment > 0, minus: row.vitaminAdjustment < 0 }]">
              {{ row.vitaminAdjustment ? formatSignedModifier(row.vitaminAdjustment) : '—' }}
            </td>
            <td class="base">{{ row.base || '—' }}</td>
            <td>
              <StatAllocationSlider
                :model-value="row.added"
                :points-left="statPointsLeft"
                :label="`${row.label} Added Stat Points`"
                @update:model-value="(v) => emit('setStat', row.key, 'added', v)"
              />
            </td>
            <td class="total">{{ row.total }}</td>
            <td>
              <div class="stage-cell">
                <strong
                  v-if="row.conditionStageModifier"
                  class="stage-effective"
                  :class="{ plus: row.effectiveStage > 0, minus: row.effectiveStage < 0 }"
                  title="Effective Combat Stage after condition effects"
                >
                  {{ formatCombatStage(row.effectiveStage) }}
                </strong>
                <span class="stage-edit" :class="{ 'stage-edit--with-effective': row.conditionStageModifier }">
                  <span v-if="row.conditionStageModifier" class="stage-edit__label">manual</span>
                  <EditableCell
                    :model-value="row.stage"
                    type="number"
                    :min="-6"
                    :max="6"
                    @update:model-value="(v) => emit('setStat', row.key, 'stage', v as number | undefined)"
                  />
                </span>
                <small v-if="row.conditionStageModifier" class="stage-condition">
                  condition {{ formatSignedModifier(row.conditionStageModifier) }}
                </small>
              </div>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr
            class="stat-points-row"
            title="Pokémon added Stat Points = Level + 10 (PTU Core, Pokémon p.198)."
          >
            <th colspan="5" scope="row">Total points to spend</th>
            <td :class="['stat-points-row__value', { negative: statPointsLeft < 0 }]">
              {{ statPointsLeft }}
            </td>
            <td colspan="2" class="stat-points-row__meta">
              {{ statPointsSpent }} / {{ statPointsBudget }} used
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div
      :class="[
        'stat-validation',
        baseRelationViolations.length ? 'stat-validation--error' : 'stat-validation--ok',
      ]"
      :role="baseRelationViolations.length ? 'alert' : 'status'"
    >
      <div class="stat-validation__heading">
        <strong><RefLink kind="rule" name="Base Relations" /></strong>
        <span v-if="baseRelationViolations.length" class="stat-validation__badge">
          {{ baseRelationViolations.length }} issue{{ baseRelationViolations.length === 1 ? '' : 's' }}
        </span>
        <span v-else class="stat-validation__badge">valid</span>
      </div>

      <p v-if="!baseRelationViolations.length" class="stat-validation__copy">
        Added Stat Points preserve the nature-adjusted Base Stat order.
      </p>
      <template v-else>
        <p class="stat-validation__copy">
          Higher Base Stats must stay higher than lower Base Stats after Added points.
        </p>
        <ul>
          <li
            v-for="violation in visibleBaseRelationViolations"
            :key="`${violation.higher.key}-${violation.lower.key}`"
          >
            {{ violation.higher.label }}
            <span class="stat-validation__meta">
              Base {{ violation.higher.base }}, build total {{ violation.higher.baseTotal }}
            </span>
            must stay above {{ violation.lower.label }}
            <span class="stat-validation__meta">
              Base {{ violation.lower.base }}, build total {{ violation.lower.baseTotal }}
            </span>.
          </li>
          <li v-if="remainingBaseRelationViolationCount" class="stat-validation__more">
            +{{ remainingBaseRelationViolationCount }} more
          </li>
        </ul>
        <p class="stat-validation__note">
          Features or Poké Edges may waive specific relations; document those exceptions if applicable.
        </p>
      </template>
    </div>
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

.stats-table-wrap { overflow: auto; }

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.stats-table th,
.stats-table td {
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--rule);
  text-align: right;
}

.stats-table thead th {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
  font-weight: 600;
  text-align: right;
}

.stats-table thead th:first-child {
  text-align: left;
}

.stats-table tbody th {
  text-align: left;
  color: var(--ink-bright);
  font-weight: 700;
  letter-spacing: 0.02em;
}

.stats-table .total {
  font-weight: 700;
  color: var(--ink-bright);
}

.stats-table .mod.plus,
.stats-table .vitamin-adjustment.plus,
.stage-effective.plus { color: var(--good); }

.stats-table .mod.minus,
.stats-table .vitamin-adjustment.minus,
.stage-effective.minus { color: var(--bad); }

.stage-cell {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0.32rem;
  flex-wrap: wrap;
}

.stage-effective {
  color: var(--ink-bright);
  font-weight: 800;
}

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

.stats-table tfoot th,
.stats-table tfoot td {
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
  text-align: left;
}

.stat-validation {
  margin-top: 0.75rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  color: var(--ink-soft);
  font-size: 0.78rem;
}

.stat-validation--ok { border-color: rgba(88, 148, 96, 0.55); }

.stat-validation--error {
  border-color: rgba(184, 80, 80, 0.7);
  background: rgba(184, 80, 80, 0.08);
}

.stat-validation__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  color: var(--ink-bright);
}

.stat-validation__badge {
  margin-left: auto;
  padding: 0.1rem 0.45rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  color: inherit;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.stat-validation--ok .stat-validation__badge { color: var(--good); }
.stat-validation--error .stat-validation__badge { color: var(--bad); }

.stat-validation__copy,
.stat-validation__note { margin: 0.3rem 0 0; }

.stat-validation ul {
  margin: 0.4rem 0 0;
  padding-left: 1.1rem;
}

.stat-validation li + li { margin-top: 0.2rem; }

.stat-validation__meta,
.stat-validation__note,
.stat-validation__more { color: var(--ink-muted); }
</style>
