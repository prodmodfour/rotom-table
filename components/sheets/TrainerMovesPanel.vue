<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import { formatLookupValue, setLookupMoveName } from '~/utils/sheetMoveLookup'
import type { MoveLookupRow } from '~/utils/sheetMoveLookup'
import type { TrainerMove } from '~/types/trainerSheet'

defineProps<{
  moveRows: readonly MoveLookupRow<TrainerMove>[]
}>()

const emit = defineEmits<{
  add: []
  remove: [index: number]
}>()
</script>

<template>
  <div class="block">
    <h2 class="block-title">
      Movelist
      <span class="move-lookup-note">name editable · details from moves.json</span>
      <button type="button" class="row-add" @click="emit('add')">
        <PhPlus :size="14" weight="bold" /> Add row
      </button>
    </h2>
    <table class="data-table movelist-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Cat.</th>
          <th>DB</th>
          <th>Damage Roll</th>
          <th>Frequency</th>
          <th>AC</th>
          <th>Range</th>
          <th>Effect</th>
          <th aria-label="Row actions"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in moveRows" :key="i">
          <th>
            <EditableCell
              :model-value="row.move.name"
              placeholder="Move"
              @update:model-value="(v) => setLookupMoveName(row.move, v)"
            />
          </th>
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
          <td class="effect-col">
            <span v-if="row.reference?.effect">{{ row.reference.effect }}</span>
            <span v-else class="badge-empty">{{ row.move.name.trim() ? 'No matching move in moves.json' : '—' }}</span>
          </td>
          <td class="row-actions">
            <button type="button" class="row-remove" title="Remove move" @click="emit('remove', i)">
              <PhX :size="14" weight="bold" />
            </button>
          </td>
        </tr>
        <tr v-if="!moveRows.length">
          <td colspan="10" class="muted">No moves yet — click "Add row" to start.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped src="./trainerCombatActionPanel.css"></style>
<style scoped>
.movelist-table th,
.movelist-table td {
  vertical-align: top;
}
</style>
