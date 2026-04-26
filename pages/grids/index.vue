<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PhArrowsOutCardinal,
  PhCaretRight,
  PhFolder,
  PhFolderOpen,
  PhHouse,
  PhPencilSimple,
  PhPlus,
  PhSquaresFour,
  PhTrash,
} from '@phosphor-icons/vue'
import { formatFolderLabel } from '~/utils/sheetFolders'
import { getClientId } from '~/utils/clientId'
import { useRealtimeChannel } from '~/composables/useRealtime'
import type { Grid, GridSummary } from '~/types/grid'

useHead({ title: 'Tabletop · Rotom Table' })

const route = useRoute()
const router = useRouter()
const clientId = getClientId()

const grids = reactive<Map<string, GridSummary>>(new Map())
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
      $fetch<{ grids: GridSummary[] }>('/api/grids/list'),
      $fetch<{ folders: string[] }>('/api/grids/folders'),
    ])
    grids.clear()
    for (const summary of list.grids) grids.set(summary.slug, summary)
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

useRealtimeChannel('grids', (event) => {
  if (event.clientId === clientId) return
  if (event.type === 'created' || event.type === 'updated' || event.type === 'moved') {
    const summary = event.data as GridSummary
    if (summary?.slug) grids.set(summary.slug, summary)
  } else if (event.type === 'renamed') {
    const payload = event.data as { oldSlug?: string; summary?: GridSummary } | undefined
    if (!payload?.oldSlug || !payload?.summary) return
    grids.delete(payload.oldSlug)
    grids.set(payload.summary.slug, payload.summary)
  } else if (event.type === 'deleted') {
    const payload = event.data as { slug?: string } | undefined
    if (payload?.slug) grids.delete(payload.slug)
  } else if (event.type === 'folder-created') {
    const payload = event.data as { folder?: string } | undefined
    if (payload?.folder) extraFolders.add(payload.folder)
  } else if (event.type === 'folder-deleted') {
    const payload = event.data as { folder?: string } | undefined
    if (!payload?.folder) return
    extraFolders.delete(payload.folder)
    for (const f of [...extraFolders]) {
      if (f.startsWith(payload.folder + '/')) extraFolders.delete(f)
    }
    for (const [slug, g] of grids) {
      if (g.folder === payload.folder || g.folder.startsWith(payload.folder + '/')) {
        grids.delete(slug)
      }
    }
  } else if (event.type === 'folder-moved') {
    const payload = event.data as { from?: string; to?: string } | undefined
    if (!payload?.from || !payload?.to) return
    const renamePath = (path: string) => {
      if (path === payload.from) return payload.to!
      if (path.startsWith(payload.from + '/')) return payload.to + path.slice(payload.from!.length)
      return path
    }
    const next = new Set<string>()
    for (const f of extraFolders) next.add(renamePath(f))
    extraFolders.clear()
    for (const f of next) extraFolders.add(f)
    for (const [slug, g] of grids) {
      grids.set(slug, { ...g, folder: renamePath(g.folder) })
    }
  }
})

const items = computed(() => Array.from(grids.values()))

const allFolders = computed(() => {
  const set = new Set<string>()
  for (const item of items.value) if (item.folder) set.add(item.folder)
  for (const f of extraFolders) set.add(f)
  return set
})

const currentPath = computed(() => {
  const raw = route.query.folder
  if (typeof raw !== 'string') return ''
  return raw.replace(/^\/+|\/+$/g, '')
})

const goToFolder = (path: string) => {
  router.push({ path: '/grids', query: path ? { folder: path } : {} })
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

const searchTerm = ref('')
const normalize = (value: string) => value.trim().toLowerCase()

const matches = (item: GridSummary, query: string) =>
  [item.name, item.folder].some((value) => normalize(value).includes(query))

const isInsideCurrent = (folder: string) => {
  if (!currentPath.value) return true
  return folder === currentPath.value || folder.startsWith(currentPath.value + '/')
}

const visibleGrids = computed(() => {
  const query = normalize(searchTerm.value)
  const pool = items.value.filter((item) => isInsideCurrent(item.folder))
  const matched = query ? pool.filter((item) => matches(item, query)) : pool
  if (!query) {
    return matched
      .filter((item) => item.folder === currentPath.value)
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  return [...matched].sort((a, b) => a.name.localeCompare(b.name))
})

interface FolderTile {
  path: string
  label: string
  count: number
}

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

const hasAnything = computed(
  () => visibleGrids.value.length > 0 || visibleFolders.value.length > 0,
)

interface DragGrid {
  type: 'grid'
  slug: string
  from: string
}
interface DragFolder {
  type: 'folder'
  path: string
}
type DragPayload = DragGrid | DragFolder

const drag = ref<DragPayload | null>(null)
const hoverTarget = ref<string | null>(null)

const onGridDragStart = (e: DragEvent, item: GridSummary) => {
  drag.value = { type: 'grid', slug: item.slug, from: item.folder }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-rotom-grid', item.slug)
  }
}

const onFolderDragStart = (e: DragEvent, path: string) => {
  if (!path) {
    e.preventDefault()
    return
  }
  drag.value = { type: 'folder', path }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-rotom-grid-folder', path)
  }
}

const onDragEnd = () => {
  drag.value = null
  hoverTarget.value = null
}

const canDropPayloadOn = (d: DragPayload, targetPath: string): boolean => {
  if (d.type === 'grid') return d.from !== targetPath
  if (d.path === targetPath) return false
  if (targetPath === d.path || targetPath.startsWith(d.path + '/')) return false
  const leaf = d.path.split('/').pop()!
  const newPath = targetPath ? `${targetPath}/${leaf}` : leaf
  if (newPath === d.path) return false
  if (allFolders.value.has(newPath)) return false
  return true
}

const canDropOn = (targetPath: string) =>
  drag.value ? canDropPayloadOn(drag.value, targetPath) : false

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
  if (d.type === 'grid') {
    await $fetch('/api/grids/move', {
      method: 'POST',
      body: { slug: d.slug, folder: targetPath, clientId },
    })
    const existing = grids.get(d.slug)
    if (existing) grids.set(d.slug, { ...existing, folder: targetPath })
  } else {
    const leaf = d.path.split('/').pop()!
    const newPath = targetPath ? `${targetPath}/${leaf}` : leaf
    await $fetch('/api/grids/move-folder', {
      method: 'POST',
      body: { from: d.path, to: newPath, clientId },
    })
    const renamePath = (path: string) =>
      path === d.path
        ? newPath
        : path.startsWith(d.path + '/')
          ? newPath + path.slice(d.path.length)
          : path
    const nextFolders = new Set<string>()
    for (const f of extraFolders) nextFolders.add(renamePath(f))
    extraFolders.clear()
    for (const f of nextFolders) extraFolders.add(f)
    for (const [slug, g] of grids) {
      grids.set(slug, { ...g, folder: renamePath(g.folder) })
    }
  }
}

const onDrop = async (e: DragEvent, targetPath: string) => {
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

const nextFolderName = () => {
  const base = 'new_folder'
  const prefix = currentPath.value ? `${currentPath.value}/` : ''
  const exists = (name: string) => allFolders.value.has(prefix + name)
  if (!exists(base)) return base
  let n = 1
  while (exists(`${base}_${n}`)) n++
  return `${base}_${n}`
}

const createNewFolder = async () => {
  if (creating.value) return
  const leaf = nextFolderName()
  const fullPath = currentPath.value ? `${currentPath.value}/${leaf}` : leaf
  creating.value = true
  createError.value = null
  try {
    await $fetch('/api/grids/create-folder', {
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

const createNewGrid = async () => {
  if (creating.value) return
  creating.value = true
  createError.value = null
  try {
    const result = await $fetch<{ grid: Grid }>('/api/grids/create', {
      method: 'POST',
      body: { folder: currentPath.value, clientId },
    })
    grids.set(result.grid.slug, {
      slug: result.grid.slug,
      name: result.grid.name,
      folder: result.grid.folder ?? '',
      dimensions: result.grid.dimensions,
      placementCount: 0,
      updatedAt: result.grid.updatedAt,
    })
    router.push(`/grids/${result.grid.slug}`)
  } catch (err: unknown) {
    const e = err as { statusMessage?: string; message?: string }
    createError.value = e?.statusMessage ?? e?.message ?? String(err)
  } finally {
    creating.value = false
  }
}

type CtxTarget = { type: 'grid'; item: GridSummary } | { type: 'folder'; tile: FolderTile }
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
const ctxInput = ref<HTMLInputElement | HTMLSelectElement | null>(null)

const openContext = (e: MouseEvent, target: CtxTarget) => {
  e.preventDefault()
  ctx.value = { x: e.clientX, y: e.clientY, target, mode: 'menu', input: '', busy: false, error: null }
}

const closeContext = () => {
  ctx.value = null
}

const ctxTargetLabel = computed(() => {
  const c = ctx.value
  if (!c) return ''
  return c.target.type === 'grid' ? c.target.item.name : c.target.tile.label
})

const ctxMoveDestinations = computed<Array<{ value: string; label: string }>>(() => {
  const c = ctx.value
  if (!c) return []
  const dests: Array<{ value: string; label: string }> = []
  const candidates = ['', ...Array.from(allFolders.value).sort((a, b) => a.localeCompare(b))]
  for (const path of candidates) {
    if (c.target.type === 'grid') {
      if (path === c.target.item.folder) continue
    } else {
      const selfPath = c.target.tile.path
      if (path === selfPath) continue
      if (path.startsWith(selfPath + '/')) continue
      const slash = selfPath.lastIndexOf('/')
      const parent = slash >= 0 ? selfPath.slice(0, slash) : ''
      if (path === parent) continue
    }
    dests.push({ value: path, label: path ? formatFolderLabel(path) : 'Home (root)' })
  }
  return dests
})

const enterMove = async () => {
  if (!ctx.value) return
  ctx.value.mode = 'move'
  ctx.value.error = null
  ctx.value.input = ctxMoveDestinations.value[0]?.value ?? ''
  await nextTick()
  ctxInput.value?.focus()
}

const enterRename = async () => {
  if (!ctx.value) return
  ctx.value.mode = 'rename'
  ctx.value.error = null
  if (ctx.value.target.type === 'grid') {
    ctx.value.input = ctx.value.target.item.name
  } else {
    const path = ctx.value.target.tile.path
    const slash = path.lastIndexOf('/')
    ctx.value.input = slash >= 0 ? path.slice(slash + 1) : path
  }
  await nextTick()
  ctxInput.value?.focus()
  if (ctxInput.value && 'select' in ctxInput.value) (ctxInput.value as HTMLInputElement).select()
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
      if (c.target.type === 'grid') {
        await performMove({ type: 'grid', slug: c.target.item.slug, from: c.target.item.folder }, c.input)
      } else {
        await performMove({ type: 'folder', path: c.target.tile.path }, c.input)
      }
    } else if (c.mode === 'rename') {
      const value = c.input.trim()
      if (!value) {
        c.error = 'Name required.'
        return
      }
      if (c.target.type === 'grid') {
        const result = await $fetch<{ slug: string; name: string }>('/api/grids/rename', {
          method: 'POST',
          body: { slug: c.target.item.slug, name: value, clientId },
        })
        const existing = grids.get(c.target.item.slug)
        if (existing) {
          if (result.slug === existing.slug) {
            grids.set(existing.slug, { ...existing, name: result.name })
          } else {
            grids.delete(existing.slug)
            grids.set(result.slug, { ...existing, slug: result.slug, name: result.name })
          }
        }
      } else {
        const oldPath = c.target.tile.path
        const slash = oldPath.lastIndexOf('/')
        const parent = slash >= 0 ? oldPath.slice(0, slash) : ''
        const newPath = parent ? `${parent}/${value}` : value
        if (newPath !== oldPath) {
          await $fetch('/api/grids/move-folder', {
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
      if (c.target.type === 'grid') {
        await $fetch('/api/grids/delete', {
          method: 'POST',
          body: { slug: c.target.item.slug, clientId },
        })
        grids.delete(c.target.item.slug)
      } else {
        const path = c.target.tile.path
        await $fetch('/api/grids/delete-folder', {
          method: 'POST',
          body: { folder: path, clientId },
        })
        extraFolders.delete(path)
        for (const f of [...extraFolders]) {
          if (f.startsWith(path + '/')) extraFolders.delete(f)
        }
        for (const [slug, g] of grids) {
          if (g.folder === path || g.folder.startsWith(path + '/')) grids.delete(slug)
        }
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
  <div class="grids-layout" :class="{ 'is-dragging': drag !== null }">
    <header class="grids-header">
      <AppNavigation />

      <section class="panel-card grids-intro">
        <div class="intro-heading">
          <h1>Tabletop Grids</h1>
          <span class="badge">{{ items.length }} grid{{ items.length === 1 ? '' : 's' }}</span>
        </div>
        <p class="intro-copy">
          Saved tabletop layouts. Each grid stores its own dimensions and the
          set of trainer / Pokémon tokens placed on it. Sheets are managed
          separately under <code>/sheets</code> — grids only reference them, so
          a token's HP, sprite, or class shows up live on every grid that
          has it placed.
          <span class="drag-hint">
            Click a grid to open it. Drag cards or folders to organise them.
            Right-click anything for Move / Rename / Delete. Multiple tabs and
            devices stay in sync as you edit.
          </span>
        </p>

        <div class="intro-controls">
          <label class="search-field">
            <span class="sr-only">Search grids</span>
            <input v-model.trim="searchTerm" type="search" placeholder="Search grid name…" />
          </label>

          <div class="folder-actions">
            <button
              type="button"
              class="action-btn"
              :disabled="creating"
              @click="createNewGrid"
            >
              <PhPlus :size="16" weight="bold" /> New grid
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

    <section class="grid-section">
      <div v-if="hasAnything" class="grids-grid">
        <button
          v-for="folder in visibleFolders"
          :key="`folder-${folder.path}`"
          type="button"
          class="folder-tile"
          :class="{
            'drop-target': hoverTarget === folder.path,
            'drop-disabled': drag !== null && !canDropOn(folder.path),
          }"
          draggable="true"
          @click="goToFolder(folder.path)"
          @contextmenu="openContext($event, { type: 'folder', tile: folder })"
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
            <span class="folder-tile__meta">
              {{ folder.count }} grid{{ folder.count === 1 ? '' : 's' }}
            </span>
          </div>
        </button>

        <NuxtLink
          v-for="item in visibleGrids"
          :key="`grid-${item.slug}`"
          :to="`/grids/${item.slug}`"
          class="grid-card"
          draggable="true"
          @contextmenu="openContext($event, { type: 'grid', item })"
          @dragstart="onGridDragStart($event, item)"
          @dragend="onDragEnd"
        >
          <div class="grid-card__icon">
            <PhSquaresFour :size="42" weight="duotone" aria-hidden="true" />
          </div>
          <div class="grid-card__body">
            <h3>{{ item.name }}</h3>
            <p class="grid-card__meta">
              {{ item.dimensions.x }} × {{ item.dimensions.y }} × {{ item.dimensions.z }}
              · {{ item.placementCount }} token{{ item.placementCount === 1 ? '' : 's' }}
            </p>
          </div>
        </NuxtLink>
      </div>

      <p v-else-if="loading" class="empty-state">Loading…</p>
      <p v-else-if="searchTerm" class="empty-state">Nothing matches that search.</p>
      <p v-else class="empty-state">
        No grids yet. Click <strong>+ New grid</strong> to start a tabletop.
      </p>
    </section>

    <template v-if="ctx">
      <div class="ctx-backdrop" @click="closeContext" @contextmenu.prevent="closeContext"></div>
      <div
        class="ctx-menu"
        role="menu"
        :style="{ left: `${ctx.x}px`, top: `${ctx.y}px` }"
        @click.stop
        @contextmenu.prevent
      >
        <header class="ctx-header">
          <span class="ctx-kind">{{ ctx.target.type === 'grid' ? 'Grid' : 'Folder' }}</span>
          <span class="ctx-target">{{ ctxTargetLabel }}</span>
        </header>

        <template v-if="ctx.mode === 'menu'">
          <button type="button" class="ctx-item" role="menuitem" @click="enterMove">
            <PhArrowsOutCardinal :size="16" weight="bold" />
            <span>Move…</span>
          </button>
          <button type="button" class="ctx-item" role="menuitem" @click="enterRename">
            <PhPencilSimple :size="16" weight="bold" />
            <span>Rename…</span>
          </button>
          <button type="button" class="ctx-item ctx-item--danger" role="menuitem" @click="enterDelete">
            <PhTrash :size="16" weight="bold" />
            <span>Delete</span>
          </button>
        </template>

        <form v-else-if="ctx.mode === 'rename'" class="ctx-form" @submit.prevent="submitContext">
          <label class="ctx-label">
            New name
            <input
              ref="ctxInput"
              v-model="ctx.input"
              type="text"
              class="ctx-input"
              :disabled="ctx.busy"
              @keydown.escape.prevent="closeContext"
            />
          </label>
          <p v-if="ctx.error" class="ctx-error" role="alert">{{ ctx.error }}</p>
          <div class="ctx-actions">
            <button type="button" class="ctx-btn" :disabled="ctx.busy" @click="closeContext">Cancel</button>
            <button type="submit" class="ctx-btn ctx-btn--primary" :disabled="ctx.busy">Rename</button>
          </div>
        </form>

        <form v-else-if="ctx.mode === 'move'" class="ctx-form" @submit.prevent="submitContext">
          <label class="ctx-label">
            Move to
            <select
              ref="ctxInput"
              v-model="ctx.input"
              class="ctx-input"
              :disabled="ctx.busy || ctxMoveDestinations.length === 0"
              @keydown.escape.prevent="closeContext"
            >
              <option v-if="ctxMoveDestinations.length === 0" value="" disabled>
                No other destinations
              </option>
              <option v-for="d in ctxMoveDestinations" :key="`d-${d.value}`" :value="d.value">
                {{ d.label }}
              </option>
            </select>
          </label>
          <p v-if="ctx.error" class="ctx-error" role="alert">{{ ctx.error }}</p>
          <div class="ctx-actions">
            <button type="button" class="ctx-btn" :disabled="ctx.busy" @click="closeContext">Cancel</button>
            <button
              type="submit"
              class="ctx-btn ctx-btn--primary"
              :disabled="ctx.busy || ctxMoveDestinations.length === 0"
            >
              Move
            </button>
          </div>
        </form>

        <div v-else-if="ctx.mode === 'delete'" class="ctx-form">
          <p class="ctx-confirm">
            <template v-if="ctx.target.type === 'folder'">
              Delete folder <strong>{{ ctxTargetLabel }}</strong> and every grid inside?
              This cannot be undone.
            </template>
            <template v-else>
              Delete grid <strong>{{ ctxTargetLabel }}</strong>? The JSON file will be removed from disk.
            </template>
          </p>
          <p v-if="ctx.error" class="ctx-error" role="alert">{{ ctx.error }}</p>
          <div class="ctx-actions">
            <button type="button" class="ctx-btn" :disabled="ctx.busy" @click="closeContext">Cancel</button>
            <button type="button" class="ctx-btn ctx-btn--danger" :disabled="ctx.busy" @click="submitContext">
              Delete
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.grids-layout {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
}

.grids-header {
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
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.crumb:hover {
  background: var(--paper-hover);
  color: var(--ink-bright);
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

.grid-section {
  display: flex;
  flex-direction: column;
}

.grids-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.7rem;
}

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
  transition: border-color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
}

.folder-tile:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.folder-tile.drop-target {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.folder-tile.drop-disabled {
  opacity: 0.45;
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
}

.folder-tile__meta {
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
}

.grid-card {
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

.grid-card:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.grid-card__icon {
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

.grid-card__body {
  min-width: 0;
}

.grid-card__body h3 {
  margin: 0 0 0.2rem;
  font-family: var(--serif);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid-card__meta {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.8rem;
  letter-spacing: 0.04em;
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

.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: transparent;
}

.ctx-menu {
  position: fixed;
  z-index: 50;
  min-width: 220px;
  max-width: min(320px, 90vw);
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: var(--paper-soft);
  color: var(--ink);
  box-shadow: var(--shadow-card), 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.ctx-header {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.4rem 0.55rem 0.55rem;
  border-bottom: 1px solid var(--rule-soft);
  margin-bottom: 0.25rem;
}

.ctx-kind {
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.ctx-target {
  font-family: var(--serif);
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.6rem;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  text-align: left;
  border-radius: 7px;
  cursor: pointer;
}

.ctx-item:hover,
.ctx-item:focus-visible {
  background: var(--paper-hover);
  color: var(--ink-bright);
  outline: none;
}

.ctx-item--danger {
  color: #d36464;
}

.ctx-item--danger:hover,
.ctx-item--danger:focus-visible {
  background: rgba(220, 80, 80, 0.16);
  color: #f08585;
}

.ctx-form {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.35rem 0.55rem 0.55rem;
}

.ctx-label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.ctx-input {
  font: inherit;
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.65rem;
  outline: none;
}

.ctx-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.ctx-confirm {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.4;
  font-size: 0.9rem;
}

.ctx-error {
  margin: 0;
  color: #d36464;
  font-size: 0.82rem;
}

.ctx-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}

.ctx-btn {
  border: 1px solid var(--rule);
  border-radius: 8px;
  background: var(--paper-soft);
  color: var(--ink);
  padding: 0.45rem 0.85rem;
  font: inherit;
  cursor: pointer;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.ctx-btn:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.ctx-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ctx-btn--primary {
  border-color: var(--accent);
  color: var(--accent);
}

.ctx-btn--danger {
  border-color: rgba(220, 80, 80, 0.6);
  color: #d36464;
}

.ctx-btn--danger:hover:not(:disabled) {
  background: rgba(220, 80, 80, 0.16);
  color: #f08585;
}
</style>
