<script setup lang="ts">
import { computed } from 'vue'
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

const route = useRoute()

const sheet = computed(() => {
  const slug = String(route.params.slug ?? '')
  return characterSheetsBySlug.get(slug) ?? null
})

useHead(() => ({
  title: sheet.value
    ? `${sheet.value.nickname} (${sheet.value.species}) · Sheets`
    : 'Sheet not found · Rotom Table',
}))

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

const natureSummary = computed(() => {
  const sheetValue = sheet.value
  if (!sheetValue) return ''
  const parts: string[] = []
  if (sheetValue.nature) parts.push(sheetValue.nature)
  const plus = sheetValue.natureMod?.plus
  const minus = sheetValue.natureMod?.minus
  if (plus || minus) {
    const tokens: string[] = []
    if (plus) tokens.push(`+${plus.toUpperCase()}`)
    if (minus) tokens.push(`-${minus.toUpperCase()}`)
    parts.push(tokens.join(' '))
  }
  return parts.join('  ')
})

const inheritedRows = computed(() => {
  const inherited = sheet.value?.inheritedMoves ?? {}
  const levels = ['20', '30', '40', '50', '60', '70', '80', '90']
  return levels.map((level) => ({
    level,
    move: inherited[level] ?? null,
  }))
})

const tutorPointsLeft = computed(() => {
  const tp = sheet.value?.tutorPoints
  if (!tp) return null
  const earned = tp.earned ?? 0
  const spent = tp.spent ?? 0
  return earned - spent
})

const typeEffectivenessRows = computed(() => {
  const defenders = sheetTypes.value
  if (defenders.length === 0) return []
  return POKEMON_TYPES.map((attacker) => {
    const mult = computeMultiplier(attacker, defenders)
    return {
      type: attacker,
      mult,
      label: formatMultiplier(mult),
      // Tag rows so we can colour weakness / resistance.
      tone:
        mult === 0 ? 'immune'
        : mult > 1 ? 'weak'
        : mult < 1 ? 'resist'
        : 'neutral',
    }
  })
})
</script>

<template>
  <div class="sheet-page">
    <header class="sheet-header">
      <AppNavigation />

      <div class="back-row">
        <NuxtLink to="/sheets" class="back-link">← All sheets</NuxtLink>
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
              <h1>{{ sheet.nickname }}</h1>
              <p class="identity__species">
                {{ sheet.species }}
                <span v-if="sheetTypes.length"> · {{ sheetTypes.join(' / ') }}</span>
              </p>
            </div>
            <div class="identity__badges">
              <span class="badge">Lv {{ sheet.level }}</span>
              <span v-if="sheet.shiny" class="badge shiny" title="Shiny">★ Shiny</span>
            </div>
          </div>

          <dl class="identity__stats">
            <div v-if="sheet.totalExp != null"><dt>Total EXP</dt><dd>{{ sheet.totalExp }}</dd></div>
            <div v-if="sheet.toNextLevel != null"><dt>To Next Lvl</dt><dd>{{ sheet.toNextLevel }}</dd></div>
            <div v-if="sheet.gender"><dt>Gender</dt><dd>{{ sheet.gender }}</dd></div>
            <div v-if="natureSummary"><dt>Nature</dt><dd>{{ natureSummary }}</dd></div>
            <div v-if="eggGroups.length"><dt>Egg Group</dt><dd>{{ eggGroups.join(' / ') }}</dd></div>
            <div v-if="sheet.scene?.sceneXp != null"><dt>Scene Xp</dt><dd>{{ sheet.scene.sceneXp }}</dd></div>
            <div v-if="sheet.scene?.pkmnCount != null"><dt># Pkmn</dt><dd>{{ sheet.scene.pkmnCount }}</dd></div>
            <div v-if="sheet.scene?.modifiers != null"><dt>Modifiers</dt><dd>{{ sheet.scene.modifiers }}</dd></div>
            <div v-if="sheet.scene?.newTotal != null"><dt>New Total</dt><dd>{{ sheet.scene.newTotal }}</dd></div>
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
                  <td>{{ row.base }}</td>
                  <td>{{ row.added }}</td>
                  <td class="total">{{ row.total }}</td>
                  <td>{{ row.stage > 0 ? `+${row.stage}` : row.stage }}</td>
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
              <span class="cell-value cell-value--big">{{ currentHp }} <span class="cell-sub">/ {{ maxHp }}</span></span>
            </div>
            <div class="combat-cell">
              <span class="cell-label">Injuries</span>
              <span class="cell-value">{{ sheet.combat?.injuries ?? 0 }}</span>
            </div>
            <div class="combat-cell">
              <span class="cell-label">Tick</span>
              <span class="cell-value">{{ sheet.combat?.tick ?? 1 }}</span>
            </div>
            <div class="combat-cell">
              <span class="cell-label">DR</span>
              <span class="cell-value">{{ sheet.combat?.dr ?? 0 }}</span>
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
              <span class="cell-value">{{ sheet.combat?.trainingExp ?? 0 }}</span>
            </div>
          </div>

          <div class="evasion-row">
            <span class="cell-label">Evasion</span>
            <ul>
              <li>vs ATK <strong>{{ sheet.combat?.evasion?.vsAtk ?? 0 }}</strong></li>
              <li>vs SATK <strong>{{ sheet.combat?.evasion?.vsSatk ?? 0 }}</strong></li>
              <li>vs Any <strong>{{ sheet.combat?.evasion?.vsAny ?? 0 }}</strong></li>
            </ul>
          </div>

          <p v-if="sheet.combat?.statusAfflictions" class="combat-line">
            <strong>Status:</strong> {{ sheet.combat.statusAfflictions }}
          </p>
          <p v-if="sheet.combat?.vitamins" class="combat-line">
            <strong>Vitamins:</strong> {{ sheet.combat.vitamins }}
          </p>
          <p v-if="sheet.combat?.notes" class="combat-line notes">
            {{ sheet.combat.notes }}
          </p>
        </section>
      </div>

      <!-- ============ Items / Weapon ============ -->
      <div class="row two-col">
        <section class="panel-card">
          <h2 class="panel-title">Held Item & Inventory</h2>
          <dl class="kv-list">
            <div><dt>Held Item</dt><dd>{{ sheet.items?.held || '—' }}</dd></div>
            <div v-if="sheet.items?.itemDescription"><dt>Description</dt><dd>{{ sheet.items.itemDescription }}</dd></div>
            <div v-if="sheet.items?.digestionFood"><dt>Digestion / Food</dt><dd>{{ sheet.items.digestionFood }}</dd></div>
            <div v-if="sheet.items?.pointsLeft != null"><dt>Pts Left</dt><dd>{{ sheet.items.pointsLeft }}</dd></div>
            <div v-if="sheet.items?.extraItems?.length">
              <dt>Extra Items</dt>
              <dd>{{ sheet.items.extraItems.join(', ') }}</dd>
            </div>
          </dl>
        </section>

        <section class="panel-card">
          <h2 class="panel-title">Weapon</h2>
          <dl class="kv-list">
            <div><dt>Name</dt><dd>{{ sheet.weapon?.name || '—' }}</dd></div>
            <div><dt>DB Mod</dt><dd>{{ sheet.weapon?.dbMod ?? 0 }}</dd></div>
            <div><dt>AC Mod</dt><dd>{{ sheet.weapon?.acMod ?? 0 }}</dd></div>
            <div v-if="sheet.weapon?.description"><dt>Description</dt><dd>{{ sheet.weapon.description }}</dd></div>
          </dl>
        </section>
      </div>

      <!-- ============ Tutor pts + Skill bg + Inherited ============ -->
      <div class="row three-col">
        <section class="panel-card">
          <h2 class="panel-title">Tutor Points</h2>
          <dl class="kv-list">
            <div><dt>Earned</dt><dd>{{ sheet.tutorPoints?.earned ?? 0 }}</dd></div>
            <div><dt>Spent</dt><dd>{{ sheet.tutorPoints?.spent ?? 0 }}</dd></div>
            <div><dt>Left</dt><dd>{{ tutorPointsLeft ?? 0 }}</dd></div>
          </dl>
        </section>

        <section class="panel-card">
          <h2 class="panel-title">Skill Background</h2>
          <p v-if="sheet.skillBackground?.description" class="bg-desc">
            {{ sheet.skillBackground.description }}
          </p>
          <dl class="kv-list">
            <div v-if="sheet.skillBackground?.raised?.length">
              <dt>Raised</dt><dd>{{ sheet.skillBackground.raised.join(', ') }}</dd>
            </div>
            <div v-if="sheet.skillBackground?.lowered?.length">
              <dt>Lowered</dt><dd>{{ sheet.skillBackground.lowered.join(', ') }}</dd>
            </div>
          </dl>
        </section>

        <section class="panel-card">
          <h2 class="panel-title">Inherited Moves</h2>
          <dl class="inherited-grid">
            <div v-for="row in inheritedRows" :key="row.level">
              <dt>Lvl {{ row.level }}</dt>
              <dd>{{ row.move ?? '—' }}</dd>
            </div>
          </dl>
          <p v-if="sheet.inheritedRemaining != null" class="inherited-foot">
            Remaining: <strong>{{ sheet.inheritedRemaining }}</strong>
          </p>
        </section>
      </div>

      <!-- ============ Movelist ============ -->
      <section class="panel-card">
        <h2 class="panel-title">Movelist</h2>
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
              </tr>
            </thead>
            <tbody>
              <tr v-for="move in sheet.movelist ?? []" :key="move.name">
                <td class="move-name"><RefLink kind="move" :name="move.name" /></td>
                <td>{{ move.type ?? '—' }}</td>
                <td>{{ move.category ?? '—' }}</td>
                <td>{{ move.db ?? '—' }}</td>
                <td>{{ move.damageRoll ?? '—' }}</td>
                <td>{{ move.frequency ?? '—' }}</td>
                <td>{{ move.ac ?? '—' }}</td>
                <td>{{ move.range ?? '—' }}</td>
                <td class="move-effect">{{ move.effect ?? '' }}</td>
              </tr>
              <tr v-if="!sheet.movelist?.length">
                <td colspan="9" class="empty-cell">No moves recorded.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ============ Type Effectiveness ============ -->
      <section v-if="typeEffectivenessRows.length" class="panel-card">
        <h2 class="panel-title">
          Type Effectiveness
          <span class="panel-subtle">vs {{ sheetTypes.join(' / ') }}</span>
        </h2>
        <div class="type-grid">
          <div
            v-for="row in typeEffectivenessRows"
            :key="row.type"
            :class="['type-cell', `type-cell--${row.tone}`]"
          >
            <span class="type-name">{{ row.type }}</span>
            <span class="type-mult">×{{ row.label }}</span>
          </div>
        </div>
      </section>

      <!-- ============ Capabilities ============ -->
      <section class="panel-card">
        <h2 class="panel-title">Capabilities</h2>
        <dl v-if="capabilities.rows.length" class="caps-grid">
          <div v-for="row in capabilities.rows" :key="row.label">
            <dt><RefLink kind="capability" :name="row.label" /></dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
        <p v-if="capabilities.naturewalk" class="caps-line">
          <strong><RefLink kind="capability" name="Naturewalk" />:</strong>
          {{ capabilities.naturewalk }}
        </p>
        <p v-if="capabilities.other.length" class="caps-line">
          <strong>Other:</strong>
          <template v-for="(name, i) in capabilities.other" :key="`other-${i}`"
            ><span v-if="i > 0">, </span
            ><RefLink kind="capability" :name="name"
          /></template>
        </p>
      </section>

      <!-- ============ Abilities + Edges ============ -->
      <div class="row two-col">
        <section class="panel-card">
          <h2 class="panel-title">Abilities</h2>
          <table class="kv-table">
            <thead>
              <tr><th>Name</th><th>Frequency</th><th>Effect</th></tr>
            </thead>
            <tbody>
              <tr v-for="ability in sheet.abilities ?? []" :key="ability.name">
                <td class="kv-name"><RefLink kind="ability" :name="ability.name" /></td>
                <td>{{ ability.frequency ?? '—' }}</td>
                <td>{{ ability.effect ?? '' }}</td>
              </tr>
              <tr v-if="!sheet.abilities?.length">
                <td colspan="3" class="empty-cell">No abilities recorded.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="panel-card">
          <h2 class="panel-title">Poké Edges</h2>
          <table class="kv-table">
            <thead>
              <tr><th>Name</th><th>Cost</th><th>Effect</th></tr>
            </thead>
            <tbody>
              <tr v-for="edge in sheet.edges ?? []" :key="edge.name">
                <td class="kv-name">{{ edge.name }}</td>
                <td>{{ edge.cost ?? '—' }}</td>
                <td>{{ edge.effect ?? '' }}</td>
              </tr>
              <tr v-if="!sheet.edges?.length">
                <td colspan="3" class="empty-cell">No edges recorded.</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <!-- ============ Pokémon Skills ============ -->
      <section class="panel-card">
        <h2 class="panel-title">
          Pokémon Skills
          <span class="panel-subtle">bold = species-given</span>
        </h2>
        <dl class="skills-grid">
          <div
            v-for="skill in skills"
            :key="skill.key"
            :class="['skill-cell', { 'skill-cell--given': skill.speciesGiven }]"
          >
            <dt>{{ skill.label }}</dt>
            <dd>{{ skill.value }}</dd>
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
  font-family: var(--serif);
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
  font-family: Inter, sans-serif;
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
  font-family: var(--serif);
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
}

.identity__badges {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.badge.shiny {
  background: rgba(221, 210, 176, 0.16);
  color: var(--ink-bright);
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

.cell-value--big { font-size: 1.5rem; font-family: var(--serif); }
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
  font-size: 0.85rem;
  color: var(--ink);
}

.evasion-row li strong {
  color: var(--ink-bright);
}

.combat-line {
  margin: 0.55rem 0 0;
  font-size: 0.9rem;
  color: var(--ink);
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
  font-family: var(--serif);
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

.empty-cell {
  text-align: center;
  color: var(--ink-muted);
  font-style: italic;
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
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  color: var(--accent);
}
</style>
