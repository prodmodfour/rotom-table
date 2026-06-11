<script setup lang="ts">
import { ref } from 'vue'
import { POKEMON_EXPERIENCE_CHART } from '~/utils/sheets/pokemonExperience'
import { PTU_NATURES } from '~/utils/ptuNatures'
import type { StatKey } from '~/types/characterSheet'
import {
  USEFUL_CHART_DAMAGE_ROWS,
  USEFUL_CHART_POWER_ROWS,
  USEFUL_CHART_TYPE_ORDER,
  USEFUL_CHART_TYPE_QUIRKS,
  USEFUL_CHART_TYPE_ROWS,
  USEFUL_CHART_WEIGHT_CLASS_ROWS,
  type UsefulChartDamageEntry,
  type UsefulChartDamageMultiplier,
  type UsefulChartTypeCell,
  type UsefulChartTypeRelation,
} from '~/utils/usefulCharts'

useHead({ title: 'Useful Charts' })

const CHART_TABS = [
  { id: 'experience', label: 'Experience', panelId: 'pokemon-experience-chart' },
  { id: 'damage', label: 'Damage', panelId: 'damage-charts' },
  { id: 'type-effectiveness', label: 'Type Effectiveness', panelId: 'type-effectiveness-chart' },
  { id: 'natures', label: 'Natures', panelId: 'pokemon-nature-chart' },
  { id: 'power-weight', label: 'Power & Weight', panelId: 'power-weight-charts' },
] as const

type ChartTabId = (typeof CHART_TABS)[number]['id']

const activeChartTab = ref<ChartTabId>('experience')
const selectChartTab = (tabId: ChartTabId) => {
  activeChartTab.value = tabId
}

const chunkRows = <T,>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const integerFormatter = new Intl.NumberFormat('en-US')
const formatInteger = (value: number): string => integerFormatter.format(value)

const experienceRowsPerColumn = 20
const damageRowsPerColumn = 14
const natureRowsPerColumn = 18

const experienceColumns = chunkRows(POKEMON_EXPERIENCE_CHART, experienceRowsPerColumn)
const damageColumns = chunkRows(USEFUL_CHART_DAMAGE_ROWS, damageRowsPerColumn)
const natureColumns = chunkRows(PTU_NATURES, natureRowsPerColumn)

const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP',
  atk: 'Attack',
  def: 'Defense',
  satk: 'Special Atk.',
  sdef: 'Special Def.',
  spd: 'Speed',
}

const TYPE_RELATION_LABELS: Record<UsefulChartTypeRelation, string> = {
  immune: 'Immune',
  resisted: 'Resisted',
  neutral: 'Neutral',
  'super-effective': 'Super-effective',
}

const statLabel = (stat: StatKey): string => STAT_LABELS[stat]
const natureName = (nature: (typeof PTU_NATURES)[number]): string => (
  nature.plus === nature.minus ? `${nature.name}*` : nature.name
)
const formatTypeDamageMultiplier = (multiplier: UsefulChartDamageMultiplier): string => {
  if (multiplier === 0.5) return '×½'
  return `×${multiplier}`
}

const typeCellDisplay = (cell: UsefulChartTypeCell): string => (
  cell.relation === 'neutral' ? '' : formatTypeDamageMultiplier(cell.damageMultiplier)
)
const typeCellTitle = (cell: UsefulChartTypeCell): string => (
  `${cell.attacker} attacking ${cell.defender}: ${TYPE_RELATION_LABELS[cell.relation]} (${formatTypeDamageMultiplier(cell.damageMultiplier)})`
)
const typeCellClass = (cell: UsefulChartTypeCell): string => `type-chart-cell--${cell.relation}`
const damageKey = (entry: UsefulChartDamageEntry, prefix: string): string => `${prefix}-${entry.db}`
</script>

<template>
  <main class="useful-charts-page">
    <AppNavigation />

    <header class="panel-card useful-charts-hero">
      <div class="chart-tab-list" role="tablist" aria-label="Useful chart sections">
        <button
          v-for="tab in CHART_TABS"
          :id="`chart-tab-${tab.id}`"
          :key="tab.id"
          type="button"
          :class="['chart-tab', { 'chart-tab--active': activeChartTab === tab.id }]"
          role="tab"
          :aria-selected="activeChartTab === tab.id"
          :aria-controls="tab.panelId"
          @click="selectChartTab(tab.id)"
        >
          {{ tab.label }}
        </button>
      </div>
    </header>

    <section
      v-if="activeChartTab === 'experience'"
      id="pokemon-experience-chart"
      class="panel-card chart-card"
      role="tabpanel"
      aria-labelledby="chart-tab-experience"
    >
      <div class="table-scroll">
        <table class="chart-table chart-table--experience">
          <caption>Experience needed for Pokémon levels 1 through 100.</caption>
          <thead>
            <tr>
              <template v-for="columnIndex in experienceColumns.length" :key="`exp-head-${columnIndex}`">
                <th scope="col">Level</th>
                <th scope="col">Exp Needed</th>
              </template>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rowIndex in experienceRowsPerColumn" :key="`exp-row-${rowIndex}`">
              <template v-for="(column, columnIndex) in experienceColumns" :key="`exp-col-${columnIndex}-${rowIndex}`">
                <th scope="row" class="numeric level-cell">{{ column[rowIndex - 1].level }}</th>
                <td class="numeric">{{ formatInteger(column[rowIndex - 1].expNeeded) }}</td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section
      v-if="activeChartTab === 'damage'"
      id="damage-charts"
      class="panel-card chart-card"
      role="tabpanel"
      aria-labelledby="chart-tab-damage"
    >
      <div class="chart-card__header">
        <p class="chart-card__note">Set damage is shown as minimum / average / maximum.</p>
      </div>

      <div class="damage-chart-grid">
        <article class="subchart-card">
          <h3>Rolled Damage</h3>
          <div class="table-scroll">
            <table class="chart-table chart-table--compact">
              <caption>Rolled damage by Damage Base.</caption>
              <thead>
                <tr>
                  <template v-for="columnIndex in damageColumns.length" :key="`rolled-head-${columnIndex}`">
                    <th scope="col">Damage Base</th>
                    <th scope="col">Actual Damage</th>
                  </template>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rowIndex in damageRowsPerColumn" :key="`rolled-row-${rowIndex}`">
                  <template v-for="(column, columnIndex) in damageColumns" :key="`rolled-col-${columnIndex}-${rowIndex}`">
                    <th scope="row" class="numeric db-cell">{{ column[rowIndex - 1].db }}</th>
                    <td class="formula-cell">{{ column[rowIndex - 1].rolledDamage }}</td>
                  </template>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="subchart-card">
          <h3>Set Damage</h3>
          <div class="table-scroll">
            <table class="chart-table chart-table--compact">
              <caption>Set damage by Damage Base.</caption>
              <thead>
                <tr>
                  <template v-for="columnIndex in damageColumns.length" :key="`set-head-${columnIndex}`">
                    <th scope="col">Damage Base</th>
                    <th scope="col">Actual Damage</th>
                  </template>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rowIndex in damageRowsPerColumn" :key="`set-row-${rowIndex}`">
                  <template v-for="(column, columnIndex) in damageColumns" :key="damageKey(column[rowIndex - 1], `set-${columnIndex}-${rowIndex}`)">
                    <th scope="row" class="numeric db-cell">{{ column[rowIndex - 1].db }}</th>
                    <td class="set-damage-cell">
                      <span>{{ column[rowIndex - 1].setDamage.minimum }}</span>
                      <span aria-hidden="true"> / </span>
                      <strong>{{ column[rowIndex - 1].setDamage.average }}</strong>
                      <span aria-hidden="true"> / </span>
                      <span>{{ column[rowIndex - 1].setDamage.maximum }}</span>
                    </td>
                  </template>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </section>

    <section
      v-if="activeChartTab === 'type-effectiveness'"
      id="type-effectiveness-chart"
      class="panel-card chart-card"
      role="tabpanel"
      aria-labelledby="chart-tab-type-effectiveness"
    >
      <div class="table-scroll type-table-scroll">
        <table class="chart-table type-chart-table">
          <caption>Single-type attack effectiveness against single defending types.</caption>
          <thead>
            <tr>
              <th scope="col" class="type-corner sticky-col">
                <span>Attack ↓</span>
                <span>Defense →</span>
              </th>
              <th
                v-for="type in USEFUL_CHART_TYPE_ORDER"
                :key="`def-${type}`"
                scope="col"
                class="type-heading type-heading--column"
              >
                <TypeBadge :type="type" size="xs" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in USEFUL_CHART_TYPE_ROWS" :key="`attacker-${row.attacker}`">
              <th scope="row" class="type-heading type-heading--row sticky-col">
                <TypeBadge :type="row.attacker" size="xs" />
              </th>
              <td
                v-for="cell in row.cells"
                :key="`${cell.attacker}-${cell.defender}`"
                class="type-chart-cell"
                :class="typeCellClass(cell)"
                :title="typeCellTitle(cell)"
                :aria-label="typeCellTitle(cell)"
              >
                {{ typeCellDisplay(cell) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="type-reference-grid">
        <article class="reference-note-card">
          <h3>Type Quirks</h3>
          <ul>
            <li v-for="quirk in USEFUL_CHART_TYPE_QUIRKS" :key="quirk">{{ quirk }}</li>
          </ul>
        </article>
      </div>
    </section>

    <section
      v-if="activeChartTab === 'natures'"
      id="pokemon-nature-chart"
      class="panel-card chart-card"
      role="tabpanel"
      aria-labelledby="chart-tab-natures"
    >
      <div class="table-scroll">
        <table class="chart-table chart-table--nature">
          <caption>Natures and the base stats they raise and lower.</caption>
          <thead>
            <tr>
              <template v-for="columnIndex in natureColumns.length" :key="`nature-head-${columnIndex}`">
                <th scope="col">Value</th>
                <th scope="col">Nature</th>
                <th scope="col">Raise</th>
                <th scope="col">Lower</th>
              </template>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rowIndex in natureRowsPerColumn" :key="`nature-row-${rowIndex}`">
              <template v-for="(column, columnIndex) in natureColumns" :key="`nature-col-${columnIndex}-${rowIndex}`">
                <th scope="row" class="numeric value-cell">{{ column[rowIndex - 1].value }}</th>
                <td>{{ natureName(column[rowIndex - 1]) }}</td>
                <td class="stat-raise">{{ statLabel(column[rowIndex - 1].plus) }}</td>
                <td class="stat-lower">{{ statLabel(column[rowIndex - 1].minus) }}</td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="chart-footnote">* These Natures are neutral; they do not affect Base Stats because they cancel themselves out.</p>
    </section>

    <section
      v-if="activeChartTab === 'power-weight'"
      id="power-weight-charts"
      class="panel-card chart-card"
      role="tabpanel"
      aria-labelledby="chart-tab-power-weight"
    >
      <div class="power-weight-grid">
        <article class="subchart-card">
          <h3>Power Chart</h3>
          <div class="table-scroll">
            <table class="chart-table">
              <caption>Power values and lifting limits.</caption>
              <thead>
                <tr>
                  <th scope="col">Power Value</th>
                  <th scope="col">Heavy Lifting</th>
                  <th scope="col">Staggering Weight Limit</th>
                  <th scope="col">Drag Weight Limit</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in USEFUL_CHART_POWER_ROWS" :key="entry.powerValue">
                  <th scope="row" class="numeric value-cell">{{ entry.powerValue }}</th>
                  <td>{{ entry.heavyLifting }}</td>
                  <td>{{ entry.staggeringWeightLimit }}</td>
                  <td>{{ entry.dragWeightLimit }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="subchart-card">
          <h3>Weight Class Chart</h3>
          <div class="table-scroll">
            <table class="chart-table">
              <caption>Pokémon weight class ranges.</caption>
              <thead>
                <tr>
                  <th scope="col">Weight Class</th>
                  <th scope="col">Range</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in USEFUL_CHART_WEIGHT_CLASS_ROWS" :key="entry.weightClass">
                  <th scope="row">Weight Class {{ entry.weightClass }}</th>
                  <td>{{ entry.range }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.useful-charts-page {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  background: var(--paper);
  color: var(--ink);
}

.useful-charts-hero {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.subchart-card h3,
.reference-note-card h3 {
  margin: 0;
  font-family: var(--font-book);
  color: var(--ink-bright);
  line-height: 1.1;
}

.chart-card__note,
.chart-footnote {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.chart-tab-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.2rem;
}

.chart-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  color: var(--ink-bright);
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 700;
  text-decoration: none;
}

.chart-tab:hover,
.chart-tab--active {
  border-color: var(--accent);
  color: var(--accent);
}

.chart-tab--active {
  background: var(--accent-soft);
}

.chart-card {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  scroll-margin-top: 1rem;
}

.chart-card__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.8rem;
}

.chart-card__note {
  max-width: 32rem;
  font-size: 0.9rem;
  text-align: right;
}

.table-scroll {
  overflow-x: auto;
  overscroll-behavior-x: contain;
}

.chart-table {
  width: 100%;
  min-width: max-content;
  border-collapse: collapse;
  color: var(--ink);
  font-size: 0.93rem;
}

.chart-table caption {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.chart-table th,
.chart-table td {
  border: 1px solid var(--rule-soft);
  padding: 0.42rem 0.6rem;
  text-align: left;
  vertical-align: middle;
}

.chart-table thead th {
  background: color-mix(in srgb, var(--accent) 18%, var(--paper-soft));
  color: var(--ink-bright);
  font-weight: 800;
}

.chart-table tbody th {
  background: color-mix(in srgb, var(--ink-bright) 8%, var(--paper-soft));
  color: var(--ink-bright);
  font-weight: 800;
}

.chart-table tbody tr:nth-child(even) td,
.chart-table tbody tr:nth-child(even) th {
  background-color: color-mix(in srgb, var(--paper-soft) 78%, var(--paper-inset));
}

.numeric,
.formula-cell,
.set-damage-cell {
  text-align: center;
  white-space: nowrap;
}

.level-cell,
.db-cell,
.value-cell {
  min-width: 3rem;
}

.formula-cell {
  font-family: var(--font-mono);
}

.set-damage-cell strong {
  color: var(--accent);
  font-weight: 800;
}

.damage-chart-grid,
.power-weight-grid,
.type-reference-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 28rem), 1fr));
  gap: 0.8rem;
}

.subchart-card,
.reference-note-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.75rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
}

.subchart-card h3,
.reference-note-card h3 {
  color: var(--accent);
  font-size: 1.2rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.type-table-scroll {
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
}

.type-chart-table {
  font-size: 0.78rem;
}

.type-chart-table th,
.type-chart-table td {
  padding: 0.28rem 0.34rem;
  text-align: center;
}

.type-corner {
  min-width: 6rem;
  line-height: 1.35;
}

.type-corner span {
  display: block;
}

.type-heading {
  min-width: 3.1rem;
  background: var(--paper-soft);
  white-space: nowrap;
}

.type-heading--row {
  min-width: 5.4rem;
  text-align: left;
}

.type-heading--row :deep(.type-badge) {
  vertical-align: text-bottom;
}

.sticky-col {
  position: sticky;
  left: 0;
  z-index: 2;
}

.type-chart-cell {
  min-width: 2.8rem;
  height: 2rem;
  font-weight: 800;
}

.type-chart-table tbody td.type-chart-cell--immune {
  background: color-mix(in srgb, var(--ink-faint) 45%, var(--paper-inset));
  color: var(--ink-bright);
}

.type-chart-table tbody td.type-chart-cell--resisted {
  background: color-mix(in srgb, var(--bad) 34%, var(--paper-soft));
  color: var(--ink-bright);
}

.type-chart-table tbody td.type-chart-cell--super-effective {
  background: color-mix(in srgb, var(--good) 34%, var(--paper-soft));
  color: var(--ink-bright);
}

.type-chart-table tbody td.type-chart-cell--neutral {
  color: var(--ink-faint);
}

.reference-note-card ul {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding-left: 1.15rem;
  color: var(--ink-soft);
  line-height: 1.45;
}

.chart-table--nature tbody td.stat-raise {
  background: color-mix(in srgb, var(--good) 12%, var(--paper-soft));
}

.chart-table--nature tbody td.stat-lower {
  background: color-mix(in srgb, var(--bad) 12%, var(--paper-soft));
}

.chart-footnote {
  font-family: var(--font-book);
  font-size: 1rem;
}

@media (max-width: 760px) {
  .useful-charts-page {
    padding: 0.55rem;
  }

  .chart-card__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .chart-card__note {
    text-align: left;
  }
}
</style>
