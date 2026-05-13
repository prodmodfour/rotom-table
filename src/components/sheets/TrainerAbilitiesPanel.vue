<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import { setLookupAbilityName } from '~/utils/sheetAbilityLookup'
import type { AbilityLookupRow } from '~/utils/sheetAbilityLookup'
import { formatLookupValue } from '~/utils/sheetMoveLookup'
import type { TrainerAbilityEntry } from '~/types/trainerSheet'

defineProps<{
  abilityRows: readonly AbilityLookupRow<TrainerAbilityEntry>[]
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
      <span class="panel-subtle">name editable · details from abilities.json</span>
      <button type="button" class="row-add" @click="emit('add')">
        <PhPlus :size="14" weight="bold" /> Add row
      </button>
    </h2>
    <table class="kv-table">
      <thead>
        <tr><th>Name</th><th>Frequency</th><th>Trigger</th><th>Effect</th><th aria-label="Row actions"></th></tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in abilityRows" :key="i">
          <td class="kv-name">
            <EditableCell
              :model-value="row.ability.name"
              placeholder="Ability"
              @update:model-value="(v) => setLookupAbilityName(row.ability, v)"
            />
          </td>
          <td>{{ formatLookupValue(row.reference?.frequency) }}</td>
          <td class="move-effect">{{ formatLookupValue(row.reference?.trigger) }}</td>
          <td class="move-effect">
            <span v-if="row.reference?.effect">{{ row.reference.effect }}</span>
            <span v-else class="badge-empty">{{ row.reference ? '—' : row.ability.name.trim() ? 'No matching ability in abilities.json' : '—' }}</span>
          </td>
          <td class="row-actions">
            <button type="button" class="row-remove" title="Remove ability" @click="emit('remove', i)">
              <PhX :size="14" weight="bold" />
            </button>
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
