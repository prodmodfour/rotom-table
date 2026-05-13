<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import { setLookupAbilityName, type AbilityLookupRow } from '~/utils/sheetAbilityLookup'
import { formatLookupValue } from '~/utils/sheetMoveLookup'
import type { CharacterSheet, CharacterSheetAbility } from '~/types/characterSheet'

defineProps<{
  sheet: CharacterSheet
  abilityRows: readonly AbilityLookupRow<CharacterSheetAbility>[]
}>()

const emit = defineEmits<{
  addAbility: []
  removeAbility: [index: number]
  addEdge: []
  removeEdge: [index: number]
}>()
</script>

<template>
  <div class="row two-col">
    <section class="panel-card">
      <h2 class="panel-title">
        Abilities
        <span class="panel-subtle">name editable · details from abilities.json</span>
        <button type="button" class="row-add" @click="emit('addAbility')">
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
              <button
                type="button"
                class="row-remove"
                title="Remove ability"
                @click="emit('removeAbility', i)"
              >
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

    <section class="panel-card">
      <h2 class="panel-title">
        Poké Edges
        <button type="button" class="row-add" @click="emit('addEdge')">
          <PhPlus :size="14" weight="bold" /> Add row
        </button>
      </h2>
      <table class="kv-table">
        <thead>
          <tr><th>Name</th><th>Cost</th><th>Effect</th><th aria-label="Row actions"></th></tr>
        </thead>
        <tbody>
          <tr v-for="(edge, i) in sheet.edges" :key="i">
            <td class="kv-name">
              <EditableCell v-model="edge.name" placeholder="Edge" />
            </td>
            <td><EditableCell v-model="edge.cost" placeholder="—" /></td>
            <td>
              <EditableCell
                v-model="edge.effect"
                type="textarea"
                placeholder="—"
                multiline
              />
            </td>
            <td class="row-actions">
              <button
                type="button"
                class="row-remove"
                title="Remove edge"
                @click="emit('removeEdge', i)"
              >
                <PhX :size="14" weight="bold" />
              </button>
            </td>
          </tr>
          <tr v-if="!sheet.edges?.length">
            <td colspan="4" class="empty-cell">No edges yet.</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped src="./sheetLookupPanel.css"></style>
<style scoped>
.row {
  display: grid;
  gap: 0.85rem;
}

.row.two-col { grid-template-columns: repeat(2, minmax(0, 1fr)); }

@media (max-width: 980px) {
  .row.two-col { grid-template-columns: 1fr; }
}
</style>
