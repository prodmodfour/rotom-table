<script setup lang="ts">
import { computed } from 'vue'
import { PhPlus, PhX } from '@phosphor-icons/vue'
import type { EditableCellValue } from '~/utils/editableCell'
import type { CharacterSheet, CharacterSheetAppliedMove, CharacterSheetMove } from '~/types/characterSheet'
import type { PokedexLevelUpMove } from '~/types/pokemon'
import { setLookupMoveName } from '~/utils/sheetMoveLookup'
import {
  coercePokemonAppliedMoveSource,
  POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS,
  POKEMON_KNOWN_MOVE_NAME_OPTIONS,
  POKEMON_KNOWN_MOVE_SOURCE_OPTIONS,
  pokemonAppliedMoveSourceLabel,
  pokemonKnownLevelUpMoveFieldValue,
  pokemonKnownMoveFieldValue,
  type PokemonKnownMoveAutofillField,
} from '~/utils/sheets/pokemonKnownMoves'

const props = defineProps<{
  sheet: CharacterSheet
  unlockedLevelUpMoves: readonly PokedexLevelUpMove[]
}>()

const sheet = computed(() => props.sheet)

const emit = defineEmits<{
  addAppliedMove: []
  removeAppliedMove: [index: number]
}>()

const levelUpMoveCount = computed(() => props.unlockedLevelUpMoves.length)
const eggMoveCount = computed(() => sheet.value.eggMoves?.length ?? 0)
const appliedMoveCount = computed(() => sheet.value.appliedMoves?.length ?? 0)
const knownMoveCount = computed(() => levelUpMoveCount.value + appliedMoveCount.value)

const levelUpMoveKey = (move: PokedexLevelUpMove, index: number): string => `${move.level}-${move.name}-${index}`

const autofillValue = (move: CharacterSheetMove, field: PokemonKnownMoveAutofillField): string =>
  pokemonKnownMoveFieldValue(move, field)

const levelUpAutofillValue = (move: PokedexLevelUpMove, field: PokemonKnownMoveAutofillField): string =>
  pokemonKnownLevelUpMoveFieldValue(move, field)

const setMoveName = (move: CharacterSheetMove, value: EditableCellValue) => {
  setLookupMoveName(move, value)
}

const setAppliedMoveSource = (move: CharacterSheetAppliedMove, value: EditableCellValue) => {
  move.source = coercePokemonAppliedMoveSource(value)
}
</script>

<template>
  <section class="tab-panel">
    <div class="block known-moves-summary">
      <h2 class="block-title">Known Moves ({{ knownMoveCount }})</h2>
      <p>
        Level-up moves unlock from the current species and level. Accepted item-trained rows are
        read-only and replaced through Item Actions; Egg Move compatibility remains reference-only.
      </p>
    </div>

    <div class="block">
      <h2 class="block-title">Unlocked Level-Up Moves ({{ levelUpMoveCount }})</h2>
      <div class="table-scroll">
        <table class="data-table known-moves-table">
          <thead>
            <tr>
              <th>Level</th>
              <th>Move</th>
              <th
                v-for="column in POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS"
                :key="column.key"
              >{{ column.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(move, index) in unlockedLevelUpMoves" :key="levelUpMoveKey(move, index)">
              <td class="level-col">{{ move.level }}</td>
              <th class="known-move-name-col">{{ move.name }}</th>
              <td
                v-for="column in POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS"
                :key="column.key"
                class="auto-fill-col"
                :class="{ 'auto-fill-col--multiline': column.multiline }"
              >
                {{ levelUpAutofillValue(move, column.key) || '—' }}
              </td>
            </tr>
            <tr v-if="!unlockedLevelUpMoves.length">
              <td :colspan="POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS.length + 2" class="muted">
                No level-up moves are unlocked for the current species and level.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="block egg-move-compatibility">
      <h2 class="block-title">Egg Move Compatibility ({{ eggMoveCount }})</h2>
      <p class="compatibility-note">
        Read-only compatibility data. These rows do not establish lineage or learned Moves.
      </p>
      <div class="table-scroll">
        <table class="data-table known-moves-table">
          <thead>
            <tr>
              <th>Egg Move</th>
              <th
                v-for="column in POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS"
                :key="column.key"
              >{{ column.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(move, index) in sheet.eggMoves" :key="index">
              <th class="known-move-name-col">{{ move.name || 'Unnamed compatibility Move' }}</th>
              <td
                v-for="column in POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS"
                :key="column.key"
                class="auto-fill-col"
                :class="{ 'auto-fill-col--multiline': column.multiline }"
              >
                {{ autofillValue(move, column.key) || '—' }}
              </td>
            </tr>
            <tr v-if="!sheet.eggMoves?.length">
              <td :colspan="POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS.length + 1" class="muted">
                No Egg Move compatibility data recorded.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="block">
      <h2 class="block-title">
        Applied TM/Tutor Moves ({{ appliedMoveCount }})
        <button type="button" class="row-add" @click="emit('addAppliedMove')">
          <PhPlus :size="14" weight="bold" /> Add row
        </button>
      </h2>
      <div class="table-scroll">
        <table class="data-table known-moves-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Move</th>
              <th
                v-for="column in POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS"
                :key="column.key"
              >{{ column.label }}</th>
              <th aria-label="Row actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(move, index) in sheet.appliedMoves" :key="index">
              <td class="source-col">
                <EditableCell
                  :model-value="move.source"
                  type="select"
                  :options="POKEMON_KNOWN_MOVE_SOURCE_OPTIONS"
                  :format="pokemonAppliedMoveSourceLabel"
                  :allow-empty-option="false"
                  :readonly="move.itemMoveLearningLocked === true"
                  @update:model-value="(value) => setAppliedMoveSource(move, value)"
                />
              </td>
              <th class="known-move-name-col">
                <EditableCell
                  :model-value="move.name"
                  type="select"
                  :options="POKEMON_KNOWN_MOVE_NAME_OPTIONS"
                  placeholder="Move"
                  :readonly="move.itemMoveLearningLocked === true"
                  @update:model-value="(value) => setMoveName(move, value)"
                />
                <span
                  v-if="move.itemMoveLearningLocked === true"
                  class="trained-badge"
                  title="Managed by an accepted TM/HM training operation"
                >trained</span>
              </th>
              <td
                v-for="column in POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS"
                :key="column.key"
                class="auto-fill-col"
                :class="{ 'auto-fill-col--multiline': column.multiline }"
              >
                {{ autofillValue(move, column.key) || '—' }}
              </td>
              <td class="row-actions">
                <button
                  v-if="move.itemMoveLearningLocked !== true"
                  type="button"
                  class="row-remove"
                  title="Remove applied move"
                  @click="emit('removeAppliedMove', index)"
                >
                  <PhX :size="14" weight="bold" />
                </button>
                <span v-else class="trained-row-note">Item Action</span>
              </td>
            </tr>
            <tr v-if="!sheet.appliedMoves?.length">
              <td :colspan="POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS.length + 3" class="muted">
                No applied TM/HM or Tutor moves recorded.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped src="./sheetTabTablePanel.css"></style>
<style scoped>
.known-moves-summary p {
  margin: -0.15rem 0 0;
  color: var(--ink-soft);
  font-size: 0.88rem;
  line-height: 1.45;
}

.known-moves-table {
  min-width: 84rem;
}

.compatibility-note {
  margin: -0.15rem 0 0.65rem;
  max-width: 70ch;
  color: var(--ink-soft);
  font-size: 0.88rem;
  line-height: 1.45;
}

.known-move-name-col {
  min-width: 12rem;
}

.level-col,
.source-col {
  min-width: 6rem;
  color: var(--ink-bright);
  font-weight: 600;
}

.auto-fill-col {
  min-width: 8rem;
}

.trained-badge,
.trained-row-note {
  display: inline-flex;
  align-items: center;
  min-height: 1.5rem;
  margin-top: 0.25rem;
  padding: 0.1rem 0.45rem;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, transparent);
  border-radius: 999px;
  color: var(--accent);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.trained-row-note {
  margin-top: 0;
  white-space: nowrap;
}
</style>
