<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import { SHEET_ABILITY_NAME_OPTIONS, setLookupAbilityName } from '~/utils/sheetAbilityLookup'
import type { TrainerSheetAbilityLookupRow } from '~/composables/sheets/useTrainerSheetDerived'
import { formatLookupValue } from '~/utils/sheetMoveLookup'

defineProps<{
  abilityRows: readonly TrainerSheetAbilityLookupRow[]
}>()

const emit = defineEmits<{
  add: []
  remove: [index: number]
}>()
</script>

<template>
  <section class="panel-card">
    <h2 class="panel-title">
      Abilities
      <span class="panel-subtle">name editable · details from abilities.json · feature abilities auto-added</span>
      <button type="button" class="row-add" @click="emit('add')">
        <PhPlus :size="14" weight="bold" /> Add row
      </button>
    </h2>
    <table class="kv-table">
      <thead>
        <tr><th>Name</th><th>Frequency</th><th>Trigger</th><th>Effect</th><th aria-label="Row actions"></th></tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in abilityRows" :key="row.automatic ? `auto-${row.ability.name}-${i}` : `sheet-${row.sheetIndex ?? i}`" :class="{ 'move-row--automatic': row.automatic }">
          <td class="kv-name">
            <EditableCell
              :model-value="row.ability.name"
              type="select"
              placeholder="Ability"
              :options="SHEET_ABILITY_NAME_OPTIONS"
              :readonly="row.automatic"
              @update:model-value="(v) => setLookupAbilityName(row.ability, v)"
            />
            <span v-if="row.automatic" class="move-auto-badge" :title="`Auto-added from ${row.sourceLabel || 'trainer features'}`">auto</span>
          </td>
          <td>{{ formatLookupValue(row.reference?.frequency) }}</td>
          <td class="move-effect">{{ formatLookupValue(row.reference?.trigger) }}</td>
          <td class="move-effect">
            <span v-if="row.reference?.effect">{{ row.reference.effect }}</span>
            <span v-else class="badge-empty">{{ row.reference ? '—' : row.ability.name.trim() ? 'No matching ability in abilities.json' : '—' }}</span>
          </td>
          <td class="row-actions">
            <button v-if="!row.automatic" type="button" class="row-remove" title="Remove ability" @click="emit('remove', row.sheetIndex ?? i)">
              <PhX :size="14" weight="bold" />
            </button>
            <span v-else class="row-auto-note" :title="`Auto-added from ${row.sourceLabel || 'trainer features'}`">Auto</span>
          </td>
        </tr>
        <tr v-if="!abilityRows.length">
          <td colspan="5" class="empty-cell">No abilities yet.</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped src="./sheetLookupPanel.css"></style>
