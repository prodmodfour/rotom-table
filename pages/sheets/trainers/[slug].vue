<script setup lang="ts">
import { trainerSheetsBySlug } from '~/data/trainerSheets'
import { TRAINER_SKILL_ORDER } from '~/utils/sheets/trainerDerived'
import { trainerCatalog } from '~/data/trainerCatalog'
import { normalizeTrainerSheet } from '~/utils/sheetNormalize'
import { useEditableSheetResource } from '~/composables/sheets/useEditableSheetResource'
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

const SKILL_KEYS: TrainerSkillKey[] = TRAINER_SKILL_ORDER.map(([k]) => k)

const RANK_OPTIONS: SkillRank[] = ['Pathetic', 'Untrained', 'Novice', 'Adept', 'Expert', 'Master']

// ---------------------------------------------------------------------------
// Editable sheet wiring
// ---------------------------------------------------------------------------

// Route the page key off the slug so navigating between trainer sheets
// forces a fresh component instance and a clean editable state.
definePageMeta({
  key: (route) => `trainer-${route.params.slug}`,
})

const route = useRoute()
const { isGm, isPlayer } = useAuth()
const slug = String(route.params.slug ?? '')
const baseSheet = trainerSheetsBySlug.get(slug) ?? null
const {
  sheet,
  saveStatus,
  saveError,
} = useEditableSheetResource<TrainerSheet>({
  baseSheet,
  kind: 'trainer',
  isPlayer,
  normalize: normalizeTrainerSheet,
})

useHead(() => ({
  title: sheet.value ? `${sheet.value.name} · Trainer Sheet` : 'Trainer not found · Rotom Table',
}))

const { tabs, activeTab, setActiveTab } = useTrainerSheetTabs()

// ---------------------------------------------------------------------------
// Derived data — re-evaluated whenever the reactive sheet changes
// ---------------------------------------------------------------------------

const {
  stats,
  skills,
  adv,
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
  statPointsSpent,
  statPointsBudget,
  statPointsLeft,
} = useTrainerSheetDerived(sheet)

// ---------------------------------------------------------------------------
// CSV-backed v-models (arrays exposed as comma-separated input)
// ---------------------------------------------------------------------------

const {
  adeptCsv,
  noviceCsv,
  patheticCsv,
  otherCapsCsv,
  currentTeamCsv,
  wishlistCsv,
} = useTrainerSheetCsvFields(sheet, SKILL_KEYS)

// ---------------------------------------------------------------------------
// Row mutation helpers — each mutation flows through the deep watcher into a
// single debounced save, so spamming "Add row" still results in one write.
// ---------------------------------------------------------------------------

const {
  addClass,
  removeClass,
  addMove,
  removeMove,
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
  setAdv,
  addInvItem,
  removeInvItem,
  featureTagsCsv,
  setFeatureTags,
  orderTagsCsv,
  setOrderTags,
  setStatField,
  setEvasionBonus,
  setSkillRank,
  setSkillModifier,
  skillModifier,
} = useTrainerSheetRowActions(sheet)

// ---------------------------------------------------------------------------
// Portrait picker — pick a trainer sprite from `trainerCatalog` and write the
// chosen `spriteUrl` into `sheet.portraitUrl`. The deep watcher in
// `useEditableSheet` picks up the change and persists it via the auto-save.
// ---------------------------------------------------------------------------

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
  <SheetPageShell
    :has-sheet="Boolean(sheet)"
    :save-status="saveStatus"
    :save-error="saveError"
  >
    <article v-if="sheet" class="sheet-card">
      <!-- ===== Identity strip ===== -->
      <TrainerIdentityPanel
        :sheet="sheet"
        :current-hp="currentHp"
        :max-hp="maxHp"
        :full-max-hp="fullMaxHp"
        :max-ap="maxAp"
        :is-gm="isGm"
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
      <!-- TRAINER TAB                                                          -->
      <!-- =================================================================== -->
      <TrainerMainTabPanel
        v-if="activeTab === 'trainer'"
        v-model:adept-csv="adeptCsv"
        v-model:novice-csv="noviceCsv"
        v-model:pathetic-csv="patheticCsv"
        v-model:current-team-csv="currentTeamCsv"
        v-model:wishlist-csv="wishlistCsv"
        :sheet="sheet"
        :stats="stats"
        :skills="skills"
        :advancement-rows="adv"
        :rank-options="RANK_OPTIONS"
        :stat-points-left="statPointsLeft"
        :stat-points-spent="statPointsSpent"
        :stat-points-budget="statPointsBudget"
        :skill-modifier="skillModifier"
        @set-stat-field="setStatField"
        @set-skill-rank="setSkillRank"
        @set-skill-modifier="setSkillModifier"
        @add-class="addClass"
        @remove-class="removeClass"
        @set-advancement="setAdv"
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
        :trainer-evasion="trainerEvasion"
        :move-rows="moveRows"
        :ability-rows="abilityRows"
        :order-tags-csv="orderTagsCsv"
        @set-current-hp="setCurrentHp"
        @set-evasion-bonus="setEvasionBonus"
        @add-move="addMove"
        @remove-move="removeMove"
        @add-ability="addAbility"
        @remove-ability="removeAbility"
        @add-maneuver="addManeuver"
        @remove-maneuver="removeManeuver"
        @add-order="addOrder"
        @remove-order="removeOrder"
        @set-order-tags="setOrderTags"
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
        :feature-tags-csv="featureTagsCsv"
        @add-feature="addFeature"
        @remove-feature="removeFeature"
        @set-feature-tags="setFeatureTags"
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

    <template #not-found>
      <article class="sheet-card">
        <h1>Trainer not found</h1>
        <p>No trainer for slug <code>{{ slug }}</code>.</p>
        <NuxtLink to="/sheets" class="back-link">← Back to all sheets</NuxtLink>
      </article>
    </template>

    <TrainerPortraitPickerModal
      v-if="sheet && portraitPickerOpen"
      v-model:query="portraitQuery"
      :options="filteredPortraitOptions"
      :selected-url="sheet.portraitUrl"
      @close="closePortraitPicker"
      @select="selectPortrait"
    />
  </SheetPageShell>
</template>

<style scoped>
.back-link {
  color: var(--ink-soft);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
  text-underline-offset: 0.18em;
}

.back-link:hover {
  color: var(--ink-bright);
}

.sheet-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}
</style>
