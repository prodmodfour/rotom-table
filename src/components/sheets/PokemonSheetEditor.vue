<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePokemonSheetDerived } from '~/composables/sheets/usePokemonSheetDerived'
import { usePokemonSheetCsvFields } from '~/composables/sheets/usePokemonSheetCsvFields'
import { usePokemonSheetRowActions } from '~/composables/sheets/usePokemonSheetRowActions'
import { usePokemonSheetTabs } from '~/composables/sheets/usePokemonSheetTabs'
import { usePokemonNatureControls } from '~/composables/sheets/usePokemonNatureControls'
import { trainerAccentCssVariables } from '~/utils/trainerAccent'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetEditorCapabilities } from '~/utils/sheetEditorCapabilities'

const props = defineProps<{
  sheet: CharacterSheet
  capabilities: SheetEditorCapabilities
  accentColor?: string | null
}>()

const sheet = computed<CharacterSheet>(() => props.sheet)
const canEditSheet = computed(() => props.capabilities.canEditSheet)
const canManagePlayerAccess = computed(() => props.capabilities.canManagePlayerAccess)
const pokemonAccentStyle = computed(() => props.accentColor ? trainerAccentCssVariables(props.accentColor) : undefined)

const { tabs, activeTab, setActiveTab } = usePokemonSheetTabs()

const {
  spriteUrl,
  stats,
  skills,
  sheetTypes,
  eggGroups,
  levelFromExperience,
  levelIsExperienceDerived,
  experienceToNextLevel,
  fullMaxHp,
  maxHp,
  currentHp,
  setCurrentHp,
  tickValue,
  hpThresholds,
  speedTotal,
  initiative,
  initiativeTrainingBonus,
  conditionEffects,
  statPointsSpent,
  statPointsBudget,
  statPointsLeft,
  baseRelationViolations,
  visibleBaseRelationViolations,
  remainingBaseRelationViolationCount,
  pokemonAccuracy,
  pokemonEvasion,
  tutorPointsEarned,
  tutorPointsLeft,
  moveRows,
  abilityRows,
  heldItemName,
  heldItemReference,
  typeEffectivenessRows,
} = usePokemonSheetDerived(sheet)

const {
  genderOptions,
  natureOptions,
  naturePlusDisplay,
  natureMinusDisplay,
} = usePokemonNatureControls(sheet)

const {
  eggGroupsAsCsv,
  otherCapsCsv,
  skillBgRaisedCsv,
  skillBgLoweredCsv,
} = usePokemonSheetCsvFields({ sheet, sheetTypes, eggGroups })

const {
  setHeldItemName,
  addMove,
  removeMove,
  reorderMove,
  addEggMove,
  removeEggMove,
  addAbility,
  removeAbility,
  toggleAbilityActivation,
  addEdge,
  removeEdge,
  setStat,
  setEvasionBonus,
  setAccuracyStage,
  setInheritedMove,
} = usePokemonSheetRowActions(sheet)

const healingModalOpen = ref(false)
const openHealingModal = () => {
  healingModalOpen.value = true
}
const closeHealingModal = () => {
  healingModalOpen.value = false
}
const healingModalTitle = computed(() => `Healing · ${sheet.value.nickname || sheet.value.species || 'Pokémon'}`)
const healingModalSubtitle = computed(() => sheet.value.species ? `${sheet.value.species} recovery and daily resources` : 'Recovery and daily resources')
</script>

<template>
  <article class="pokemon-sheet" :style="pokemonAccentStyle">
    <!-- ============ Identity strip ============ -->
    <PokemonIdentityPanel
      v-model:egg-groups-csv="eggGroupsAsCsv"
      :sheet="sheet"
      :sprite-url="spriteUrl"
      :sheet-types="sheetTypes"
      :level-from-experience="levelFromExperience"
      :level-is-experience-derived="levelIsExperienceDerived"
      :experience-to-next-level="experienceToNextLevel"
      :gender-options="genderOptions"
      :nature-options="natureOptions"
      :nature-plus-display="naturePlusDisplay"
      :nature-minus-display="natureMinusDisplay"
      :can-edit-sheet="canEditSheet"
      :can-manage-player-access="canManagePlayerAccess"
      @open-healing="openHealingModal"
    />

    <SheetTabNav
      :tabs="tabs"
      :active-key="activeTab"
      @update:active-key="setActiveTab"
    />

    <div v-if="activeTab === 'sheet'" class="pokemon-sheet__tab-panel">
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
          :speed-total="speedTotal"
          :initiative="initiative"
          :initiative-training-bonus="initiativeTrainingBonus"
          :pokemon-accuracy="pokemonAccuracy"
          :pokemon-evasion="pokemonEvasion"
          :condition-effects="conditionEffects"
          @set-current-hp="setCurrentHp"
          @set-evasion-bonus="setEvasionBonus"
          @set-accuracy-stage="setAccuracyStage"
        />
      </div>

      <!-- ============ Items / Weapon ============ -->
      <PokemonEquipmentPanel
        :sheet="sheet"
        :held-item-name="heldItemName"
        :held-item-reference="heldItemReference"
        @set-held-item-name="setHeldItemName"
      />

      <!-- ============ Tutor pts + Active Training Feature + Skill bg + Inherited ============ -->
      <PokemonTrainingPanel
        v-model:skill-bg-raised-csv="skillBgRaisedCsv"
        v-model:skill-bg-lowered-csv="skillBgLoweredCsv"
        :sheet="sheet"
        :tutor-points-earned="tutorPointsEarned"
        :tutor-points-left="tutorPointsLeft"
        @set-inherited-move="setInheritedMove"
      />

      <!-- ============ Movelist ============ -->
      <PokemonMovesPanel
        :move-rows="moveRows"
        @add-move="addMove"
        @remove-move="removeMove"
        @reorder-move="reorderMove"
      />

      <!-- ============ Type Effectiveness ============ -->
      <PokemonTypeEffectivenessPanel
        :rows="typeEffectivenessRows"
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
        @toggle-ability-activation="toggleAbilityActivation"
        @add-edge="addEdge"
        @remove-edge="removeEdge"
      />

      <!-- ============ Pokémon Skills ============ -->
      <PokemonSkillsPanel
        :sheet="sheet"
        :skills="skills"
      />
    </div>

    <PokemonEggMovesPanel
      v-if="activeTab === 'eggMoves'"
      :sheet="sheet"
      @add-egg-move="addEggMove"
      @remove-egg-move="removeEggMove"
    />
  </article>

  <SheetHealingModal
    v-if="healingModalOpen"
    :title="healingModalTitle"
    :subtitle="healingModalSubtitle"
    @close="closeHealingModal"
  >
    <PokemonHealingPanel
      :sheet="sheet"
      :current-hp="currentHp"
      :max-hp="maxHp"
      :full-max-hp="fullMaxHp"
      :tick-value="tickValue"
    />
  </SheetHealingModal>
</template>

<style scoped>
.pokemon-sheet {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.pokemon-sheet__tab-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
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
</style>
