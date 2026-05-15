<script setup lang="ts">
import { PhDotsSixVertical, PhPlus, PhX } from '@phosphor-icons/vue'
import { useSheetMoveRowDragReorder } from '~/composables/sheets/useSheetMoveRowDragReorder'
import { formatLookupValue, setLookupMoveName } from '~/utils/sheetMoveLookup'
import type { PokemonSheetMoveLookupRow } from '~/composables/sheets/usePokemonSheetDerived'

defineProps<{
  moveRows: readonly PokemonSheetMoveLookupRow[]
}>()

const emit = defineEmits<{
  addMove: []
  removeMove: [index: number | null]
  reorderMove: [fromIndex: number, toIndex: number]
}>()

const {
  canDragMoveRow,
  moveRowDragClass,
  onMoveRowDragStart,
  onMoveRowDragEnter,
  onMoveRowDragOver,
  onMoveRowDrop,
  onMoveRowDragEnd,
  reorderMoveRowByOffset,
} = useSheetMoveRowDragReorder((fromIndex, toIndex) => emit('reorderMove', fromIndex, toIndex))
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
            <th class="move-reorder-heading" aria-label="Move order"></th>
            <th>Name</th>
            <th>Type</th>
            <th>Cat.</th>
            <th>DB</th>
            <th>Damage</th>
            <th>Freq</th>
            <th>AC</th>
            <th>Range</th>
            <th>Effect</th>
            <th>Special</th>
            <th aria-label="Row actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in moveRows"
            :key="row.automatic ? `auto-${row.move.name}-${i}` : `sheet-${row.sheetIndex ?? i}`"
            :class="moveRowDragClass(row)"
            @dragenter="onMoveRowDragEnter($event, row)"
            @dragover="onMoveRowDragOver($event, row)"
            @drop="onMoveRowDrop($event, row)"
          >
            <td class="move-reorder-cell">
              <button
                v-if="canDragMoveRow(row)"
                type="button"
                class="move-drag-handle"
                draggable="true"
                :aria-label="`Drag ${row.move.name.trim() || 'blank move'} to reorder`"
                title="Drag to reorder move. Focus and use ↑/↓ as an alternative."
                @dragstart="onMoveRowDragStart($event, row)"
                @dragend="onMoveRowDragEnd"
                @keydown.up.prevent="reorderMoveRowByOffset(row, -1)"
                @keydown.down.prevent="reorderMoveRowByOffset(row, 1)"
              >
                <PhDotsSixVertical :size="16" weight="bold" />
              </button>
              <span v-else class="move-drag-placeholder" aria-hidden="true"></span>
            </td>
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
            <td>
              {{ formatLookupValue(row.damageFormula) }}
              <span
                v-if="row.attackStatAbility"
                class="move-derived-bonus"
                :title="`${row.attackStatAbility}: adds ${row.additionalAttackStatLabel ?? 'alternate stat'} to this damage roll`"
              >{{ row.attackStatAbility }}</span>
            </td>
            <td>{{ formatLookupValue(row.reference?.frequency) }}</td>
            <td>{{ formatLookupValue(row.ac) }}</td>
            <td>{{ formatLookupValue(row.reference?.range) }}</td>
            <td class="move-effect">
              <span v-if="row.reference?.effect">{{ row.reference.effect }}</span>
              <span v-else class="badge-empty">{{ row.reference || !row.move.name.trim() ? '—' : 'No matching move in moves.json' }}</span>
            </td>
            <td class="move-effect">
              <span v-if="row.reference?.special">{{ row.reference.special }}</span>
              <span v-else class="badge-empty">—</span>
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
            <td colspan="12" class="empty-cell">No moves yet — click "Add row" to start.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped src="./sheetLookupPanel.css"></style>
