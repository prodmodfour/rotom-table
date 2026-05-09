<script setup lang="ts">
import { characterSheetsBySlug } from '~/data/characterSheets'
import { normalizeCharacterSheet } from '~/utils/sheetNormalize'
import { useEditableSheetResource } from '~/composables/sheets/useEditableSheetResource'
import { usePokemonSheetDerived } from '~/composables/sheets/usePokemonSheetDerived'
import { usePokemonSheetCsvFields } from '~/composables/sheets/usePokemonSheetCsvFields'
import { usePokemonSheetRowActions } from '~/composables/sheets/usePokemonSheetRowActions'
import {
  syncNatureModForSheet,
  usePokemonNatureControls,
} from '~/composables/sheets/usePokemonNatureControls'
import type { CharacterSheet } from '~/types/characterSheet'

// ---------------------------------------------------------------------------
// Resolve the static sheet for this URL, then deep-clone + normalize it into
// an editable reactive copy. Every mutation auto-persists to disk via
// `/api/sheets/save` (see useEditableSheet).
// ---------------------------------------------------------------------------

// Route the page key off the slug so navigating from one Pokémon's sheet
// to another's forces a fresh component instance — otherwise Vue would
// reuse this one and our editable copy would still point at the old slug.
definePageMeta({
  key: (route) => `sheet-${route.params.slug}`,
})

const route = useRoute()
const { isGm, isPlayer } = useAuth()
const slug = String(route.params.slug ?? '')
const baseSheet = characterSheetsBySlug.get(slug) ?? null
const {
  sheet,
  saveStatus,
  saveError,
} = useEditableSheetResource<CharacterSheet>({
  baseSheet,
  kind: 'pokemon',
  isPlayer,
  normalize: normalizeCharacterSheet,
  prepareInitial: syncNatureModForSheet,
})

useHead(() => ({
  title: sheet.value
    ? `${sheet.value.nickname} (${sheet.value.species}) · Sheets`
    : 'Sheet not found · Rotom Table',
}))

// ---------------------------------------------------------------------------
// Derived data — every read goes through the reactive sheet so edits redraw
// the table totals, max-HP, skills grid, etc., automatically.
// ---------------------------------------------------------------------------

const {
  species,
  spriteUrl,
  stats,
  skills,
  sheetTypes,
  eggGroups,
  fullMaxHp,
  maxHp,
  currentHp,
  setCurrentHp,
  tickValue,
  hpThresholds,
  statPointsSpent,
  statPointsBudget,
  statPointsLeft,
  baseRelationViolations,
  visibleBaseRelationViolations,
  remainingBaseRelationViolationCount,
  pokemonEvasion,
  tutorPointsLeft,
  moveRows,
  abilityRows,
  heldItemName,
  heldItemReference,
  typeEffectivenessRows,
} = usePokemonSheetDerived(sheet)

// ---------------------------------------------------------------------------
// Editing helpers — these mutate the reactive sheet, which in turn fires the
// deep watcher inside useEditableSheet to persist the change.
// ---------------------------------------------------------------------------

const {
  genderOptions,
  natureOptions,
  naturePlusDisplay,
  natureMinusDisplay,
} = usePokemonNatureControls(sheet)

const {
  typesAsCsv,
  eggGroupsAsCsv,
  otherCapsCsv,
  skillBgRaisedCsv,
  skillBgLoweredCsv,
} = usePokemonSheetCsvFields({ sheet, sheetTypes, eggGroups })

const {
  setHeldItemName,
  addMove,
  removeMove,
  addAbility,
  removeAbility,
  addEdge,
  removeEdge,
  setStat,
  setEvasionBonus,
  setInheritedMove,
} = usePokemonSheetRowActions(sheet)
</script>

<template>
  <SheetPageShell
    :has-sheet="Boolean(sheet)"
    :save-status="saveStatus"
    :save-error="saveError"
  >
    <template v-if="sheet">
      <!-- ============ Identity strip ============ -->
      <PokemonIdentityPanel
        v-model:types-csv="typesAsCsv"
        v-model:egg-groups-csv="eggGroupsAsCsv"
        :sheet="sheet"
        :sprite-url="spriteUrl"
        :species="species"
        :sheet-types="sheetTypes"
        :gender-options="genderOptions"
        :nature-options="natureOptions"
        :nature-plus-display="naturePlusDisplay"
        :nature-minus-display="natureMinusDisplay"
        :is-gm="isGm"
      />

      <!-- ============ Stats + Combat strip ============ -->
      <div class="row two-col">
        <PokemonStatsPanel
          :stats="stats"
          :stat-points-left="statPointsLeft"
          :stat-points-spent="statPointsSpent"
          :stat-points-budget="statPointsBudget"
          :base-relation-violations="baseRelationViolations"
          :visible-base-relation-violations="visibleBaseRelationViolations"
          :remaining-base-relation-violation-count="remainingBaseRelationViolationCount"
          @set-stat="setStat"
        />

        <PokemonCombatPanel
          :sheet="sheet"
          :current-hp="currentHp"
          :max-hp="maxHp"
          :full-max-hp="fullMaxHp"
          :tick-value="tickValue"
          :hp-thresholds="hpThresholds"
          :pokemon-evasion="pokemonEvasion"
          @set-current-hp="setCurrentHp"
          @set-evasion-bonus="setEvasionBonus"
        />
      </div>

      <!-- ============ Items / Weapon ============ -->
      <PokemonEquipmentPanel
        :sheet="sheet"
        :held-item-name="heldItemName"
        :held-item-reference="heldItemReference"
        @set-held-item-name="setHeldItemName"
      />

      <!-- ============ Tutor pts + Skill bg + Inherited ============ -->
      <PokemonTrainingPanel
        v-model:skill-bg-raised-csv="skillBgRaisedCsv"
        v-model:skill-bg-lowered-csv="skillBgLoweredCsv"
        :sheet="sheet"
        :tutor-points-left="tutorPointsLeft"
        @set-inherited-move="setInheritedMove"
      />

      <!-- ============ Movelist ============ -->
      <PokemonMovesPanel
        :move-rows="moveRows"
        @add-move="addMove"
        @remove-move="removeMove"
      />

      <!-- ============ Type Effectiveness ============ -->
      <PokemonTypeEffectivenessPanel
        :rows="typeEffectivenessRows"
        :sheet-types="sheetTypes"
      />

      <!-- ============ Capabilities ============ -->
      <PokemonCapabilitiesPanel
        v-model:other-caps-csv="otherCapsCsv"
        :sheet="sheet"
      />

      <!-- ============ Abilities + Edges ============ -->
      <PokemonAbilitiesEdgesPanel
        :sheet="sheet"
        :ability-rows="abilityRows"
        @add-ability="addAbility"
        @remove-ability="removeAbility"
        @add-edge="addEdge"
        @remove-edge="removeEdge"
      />

      <!-- ============ Pokémon Skills ============ -->
      <PokemonSkillsPanel
        :sheet="sheet"
        :skills="skills"
      />
    </template>

    <template #not-found>
      <section class="panel-card">
        <h1>Sheet not found</h1>
        <p>No sheet exists for slug <code>{{ route.params.slug }}</code>.</p>
        <NuxtLink to="/sheets" class="back-link">← Back to all sheets</NuxtLink>
      </section>
    </template>
  </SheetPageShell>
</template>

<style scoped>
.back-link {
  color: var(--ink-soft);
  text-decoration: none;
  font-size: 0.9rem;
  letter-spacing: 0.02em;
}

.back-link:hover {
  color: var(--ink-bright);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
}

.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
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

.panel-subtle--types {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.row {
  display: grid;
  gap: 0.85rem;
}

.row.two-col   { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.row.three-col { grid-template-columns: repeat(3, minmax(0, 1fr)); }

@media (max-width: 980px) {
  .row.two-col,
  .row.three-col { grid-template-columns: 1fr; }
}

code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--accent);
}
</style>
