<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { characterSheets, getPokedexEntry, getSpriteUrl } from '~/data/characterSheets'
import { trainerSheets } from '~/data/trainerSheets'
import { formatFolderLabel, groupByFolder } from '~/utils/sheetFolders'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

useHead({
  title: 'Sheets · Rotom Table',
})

const searchTerm = ref('')

const normalize = (value: string) => value.trim().toLowerCase()

// ---------------------------------------------------------------------------
// Unified item model — trainers and Pokémon share one list, with a `kind`
// discriminator so the template can render the right card variant.
// ---------------------------------------------------------------------------

interface PokemonItem {
  kind: 'pokemon'
  slug: string
  /** Mirrored from the underlying sheet (and folder overrides applied) so
   *  ``groupByFolder`` works on the wrapper directly. */
  folder: string
  sheet: CharacterSheet
  types: string[]
  spriteUrl: string | null
  /** Lowercased label used to keep ordering inside a folder stable. */
  sortKey: string
}

interface TrainerItem {
  kind: 'trainer'
  slug: string
  folder: string
  sheet: TrainerSheet
  sortKey: string
}

type SheetItem = PokemonItem | TrainerItem

// ---------------------------------------------------------------------------
// Local override state. After a drag-drop the server moves the file on disk
// (Vite HMR will eventually re-read it), but we mirror the change locally so
// the UI updates instantly without waiting for a reload.
// ---------------------------------------------------------------------------

/** Per-sheet folder override, keyed by ``"<kind>:<slug>"``. */
const sheetOverrides = reactive<Record<string, string>>({})

/** Folder rename log applied in order. ``"team-alpha"`` → ``"npcs/team-alpha"``
 *  also rewrites every nested ``team-alpha/...`` path the same way. */
const folderRenames = ref<Array<{ from: string; to: string }>>([])

const applyFolderRenames = (path: string): string => {
  let result = path
  for (const { from, to } of folderRenames.value) {
    if (result === from) result = to
    else if (result.startsWith(from + '/')) result = to + result.slice(from.length)
  }
  return result
}

const resolveFolder = (item: { kind: 'pokemon' | 'trainer'; slug: string; folder: string }) => {
  const key = `${item.kind}:${item.slug}`
  const direct = Object.prototype.hasOwnProperty.call(sheetOverrides, key)
    ? sheetOverrides[key]
    : item.folder
  return applyFolderRenames(direct ?? '')
}

const baseItems = computed<SheetItem[]>(() => {
  const pokes: PokemonItem[] = characterSheets.map((sheet) => {
    const species = getPokedexEntry(sheet.species)
    return {
      kind: 'pokemon',
      slug: sheet.slug,
      folder: sheet.folder ?? '',
      sheet,
      types: sheet.types ?? species?.types ?? [],
      spriteUrl: getSpriteUrl(sheet.species),
      sortKey: sheet.nickname.toLowerCase(),
    }
  })
  const trainers: TrainerItem[] = trainerSheets.map((sheet) => ({
    kind: 'trainer',
    slug: sheet.slug,
    folder: sheet.folder ?? '',
    sheet,
    sortKey: sheet.name.toLowerCase(),
  }))
  return [...pokes, ...trainers]
})

const items = computed<SheetItem[]>(() =>
  baseItems.value.map((item) => ({ ...item, folder: resolveFolder(item) }) as SheetItem),
)

const filteredItems = computed<SheetItem[]>(() => {
  const query = normalize(searchTerm.value)
  if (!query) return items.value
  return items.value.filter((item) => {
    if (item.kind === 'pokemon') {
      const { sheet, types, folder } = item
      const haystacks = [sheet.nickname, sheet.species, sheet.nature ?? '', folder, ...types]
      return haystacks.some((value) => normalize(value).includes(query))
    }
    const { sheet, folder } = item
    const haystacks = [
      sheet.name,
      sheet.playedBy ?? '',
      sheet.skillBackground?.name ?? '',
      folder,
      ...(sheet.classes?.map((c) => c.name) ?? []),
    ]
    return haystacks.some((value) => normalize(value).includes(query))
  })
})

/** Folders the user has created (or that exist on disk) but which contain no
 *  sheets yet. We seed this from `/api/sheets/folders` on mount so empty
 *  directories survive a reload, and add to it when the user clicks
 *  "+ New folder". */
const extraFolders = reactive(new Set<string>())

/** Resolve an extra-folder path through the rename log. */
const resolvedExtras = computed(() => {
  const out = new Set<string>()
  for (const path of extraFolders) {
    const renamed = applyFolderRenames(path)
    if (renamed) out.add(renamed)
  }
  return out
})

const groups = computed(() => {
  const grouped = groupByFolder(filteredItems.value)
  const seen = new Set(grouped.map((g) => g.path))

  // Surface empty folders only when the user isn't searching — otherwise an
  // empty header would show up alongside filtered results, which is noise.
  if (!searchTerm.value) {
    for (const path of resolvedExtras.value) {
      if (seen.has(path)) continue
      grouped.push({ path, label: formatFolderLabel(path), items: [] })
      seen.add(path)
    }
  }

  // Re-sort: root group first, then alphabetically by path.
  grouped.sort((a, b) => {
    if (a.path === b.path) return 0
    if (a.path === '') return -1
    if (b.path === '') return 1
    return a.path.localeCompare(b.path)
  })

  // Stable alphabetical order inside each group, mixing trainers + Pokémon.
  return grouped.map((g) => ({
    ...g,
    items: [...g.items].sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
  }))
})

/** Folders that currently exist as drop targets — both inferred (from sheet
 *  paths) and extras (empty / explicitly created). Used to reject folder
 *  drops that would collide with an existing destination. */
const knownFolders = computed(() => {
  const set = new Set<string>()
  for (const item of items.value) set.add(item.folder)
  for (const path of resolvedExtras.value) set.add(path)
  return set
})

/** Hide folder UI entirely when there's only the root group with no name. */
const showFolders = computed(
  () => groups.value.length > 1 || (groups.value[0]?.path ?? '') !== '',
)

/** Per-folder collapsed state. Default: every folder open. */
const collapsed = reactive<Record<string, boolean>>({})
const isCollapsed = (path: string) => Boolean(collapsed[path])
const toggleFolder = (path: string) => {
  collapsed[path] = !collapsed[path]
}

const totalCount = computed(() => baseItems.value.length)
const filteredCount = computed(() => filteredItems.value.length)

// ---------------------------------------------------------------------------
// Drag and drop
//
// Dev-only — moves are persisted via `/api/sheets/move(-folder)` which write
// to disk and refuse to run in production builds. Sheet cards drop onto
// folder headers; folder headers drop onto other folder headers (or the
// "Default" header to move back to the root).
// ---------------------------------------------------------------------------

const canDrag = import.meta.dev

interface DragSheet {
  type: 'sheet'
  kind: 'pokemon' | 'trainer'
  slug: string
  /** Folder the sheet is in right now, used to short-circuit no-op drops. */
  from: string
}
interface DragFolder {
  type: 'folder'
  path: string
}
type DragPayload = DragSheet | DragFolder

const drag = ref<DragPayload | null>(null)
const hoverFolder = ref<string | null>(null)
const moving = ref(false)
const moveError = ref<string | null>(null)

const isDraggingSheet = (item: SheetItem): boolean =>
  drag.value?.type === 'sheet'
  && drag.value.kind === item.kind
  && drag.value.slug === item.slug

const isDraggingFolder = (path: string): boolean =>
  drag.value?.type === 'folder' && drag.value.path === path

const onSheetDragStart = (e: DragEvent, item: SheetItem) => {
  if (!canDrag) return
  drag.value = { type: 'sheet', kind: item.kind, slug: item.slug, from: item.folder }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // Firefox refuses to start a drag without setData.
    e.dataTransfer.setData('application/x-rotom-sheet', `${item.kind}:${item.slug}`)
  }
}

const onFolderDragStart = (e: DragEvent, path: string) => {
  if (!canDrag || !path) {
    // Root ("Default") isn't draggable.
    e.preventDefault()
    return
  }
  drag.value = { type: 'folder', path }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-rotom-folder', path)
  }
}

const onDragEnd = () => {
  drag.value = null
  hoverFolder.value = null
}

const canDropOn = (targetPath: string): boolean => {
  const d = drag.value
  if (!d) return false
  if (d.type === 'sheet') {
    return d.from !== targetPath
  }
  // Folder rules: can't drop onto self or any of its descendants, and the
  // would-be destination path mustn't already exist.
  if (d.path === targetPath) return false
  if (targetPath === d.path || targetPath.startsWith(d.path + '/')) return false
  const leaf = d.path.split('/').pop()!
  const newPath = targetPath ? `${targetPath}/${leaf}` : leaf
  if (newPath === d.path) return false
  if (knownFolders.value.has(newPath)) return false
  return true
}

const onDragOver = (e: DragEvent, targetPath: string) => {
  if (!drag.value || !canDropOn(targetPath)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  hoverFolder.value = targetPath
}

const onDragLeave = (targetPath: string) => {
  if (hoverFolder.value === targetPath) hoverFolder.value = null
}

const onDrop = async (e: DragEvent, targetPath: string) => {
  e.preventDefault()
  const d = drag.value
  drag.value = null
  hoverFolder.value = null
  if (!d || !canDropOn(targetPath)) return

  moving.value = true
  moveError.value = null
  try {
    if (d.type === 'sheet') {
      await $fetch('/api/sheets/move', {
        method: 'POST',
        body: { kind: d.kind, slug: d.slug, folder: targetPath },
      })
      sheetOverrides[`${d.kind}:${d.slug}`] = targetPath
    } else {
      const leaf = d.path.split('/').pop()!
      const newPath = targetPath ? `${targetPath}/${leaf}` : leaf
      await $fetch('/api/sheets/move-folder', {
        method: 'POST',
        body: { from: d.path, to: newPath },
      })
      folderRenames.value = [...folderRenames.value, { from: d.path, to: newPath }]
    }
  } catch (err: any) {
    const msg = err?.statusMessage ?? err?.data?.statusMessage ?? err?.message ?? String(err)
    moveError.value = msg
    console.error('[sheets] move failed', err)
  } finally {
    moving.value = false
  }
}

// ---------------------------------------------------------------------------
// New folder
// ---------------------------------------------------------------------------

const creatingFolder = ref(false)
const newFolderName = ref('')
const createError = ref<string | null>(null)
const newFolderInput = ref<HTMLInputElement | null>(null)

const startCreateFolder = async () => {
  creatingFolder.value = true
  newFolderName.value = ''
  createError.value = null
  await nextTick()
  newFolderInput.value?.focus()
}

const cancelCreateFolder = () => {
  creatingFolder.value = false
  newFolderName.value = ''
  createError.value = null
}

const submitCreateFolder = async () => {
  const name = newFolderName.value.trim().replace(/^\/+|\/+$/g, '')
  if (!name) {
    createError.value = 'Folder name is required.'
    return
  }
  createError.value = null
  try {
    await $fetch('/api/sheets/create-folder', {
      method: 'POST',
      body: { folder: name },
    })
    extraFolders.add(name)
    creatingFolder.value = false
    newFolderName.value = ''
  } catch (err: any) {
    createError.value = err?.statusMessage ?? err?.data?.statusMessage ?? err?.message ?? String(err)
  }
}

// On mount (client only), pull the on-disk folder list so empty folders
// created in a previous session still show up as drop targets.
onMounted(async () => {
  if (!canDrag) return
  try {
    const data = await $fetch<{ folders: string[] }>('/api/sheets/folders')
    for (const f of data.folders) extraFolders.add(f)
  } catch (err) {
    console.warn('[sheets] failed to load existing folders', err)
  }
})
</script>

<template>
  <div class="sheets-layout" :class="{ 'is-dragging': drag !== null }">
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
          <span v-if="canDrag" class="drag-hint">
            Tip: drag any card or folder header onto another folder header to
            rearrange — the change is written straight back to disk.
          </span>
        </p>

        <div class="intro-controls">
          <label class="search-field">
            <span class="sr-only">Search sheets</span>
            <input
              v-model.trim="searchTerm"
              type="search"
              placeholder="Search name, species, class, type…"
            />
          </label>

          <div v-if="canDrag" class="folder-actions">
            <button
              v-if="!creatingFolder"
              type="button"
              class="new-folder-btn"
              @click="startCreateFolder"
            >
              <span aria-hidden="true">＋</span> New folder
            </button>

            <form v-else class="new-folder-form" @submit.prevent="submitCreateFolder">
              <input
                ref="newFolderInput"
                v-model="newFolderName"
                type="text"
                class="new-folder-input"
                placeholder="Folder name (use / for nesting, e.g. npcs/wild)"
                @keydown.escape.prevent="cancelCreateFolder"
              />
              <button type="submit" class="new-folder-submit">Create</button>
              <button type="button" class="new-folder-cancel" @click="cancelCreateFolder">Cancel</button>
            </form>
          </div>
        </div>

        <p v-if="createError" class="move-error" role="alert">
          {{ createError }}
        </p>
        <p v-if="moveError" class="move-error" role="alert">
          Move failed: {{ moveError }}
        </p>
      </section>
    </header>

    <section class="sheet-section">
      <template v-for="group in groups" :key="`group-${group.path}`">
        <div
          v-if="showFolders"
          class="folder-row"
          :class="{
            'drop-target': hoverFolder === group.path,
            'drop-disabled': drag !== null && !canDropOn(group.path),
            'is-default': group.path === '',
            'is-dragging-self': isDraggingFolder(group.path),
          }"
          :draggable="canDrag && group.path !== ''"
          @dragstart="onFolderDragStart($event, group.path)"
          @dragend="onDragEnd"
          @dragover="onDragOver($event, group.path)"
          @dragleave="onDragLeave(group.path)"
          @drop="onDrop($event, group.path)"
        >
          <button
            class="folder-toggle"
            type="button"
            :aria-expanded="!isCollapsed(group.path)"
            @click="toggleFolder(group.path)"
          >
            <span class="folder-caret" :class="{ collapsed: isCollapsed(group.path) }" aria-hidden="true">▾</span>
            <span class="folder-label">{{ group.label }}</span>
            <span class="folder-count badge">{{ group.items.length }}</span>
          </button>
        </div>

        <p
          v-if="showFolders && !isCollapsed(group.path) && group.items.length === 0"
          class="folder-empty-hint"
        >
          Empty folder — drag a sheet onto the header above to fill it.
        </p>

        <div v-show="!showFolders || !isCollapsed(group.path)" class="sheets-grid">
          <template v-for="item in group.items" :key="`${item.kind}:${item.slug}`">
            <NuxtLink
              v-if="item.kind === 'pokemon'"
              :to="`/sheets/${item.slug}`"
              class="sheet-card"
              :class="{ 'is-dragging-self': isDraggingSheet(item) }"
              :draggable="canDrag"
              @dragstart="onSheetDragStart($event, item)"
              @dragend="onDragEnd"
            >
              <div class="sheet-card__sprite">
                <img v-if="item.spriteUrl" :src="item.spriteUrl" :alt="item.sheet.species" />
                <span v-else class="sprite-missing">?</span>
              </div>

              <div class="sheet-card__body">
                <div class="sheet-card__heading">
                  <h3>{{ item.sheet.nickname }}</h3>
                  <span v-if="item.sheet.shiny" class="badge shiny" title="Shiny">★</span>
                </div>
                <p class="sheet-card__species">
                  {{ item.sheet.species }} · Lv {{ item.sheet.level }}
                </p>

                <ul class="sheet-card__meta">
                  <li v-if="item.sheet.nature">{{ item.sheet.nature }}</li>
                  <li v-if="item.sheet.gender">{{ item.sheet.gender }}</li>
                  <li v-if="item.types.length">{{ item.types.join(' / ') }}</li>
                </ul>
              </div>
            </NuxtLink>

            <NuxtLink
              v-else
              :to="`/sheets/trainers/${item.slug}`"
              class="sheet-card sheet-card--trainer"
              :class="{ 'is-dragging-self': isDraggingSheet(item) }"
              :draggable="canDrag"
              @dragstart="onSheetDragStart($event, item)"
              @dragend="onDragEnd"
            >
              <div class="sheet-card__sprite trainer-icon">
                <span aria-hidden="true">🎯</span>
              </div>
              <div class="sheet-card__body">
                <div class="sheet-card__heading">
                  <h3>{{ item.sheet.name }}</h3>
                </div>
                <p class="sheet-card__species">
                  Trainer · Lv {{ item.sheet.level }}
                  <span v-if="item.sheet.classes?.length">· {{ item.sheet.classes.map((c) => c.name).join(', ') }}</span>
                </p>
                <ul class="sheet-card__meta">
                  <li v-if="item.sheet.skillBackground?.name">{{ item.sheet.skillBackground.name }}</li>
                  <li v-if="item.sheet.sex">{{ item.sheet.sex }}</li>
                  <li v-if="item.sheet.playedBy">PB: {{ item.sheet.playedBy }}</li>
                </ul>
              </div>
            </NuxtLink>
          </template>
        </div>
      </template>

      <p v-if="filteredCount === 0" class="empty-state">
        Nothing matches that search.
      </p>
    </section>
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

.drag-hint {
  display: block;
  margin-top: 0.45rem;
  color: var(--ink-muted);
  font-size: 0.85em;
  font-style: italic;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  color: var(--accent);
}

.intro-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: stretch;
}

.search-field {
  flex: 1 1 240px;
  display: block;
}

.folder-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
}

.new-folder-btn,
.new-folder-submit,
.new-folder-cancel {
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: var(--paper-soft);
  color: var(--ink);
  padding: 0.55rem 0.85rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.new-folder-btn:hover,
.new-folder-submit:hover,
.new-folder-cancel:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.new-folder-btn:focus-visible,
.new-folder-submit:focus-visible,
.new-folder-cancel:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.new-folder-submit {
  border-color: var(--accent);
  color: var(--accent);
}

.new-folder-form {
  display: flex;
  align-items: stretch;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.new-folder-input {
  flex: 1 1 220px;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.75rem;
  outline: none;
}

.new-folder-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.folder-empty-hint {
  margin: 0.1rem 0 0.2rem;
  padding: 0.35rem 0.55rem;
  color: var(--ink-muted);
  font-size: 0.8rem;
  font-style: italic;
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

.move-error {
  margin: 0.6rem 0 0;
  padding: 0.45rem 0.65rem;
  border-radius: 8px;
  background: rgba(220, 80, 80, 0.12);
  border: 1px solid rgba(220, 80, 80, 0.4);
  color: #c44;
  font-size: 0.85rem;
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

/* ---- Folder grouping ---- */

.folder-row {
  display: flex;
  align-items: stretch;
  gap: 0.6rem;
  margin: 0.4rem 0 -0.1rem;
  border-radius: 8px;
  /* Reserve a transparent border so the dashed hint in is-dragging mode
     doesn't shift layout when it appears. */
  border: 1px dashed transparent;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.is-dragging .folder-row {
  border-color: var(--rule);
}

.is-dragging .folder-row.drop-disabled {
  border-color: transparent;
  opacity: 0.5;
}

.folder-row.drop-target {
  background: var(--accent-soft);
  border-color: var(--accent);
  border-style: solid;
}

.folder-row.is-dragging-self {
  opacity: 0.4;
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

.folder-row[draggable='true'] .folder-toggle {
  cursor: grab;
}

.folder-row[draggable='true']:active .folder-toggle {
  cursor: grabbing;
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
    background 0.15s ease,
    opacity 0.15s ease;
}

.sheet-card:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.sheet-card[draggable='true'] {
  cursor: grab;
}

.sheet-card[draggable='true']:active {
  cursor: grabbing;
}

.sheet-card.is-dragging-self {
  opacity: 0.4;
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
