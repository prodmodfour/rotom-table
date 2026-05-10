<script setup lang="ts">
import LibraryContextMenuActionList from '~/components/library/LibraryContextMenuActionList.vue'
import LibraryContextMenuDeleteConfirm from '~/components/library/LibraryContextMenuDeleteConfirm.vue'
import LibraryContextMenuHeader from '~/components/library/LibraryContextMenuHeader.vue'
import LibraryContextMenuMoveForm from '~/components/library/LibraryContextMenuMoveForm.vue'
import LibraryContextMenuRenameForm from '~/components/library/LibraryContextMenuRenameForm.vue'
import type { LibraryContextMode } from '~/composables/library/useLibraryContextMenu'
import type { FolderMoveDestination } from '~/utils/folderBrowser'

const props = withDefaults(defineProps<{
  x: number
  y: number
  targetKind: string
  targetLabel: string
  isFolderTarget: boolean
  mode: LibraryContextMode
  input: string
  busy: boolean
  error: string | null
  moveDestinations: FolderMoveDestination[]
  deleteFolderSuffix: string
  deleteItemSuffix: string
}>(), {
  error: null,
})

const emit = defineEmits<{
  'update:input': [value: string]
  close: []
  enterMove: []
  enterRename: []
  enterDelete: []
  submit: []
}>()
</script>

<template>
  <div class="ctx-backdrop" @click="emit('close')" @contextmenu.prevent="emit('close')"></div>
  <div
    class="ctx-menu"
    role="menu"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @click.stop
    @contextmenu.prevent
  >
    <LibraryContextMenuHeader :target-kind="targetKind" :target-label="targetLabel" />

    <LibraryContextMenuActionList
      v-if="mode === 'menu'"
      @enter-move="emit('enterMove')"
      @enter-rename="emit('enterRename')"
      @enter-delete="emit('enterDelete')"
    />

    <LibraryContextMenuRenameForm
      v-else-if="mode === 'rename'"
      :input="input"
      :busy="busy"
      :error="error"
      @update:input="emit('update:input', $event)"
      @close="emit('close')"
      @submit="emit('submit')"
    />

    <LibraryContextMenuMoveForm
      v-else-if="mode === 'move'"
      :input="input"
      :busy="busy"
      :error="error"
      :destinations="moveDestinations"
      @update:input="emit('update:input', $event)"
      @close="emit('close')"
      @submit="emit('submit')"
    />

    <LibraryContextMenuDeleteConfirm
      v-else-if="mode === 'delete'"
      :target-kind="targetKind"
      :target-label="targetLabel"
      :is-folder-target="isFolderTarget"
      :busy="busy"
      :error="error"
      :delete-folder-suffix="deleteFolderSuffix"
      :delete-item-suffix="deleteItemSuffix"
      @close="emit('close')"
      @submit="emit('submit')"
    />
  </div>
</template>

<style scoped>
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

.ctx-menu :deep(.ctx-form) {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.35rem 0.55rem 0.55rem;
}

.ctx-menu :deep(.ctx-label) {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.ctx-menu :deep(.ctx-input) {
  font: inherit;
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.65rem;
  outline: none;
}

.ctx-menu :deep(.ctx-input:focus) {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.ctx-menu :deep(.ctx-confirm) {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.4;
  font-size: 0.9rem;
}

.ctx-menu :deep(.ctx-error) {
  margin: 0;
  color: #d36464;
  font-size: 0.82rem;
}

.ctx-menu :deep(.ctx-actions) {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}

.ctx-menu :deep(.ctx-btn) {
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

.ctx-menu :deep(.ctx-btn:hover:not(:disabled)) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.ctx-menu :deep(.ctx-btn:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.ctx-menu :deep(.ctx-btn--primary) {
  border-color: var(--accent);
  color: var(--accent);
}

.ctx-menu :deep(.ctx-btn--danger) {
  border-color: rgba(220, 80, 80, 0.6);
  color: #d36464;
}

.ctx-menu :deep(.ctx-btn--danger:hover:not(:disabled)) {
  background: rgba(220, 80, 80, 0.16);
  color: #f08585;
}
</style>
