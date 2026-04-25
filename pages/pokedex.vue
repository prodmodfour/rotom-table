<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import pokedexData from '~/ptu-data/data/pokedex.json'
import { pokemonCatalogBySpecies } from '~/data/pokemonCatalog'
import type { PokedexCapabilities, PokedexRecord } from '~/types/pokemon'

useHead({
  title: 'Pokédex · Rotom Table',
})

type DisplayPokedexEntry = PokedexRecord & {
  id: string
}

const normalizeText = (value: string) => value.trim().toLowerCase()

const allEntries: DisplayPokedexEntry[] = [...(pokedexData as PokedexRecord[])]
  .filter((entry): entry is PokedexRecord => Boolean(entry?.species))
  .sort((left, right) => left.species.localeCompare(right.species))
  .map((entry, index) => ({
    ...entry,
    id: `${index}-${entry.species.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  }))

const searchTerm = ref('')
const selectedId = ref<string | null>(allEntries[0]?.id ?? null)

const filteredEntries = computed(() => {
  const query = normalizeText(searchTerm.value)

  if (!query) {
    return allEntries
  }

  return allEntries.filter((entry) => {
    const haystacks = [
      entry.species,
      ...(entry.types ?? []),
      entry.source_gen ?? '',
    ]

    return haystacks.some((value) => normalizeText(value).includes(query))
  })
})

watch(
  filteredEntries,
  (entries) => {
    if (entries.length === 0) {
      selectedId.value = null
      return
    }

    if (!selectedId.value || !entries.some((entry) => entry.id === selectedId.value)) {
      selectedId.value = entries[0].id
    }
  },
  { immediate: true },
)

const selectedEntry = computed(
  () => filteredEntries.value.find((entry) => entry.id === selectedId.value)
    ?? allEntries.find((entry) => entry.id === selectedId.value)
    ?? null,
)

const selectedSprite = computed(() => {
  if (!selectedEntry.value) {
    return null
  }

  return pokemonCatalogBySpecies.get(selectedEntry.value.species) ?? null
})

const isPlacementOnly = computed(() => {
  if (!selectedEntry.value) {
    return false
  }

  return !selectedEntry.value.base_stats && !selectedEntry.value.abilities && !selectedEntry.value.level_up_moves
})

const genderSummary = computed(() => {
  const entry = selectedEntry.value

  if (!entry) {
    return null
  }

  if (entry.genderless) {
    return 'Genderless'
  }

  if (entry.male_pct != null || entry.female_pct != null) {
    return `${entry.male_pct ?? 0}% M / ${entry.female_pct ?? 0}% F`
  }

  return null
})

const typeSummary = computed(() => selectedEntry.value?.types?.join(' / ') ?? 'Unknown type')

// One-page index for the bottom-right page number.
const pageNumber = computed(() => {
  const list = filteredEntries.value
  const index = list.findIndex((entry) => entry.id === selectedId.value)
  if (index < 0) return null
  return index + 1
})

// "Capability List" rendered as the inline, comma-separated phrase used in
// the printed book (e.g. "Overland 5, Swim 3, Jump 1/1, Power 2, Naturewalk
// (Grassland, Forest), Underdog").
const capabilityPhrase = computed(() => {
  const capabilities = selectedEntry.value?.capabilities as PokedexCapabilities | undefined
  if (!capabilities) return ''

  const numbered: Array<[string, number | string | undefined]> = [
    ['Overland', capabilities.overland],
    ['Sky', capabilities.sky],
    ['Swim', capabilities.swim],
    ['Levitate', capabilities.levitate],
    ['Burrow', capabilities.burrow],
    ['Jump', capabilities.jump],
    ['Power', capabilities.power],
  ]

  const parts: string[] = []
  for (const [label, value] of numbered) {
    if (value === undefined || value === null || value === 0 || value === '0') continue
    parts.push(`${label} ${value}`)
  }
  for (const extra of capabilities.other ?? []) {
    if (extra) parts.push(extra)
  }
  return parts.join(', ')
})

// Skill abbreviations matching the printed book (Athl, Acro, Percep…).
const SKILL_ABBREVIATIONS: Record<string, string> = {
  Athletics: 'Athl',
  Acrobatics: 'Acro',
  Combat: 'Combat',
  Stealth: 'Stealth',
  Perception: 'Percep',
  Focus: 'Focus',
}

const skillPhrase = computed(() => {
  const skills = selectedEntry.value?.skills
  if (!skills) return ''

  return Object.entries(skills)
    .map(([skill, value]) => `${SKILL_ABBREVIATIONS[skill] ?? skill} ${value}`)
    .join(', ')
})

const heightLabel = computed(() => {
  const entry = selectedEntry.value
  if (!entry || entry.height == null) return null

  const meters = entry.height
  const totalInches = meters / 0.0254
  const feet = Math.floor(totalInches / 12)
  const inches = Math.round(totalInches - feet * 12)
  const sizeSuffix = entry.size ? ` (${entry.size})` : ''
  return `${feet}' ${inches}" / ${meters.toFixed(1)}m${sizeSuffix}`
})

const weightLabel = computed(() => {
  const entry = selectedEntry.value
  if (!entry || entry.weight == null) return null
  // PTU "weight class" is a small integer; we only know the class number.
  return `Weight Class ${entry.weight}`
})

const eggGroupSummary = computed(() => {
  const groups = selectedEntry.value?.egg_groups
  if (!groups || groups.length === 0) return null
  return groups.join(' / ')
})

const dietSummary = computed(() => {
  const diet = selectedEntry.value?.diet
  if (!diet || diet.length === 0) return null
  return diet.join(', ')
})

const habitatSummary = computed(() => {
  const habitat = selectedEntry.value?.habitat
  if (!habitat || habitat.length === 0) return null
  return habitat.join(', ')
})

// TM/HM list rendered as the comma-separated run-on phrase used in the
// printed book (e.g. "H01 Cut, 06 Toxic, 10 Hidden Power, ..."). Plain TMs
// keep just the machine number; HMs are prefixed with ``H`` for clarity.
const tmHmPhrase = computed(() => {
  const moves = selectedEntry.value?.tm_hm_moves
  if (!moves || moves.length === 0) return ''
  return moves
    .map((move) => {
      const prefix = move.kind === 'HM' ? 'H' : ''
      return `${prefix}${move.number} ${move.name}`
    })
    .join(', ')
})

const eggMovePhrase = computed(() => {
  const moves = selectedEntry.value?.egg_moves
  if (!moves || moves.length === 0) return ''
  return moves.join(', ')
})

// Tutor moves preserve the (N) Heart-Scale marker the printed book uses.
const tutorMovePhrase = computed(() => {
  const moves = selectedEntry.value?.tutor_moves
  if (!moves || moves.length === 0) return ''
  return moves
    .map((move) => (move.heart_scale ? `${move.name} (N)` : move.name))
    .join(', ')
})
</script>

<template>
  <div class="pokedex-layout">
    <aside class="pokedex-sidebar">
      <AppNavigation />

      <section class="sidebar-card">
        <div class="sidebar-heading">
          <h1>Pokédex</h1>
          <span class="badge">{{ filteredEntries.length }} shown</span>
        </div>

        <p class="sidebar-copy">
          Browse every Pokémon entry from <code>ptu-data/data/pokedex.json</code>.
        </p>

        <label class="search-field">
          <span class="sr-only">Search the Pokédex</span>
          <input v-model.trim="searchTerm" type="search" placeholder="Search species, type, or gen…" />
        </label>

        <div v-if="filteredEntries.length > 0" class="entry-list">
          <button
            v-for="entry in filteredEntries"
            :key="entry.id"
            :class="['entry-button', { active: entry.id === selectedId }]"
            type="button"
            @click="selectedId = entry.id"
          >
            <span class="entry-name">{{ entry.species }}</span>
            <span class="entry-meta">
              {{ entry.types?.join(' / ') || 'Unknown type' }}
              <template v-if="entry.source_gen"> · {{ entry.source_gen }}</template>
            </span>
          </button>
        </div>

        <p v-else class="empty-state">
          No Pokédex entries match that search.
        </p>
      </section>
    </aside>

    <main class="pokedex-detail">
      <article v-if="selectedEntry" class="book-page">
        <header class="book-page__header">
          <h2 class="species-name">{{ selectedEntry.species.toUpperCase() }}</h2>
          <div class="header-badges">
            <span v-if="selectedEntry.source_gen" class="badge">{{ selectedEntry.source_gen }}</span>
            <span v-if="isPlacementOnly" class="badge warn">Placement only</span>
          </div>
        </header>

        <div class="book-columns">
          <!-- LEFT COLUMN -->
          <section class="book-column book-column--left">
            <div class="sprite-frame">
              <div class="sprite-frame__inner">
                <img
                  v-if="selectedSprite"
                  :src="selectedSprite.spriteUrl"
                  :alt="selectedEntry.species"
                />
                <span v-else class="sprite-missing">no sprite</span>
              </div>
              <span class="bracket bracket--tl" />
              <span class="bracket bracket--tr" />
              <span class="bracket bracket--bl" />
              <span class="bracket bracket--br" />
            </div>

            <section v-if="selectedEntry.base_stats" class="book-section">
              <h3 class="book-section__title">Base Stats:</h3>
              <dl class="stat-list">
                <div><dt>HP:</dt><dd>{{ selectedEntry.base_stats.hp }}</dd></div>
                <div><dt>Attack:</dt><dd>{{ selectedEntry.base_stats.atk }}</dd></div>
                <div><dt>Defense:</dt><dd>{{ selectedEntry.base_stats.def }}</dd></div>
                <div><dt>Special Attack:</dt><dd>{{ selectedEntry.base_stats.spatk }}</dd></div>
                <div><dt>Special Defense:</dt><dd>{{ selectedEntry.base_stats.spdef }}</dd></div>
                <div><dt>Speed:</dt><dd>{{ selectedEntry.base_stats.spd }}</dd></div>
              </dl>
            </section>

            <section class="book-section">
              <h3 class="book-section__title">Basic Information</h3>
              <p class="info-line">Type : {{ typeSummary }}</p>
              <template v-if="selectedEntry.abilities">
                <p
                  v-for="(ability, index) in selectedEntry.abilities.basic ?? []"
                  :key="`basic-${ability}`"
                  class="info-line"
                >
                  Basic Ability {{ index + 1 }}: {{ ability }}
                </p>
                <p
                  v-for="(ability, index) in selectedEntry.abilities.advanced ?? []"
                  :key="`adv-${ability}`"
                  class="info-line"
                >
                  Adv Ability {{ index + 1 }}: {{ ability }}
                </p>
                <p
                  v-for="ability in selectedEntry.abilities.high ?? []"
                  :key="`high-${ability}`"
                  class="info-line"
                >
                  High Ability: {{ ability }}
                </p>
              </template>
            </section>

            <section v-if="selectedEntry.evolutions?.length" class="book-section">
              <h3 class="book-section__title">Evolution:</h3>
              <p
                v-for="evolution in selectedEntry.evolutions"
                :key="`${evolution.stage}-${evolution.species}`"
                class="info-line"
              >
                {{ evolution.stage }} - {{ evolution.species }}<template v-if="evolution.min_level && evolution.min_level > 0"> Minimum {{ evolution.min_level }}</template>
              </p>
            </section>

            <section v-if="heightLabel || weightLabel" class="book-section">
              <h3 class="book-section__title">Size Information</h3>
              <p v-if="heightLabel" class="info-line">Height : {{ heightLabel }}</p>
              <p v-if="weightLabel" class="info-line">Weight : {{ weightLabel }}</p>
            </section>

            <section
              v-if="genderSummary || eggGroupSummary || selectedEntry.hatch_rate"
              class="book-section"
            >
              <h3 class="book-section__title">Breeding Information</h3>
              <p v-if="genderSummary" class="info-line">Gender Ratio : {{ genderSummary }}</p>
              <p v-if="eggGroupSummary" class="info-line">Egg Group : {{ eggGroupSummary }}</p>
              <p v-if="selectedEntry.hatch_rate" class="info-line">
                Average Hatch Rate: {{ selectedEntry.hatch_rate }}
              </p>
            </section>

            <section v-if="dietSummary || habitatSummary" class="book-section book-section--plain">
              <p v-if="dietSummary" class="info-line">Diet : {{ dietSummary }}</p>
              <p v-if="habitatSummary" class="info-line">Habitat : {{ habitatSummary }}</p>
            </section>
          </section>

          <!-- RIGHT COLUMN -->
          <section class="book-column book-column--right">
            <section v-if="capabilityPhrase" class="book-section">
              <h3 class="book-section__title">Capability List</h3>
              <p class="paragraph">{{ capabilityPhrase }}</p>
            </section>

            <section v-if="skillPhrase" class="book-section">
              <h3 class="book-section__title">Skill List</h3>
              <p class="paragraph">{{ skillPhrase }}</p>
            </section>

            <section
              v-if="selectedEntry.level_up_moves?.length || tmHmPhrase || eggMovePhrase || tutorMovePhrase"
              class="book-section"
            >
              <h3 class="book-section__title">Move List</h3>

              <template v-if="selectedEntry.level_up_moves?.length">
                <p class="subsection-title">Level Up Move List</p>
                <ul class="move-list">
                  <li
                    v-for="move in selectedEntry.level_up_moves"
                    :key="`${move.level}-${move.name}`"
                  >
                    <span class="move-level">{{ move.level }}</span>
                    <span class="move-name">{{ move.name }}</span>
                    <span class="move-sep">-</span>
                    <span class="move-type">{{ move.type }}</span>
                  </li>
                </ul>
              </template>

              <template v-if="tmHmPhrase">
                <p class="subsection-title">TM/HM Move List</p>
                <p class="paragraph paragraph--indent">{{ tmHmPhrase }}</p>
              </template>

              <template v-if="eggMovePhrase">
                <p class="subsection-title">Egg Move List</p>
                <p class="paragraph paragraph--indent">{{ eggMovePhrase }}</p>
              </template>

              <template v-if="tutorMovePhrase">
                <p class="subsection-title">Tutor Move List</p>
                <p class="paragraph paragraph--indent">{{ tutorMovePhrase }}</p>
              </template>
            </section>
          </section>
        </div>

        <footer v-if="pageNumber != null" class="book-page__footer">
          <span class="page-number">{{ pageNumber }}</span>
        </footer>
      </article>

      <section v-else class="book-page book-page--empty">
        <h2>No entry selected</h2>
        <p>Pick a Pokémon from the sidebar to inspect its PTU data.</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.pokedex-layout {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  min-height: 100vh;
  background: #000;
}

/* ------------------------------------------------------------------ */
/* Sidebar (kept utilitarian, dark, app-style)                         */
/* ------------------------------------------------------------------ */

.pokedex-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background: #050505;
  max-height: 100vh;
  overflow: auto;
}

.sidebar-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: #0a0a0a;
  padding: 0.85rem;
}

.sidebar-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.sidebar-heading h1 {
  margin: 0;
  font-size: 1.25rem;
  letter-spacing: 0.02em;
  color: #ebe6d8;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  background: rgba(255, 255, 255, 0.06);
  color: #ddd2b0;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.badge.warn {
  background: rgba(234, 179, 8, 0.16);
  color: #fde68a;
}

.sidebar-copy,
.empty-state {
  margin: 0 0 0.9rem;
  color: rgba(235, 230, 216, 0.6);
  line-height: 1.5;
  font-size: 0.85rem;
}

.search-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.85rem;
}

input {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: #000;
  color: #ebe6d8;
  padding: 0.6rem 0.75rem;
  outline: none;
}

input:focus {
  border-color: rgba(235, 230, 216, 0.5);
  box-shadow: 0 0 0 2px rgba(235, 230, 216, 0.08);
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow: auto;
  min-height: 0;
}

.entry-button {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: #050505;
  color: #ebe6d8;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.entry-button:hover {
  border-color: rgba(235, 230, 216, 0.35);
  background: #0d0d0d;
}

.entry-button.active {
  border-color: rgba(235, 230, 216, 0.6);
  background: #111;
}

.entry-name {
  font-weight: 700;
  letter-spacing: 0.02em;
}

.entry-meta {
  color: rgba(235, 230, 216, 0.55);
  font-size: 0.78rem;
  line-height: 1.3;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  color: #ddd2b0;
}

/* ------------------------------------------------------------------ */
/* Book-style detail panel                                             */
/* ------------------------------------------------------------------ */

.pokedex-detail {
  min-width: 0;
  padding: 1.5rem;
  background: #000;
  display: flex;
  justify-content: center;
}

.book-page {
  position: relative;
  width: 100%;
  max-width: 960px;
  min-height: calc(100vh - 3rem);
  padding: 2.4rem 2.4rem 3.4rem;
  background: #050505;
  border: 1px solid rgba(235, 230, 216, 0.08);
  box-shadow:
    0 0 0 1px rgba(235, 230, 216, 0.02),
    0 30px 60px rgba(0, 0, 0, 0.6);
  color: #ebe6d8;
  font-family: "EB Garamond", "Iowan Old Style", "Palatino Linotype",
    Palatino, "Hoefler Text", "Times New Roman", Georgia, serif;
  font-size: 1.02rem;
  line-height: 1.5;
}

.book-page--empty {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  gap: 0.4rem;
  color: rgba(235, 230, 216, 0.6);
}

.book-page__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.2rem;
}

.species-name {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #f3edd9;
}

.header-badges {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.book-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 2.6rem;
  row-gap: 1.4rem;
  align-items: start;
}

.book-column {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  min-width: 0;
}

/* ---- Sprite frame with checker + corner brackets ----------------- */

.sprite-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  padding: 0.85rem;
}

.sprite-frame__inner {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background-color: #0a0a0a;
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.05) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.05) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.05) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.05) 75%);
  background-size: 18px 18px;
  background-position: 0 0, 0 9px, 9px -9px, -9px 0;
}

.sprite-frame__inner img {
  max-width: 78%;
  max-height: 78%;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.55));
}

.sprite-missing {
  color: rgba(235, 230, 216, 0.4);
  font-size: 0.85rem;
  font-style: italic;
}

.bracket {
  position: absolute;
  width: 22px;
  height: 22px;
  border-color: rgba(235, 230, 216, 0.55);
  border-style: solid;
  border-width: 0;
}

.bracket--tl { top: 0;    left: 0;    border-top-width: 2px;    border-left-width: 2px; }
.bracket--tr { top: 0;    right: 0;   border-top-width: 2px;    border-right-width: 2px; }
.bracket--bl { bottom: 0; left: 0;    border-bottom-width: 2px; border-left-width: 2px; }
.bracket--br { bottom: 0; right: 0;   border-bottom-width: 2px; border-right-width: 2px; }

/* ---- Sections, headings, body type ------------------------------- */

.book-section {
  margin: 0;
}

.book-section--plain {
  /* used for the Diet / Habitat block which has no heading in the book */
  margin-top: -0.4rem;
}

.book-section__title {
  margin: 0 0 0.3rem;
  text-align: center;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #f3edd9;
}

.subsection-title {
  margin: 0.4rem 0 0.2rem;
  font-weight: 600;
  color: #f3edd9;
}

.info-line,
.paragraph {
  margin: 0.05rem 0;
  color: #ebe6d8;
}

.paragraph {
  text-align: justify;
  hyphens: auto;
}

.paragraph--indent {
  /* mirrors the leading tab indent the printed book uses for run-on lists */
  text-indent: 1.6rem;
}

/* ---- Stat list (label : value, value right-aligned) -------------- */

.stat-list {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1.2rem;
  row-gap: 0.05rem;
}

.stat-list > div {
  display: contents;
}

.stat-list dt {
  margin: 0;
  color: #ebe6d8;
}

.stat-list dd {
  margin: 0;
  color: #ebe6d8;
}

/* ---- Move list -------------------------------------------------- */

.move-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: max-content max-content max-content 1fr;
  column-gap: 0.5rem;
  row-gap: 0.05rem;
  padding-left: 1.6rem; /* matches the indent in the printed book */
}

.move-list > li {
  display: contents;
}

.move-level {
  text-align: right;
  color: #ebe6d8;
}

.move-name {
  color: #ebe6d8;
}

.move-sep {
  color: rgba(235, 230, 216, 0.65);
}

.move-type {
  color: #ebe6d8;
}

/* ---- Page number ------------------------------------------------ */

.book-page__footer {
  position: absolute;
  right: 1.6rem;
  bottom: 1.2rem;
  color: #f3edd9;
  font-weight: 700;
}

.page-number {
  font-size: 0.95rem;
  letter-spacing: 0.04em;
}

/* ---- A11y ------------------------------------------------------- */

.sr-only {
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

/* ------------------------------------------------------------------ */
/* Responsive                                                          */
/* ------------------------------------------------------------------ */

@media (max-width: 1040px) {
  .pokedex-layout {
    grid-template-columns: 1fr;
  }

  .pokedex-sidebar {
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .pokedex-detail {
    padding: 1rem;
  }

  .book-page {
    padding: 1.6rem 1.4rem 2.6rem;
    min-height: 0;
  }
}

@media (max-width: 760px) {
  .book-columns {
    grid-template-columns: 1fr;
    column-gap: 0;
    row-gap: 1.2rem;
  }

  .sprite-frame {
    max-width: 320px;
    margin: 0 auto;
  }

  .move-list {
    padding-left: 0;
  }
}
</style>
