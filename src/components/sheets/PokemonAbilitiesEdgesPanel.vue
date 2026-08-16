<script setup lang="ts">
import { PhLockKey, PhPlus, PhX } from '@phosphor-icons/vue'
import { SHEET_ABILITY_NAME_OPTIONS, setLookupAbilityName, type AbilityLookupRow } from '~/utils/sheetAbilityLookup'
import { formatLookupValue } from '~/utils/sheetMoveLookup'
import type { CharacterSheet, CharacterSheetAbility } from '~/types/characterSheet'
import type { EditableCellValue } from '~/utils/editableCell'
import {
  POKE_EDGE_NAME_OPTIONS,
  pokemonEdgeChoiceDefinitions,
  pokemonEdgeChoiceOptions,
  pokemonEdgeInspectorStatus,
  setPokemonEdgeChoice,
  setPokemonEdgeName,
} from '~/utils/sheets/pokemonEdges'

const props = defineProps<{
  sheet: CharacterSheet
  abilityRows: readonly AbilityLookupRow<CharacterSheetAbility>[]
}>()

const updateEdgeName = (index: number, value: EditableCellValue) => {
  const edge = props.sheet.edges?.[index]
  if (edge) setPokemonEdgeName(props.sheet, edge, index, value)
}

const updateEdgeChoice = (index: number, choiceId: string, value: EditableCellValue) => {
  const edge = props.sheet.edges?.[index]
  if (edge) setPokemonEdgeChoice(props.sheet, edge, index, choiceId, value)
}

const abilityIsEvolutionLocked = (index: number): boolean => (
  props.abilityRows[index]?.ability.itemEvolutionLocked === true
)
const abilityRemovalIsLocked = (index: number): boolean => abilityIsEvolutionLocked(index)
  || props.abilityRows.slice(index + 1).some(row => row.ability.itemEvolutionLocked === true)

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
        <span class="panel-subtle">ordinary names editable · evolved rows authoritative</span>
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
                type="select"
                placeholder="Ability"
                :options="SHEET_ABILITY_NAME_OPTIONS"
                :readonly="abilityIsEvolutionLocked(i)"
                @update:model-value="(v) => setLookupAbilityName(row.ability, v)"
              />
              <span v-if="abilityIsEvolutionLocked(i)" class="ability-authority-badge" title="Mapped by accepted Evolutionary Item authority">
                <PhLockKey :size="12" weight="bold" aria-hidden="true" /> Evolved
              </span>
            </td>
            <td>{{ formatLookupValue(row.reference?.frequency) }}</td>
            <td class="move-effect">{{ formatLookupValue(row.reference?.trigger) }}</td>
            <td class="move-effect">
              <span v-if="row.reference?.effect">{{ row.reference.effect }}</span>
              <span v-else class="badge-empty">{{ row.reference ? '—' : row.ability.name.trim() ? 'No matching ability in abilities.json' : '—' }}</span>
            </td>
            <td class="row-actions">
              <button
                v-if="!abilityRemovalIsLocked(i)"
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
          <tr v-for="(edge, i) in sheet.edges" :key="edge.automation?.instanceId ?? i">
            <td class="kv-name">
              <div class="edge-editor-stack">
                <EditableCell
                  :model-value="edge.name"
                  type="select"
                  placeholder="Choose Poké Edge"
                  :options="POKE_EDGE_NAME_OPTIONS"
                  @update:model-value="(value) => updateEdgeName(i, value)"
                />
                <label
                  v-for="definition in pokemonEdgeChoiceDefinitions(edge)"
                  :key="definition.id"
                  class="edge-choice"
                >
                  <span>{{ definition.kind.replaceAll('-', ' ') }}</span>
                  <EditableCell
                    :model-value="edge.choices?.[definition.id]"
                    type="select"
                    :placeholder="`Choose ${definition.kind.replaceAll('-', ' ')}`"
                    :options="pokemonEdgeChoiceOptions(sheet, edge, definition)"
                    @update:model-value="(value) => updateEdgeChoice(i, definition.id, value)"
                  />
                </label>
                <span
                  class="edge-automation-status"
                  :class="`edge-automation-status--${pokemonEdgeInspectorStatus(sheet, edge, i).status}`"
                  :title="pokemonEdgeInspectorStatus(sheet, edge, i).diagnostics.join('\n')"
                >{{ pokemonEdgeInspectorStatus(sheet, edge, i).label }}</span>
              </div>
            </td>
            <td>{{ edge.cost ?? '—' }}</td>
            <td class="move-effect">{{ edge.effect || '—' }}</td>
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

.ability-authority-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  width: fit-content;
  margin-top: 0.25rem;
  border: 1px solid color-mix(in srgb, var(--rt-success) 52%, var(--rule));
  border-radius: 999px;
  padding: 0.08rem 0.38rem;
  color: var(--rt-success);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.edge-editor-stack {
  display: grid;
  gap: 0.35rem;
  min-width: 12rem;
}

.edge-choice {
  display: grid;
  gap: 0.15rem;
}

.edge-choice > span {
  color: var(--ink-muted);
  font-size: 0.67rem;
  letter-spacing: 0.06em;
  text-transform: capitalize;
}

.edge-automation-status {
  width: fit-content;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  color: var(--ink-muted);
  font-size: 0.65rem;
  padding: 0.1rem 0.4rem;
}

.edge-automation-status--ready { border-color: var(--accent); color: var(--accent); }
.edge-automation-status--malformed,
.edge-automation-status--unresolved-identity { color: var(--danger, #c95f5f); }

@media (max-width: 980px) {
  .row.two-col { grid-template-columns: 1fr; }
}
</style>
