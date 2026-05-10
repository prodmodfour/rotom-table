<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhFolder } from '@phosphor-icons/vue'
import { characterSheets, getSpriteUrl } from '~/data/characterSheets'
import { trainerSheets } from '~/data/trainerSheets'
import { buildFolderBreadcrumbs } from '~/utils/folderBrowser'
import {
  buildSheetBrowserFolderTiles,
  buildSheetBrowserItems,
  filterSheetBrowserItems,
  sheetBrowserSelectionForItem,
  type SheetBrowserItem,
  type SheetBrowserSelection,
} from '~/utils/sheetBrowser'

export type SheetSelection = SheetBrowserSelection

const emit = defineEmits<{ (event: 'select', selection: SheetSelection): void }>()

const currentPath = ref('')
const searchTerm = ref('')
const collapsed = ref(false)

const items = computed<SheetBrowserItem[]>(() => buildSheetBrowserItems({
  pokemonSheets: characterSheets,
  trainerSheets,
  spriteUrlForSpecies: getSpriteUrl,
}))

const breadcrumbs = computed(() => buildFolderBreadcrumbs(currentPath.value))

const visibleSheets = computed<SheetBrowserItem[]>(() =>
  filterSheetBrowserItems(items.value, currentPath.value, searchTerm.value),
)

const visibleFolders = computed(() =>
  buildSheetBrowserFolderTiles(items.value, currentPath.value, searchTerm.value),
)

const goToFolder = (path: string) => {
  currentPath.value = path
}

const selectItem = (item: SheetBrowserItem) => {
  emit('select', sheetBrowserSelectionForItem(item))
}
</script>

<template>
  <section class="panel-card sheet-browser">
    <div class="panel-heading panel-heading--collapsible">
      <button
        type="button"
        class="section-toggle-button"
        :aria-expanded="!collapsed"
        aria-controls="sheet-browser-body"
        @click="collapsed = !collapsed"
      >
        <span class="section-toggle-button__chevron" aria-hidden="true">
          {{ collapsed ? '›' : '⌄' }}
        </span>
        <span class="section-toggle-button__title">Sheets</span>
      </button>
      <span class="badge">{{ visibleSheets.length + visibleFolders.length }} shown</span>
    </div>

    <div id="sheet-browser-body" v-show="!collapsed" class="sheet-browser__body">
    <SheetBrowserBreadcrumbs
      :breadcrumbs="breadcrumbs"
      :current-path="currentPath"
      @navigate="goToFolder"
    />

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
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.panel-heading--collapsible {
  margin-bottom: 0;
}

.section-toggle-button {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  background: transparent;
  color: var(--ink-bright);
  padding: 0;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.section-toggle-button:hover,
.section-toggle-button:focus-visible {
  color: var(--accent);
}

.section-toggle-button:focus-visible {
  outline: 2px solid rgba(250, 189, 47, 0.35);
  outline-offset: 3px;
  border-radius: 8px;
}

.section-toggle-button__chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  color: var(--accent);
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1;
}

.section-toggle-button__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.sheet-browser__body {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
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
