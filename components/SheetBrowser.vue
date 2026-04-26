<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhFolder, PhHouse } from '@phosphor-icons/vue'
import { characterSheets, getSpriteUrl } from '~/data/characterSheets'
import { trainerSheets } from '~/data/trainerSheets'
import { formatFolderLabel } from '~/utils/sheetFolders'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

export type SheetSelection =
  | { kind: 'pokemon'; sheet: CharacterSheet }
  | { kind: 'trainer'; sheet: TrainerSheet }

interface SheetItem {
  kind: 'pokemon' | 'trainer'
  slug: string
  folder: string
  sheet: CharacterSheet | TrainerSheet
  spriteUrl: string | null
  displayName: string
  meta: string
  sortKey: string
}

const emit = defineEmits<{ (event: 'select', selection: SheetSelection): void }>()

const currentPath = ref('')
const searchTerm = ref('')

const items = computed<SheetItem[]>(() => {
  const out: SheetItem[] = []
  for (const sheet of characterSheets) {
    out.push({
      kind: 'pokemon',
      slug: sheet.slug,
      folder: sheet.folder ?? '',
      sheet,
      spriteUrl: getSpriteUrl(sheet.species),
      displayName: sheet.nickname,
      meta: `${sheet.species} · Lv ${sheet.level}`,
      sortKey: sheet.nickname.toLowerCase(),
    })
  }
  for (const sheet of trainerSheets) {
    const cls = sheet.classes?.[0]?.name
    out.push({
      kind: 'trainer',
      slug: sheet.slug,
      folder: sheet.folder ?? '',
      sheet,
      spriteUrl: sheet.portraitUrl ?? null,
      displayName: sheet.name,
      meta: cls ? `Trainer · Lv ${sheet.level} · ${cls}` : `Trainer · Lv ${sheet.level}`,
      sortKey: sheet.name.toLowerCase(),
    })
  }
  return out
})

const allFolders = computed(() => {
  const set = new Set<string>()
  for (const item of items.value) if (item.folder) set.add(item.folder)
  return set
})

const breadcrumbs = computed(() => {
  const out = [{ label: 'Home', path: '' }]
  if (!currentPath.value) return out
  let acc = ''
  for (const seg of currentPath.value.split('/')) {
    acc = acc ? `${acc}/${seg}` : seg
    out.push({ label: formatFolderLabel(seg), path: acc })
  }
  return out
})

const isInsideCurrent = (folder: string) => {
  if (!currentPath.value) return true
  return folder === currentPath.value || folder.startsWith(currentPath.value + '/')
}

const normalize = (value: string) => value.trim().toLowerCase()

const matchesQuery = (item: SheetItem, query: string) =>
  [item.displayName, item.meta, item.folder].some((value) => normalize(value).includes(query))

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

const goToFolder = (path: string) => {
  currentPath.value = path
}

const selectItem = (item: SheetItem) => {
  if (item.kind === 'pokemon') {
    emit('select', { kind: 'pokemon', sheet: item.sheet as CharacterSheet })
  } else {
    emit('select', { kind: 'trainer', sheet: item.sheet as TrainerSheet })
  }
}
</script>

<template>
  <section class="panel-card sheet-browser">
    <div class="panel-heading">
      <h2>Sheets</h2>
      <span class="badge">{{ visibleSheets.length + visibleFolders.length }} shown</span>
    </div>

    <nav class="browser-crumbs" aria-label="Folder path">
      <template v-for="(crumb, i) in breadcrumbs" :key="`crumb-${crumb.path}`">
        <span v-if="i > 0" class="crumb-sep" aria-hidden="true">/</span>
        <button
          type="button"
          class="crumb"
          :class="{ 'crumb--current': crumb.path === currentPath }"
          :aria-current="crumb.path === currentPath ? 'page' : undefined"
          @click="goToFolder(crumb.path)"
        >
          <PhHouse v-if="crumb.path === ''" :size="12" weight="bold" aria-hidden="true" />
          <span>{{ crumb.label }}</span>
        </button>
      </template>
    </nav>

    <label class="search-field">
      <span class="sr-only">Search sheets</span>
      <input v-model.trim="searchTerm" type="search" placeholder="Search sheets…" />
    </label>

    <div class="browser-list">
      <button
        v-for="folder in visibleFolders"
        :key="`folder-${folder.path}`"
        type="button"
        class="browser-row browser-row--folder"
        @click="goToFolder(folder.path)"
      >
        <span class="row-icon">
          <PhFolder :size="22" weight="duotone" aria-hidden="true" />
        </span>
        <span class="row-body">
          <span class="row-name">{{ folder.label }}</span>
          <span class="row-meta">{{ folder.count }} item{{ folder.count === 1 ? '' : 's' }}</span>
        </span>
      </button>

      <button
        v-for="item in visibleSheets"
        :key="`${item.kind}:${item.slug}`"
        type="button"
        class="browser-row"
        :class="`browser-row--${item.kind}`"
        @click="selectItem(item)"
      >
        <span class="row-icon row-icon--sprite">
          <img v-if="item.spriteUrl" :src="item.spriteUrl" :alt="item.displayName" />
          <span v-else aria-hidden="true">?</span>
        </span>
        <span class="row-body">
          <span class="row-name">{{ item.displayName }}</span>
          <span class="row-meta">{{ item.meta }}</span>
        </span>
      </button>

      <p v-if="visibleSheets.length === 0 && visibleFolders.length === 0" class="empty">
        Nothing here.
      </p>
    </div>
  </section>
</template>

<style scoped>
.sheet-browser {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  flex: 1 1 auto;
  min-height: 0;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.panel-heading h2 {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
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

.browser-crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.3rem;
}

.crumb-sep {
  color: var(--ink-faint);
  font-size: 0.85rem;
}

.crumb {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.4rem;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-soft);
  font: inherit;
  font-size: 0.82rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.crumb:hover {
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.crumb--current {
  color: var(--ink-bright);
  font-weight: 600;
}

.search-field {
  display: block;
}

.search-field input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.7rem;
  outline: none;
  font: inherit;
}

.search-field input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.browser-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  overflow: auto;
  max-height: 55vh;
}

.browser-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.browser-row:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.browser-row--folder {
  background: var(--paper-soft);
}

.browser-row--trainer {
  border-left: 2px solid var(--rule-strong);
}

.row-icon {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
  color: var(--accent);
  overflow: hidden;
}

.row-icon--sprite img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  padding: 2px;
}

.row-icon--sprite span {
  color: var(--ink-faint);
  font-weight: 700;
}

.row-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.row-name {
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  color: var(--ink-muted);
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  margin: 0.6rem 0.2rem;
  color: var(--ink-muted);
  font-style: italic;
  font-size: 0.85rem;
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
