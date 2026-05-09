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

<style scoped>
.row {
  display: grid;
  gap: 0.85rem;
}

.row.two-col { grid-template-columns: repeat(2, minmax(0, 1fr)); }

@media (max-width: 980px) {
  .row.two-col { grid-template-columns: 1fr; }
}

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

.kv-table {
  width: 100%;
  border-collapse: collapse;
}

.kv-table th,
.kv-table td {
  padding: 0.45rem 0.55rem;
  border-bottom: 1px solid var(--rule);
  text-align: left;
  vertical-align: top;
}

.kv-table th {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
  font-weight: 600;
}

.kv-name {
  font-weight: 700;
  color: var(--ink-bright);
  letter-spacing: 0.02em;
}

.move-effect {
  color: var(--ink-soft);
  font-size: 0.88rem;
}

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
