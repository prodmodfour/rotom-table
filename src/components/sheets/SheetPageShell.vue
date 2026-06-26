<script setup lang="ts">
import type { SaveStatus } from '~/composables/useEditableSheet'
import { SHEET_LIBRARY_PATH } from '~/utils/sheetRoutes'

interface Props {
  hasSheet: boolean
  saveStatus?: SaveStatus
  saveError?: string | null
  sheetFolder?: string | null
  sheetPathLabel?: string | null
  showPathBreadcrumbs?: boolean
  backTo?: string
  backLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  saveStatus: undefined,
  saveError: null,
  sheetFolder: '',
  sheetPathLabel: null,
  showPathBreadcrumbs: true,
  backTo: SHEET_LIBRARY_PATH,
  backLabel: '← Sheets',
})
</script>

<template>
  <div class="sheet-page-shell">
    <header class="sheet-page-shell__header">
      <AppNavigation />

      <div class="sheet-page-shell__path-row">
        <SheetPathBreadcrumbs
          v-if="props.hasSheet && props.sheetPathLabel && props.showPathBreadcrumbs"
          :folder="props.sheetFolder"
          :current-label="props.sheetPathLabel"
        />
        <NuxtLink v-else :to="props.backTo" class="sheet-page-shell__back-link">
          {{ props.backLabel }}
        </NuxtLink>
        <SaveIndicator
          v-if="props.hasSheet && props.saveStatus"
          :status="props.saveStatus"
          :error="props.saveError"
        />
      </div>
    </header>

    <main v-if="props.hasSheet" class="sheet-page-shell__body">
      <slot />
    </main>

    <main v-else class="sheet-page-shell__empty">
      <slot name="not-found" />
    </main>
  </div>
</template>

<style scoped>
.sheet-page-shell {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
}

.sheet-page-shell__header {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.sheet-page-shell__path-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  min-width: 0;
}

.sheet-page-shell__back-link {
  color: var(--ink-soft);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
  text-underline-offset: 0.18em;
  font-size: 0.9rem;
  letter-spacing: 0.02em;
}

.sheet-page-shell__back-link:hover {
  color: var(--ink-bright);
}

.sheet-page-shell__body,
.sheet-page-shell__empty {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
</style>
