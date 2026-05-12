<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import { formatLookupValue, setLookupMoveName } from '~/utils/sheetMoveLookup'
import type { PokemonSheetMoveLookupRow } from '~/composables/sheets/usePokemonSheetDerived'

defineProps<{
  moveRows: readonly PokemonSheetMoveLookupRow[]
}>()

const emit = defineEmits<{
  addMove: []
  removeMove: [index: number | null]
}>()
</script>

<template>
  <section class="panel-card">
    <h2 class="panel-title">
      Movelist
      <span class="panel-subtle">name editable · details from moves.json · Struggle auto-added</span>
      <button type="button" class="row-add" @click="emit('addMove')">
        <PhPlus :size="14" weight="bold" /> Add row
      </button>
    </h2>
    <div class="table-wrap">
      <table class="moves-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Cat.</th>
            <th>DB</th>
            <th>Damage</th>
            <th>Freq</th>
            <th>AC</th>
            <th>Range</th>
            <th>Effect</th>
            <th aria-label="Row actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in moveRows"
            :key="`${row.automatic ? 'auto' : 'sheet'}-${row.move.name}-${i}`"
            :class="{ 'move-row--automatic': row.automatic }"
          >
            <td class="move-name">
              <EditableCell
                :model-value="row.move.name"
                placeholder="Move"
                :readonly="row.automatic"
                @update:model-value="(v) => setLookupMoveName(row.move, v)"
              />
              <span v-if="row.automatic" class="move-auto-badge" title="Auto-added from Struggle rules and capabilities">auto</span>
            </td>
            <td>
              <TypeBadge v-if="row.reference?.type" :type="row.reference.type" size="xs" />
              <span v-else class="badge-empty">—</span>
            </td>
            <td>
              <DamageClassBadge v-if="row.reference?.damage_class" :category="row.reference.damage_class" size="xs" />
              <span v-else class="badge-empty">—</span>
            </td>
            <td>
              {{ formatLookupValue(row.damageBase) }}
              <span v-if="row.hasStab" class="move-stab" title="Same-type attack bonus included">STAB</span>
            </td>
            <td>{{ formatLookupValue(row.damageFormula) }}</td>
            <td>{{ formatLookupValue(row.reference?.frequency) }}</td>
            <td>{{ formatLookupValue(row.reference?.ac) }}</td>
            <td>{{ formatLookupValue(row.reference?.range) }}</td>
            <td class="move-effect">
              <span v-if="row.reference?.effect">{{ row.reference.effect }}</span>
              <span v-else class="badge-empty">{{ row.move.name.trim() ? 'No matching move in moves.json' : '—' }}</span>
            </td>
            <td class="row-actions">
              <button
                v-if="!row.automatic"
                type="button"
                class="row-remove"
                title="Remove move"
                @click="emit('removeMove', row.sheetIndex)"
              >
                <PhX :size="14" weight="bold" />
              </button>
              <span v-else class="row-auto-note" title="Auto-added from Struggle rules and capabilities">Auto</span>
            </td>
          </tr>
          <tr v-if="!moveRows.length">
            <td colspan="10" class="empty-cell">No moves yet — click "Add row" to start.</td>
          </tr>
        </tbody>
      </table>
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

.panel-subtle {
  font-size: 0.74rem;
  color: var(--ink-muted);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
  font-family: var(--font-ui);
}

.table-wrap { overflow: auto; }

.moves-table {
  width: 100%;
  border-collapse: collapse;
}

.moves-table th,
.moves-table td {
  padding: 0.45rem 0.55rem;
  border-bottom: 1px solid var(--rule);
  text-align: left;
  vertical-align: top;
}

.moves-table th {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
  font-weight: 600;
}

.move-name {
  font-weight: 700;
  color: var(--ink-bright);
  letter-spacing: 0.02em;
}

.move-effect {
  color: var(--ink-soft);
  font-size: 0.88rem;
}

.move-stab {
  display: inline-flex;
  margin-left: 0.25rem;
  color: var(--accent);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  vertical-align: middle;
}

.move-row--automatic { background: rgba(184, 187, 38, 0.06); }

.move-auto-badge,
.row-auto-note {
  display: inline-flex;
  align-items: center;
  margin-left: 0.35rem;
  color: var(--ink-muted);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  vertical-align: middle;
}

.row-auto-note { margin-left: 0; }

.empty-cell {
  text-align: center;
  color: var(--ink-muted);
  font-style: italic;
}

.row-actions { width: 1.5rem; }

.row-add,
.row-remove {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  background: var(--paper-inset);
  color: var(--ink-soft);
  padding: 0.2rem 0.45rem;
  font: inherit;
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  margin-left: auto;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
}

.row-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.row-remove {
  margin: 0;
  padding: 0.2rem;
  border-color: transparent;
  background: transparent;
}

.row-remove:hover {
  color: #d36464;
  border-color: rgba(220, 80, 80, 0.45);
  background: rgba(220, 80, 80, 0.08);
}
</style>
