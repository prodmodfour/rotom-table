<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { characterSheets, getPokedexEntry, getSpriteUrl } from '~/data/characterSheets'
import { trainerSheets } from '~/data/trainerSheets'
import {
  buildFolderBreadcrumbs,
  buildFolderMoveDestinations,
  buildVisibleFolderTiles,
  canMoveFolderTo,
  folderPathFromQuery,
  isInsideFolder,
  movedFolderPath,
  nextAvailableFolderLeaf,
  normalizeSearchText,
  renameFolderPrefix,
  type FolderTile,
} from '~/utils/folderBrowser'
import {
  applySheetLibraryOverrides,
  buildSheetFolderSet,
  buildSheetLibraryItems,
  displaySheetLibraryName,
  matchesSheetLibraryQuery,
  type SheetLibraryItem,
} from '~/utils/sheetLibrary'

useHead({
  title: 'Sheets · Rotom Table',
})

const { isGm, isPlayer } = useAuth()

type SheetItem = SheetLibraryItem

// ---------------------------------------------------------------------------
// Local override state. Drag-drop hits a server endpoint that moves the file
// on disk, but we mirror the move locally so the UI updates instantly without
// waiting for Vite HMR to re-import the data globs.
// ---------------------------------------------------------------------------

const sheetOverrides = reactive<Record<string, string>>({})
const folderRenames = ref<Array<{ from: string; to: string }>>([])

/** Display-name overrides keyed by ``"<kind>:<slug>"``. */
const nameOverrides = reactive<Record<string, string>>({})

/** Soft-deleted sheet keys (``"<kind>:<slug>"``) and folder paths. The server
 *  has already removed them on disk; these sets just keep the UI in sync
 *  until Vite HMR catches up. */
const deletedSheets = reactive(new Set<string>())
const deletedFolders = reactive(new Set<string>())

const baseItems = computed<SheetItem[]>(() =>
  buildSheetLibraryItems({
    pokemonSheets: characterSheets,
    trainerSheets,
    speciesTypesFor: (species) => getPokedexEntry(species)?.types,
    spriteUrlFor: getSpriteUrl,
  }),
)

const items = computed<SheetItem[]>(() =>
  applySheetLibraryOverrides(baseItems.value, {
    playerOnly: isPlayer.value,
    sheetOverrides,
    folderRenames: folderRenames.value,
    nameOverrides,
    deletedSheets,
    deletedFolders,
  }),
)

/** Display name for a sheet item (honours local rename overrides). */
const displayName = displaySheetLibraryName

// Folders explicitly created by the user (or that already exist on disk as
// empty dirs). Seeded from `/api/sheets/folders` on mount.
const extraFolders = reactive(new Set<string>())

/** Every folder path that exists, inferred + extras, minus locally-deleted
 *  folders (and any descendant of one). */
const allFolders = computed(() =>
  buildSheetFolderSet({
    items: items.value,
    extraFolders,
    includeExtraFolders: isGm.value,
    folderRenames: folderRenames.value,
    deletedFolders,
  }),
)

// ---------------------------------------------------------------------------
// Folder navigation. The current folder lives in the URL as `?folder=foo/bar`
// so the browser back/forward buttons work and links can deep-link to a
// subfolder.
// ---------------------------------------------------------------------------

const route = useRoute()
const router = useRouter()

const currentPath = computed(() => folderPathFromQuery(route.query.folder))

const goToFolder = (path: string) => {
  router.push({ path: '/sheets', query: path ? { folder: path } : {} })
}

const breadcrumbs = computed(() => buildFolderBreadcrumbs(currentPath.value))

// ---------------------------------------------------------------------------
// Search and filtering
// ---------------------------------------------------------------------------

const searchTerm = ref('')

const matchesQuery = matchesSheetLibraryQuery

/** Sheets shown in the main grid. While searching, we flatten the entire
 *  subtree under the current folder; otherwise we show only sheets that live
 *  *directly* in the current folder. */
const visibleSheets = computed<SheetItem[]>(() => {
  const query = normalizeSearchText(searchTerm.value)
  const pool = items.value.filter((item) => isInsideFolder(item.folder, currentPath.value))
  const matched = query ? pool.filter((item) => matchesQuery(item, query)) : pool
  if (!query) {
    return matched
      .filter((item) => item.folder === currentPath.value)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  }
  return [...matched].sort((a, b) => a.sortKey.localeCompare(b.sortKey))
})

/** Folder tiles shown alongside the sheet cards — direct subfolders of
 *  ``currentPath``. Hidden during search to avoid noise. */
const visibleFolders = computed<FolderTile[]>(() => {
  if (searchTerm.value) return []
  return buildVisibleFolderTiles({
    folderPaths: allFolders.value,
    currentPath: currentPath.value,
    items: items.value,
  })
})

// Counts shown in the intro badge.
const totalCount = computed(() => items.value.length)
const filteredCount = computed(() => {
  const query = normalizeSearchText(searchTerm.value)
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

const canDrag = computed(() => import.meta.dev && isGm.value)

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
  if (!canDrag.value) return
  drag.value = { type: 'sheet', kind: item.kind, slug: item.slug, from: item.folder }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // Required for Firefox to actually start the drag.
    e.dataTransfer.setData('application/x-rotom-sheet', `${item.kind}:${item.slug}`)
  }
}

const onFolderDragStart = (e: DragEvent, path: string) => {
  if (!canDrag.value || !path) {
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

/** Drop validity check that takes an explicit payload, so it stays correct
 *  even after `drag.value` has been cleared (which `onDrop` does
 *  optimistically before awaiting the server). */
const canDropPayloadOn = (d: DragPayload, targetPath: string): boolean => {
  if (d.type === 'sheet') {
    return d.from !== targetPath
  }
  return canMoveFolderTo(d.path, targetPath, allFolders.value)
}

const canDropOn = (targetPath: string): boolean => {
  const d = drag.value
  return canDrag.value && d ? canDropPayloadOn(d, targetPath) : false
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
    const newPath = movedFolderPath(d.path, targetPath)
    await $fetch('/api/sheets/move-folder', {
      method: 'POST',
      body: { from: d.path, to: newPath },
    })
    folderRenames.value = [...folderRenames.value, { from: d.path, to: newPath }]
  }
}

const onDrop = async (e: DragEvent, targetPath: string) => {
  if (!canDrag.value) return
  e.preventDefault()
  e.stopPropagation()
  const d = drag.value
  // Validate against the captured payload before clearing `drag.value` —
  // `canDropOn` reads `drag.value` and would falsely reject otherwise.
  if (!d || !canDropPayloadOn(d, targetPath)) {
    drag.value = null
    hoverTarget.value = null
    return
  }
  drag.value = null
  hoverTarget.value = null

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
// New folder — single click creates `new_folder`, then `new_folder_1`, etc.
// (auto-named so the user can rename afterwards via the context menu).
// ---------------------------------------------------------------------------

const createError = ref<string | null>(null)
const creating = ref(false)

const sheetMenuOpen = ref(false)
const creatingSheet = ref(false)
const sheetCreateError = ref<string | null>(null)

const toggleSheetMenu = () => {
  if (!canDrag.value) return
  sheetMenuOpen.value = !sheetMenuOpen.value
}

const closeSheetMenu = () => {
  sheetMenuOpen.value = false
}

/** Create a fresh Pokémon or trainer sheet inside the current folder.
 *  We hard-navigate to the new sheet's edit page so Vite re-evaluates the
 *  `characterSheets` / `trainerSheets` globs with the new file in place — a
 *  client-side `router.push` would race the HMR and land on "Sheet not found". */
const createSheet = async (kind: 'pokemon' | 'trainer') => {
  if (!canDrag.value || creatingSheet.value) return
  closeSheetMenu()
  creatingSheet.value = true
  sheetCreateError.value = null
  try {
    const res = await $fetch<{ ok: true; kind: 'pokemon' | 'trainer'; slug: string }>(
      '/api/sheets/create',
      { method: 'POST', body: { kind, folder: currentPath.value } },
    )
    const dest = res.kind === 'pokemon'
      ? `/sheets/${res.slug}`
      : `/sheets/trainers/${res.slug}`
    window.location.href = dest
  } catch (err: any) {
    sheetCreateError.value = err?.statusMessage ?? err?.data?.statusMessage ?? err?.message ?? String(err)
    creatingSheet.value = false
  }
}

const nextFolderName = (): string => nextAvailableFolderLeaf(allFolders.value, currentPath.value)

const createNewFolder = async () => {
  if (!canDrag.value || creating.value) return
  const leaf = nextFolderName()
  const fullPath = currentPath.value ? `${currentPath.value}/${leaf}` : leaf
  creating.value = true
  createError.value = null
  try {
    await $fetch('/api/sheets/create-folder', {
      method: 'POST',
      body: { folder: fullPath },
    })
    extraFolders.add(fullPath)
  } catch (err: any) {
    createError.value = err?.statusMessage ?? err?.data?.statusMessage ?? err?.message ?? String(err)
  } finally {
    creating.value = false
  }
}

// ---------------------------------------------------------------------------
// Right-click context menu (Move / Rename / Delete)
// ---------------------------------------------------------------------------

type CtxTarget =
  | { type: 'sheet'; item: SheetItem }
  | { type: 'folder'; tile: FolderTile }

type CtxMode = 'menu' | 'rename' | 'move' | 'delete'

interface CtxState {
  x: number
  y: number
  target: CtxTarget
  mode: CtxMode
  input: string
  busy: boolean
  error: string | null
}

const ctx = ref<CtxState | null>(null)

const openContext = (e: MouseEvent, target: CtxTarget) => {
  if (!canDrag.value) return
  e.preventDefault()
  ctx.value = {
    x: e.clientX,
    y: e.clientY,
    target,
    mode: 'menu',
    input: '',
    busy: false,
    error: null,
  }
}

const closeContext = () => {
  ctx.value = null
}

const ctxTargetLabel = computed(() => {
  const c = ctx.value
  if (!c) return ''
  if (c.target.type === 'sheet') return displayName(c.target.item)
  return c.target.tile.label
})

/** Folder paths the user can pick as a Move destination. Excludes the
 *  selected folder itself, its descendants, and (for sheets) the current
 *  folder of the sheet. Always includes a “Home (root)” entry up top. */
const ctxMoveDestinations = computed<Array<{ value: string; label: string }>>(() => {
  const c = ctx.value
  if (!c) return []
  return buildFolderMoveDestinations({
    folderPaths: allFolders.value,
    target: c.target.type === 'sheet'
      ? { type: 'item', folder: c.target.item.folder }
      : { type: 'folder', path: c.target.tile.path },
  })
})

const enterMove = () => {
  if (!ctx.value) return
  ctx.value.mode = 'move'
  ctx.value.error = null
  ctx.value.input = ctxMoveDestinations.value[0]?.value ?? ''
}

const enterRename = () => {
  if (!ctx.value) return
  ctx.value.mode = 'rename'
  ctx.value.error = null
  if (ctx.value.target.type === 'sheet') {
    ctx.value.input = displayName(ctx.value.target.item)
  } else {
    const path = ctx.value.target.tile.path
    const slash = path.lastIndexOf('/')
    ctx.value.input = slash >= 0 ? path.slice(slash + 1) : path
  }
}

const enterDelete = () => {
  if (!ctx.value) return
  ctx.value.mode = 'delete'
  ctx.value.error = null
}

/** Apply a rename + the local override / rename log update. */
const applyRenameSheet = async (item: SheetItem, newName: string) => {
  await $fetch('/api/sheets/rename', {
    method: 'POST',
    body: { kind: item.kind, slug: item.slug, name: newName },
  })
  nameOverrides[`${item.kind}:${item.slug}`] = newName
}

const applyRenameFolder = async (oldPath: string, newLeaf: string) => {
  const slash = oldPath.lastIndexOf('/')
  const parent = slash >= 0 ? oldPath.slice(0, slash) : ''
  const newPath = parent ? `${parent}/${newLeaf}` : newLeaf
  if (newPath === oldPath) return
  await $fetch('/api/sheets/move-folder', {
    method: 'POST',
    body: { from: oldPath, to: newPath },
  })
  folderRenames.value = [...folderRenames.value, { from: oldPath, to: newPath }]
  // If we were inside the renamed folder, follow it.
  if (currentPath.value === oldPath || currentPath.value.startsWith(oldPath + '/')) {
    goToFolder(renameFolderPrefix(currentPath.value, oldPath, newPath))
  }
}

const submitContext = async () => {
  const c = ctx.value
  if (!c || c.busy) return
  c.busy = true
  c.error = null
  try {
    if (c.mode === 'move') {
      const dest = c.input
      if (c.target.type === 'sheet') {
        await performMove({ type: 'sheet', kind: c.target.item.kind, slug: c.target.item.slug, from: c.target.item.folder }, dest)
      } else {
        await performMove({ type: 'folder', path: c.target.tile.path }, dest)
      }
    } else if (c.mode === 'rename') {
      const value = c.input.trim()
      if (!value) {
        c.error = 'Name required.'
        return
      }
      if (c.target.type === 'sheet') {
        await applyRenameSheet(c.target.item, value)
      } else {
        await applyRenameFolder(c.target.tile.path, value)
      }
    } else if (c.mode === 'delete') {
      if (c.target.type === 'sheet') {
        await $fetch('/api/sheets/delete', {
          method: 'POST',
          body: { kind: c.target.item.kind, slug: c.target.item.slug },
        })
        deletedSheets.add(`${c.target.item.kind}:${c.target.item.slug}`)
      } else {
        const path = c.target.tile.path
        await $fetch('/api/sheets/delete-folder', {
          method: 'POST',
          body: { folder: path },
        })
        deletedFolders.add(path)
        // Mark contained sheets as deleted so they vanish from the UI immediately.
        for (const item of items.value) {
          if (item.folder === path || item.folder.startsWith(path + '/')) {
            deletedSheets.add(`${item.kind}:${item.slug}`)
          }
        }
        for (const f of [...extraFolders]) {
          if (f === path || f.startsWith(path + '/')) extraFolders.delete(f)
        }
        // If we're inside the deleted subtree, navigate to its parent.
        if (currentPath.value === path || currentPath.value.startsWith(path + '/')) {
          const slash = path.lastIndexOf('/')
          goToFolder(slash >= 0 ? path.slice(0, slash) : '')
        }
      }
    }
    closeContext()
  } catch (err: any) {
    c.error = err?.statusMessage ?? err?.data?.statusMessage ?? err?.message ?? String(err)
  } finally {
    if (ctx.value) ctx.value.busy = false
  }
}

// On mount (client only) seed extraFolders from on-disk dirs so empty
// folders persist across reloads.
onMounted(async () => {
  if (!canDrag.value) return
  try {
    const data = await $fetch<{ folders: string[] }>('/api/sheets/folders')
    for (const f of data.folders) extraFolders.add(f)
  } catch (err) {
    console.warn('[sheets] failed to load existing folders', err)
  }
  // Close the context menu / sheet menu on Escape (anywhere on the page).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeContext()
      closeSheetMenu()
    }
  })
})
</script>

<template>
  <div class="sheets-layout" :class="{ 'is-dragging': drag !== null }">
    <header class="sheets-header">
      <AppNavigation />

      <SheetLibraryIntroPanel
        v-model:search-term="searchTerm"
        :filtered-count="filteredCount"
        :total-count="totalCount"
        :can-drag="canDrag"
        :creating="creating"
        :creating-sheet="creatingSheet"
        :sheet-menu-open="sheetMenuOpen"
        :create-error="createError"
        :sheet-create-error="sheetCreateError"
        :move-error="moveError"
        @toggle-sheet-menu="toggleSheetMenu"
        @close-sheet-menu="closeSheetMenu"
        @create-sheet="createSheet"
        @create-folder="createNewFolder"
      />

      <FolderBreadcrumbNav
        :breadcrumbs="breadcrumbs"
        :current-path="currentPath"
        :hover-target="hoverTarget"
        :is-dragging="drag !== null"
        :can-drop-on="canDropOn"
        @navigate="goToFolder"
        @dragenter="onDropEnter"
        @dragover="onDropOver"
        @dragleave="onDropLeave"
        @drop="onDrop"
      />
    </header>

    <section class="sheet-section">
      <div v-if="hasAnything" class="sheets-grid">
        <FolderTileButton
          v-for="folder in visibleFolders"
          :key="`folder-${folder.path}`"
          :tile="folder"
          :hover-target="hoverTarget"
          :is-dragging="drag !== null"
          :draggable="canDrag"
          :is-dragging-self="isDraggingFolder(folder.path)"
          item-label-singular="item"
          :can-drop-on="canDropOn"
          @open="goToFolder"
          @contextmenu="(event, tile) => openContext(event, { type: 'folder', tile })"
          @dragstart="onFolderDragStart"
          @dragend="onDragEnd"
          @dragenter="onDropEnter"
          @dragover="onDropOver"
          @dragleave="onDropLeave"
          @drop="onDrop"
        />

        <template v-for="item in visibleSheets" :key="`${item.kind}:${item.slug}`">
          <NuxtLink
            v-if="item.kind === 'pokemon'"
            :to="`/sheets/${item.slug}`"
            class="sheet-card"
            :class="{ 'is-dragging-self': isDraggingSheet(item) }"
            :draggable="canDrag"
            @contextmenu="openContext($event, { type: 'sheet', item })"
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
                <li v-if="item.types.length" class="sheet-card__types">
                  <TypeBadge
                    v-for="type in item.types"
                    :key="`${item.slug}-${type}`"
                    :type="type"
                    size="xs"
                  />
                </li>
              </ul>
            </div>
          </NuxtLink>

          <NuxtLink
            v-else
            :to="`/sheets/trainers/${item.slug}`"
            class="sheet-card sheet-card--trainer"
            :class="{ 'is-dragging-self': isDraggingSheet(item) }"
            :draggable="canDrag"
            @contextmenu="openContext($event, { type: 'sheet', item })"
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
        <template v-if="canDrag">
          This folder is empty. Drag a sheet here from another folder or use
          <strong>+ New folder</strong> to add a subfolder.
        </template>
        <template v-else>
          No player-accessible sheets in this folder.
        </template>
      </p>
    </section>

    <LibraryContextMenu
      v-if="ctx"
      v-model:input="ctx.input"
      :x="ctx.x"
      :y="ctx.y"
      :target-kind="ctx.target.type === 'sheet' ? 'Sheet' : 'Folder'"
      :target-label="ctxTargetLabel"
      :is-folder-target="ctx.target.type === 'folder'"
      :mode="ctx.mode"
      :busy="ctx.busy"
      :error="ctx.error"
      :move-destinations="ctxMoveDestinations"
      delete-folder-suffix="and everything inside? This cannot be undone."
      delete-item-suffix="? The JSON file will be removed from disk."
      @close="closeContext"
      @enter-move="enterMove"
      @enter-rename="enterRename"
      @enter-delete="enterDelete"
      @submit="submitContext"
    />
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
  font-family: var(--font-book);
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

.sheet-card__meta .sheet-card__types {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.22rem;
  padding: 0;
  border: 0;
  background: transparent;
}

.empty-state {
  margin: 1.5rem 0;
  text-align: center;
  color: var(--ink-muted);
  font-style: italic;
}

</style>
