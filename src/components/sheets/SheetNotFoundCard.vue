<script setup lang="ts">
import { SHEET_LIBRARY_PATH } from '~/utils/sheetRoutes'

interface Props {
  title: string
  message: string
  slug: string
  backTo?: string
  backLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  backTo: SHEET_LIBRARY_PATH,
  backLabel: '← Back to all sheets',
})
</script>

<template>
  <section class="sheet-not-found-card">
    <h1>{{ props.title }}</h1>
    <p>{{ props.message }} <code>{{ props.slug }}</code>.</p>
    <NuxtLink :to="props.backTo" class="sheet-not-found-card__back-link">
      {{ props.backLabel }}
    </NuxtLink>
  </section>
</template>

<style scoped>
.sheet-not-found-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}

.sheet-not-found-card__back-link {
  color: var(--ink-soft);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
  text-underline-offset: 0.18em;
  font-size: 0.9rem;
  letter-spacing: 0.02em;
}

.sheet-not-found-card__back-link:hover {
  color: var(--ink-bright);
}

code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--accent);
}
</style>
