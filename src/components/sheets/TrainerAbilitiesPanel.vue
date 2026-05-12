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
  <div class="block">
    <h2 class="block-title">
      Abilities
      <span class="move-lookup-note">name editable · details from abilities.json</span>
      <button type="button" class="row-add" @click="emit('add')">
        <PhPlus :size="14" weight="bold" /> Add row
      </button>
    </h2>
    <table class="data-table ability-table">
      <thead>
        <tr><th>Name</th><th>Frequency</th><th>Trigger</th><th>Effect</th><th aria-label="Row actions"></th></tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in abilityRows" :key="i">
          <th>
            <EditableCell
              :model-value="row.ability.name"
              placeholder="Ability"
              @update:model-value="(v) => setLookupAbilityName(row.ability, v)"
            />
          </th>
          <td>{{ formatLookupValue(row.reference?.frequency) }}</td>
          <td class="effect-col">{{ formatLookupValue(row.reference?.trigger) }}</td>
          <td class="effect-col">
            <span v-if="row.reference?.effect">{{ row.reference.effect }}</span>
            <span v-else class="badge-empty">{{ row.reference ? '—' : row.ability.name.trim() ? 'No matching ability in abilities.json' : '—' }}</span>
          </td>
          <td>
            <button type="button" class="row-remove" title="Remove ability" @click="emit('remove', i)">
              <PhX :size="14" weight="bold" />
            </button>
          </td>
        </tr>
        <tr v-if="!abilityRows.length">
          <td colspan="5" class="muted">No abilities yet.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped src="./trainerCombatActionPanel.css"></style>
