<script setup lang="ts">
import { ref } from 'vue'
import { PhPlus, PhX } from '@phosphor-icons/vue'
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
        <div class="block">
          <h2 class="block-title">Equipped</h2>
          <ul class="kv-list">
            <li><span>Main Hand</span>
              <strong class="equipped-item"><ItemSprite :item="sheet.equipmentSlots!.mainHand" size="sm" /><EditableCell v-model="sheet.equipmentSlots!.mainHand" placeholder="—" /></strong>
            </li>
            <li><span>Off Hand</span>
              <strong class="equipped-item"><ItemSprite :item="sheet.equipmentSlots!.offHand" size="sm" /><EditableCell v-model="sheet.equipmentSlots!.offHand"  placeholder="—" /></strong>
            </li>
            <li><span>Head</span>
              <strong class="equipped-item"><ItemSprite :item="sheet.equipmentSlots!.head" size="sm" /><EditableCell v-model="sheet.equipmentSlots!.head"     placeholder="—" /></strong>
            </li>
            <li><span>Body</span>
              <strong class="equipped-item"><ItemSprite :item="sheet.equipmentSlots!.body" size="sm" /><EditableCell v-model="sheet.equipmentSlots!.body"     placeholder="—" /></strong>
            </li>
            <li><span>Feet</span>
              <strong class="equipped-item"><ItemSprite :item="sheet.equipmentSlots!.feet" size="sm" /><EditableCell v-model="sheet.equipmentSlots!.feet"     placeholder="—" /></strong>
            </li>
            <li><span>Accessory</span>
              <strong class="equipped-item"><ItemSprite :item="sheet.equipmentSlots!.accessory" size="sm" /><EditableCell v-model="sheet.equipmentSlots!.accessory" placeholder="—" /></strong>
            </li>
          </ul>
        </div>

        <div class="grid-two">
          <!-- Reusable inventory tables -->
          <div class="block inv-block">
            <h2 class="block-title">
              Key Items
              <button type="button" class="row-add" @click="addInvItem('keyItems')">
                <PhPlus :size="14" weight="bold" /> Add row
              </button>
            </h2>
            <table class="data-table inv-table">
              <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Description</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(it, i) in sheet.inventory!.keyItems" :key="i">
                  <th><span class="inventory-item-name"><ItemSprite :item="it.name" size="sm" /><EditableCell v-model="it.name" placeholder="Item" /></span></th>
                  <td><EditableCell v-model="it.qty"  type="number" :min="0" /></td>
                  <td><EditableCell v-model="it.cost" type="number" :min="0" /></td>
                  <td class="effect-col"><EditableCell v-model="it.description" type="textarea" placeholder="—" multiline /></td>
                  <td class="row-actions">
                    <button type="button" class="row-remove" title="Remove" @click="removeInvItem('keyItems', i)">
                      <PhX :size="14" weight="bold" />
                    </button>
                  </td>
                </tr>
                <tr v-if="!sheet.inventory!.keyItems?.length"><td colspan="5" class="muted">—</td></tr>
              </tbody>
            </table>
          </div>

          <div class="block inv-block">
            <h2 class="block-title">
              Pokémon Items
              <button type="button" class="row-add" @click="addInvItem('pokemonItems')">
                <PhPlus :size="14" weight="bold" /> Add row
              </button>
            </h2>
            <table class="data-table inv-table">
              <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Description</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(it, i) in sheet.inventory!.pokemonItems" :key="i">
                  <th><span class="inventory-item-name"><ItemSprite :item="it.name" size="sm" /><EditableCell v-model="it.name" placeholder="Item" /></span></th>
                  <td><EditableCell v-model="it.qty"  type="number" :min="0" /></td>
                  <td><EditableCell v-model="it.cost" type="number" :min="0" /></td>
                  <td class="effect-col"><EditableCell v-model="it.description" type="textarea" placeholder="—" multiline /></td>
                  <td class="row-actions">
                    <button type="button" class="row-remove" title="Remove" @click="removeInvItem('pokemonItems', i)">
                      <PhX :size="14" weight="bold" />
                    </button>
                  </td>
                </tr>
                <tr v-if="!sheet.inventory!.pokemonItems?.length"><td colspan="5" class="muted">—</td></tr>
              </tbody>
            </table>
          </div>

          <div class="block inv-block">
            <h2 class="block-title">
              Medical Kit
              <button type="button" class="row-add" @click="addInvItem('medicalKit')">
                <PhPlus :size="14" weight="bold" /> Add row
              </button>
            </h2>
            <table class="data-table inv-table">
              <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Description</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(it, i) in sheet.inventory!.medicalKit" :key="i">
                  <th><span class="inventory-item-name"><ItemSprite :item="it.name" size="sm" /><EditableCell v-model="it.name" placeholder="Item" /></span></th>
                  <td><EditableCell v-model="it.qty"  type="number" :min="0" /></td>
                  <td><EditableCell v-model="it.cost" type="number" :min="0" /></td>
                  <td class="effect-col"><EditableCell v-model="it.description" type="textarea" placeholder="—" multiline /></td>
                  <td class="row-actions">
                    <button type="button" class="row-remove" title="Remove" @click="removeInvItem('medicalKit', i)">
                      <PhX :size="14" weight="bold" />
                    </button>
                  </td>
                </tr>
                <tr v-if="!sheet.inventory!.medicalKit?.length"><td colspan="5" class="muted">—</td></tr>
              </tbody>
            </table>
          </div>

          <div class="block inv-block">
            <h2 class="block-title">
              Poké Balls &amp; Accessories
              <button type="button" class="row-add" @click="addInvItem('pokeBalls')">
                <PhPlus :size="14" weight="bold" /> Add row
              </button>
            </h2>
            <table class="data-table inv-table">
              <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Mod</th><th>Description</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(it, i) in sheet.inventory!.pokeBalls" :key="i">
                  <th><span class="inventory-item-name"><ItemSprite :item="it.name" size="sm" /><EditableCell v-model="it.name" placeholder="Poké Ball" /></span></th>
                  <td><EditableCell v-model="it.qty"  type="number" :min="0" /></td>
                  <td><EditableCell v-model="it.cost" type="number" :min="0" /></td>
                  <td><EditableCell v-model="it.mod"  placeholder="x1" /></td>
                  <td class="effect-col"><EditableCell v-model="it.description" type="textarea" placeholder="—" multiline /></td>
                  <td class="row-actions">
                    <button type="button" class="row-remove" title="Remove" @click="removeInvItem('pokeBalls', i)">
                      <PhX :size="14" weight="bold" />
                    </button>
                  </td>
                </tr>
                <tr v-if="!sheet.inventory!.pokeBalls?.length"><td colspan="6" class="muted">—</td></tr>
              </tbody>
            </table>
          </div>

          <div class="block inv-block">
            <h2 class="block-title">
              Food Stuff
              <button type="button" class="row-add" @click="addInvItem('foodStuff')">
                <PhPlus :size="14" weight="bold" /> Add row
              </button>
            </h2>
            <table class="data-table inv-table">
              <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Description</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(it, i) in sheet.inventory!.foodStuff" :key="i">
                  <th><span class="inventory-item-name"><ItemSprite :item="it.name" size="sm" /><EditableCell v-model="it.name" placeholder="Food" /></span></th>
                  <td><EditableCell v-model="it.qty"  type="number" :min="0" /></td>
                  <td><EditableCell v-model="it.cost" type="number" :min="0" /></td>
                  <td class="effect-col"><EditableCell v-model="it.description" type="textarea" placeholder="—" multiline /></td>
                  <td class="row-actions">
                    <button type="button" class="row-remove" title="Remove" @click="removeInvItem('foodStuff', i)">
                      <PhX :size="14" weight="bold" />
                    </button>
                  </td>
                </tr>
                <tr v-if="!sheet.inventory!.foodStuff?.length"><td colspan="5" class="muted">—</td></tr>
              </tbody>
            </table>
          </div>

          <div class="block inv-block">
            <h2 class="block-title">
              Equipment
              <button type="button" class="row-add" @click="addInvItem('equipment')">
                <PhPlus :size="14" weight="bold" /> Add row
              </button>
            </h2>
            <table class="data-table inv-table">
              <thead><tr><th>Name</th><th>Slot</th><th>Cost</th><th>Description</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(it, i) in sheet.inventory!.equipment" :key="i">
                  <th><span class="inventory-item-name"><ItemSprite :item="it.name" size="sm" /><EditableCell v-model="it.name" placeholder="Equipment" /></span></th>
                  <td><EditableCell v-model="it.slot" placeholder="Body" /></td>
                  <td><EditableCell v-model="it.cost" type="number" :min="0" /></td>
                  <td class="effect-col"><EditableCell v-model="it.description" type="textarea" placeholder="—" multiline /></td>
                  <td class="row-actions">
                    <button type="button" class="row-remove" title="Remove" @click="removeInvItem('equipment', i)">
                      <PhX :size="14" weight="bold" />
                    </button>
                  </td>
                </tr>
                <tr v-if="!sheet.inventory!.equipment?.length"><td colspan="5" class="muted">—</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- =================================================================== -->
      <!-- FEATURES TAB                                                         -->
      <!-- =================================================================== -->
      <section v-if="activeTab === 'features'" class="tab-panel">
        <div class="block">
          <h2 class="block-title">
            Features ({{ sheet.features?.length ?? 0 }})
            <button type="button" class="row-add" @click="addFeature">
              <PhPlus :size="14" weight="bold" /> Add row
            </button>
          </h2>
          <table class="data-table feat-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Tags</th>
                <th>Frequency / Action</th>
                <th>Notes</th>
                <th aria-label="Row actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(f, i) in sheet.features" :key="i">
                <th><EditableCell v-model="f.name" placeholder="Feature" /></th>
                <td>
                  <EditableCell
                    :model-value="featureTagsCsv(f)"
                    placeholder="Class"
                    @update:model-value="(v) => setFeatureTags(f, (v as string) ?? '')"
                  />
                </td>
                <td><EditableCell v-model="f.frequency" placeholder="—" /></td>
                <td class="effect-col">
                  <EditableCell v-model="f.notes" type="textarea" placeholder="—" multiline />
                </td>
                <td class="row-actions">
                  <button type="button" class="row-remove" title="Remove feature" @click="removeFeature(i)">
                    <PhX :size="14" weight="bold" />
                  </button>
                </td>
              </tr>
              <tr v-if="!sheet.features?.length">
                <td colspan="5" class="muted">No features taken.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- =================================================================== -->
      <!-- EDGES TAB                                                            -->
      <!-- =================================================================== -->
      <section v-if="activeTab === 'edges'" class="tab-panel">
        <div class="block">
          <h2 class="block-title">
            Edges ({{ sheet.edges?.length ?? 0 }})
            <button type="button" class="row-add" @click="addEdge">
              <PhPlus :size="14" weight="bold" /> Add row
            </button>
          </h2>
          <table class="data-table feat-table">
            <thead>
              <tr><th>Edge</th><th>Notes</th><th aria-label="Row actions"></th></tr>
            </thead>
            <tbody>
              <tr v-for="(e, i) in sheet.edges" :key="i">
                <th><EditableCell v-model="e.name" placeholder="Edge" /></th>
                <td class="effect-col">
                  <EditableCell v-model="e.notes" type="textarea" placeholder="—" multiline />
                </td>
                <td class="row-actions">
                  <button type="button" class="row-remove" title="Remove edge" @click="removeEdge(i)">
                    <PhX :size="14" weight="bold" />
                  </button>
                </td>
              </tr>
              <tr v-if="!sheet.edges?.length">
                <td colspan="3" class="muted">No edges taken.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </article>

    <article v-else class="sheet-card">
      <h1>Trainer not found</h1>
      <p>No trainer for slug <code>{{ slug }}</code>.</p>
      <NuxtLink to="/sheets" class="back-link">← Back to all sheets</NuxtLink>
    </article>

    <!-- ===== Portrait picker modal ===== -->
    <div
      v-if="sheet && portraitPickerOpen"
      class="portrait-picker-backdrop"
      @click.self="closePortraitPicker"
    >
      <div class="portrait-picker" role="dialog" aria-label="Pick a trainer sprite">
        <header class="portrait-picker__header">
          <h2>Pick a trainer sprite</h2>
          <button
            type="button"
            class="portrait-picker__close"
            title="Close"
            @click="closePortraitPicker"
          >
            <PhX :size="16" weight="bold" />
          </button>
        </header>
        <div class="portrait-picker__search">
          <input
            v-model="portraitQuery"
            type="search"
            placeholder="Search by name or slug…"
            class="portrait-picker__input"
            autofocus
          />
          <span class="portrait-picker__count">
            {{ filteredPortraitOptions.length }} sprite{{ filteredPortraitOptions.length === 1 ? '' : 's' }}
          </span>
        </div>
        <div class="portrait-picker__grid">
          <button
            v-for="t in filteredPortraitOptions"
            :key="t.slug"
            type="button"
            class="portrait-option"
            :class="{ 'portrait-option--active': sheet.portraitUrl === t.spriteUrl }"
            :title="t.species"
            @click="selectPortrait(t.spriteUrl ?? '')"
          >
            <img
              :src="t.spriteUrl"
              :alt="t.species"
              class="portrait-option__img"
              loading="lazy"
            />
            <span class="portrait-option__label">{{ t.species }}</span>
          </button>
          <p v-if="!filteredPortraitOptions.length" class="muted portrait-picker__empty">
            No sprites match "{{ portraitQuery }}".
          </p>
        </div>
      </div>
    </div>
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

.block {
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.7rem 0.85rem;
}

.block-title {
  margin: 0 0 0.5rem;
  font-family: var(--font-book);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.muted { color: var(--ink-muted); font-size: 0.85rem; }
.muted-help { color: var(--ink-muted); font-size: 0.78rem; margin: 0 0 0.4rem; }

/* ===== Tables ===== */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.data-table th,
.data-table td {
  padding: 0.35rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--rule);
  vertical-align: top;
}

.data-table th {
  font-weight: 600;
  color: var(--ink-bright);
}

.data-table thead th {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: transparent;
  font-weight: 600;
}

/* Row controls */
.row-add {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.2rem 0.45rem;
  font: inherit;
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-transform: none;
}

.row-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.row-remove {
  display: inline-flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-soft);
  padding: 0.2rem;
  font: inherit;
  cursor: pointer;
  margin-left: 0.4rem;
}

.row-remove:hover {
  color: #d36464;
  border-color: rgba(220, 80, 80, 0.45);
  background: rgba(220, 80, 80, 0.08);
}

.row-actions { width: 1.5rem; text-align: right; }

.equipped-item,
.inventory-item-name {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.inventory-item-name {
  max-width: 100%;
}

/* Key/value lists */
.kv-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.kv-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.28rem 0;
  border-bottom: 1px dashed var(--rule);
  font-size: 0.88rem;
}

.kv-list li:last-child { border-bottom: 0; }

.effect-col { color: var(--ink-soft); white-space: pre-wrap; max-width: 22rem; }
/* Tag badges */
.tag-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-right: 0.2rem;
}

/* ===== Portrait picker modal ===== */
.portrait-picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 1000;
}

.portrait-picker {
  width: min(900px, 100%);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.portrait-picker__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--rule-soft);
  background: var(--paper-inset);
}

.portrait-picker__header h2 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
}

.portrait-picker__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink-soft);
  cursor: pointer;
}

.portrait-picker__close:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.portrait-picker__search {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--rule-soft);
}

.portrait-picker__input {
  flex: 1 1 auto;
  font: inherit;
  color: inherit;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  padding: 0.4rem 0.6rem;
}

.portrait-picker__input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.portrait-picker__count {
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
  white-space: nowrap;
}

.portrait-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 0.5rem;
  padding: 0.85rem 1rem;
  overflow: auto;
}

.portrait-picker__empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 1.5rem 0;
}

.portrait-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 0.45rem 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
  font: inherit;
  color: inherit;
}

.portrait-option:hover {
  border-color: var(--accent);
  background: var(--paper-hover);
}

.portrait-option--active {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.25);
}

.portrait-option__img {
  width: 80px;
  height: 80px;
  object-fit: contain;
  image-rendering: pixelated;
}

.portrait-option__label {
  font-size: 0.72rem;
  color: var(--ink-soft);
  text-align: center;
  line-height: 1.2;
  text-transform: capitalize;
  word-break: break-word;
}
</style>
