<script setup lang="ts">
import { encounterGeneratorTablePath } from '~/utils/encounterRoutes'
import type { DisplayedEncounterRow } from '~/utils/encounterTables'
import type { EncounterTableEntry } from '~/types/encounterTable'

defineProps<{
  selectedEntry: EncounterTableEntry | null
  selectedRows: DisplayedEncounterRow[]
}>()
</script>

<template>
  <main class="encounter-detail">
    <article v-if="selectedEntry" class="panel-card">
      <EncounterTableDetailHeader :selected-entry="selectedEntry" />
      <EncounterTableRollList :rows="selectedRows" />

      <footer class="detail-actions">
        <NuxtLink
          :to="encounterGeneratorTablePath(selectedEntry.region, selectedEntry.key)"
          class="cta-link"
        >
          Roll on this table →
        </NuxtLink>
      </footer>
    </article>

    <section v-else class="panel-card panel-card--empty">
      <h2>No encounter tables yet</h2>
      <p>
        Drop a JSON file into
        <code>encounter_tables/&lt;region&gt;/&lt;table&gt;.json</code>
        and refresh.
      </p>
    </section>
  </main>
</template>

<style scoped>
.encounter-detail {
  min-width: 0;
  padding: 1.5rem;
  display: flex;
  justify-content: center;
}

.panel-card {
  width: 100%;
  max-width: 720px;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 1.6rem 1.8rem;
}

.panel-card--empty {
  text-align: center;
  color: var(--ink-muted);
}

code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  color: var(--accent);
}

.detail-actions {
  margin-top: 1.2rem;
  display: flex;
  justify-content: flex-end;
}

.cta-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--accent);
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
  text-decoration: none;
  letter-spacing: 0.04em;
  font-weight: 600;
  transition: background 0.15s ease, color 0.15s ease;
}

.cta-link:hover {
  background: rgba(250, 189, 47, 0.22);
  color: var(--ink-bright);
}

@media (max-width: 1040px) {
  .encounter-detail {
    padding: 1rem;
  }
}
</style>
