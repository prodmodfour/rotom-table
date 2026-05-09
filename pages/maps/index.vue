<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PhFolder,
  PhPlus,
  PhSquaresFour,
} from '@phosphor-icons/vue'
import { formatFolderLabel } from '~/utils/sheetFolders'
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
  type FolderTile,
} from '~/utils/folderBrowser'
import { getClientId } from '~/utils/clientId'
import {
  applyMapLibraryRealtimeEvent,
  deleteMapFolderFromLibrary,
  moveMapFolderInLibrary,
  tabletopMapToSummary,
} from '~/utils/mapLibrary'
import { useRealtimeChannel } from '~/composables/useRealtime'
import { mapsChannel } from '~/shared/realtime'
import type { MapSummary, TabletopMap } from '~/types/map'

useHead({ title: 'Maps · Rotom Table' })

const route = useRoute()
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
    const e = err as { statusMessage?: string; message?: string }
    loadError.value = e?.statusMessage ?? e?.message ?? String(err)
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

const allFolders = computed(() => {
  const set = new Set<string>()
  for (const item of items.value) if (item.folder) set.add(item.folder)
  for (const f of extraFolders) set.add(f)
  return set
})

const currentPath = computed(() => folderPathFromQuery(route.query.folder))

const goToFolder = (path: string) => {
  router.push({ path: '/maps', query: path ? { folder: path } : {} })
}

const breadcrumbs = computed(() =>
  buildFolderBreadcrumbs(currentPath.value, { formatSegment: formatFolderLabel }),
)

const searchTerm = ref('')

const matches = (item: MapSummary, query: string) =>
  [item.name, item.folder].some((value) => normalizeSearchText(value).includes(query))

const visibleMaps = computed(() => {
  const query = normalizeSearchText(searchTerm.value)
  const pool = items.value.filter((item) => isInsideFolder(item.folder, currentPath.value))
  const matched = query ? pool.filter((item) => matches(item, query)) : pool
  if (!query) {
    return matched
      .filter((item) => item.folder === currentPath.value)
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  return [...matched].sort((a, b) => a.name.localeCompare(b.name))
})

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

const drag = ref<DragPayload | null>(null)
const hoverTarget = ref<string | null>(null)

const onMapDragStart = (e: DragEvent, item: MapSummary) => {
  if (!isGm.value) {
    e.preventDefault()
    return
  }
  drag.value = { type: 'map', slug: item.slug, from: item.folder }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-rotom-map', item.slug)
  }
}

const onFolderDragStart = (e: DragEvent, path: string) => {
  if (!isGm.value || !path) {
    e.preventDefault()
    return
  }
  drag.value = { type: 'folder', path }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-rotom-map-folder', path)
  }
}

const onDragEnd = () => {
  drag.value = null
  hoverTarget.value = null
}

const canDropPayloadOn = (d: DragPayload, targetPath: string): boolean => {
  if (d.type === 'map') return d.from !== targetPath
  return canMoveFolderTo(d.path, targetPath, allFolders.value)
}

const canDropOn = (targetPath: string) =>
  isGm.value && drag.value ? canDropPayloadOn(drag.value, targetPath) : false

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
  if (!isGm.value) return
  e.preventDefault()
  e.stopPropagation()
  const d = drag.value
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
  } catch (err: unknown) {
    const e2 = err as { statusMessage?: string; message?: string }
    moveError.value = e2?.statusMessage ?? e2?.message ?? String(err)
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
    const e = err as { statusMessage?: string; message?: string }
    createError.value = e?.statusMessage ?? e?.message ?? String(err)
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
    const e = err as { statusMessage?: string; message?: string }
    createError.value = e?.statusMessage ?? e?.message ?? String(err)
  } finally {
    creating.value = false
  }
}

type CtxTarget = { type: 'map'; item: MapSummary } | { type: 'folder'; tile: FolderTile }
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
  if (!isGm.value) return
  e.preventDefault()
  ctx.value = { x: e.clientX, y: e.clientY, target, mode: 'menu', input: '', busy: false, error: null }
}

const closeContext = () => {
  ctx.value = null
}

const ctxTargetLabel = computed(() => {
  const c = ctx.value
  if (!c) return ''
  return c.target.type === 'map' ? c.target.item.name : c.target.tile.label
})

const ctxMoveDestinations = computed<Array<{ value: string; label: string }>>(() => {
  const c = ctx.value
  if (!c) return []
  return buildFolderMoveDestinations({
    folderPaths: allFolders.value,
    target: c.target.type === 'map'
      ? { type: 'item', folder: c.target.item.folder }
      : { type: 'folder', path: c.target.tile.path },
    formatLabel: formatFolderLabel,
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
  if (ctx.value.target.type === 'map') {
    ctx.value.input = ctx.value.target.item.name
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
    const e = err as { statusMessage?: string; message?: string }
    c.error = e?.statusMessage ?? e?.message ?? String(err)
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

      <section class="panel-card maps-intro">
        <div class="intro-heading">
          <h1>Tabletop Maps</h1>
          <span class="badge">{{ items.length }} map{{ items.length === 1 ? '' : 's' }}</span>
        </div>
        <p class="intro-copy">
          Saved tabletop layouts. Each map stores its own dimensions and the
          set of trainer / Pokémon tokens placed on it. Sheets are managed
          separately under <code>/sheets</code> — maps only reference them, so
          a token's HP, sprite, or class shows up live on every map that
          has it placed.
          <span v-if="isGm" class="drag-hint">
            Click a map to open it. Drag cards or folders to organise them.
            Right-click anything for Move / Rename / Delete. Multiple tabs and
            devices stay in sync as you edit.
          </span>
          <span v-else class="drag-hint">
            You are seeing only maps the GM has marked as player visible.
          </span>
        </p>

        <div class="intro-controls">
          <label class="search-field">
            <span class="sr-only">Search maps</span>
            <input v-model.trim="searchTerm" type="search" placeholder="Search map name…" />
          </label>

          <div v-if="isGm" class="folder-actions">
            <button
              type="button"
              class="action-btn"
              :disabled="creating"
              @click="createNewMap"
            >
              <PhPlus :size="16" weight="bold" /> New map
            </button>
            <button
              type="button"
              class="action-btn action-btn--secondary"
              :disabled="creating"
              @click="createNewFolder"
            >
              <PhFolder :size="16" weight="bold" /> New folder
            </button>
          </div>
        </div>

        <p v-if="loadError" class="move-error" role="alert">{{ loadError }}</p>
        <p v-if="createError" class="move-error" role="alert">{{ createError }}</p>
        <p v-if="moveError" class="move-error" role="alert">Move failed: {{ moveError }}</p>
      </section>

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

    <section class="map-section">
      <div v-if="hasAnything" class="maps-grid">
        <FolderTileButton
          v-for="folder in visibleFolders"
          :key="`folder-${folder.path}`"
          :tile="folder"
          :hover-target="hoverTarget"
          :is-dragging="drag !== null"
          :draggable="isGm"
          item-label-singular="map"
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

        <NuxtLink
          v-for="item in visibleMaps"
          :key="`map-${item.slug}`"
          :to="`/maps/${item.slug}`"
          class="map-card"
          :draggable="isGm"
          @contextmenu="openContext($event, { type: 'map', item })"
          @dragstart="onMapDragStart($event, item)"
          @dragend="onDragEnd"
        >
          <div class="map-card__icon">
            <PhSquaresFour :size="42" weight="duotone" aria-hidden="true" />
          </div>
          <div class="map-card__body">
            <h3>{{ item.name }}</h3>
            <p class="map-card__meta">
              {{ item.dimensions.x }} × {{ item.dimensions.y }} × {{ item.dimensions.z }}
              · {{ item.placementCount }} token{{ item.placementCount === 1 ? '' : 's' }}
            </p>
            <span v-if="isGm && item.playerVisible" class="map-card__badge">Player visible</span>
          </div>
        </NuxtLink>
      </div>

      <p v-else-if="loading" class="empty-state">Loading…</p>
      <p v-else-if="searchTerm" class="empty-state">Nothing matches that search.</p>
      <p v-else class="empty-state">
        <template v-if="isGm">
          No maps yet. Click <strong>+ New map</strong> to start a tabletop.
        </template>
        <template v-else>
          No player-visible maps yet.
        </template>
      </p>
    </section>

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
  font-family: var(--font-book);
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
  font-family: var(--font-mono);
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

input,
select {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.65rem 0.8rem;
  outline: none;
}

input:focus,
select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.folder-actions {
  display: flex;
  gap: 0.4rem;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--accent);
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
  padding: 0.55rem 0.85rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.action-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.action-btn--secondary {
  border-color: var(--rule);
  background: var(--paper-soft);
  color: var(--ink);
}

.action-btn--secondary:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: progress;
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

.map-section {
  display: flex;
  flex-direction: column;
}

.maps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.7rem;
}

.map-card {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  color: var(--ink);
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.map-card:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.map-card__icon {
  flex: 0 0 auto;
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  color: var(--accent);
}

.map-card__body {
  min-width: 0;
}

.map-card__body h3 {
  margin: 0 0 0.2rem;
  font-family: var(--font-book);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-card__meta {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.8rem;
  letter-spacing: 0.04em;
}

.map-card__badge {
  display: inline-flex;
  width: fit-content;
  margin-top: 0.45rem;
  border-radius: 999px;
  padding: 0.18rem 0.55rem;
  background: rgba(184, 187, 38, 0.12);
  color: var(--good);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
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
