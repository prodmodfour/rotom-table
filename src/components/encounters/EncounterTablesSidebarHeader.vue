<script setup lang="ts">
import { ENCOUNTER_GENERATOR_PATH } from '~/utils/encounterRoutes'

const searchTerm = defineModel<string>('searchTerm', { required: true })

defineProps<{
  totalCount: number
  filteredCount: number
}>()
</script>

<template>
  <div class="sidebar-heading">
    <h1>Encounter Tables</h1>
    <span class="badge">{{ filteredCount }} of {{ totalCount }}</span>
  </div>

  <p class="sidebar-copy">
    Browse encounter tables from the campaign
    <code>encounter_tables/&lt;region&gt;/&lt;table&gt;.json</code>.
    Use the <NuxtLink :to="ENCOUNTER_GENERATOR_PATH" class="inline-link">Generate</NuxtLink>
    page to roll on a table and produce stat blocks.
  </p>

  <label class="search-field">
    <span class="sr-only">Search encounter tables</span>
    <input
      v-model.trim="searchTerm"
      type="search"
      placeholder="Search region, table, or species…"
    />
  </label>
</template>

<style scoped>
.sidebar-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.sidebar-heading h1 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.4rem;
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

.sidebar-copy {
  margin: 0 0 0.9rem;
  color: var(--ink-muted);
  line-height: 1.5;
  font-size: 0.85rem;
}

.inline-link {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
  text-underline-offset: 0.18em;
}

.inline-link:hover {
  text-decoration-color: var(--accent);
}

code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  color: var(--accent);
}

.search-field {
  display: flex;
  flex-direction: column;
  margin-bottom: 0.85rem;
}

input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.75rem;
  outline: none;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(255, 31, 45, 0.18);
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
