<script setup lang="ts">
import { PhCaretRight, PhHouse } from '@phosphor-icons/vue'
import type { FolderBreadcrumb } from '~/utils/folderBrowser'

defineProps<{
  breadcrumbs: FolderBreadcrumb[]
  currentPath: string
  hoverTarget: string | null
  isDragging: boolean
  canDropOn: (path: string) => boolean
}>()

const emit = defineEmits<{
  navigate: [path: string]
  dragenter: [event: DragEvent, path: string]
  dragover: [event: DragEvent, path: string]
  dragleave: [path: string]
  drop: [event: DragEvent, path: string]
}>()
</script>

<template>
  <nav class="breadcrumbs panel-card" aria-label="Folder path">
    <template v-for="(crumb, i) in breadcrumbs" :key="`crumb-${crumb.path}`">
      <PhCaretRight v-if="i > 0" :size="14" weight="bold" class="crumb-sep" aria-hidden="true" />
      <button
        type="button"
        class="crumb"
        :class="{
          'crumb--current': crumb.path === currentPath,
          'drop-target': hoverTarget === crumb.path,
          'drop-disabled': isDragging && !canDropOn(crumb.path),
        }"
        :aria-current="crumb.path === currentPath ? 'page' : undefined"
        @click="emit('navigate', crumb.path)"
        @dragenter="emit('dragenter', $event, crumb.path)"
        @dragover="emit('dragover', $event, crumb.path)"
        @dragleave="emit('dragleave', crumb.path)"
        @drop="emit('drop', $event, crumb.path)"
      >
        <PhHouse v-if="crumb.path === ''" :size="14" weight="bold" aria-hidden="true" />
        <span>{{ crumb.label }}</span>
      </button>
    </template>
  </nav>
</template>

<style scoped>
.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
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
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.crumb:hover {
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.crumb:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
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
</style>
