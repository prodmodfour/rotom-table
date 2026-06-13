<script setup lang="ts">
import { computed } from 'vue'
import { PhPlus, PhX } from '@phosphor-icons/vue'
import type { EditableCellValue } from '~/utils/editableCell'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import { setLookupMoveName } from '~/utils/sheetMoveLookup'
import {
  POKEMON_EGG_MOVE_AUTOFILL_COLUMNS,
  POKEMON_EGG_MOVE_NAME_COLUMN,
  POKEMON_EGG_MOVE_NAME_OPTIONS,
  pokemonEggMoveFieldValue,
  type PokemonEggMoveAutofillField,
} from '~/utils/sheets/pokemonEggMoves'

const props = defineProps<{
  sheet: CharacterSheet
}>()

const sheet = computed(() => props.sheet)

const emit = defineEmits<{
  addEggMove: []
  removeEggMove: [index: number]
}>()

const eggMoveCount = computed(() => sheet.value.eggMoves?.length ?? 0)

const autofillValue = (move: CharacterSheetMove, field: PokemonEggMoveAutofillField): string =>
  pokemonEggMoveFieldValue(move, field)

const setEggMoveName = (move: CharacterSheetMove, value: EditableCellValue) => {
  setLookupMoveName(move, value)
}
</script>

<template>
  <section class="tab-panel">
    <div class="block">
      <h2 class="block-title">
        Egg Moves ({{ eggMoveCount }})
        <button type="button" class="row-add" @click="emit('addEggMove')">
          <PhPlus :size="14" weight="bold" /> Add row
        </button>
      </h2>
      <div class="table-scroll">
        <table class="data-table egg-moves-table">
          <thead>
            <tr>
              <th>{{ POKEMON_EGG_MOVE_NAME_COLUMN.label }}</th>
              <th
                v-for="column in POKEMON_EGG_MOVE_AUTOFILL_COLUMNS"
                :key="column.key"
              >{{ column.label }}</th>
              <th aria-label="Row actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(move, index) in sheet.eggMoves" :key="index">
              <th class="egg-move-name-col">
                <EditableCell
                  :model-value="move.name"
                  type="select"
                  :options="POKEMON_EGG_MOVE_NAME_OPTIONS"
                  placeholder="Move"
                  @update:model-value="(value) => setEggMoveName(move, value)"
                />
              </th>
              <td
                v-for="column in POKEMON_EGG_MOVE_AUTOFILL_COLUMNS"
                :key="column.key"
                class="auto-fill-col"
                :class="{ 'auto-fill-col--multiline': column.multiline }"
              >
                {{ autofillValue(move, column.key) || '—' }}
              </td>
              <td class="row-actions">
                <button type="button" class="row-remove" title="Remove egg move" @click="emit('removeEggMove', index)">
                  <PhX :size="14" weight="bold" />
                </button>
              </td>
            </tr>
            <tr v-if="!sheet.eggMoves?.length">
              <td :colspan="POKEMON_EGG_MOVE_AUTOFILL_COLUMNS.length + 2" class="muted">No egg moves recorded.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped src="./sheetTabTablePanel.css"></style>
<style scoped>
.egg-moves-table {
  min-width: 80rem;
}

.egg-move-name-col {
  min-width: 12rem;
}

.auto-fill-col {
  min-width: 8rem;
}
</style>
