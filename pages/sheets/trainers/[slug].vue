<script setup lang="ts">
import { ref } from 'vue'
import { trainerSheetsBySlug } from '~/data/trainerSheets'
import { TRAINER_SKILL_ORDER } from '~/utils/sheets/trainerDerived'
import { trainerCatalog } from '~/data/trainerCatalog'
import { normalizeTrainerSheet } from '~/utils/sheetNormalize'
import { useEditableSheetResource } from '~/composables/sheets/useEditableSheetResource'
import { useTrainerSheetDerived } from '~/composables/sheets/useTrainerSheetDerived'
import { useTrainerPortraitPicker } from '~/composables/sheets/useTrainerPortraitPicker'
import { useTrainerSheetCsvFields } from '~/composables/sheets/useTrainerSheetCsvFields'
import { useTrainerSheetRowActions } from '~/composables/sheets/useTrainerSheetRowActions'
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

type TabKey = 'trainer' | 'combat' | 'inventory' | 'features' | 'edges'

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'trainer',   label: 'Trainer' },
  { key: 'combat',    label: 'Combat' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'features',  label: 'Features' },
  { key: 'edges',     label: 'Edges' },
]

const activeTab = ref<TabKey>('trainer')

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
  addAdvancement,
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
  <div class="sheet-detail">
    <header class="sheet-header">
      <AppNavigation />
      <div class="back-row">
        <NuxtLink to="/sheets" class="back-link">← All sheets</NuxtLink>
        <SaveIndicator v-if="sheet" :status="saveStatus" :error="saveError" />
      </div>
    </header>

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

      <!-- ===== Tab nav ===== -->
      <nav class="tab-nav" aria-label="Sheet tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          :class="['tab-btn', { active: activeTab === tab.key }]"
          @click="activeTab = tab.key"
        >{{ tab.label }}</button>
      </nav>

      <!-- =================================================================== -->
      <!-- TRAINER TAB                                                          -->
      <!-- =================================================================== -->
      <section v-if="activeTab === 'trainer'" class="tab-panel">
        <div class="grid-two">
          <TrainerStatsPanel
            :stats="stats"
            :stat-points-left="statPointsLeft"
            :stat-points-spent="statPointsSpent"
            :stat-points-budget="statPointsBudget"
            @set-stat-field="setStatField"
          />

          <TrainerSkillBackgroundPanel
            v-model:adept-csv="adeptCsv"
            v-model:novice-csv="noviceCsv"
            v-model:pathetic-csv="patheticCsv"
            :sheet="sheet"
          />
        </div>

        <!-- Skills grid -->
        <TrainerSkillsPanel
          :skills="skills"
          :rank-options="RANK_OPTIONS"
          :skill-modifier="skillModifier"
          @set-skill-rank="setSkillRank"
          @set-skill-modifier="setSkillModifier"
        />

        <TrainerProgressPanel
          v-model:current-team-csv="currentTeamCsv"
          v-model:wishlist-csv="wishlistCsv"
          :sheet="sheet"
          :advancement-rows="adv"
          @add-class="addClass"
          @remove-class="removeClass"
          @set-advancement="setAdv"
        />
      </section>

      <!-- =================================================================== -->
      <!-- COMBAT TAB                                                           -->
      <!-- =================================================================== -->
      <section v-if="activeTab === 'combat'" class="tab-panel">
        <TrainerCombatOverviewPanel
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
          @set-current-hp="setCurrentHp"
          @set-evasion-bonus="setEvasionBonus"
        />

        <TrainerCombatActionsPanel
          :sheet="sheet"
          :move-rows="moveRows"
          :ability-rows="abilityRows"
          :order-tags-csv="orderTagsCsv"
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
      </section>

      <!-- =================================================================== -->
      <!-- INVENTORY TAB                                                        -->
      <!-- =================================================================== -->
      <section v-if="activeTab === 'inventory'" class="tab-panel">
        <TrainerInventoryPanel
          :sheet="sheet"
          @add-item="addInvItem"
          @remove-item="removeInvItem"
        />
      </section>

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

    <article v-else class="sheet-card">
      <h1>Trainer not found</h1>
      <p>No trainer for slug <code>{{ slug }}</code>.</p>
      <NuxtLink to="/sheets" class="back-link">← Back to all sheets</NuxtLink>
    </article>

    <TrainerPortraitPickerModal
      v-if="sheet && portraitPickerOpen"
      v-model:query="portraitQuery"
      :options="filteredPortraitOptions"
      :selected-url="sheet.portraitUrl"
      @close="closePortraitPicker"
      @select="selectPortrait"
    />
  </div>
</template>

<style scoped>
.sheet-detail {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
}

.sheet-header {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.back-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

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

/* ===== Tabs ===== */
.tab-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.85rem 0;
}

.tab-btn {
  padding: 0.5rem 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.tab-btn:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.tab-btn.active {
  background: var(--paper-active);
  border-color: var(--rule-active);
  color: var(--ink-bright);
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

/* ===== Generic blocks ===== */
.grid-two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 0.85rem;
}

</style>
