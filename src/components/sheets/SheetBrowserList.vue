<script setup lang="ts">
import { PhFolder } from '@phosphor-icons/vue'
import type { FolderTile } from '~/utils/folderBrowser'
import type { SheetBrowserItem } from '~/utils/sheetBrowser'

withDefaults(defineProps<{
  folders: FolderTile[]
  sheets: SheetBrowserItem[]
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  openFolder: [path: string]
  selectSheet: [item: SheetBrowserItem]
}>()
</script>

<template>
  <div class="browser-list">
    <button
      v-for="folder in folders"
      :key="`folder-${folder.path}`"
      type="button"
      class="browser-row browser-row--folder"
      :disabled="disabled"
      @click="emit('openFolder', folder.path)"
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
      v-for="item in sheets"
      :key="`${item.kind}:${item.slug}`"
      type="button"
      class="browser-row"
      :class="`browser-row--${item.kind}`"
      :disabled="disabled"
      @click="emit('selectSheet', item)"
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

    <p v-if="sheets.length === 0 && folders.length === 0" class="empty">
      Nothing here.
    </p>
  </div>
</template>

<style scoped>
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

.browser-row:disabled {
  cursor: wait;
  opacity: 0.55;
}

.browser-row:disabled:hover {
  border-color: var(--rule-soft);
  background: var(--paper);
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
</style>
