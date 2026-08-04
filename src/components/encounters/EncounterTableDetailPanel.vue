<script setup lang="ts">
import { ref, watch } from 'vue'
import { encounterBuilderTablePath } from '~/utils/encounterRoutes'
import type { DisplayedEncounterRow } from '~/utils/encounterTables'
import type { EncounterTable, EncounterTableEntry } from '~/types/encounterTable'

const props = withDefaults(defineProps<{
  selectedEntry: EncounterTableEntry | null
  selectedRows: DisplayedEncounterRow[]
  canManage?: boolean
  saving?: boolean
  saveError?: string | null
  saveTable?: (entry: EncounterTableEntry, table: EncounterTable) => Promise<boolean>
}>(), {
  canManage: false,
  saving: false,
  saveError: null,
  saveTable: undefined,
})

const editing = ref(false)

watch(
  () => props.selectedEntry ? `${props.selectedEntry.region}/${props.selectedEntry.key}` : null,
  () => {
    editing.value = false
  },
)

const saveEditedTable = async (table: EncounterTable) => {
  if (!props.selectedEntry || !props.saveTable) return
  const saved = await props.saveTable(props.selectedEntry, table)
  if (saved) editing.value = false
}
</script>

<template>
  <main class="encounter-detail">
    <article v-if="selectedEntry" class="panel-card">
      <EncounterTableDetailHeader :selected-entry="selectedEntry" />

      <EncounterTableEditForm
        v-if="editing"
        :table="selectedEntry.table"
        :saving="saving"
        :error="saveError"
        @save="saveEditedTable"
        @cancel="editing = false"
      />

      <template v-else>
        <EncounterTableRollList :rows="selectedRows" />

        <footer class="detail-actions">
          <button
            v-if="canManage"
            type="button"
            class="secondary-button"
            @click="editing = true"
          >
            Edit table
          </button>
          <NuxtLink
            :to="encounterBuilderTablePath(selectedEntry.region, selectedEntry.key)"
            class="cta-link"
          >
            Roll on this table →
          </NuxtLink>
        </footer>
      </template>
    </article>

    <section v-else class="panel-card panel-card--empty">
      <h2>No encounter tables yet</h2>
      <p>
        Create a table here, or drop a JSON file anywhere under
        <code>encounter_tables/</code>
        and refresh.
      </p>
    </section>
  </main>
</template>

<style scoped>
.encounter-detail {
  min-width: 0;
  padding: 0;
  display: flex;
  justify-content: center;
}

.panel-card {
  width: 100%;
  max-width: 760px;
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
  gap: 0.6rem;
  flex-wrap: wrap;
}

.cta-link,
.secondary-button {
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
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.secondary-button {
  border-color: var(--rule);
  background: var(--paper-soft);
  color: var(--ink);
}

.cta-link:hover,
.secondary-button:hover {
  background: rgba(255, 31, 45, 0.22);
  color: var(--ink-bright);
}

.secondary-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

@media (max-width: 1040px) {
  .encounter-detail {
    padding: 1rem;
  }
}
</style>
