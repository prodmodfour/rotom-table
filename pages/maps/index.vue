<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { formatFolderLabel } from '~/utils/sheetFolders'
import {
  buildFolderMoveDestinations,
  buildVisibleFolderTiles,
  canMoveFolderTo,
  movedFolderPath,
  nextAvailableFolderLeaf,
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
import { useLibraryFolderNavigation } from '~/composables/library/useLibraryFolderNavigation'
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
const creating = ref(false)
const createError = ref<string | null>(null)

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
  routePath: '/maps',
  formatSegment: formatFolderLabel,
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

const nextFolderName = () => nextAvailableFolderLeaf(allFolders.value, currentPath.value)

const createNewFolder = async () => {
  if (!isGm.value || creating.value) return
  const leaf = nextFolderName()
  const fullPath = currentPath.value ? `${currentPath.value}/${leaf}` : leaf
  creating.value = true
  createError.value = null
  try {
    await $fetch('/api/maps/create-folder', {
      method: 'POST',
      body: { folder: fullPath, clientId },
    })
    extraFolders.add(fullPath)
  } catch (err: unknown) {
    createError.value = getErrorMessage(err)
  } finally {
    creating.value = false
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
    router.push(`/maps/${result.map.slug}`)
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
    const path = target.tile.path
    const slash = path.lastIndexOf('/')
    return slash >= 0 ? path.slice(slash + 1) : path
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
        const slash = oldPath.lastIndexOf('/')
        const parent = slash >= 0 ? oldPath.slice(0, slash) : ''
        const newPath = parent ? `${parent}/${value}` : value
        if (newPath !== oldPath) {
          await $fetch('/api/maps/move-folder', {
            method: 'POST',
            body: { from: oldPath, to: newPath, clientId },
          })
          await refresh()
          if (currentPath.value === oldPath || currentPath.value.startsWith(oldPath + '/')) {
            goToFolder(newPath + currentPath.value.slice(oldPath.length))
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

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeContext()
  })
}
</script>

<template>
  <div class="maps-layout" :class="{ 'is-dragging': drag !== null }">
    <header class="maps-header">
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
    </header>

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
  </div>
</template>

<style scoped>
.maps-layout {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
}

.maps-header {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

</style>
