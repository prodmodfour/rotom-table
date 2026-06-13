<script setup lang="ts">
import { computed, ref } from 'vue'
import { trainerCatalog } from '~~/data/trainerCatalog'
import TrainerPokemonTabPanel from './TrainerPokemonTabPanel.vue'
import { TRAINER_SKILL_ORDER } from '~/utils/sheets/trainerSkillConstants'
import { useTrainerSheetDerived } from '~/composables/sheets/useTrainerSheetDerived'
import { useTrainerPortraitPicker } from '~/composables/sheets/useTrainerPortraitPicker'
import { useTrainerSheetCsvFields } from '~/composables/sheets/useTrainerSheetCsvFields'
import { useTrainerSheetRowActions } from '~/composables/sheets/useTrainerSheetRowActions'
import { useTrainerSheetTabs } from '~/composables/sheets/useTrainerSheetTabs'
import { normalizeTrainerAccentColor, trainerAccentCssVariables } from '~/utils/trainerAccent'
import type {
  TrainerSheet,
  TrainerSkillKey,
} from '~/types/trainerSheet'
import type { SheetEditorCapabilities } from '~/utils/sheetEditorCapabilities'

const props = defineProps<{
  sheet: TrainerSheet
  capabilities: SheetEditorCapabilities
}>()

const sheet = computed<TrainerSheet>(() => props.sheet)
const canManagePlayerAccess = computed(() => props.capabilities.canManagePlayerAccess)
const trainerAccentStyle = computed(() => trainerAccentCssVariables(sheet.value.accentColor))
const setTrainerAccentColor = (value: unknown) => {
  const accentColor = normalizeTrainerAccentColor(value)
  if (accentColor) sheet.value.accentColor = accentColor
  else delete sheet.value.accentColor
}
const SKILL_KEYS: TrainerSkillKey[] = TRAINER_SKILL_ORDER.map(([key]) => key)

const { tabs, activeTab, setActiveTab } = useTrainerSheetTabs()
const healingModalOpen = ref(false)
const trainingModalOpen = ref(false)
const openHealingModal = () => {
  healingModalOpen.value = true
}
const closeHealingModal = () => {
  healingModalOpen.value = false
}
const openTrainingModal = () => {
  trainingModalOpen.value = true
}
const closeTrainingModal = () => {
  trainingModalOpen.value = false
}
const healingModalTitle = computed(() => `Healing · ${sheet.value.name || 'Trainer'}`)
const healingModalSubtitle = computed(() => 'Trainer recovery, AP, and daily resources')

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
  orderRows,
  trainerAccuracy,
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
  setAccuracyStage,
  setSkillRankBonus,
  setSkillModifier,
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
  <article class="sheet-card" :style="trainerAccentStyle">
    <!-- ===== Identity strip ===== -->
    <TrainerIdentityPanel
      :sheet="sheet"
      :current-hp="currentHp"
      :max-hp="maxHp"
      :full-max-hp="fullMaxHp"
      :max-ap="maxAp"
      :can-manage-player-access="canManagePlayerAccess"
      @open-healing="openHealingModal"
      @open-training="openTrainingModal"
      @open-portrait-picker="openPortraitPicker"
      @clear-portrait="clearPortrait"
      @set-current-hp="setCurrentHp"
      @set-accent-color="setTrainerAccentColor"
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
      @set-skill-rank-bonus="setSkillRankBonus"
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
      :trainer-accuracy="trainerAccuracy"
      :trainer-evasion="trainerEvasion"
      :condition-effects="conditionEffects"
      :move-rows="moveRows"
      :ability-rows="abilityRows"
      :order-rows="orderRows"
      :order-tags-csv="orderTagsCsv"
      @set-current-hp="setCurrentHp"
      @set-evasion-bonus="setEvasionBonus"
      @set-accuracy-stage="setAccuracyStage"
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

  <SheetHealingModal
    v-if="healingModalOpen"
    :title="healingModalTitle"
    :subtitle="healingModalSubtitle"
    @close="closeHealingModal"
  >
    <TrainerHealingPanel
      :sheet="sheet"
      :current-hp="currentHp"
      :max-hp="maxHp"
      :full-max-hp="fullMaxHp"
      :tick-value="tickValue"
      :max-ap="maxAp"
    />
  </SheetHealingModal>

  <TrainerTrainingModal
    v-if="trainingModalOpen"
    :sheet="sheet"
    @close="closeTrainingModal"
  />

  <TrainerPortraitPickerModal
    v-if="portraitPickerOpen"
    v-model:query="portraitQuery"
    :options="filteredPortraitOptions"
    :selected-url="sheet?.portraitUrl"
    :style="trainerAccentStyle"
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
