<script setup lang="ts">
import { computed, watch } from 'vue'
import { PhPlus, PhX } from '@phosphor-icons/vue'
import { characterSheetsBySlug } from '~/data/characterSheets'
import { normalizeCharacterSheet } from '~/utils/sheetNormalize'
import { PTU_NATURE_OPTIONS, resolveNatureMod } from '~/utils/ptuNatures'
import { setLookupAbilityName } from '~/utils/sheetAbilityLookup'
import { formatLookupValue, setLookupMoveName } from '~/utils/sheetMoveLookup'
import { useEditableSheetResource } from '~/composables/sheets/useEditableSheetResource'
import { formatLookupList, usePokemonSheetDerived } from '~/composables/sheets/usePokemonSheetDerived'
import { usePokemonSheetCsvFields } from '~/composables/sheets/usePokemonSheetCsvFields'
import { usePokemonSheetRowActions } from '~/composables/sheets/usePokemonSheetRowActions'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'

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

const syncNatureModForSheet = (target: CharacterSheet, nature = target.nature) => {
  if (!target.natureMod) target.natureMod = {}
  const mod = resolveNatureMod(nature)
  target.natureMod.plus = mod?.plus
  target.natureMod.minus = mod?.minus
}

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
  capabilities,
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

watch(
  () => sheet.value?.nature,
  (nature) => {
    if (sheet.value) syncNatureModForSheet(sheet.value, nature)
  },
)

// ---------------------------------------------------------------------------
// Editing helpers — these mutate the reactive sheet, which in turn fires the
// deep watcher inside useEditableSheet to persist the change.
// ---------------------------------------------------------------------------

const NATURE_OPTIONS = PTU_NATURE_OPTIONS

const NATURE_STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP',
  atk: 'ATK',
  def: 'DEF',
  satk: 'SATK',
  sdef: 'SDEF',
  spd: 'SPD',
}

const natureStepForStat = (key: StatKey): number => key === 'hp' ? 1 : 2
const formatNatureModDisplay = (key: StatKey | undefined, sign: 1 | -1): string | undefined => {
  if (!key) return undefined
  const delta = natureStepForStat(key) * sign
  return `${NATURE_STAT_LABELS[key]} ${delta > 0 ? `+${delta}` : delta}`
}

const natureLookupMod = computed(() => resolveNatureMod(sheet.value?.nature))
const naturePlusDisplay = computed(() => formatNatureModDisplay(natureLookupMod.value?.plus, 1))
const natureMinusDisplay = computed(() => formatNatureModDisplay(natureLookupMod.value?.minus, -1))

const GENDER_OPTIONS = ['Male', 'Female', 'Genderless']

const INHERITED_LEVELS = ['20', '30', '40', '50', '60', '70', '80', '90']

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
  <div class="sheet-page">
    <header class="sheet-header">
      <AppNavigation />

      <div class="back-row">
        <NuxtLink to="/sheets" class="back-link">← All sheets</NuxtLink>
        <SaveIndicator v-if="sheet" :status="saveStatus" :error="saveError" />
      </div>
    </header>

    <main v-if="sheet" class="sheet-body">
      <!-- ============ Identity strip ============ -->
      <PokemonIdentityPanel
        v-model:types-csv="typesAsCsv"
        v-model:egg-groups-csv="eggGroupsAsCsv"
        :sheet="sheet"
        :sprite-url="spriteUrl"
        :species="species"
        :sheet-types="sheetTypes"
        :gender-options="GENDER_OPTIONS"
        :nature-options="NATURE_OPTIONS"
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
      <div class="row two-col">
        <section class="panel-card">
          <h2 class="panel-title">
            Held Item
            <span class="panel-subtle">name editable · details from items.json</span>
          </h2>
          <dl class="kv-list">
            <div>
              <dt>Held Item</dt>
              <dd>
                <span class="held-item-value">
                  <ItemSprite :item="heldItemName" size="md" />
                  <EditableCell
                    :model-value="sheet.items!.held"
                    placeholder="None"
                    @update:model-value="setHeldItemName"
                  />
                </span>
              </dd>
            </div>
            <div>
              <dt>Effect</dt>
              <dd class="lookup-text">
                <template v-if="heldItemReference?.effects.length">
                  <p v-for="effect in heldItemReference.effects" :key="effect">{{ effect }}</p>
                </template>
                <span v-else class="badge-empty">
                  {{ heldItemName ? 'No matching item in items.json' : '—' }}
                </span>
              </dd>
            </div>
            <div v-if="heldItemReference?.notes.length">
              <dt>Notes</dt>
              <dd class="lookup-text">
                <p v-for="note in heldItemReference.notes" :key="note">{{ note }}</p>
              </dd>
            </div>
          </dl>
        </section>

        <section class="panel-card">
          <h2 class="panel-title">Weapon</h2>
          <dl class="kv-list">
            <div>
              <dt>Name</dt>
              <dd><EditableCell v-model="sheet.weapon!.name" placeholder="—" /></dd>
            </div>
            <div>
              <dt>DB Mod</dt>
              <dd><EditableCell v-model="sheet.weapon!.dbMod" type="number" /></dd>
            </div>
            <div>
              <dt>AC Mod</dt>
              <dd><EditableCell v-model="sheet.weapon!.acMod" type="number" /></dd>
            </div>
            <div>
              <dt>Description</dt>
              <dd>
                <EditableCell
                  v-model="sheet.weapon!.description"
                  type="textarea"
                  placeholder="—"
                  multiline
                />
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <!-- ============ Tutor pts + Skill bg + Inherited ============ -->
      <div class="row three-col">
        <section class="panel-card">
          <h2 class="panel-title">Tutor Points</h2>
          <dl class="kv-list">
            <div>
              <dt>Earned</dt>
              <dd><EditableCell v-model="sheet.tutorPoints!.earned" type="number" :min="0" /></dd>
            </div>
            <div>
              <dt>Spent</dt>
              <dd><EditableCell v-model="sheet.tutorPoints!.spent" type="number" :min="0" /></dd>
            </div>
            <div>
              <dt>Left</dt>
              <dd>{{ tutorPointsLeft ?? 0 }}</dd>
            </div>
          </dl>
        </section>

        <section class="panel-card">
          <h2 class="panel-title">Skill Background</h2>
          <p class="bg-desc">
            <EditableCell
              v-model="sheet.skillBackground!.description"
              type="textarea"
              placeholder="Skill background description"
              multiline
            />
          </p>
          <dl class="kv-list">
            <div>
              <dt>Raised</dt>
              <dd><EditableCell v-model="skillBgRaisedCsv" placeholder="Athletics, Survival" /></dd>
            </div>
            <div>
              <dt>Lowered</dt>
              <dd><EditableCell v-model="skillBgLoweredCsv" placeholder="Combat" /></dd>
            </div>
          </dl>
        </section>

        <section class="panel-card">
          <h2 class="panel-title">Inherited Moves</h2>
          <dl class="inherited-grid">
            <div v-for="level in INHERITED_LEVELS" :key="level">
              <dt>Lvl {{ level }}</dt>
              <dd>
                <EditableCell
                  :model-value="sheet.inheritedMoves?.[level]"
                  placeholder="—"
                  @update:model-value="(v) => setInheritedMove(level, v as string)"
                />
              </dd>
            </div>
          </dl>
          <p class="inherited-foot">
            Remaining: <strong><EditableCell v-model="sheet.inheritedRemaining" type="number" :min="0" /></strong>
          </p>
        </section>
      </div>

      <!-- ============ Movelist ============ -->
      <section class="panel-card">
        <h2 class="panel-title">
          Movelist
          <span class="panel-subtle">name editable · details from moves.json · Struggle auto-added</span>
          <button type="button" class="row-add" @click="addMove">
            <PhPlus :size="14" weight="bold" /> Add row
          </button>
        </h2>
        <div class="table-wrap">
          <table class="moves-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Cat.</th>
                <th>DB</th>
                <th>Damage</th>
                <th>Freq</th>
                <th>AC</th>
                <th>Range</th>
                <th>Effect</th>
                <th aria-label="Row actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in moveRows"
                :key="`${row.automatic ? 'auto' : 'sheet'}-${row.move.name}-${i}`"
                :class="{ 'move-row--automatic': row.automatic }"
              >
                <td class="move-name">
                  <EditableCell
                    :model-value="row.move.name"
                    placeholder="Move"
                    :readonly="row.automatic"
                    @update:model-value="(v) => setLookupMoveName(row.move, v)"
                  />
                  <span v-if="row.automatic" class="move-auto-badge" title="Auto-added from Struggle rules and capabilities">auto</span>
                </td>
                <td>
                  <TypeBadge v-if="row.reference?.type" :type="row.reference.type" size="xs" />
                  <span v-else class="badge-empty">—</span>
                </td>
                <td>
                  <DamageClassBadge v-if="row.reference?.damage_class" :category="row.reference.damage_class" size="xs" />
                  <span v-else class="badge-empty">—</span>
                </td>
                <td>
                  {{ formatLookupValue(row.damageBase) }}
                  <span v-if="row.hasStab" class="move-stab" title="Same-type attack bonus included">STAB</span>
                </td>
                <td>{{ formatLookupValue(row.damageFormula) }}</td>
                <td>{{ formatLookupValue(row.reference?.frequency) }}</td>
                <td>{{ formatLookupValue(row.reference?.ac) }}</td>
                <td>{{ formatLookupValue(row.reference?.range) }}</td>
                <td class="move-effect">
                  <span v-if="row.reference?.effect">{{ row.reference.effect }}</span>
                  <span v-else class="badge-empty">{{ row.move.name.trim() ? 'No matching move in moves.json' : '—' }}</span>
                </td>
                <td class="row-actions">
                  <button
                    v-if="!row.automatic"
                    type="button"
                    class="row-remove"
                    title="Remove move"
                    @click="removeMove(row.sheetIndex)"
                  >
                    <PhX :size="14" weight="bold" />
                  </button>
                  <span v-else class="row-auto-note" title="Auto-added from Struggle rules and capabilities">Auto</span>
                </td>
              </tr>
              <tr v-if="!moveRows.length">
                <td colspan="10" class="empty-cell">No moves yet — click "Add row" to start.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ============ Type Effectiveness ============ -->
      <section v-if="typeEffectivenessRows.length" class="panel-card">
        <h2 class="panel-title">
          Type Effectiveness
          <span class="panel-subtle panel-subtle--types">
            <span>vs</span>
            <TypeBadge
              v-for="type in sheetTypes"
              :key="`effectiveness-${type}`"
              :type="type"
              size="xs"
            />
          </span>
        </h2>
        <div class="type-grid">
          <div
            v-for="row in typeEffectivenessRows"
            :key="row.type"
            :class="['type-cell', `type-cell--${row.tone}`]"
          >
            <span class="type-name"><TypeBadge :type="row.type" size="xs" /></span>
            <span class="type-mult">×{{ row.label }}</span>
          </div>
        </div>
      </section>

      <!-- ============ Capabilities ============ -->
      <section class="panel-card">
        <h2 class="panel-title">Capabilities</h2>
        <dl class="caps-grid">
          <div>
            <dt>Overland</dt>
            <dd><EditableCell v-model="sheet.capabilities!.overland" type="number" :min="0" /></dd>
          </div>
          <div>
            <dt>Sky</dt>
            <dd><EditableCell v-model="sheet.capabilities!.sky" type="number" :min="0" /></dd>
          </div>
          <div>
            <dt>Swim</dt>
            <dd><EditableCell v-model="sheet.capabilities!.swim" type="number" :min="0" /></dd>
          </div>
          <div>
            <dt>Levitate</dt>
            <dd><EditableCell v-model="sheet.capabilities!.levitate" type="number" :min="0" /></dd>
          </div>
          <div>
            <dt>Burrow</dt>
            <dd><EditableCell v-model="sheet.capabilities!.burrow" type="number" :min="0" /></dd>
          </div>
          <div>
            <dt>Jump</dt>
            <dd><EditableCell v-model="sheet.capabilities!.jump" placeholder="2/1" /></dd>
          </div>
          <div>
            <dt>Power</dt>
            <dd><EditableCell v-model="sheet.capabilities!.power" type="number" :min="0" /></dd>
          </div>
          <div>
            <dt>Weight</dt>
            <dd><EditableCell v-model="sheet.capabilities!.weight" type="number" :min="0" /></dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd><EditableCell v-model="sheet.capabilities!.size" placeholder="Small" /></dd>
          </div>
        </dl>
        <p class="caps-line">
          <strong>Naturewalk:</strong>
          <EditableCell v-model="sheet.capabilities!.naturewalk" placeholder="Forest, Grasslands" />
        </p>
        <p class="caps-line">
          <strong>Other:</strong>
          <EditableCell v-model="otherCapsCsv" placeholder="Telepath, Aura Reader" />
        </p>
      </section>

      <!-- ============ Abilities + Edges ============ -->
      <div class="row two-col">
        <section class="panel-card">
          <h2 class="panel-title">
            Abilities
            <span class="panel-subtle">name editable · details from abilities.json</span>
            <button type="button" class="row-add" @click="addAbility">
              <PhPlus :size="14" weight="bold" /> Add row
            </button>
          </h2>
          <table class="kv-table">
            <thead>
              <tr><th>Name</th><th>Frequency</th><th>Trigger</th><th>Effect</th><th aria-label="Row actions"></th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in abilityRows" :key="i">
                <td class="kv-name">
                  <EditableCell
                    :model-value="row.ability.name"
                    placeholder="Ability"
                    @update:model-value="(v) => setLookupAbilityName(row.ability, v)"
                  />
                </td>
                <td>{{ formatLookupValue(row.reference?.frequency) }}</td>
                <td class="move-effect">{{ formatLookupValue(row.reference?.trigger) }}</td>
                <td class="move-effect">
                  <span v-if="row.reference?.effect">{{ row.reference.effect }}</span>
                  <span v-else class="badge-empty">{{ row.reference ? '—' : row.ability.name.trim() ? 'No matching ability in abilities.json' : '—' }}</span>
                </td>
                <td class="row-actions">
                  <button
                    type="button"
                    class="row-remove"
                    title="Remove ability"
                    @click="removeAbility(i)"
                  >
                    <PhX :size="14" weight="bold" />
                  </button>
                </td>
              </tr>
              <tr v-if="!abilityRows.length">
                <td colspan="5" class="empty-cell">No abilities yet.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="panel-card">
          <h2 class="panel-title">
            Poké Edges
            <button type="button" class="row-add" @click="addEdge">
              <PhPlus :size="14" weight="bold" /> Add row
            </button>
          </h2>
          <table class="kv-table">
            <thead>
              <tr><th>Name</th><th>Cost</th><th>Effect</th><th aria-label="Row actions"></th></tr>
            </thead>
            <tbody>
              <tr v-for="(edge, i) in sheet.edges" :key="i">
                <td class="kv-name">
                  <EditableCell v-model="edge.name" placeholder="Edge" />
                </td>
                <td><EditableCell v-model="edge.cost" placeholder="—" /></td>
                <td>
                  <EditableCell
                    v-model="edge.effect"
                    type="textarea"
                    placeholder="—"
                    multiline
                  />
                </td>
                <td class="row-actions">
                  <button
                    type="button"
                    class="row-remove"
                    title="Remove edge"
                    @click="removeEdge(i)"
                  >
                    <PhX :size="14" weight="bold" />
                  </button>
                </td>
              </tr>
              <tr v-if="!sheet.edges?.length">
                <td colspan="4" class="empty-cell">No edges yet.</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <!-- ============ Pokémon Skills ============ -->
      <section class="panel-card">
        <h2 class="panel-title">
          Pokémon Skills
          <span class="panel-subtle">bold = species-given · click any value to override</span>
        </h2>
        <dl class="skills-grid">
          <div
            v-for="skill in skills"
            :key="skill.key"
            :class="['skill-cell', { 'skill-cell--given': skill.speciesGiven }]"
          >
            <dt>{{ skill.label }}</dt>
            <dd>
              <EditableCell
                :model-value="sheet.skills?.[skill.key] ?? skill.value"
                :placeholder="skill.value"
                @update:model-value="(v) => {
                  if (!sheet) return
                  if (typeof v === 'string' && v.trim()) sheet.skills![skill.key] = v
                  else delete sheet.skills![skill.key]
                }"
              />
            </dd>
          </div>
        </dl>
      </section>
    </main>

    <main v-else class="sheet-empty">
      <section class="panel-card">
        <h1>Sheet not found</h1>
        <p>No sheet exists for slug <code>{{ route.params.slug }}</code>.</p>
        <NuxtLink to="/sheets" class="back-link">← Back to all sheets</NuxtLink>
      </section>
    </main>
  </div>
</template>

<style scoped>
.sheet-page {
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
  gap: 0.6rem;
}

.back-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0 0.25rem;
}

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

.sheet-body,
.sheet-empty {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
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

/* ---- Generic key-value list ---- */

.kv-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
}

.kv-list > div {
  display: grid;
  grid-template-columns: minmax(120px, max-content) 1fr;
  gap: 0.6rem;
  align-items: baseline;
}

.kv-list dt {
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.kv-list dd {
  margin: 0;
  color: var(--ink-bright);
}

.held-item-value {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.lookup-text {
  color: var(--ink-soft);
  font-size: 0.88rem;
  white-space: pre-wrap;
}

.lookup-text p {
  margin: 0;
}

.lookup-text p + p {
  margin-top: 0.35rem;
}

/* ---- Inherited moves ---- */

.inherited-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
  margin: 0;
}

.inherited-grid > div {
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  padding: 0.35rem 0.55rem;
  background: var(--paper-inset);
}

.inherited-grid dt {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.inherited-grid dd {
  margin: 0.15rem 0 0;
  color: var(--ink-bright);
  font-weight: 600;
}

.inherited-foot {
  margin: 0.5rem 0 0;
  color: var(--ink-soft);
  font-size: 0.85rem;
}

.bg-desc {
  margin: 0 0 0.55rem;
  color: var(--ink);
  font-family: var(--font-book);
  font-style: italic;
}

/* ---- Movelist & Abilities & Edges ---- */

.table-wrap { overflow: auto; }

.moves-table,
.kv-table {
  width: 100%;
  border-collapse: collapse;
}

.moves-table th,
.moves-table td,
.kv-table th,
.kv-table td {
  padding: 0.45rem 0.55rem;
  border-bottom: 1px solid var(--rule);
  text-align: left;
  vertical-align: top;
}

.moves-table th,
.kv-table th {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
  font-weight: 600;
}

.move-name,
.kv-name {
  font-weight: 700;
  color: var(--ink-bright);
  letter-spacing: 0.02em;
}

.move-effect {
  color: var(--ink-soft);
  font-size: 0.88rem;
}

.move-stab {
  display: inline-flex;
  margin-left: 0.25rem;
  color: var(--accent);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  vertical-align: middle;
}

.move-row--automatic {
  background: rgba(184, 187, 38, 0.06);
}

.move-auto-badge,
.row-auto-note {
  display: inline-flex;
  align-items: center;
  margin-left: 0.35rem;
  color: var(--ink-muted);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  vertical-align: middle;
}

.row-auto-note {
  margin-left: 0;
}

.empty-cell {
  text-align: center;
  color: var(--ink-muted);
  font-style: italic;
}

.row-actions {
  width: 1.5rem;
}

.row-add,
.row-remove {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  background: var(--paper-inset);
  color: var(--ink-soft);
  padding: 0.2rem 0.45rem;
  font: inherit;
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  margin-left: auto;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
}

.row-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.row-remove {
  margin: 0;
  padding: 0.2rem;
  border-color: transparent;
  background: transparent;
}

.row-remove:hover {
  color: #d36464;
  border-color: rgba(220, 80, 80, 0.45);
  background: rgba(220, 80, 80, 0.08);
}

/* ---- Type effectiveness ---- */

.type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(94px, 1fr));
  gap: 0.4rem;
}

.type-cell {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  padding: 0.45rem 0.55rem;
  background: var(--paper-inset);
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.type-cell--weak    { background: rgba(251, 73, 52, 0.14);  border-color: rgba(251, 73, 52, 0.45); }
.type-cell--resist  { background: rgba(184, 187, 38, 0.14); border-color: rgba(184, 187, 38, 0.45); }
.type-cell--immune  { background: rgba(168, 153, 132, 0.18); border-color: var(--rule-active); color: var(--ink-soft); }

.type-name {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.type-mult {
  font-weight: 700;
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-bright);
}

/* ---- Capabilities ---- */

.caps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.4rem;
  margin: 0;
}

.caps-grid > div {
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  padding: 0.4rem 0.55rem;
  background: var(--paper-inset);
}

.caps-grid dt {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.caps-grid dd {
  margin: 0.15rem 0 0;
  font-weight: 700;
  color: var(--ink-bright);
}

.caps-line {
  margin: 0.55rem 0 0;
  color: var(--ink);
}

.caps-line strong {
  color: var(--ink-bright);
  letter-spacing: 0.02em;
}

/* ---- Skills ---- */

.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.4rem;
  margin: 0;
}

.skill-cell {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  padding: 0.38rem 0.55rem;
  background: var(--paper-inset);
}

.skill-cell--given {
  background: var(--accent-soft);
  border-color: var(--accent);
}

.skill-cell--given dt { color: var(--ink-bright); font-weight: 700; }

.skill-cell dt {
  margin: 0;
  font-size: 0.85rem;
  color: var(--ink);
}

.skill-cell dd {
  margin: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ink-bright);
}

code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--accent);
}
</style>
