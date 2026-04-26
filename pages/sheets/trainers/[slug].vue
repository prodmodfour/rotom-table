<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhPlus, PhX } from '@phosphor-icons/vue'
import RefLink from '~/components/RefLink.vue'
import {
  trainerSheetsBySlug,
  resolveTrainerStats,
  resolveTrainerSkills,
  resolveTrainerCapabilities,
  resolveAdvancement,
  computeTrainerMaxHp,
  computeTrainerMaxAp,
  TRAINER_SKILL_ORDER,
} from '~/data/trainerSheets'
import { POKEMON_TYPES } from '~/utils/typeChart'
import { normalizeTrainerSheet } from '~/utils/sheetNormalize'
import { useEditableSheet, type SaveStatus } from '~/composables/useEditableSheet'
import type {
  InventoryEntry,
  SkillRank,
  TrainerAbilityEntry,
  TrainerAdvancementRow,
  TrainerClassEntry,
  TrainerEdgeEntry,
  TrainerFeatureEntry,
  TrainerManeuver,
  TrainerMove,
  TrainerOrder,
  TrainerSheet,
  TrainerSkillKey,
  TrainerStatKey,
} from '~/types/trainerSheet'

/** Map a skill key (``medicineEd``) back to its display label (``Medicine Ed``). */
const SKILL_LABEL: Record<TrainerSkillKey, string> = Object.fromEntries(
  TRAINER_SKILL_ORDER,
) as Record<TrainerSkillKey, string>

const SKILL_KEYS: TrainerSkillKey[] = TRAINER_SKILL_ORDER.map(([k]) => k)

const SKILL_OPTIONS = TRAINER_SKILL_ORDER.map(([value, label]) => ({ value, label }))

const RANK_OPTIONS: SkillRank[] = ['Pathetic', 'Untrained', 'Novice', 'Adept', 'Expert', 'Master']

const CATEGORY_OPTIONS = ['Physical', 'Special', 'Status']

const TYPE_OPTIONS = POKEMON_TYPES.map((t) => ({ value: t, label: t }))

// ---------------------------------------------------------------------------
// Editable sheet wiring
// ---------------------------------------------------------------------------

// Route the page key off the slug so navigating between trainer sheets
// forces a fresh component instance and a clean editable state.
definePageMeta({
  key: (route) => `trainer-${route.params.slug}`,
})

const route = useRoute()
const slug = String(route.params.slug ?? '')
const baseSheet = trainerSheetsBySlug.get(slug) ?? null

const initialClone: TrainerSheet | null = baseSheet
  ? normalizeTrainerSheet(JSON.parse(JSON.stringify(baseSheet)) as TrainerSheet)
  : null

const editor = initialClone ? useEditableSheet(initialClone, 'trainer') : null
const sheet = computed<TrainerSheet | null>(() => editor?.sheet.value ?? null)
const saveStatus = computed<SaveStatus>(() => editor?.saveStatus.value ?? 'idle')
const saveError = computed<string | null>(() => editor?.saveError.value ?? null)

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

const stats     = computed(() => sheet.value ? resolveTrainerStats(sheet.value) : [])
const skills    = computed(() => sheet.value ? resolveTrainerSkills(sheet.value) : [])
const capRes    = computed(() => sheet.value ? resolveTrainerCapabilities(sheet.value) : { rows: [], other: [] })
const adv       = computed(() => sheet.value ? resolveAdvancement(sheet.value) : [])

const maxHp     = computed(() => sheet.value ? computeTrainerMaxHp(sheet.value) : 0)
const maxAp     = computed(() => sheet.value ? computeTrainerMaxAp(sheet.value) : 0)
const currentHp = computed(() => sheet.value?.currentHp ?? maxHp.value)
const apLeft    = computed(() => sheet.value?.ap?.left ?? maxAp.value)

const totalRow = (key: TrainerStatKey) =>
  stats.value.find((s) => s.key === key)?.total ?? 0

const injuries = computed(() => sheet.value?.currentInjuries ?? 0)
const injuredHp = computed(() =>
  Math.max(0, Math.floor(maxHp.value * (1 - 0.1 * injuries.value))),
)
const tickValue = computed(() => Math.max(1, Math.ceil(maxHp.value / 10)))

// ---------------------------------------------------------------------------
// CSV-backed v-models (arrays exposed as comma-separated input)
// ---------------------------------------------------------------------------

const splitCSV = (raw: string): string[] =>
  raw.split(',').map((s) => s.trim()).filter(Boolean)

const splitSkillCSV = (raw: string): TrainerSkillKey[] =>
  splitCSV(raw).filter((v): v is TrainerSkillKey => (SKILL_KEYS as string[]).includes(v))

const adeptCsv = computed<string>({
  get: () => {
    const v = sheet.value?.skillBackground?.adept
    if (!v) return ''
    return Array.isArray(v) ? v.join(', ') : v
  },
  set: (raw) => {
    if (!sheet.value) return
    const next = splitSkillCSV(raw)
    sheet.value.skillBackground!.adept = next.length === 0
      ? undefined
      : next.length === 1 ? next[0] : next
  },
})

const noviceCsv = computed<string>({
  get: () => {
    const v = sheet.value?.skillBackground?.novice
    if (!v) return ''
    return Array.isArray(v) ? v.join(', ') : v
  },
  set: (raw) => {
    if (!sheet.value) return
    const next = splitSkillCSV(raw)
    sheet.value.skillBackground!.novice = next.length === 0
      ? undefined
      : next.length === 1 ? next[0] : next
  },
})

const patheticCsv = computed<string>({
  get: () => sheet.value?.skillBackground?.pathetic?.join(', ') ?? '',
  set: (raw) => {
    if (!sheet.value) return
    sheet.value.skillBackground!.pathetic = splitSkillCSV(raw)
  },
})

const otherCapsCsv = computed<string>({
  get: () => sheet.value?.capabilities?.other?.join(', ') ?? '',
  set: (raw) => {
    if (!sheet.value) return
    sheet.value.capabilities!.other = splitCSV(raw)
  },
})

const currentTeamCsv = computed<string>({
  get: () => sheet.value?.currentTeam?.join(', ') ?? '',
  set: (raw) => {
    if (!sheet.value) return
    sheet.value.currentTeam = splitCSV(raw)
  },
})

const wishlistCsv = computed<string>({
  get: () => sheet.value?.wishlist?.join(', ') ?? '',
  set: (raw) => {
    if (!sheet.value) return
    sheet.value.wishlist = splitCSV(raw)
  },
})

// ---------------------------------------------------------------------------
// Row mutation helpers — each mutation flows through the deep watcher into a
// single debounced save, so spamming "Add row" still results in one write.
// ---------------------------------------------------------------------------

const addClass = () =>
  sheet.value?.classes?.push({ name: 'New Class' } as TrainerClassEntry)
const removeClass = (i: number) =>
  sheet.value?.classes?.splice(i, 1)

const addMove = () =>
  sheet.value?.movelist?.push({ name: 'New Move' } as TrainerMove)
const removeMove = (i: number) =>
  sheet.value?.movelist?.splice(i, 1)

const addAbility = () =>
  sheet.value?.abilities?.push({ name: 'New Ability' } as TrainerAbilityEntry)
const removeAbility = (i: number) =>
  sheet.value?.abilities?.splice(i, 1)

const addManeuver = () =>
  sheet.value?.maneuvers?.push({ name: 'New Maneuver' } as TrainerManeuver)
const removeManeuver = (i: number) =>
  sheet.value?.maneuvers?.splice(i, 1)

const addOrder = () =>
  sheet.value?.orders?.push({ name: 'New Order' } as TrainerOrder)
const removeOrder = (i: number) =>
  sheet.value?.orders?.splice(i, 1)

const addFeature = () =>
  sheet.value?.features?.push({ name: 'New Feature' } as TrainerFeatureEntry)
const removeFeature = (i: number) =>
  sheet.value?.features?.splice(i, 1)

const addEdge = () =>
  sheet.value?.edges?.push({ name: 'New Edge' } as TrainerEdgeEntry)
const removeEdge = (i: number) =>
  sheet.value?.edges?.splice(i, 1)

const addAdvancement = (level: number) => {
  if (!sheet.value?.advancement) return
  if (sheet.value.advancement.find((row) => row.level === level)) return
  sheet.value.advancement.push({ level } as TrainerAdvancementRow)
}

/** Update an advancement row, creating it if missing. */
const setAdv = (level: number, field: keyof TrainerAdvancementRow, value: number | string | undefined) => {
  if (!sheet.value) return
  const list = sheet.value.advancement ?? (sheet.value.advancement = [])
  let row = list.find((r) => r.level === level)
  if (!row) {
    row = { level }
    list.push(row)
  }
  ;(row as Record<string, unknown>)[field as string] = value
}

const addInvItem = (key: keyof NonNullable<TrainerSheet['inventory']>) => {
  const inv = sheet.value?.inventory
  if (!inv) return
  ;(inv[key] as InventoryEntry[]).push({ name: 'New Item' })
}

const removeInvItem = (key: keyof NonNullable<TrainerSheet['inventory']>, i: number) => {
  const inv = sheet.value?.inventory
  if (!inv) return
  ;(inv[key] as InventoryEntry[]).splice(i, 1)
}

// Tags are stored as ``string[]`` on features/orders; expose as CSV.
const featureTagsCsv = (f: TrainerFeatureEntry): string => f.tags?.join(', ') ?? ''
const setFeatureTags = (f: TrainerFeatureEntry, raw: string) => {
  f.tags = splitCSV(raw)
}

const orderTagsCsv = (o: TrainerOrder): string => o.tags?.join(', ') ?? ''
const setOrderTags = (o: TrainerOrder, raw: string) => {
  o.tags = splitCSV(raw)
}

/** Update a stat sub-field (base/feats/bonus/levelUp/stage). */
const setStatField = (
  key: TrainerStatKey,
  field: 'base' | 'feats' | 'bonus' | 'levelUp' | 'stage',
  value: number | undefined,
) => {
  if (!sheet.value?.stats) return
  const row = sheet.value.stats[key] ?? {}
  row[field] = typeof value === 'number' ? value : 0
  sheet.value.stats[key] = row
}

/** Update a skill's rank/modifier override. */
const setSkillRank = (key: TrainerSkillKey, rank: SkillRank | undefined) => {
  if (!sheet.value?.skills) return
  const existing = sheet.value.skills[key] ?? {}
  if (!rank) delete existing.rank
  else existing.rank = rank
  if (existing.rank == null && existing.modifier == null) delete sheet.value.skills[key]
  else sheet.value.skills[key] = existing
}

const setSkillModifier = (key: TrainerSkillKey, modifier: number | undefined) => {
  if (!sheet.value?.skills) return
  const existing = sheet.value.skills[key] ?? {}
  if (modifier === undefined || modifier === 0) delete existing.modifier
  else existing.modifier = modifier
  if (existing.rank == null && existing.modifier == null) delete sheet.value.skills[key]
  else sheet.value.skills[key] = existing
}

const skillModifier = (key: TrainerSkillKey): number =>
  sheet.value?.skills?.[key]?.modifier ?? 0
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
      <header class="identity-strip">
        <div class="identity-info">
          <h1><EditableCell v-model="sheet.name" placeholder="Trainer name" /></h1>
          <p class="identity-meta">
            Lv <EditableCell v-model="sheet.level" type="number" :min="1" /> ·
            <EditableCell v-model="sheet.sex" placeholder="Sex" /> · Age
            <EditableCell v-model="sheet.age" placeholder="—" /> ·
            <EditableCell v-model="sheet.height" placeholder="5'4" /> ·
            <EditableCell v-model="sheet.weight" placeholder="115 lb" />
          </p>
          <p class="identity-played-by">
            Played by
            <strong><EditableCell v-model="sheet.playedBy" placeholder="—" /></strong>
          </p>
        </div>
        <div class="identity-vitals">
          <div class="vital">
            <span class="vital-label">HP</span>
            <span class="vital-value">
              <EditableCell v-model="sheet.currentHp" type="number" :min="0" />
              <span class="vital-divider">/</span> {{ maxHp }}
            </span>
          </div>
          <div class="vital">
            <span class="vital-label">AP</span>
            <span class="vital-value">
              <EditableCell v-model="sheet.ap!.left" type="number" :min="0" />
              <span class="vital-divider">/</span> {{ maxAp }}
            </span>
          </div>
          <div class="vital">
            <span class="vital-label">Injuries</span>
            <span class="vital-value">
              <EditableCell v-model="sheet.currentInjuries" type="number" :min="0" :max="10" />
            </span>
          </div>
          <div class="vital">
            <span class="vital-label">Money</span>
            <span class="vital-value">
              $<EditableCell v-model="sheet.money" type="number" :min="0" />
            </span>
          </div>
        </div>
      </header>

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
          <!-- Stats -->
          <div class="block">
            <h2 class="block-title">Stats</h2>
            <table class="data-table stats-table">
              <thead>
                <tr>
                  <th>Stat</th>
                  <th>Base</th>
                  <th>Feats</th>
                  <th>Bonus</th>
                  <th>Lvl-Up</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in stats" :key="s.key">
                  <th>{{ s.label }}</th>
                  <td>
                    <EditableCell
                      :model-value="s.base"
                      type="number"
                      :min="0"
                      @update:model-value="(v) => setStatField(s.key, 'base', v as number)"
                    />
                  </td>
                  <td>
                    <EditableCell
                      :model-value="s.feats"
                      type="number"
                      :min="0"
                      @update:model-value="(v) => setStatField(s.key, 'feats', v as number)"
                    />
                  </td>
                  <td>
                    <EditableCell
                      :model-value="s.bonus"
                      type="number"
                      :min="0"
                      @update:model-value="(v) => setStatField(s.key, 'bonus', v as number)"
                    />
                  </td>
                  <td>
                    <EditableCell
                      :model-value="s.levelUp"
                      type="number"
                      :min="0"
                      @update:model-value="(v) => setStatField(s.key, 'levelUp', v as number)"
                    />
                  </td>
                  <td><strong>{{ s.total }}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Skill background + counts -->
          <div class="block">
            <h2 class="block-title">Skill Background</h2>
            <div class="bg-card">
              <div class="bg-name">
                <EditableCell v-model="sheet.skillBackground!.name" placeholder="Background name" />
              </div>
              <p class="bg-desc">
                <EditableCell
                  v-model="sheet.skillBackground!.description"
                  type="textarea"
                  placeholder="Background description"
                  multiline
                />
              </p>
              <ul class="bg-list">
                <li>
                  <span class="bg-tag adept">Adept</span>
                  <EditableCell v-model="adeptCsv" placeholder="survival" />
                </li>
                <li>
                  <span class="bg-tag novice">Novice</span>
                  <EditableCell v-model="noviceCsv" placeholder="medicineEd" />
                </li>
                <li>
                  <span class="bg-tag pathetic">Pathetic</span>
                  <EditableCell v-model="patheticCsv" placeholder="combat, intimidate" />
                </li>
              </ul>
            </div>

            <h2 class="block-title block-title--spaced">Milestones</h2>
            <ul class="kv-list">
              <li><span>Milestones</span>
                <strong><EditableCell v-model="sheet.milestones" type="number" :min="0" /></strong>
              </li>
              <li><span>Dex EXP</span>
                <strong><EditableCell v-model="sheet.dexExp" type="number" :min="0" /></strong>
              </li>
              <li><span>Misc EXP</span>
                <strong><EditableCell v-model="sheet.miscExp" type="number" :min="0" /></strong>
              </li>
              <li><span>Bonus Skill Edges</span>
                <strong><EditableCell v-model="sheet.bonusSkillEdges" type="number" :min="0" /></strong>
              </li>
              <li><span>Features remaining</span>
                <strong><EditableCell v-model="sheet.remainingFeatures" type="number" :min="0" /></strong>
              </li>
              <li><span>Edges remaining</span>
                <strong><EditableCell v-model="sheet.remainingEdges" type="number" :min="0" /></strong>
              </li>
            </ul>
          </div>
        </div>

        <!-- Skills grid -->
        <div class="block">
          <h2 class="block-title">Skills</h2>
          <div class="skills-grid">
            <div
              v-for="s in skills"
              :key="s.key"
              :class="['skill-row', {
                raised: s.raised,
                lowered: s.lowered,
              }]"
            >
              <span class="skill-label">{{ s.label }}</span>
              <span class="skill-rank">
                <EditableCell
                  :model-value="s.rank"
                  type="select"
                  :options="RANK_OPTIONS"
                  @update:model-value="(v) => setSkillRank(s.key, v as SkillRank | undefined)"
                />
              </span>
              <span class="skill-dice">
                {{ s.dice }}
                <EditableCell
                  :model-value="skillModifier(s.key)"
                  type="number"
                  :format="(v) => (typeof v === 'number' && v !== 0 ? (v > 0 ? `+${v}` : String(v)) : '+0')"
                  @update:model-value="(v) => setSkillModifier(s.key, v as number | undefined)"
                />
              </span>
            </div>
          </div>
        </div>

        <!-- Classes -->
        <div class="block">
          <h2 class="block-title">
            Trainer Classes
            <button type="button" class="row-add" @click="addClass">
              <PhPlus :size="14" weight="bold" /> Add row
            </button>
          </h2>
          <ul class="ref-list-vertical">
            <li v-for="(cls, i) in sheet.classes" :key="i" class="cls-row">
              <EditableCell v-model="cls.name" placeholder="Class name" />
              <span v-if="cls.specialisation || cls.name" class="cls-spec">
                (<EditableCell v-model="cls.specialisation" placeholder="—" />)
              </span>
              <span class="cls-notes">
                — <EditableCell v-model="cls.notes" placeholder="notes" />
              </span>
              <button type="button" class="row-remove" title="Remove class" @click="removeClass(i)">
                <PhX :size="14" weight="bold" />
              </button>
            </li>
            <li v-if="!sheet.classes?.length" class="muted">No classes yet.</li>
          </ul>
        </div>

        <!-- Training feature -->
        <div class="block">
          <h2 class="block-title">Training Feature</h2>
          <p>
            <EditableCell v-model="sheet.trainingFeature" placeholder="Inspired Training" />
          </p>
        </div>

        <!-- Advancement -->
        <div class="block">
          <h2 class="block-title">Trainer Advancement</h2>
          <table class="data-table adv-table">
            <thead>
              <tr><th>Level</th><th>Stats</th><th>Att</th><th>Sp.Att</th><th>Notes</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in adv" :key="row.level">
                <th>Lv {{ row.level }}</th>
                <td>
                  <EditableCell
                    :model-value="row.stats"
                    type="number"
                    :min="0"
                    @update:model-value="(v) => setAdv(row.level, 'stats', v as number)"
                  />
                </td>
                <td>
                  <EditableCell
                    :model-value="row.attack"
                    type="number"
                    :min="0"
                    @update:model-value="(v) => setAdv(row.level, 'attack', v as number)"
                  />
                </td>
                <td>
                  <EditableCell
                    :model-value="row.spAttack"
                    type="number"
                    :min="0"
                    @update:model-value="(v) => setAdv(row.level, 'spAttack', v as number)"
                  />
                </td>
                <td class="notes-col">
                  <EditableCell
                    :model-value="row.notes"
                    placeholder="—"
                    @update:model-value="(v) => setAdv(row.level, 'notes', v as string)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Team / wishlist -->
        <div class="grid-two">
          <div class="block">
            <h2 class="block-title">Current Team</h2>
            <p class="muted-help">Comma-separated Pokémon sheet slugs (e.g. <code>specs-chikorita</code>).</p>
            <EditableCell v-model="currentTeamCsv" placeholder="specs-chikorita" />
            <ul v-if="sheet.currentTeam?.length" class="ref-list-vertical" style="margin-top: 0.55rem">
              <li v-for="memberSlug in sheet.currentTeam" :key="memberSlug">
                <NuxtLink :to="`/sheets/${memberSlug}`">{{ memberSlug }}</NuxtLink>
              </li>
            </ul>
          </div>
          <div class="block">
            <h2 class="block-title">Pokémon Wishlist</h2>
            <p class="muted-help">Comma-separated species names.</p>
            <EditableCell v-model="wishlistCsv" placeholder="Cherubi, Bounsweet" />
          </div>
        </div>

        <!-- Narrative blocks -->
        <div class="narrative-grid">
          <div class="narrative narrative--red">
            <h3>Physical Description</h3>
            <p>
              <EditableCell
                v-model="sheet.physicalDescription"
                type="textarea"
                placeholder="Physical description"
                multiline
              />
            </p>
          </div>
          <div class="narrative narrative--yellow">
            <h3>Background</h3>
            <p>
              <EditableCell
                v-model="sheet.background"
                type="textarea"
                placeholder="Background"
                multiline
              />
            </p>
          </div>
          <div class="narrative narrative--purple">
            <h3>Personality</h3>
            <p>
              <EditableCell
                v-model="sheet.personality"
                type="textarea"
                placeholder="Personality"
                multiline
              />
            </p>
          </div>
          <div class="narrative narrative--green">
            <h3>Goals / Dreams / Obsessions</h3>
            <p>
              <EditableCell
                v-model="sheet.goalsAndDreams"
                type="textarea"
                placeholder="Goals & dreams"
                multiline
              />
            </p>
          </div>
        </div>
      </section>

      <!-- =================================================================== -->
      <!-- COMBAT TAB                                                           -->
      <!-- =================================================================== -->
      <section v-if="activeTab === 'combat'" class="tab-panel">
        <div class="combat-strip">
          <div class="combat-cell"><span>Current HP</span>
            <strong><EditableCell v-model="sheet.currentHp" type="number" :min="0" /></strong>
          </div>
          <div class="combat-cell"><span>Max HP</span><strong>{{ maxHp }}</strong></div>
          <div class="combat-cell"><span>Injured HP</span><strong>{{ injuredHp }}</strong></div>
          <div class="combat-cell"><span>Tick</span><strong>{{ tickValue }}</strong></div>
          <div class="combat-cell"><span>DR</span>
            <strong><EditableCell v-model="sheet.damageReduction" type="number" :min="0" /></strong>
          </div>
          <div class="combat-cell"><span>Lv</span>
            <strong><EditableCell v-model="sheet.level" type="number" :min="1" /></strong>
          </div>
          <div class="combat-cell"><span>CS Atk</span><strong>{{ totalRow('atk') }}</strong></div>
          <div class="combat-cell"><span>CS SAtk</span><strong>{{ totalRow('satk') }}</strong></div>
          <div class="combat-cell"><span>Speed</span><strong>{{ totalRow('spd') }}</strong></div>
        </div>

        <div class="grid-two">
          <div class="block">
            <h2 class="block-title">Action Points</h2>
            <table class="data-table ap-table">
              <thead><tr><th>Left</th><th>Spent</th><th>Bound</th><th>Drained</th><th>Max</th></tr></thead>
              <tbody>
                <tr>
                  <td><EditableCell v-model="sheet.ap!.left"    type="number" :min="0" /></td>
                  <td><EditableCell v-model="sheet.ap!.spent"   type="number" :min="0" /></td>
                  <td><EditableCell v-model="sheet.ap!.bound"   type="number" :min="0" /></td>
                  <td><EditableCell v-model="sheet.ap!.drained" type="number" :min="0" /></td>
                  <td><strong>{{ maxAp }}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="block">
            <h2 class="block-title">Evasion</h2>
            <ul class="kv-list">
              <li><span>Speed Evasion</span>
                <strong><EditableCell v-model="sheet.evasion!.speed"    type="number" :min="0" /></strong>
              </li>
              <li><span>Physical Evasion</span>
                <strong><EditableCell v-model="sheet.evasion!.physical" type="number" :min="0" /></strong>
              </li>
              <li><span>Special Evasion</span>
                <strong><EditableCell v-model="sheet.evasion!.special"  type="number" :min="0" /></strong>
              </li>
            </ul>
            <p class="muted">
              <strong>Status:</strong>
              <EditableCell v-model="sheet.statusAfflictions" placeholder="None" />
            </p>
            <p class="muted">
              <strong>Digestion:</strong>
              <EditableCell v-model="sheet.digestion" placeholder="—" />
            </p>
          </div>
        </div>

        <div class="block">
          <h2 class="block-title">Capabilities</h2>
          <ul class="cap-grid">
            <li>
              <span class="cap-label">Overland</span>
              <span class="cap-value">
                <EditableCell v-model="sheet.capabilities!.overland" type="number" :min="0" />
              </span>
            </li>
            <li>
              <span class="cap-label">Throw Range</span>
              <span class="cap-value">
                <EditableCell v-model="sheet.capabilities!.throwingRange" type="number" :min="0" />
              </span>
            </li>
            <li>
              <span class="cap-label">High Jump</span>
              <span class="cap-value">
                <EditableCell v-model="sheet.capabilities!.highJump" type="number" :min="0" />
              </span>
            </li>
            <li>
              <span class="cap-label">Long Jump</span>
              <span class="cap-value">
                <EditableCell v-model="sheet.capabilities!.longJump" type="number" :min="0" />
              </span>
            </li>
            <li>
              <span class="cap-label">Swim</span>
              <span class="cap-value">
                <EditableCell v-model="sheet.capabilities!.swim" type="number" :min="0" />
              </span>
            </li>
            <li>
              <span class="cap-label">Power</span>
              <span class="cap-value">
                <EditableCell v-model="sheet.capabilities!.power" type="number" :min="0" />
              </span>
            </li>
            <li>
              <span class="cap-label">Sky</span>
              <span class="cap-value">
                <EditableCell v-model="sheet.capabilities!.sky" type="number" :min="0" />
              </span>
            </li>
            <li>
              <span class="cap-label">Levitate</span>
              <span class="cap-value">
                <EditableCell v-model="sheet.capabilities!.levitate" type="number" :min="0" />
              </span>
            </li>
            <li>
              <span class="cap-label">Burrow</span>
              <span class="cap-value">
                <EditableCell v-model="sheet.capabilities!.burrow" type="number" :min="0" />
              </span>
            </li>
          </ul>
          <p class="muted-help" style="margin-top: 0.6rem">
            <strong>Other capabilities:</strong>
            <EditableCell v-model="otherCapsCsv" placeholder="Telepath, Aura Reader" />
          </p>
        </div>

        <div class="block">
          <h2 class="block-title">
            Movelist
            <button type="button" class="row-add" @click="addMove">
              <PhPlus :size="14" weight="bold" /> Add row
            </button>
          </h2>
          <table class="data-table movelist-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Cat.</th>
                <th>DB</th>
                <th>Damage Roll</th>
                <th>Frequency</th>
                <th>AC</th>
                <th>Range</th>
                <th>Effect</th>
                <th aria-label="Row actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(mv, i) in sheet.movelist" :key="i">
                <th><EditableCell v-model="mv.name" placeholder="Move" /></th>
                <td>
                  <EditableCell
                    v-model="mv.type"
                    type="select"
                    :options="TYPE_OPTIONS"
                    placeholder="—"
                  />
                </td>
                <td>
                  <EditableCell
                    v-model="mv.category"
                    type="select"
                    :options="CATEGORY_OPTIONS"
                    placeholder="—"
                  />
                </td>
                <td><EditableCell v-model="mv.db" type="number" /></td>
                <td><EditableCell v-model="mv.damageRoll" placeholder="1d8+6" /></td>
                <td><EditableCell v-model="mv.frequency" placeholder="At-Will" /></td>
                <td><EditableCell v-model="mv.ac" type="number" /></td>
                <td><EditableCell v-model="mv.range" placeholder="Melee" /></td>
                <td class="effect-col">
                  <EditableCell v-model="mv.effect" type="textarea" placeholder="—" multiline />
                </td>
                <td class="row-actions">
                  <button type="button" class="row-remove" title="Remove move" @click="removeMove(i)">
                    <PhX :size="14" weight="bold" />
                  </button>
                </td>
              </tr>
              <tr v-if="!sheet.movelist?.length">
                <td colspan="10" class="muted">No moves yet — click "Add row" to start.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="block">
          <h2 class="block-title">
            Abilities
            <button type="button" class="row-add" @click="addAbility">
              <PhPlus :size="14" weight="bold" /> Add row
            </button>
          </h2>
          <ul class="kv-list">
            <li v-for="(a, i) in sheet.abilities" :key="i">
              <span>
                <EditableCell v-model="a.name" placeholder="Ability" />
                <span class="muted"> · </span>
                <EditableCell v-model="a.frequency" placeholder="Static" />
              </span>
              <span class="effect-col">
                <EditableCell v-model="a.effect" type="textarea" placeholder="—" multiline />
              </span>
              <button type="button" class="row-remove" title="Remove ability" @click="removeAbility(i)">
                <PhX :size="14" weight="bold" />
              </button>
            </li>
            <li v-if="!sheet.abilities?.length" class="muted">No abilities yet.</li>
          </ul>
        </div>

        <div class="block">
          <h2 class="block-title">
            Maneuvers
            <button type="button" class="row-add" @click="addManeuver">
              <PhPlus :size="14" weight="bold" /> Add row
            </button>
          </h2>
          <table class="data-table">
            <thead><tr><th>Name</th><th>Action</th><th>Cat.</th><th>AC</th><th>Range</th><th>Effect</th><th aria-label="Row actions"></th></tr></thead>
            <tbody>
              <tr v-for="(m, i) in sheet.maneuvers" :key="i">
                <th><EditableCell v-model="m.name" placeholder="Maneuver" /></th>
                <td><EditableCell v-model="m.action" placeholder="Standard" /></td>
                <td>
                  <EditableCell
                    v-model="m.category"
                    type="select"
                    :options="CATEGORY_OPTIONS"
                    placeholder="—"
                  />
                </td>
                <td><EditableCell v-model="m.ac" type="number" /></td>
                <td><EditableCell v-model="m.range" placeholder="Melee" /></td>
                <td class="effect-col">
                  <EditableCell v-model="m.effect" type="textarea" placeholder="—" multiline />
                </td>
                <td class="row-actions">
                  <button type="button" class="row-remove" title="Remove maneuver" @click="removeManeuver(i)">
                    <PhX :size="14" weight="bold" />
                  </button>
                </td>
              </tr>
              <tr v-if="!sheet.maneuvers?.length">
                <td colspan="7" class="muted">No maneuvers yet.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="block">
          <h2 class="block-title">
            Pokémon Training &amp; Orders
            <button type="button" class="row-add" @click="addOrder">
              <PhPlus :size="14" weight="bold" /> Add row
            </button>
          </h2>
          <ul class="kv-list">
            <li v-for="(o, i) in sheet.orders" :key="i">
              <span>
                <strong><EditableCell v-model="o.name" placeholder="Order" /></strong>
                <span class="muted"> · </span>
                <EditableCell
                  :model-value="orderTagsCsv(o)"
                  placeholder="Orders"
                  @update:model-value="(v) => setOrderTags(o, (v as string) ?? '')"
                />
              </span>
              <span class="effect-col">
                <EditableCell v-model="o.effect" type="textarea" placeholder="—" multiline />
              </span>
              <button type="button" class="row-remove" title="Remove order" @click="removeOrder(i)">
                <PhX :size="14" weight="bold" />
              </button>
            </li>
            <li v-if="!sheet.orders?.length" class="muted">No orders yet.</li>
          </ul>
        </div>
      </section>

      <!-- =================================================================== -->
      <!-- INVENTORY TAB                                                        -->
      <!-- =================================================================== -->
      <section v-if="activeTab === 'inventory'" class="tab-panel">
        <div class="block">
          <h2 class="block-title">Equipped</h2>
          <ul class="kv-list">
            <li><span>Main Hand</span>
              <strong><EditableCell v-model="sheet.equipmentSlots!.mainHand" placeholder="—" /></strong>
            </li>
            <li><span>Off Hand</span>
              <strong><EditableCell v-model="sheet.equipmentSlots!.offHand"  placeholder="—" /></strong>
            </li>
            <li><span>Head</span>
              <strong><EditableCell v-model="sheet.equipmentSlots!.head"     placeholder="—" /></strong>
            </li>
            <li><span>Body</span>
              <strong><EditableCell v-model="sheet.equipmentSlots!.body"     placeholder="—" /></strong>
            </li>
            <li><span>Feet</span>
              <strong><EditableCell v-model="sheet.equipmentSlots!.feet"     placeholder="—" /></strong>
            </li>
            <li><span>Accessory</span>
              <strong><EditableCell v-model="sheet.equipmentSlots!.accessory" placeholder="—" /></strong>
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
                  <th><EditableCell v-model="it.name" placeholder="Item" /></th>
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
                  <th><EditableCell v-model="it.name" placeholder="Item" /></th>
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
                  <th><EditableCell v-model="it.name" placeholder="Item" /></th>
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
                  <th><EditableCell v-model="it.name" placeholder="Poké Ball" /></th>
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
                  <th><EditableCell v-model="it.name" placeholder="Food" /></th>
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
                  <th><EditableCell v-model="it.name" placeholder="Equipment" /></th>
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

/* ===== Identity ===== */
.identity-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--rule-soft);
}

.identity-info h1 {
  margin: 0 0 0.25rem;
  font-family: var(--serif);
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.identity-meta {
  margin: 0;
  color: var(--ink-soft);
  font-style: italic;
}

.identity-played-by {
  margin: 0.25rem 0 0;
  color: var(--ink-muted);
  font-size: 0.85rem;
}

.identity-vitals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.45rem;
  min-width: 320px;
}

.vital {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
}

.vital-label {
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.vital-value {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
}

.vital-divider {
  color: var(--ink-faint);
  font-weight: 400;
  margin: 0 0.18rem;
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
  font-family: var(--serif);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.block-title--spaced { margin-top: 0.85rem; }

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

.stats-table tbody th { color: var(--accent); letter-spacing: 0.04em; }

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

/* Skills */
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.3rem;
}

.skill-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: baseline;
  gap: 0.45rem;
  padding: 0.32rem 0.5rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
}

.skill-row.raised {
  border-color: rgba(184, 187, 38, 0.45);
  background: rgba(184, 187, 38, 0.12);
}

.skill-row.lowered {
  border-color: rgba(251, 73, 52, 0.45);
  background: rgba(251, 73, 52, 0.12);
}

.skill-label { color: var(--ink); font-weight: 500; font-size: 0.86rem; }
.skill-rank  { color: var(--ink-muted); font-size: 0.78rem; letter-spacing: 0.04em; }
.skill-dice  { color: var(--accent); font-weight: 700; font-size: 0.82rem; display: inline-flex; gap: 0.25rem; align-items: baseline; }

/* Background card */
.bg-card { display: flex; flex-direction: column; gap: 0.4rem; }
.bg-name { font-family: var(--serif); font-size: 1.1rem; font-weight: 700; letter-spacing: 0.04em; color: var(--accent); }
.bg-desc { margin: 0; color: var(--ink-soft); font-style: italic; font-size: 0.88rem; }

.bg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.bg-list li {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.85rem;
}

.bg-tag {
  display: inline-flex;
  padding: 0.12rem 0.55rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 1px solid transparent;
}

.bg-tag.adept    { background: rgba(184, 187, 38, 0.16); color: var(--good); border-color: rgba(184, 187, 38, 0.45); }
.bg-tag.novice   { background: var(--accent-soft);       color: var(--accent); border-color: rgba(250, 189, 47, 0.4); }
.bg-tag.pathetic { background: rgba(251, 73, 52, 0.16);  color: var(--bad);  border-color: rgba(251, 73, 52, 0.45); }

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

.ref-list-vertical {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.32rem;
}

.cls-row { display: inline-flex; align-items: baseline; gap: 0.35rem; flex-wrap: wrap; }
.cls-spec  { color: var(--accent); font-style: italic; }
.cls-notes { color: var(--ink-soft); }

/* Combat strip */
.combat-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 0.4rem;
}

.combat-cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.45rem 0.5rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  text-align: center;
}

.combat-cell span {
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.combat-cell strong {
  font-size: 1.15rem;
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
  font-family: var(--serif);
}

/* Capabilities */
.cap-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.35rem;
}

.cap-grid li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
}

.cap-label { color: var(--ink-soft); font-size: 0.82rem; }
.cap-value { color: var(--ink-bright); font-weight: 700; font-size: 0.92rem; font-variant-numeric: tabular-nums; }

/* Movelist columns */
.movelist-table th,
.movelist-table td { vertical-align: top; }
.effect-col { color: var(--ink-soft); white-space: pre-wrap; max-width: 22rem; }
.notes-col { color: var(--ink-muted); }

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

/* Narrative panels */
.narrative-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.6rem;
}

.narrative {
  border-radius: 10px;
  padding: 0.7rem 0.85rem 0.7rem 1rem;
  border: 1px solid var(--rule-soft);
  border-left: 3px solid var(--rule-strong);
  background: var(--paper-inset);
}

.narrative h3 {
  margin: 0 0 0.35rem;
  font-family: var(--serif);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
}

.narrative p {
  margin: 0;
  line-height: 1.55;
  color: var(--ink);
  font-family: var(--serif);
  font-size: 0.95rem;
}

.narrative--red    { border-left-color: var(--bad); }
.narrative--red h3 { color: var(--bad); }

.narrative--yellow { border-left-color: var(--accent); }
.narrative--yellow h3 { color: var(--accent); }

.narrative--purple { border-left-color: var(--magic); }
.narrative--purple h3 { color: var(--magic); }

.narrative--green  { border-left-color: var(--good); }
.narrative--green h3 { color: var(--good); }
</style>
