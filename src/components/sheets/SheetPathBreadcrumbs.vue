<script setup lang="ts">
import { computed } from 'vue'
import { PhHouse } from '@phosphor-icons/vue'
import { buildFolderBreadcrumbs, folderPathFromQuery } from '~/utils/folderBrowser'
import { sheetLibraryFolderLocation } from '~/utils/sheetRoutes'

const props = withDefaults(defineProps<{
  folder?: string | null
  currentLabel: string
}>(), {
  folder: '',
})

const folderPath = computed(() => folderPathFromQuery(props.folder))
const breadcrumbs = computed(() => buildFolderBreadcrumbs(folderPath.value, { homeLabel: 'Sheets' }))
</script>

<template>
  <nav class="sheet-path" aria-label="Sheet file path">
    <ol class="sheet-path__list">
      <li
        v-for="(crumb, i) in breadcrumbs"
        :key="`crumb-${crumb.path}`"
        class="sheet-path__item"
      >
        <span v-if="i > 0" class="sheet-path__sep" aria-hidden="true">/</span>
        <NuxtLink :to="sheetLibraryFolderLocation(crumb.path)" class="sheet-path__link">
          <PhHouse v-if="crumb.path === ''" :size="12" weight="bold" aria-hidden="true" />
          <span>{{ crumb.label }}</span>
        </NuxtLink>
      </li>

      <li class="sheet-path__item sheet-path__item--current">
        <span class="sheet-path__sep" aria-hidden="true">/</span>
        <span class="sheet-path__current" aria-current="page">{{ currentLabel }}</span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.sheet-path {
  min-width: 0;
}

.sheet-path__list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.3rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.sheet-path__item {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
}

.sheet-path__sep {
  color: var(--ink-faint);
  font-size: 0.85rem;
}

.sheet-path__link,
.sheet-path__current {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  max-width: min(42vw, 28rem);
  padding: 0.2rem 0.4rem;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 0.82rem;
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sheet-path__link {
  background: transparent;
  color: var(--ink-soft);
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}

.sheet-path__link span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sheet-path__link:hover,
.sheet-path__link:focus-visible {
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.sheet-path__link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.sheet-path__current {
  color: var(--ink-bright);
  font-weight: 600;
}
</style>
