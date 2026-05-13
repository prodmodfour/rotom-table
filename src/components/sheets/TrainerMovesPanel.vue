<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import { formatLookupValue, setLookupMoveName } from '~/utils/sheetMoveLookup'
import type { TrainerSheetMoveLookupRow } from '~/composables/sheets/useTrainerSheetDerived'

defineProps<{
  moveRows: readonly TrainerSheetMoveLookupRow[]
}>()

const emit = defineEmits<{
  add: []
  remove: [index: number | null]
}>()
</script>

<template>
  <section class="panel-card">
    <h2 class="panel-title">
      Movelist
      <span class="panel-subtle">name editable · details from moves.json · Struggle auto-added</span>
      <button type="button" class="row-add" @click="emit('add')">
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
            :key="row.automatic ? `auto-${row.move.name}-${i}` : `sheet-${row.sheetIndex ?? i}`"
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
            <td>{{ formatLookupValue(row.damageBase) }}</td>
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
                @click="emit('remove', row.sheetIndex)"
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

<style scoped src="./sheetLookupPanel.css"></style>
