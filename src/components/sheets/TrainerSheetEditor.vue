<script setup lang="ts">
import { computed } from 'vue'
import { trainerCatalog } from '~~/data/trainerCatalog'
import TrainerPokemonTabPanel from './TrainerPokemonTabPanel.vue'
import { TRAINER_SKILL_ORDER } from '~/utils/sheets/trainerDerived'
import { useTrainerSheetDerived } from '~/composables/sheets/useTrainerSheetDerived'
import { useTrainerPortraitPicker } from '~/composables/sheets/useTrainerPortraitPicker'
import { useTrainerSheetCsvFields } from '~/composables/sheets/useTrainerSheetCsvFields'
import { useTrainerSheetRowActions } from '~/composables/sheets/useTrainerSheetRowActions'
import { useTrainerSheetTabs } from '~/composables/sheets/useTrainerSheetTabs'
import type {
  SkillRank,
  TrainerSheet,
  TrainerSkillKey,
} from '~/types/trainerSheet'

const props = defineProps<{
  sheet: TrainerSheet
  isGm: boolean
}>()

const sheet = computed<TrainerSheet>(() => props.sheet)
const SKILL_KEYS: TrainerSkillKey[] = TRAINER_SKILL_ORDER.map(([key]) => key)
const RANK_OPTIONS: SkillRank[] = ['Pathetic', 'Untrained', 'Novice', 'Adept', 'Expert', 'Master']

const { tabs, activeTab, setActiveTab } = useTrainerSheetTabs()

const {
  stats,
  skills,
  fullMaxHp,
  maxHp,
  maxAp,
  currentHp,
  setCurrentHp,
  totalRow,
  moveRows,
  abilityRows,
  trainerEvasion,
  tickValue,
  hpThresholds,
  initiative,
  conditionEffects,
  statPointsSpent,
  statPointsBudget,
  statPointsLeft,
} = useTrainerSheetDerived(sheet)

const {
  adeptCsv,
  noviceCsv,
  patheticCsv,
  otherCapsCsv,
} = useTrainerSheetCsvFields(sheet, SKILL_KEYS)

const {
  addClass,
  removeClass,
  addMove,
  removeMove,
  reorderMove,
  addAbility,
  removeAbility,
  addManeuver,
  removeManeuver,
  addOrder,
  removeOrder,
  addFeature,
  removeFeature,
  addEdge,
  removeEdge,
  addInvItem,
  removeInvItem,
  orderTagsCsv,
  setOrderTags,
  setStatField,
  setEvasionBonus,
  setSkillRank,
  setSkillModifier,
  skillModifier,
} = useTrainerSheetRowActions(sheet)

const {
  portraitPickerOpen,
  portraitQuery,
  filteredPortraitOptions,
  openPortraitPicker,
  closePortraitPicker,
  selectPortrait,
  clearPortrait,
} = useTrainerPortraitPicker(sheet, trainerCatalog)
</script>

<template>
  <article class="sheet-card">
    <!-- ===== Identity strip ===== -->
    <TrainerIdentityPanel
      :sheet="sheet"
      :current-hp="currentHp"
      :max-hp="maxHp"
      :full-max-hp="fullMaxHp"
      :max-ap="maxAp"
      :is-gm="props.isGm"
      @open-portrait-picker="openPortraitPicker"
      @clear-portrait="clearPortrait"
      @set-current-hp="setCurrentHp"
    />

    <SheetTabNav
      :tabs="tabs"
      :active-key="activeTab"
      @update:active-key="setActiveTab"
    />

    <!-- =================================================================== -->
    <!-- STATS TAB                                                            -->
    <!-- =================================================================== -->
    <TrainerStatsTabPanel
      v-if="activeTab === 'stats'"
      :sheet="sheet"
      :stats="stats"
      :stat-points-left="statPointsLeft"
      :stat-points-spent="statPointsSpent"
      :stat-points-budget="statPointsBudget"
      @set-stat-field="setStatField"
      @add-class="addClass"
      @remove-class="removeClass"
    />

    <!-- =================================================================== -->
    <!-- SKILLS TAB                                                           -->
    <!-- =================================================================== -->
    <TrainerSkillsTabPanel
      v-if="activeTab === 'skills'"
      v-model:adept-csv="adeptCsv"
      v-model:novice-csv="noviceCsv"
      v-model:pathetic-csv="patheticCsv"
      :sheet="sheet"
      :skills="skills"
      :rank-options="RANK_OPTIONS"
      :skill-modifier="skillModifier"
      @set-skill-rank="setSkillRank"
      @set-skill-modifier="setSkillModifier"
    />

    <!-- =================================================================== -->
    <!-- COMBAT TAB                                                           -->
    <!-- =================================================================== -->
    <TrainerCombatTabPanel
      v-if="activeTab === 'combat'"
      v-model:other-caps-csv="otherCapsCsv"
      :sheet="sheet"
      :current-hp="currentHp"
      :max-hp="maxHp"
      :full-max-hp="fullMaxHp"
      :max-ap="maxAp"
      :tick-value="tickValue"
      :hp-thresholds="hpThresholds"
      :attack-total="totalRow('atk')"
      :special-attack-total="totalRow('satk')"
      :speed-total="totalRow('spd')"
      :initiative="initiative"
      :trainer-evasion="trainerEvasion"
      :condition-effects="conditionEffects"
      :move-rows="moveRows"
      :ability-rows="abilityRows"
      :order-tags-csv="orderTagsCsv"
      @set-current-hp="setCurrentHp"
      @set-evasion-bonus="setEvasionBonus"
      @add-move="addMove"
      @remove-move="removeMove"
      @reorder-move="reorderMove"
      @add-ability="addAbility"
      @remove-ability="removeAbility"
      @add-maneuver="addManeuver"
      @remove-maneuver="removeManeuver"
      @add-order="addOrder"
      @remove-order="removeOrder"
      @set-order-tags="setOrderTags"
    />

    <!-- =================================================================== -->
    <!-- POKÉMON TAB                                                          -->
    <!-- =================================================================== -->
    <TrainerPokemonTabPanel
      v-if="activeTab === 'pokemon'"
      :sheet="sheet"
    />

    <!-- =================================================================== -->
    <!-- INVENTORY TAB                                                        -->
    <!-- =================================================================== -->
    <TrainerInventoryTabPanel
      v-if="activeTab === 'inventory'"
      :sheet="sheet"
      @add-item="addInvItem"
      @remove-item="removeInvItem"
    />

    <!-- =================================================================== -->
    <!-- FEATURES TAB                                                         -->
    <!-- =================================================================== -->
    <TrainerFeaturesPanel
      v-if="activeTab === 'features'"
      :sheet="sheet"
      @add-feature="addFeature"
      @remove-feature="removeFeature"
    />

    <!-- =================================================================== -->
    <!-- EDGES TAB                                                            -->
    <!-- =================================================================== -->
    <TrainerEdgesPanel
      v-if="activeTab === 'edges'"
      :sheet="sheet"
      @add-edge="addEdge"
      @remove-edge="removeEdge"
    />
  </article>

  <TrainerPortraitPickerModal
    v-if="portraitPickerOpen"
    v-model:query="portraitQuery"
    :options="filteredPortraitOptions"
    :selected-url="sheet?.portraitUrl"
    @close="closePortraitPicker"
    @select="selectPortrait"
  />
</template>

<style scoped>
.sheet-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}
</style>
