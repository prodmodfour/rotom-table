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
  movedFolderPath,
  nextAvailableFolderLeaf,
  renameFolderPrefix,
  type FolderTile,
} from '~/utils/folderBrowser'
import {
  applySheetLibraryOverrides,
  buildSheetFolderSet,
  buildSheetLibraryItems,
  countFilteredSheetLibraryItems,
  displaySheetLibraryName,
  filterVisibleSheetLibraryItems,
  sheetLibraryKey,
  type SheetLibraryItem,
} from '~/utils/sheetLibrary'
import { useLibraryContextMenu } from '~/composables/library/useLibraryContextMenu'
import { useLibraryDragDrop } from '~/composables/library/useLibraryDragDrop'
import { getErrorMessage } from '~/utils/errorMessages'
import { sheetEditorPath } from '~/utils/sheetRoutes'

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

/** Sheets shown in the main grid. While searching, we flatten the entire
 *  subtree under the current folder; otherwise we show only sheets that live
 *  *directly* in the current folder. */
const visibleSheets = computed<SheetItem[]>(() => filterVisibleSheetLibraryItems({
  items: items.value,
  currentPath: currentPath.value,
  searchTerm: searchTerm.value,
}))

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
const filteredCount = computed(() => countFilteredSheetLibraryItems(items.value, searchTerm.value))

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

const moving = ref(false)
const moveError = ref<string | null>(null)

/** Drop validity check that takes an explicit payload, so it stays correct
 *  even after `drag.value` has been cleared (which `onDrop` does
 *  optimistically before awaiting the server). */
const canDropPayloadOn = (d: DragPayload, targetPath: string): boolean => {
  if (d.type === 'sheet') {
    return d.from !== targetPath
  }
  return canMoveFolderTo(d.path, targetPath, allFolders.value)
}

const {
  drag,
  hoverTarget,
  startDrag,
  canDropOn,
  onDragEnd,
  onDropEnter,
  onDropOver,
  onDropLeave,
  takeDropPayload,
} = useLibraryDragDrop<DragPayload>({
  canDrag,
  canDropPayloadOn,
})

const isDraggingSheet = (item: SheetItem): boolean =>
  drag.value?.type === 'sheet'
  && drag.value.kind === item.kind
  && drag.value.slug === item.slug

const isDraggingFolder = (path: string): boolean =>
  drag.value?.type === 'folder' && drag.value.path === path

const onSheetDragStart = (e: DragEvent, item: SheetItem) => {
  startDrag(e, { type: 'sheet', kind: item.kind, slug: item.slug, from: item.folder }, {
    mimeType: 'application/x-rotom-sheet',
    // Required for Firefox to actually start the drag.
    value: `${item.kind}:${item.slug}`,
  })
}

const onFolderDragStart = (e: DragEvent, path: string) => {
  if (!path) {
    e.preventDefault()
    return
  }
  startDrag(e, { type: 'folder', path }, {
    mimeType: 'application/x-rotom-folder',
    value: path,
  })
}

const performMove = async (d: DragPayload, targetPath: string) => {
  if (d.type === 'sheet') {
    await $fetch('/api/sheets/move', {
      method: 'POST',
      body: { kind: d.kind, slug: d.slug, folder: targetPath },
    })
    sheetOverrides[sheetLibraryKey(d.kind, d.slug)] = targetPath
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
  const d = takeDropPayload(e, targetPath)
  if (!d) return

  moving.value = true
  moveError.value = null
  try {
    await performMove(d, targetPath)
  } catch (err: unknown) {
    moveError.value = getErrorMessage(err)
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
    window.location.href = sheetEditorPath(res.kind, res.slug)
  } catch (err: unknown) {
    sheetCreateError.value = getErrorMessage(err)
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
  } catch (err: unknown) {
    createError.value = getErrorMessage(err)
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

const {
  ctx,
  openContext,
  closeContext,
  ctxTargetLabel,
  ctxMoveDestinations,
  enterMove,
  enterRename,
  enterDelete,
} = useLibraryContextMenu<CtxTarget>({
  canOpen: canDrag,
  targetLabel: (target) => target.type === 'sheet' ? displayName(target.item) : target.tile.label,
  renameInputForTarget: (target) => {
    if (target.type === 'sheet') return displayName(target.item)
    const path = target.tile.path
    const slash = path.lastIndexOf('/')
    return slash >= 0 ? path.slice(slash + 1) : path
  },
  moveDestinationsForTarget: (target) => buildFolderMoveDestinations({
    folderPaths: allFolders.value,
    target: target.type === 'sheet'
      ? { type: 'item', folder: target.item.folder }
      : { type: 'folder', path: target.tile.path },
  }),
})

/** Apply a rename + the local override / rename log update. */
const applyRenameSheet = async (item: SheetItem, newName: string) => {
  await $fetch('/api/sheets/rename', {
    method: 'POST',
    body: { kind: item.kind, slug: item.slug, name: newName },
  })
  nameOverrides[sheetLibraryKey(item.kind, item.slug)] = newName
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
        deletedSheets.add(sheetLibraryKey(c.target.item.kind, c.target.item.slug))
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
            deletedSheets.add(sheetLibraryKey(item.kind, item.slug))
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
  } catch (err: unknown) {
    c.error = getErrorMessage(err)
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

    <SheetLibraryGrid
      :folders="visibleFolders"
      :sheets="visibleSheets"
      :has-anything="hasAnything"
      :hover-target="hoverTarget"
      :is-dragging="drag !== null"
      :can-drag="canDrag"
      :search-term="searchTerm"
      :can-drop-on="canDropOn"
      :is-dragging-folder="isDraggingFolder"
      :is-dragging-sheet="isDraggingSheet"
      @open-folder="goToFolder"
      @folder-context="(event, tile) => openContext(event, { type: 'folder', tile })"
      @folder-drag-start="onFolderDragStart"
      @drag-end="onDragEnd"
      @dragenter="onDropEnter"
      @dragover="onDropOver"
      @dragleave="onDropLeave"
      @drop="onDrop"
      @sheet-context="(event, item) => openContext(event, { type: 'sheet', item })"
      @sheet-drag-start="onSheetDragStart"
    />

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

</style>
