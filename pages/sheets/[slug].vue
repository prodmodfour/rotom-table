<script setup lang="ts">
import { computed, watch } from 'vue'
import { PhPlus, PhX } from '@phosphor-icons/vue'
import {
  characterSheetsBySlug,
  computeMaxHp,
  getPokedexEntry,
  getSpriteUrl,
  resolveCapabilities,
  resolveSkills,
  resolveStats,
} from '~/data/characterSheets'
import { POKEMON_TYPES, computeMultiplier, formatMultiplier } from '~/utils/typeChart'
import { normalizeCharacterSheet } from '~/utils/sheetNormalize'
import { PTU_NATURE_OPTIONS, resolveNatureMod } from '~/utils/ptuNatures'
import { makeAbilityLookupRows, setLookupAbilityName } from '~/utils/sheetAbilityLookup'
import { formatLookupValue, makeMoveLookupRows, setLookupMoveName, type MoveLookupRow } from '~/utils/sheetMoveLookup'
import { makeAutomaticStruggleMoves } from '~/utils/struggleMoves'
import {
  EVASION_BONUS_MAX,
  EVASION_BONUS_MIN,
  coerceEvasionBonus,
  computeEvasionTotal,
  computeStatEvasion,
  formatSignedModifier,
} from '~/utils/evasion'
import { useEditableSheet, type SaveStatus } from '~/composables/useEditableSheet'
import type {
  CharacterSheet,
  CharacterSheetMove,
  CharacterSheetAbility,
  CharacterSheetEdge,
  CharacterSheetEvasion,
  StatKey,
} from '~/types/characterSheet'

type SheetMoveLookupRow = MoveLookupRow<CharacterSheetMove> & {
  automatic: boolean
  sheetIndex: number | null
}

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
const canAccessBaseSheet = computed(() => Boolean(baseSheet && (!isPlayer.value || baseSheet.player === true)))

const initialClone: CharacterSheet | null = canAccessBaseSheet.value && baseSheet
  ? normalizeCharacterSheet(JSON.parse(JSON.stringify(baseSheet)) as CharacterSheet)
  : null

if (initialClone) syncNatureModForSheet(initialClone)

const editor = initialClone ? useEditableSheet(initialClone, 'pokemon') : null
const sheet = computed<CharacterSheet | null>(() => editor?.sheet.value ?? null)
const saveStatus = computed<SaveStatus>(() => editor?.saveStatus.value ?? 'idle')
const saveError = computed<string | null>(() => editor?.saveError.value ?? null)

useHead(() => ({
  title: sheet.value
    ? `${sheet.value.nickname} (${sheet.value.species}) · Sheets`
    : 'Sheet not found · Rotom Table',
}))

// ---------------------------------------------------------------------------
// Derived data — every read goes through the reactive sheet so edits redraw
// the table totals, max-HP, skills grid, etc., automatically.
// ---------------------------------------------------------------------------

const species = computed(() => (sheet.value ? getPokedexEntry(sheet.value.species) : null))
const spriteUrl = computed(() => (sheet.value ? getSpriteUrl(sheet.value.species) : null))

const stats = computed(() => (sheet.value ? resolveStats(sheet.value) : []))
const skills = computed(() => (sheet.value ? resolveSkills(sheet.value) : []))
const capabilities = computed(() =>
  sheet.value ? resolveCapabilities(sheet.value) : { rows: [], naturewalk: undefined, other: [] },
)

const sheetTypes = computed(() => sheet.value?.types ?? species.value?.types ?? [])
const eggGroups = computed(() => sheet.value?.eggGroups ?? species.value?.egg_groups ?? [])

const hpTotal = computed(() => stats.value.find((row) => row.key === 'hp')?.total ?? 0)
const maxHp = computed(() => (sheet.value ? computeMaxHp(sheet.value, hpTotal.value) : 0))
const currentHp = computed(() => sheet.value?.combat?.currentHp ?? maxHp.value)

const hpThresholds = computed(() => ({
  half:    Math.floor(maxHp.value / 2),
  third:   Math.floor(maxHp.value / 3),
  quarter: Math.floor(maxHp.value / 4),
}))

const totalForStat = (key: StatKey): number =>
  stats.value.find((row) => row.key === key)?.total ?? 0

const pokemonEvasion = computed(() => {
  const evasion = sheet.value?.combat?.evasion
  const vsAtkBase = computeStatEvasion(totalForStat('def'))
  const vsSatkBase = computeStatEvasion(totalForStat('sdef'))
  const vsAnyBase = computeStatEvasion(totalForStat('spd'))
  const vsAtkBonus = evasion?.vsAtkBonus ?? 0
  const vsSatkBonus = evasion?.vsSatkBonus ?? 0
  const vsAnyBonus = evasion?.vsAnyBonus ?? 0

  return {
    vsAtk: {
      total: computeEvasionTotal(vsAtkBase, vsAtkBonus),
      base: vsAtkBase,
      bonus: vsAtkBonus,
    },
    vsSatk: {
      total: computeEvasionTotal(vsSatkBase, vsSatkBonus),
      base: vsSatkBase,
      bonus: vsSatkBonus,
    },
    vsAny: {
      total: computeEvasionTotal(vsAnyBase, vsAnyBonus),
      base: vsAnyBase,
      bonus: vsAnyBonus,
    },
  }
})

const tutorPointsLeft = computed(() => {
  const tp = sheet.value?.tutorPoints
  if (!tp) return null
  return (tp.earned ?? 0) - (tp.spent ?? 0)
})

const attackTotal = computed(() => stats.value.find((row) => row.key === 'atk')?.total ?? 0)
const specialAttackTotal = computed(() => stats.value.find((row) => row.key === 'satk')?.total ?? 0)

const struggleCapabilityNames = computed(() => [
  ...(species.value?.capabilities?.other ?? []),
  ...(sheet.value?.capabilities?.other ?? []),
])

const automaticStruggleMoves = computed(() =>
  makeAutomaticStruggleMoves(struggleCapabilityNames.value, sheet.value?.movelist),
)

const moveRows = computed<SheetMoveLookupRow[]>(() => {
  const options = {
    stabTypes: sheetTypes.value,
    physicalAttack: attackTotal.value,
    specialAttack: specialAttackTotal.value,
  }
  const manualRows = makeMoveLookupRows(sheet.value?.movelist, options)
    .map((row, i) => ({ ...row, automatic: false, sheetIndex: i }))
  const automaticRows = makeMoveLookupRows(automaticStruggleMoves.value, options)
    .map((row) => ({ ...row, automatic: true, sheetIndex: null }))
  return [...manualRows, ...automaticRows]
})

const abilityRows = computed(() => makeAbilityLookupRows(sheet.value?.abilities))

const typeEffectivenessRows = computed(() => {
  const defenders = sheetTypes.value
  if (defenders.length === 0) return []
  return POKEMON_TYPES.map((attacker) => {
    const mult = computeMultiplier(attacker, defenders)
    return {
      type: attacker,
      mult,
      label: formatMultiplier(mult),
      tone:
        mult === 0 ? 'immune'
        : mult > 1 ? 'weak'
        : mult < 1 ? 'resist'
        : 'neutral',
    }
  })
})

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

/** Coerce ``"Electric, Steel"`` into ``["Electric", "Steel"]`` (drops blanks). */
const splitCSV = (raw: string): string[] =>
  raw.split(',').map((s) => s.trim()).filter(Boolean)

const typesAsCsv = computed<string>({
  get: () => sheetTypes.value.join(', '),
  set: (raw) => {
    if (!sheet.value) return
    const next = splitCSV(raw)
    sheet.value.types = next.length ? next : undefined
  },
})

const eggGroupsAsCsv = computed<string>({
  get: () => eggGroups.value.join(', '),
  set: (raw) => {
    if (!sheet.value) return
    const next = splitCSV(raw)
    sheet.value.eggGroups = next.length ? next : undefined
  },
})

const otherCapsCsv = computed<string>({
  get: () => sheet.value?.capabilities?.other?.join(', ') ?? '',
  set: (raw) => {
    if (!sheet.value) return
    sheet.value.capabilities!.other = splitCSV(raw)
  },
})

const extraItemsCsv = computed<string>({
  get: () => sheet.value?.items?.extraItems?.join(', ') ?? '',
  set: (raw) => {
    if (!sheet.value) return
    sheet.value.items!.extraItems = splitCSV(raw)
  },
})

const skillBgRaisedCsv = computed<string>({
  get: () => sheet.value?.skillBackground?.raised?.join(', ') ?? '',
  set: (raw) => {
    if (!sheet.value) return
    const next = splitCSV(raw)
    sheet.value.skillBackground!.raised = next.length ? next : undefined
  },
})

const skillBgLoweredCsv = computed<string>({
  get: () => sheet.value?.skillBackground?.lowered?.join(', ') ?? '',
  set: (raw) => {
    if (!sheet.value) return
    const next = splitCSV(raw)
    sheet.value.skillBackground!.lowered = next.length ? next : undefined
  },
})

const addMove = () => {
  sheet.value?.movelist?.push({ name: '' } as CharacterSheetMove)
}
const removeMove = (i: number | null) => {
  if (i == null) return
  sheet.value?.movelist?.splice(i, 1)
}

const addAbility = () => {
  sheet.value?.abilities?.push({ name: '' } as CharacterSheetAbility)
}
const removeAbility = (i: number) => {
  sheet.value?.abilities?.splice(i, 1)
}

const addEdge = () => {
  sheet.value?.edges?.push({ name: 'New Edge' } as CharacterSheetEdge)
}
const removeEdge = (i: number) => {
  sheet.value?.edges?.splice(i, 1)
}

const setStat = (key: StatKey, field: 'added' | 'stage', value: number | undefined) => {
  if (!sheet.value?.stats) return
  const row = sheet.value.stats[key] ?? {}
  row[field] = typeof value === 'number' ? value : 0
  sheet.value.stats[key] = row
}

type PokemonEvasionBonusKey = Extract<keyof CharacterSheetEvasion, 'vsAtkBonus' | 'vsSatkBonus' | 'vsAnyBonus'>

const setEvasionBonus = (key: PokemonEvasionBonusKey, value: number | undefined) => {
  const evasion = sheet.value?.combat?.evasion
  if (!evasion) return
  evasion[key] = coerceEvasionBonus(value)
}

const setInheritedMove = (level: string, value: string | undefined) => {
  if (!sheet.value) return
  const inherited = sheet.value.inheritedMoves ?? {}
  if (value && value.trim()) inherited[level] = value
  else delete inherited[level]
  sheet.value.inheritedMoves = inherited
}
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
      <section class="panel-card identity">
        <div class="identity__sprite">
          <img v-if="spriteUrl" :src="spriteUrl" :alt="sheet.species" />
          <span v-else class="sprite-missing">?</span>
        </div>

        <div class="identity__copy">
          <div class="identity__heading">
            <div>
              <h1>
                <EditableCell v-model="sheet.nickname" placeholder="Nickname" />
              </h1>
              <p class="identity__species">
                <EditableCell v-model="sheet.species" placeholder="Species" />
                <span> · </span>
                <EditableCell
                  v-model="typesAsCsv"
                  :placeholder="`Types (e.g. ${species?.types?.join(', ') ?? 'Electric, Steel'})`"
                />
              </p>
              <div v-if="sheetTypes.length" class="identity__type-badges">
                <TypeBadge
                  v-for="type in sheetTypes"
                  :key="type"
                  :type="type"
                  size="sm"
                />
              </div>
            </div>
            <div class="identity__badges">
              <span class="badge">
                Lv <EditableCell v-model="sheet.level" type="number" :min="1" />
              </span>
              <label v-if="isGm" class="badge player-toggle" :class="{ player: sheet.player }" title="Player">
                <input v-model="sheet.player" type="checkbox" /> Player
              </label>
              <span v-else-if="sheet.player" class="badge player-toggle player">Player</span>
              <label class="badge shiny-toggle" :class="{ shiny: sheet.shiny }" title="Shiny">
                <input v-model="sheet.shiny" type="checkbox" /> ★ Shiny
              </label>
            </div>
          </div>

          <dl class="identity__stats">
            <div>
              <dt>Total EXP</dt>
              <dd><EditableCell v-model="sheet.totalExp" type="number" /></dd>
            </div>
            <div>
              <dt>To Next Lvl</dt>
              <dd><EditableCell v-model="sheet.toNextLevel" type="number" /></dd>
            </div>
            <div>
              <dt>Gender</dt>
              <dd>
                <EditableCell
                  v-model="sheet.gender"
                  type="select"
                  :options="GENDER_OPTIONS"
                  placeholder="—"
                />
              </dd>
            </div>
            <div>
              <dt>Nature</dt>
              <dd>
                <EditableCell
                  v-model="sheet.nature"
                  type="select"
                  :options="NATURE_OPTIONS"
                  placeholder="Hardy / Modest / …"
                />
              </dd>
            </div>
            <div>
              <dt>Nat +</dt>
              <dd>
                <EditableCell
                  :model-value="naturePlusDisplay"
                  readonly
                  placeholder="—"
                />
              </dd>
            </div>
            <div>
              <dt>Nat −</dt>
              <dd>
                <EditableCell
                  :model-value="natureMinusDisplay"
                  readonly
                  placeholder="—"
                />
              </dd>
            </div>
            <div>
              <dt>Egg Group</dt>
              <dd>
                <EditableCell v-model="eggGroupsAsCsv" placeholder="Field, Fairy" />
              </dd>
            </div>
            <div>
              <dt>Scene Xp</dt>
              <dd><EditableCell v-model="sheet.scene!.sceneXp" type="number" /></dd>
            </div>
            <div>
              <dt># Pkmn</dt>
              <dd><EditableCell v-model="sheet.scene!.pkmnCount" type="number" /></dd>
            </div>
            <div>
              <dt>Modifiers</dt>
              <dd><EditableCell v-model="sheet.scene!.modifiers" type="number" /></dd>
            </div>
            <div>
              <dt>New Total</dt>
              <dd><EditableCell v-model="sheet.scene!.newTotal" type="number" /></dd>
            </div>
          </dl>
        </div>
      </section>

      <!-- ============ Stats + Combat strip ============ -->
      <div class="row two-col">
        <section class="panel-card">
          <h2 class="panel-title">Stats</h2>
          <div class="stats-table-wrap">
            <table class="stats-table">
              <thead>
                <tr>
                  <th>Stat</th>
                  <th>Species</th>
                  <th>Mod</th>
                  <th>Base</th>
                  <th>Added</th>
                  <th>Total</th>
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in stats" :key="row.key">
                  <th>{{ row.label }}</th>
                  <td>{{ row.species || '—' }}</td>
                  <td :class="['mod', { plus: row.mod > 0, minus: row.mod < 0 }]">
                    {{ row.mod > 0 ? `+${row.mod}` : row.mod }}
                  </td>
                  <td class="base">{{ row.base || '—' }}</td>
                  <td>
                    <EditableCell
                      :model-value="row.added"
                      type="number"
                      :min="0"
                      @update:model-value="(v) => setStat(row.key, 'added', v as number)"
                    />
                  </td>
                  <td class="total">{{ row.total }}</td>
                  <td>
                    <EditableCell
                      :model-value="row.stage"
                      type="number"
                      :min="-6"
                      :max="6"
                      @update:model-value="(v) => setStat(row.key, 'stage', v as number)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel-card">
          <h2 class="panel-title">Combat</h2>
          <div class="combat-grid">
            <div class="combat-cell hp-cell">
              <span class="cell-label">HP</span>
              <span class="cell-value cell-value--big">
                <EditableCell v-model="sheet.combat!.currentHp" type="number" :min="0" />
                <span class="cell-sub"> / {{ maxHp }}</span>
              </span>
            </div>
            <div class="combat-cell">
              <span class="cell-label">Injuries</span>
              <span class="cell-value">
                <EditableCell v-model="sheet.combat!.injuries" type="number" :min="0" :max="10" />
              </span>
            </div>
            <div class="combat-cell">
              <span class="cell-label">Tick</span>
              <span class="cell-value">
                <EditableCell v-model="sheet.combat!.tick" type="number" :min="0" />
              </span>
            </div>
            <div class="combat-cell">
              <span class="cell-label">DR</span>
              <span class="cell-value">
                <EditableCell v-model="sheet.combat!.dr" type="number" :min="0" />
              </span>
            </div>
            <div class="combat-cell">
              <span class="cell-label">½ HP</span>
              <span class="cell-value">{{ hpThresholds.half }}</span>
            </div>
            <div class="combat-cell">
              <span class="cell-label">⅓ HP</span>
              <span class="cell-value">{{ hpThresholds.third }}</span>
            </div>
            <div class="combat-cell">
              <span class="cell-label">¼ HP</span>
              <span class="cell-value">{{ hpThresholds.quarter }}</span>
            </div>
            <div class="combat-cell">
              <span class="cell-label">Training Exp</span>
              <span class="cell-value">
                <EditableCell v-model="sheet.combat!.trainingExp" type="number" :min="0" />
              </span>
            </div>
          </div>

          <div class="evasion-row">
            <span class="cell-label">Evasion</span>
            <ul>
              <li title="Stat evasion = floor(Defense Total / 5), capped at +6 from stats.">
                <span class="evasion-label">vs ATK</span>
                <strong>{{ pokemonEvasion.vsAtk.total }}</strong>
                <small>stat {{ pokemonEvasion.vsAtk.base }}</small>
                <span class="evasion-bonus">
                  bonus
                  <EditableCell
                    :model-value="pokemonEvasion.vsAtk.bonus"
                    type="number"
                    :min="EVASION_BONUS_MIN"
                    :max="EVASION_BONUS_MAX"
                    :format="formatSignedModifier"
                    @update:model-value="(v) => setEvasionBonus('vsAtkBonus', v as number | undefined)"
                  />
                </span>
              </li>
              <li title="Stat evasion = floor(Special Defense Total / 5), capped at +6 from stats.">
                <span class="evasion-label">vs SATK</span>
                <strong>{{ pokemonEvasion.vsSatk.total }}</strong>
                <small>stat {{ pokemonEvasion.vsSatk.base }}</small>
                <span class="evasion-bonus">
                  bonus
                  <EditableCell
                    :model-value="pokemonEvasion.vsSatk.bonus"
                    type="number"
                    :min="EVASION_BONUS_MIN"
                    :max="EVASION_BONUS_MAX"
                    :format="formatSignedModifier"
                    @update:model-value="(v) => setEvasionBonus('vsSatkBonus', v as number | undefined)"
                  />
                </span>
              </li>
              <li title="Stat evasion = floor(Speed Total / 5), capped at +6 from stats.">
                <span class="evasion-label">vs Any</span>
                <strong>{{ pokemonEvasion.vsAny.total }}</strong>
                <small>stat {{ pokemonEvasion.vsAny.base }}</small>
                <span class="evasion-bonus">
                  bonus
                  <EditableCell
                    :model-value="pokemonEvasion.vsAny.bonus"
                    type="number"
                    :min="EVASION_BONUS_MIN"
                    :max="EVASION_BONUS_MAX"
                    :format="formatSignedModifier"
                    @update:model-value="(v) => setEvasionBonus('vsAnyBonus', v as number | undefined)"
                  />
                </span>
              </li>
            </ul>
          </div>

          <div class="combat-line condition-block">
            <strong>Conditions:</strong>
            <ConditionPicker v-model="sheet.combat!.conditions" />
          </div>
          <p class="combat-line">
            <strong>Status notes:</strong>
            <EditableCell v-model="sheet.combat!.statusAfflictions" placeholder="Optional notes" />
          </p>
          <p class="combat-line">
            <strong>Vitamins:</strong>
            <EditableCell v-model="sheet.combat!.vitamins" placeholder="—" />
          </p>
          <p class="combat-line notes">
            <EditableCell v-model="sheet.combat!.notes" type="textarea" placeholder="Combat notes…" multiline />
          </p>
        </section>
      </div>

      <!-- ============ Items / Weapon ============ -->
      <div class="row two-col">
        <section class="panel-card">
          <h2 class="panel-title">Held Item & Inventory</h2>
          <dl class="kv-list">
            <div>
              <dt>Held Item</dt>
              <dd><EditableCell v-model="sheet.items!.held" placeholder="None" /></dd>
            </div>
            <div>
              <dt>Description</dt>
              <dd>
                <EditableCell
                  v-model="sheet.items!.itemDescription"
                  type="textarea"
                  placeholder="Item description"
                  multiline
                />
              </dd>
            </div>
            <div>
              <dt>Digestion / Food</dt>
              <dd>
                <EditableCell
                  v-model="sheet.items!.digestionFood"
                  type="textarea"
                  placeholder="—"
                  multiline
                />
              </dd>
            </div>
            <div>
              <dt>Pts Left</dt>
              <dd><EditableCell v-model="sheet.items!.pointsLeft" type="number" /></dd>
            </div>
            <div>
              <dt>Extra Items</dt>
              <dd>
                <EditableCell v-model="extraItemsCsv" placeholder="Cell Battery, Magnet" />
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
              <tr><th>Name</th><th>Frequency</th><th>Effect</th><th aria-label="Row actions"></th></tr>
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
                <td colspan="4" class="empty-cell">No abilities yet.</td>
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

/* ---- Identity strip ---- */

.identity {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  align-items: center;
}

.identity__sprite {
  width: 110px;
  height: 110px;
  display: grid;
  place-items: center;
  padding: 0.4rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
}

.identity__sprite img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.sprite-missing {
  color: var(--ink-faint);
  font-size: 1.5rem;
  font-weight: 700;
}

.identity__copy { min-width: 0; }

.identity__heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.6rem;
}

.identity__heading h1 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.identity__species {
  margin: 0.15rem 0 0;
  color: var(--ink-soft);
  font-size: 0.95rem;
  font-style: italic;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.identity__type-badges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.28rem;
  margin-top: 0.45rem;
}

.identity__badges {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.badge.player-toggle,
.badge.shiny-toggle {
  background: rgba(221, 210, 176, 0.16);
  color: var(--ink-bright);
  cursor: pointer;
  user-select: none;
}

.badge.player-toggle.player,
.badge.shiny-toggle.shiny {
  background: rgba(221, 210, 176, 0.28);
}

.badge.player-toggle input,
.badge.shiny-toggle input {
  width: 0.85em;
  height: 0.85em;
  margin: 0;
}

.identity__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
}

.identity__stats > div {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  padding: 0.45rem 0.65rem;
  background: var(--paper-inset);
  min-width: 0;
}

.identity__stats dt {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.identity__stats dd {
  margin: 0.18rem 0 0;
  font-weight: 700;
  color: var(--ink-bright);
}

/* ---- Stats table ---- */

.stats-table-wrap { overflow: auto; }

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.stats-table th,
.stats-table td {
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--rule);
  text-align: right;
}

.stats-table thead th {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
  font-weight: 600;
  text-align: right;
}

.stats-table tbody th {
  text-align: left;
  color: var(--ink-bright);
  font-weight: 700;
  letter-spacing: 0.02em;
}

.stats-table .total {
  font-weight: 700;
  color: var(--ink-bright);
}

.stats-table .mod.plus  { color: var(--good); }
.stats-table .mod.minus { color: var(--bad); }

/* ---- Combat ---- */

.combat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
}

@media (max-width: 760px) {
  .combat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.combat-cell {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  padding: 0.45rem 0.6rem;
  background: var(--paper-inset);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.combat-cell.hp-cell {
  grid-column: span 2;
  background: var(--accent-soft);
  border-color: var(--accent);
}

.cell-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.cell-value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ink-bright);
}

.cell-value--big { font-size: 1.5rem; font-family: var(--font-book); }
.cell-sub { font-weight: 400; color: var(--ink-muted); font-size: 0.95rem; }

.evasion-row {
  margin-top: 0.6rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
}

.evasion-row .cell-label { display: block; margin-bottom: 0.3rem; }

.evasion-row ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 0.85rem;
  flex-wrap: wrap;
}

.evasion-row li {
  display: inline-grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  column-gap: 0.35rem;
  row-gap: 0.15rem;
  font-size: 0.85rem;
  color: var(--ink);
}

.evasion-row li strong {
  color: var(--ink-bright);
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}

.evasion-label { font-weight: 700; }

.evasion-row small {
  color: var(--ink-muted);
  font-size: 0.72rem;
}

.evasion-bonus {
  grid-column: 1 / -1;
  color: var(--ink-muted);
  font-size: 0.76rem;
}

.combat-line {
  margin: 0.55rem 0 0;
  font-size: 0.9rem;
  color: var(--ink);
}

.condition-block {
  display: grid;
  gap: 0.45rem;
}

.condition-block > strong {
  color: var(--ink-bright);
}

.combat-line.notes {
  color: var(--ink-soft);
  font-style: italic;
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
