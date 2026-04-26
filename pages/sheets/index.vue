<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PhCaretRight,
  PhFolder,
  PhFolderOpen,
  PhHouse,
  PhPlus,
} from '@phosphor-icons/vue'
import { characterSheets, getPokedexEntry, getSpriteUrl } from '~/data/characterSheets'
import { trainerSheets } from '~/data/trainerSheets'
import { formatFolderLabel } from '~/utils/sheetFolders'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

useHead({
  title: 'Sheets · Rotom Table',
})

// ---------------------------------------------------------------------------
// Item model
// ---------------------------------------------------------------------------

interface PokemonItem {
  kind: 'pokemon'
  slug: string
  folder: string
  sheet: CharacterSheet
  types: string[]
  spriteUrl: string | null
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
// Local override state. Drag-drop hits a server endpoint that moves the file
// on disk, but we mirror the move locally so the UI updates instantly without
// waiting for Vite HMR to re-import the data globs.
// ---------------------------------------------------------------------------

const sheetOverrides = reactive<Record<string, string>>({})
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

// Folders explicitly created by the user (or that already exist on disk as
// empty dirs). Seeded from `/api/sheets/folders` on mount.
const extraFolders = reactive(new Set<string>())

const resolvedExtras = computed(() => {
  const out = new Set<string>()
  for (const path of extraFolders) {
    const renamed = applyFolderRenames(path)
    if (renamed) out.add(renamed)
  }
  return out
})

/** Every folder path that exists, inferred + extras. */
const allFolders = computed(() => {
  const set = new Set<string>()
  for (const item of items.value) if (item.folder) set.add(item.folder)
  for (const path of resolvedExtras.value) set.add(path)
  return set
})

// ---------------------------------------------------------------------------
// Folder navigation. The current folder lives in the URL as `?folder=foo/bar`
// so the browser back/forward buttons work and links can deep-link to a
// subfolder.
// ---------------------------------------------------------------------------

const route = useRoute()
const router = useRouter()

const currentPath = computed(() => {
  const raw = route.query.folder
  if (typeof raw !== 'string') return ''
  return raw.replace(/^\/+|\/+$/g, '')
})

const goToFolder = (path: string) => {
  router.push({ path: '/sheets', query: path ? { folder: path } : {} })
}

const breadcrumbs = computed(() => {
  const out: Array<{ label: string; path: string }> = [{ label: 'Home', path: '' }]
  if (!currentPath.value) return out
  let acc = ''
  for (const seg of currentPath.value.split('/')) {
    acc = acc ? `${acc}/${seg}` : seg
    out.push({ label: formatFolderLabel(seg), path: acc })
  }
  return out
})

// ---------------------------------------------------------------------------
// Search and filtering
// ---------------------------------------------------------------------------

const searchTerm = ref('')
const normalize = (value: string) => value.trim().toLowerCase()

const matchesQuery = (item: SheetItem, query: string): boolean => {
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
}

const isInsideCurrent = (folder: string): boolean => {
  if (!currentPath.value) return true
  return folder === currentPath.value || folder.startsWith(currentPath.value + '/')
}

/** Sheets shown in the main grid. While searching, we flatten the entire
 *  subtree under the current folder; otherwise we show only sheets that live
 *  *directly* in the current folder. */
const visibleSheets = computed<SheetItem[]>(() => {
  const query = normalize(searchTerm.value)
  const pool = items.value.filter((item) => isInsideCurrent(item.folder))
  const matched = query ? pool.filter((item) => matchesQuery(item, query)) : pool
  if (!query) {
    return matched
      .filter((item) => item.folder === currentPath.value)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  }
  return [...matched].sort((a, b) => a.sortKey.localeCompare(b.sortKey))
})

interface FolderTile {
  /** Full path under the sheet root, e.g. ``"npcs/wild"``. */
  path: string
  /** Display label of the leaf segment, e.g. ``"Wild"``. */
  label: string
  /** Total number of sheets contained anywhere under this folder. */
  count: number
}

/** Folder tiles shown alongside the sheet cards — direct subfolders of
 *  ``currentPath``. Hidden during search to avoid noise. */
const visibleFolders = computed<FolderTile[]>(() => {
  if (searchTerm.value) return []
  const prefix = currentPath.value ? currentPath.value + '/' : ''
  const childPaths = new Set<string>()
  for (const path of allFolders.value) {
    if (currentPath.value && !path.startsWith(prefix)) continue
    if (path === currentPath.value) continue
    const rest = currentPath.value ? path.slice(prefix.length) : path
    if (!rest) continue
    const slash = rest.indexOf('/')
    const childSeg = slash >= 0 ? rest.slice(0, slash) : rest
    childPaths.add(currentPath.value ? `${currentPath.value}/${childSeg}` : childSeg)
  }
  return Array.from(childPaths)
    .sort((a, b) => a.localeCompare(b))
    .map((path) => {
      const subPrefix = path + '/'
      let count = 0
      for (const item of items.value) {
        if (item.folder === path || item.folder.startsWith(subPrefix)) count++
      }
      const leaf = path.split('/').pop() ?? path
      return { path, label: formatFolderLabel(leaf), count }
    })
})

// Counts shown in the intro badge.
const totalCount = computed(() => baseItems.value.length)
const filteredCount = computed(() => {
  const query = normalize(searchTerm.value)
  if (!query) return totalCount.value
  return items.value.filter((item) => matchesQuery(item, query)).length
})

const hasAnything = computed(
  () => visibleSheets.value.length > 0 || visibleFolders.value.length > 0,
)

// ---------------------------------------------------------------------------
// Drag and drop. Drop targets are folder tiles and breadcrumb items; the
// "Home" breadcrumb is the root drop target. Dev-only — moves are persisted
// via `/api/sheets/move(-folder)` which write to disk.
// ---------------------------------------------------------------------------

const canDrag = import.meta.dev

interface DragSheet {
  type: 'sheet'
  kind: 'pokemon' | 'trainer'
  slug: string
  from: string
}
interface DragFolder {
  type: 'folder'
  path: string
}
type DragPayload = DragSheet | DragFolder

const drag = ref<DragPayload | null>(null)
const hoverTarget = ref<string | null>(null)
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
    // Required for Firefox to actually start the drag.
    e.dataTransfer.setData('application/x-rotom-sheet', `${item.kind}:${item.slug}`)
  }
}

const onFolderDragStart = (e: DragEvent, path: string) => {
  if (!canDrag || !path) {
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
  hoverTarget.value = null
}

const canDropOn = (targetPath: string): boolean => {
  const d = drag.value
  if (!d) return false
  if (d.type === 'sheet') {
    return d.from !== targetPath
  }
  if (d.path === targetPath) return false
  if (targetPath === d.path || targetPath.startsWith(d.path + '/')) return false
  const leaf = d.path.split('/').pop()!
  const newPath = targetPath ? `${targetPath}/${leaf}` : leaf
  if (newPath === d.path) return false
  if (allFolders.value.has(newPath)) return false
  return true
}

const onDropEnter = (e: DragEvent, targetPath: string) => {
  if (!drag.value || !canDropOn(targetPath)) return
  e.preventDefault()
  hoverTarget.value = targetPath
}

const onDropOver = (e: DragEvent, targetPath: string) => {
  if (!drag.value || !canDropOn(targetPath)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  hoverTarget.value = targetPath
}

const onDropLeave = (targetPath: string) => {
  if (hoverTarget.value === targetPath) hoverTarget.value = null
}

const performMove = async (d: DragPayload, targetPath: string) => {
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
}

const onDrop = async (e: DragEvent, targetPath: string) => {
  e.preventDefault()
  e.stopPropagation()
  const d = drag.value
  drag.value = null
  hoverTarget.value = null
  if (!d || !canDropOn(targetPath)) return

  moving.value = true
  moveError.value = null
  try {
    await performMove(d, targetPath)
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
  const leaf = newFolderName.value.trim().replace(/^\/+|\/+$/g, '')
  if (!leaf) {
    createError.value = 'Folder name is required.'
    return
  }
  // The form creates folders relative to the current path so the user lands
  // exactly where they expect.
  const fullPath = currentPath.value ? `${currentPath.value}/${leaf}` : leaf
  createError.value = null
  try {
    await $fetch('/api/sheets/create-folder', {
      method: 'POST',
      body: { folder: fullPath },
    })
    extraFolders.add(fullPath)
    creatingFolder.value = false
    newFolderName.value = ''
  } catch (err: any) {
    createError.value = err?.statusMessage ?? err?.data?.statusMessage ?? err?.message ?? String(err)
  }
}

// On mount (client only) seed extraFolders from on-disk dirs so empty
// folders persist across reloads.
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
            Tip: open a folder by clicking it. Drag any card or folder onto
            another folder (or a breadcrumb) to move it — the change is
            written straight back to disk.
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
              <PhPlus :size="16" weight="bold" /> New folder
            </button>

            <form v-else class="new-folder-form" @submit.prevent="submitCreateFolder">
              <input
                ref="newFolderInput"
                v-model="newFolderName"
                type="text"
                class="new-folder-input"
                placeholder="Folder name"
                @keydown.escape.prevent="cancelCreateFolder"
              />
              <button type="submit" class="new-folder-submit">Create</button>
              <button type="button" class="new-folder-cancel" @click="cancelCreateFolder">
                Cancel
              </button>
            </form>
          </div>
        </div>

        <p v-if="createError" class="move-error" role="alert">{{ createError }}</p>
        <p v-if="moveError" class="move-error" role="alert">Move failed: {{ moveError }}</p>
      </section>

      <nav class="breadcrumbs panel-card" aria-label="Folder path">
        <template v-for="(crumb, i) in breadcrumbs" :key="`crumb-${crumb.path}`">
          <PhCaretRight v-if="i > 0" :size="14" weight="bold" class="crumb-sep" aria-hidden="true" />
          <button
            type="button"
            class="crumb"
            :class="{
              'crumb--current': crumb.path === currentPath,
              'drop-target': hoverTarget === crumb.path,
              'drop-disabled': drag !== null && !canDropOn(crumb.path),
            }"
            :aria-current="crumb.path === currentPath ? 'page' : undefined"
            @click="goToFolder(crumb.path)"
            @dragenter="onDropEnter($event, crumb.path)"
            @dragover="onDropOver($event, crumb.path)"
            @dragleave="onDropLeave(crumb.path)"
            @drop="onDrop($event, crumb.path)"
          >
            <PhHouse v-if="crumb.path === ''" :size="14" weight="bold" aria-hidden="true" />
            <span>{{ crumb.label }}</span>
          </button>
        </template>
      </nav>
    </header>

    <section class="sheet-section">
      <div v-if="hasAnything" class="sheets-grid">
        <button
          v-for="folder in visibleFolders"
          :key="`folder-${folder.path}`"
          type="button"
          class="folder-tile"
          :class="{
            'drop-target': hoverTarget === folder.path,
            'drop-disabled': drag !== null && !canDropOn(folder.path),
            'is-dragging-self': isDraggingFolder(folder.path),
          }"
          :draggable="canDrag"
          @click="goToFolder(folder.path)"
          @dragstart="onFolderDragStart($event, folder.path)"
          @dragend="onDragEnd"
          @dragenter="onDropEnter($event, folder.path)"
          @dragover="onDropOver($event, folder.path)"
          @dragleave="onDropLeave(folder.path)"
          @drop="onDrop($event, folder.path)"
        >
          <span class="folder-tile__icon">
            <PhFolderOpen
              v-if="hoverTarget === folder.path && canDropOn(folder.path)"
              :size="48"
              weight="duotone"
              aria-hidden="true"
            />
            <PhFolder v-else :size="48" weight="duotone" aria-hidden="true" />
          </span>
          <div class="folder-tile__body">
            <span class="folder-tile__label">{{ folder.label }}</span>
            <span class="folder-tile__meta">{{ folder.count }} item{{ folder.count === 1 ? '' : 's' }}</span>
          </div>
        </button>

        <template v-for="item in visibleSheets" :key="`${item.kind}:${item.slug}`">
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

      <p v-else-if="searchTerm" class="empty-state">
        Nothing matches that search.
      </p>
      <p v-else class="empty-state">
        This folder is empty. Drag a sheet here from another folder or use
        <strong>+ New folder</strong> to add a subfolder.
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

.folder-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
}

.new-folder-btn,
.new-folder-submit,
.new-folder-cancel {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
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

/* ---- Breadcrumbs ---- */

.breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.35rem;
  padding: 0.45rem 0.65rem;
}

.crumb {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.55rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-soft);
  font: inherit;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.crumb:hover {
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.crumb:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.crumb--current {
  color: var(--ink-bright);
  font-weight: 600;
}

.crumb.drop-target {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.crumb.drop-disabled {
  opacity: 0.4;
}

.crumb-sep {
  color: var(--ink-faint);
}

/* ---- Sheet section ---- */

.sheet-section {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.sheets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.7rem;
  align-items: stretch;
}

/* ---- Folder tiles ---- */

.folder-tile {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.1s ease,
    opacity 0.15s ease;
}

.folder-tile:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.folder-tile:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.folder-tile[draggable='true']:active {
  cursor: grabbing;
  transform: scale(0.99);
}

.folder-tile.drop-target {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.folder-tile.drop-disabled {
  opacity: 0.45;
}

.folder-tile.is-dragging-self {
  opacity: 0.4;
}

.folder-tile__icon {
  flex: 0 0 auto;
  width: 72px;
  height: 72px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  color: var(--accent);
}

.folder-tile.drop-target .folder-tile__icon {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--paper-soft);
}

.folder-tile__body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.folder-tile__label {
  font-family: var(--serif);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-tile__meta {
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
}

/* ---- Sheet cards ---- */

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
  /* Trainer cards share the parchment look but get a slightly stronger left
     edge so they read as a separate kind of entry. */
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
