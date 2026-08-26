<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhArrowDown, PhArrowUp, PhPlus, PhTrash } from '@phosphor-icons/vue'
import pokedexJson from '../../../data/reference/pokedex.json'
import {
  CANONICAL_ENCOUNTER_HABITATS,
  ENCOUNTER_TIME_OF_DAY_VALUES,
  ENCOUNTER_WEATHER_VALUES,
} from '#shared/gmToolkit/encounterTables'
import type { GmEncounterTableDraftV1 } from '~/types/gmCampaignToolkit'

const props = defineProps<{
  modelValue: GmEncounterTableDraftV1
  mode: 'create' | 'edit'
  saving: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: GmEncounterTableDraftV1]
  save: []
  cancel: []
}>()

const clone = (value: GmEncounterTableDraftV1): GmEncounterTableDraftV1 => structuredClone(value)
const local = ref(clone(props.modelValue))
watch(() => props.modelValue, value => { local.value = clone(value) }, { deep: true })
const changed = (): void => emit('update:modelValue', clone(local.value))

const canonicalSpecies = new Set(
  (pokedexJson as readonly { readonly species?: unknown }[])
    .map(row => row.species)
    .filter((species): species is string => typeof species === 'string'),
)
const canonicalHabitats = new Set(CANONICAL_ENCOUNTER_HABITATS)

const errors = computed(() => {
  const result: string[] = []
  if (!local.value.name.trim()) result.push('Name is required.')
  if (local.value.name.trim().length > 80) result.push('Name must be 80 characters or fewer.')
  if (local.value.environmentTags.length === 0) result.push('Choose at least one canonical habitat.')
  for (const tag of local.value.environmentTags) if (!canonicalHabitats.has(tag)) result.push(`“${tag}” is not a canonical habitat.`)
  const speciesRows = local.value.rows.filter(row => row.kind === 'species')
  if (speciesRows.length === 0) result.push('Add at least one species row.')
  if (local.value.rows.length > 50) result.push('A table may contain at most 50 rows.')
  if (local.value.rows.filter(row => row.kind === 'nothing').length > 1) result.push('Only one Nothing row is allowed.')
  local.value.rows.forEach((row, index) => {
    if (!Number.isInteger(row.weight) || row.weight < 1) result.push(`Row ${index + 1} needs a positive whole-number weight.`)
    if (row.kind === 'species') {
      if (!row.speciesId || !canonicalSpecies.has(row.speciesId)) result.push(`Row ${index + 1} must name a canonical species.`)
      if (!Number.isInteger(row.minLevel) || !Number.isInteger(row.maxLevel)
        || Number(row.minLevel) < 1 || Number(row.maxLevel) > 100 || Number(row.minLevel) > Number(row.maxLevel)) {
        result.push(`Row ${index + 1} needs an ordered level range from 1 to 100.`)
      }
    }
  })
  const group = local.value.groupSizePolicy
  if (!Number.isInteger(group.minimum) || !Number.isInteger(group.maximum)
    || group.minimum < 1 || group.maximum > 30 || group.minimum > group.maximum) {
    result.push('Group size must be an ordered range from 1 to 30.')
  }
  if (group.kind === 'fixed' && (group.minimum !== group.maximum || group.perAdditionalTrainer !== 0)) {
    result.push('Fixed group size requires equal bounds and no party scaling.')
  }
  return [...new Set(result)]
})

const isValid = computed(() => errors.value.length === 0)
const addSpecies = (): void => {
  if (local.value.rows.length >= 50) return
  local.value.rows.push({ kind: 'species', speciesId: 'Pidgey', weight: 1, minLevel: 1, maxLevel: 5, predicates: { timeOfDay: [], weather: [] } })
  changed()
}
const addNothing = (): void => {
  if (local.value.rows.length >= 50 || local.value.rows.some(row => row.kind === 'nothing')) return
  local.value.rows.push({ kind: 'nothing', weight: 60, predicates: { timeOfDay: [], weather: [] } })
  changed()
}
const removeRow = (index: number): void => { local.value.rows.splice(index, 1); changed() }
const moveRow = (index: number, delta: number): void => {
  const target = index + delta
  if (target < 0 || target >= local.value.rows.length) return
  const [row] = local.value.rows.splice(index, 1)
  if (row) local.value.rows.splice(target, 0, row)
  changed()
}
const toggleArray = (values: string[], value: string, checked: boolean): void => {
  const index = values.indexOf(value)
  if (checked && index < 0) values.push(value)
  if (!checked && index >= 0) values.splice(index, 1)
  changed()
}
const habitatText = computed({
  get: () => local.value.environmentTags.join(', '),
  set: (value: string) => {
    local.value.environmentTags = [...new Set(value.split(',').map(entry => entry.trim()).filter(Boolean))]
    changed()
  },
})
const submit = (): void => { changed(); if (isValid.value) emit('save') }
</script>

<template>
  <form class="table-editor" novalidate @submit.prevent="submit">
    <header class="editor-heading">
      <div>
        <p class="eyebrow">{{ mode === 'create' ? 'New campaign table' : 'Edit accepted revision' }}</p>
        <h2>{{ mode === 'create' ? 'Create encounter table' : local.name || 'Untitled encounter table' }}</h2>
      </div>
      <span class="draft-chip">Draft — not saved</span>
    </header>

    <section class="form-section" aria-labelledby="table-basics-heading">
      <h3 id="table-basics-heading">Table basics</h3>
      <div class="field-grid">
        <label class="wide-field"><span>Name</span><input v-model="local.name" maxlength="80" autocomplete="off" @input="changed"></label>
        <label class="wide-field"><span>Habitats <small>comma separated</small></span><input v-model="habitatText" list="canonical-habitats" autocomplete="off"><datalist id="canonical-habitats"><option v-for="tag in CANONICAL_ENCOUNTER_HABITATS" :key="tag" :value="tag" /></datalist></label>
        <label><span>Group policy</span><select v-model="local.groupSizePolicy.kind" @change="changed"><option value="fixed">Fixed</option><option value="party-scale">Party scale</option></select></label>
        <label><span>Minimum group</span><input v-model.number="local.groupSizePolicy.minimum" type="number" min="1" max="30" inputmode="numeric" @input="changed"></label>
        <label><span>Maximum group</span><input v-model.number="local.groupSizePolicy.maximum" type="number" min="1" max="30" inputmode="numeric" @input="changed"></label>
        <label><span>Per extra Trainer</span><input v-model.number="local.groupSizePolicy.perAdditionalTrainer" type="number" min="0" max="30" inputmode="numeric" :disabled="local.groupSizePolicy.kind === 'fixed'" @input="changed"></label>
      </div>
      <fieldset>
        <legend>Table availability · time</legend>
        <label v-for="value in ENCOUNTER_TIME_OF_DAY_VALUES" :key="value" class="check-chip"><input type="checkbox" :checked="local.predicates.timeOfDay.includes(value)" @change="toggleArray(local.predicates.timeOfDay, value, ($event.target as HTMLInputElement).checked)"><span>{{ value }}</span></label>
      </fieldset>
      <fieldset>
        <legend>Table availability · weather</legend>
        <label v-for="value in ENCOUNTER_WEATHER_VALUES" :key="value" class="check-chip"><input type="checkbox" :checked="local.predicates.weather.includes(value)" @change="toggleArray(local.predicates.weather, value, ($event.target as HTMLInputElement).checked)"><span>{{ value }}</span></label>
      </fieldset>
    </section>

    <section class="form-section" aria-labelledby="weighted-rows-heading">
      <header class="section-heading">
        <div><h3 id="weighted-rows-heading">Weighted rows</h3><p>Weights are relative. Nothing is an explicit no-encounter result.</p></div>
        <div class="row-add-actions"><button type="button" @click="addSpecies"><PhPlus :size="16" aria-hidden="true" /> Species</button><button type="button" :disabled="local.rows.some(row => row.kind === 'nothing')" @click="addNothing"><PhPlus :size="16" aria-hidden="true" /> Nothing</button></div>
      </header>

      <ol class="row-list">
        <li v-for="(row, index) in local.rows" :key="row.rowId ?? `new-${index}`" class="weighted-row">
          <div class="row-order"><span>{{ index + 1 }}</span><button type="button" :disabled="index === 0" :aria-label="`Move row ${index + 1} up`" @click="moveRow(index, -1)"><PhArrowUp :size="16" /></button><button type="button" :disabled="index === local.rows.length - 1" :aria-label="`Move row ${index + 1} down`" @click="moveRow(index, 1)"><PhArrowDown :size="16" /></button></div>
          <div class="row-fields">
            <template v-if="row.kind === 'species'">
              <label class="species-field"><span>Species</span><input v-model="row.speciesId" autocomplete="off" :aria-invalid="!row.speciesId || !canonicalSpecies.has(row.speciesId)" @input="changed"></label>
              <label><span>Weight</span><input v-model.number="row.weight" type="number" min="1" max="1000000" inputmode="numeric" @input="changed"></label>
              <label><span>Min level</span><input v-model.number="row.minLevel" type="number" min="1" max="100" inputmode="numeric" @input="changed"></label>
              <label><span>Max level</span><input v-model.number="row.maxLevel" type="number" min="1" max="100" inputmode="numeric" @input="changed"></label>
            </template>
            <template v-else>
              <div class="nothing-label"><span>Outcome</span><strong>Nothing</strong></div>
              <label><span>Weight</span><input v-model.number="row.weight" type="number" min="1" max="1000000" inputmode="numeric" @input="changed"></label>
            </template>
            <details class="row-availability">
              <summary>Availability</summary>
              <div><span>Time</span><label v-for="value in ENCOUNTER_TIME_OF_DAY_VALUES" :key="value" class="check-chip"><input type="checkbox" :checked="row.predicates.timeOfDay.includes(value)" @change="toggleArray(row.predicates.timeOfDay, value, ($event.target as HTMLInputElement).checked)"><span>{{ value }}</span></label></div>
              <div><span>Weather</span><label v-for="value in ENCOUNTER_WEATHER_VALUES" :key="value" class="check-chip"><input type="checkbox" :checked="row.predicates.weather.includes(value)" @change="toggleArray(row.predicates.weather, value, ($event.target as HTMLInputElement).checked)"><span>{{ value }}</span></label></div>
            </details>
          </div>
          <button type="button" class="remove-row" :aria-label="`Remove row ${index + 1}`" @click="removeRow(index)"><PhTrash :size="18" /></button>
        </li>
      </ol>
    </section>

    <section class="form-section"><label class="notes-field"><span>GM notes</span><textarea v-model="local.notes" maxlength="4000" rows="4" placeholder="Private preparation context" @input="changed" /></label></section>

    <aside class="validation-summary" :class="{ valid: isValid }" :aria-live="errors.length ? 'assertive' : 'polite'">
      <strong>{{ isValid ? 'Ready to save' : `${errors.length} ${errors.length === 1 ? 'issue' : 'issues'} to resolve` }}</strong>
      <ul v-if="errors.length"><li v-for="error in errors" :key="error">{{ error }}</li></ul>
      <p v-else>All table rows and bounded policies are valid.</p>
    </aside>

    <footer class="editor-actions">
      <button type="button" class="secondary-action" :disabled="saving" @click="emit('cancel')">Cancel</button>
      <button type="submit" class="commit-action" :disabled="saving || !isValid">{{ saving ? 'Saving accepted revision…' : mode === 'create' ? 'Create table' : 'Save table' }}</button>
    </footer>
  </form>
</template>

<style scoped>
.table-editor { display: grid; gap: 1rem; }
.editor-heading, .section-heading, .editor-actions { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.eyebrow { margin: 0 0 0.25rem; color: var(--accent); font: 800 0.72rem var(--font-mono); letter-spacing: 0.12em; text-transform: uppercase; }
h2, h3, p { margin-top: 0; }
h2 { margin-bottom: 0; }
h3 { margin-bottom: 0.65rem; font-size: 1rem; }
.draft-chip { flex: none; border: 1px solid color-mix(in srgb, #efb34c 60%, var(--rule)); border-radius: 999px; padding: 0.3rem 0.58rem; color: #efb34c; font: 750 0.7rem var(--font-mono); }
.form-section { border: 1px solid var(--rule-soft); border-radius: 12px; padding: 1rem; background: color-mix(in srgb, var(--paper) 45%, transparent); }
.field-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.7rem; }
.wide-field { grid-column: span 2; }
label > span, .nothing-label > span { display: block; margin-bottom: 0.3rem; color: var(--ink-muted); font-size: 0.72rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; }
label small { font-weight: 500; letter-spacing: 0; text-transform: none; }
input, select, textarea { width: 100%; min-height: 44px; border: 1px solid var(--rule); border-radius: 8px; padding: 0.55rem 0.65rem; background: var(--paper-deep); color: var(--ink); font: inherit; box-sizing: border-box; }
textarea { resize: vertical; }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
fieldset { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.9rem 0 0; border: 0; padding: 0; }
legend { width: 100%; margin-bottom: 0.4rem; color: var(--ink-muted); font-size: 0.72rem; font-weight: 800; text-transform: uppercase; }
.check-chip { position: relative; }
.check-chip input { position: absolute; opacity: 0; pointer-events: none; }
.check-chip > span { display: inline-flex; min-height: 44px; align-items: center; margin: 0; border: 1px solid var(--rule); border-radius: 999px; padding: 0.35rem 0.65rem; color: var(--ink-muted); font: 700 0.72rem var(--font-mono); text-transform: capitalize; cursor: pointer; }
.check-chip input:checked + span { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.check-chip input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
.section-heading p { margin-bottom: 0; color: var(--ink-muted); font-size: 0.83rem; }
.row-add-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.row-add-actions button, .secondary-action { min-height: 44px; display: inline-flex; align-items: center; gap: 0.35rem; border: 1px solid var(--rule); border-radius: 8px; padding: 0.5rem 0.7rem; background: var(--paper-soft); color: var(--ink); font: inherit; font-weight: 700; cursor: pointer; }
.row-list { display: grid; gap: 0.6rem; margin: 1rem 0 0; padding: 0; list-style: none; }
.weighted-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0.7rem; align-items: start; border: 1px solid var(--rule); border-radius: 10px; padding: 0.7rem; background: var(--paper-soft); }
.row-order { display: grid; grid-template-columns: repeat(2, 44px); gap: 0.2rem; }
.row-order > span { grid-column: 1 / -1; color: var(--ink-muted); text-align: center; font: 800 0.72rem var(--font-mono); }
.row-order button, .remove-row { width: 44px; height: 44px; display: inline-grid; place-items: center; border: 1px solid var(--rule); border-radius: 7px; background: transparent; color: var(--ink-muted); cursor: pointer; }
.remove-row:hover { border-color: var(--accent-strong, #ff4553); color: var(--accent-strong, #ff4553); }
button:disabled { opacity: 0.46; cursor: not-allowed; }
.row-fields { display: grid; grid-template-columns: minmax(150px, 2fr) repeat(3, minmax(78px, 0.7fr)); gap: 0.55rem; }
.nothing-label { align-self: center; }
.row-availability { grid-column: 1 / -1; border-top: 1px solid var(--rule-soft); padding-top: 0.5rem; color: var(--ink-muted); }
.row-availability summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 700; }
.row-availability > div { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; margin-top: 0.4rem; }
.row-availability > div > span { min-width: 4rem; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; }
.validation-summary { border: 1px solid color-mix(in srgb, #efb34c 55%, var(--rule)); border-left-width: 4px; border-radius: 10px; padding: 0.8rem 1rem; background: color-mix(in srgb, #efb34c 7%, transparent); color: var(--ink); }
.validation-summary.valid { border-color: color-mix(in srgb, #67d7ad 60%, var(--rule)); background: color-mix(in srgb, #67d7ad 7%, transparent); }
.validation-summary p, .validation-summary ul { margin: 0.35rem 0 0; color: var(--ink-muted); font-size: 0.82rem; }
.editor-actions { justify-content: flex-end; align-items: center; padding-top: 0.4rem; }
.secondary-action, .commit-action { min-height: 44px; border-radius: 9px; padding: 0.65rem 1rem; font: inherit; font-weight: 800; cursor: pointer; }
.commit-action { border: 1px solid var(--accent-strong, #ff4553); background: var(--accent-strong, #e82535); color: var(--rt-on-brand, #07090d); }
.commit-action:hover:not(:disabled) { filter: brightness(1.1); }

@media (max-width: 760px) { .field-grid { grid-template-columns: 1fr 1fr; } .wide-field { grid-column: 1 / -1; } .row-fields { grid-template-columns: 1fr 1fr; } .species-field, .row-availability { grid-column: 1 / -1; } }
@media (max-width: 500px) { .editor-heading, .section-heading { flex-direction: column; } .field-grid, .row-fields { grid-template-columns: 1fr; } .wide-field, .species-field, .row-availability { grid-column: auto; } .weighted-row { grid-template-columns: minmax(0, 1fr) auto; } .row-order { grid-column: 1 / -1; grid-template-columns: 44px 44px 44px; justify-content: start; } .row-order > span { grid-column: auto; align-self: center; } .editor-actions { display: grid; grid-template-columns: 1fr 1fr; } }
</style>
