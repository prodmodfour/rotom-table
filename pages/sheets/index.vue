<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { characterSheets, getPokedexEntry, getSpriteUrl } from '~/data/characterSheets'
import { trainerSheets } from '~/data/trainerSheets'
import { groupByFolder } from '~/utils/sheetFolders'

useHead({
  title: 'Sheets · Rotom Table',
})

const searchTerm = ref('')

const normalize = (value: string) => value.trim().toLowerCase()

interface PokemonSheetMeta {
  sheet: (typeof characterSheets)[number]
  types: string[]
  spriteUrl: string | null
  /** Folder is mirrored from the underlying sheet so ``groupByFolder`` works
   *  on the wrapper directly. */
  folder?: string
}

const sheetsWithMeta = computed<PokemonSheetMeta[]>(() =>
  characterSheets.map((sheet) => {
    const species = getPokedexEntry(sheet.species)
    return {
      sheet,
      types: sheet.types ?? species?.types ?? [],
      spriteUrl: getSpriteUrl(sheet.species),
      folder: sheet.folder,
    }
  }),
)

const filteredSheets = computed(() => {
  const query = normalize(searchTerm.value)
  if (!query) return sheetsWithMeta.value
  return sheetsWithMeta.value.filter(({ sheet, types }) => {
    const haystacks = [sheet.nickname, sheet.species, sheet.nature ?? '', sheet.folder ?? '', ...types]
    return haystacks.some((value) => normalize(value).includes(query))
  })
})

const filteredTrainers = computed(() => {
  const query = normalize(searchTerm.value)
  if (!query) return trainerSheets
  return trainerSheets.filter((t) => {
    const haystacks = [
      t.name,
      t.playedBy ?? '',
      t.skillBackground?.name ?? '',
      t.folder ?? '',
      ...(t.classes?.map((c) => c.name) ?? []),
    ]
    return haystacks.some((v) => normalize(v).includes(query))
  })
})

/** Grouped views used by the template — only show folder headers when there
 *  is more than one folder in play, so a flat data/sheets/ keeps its old
 *  look. */
const pokemonGroups   = computed(() => groupByFolder(filteredSheets.value))
const trainerGroups   = computed(() => groupByFolder(filteredTrainers.value))
const showPokemonFolders = computed(() => pokemonGroups.value.length > 1)
const showTrainerFolders = computed(() => trainerGroups.value.length > 1)

/** Per-folder collapsed state. Default: every folder open. Keyed by
 *  ``"<kind>:<path>"`` so trainer/pokemon namespaces don't collide. */
const collapsed = reactive<Record<string, boolean>>({})
const folderKey = (kind: 'pokemon' | 'trainer', path: string) => `${kind}:${path}`
const toggleFolder = (kind: 'pokemon' | 'trainer', path: string) => {
  const key = folderKey(kind, path)
  collapsed[key] = !collapsed[key]
}
const isCollapsed = (kind: 'pokemon' | 'trainer', path: string) =>
  Boolean(collapsed[folderKey(kind, path)])

/** Total counts shown in the intro badge. */
const totalCount     = computed(() => sheetsWithMeta.value.length + trainerSheets.length)
const filteredCount  = computed(() => filteredSheets.value.length + filteredTrainers.value.length)
</script>

<template>
  <div class="sheets-layout">
    <header class="sheets-header">
      <AppNavigation />

      <section class="panel-card sheets-intro">
        <div class="intro-heading">
          <h1>Character Sheets</h1>
          <span class="badge">{{ filteredCount }} of {{ totalCount }}</span>
        </div>
        <p class="intro-copy">
          Trainers and Pokémon character sheets, modelled on the PTU
          <code>pokesheet</code> / <code>trainer</code> spreadsheets. Drop a
          new JSON file into <code>data/sheets/</code> for a Pokémon, or
          <code>data/trainers/</code> for a trainer. Use subdirectories
          (e.g. <code>data/sheets/team-alpha/</code>) to group sheets into
          folders — the directory name becomes the folder label.
        </p>

        <label class="search-field">
          <span class="sr-only">Search sheets</span>
          <input
            v-model.trim="searchTerm"
            type="search"
            placeholder="Search name, species, class, type…"
          />
        </label>
      </section>
    </header>

    <!-- ===== Trainers ===== -->
    <section v-if="filteredTrainers.length" class="sheet-section">
      <h2 class="section-title">Trainers <span class="badge">{{ filteredTrainers.length }}</span></h2>

      <template v-for="group in trainerGroups" :key="`trainer-${group.path}`">
        <div v-if="showTrainerFolders" class="folder-row">
          <button
            class="folder-toggle"
            type="button"
            :aria-expanded="!isCollapsed('trainer', group.path)"
            @click="toggleFolder('trainer', group.path)"
          >
            <span class="folder-caret" :class="{ collapsed: isCollapsed('trainer', group.path) }" aria-hidden="true">▾</span>
            <span class="folder-label">{{ group.label }}</span>
            <span class="folder-count badge">{{ group.items.length }}</span>
          </button>
        </div>

        <div v-show="!showTrainerFolders || !isCollapsed('trainer', group.path)" class="sheets-grid">
          <NuxtLink
            v-for="trainer in group.items"
            :key="trainer.slug"
            :to="`/sheets/trainers/${trainer.slug}`"
            class="sheet-card sheet-card--trainer"
          >
            <div class="sheet-card__sprite trainer-icon">
              <span aria-hidden="true">🎯</span>
            </div>
            <div class="sheet-card__body">
              <div class="sheet-card__heading">
                <h3>{{ trainer.name }}</h3>
              </div>
              <p class="sheet-card__species">
                Trainer · Lv {{ trainer.level }}
                <span v-if="trainer.classes?.length">· {{ trainer.classes.map((c) => c.name).join(', ') }}</span>
              </p>
              <ul class="sheet-card__meta">
                <li v-if="trainer.skillBackground?.name">{{ trainer.skillBackground.name }}</li>
                <li v-if="trainer.sex">{{ trainer.sex }}</li>
                <li v-if="trainer.playedBy">PB: {{ trainer.playedBy }}</li>
              </ul>
            </div>
          </NuxtLink>
        </div>
      </template>
    </section>

    <!-- ===== Pokémon ===== -->
    <section class="sheet-section">
      <h2 class="section-title">Pokémon <span class="badge">{{ filteredSheets.length }}</span></h2>

      <template v-for="group in pokemonGroups" :key="`pokemon-${group.path}`">
        <div v-if="showPokemonFolders" class="folder-row">
          <button
            class="folder-toggle"
            type="button"
            :aria-expanded="!isCollapsed('pokemon', group.path)"
            @click="toggleFolder('pokemon', group.path)"
          >
            <span class="folder-caret" :class="{ collapsed: isCollapsed('pokemon', group.path) }" aria-hidden="true">▾</span>
            <span class="folder-label">{{ group.label }}</span>
            <span class="folder-count badge">{{ group.items.length }}</span>
          </button>
        </div>

        <div v-show="!showPokemonFolders || !isCollapsed('pokemon', group.path)" class="sheets-grid">
          <NuxtLink
            v-for="{ sheet, types, spriteUrl } in group.items"
            :key="sheet.slug"
            :to="`/sheets/${sheet.slug}`"
            class="sheet-card"
          >
            <div class="sheet-card__sprite">
              <img v-if="spriteUrl" :src="spriteUrl" :alt="sheet.species" />
              <span v-else class="sprite-missing">?</span>
            </div>

            <div class="sheet-card__body">
              <div class="sheet-card__heading">
                <h3>{{ sheet.nickname }}</h3>
                <span v-if="sheet.shiny" class="badge shiny" title="Shiny">★</span>
              </div>
              <p class="sheet-card__species">{{ sheet.species }} · Lv {{ sheet.level }}</p>

              <ul class="sheet-card__meta">
                <li v-if="sheet.nature">{{ sheet.nature }}</li>
                <li v-if="sheet.gender">{{ sheet.gender }}</li>
                <li v-if="types.length">{{ types.join(' / ') }}</li>
              </ul>
            </div>
          </NuxtLink>
        </div>
      </template>

      <p v-if="filteredSheets.length === 0" class="empty-state">
        No Pokémon match that search.
      </p>
    </section>

    <p v-if="filteredCount === 0" class="empty-state">
      Nothing matches that search.
    </p>
  </div>
</template>

<style scoped>
.sheets-layout {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
}

.sheets-header {
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

.intro-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.4rem;
}

.intro-heading h1 {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.intro-copy {
  margin: 0 0 0.85rem;
  color: var(--ink-soft);
  line-height: 1.5;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  color: var(--accent);
}

.search-field {
  display: block;
}

input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.65rem 0.8rem;
  outline: none;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
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
  padding: 0.18rem 0.5rem;
  font-size: 0.95rem;
  line-height: 1;
}

.sheet-section {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.section-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--serif);
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
}

/* ---- Folder grouping ---- */

.folder-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0.4rem 0 -0.1rem;
}

.folder-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--rule);
  border-radius: 8px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  text-align: left;
  cursor: pointer;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.folder-toggle:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.folder-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.folder-caret {
  font-size: 0.85rem;
  color: var(--accent);
  transition: transform 0.15s ease;
}

.folder-caret.collapsed {
  transform: rotate(-90deg);
}

.folder-label {
  flex: 1;
  min-width: 0;
  font-family: var(--serif);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink);
}

.folder-toggle:hover .folder-label {
  color: var(--ink-bright);
}

.folder-count {
  flex: 0 0 auto;
}

.sheets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.7rem;
}

.sheet-card {
  display: flex;
  gap: 0.85rem;
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  color: var(--ink);
  text-decoration: none;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.sheet-card:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.sheet-card--trainer {
  /* Trainer cards share the parchment look but get a slightly
     stronger left edge so they read as a separate kind of entry. */
  border-left: 2px solid var(--rule-strong);
}

.sheet-card--trainer:hover {
  border-color: var(--rule-active);
  border-left-color: var(--accent);
}

.trainer-icon {
  font-size: 1.8rem;
  display: grid;
  place-items: center;
}

.sheet-card__sprite {
  flex: 0 0 auto;
  width: 72px;
  height: 72px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  padding: 0.3rem;
}

.sheet-card__sprite img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.sprite-missing {
  color: var(--ink-faint);
  font-size: 1.4rem;
  font-weight: 700;
}

.sheet-card__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.sheet-card__heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sheet-card__heading h2,
.sheet-card__heading h3 {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-bright);
}

.sheet-card__species {
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.88rem;
}

.sheet-card__meta {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  color: var(--ink-muted);
  font-size: 0.76rem;
  letter-spacing: 0.04em;
}

.sheet-card__meta li {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--paper-inset);
  border: 1px solid var(--rule);
}

.empty-state {
  grid-column: 1 / -1;
  margin: 1.5rem 0;
  text-align: center;
  color: var(--ink-muted);
  font-style: italic;
}

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
</style>
