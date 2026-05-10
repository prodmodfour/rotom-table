<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppNavigation from '~/components/AppNavigation.vue'
import FolderBreadcrumbNav from '~/components/library/FolderBreadcrumbNav.vue'
import LibraryContextMenu from '~/components/library/LibraryContextMenu.vue'
import LibraryPageLayout from '~/components/library/LibraryPageLayout.vue'
import MapLibraryGrid from '~/components/library/MapLibraryGrid.vue'
import MapLibraryIntroPanel from '~/components/library/MapLibraryIntroPanel.vue'
import { formatFolderLabel } from '~/utils/sheetFolders'
import {
  buildFolderMoveDestinations,
  buildVisibleFolderTiles,
  canMoveFolderTo,
  folderLeafName,
  isSameOrDescendantFolder,
  joinFolderPath,
  movedFolderPath,
  parentFolderPath,
  renameFolderPrefix,
  type FolderTile,
} from '~/utils/folderBrowser'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  applyMapLibraryRealtimeEvent,
  deleteMapFolderFromLibrary,
  moveMapFolderInLibrary,
  buildMapFolderSet,
  filterVisibleMaps,
  tabletopMapToSummary,
} from '~/utils/mapLibrary'
import { useRealtimeChannel } from '~/composables/useRealtime'
import { useLibraryContextMenu } from '~/composables/library/useLibraryContextMenu'
import { useLibraryDragDrop } from '~/composables/library/useLibraryDragDrop'
import { useLibraryFolderCreation } from '~/composables/library/useLibraryFolderCreation'
import { useLibraryFolderNavigation } from '~/composables/library/useLibraryFolderNavigation'
import { useWindowKeydown } from '~/composables/useWindowKeydown'
import { isEscapeKey } from '~/utils/keyboardShortcuts'
import { mapEditorPath, mapLibraryPath } from '~/utils/mapRoutes'
import { mapsChannel } from '~/shared/realtime'
import type { MapSummary, TabletopMap } from '~/types/map'

useHead({ title: 'Maps · Rotom Table' })

const router = useRouter()
const clientId = getClientId()
const { isGm, isPlayer } = useAuth()

const maps = reactive<Map<string, MapSummary>>(new Map())
const extraFolders = reactive(new Set<string>())
const loading = ref(true)
const loadError = ref<string | null>(null)
const moveError = ref<string | null>(null)
const moving = ref(false)

const refresh = async () => {
  loading.value = true
  loadError.value = null
  try {
    const [list, folders] = await Promise.all([
      $fetch<{ maps: MapSummary[] }>('/api/maps/list'),
      $fetch<{ folders: string[] }>('/api/maps/folders'),
    ])
    maps.clear()
    for (const summary of list.maps) maps.set(summary.slug, summary)
    extraFolders.clear()
    for (const folder of folders.folders) extraFolders.add(folder)
  } catch (err: unknown) {
    loadError.value = getErrorMessage(err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
})

useRealtimeChannel(mapsChannel, (event) => {
  applyMapLibraryRealtimeEvent({ maps, extraFolders }, event, clientId)
})

const items = computed(() => {
  const all = Array.from(maps.values())
  return isPlayer.value ? all.filter((map) => map.playerVisible === true) : all
})

const allFolders = computed(() => buildMapFolderSet(items.value, extraFolders))

const { currentPath, goToFolder, breadcrumbs } = useLibraryFolderNavigation({
  routePath: mapLibraryPath(),
  formatSegment: formatFolderLabel,
})

const { creating, createError, createNewFolder } = useLibraryFolderCreation({
  canCreate: isGm,
  currentPath,
  folderPaths: allFolders,
  createFolder: (folder) => $fetch('/api/maps/create-folder', {
    method: 'POST',
    body: { folder, clientId },
  }),
  onCreated: (folder) => extraFolders.add(folder),
})

const searchTerm = ref('')

const visibleMaps = computed(() => filterVisibleMaps({
  items: items.value,
  currentPath: currentPath.value,
  searchTerm: searchTerm.value,
}))

const visibleFolders = computed<FolderTile[]>(() => {
  if (searchTerm.value) return []
  return buildVisibleFolderTiles({
    folderPaths: allFolders.value,
    currentPath: currentPath.value,
    items: items.value,
    formatLabel: formatFolderLabel,
  })
})

const hasAnything = computed(
  () => visibleMaps.value.length > 0 || visibleFolders.value.length > 0,
)

interface DragMap {
  type: 'map'
  slug: string
  from: string
}
interface DragFolder {
  type: 'folder'
  path: string
}
type DragPayload = DragMap | DragFolder

const canDropPayloadOn = (d: DragPayload, targetPath: string): boolean => {
  if (d.type === 'map') return d.from !== targetPath
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
  canDrag: isGm,
  canDropPayloadOn,
})

const onMapDragStart = (e: DragEvent, item: MapSummary) => {
  startDrag(e, { type: 'map', slug: item.slug, from: item.folder }, {
    mimeType: 'application/x-rotom-map',
    value: item.slug,
  })
}

const onFolderDragStart = (e: DragEvent, path: string) => {
  if (!path) {
    e.preventDefault()
    return
  }
  startDrag(e, { type: 'folder', path }, {
    mimeType: 'application/x-rotom-map-folder',
    value: path,
  })
}

const performMove = async (d: DragPayload, targetPath: string) => {
  if (d.type === 'map') {
    await $fetch('/api/maps/move', {
      method: 'POST',
      body: { slug: d.slug, folder: targetPath, clientId },
    })
    const existing = maps.get(d.slug)
    if (existing) maps.set(d.slug, { ...existing, folder: targetPath })
  } else {
    const newPath = movedFolderPath(d.path, targetPath)
    await $fetch('/api/maps/move-folder', {
      method: 'POST',
      body: { from: d.path, to: newPath, clientId },
    })
    moveMapFolderInLibrary({ maps, extraFolders }, d.path, newPath)
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
  } finally {
    moving.value = false
  }
}

const createNewMap = async () => {
  if (!isGm.value || creating.value) return
  creating.value = true
  createError.value = null
  try {
    const result = await $fetch<{ map: TabletopMap }>('/api/maps/create', {
      method: 'POST',
      body: { folder: currentPath.value, clientId },
    })
    maps.set(result.map.slug, tabletopMapToSummary(result.map))
    router.push(mapEditorPath(result.map.slug))
  } catch (err: unknown) {
    createError.value = getErrorMessage(err)
  } finally {
    creating.value = false
  }
}

type CtxTarget = { type: 'map'; item: MapSummary } | { type: 'folder'; tile: FolderTile }

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
  canOpen: isGm,
  targetLabel: (target) => target.type === 'map' ? target.item.name : target.tile.label,
  renameInputForTarget: (target) => {
    if (target.type === 'map') return target.item.name
    return folderLeafName(target.tile.path)
  },
  moveDestinationsForTarget: (target) => buildFolderMoveDestinations({
    folderPaths: allFolders.value,
    target: target.type === 'map'
      ? { type: 'item', folder: target.item.folder }
      : { type: 'folder', path: target.tile.path },
    formatLabel: formatFolderLabel,
  }),
})

const submitContext = async () => {
  const c = ctx.value
  if (!c || c.busy) return
  c.busy = true
  c.error = null
  try {
    if (c.mode === 'move') {
      if (c.target.type === 'map') {
        await performMove({ type: 'map', slug: c.target.item.slug, from: c.target.item.folder }, c.input)
      } else {
        await performMove({ type: 'folder', path: c.target.tile.path }, c.input)
      }
    } else if (c.mode === 'rename') {
      const value = c.input.trim()
      if (!value) {
        c.error = 'Name required.'
        return
      }
      if (c.target.type === 'map') {
        const result = await $fetch<{ slug: string; name: string }>('/api/maps/rename', {
          method: 'POST',
          body: { slug: c.target.item.slug, name: value, clientId },
        })
        const existing = maps.get(c.target.item.slug)
        if (existing) {
          if (result.slug === existing.slug) {
            maps.set(existing.slug, { ...existing, name: result.name })
          } else {
            maps.delete(existing.slug)
            maps.set(result.slug, { ...existing, slug: result.slug, name: result.name })
          }
        }
      } else {
        const oldPath = c.target.tile.path
        const parent = parentFolderPath(oldPath)
        const newPath = joinFolderPath(parent, value)
        if (newPath !== oldPath) {
          await $fetch('/api/maps/move-folder', {
            method: 'POST',
            body: { from: oldPath, to: newPath, clientId },
          })
          await refresh()
          if (isSameOrDescendantFolder(currentPath.value, oldPath)) {
            goToFolder(renameFolderPrefix(currentPath.value, oldPath, newPath))
          }
        }
      }
    } else if (c.mode === 'delete') {
      if (c.target.type === 'map') {
        await $fetch('/api/maps/delete', {
          method: 'POST',
          body: { slug: c.target.item.slug, clientId },
        })
        maps.delete(c.target.item.slug)
      } else {
        const path = c.target.tile.path
        await $fetch('/api/maps/delete-folder', {
          method: 'POST',
          body: { folder: path, clientId },
        })
        deleteMapFolderFromLibrary({ maps, extraFolders }, path)
        if (isSameOrDescendantFolder(currentPath.value, path)) {
          goToFolder(parentFolderPath(path))
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

useWindowKeydown((event) => {
  if (isEscapeKey(event)) closeContext()
})
</script>

<template>
  <LibraryPageLayout :dragging="drag !== null">
    <template #header>
      <AppNavigation />

      <MapLibraryIntroPanel
        v-model:search-term="searchTerm"
        :map-count="items.length"
        :is-gm="isGm"
        :creating="creating"
        :load-error="loadError"
        :create-error="createError"
        :move-error="moveError"
        @create-map="createNewMap"
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
    </template>

    <MapLibraryGrid
      :folders="visibleFolders"
      :maps="visibleMaps"
      :has-anything="hasAnything"
      :hover-target="hoverTarget"
      :is-dragging="drag !== null"
      :is-gm="isGm"
      :loading="loading"
      :search-term="searchTerm"
      :can-drop-on="canDropOn"
      @open-folder="goToFolder"
      @folder-context="(event, tile) => openContext(event, { type: 'folder', tile })"
      @folder-drag-start="onFolderDragStart"
      @drag-end="onDragEnd"
      @dragenter="onDropEnter"
      @dragover="onDropOver"
      @dragleave="onDropLeave"
      @drop="onDrop"
      @map-context="(event, item) => openContext(event, { type: 'map', item })"
      @map-drag-start="onMapDragStart"
    />

    <LibraryContextMenu
      v-if="ctx"
      v-model:input="ctx.input"
      :x="ctx.x"
      :y="ctx.y"
      :target-kind="ctx.target.type === 'map' ? 'Map' : 'Folder'"
      :target-label="ctxTargetLabel"
      :is-folder-target="ctx.target.type === 'folder'"
      :mode="ctx.mode"
      :busy="ctx.busy"
      :error="ctx.error"
      :move-destinations="ctxMoveDestinations"
      delete-folder-suffix="and every map inside? This cannot be undone."
      delete-item-suffix="? The JSON file will be removed from disk."
      @close="closeContext"
      @enter-move="enterMove"
      @enter-rename="enterRename"
      @enter-delete="enterDelete"
      @submit="submitContext"
    />
  </LibraryPageLayout>
</template>
