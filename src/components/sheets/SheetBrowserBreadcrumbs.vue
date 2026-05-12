<script setup lang="ts">
import { PhHouse } from '@phosphor-icons/vue'
import type { FolderBreadcrumb } from '~/utils/folderBrowser'

defineProps<{
  breadcrumbs: FolderBreadcrumb[]
  currentPath: string
}>()

const emit = defineEmits<{
  navigate: [path: string]
}>()
</script>

<template>
  <nav class="browser-crumbs" aria-label="Folder path">
    <template v-for="(crumb, i) in breadcrumbs" :key="`crumb-${crumb.path}`">
      <span v-if="i > 0" class="crumb-sep" aria-hidden="true">/</span>
      <button
        type="button"
        class="crumb"
        :class="{ 'crumb--current': crumb.path === currentPath }"
        :aria-current="crumb.path === currentPath ? 'page' : undefined"
        @click="emit('navigate', crumb.path)"
      >
        <PhHouse v-if="crumb.path === ''" :size="12" weight="bold" aria-hidden="true" />
        <span>{{ crumb.label }}</span>
      </button>
    </template>
  </nav>
</template>

<style scoped>
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
</style>
