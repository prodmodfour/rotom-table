<script setup lang="ts">
import { PhArchiveBox, PhMagnifyingGlass, PhPlus } from '@phosphor-icons/vue'
import type { EncounterTableLibraryProjectionV1 } from '~/types/gmCampaignToolkit'
import type { EncounterTableStatusFilter } from '~/composables/encounters/useGmCampaignToolkitTables'

const props = defineProps<{
  tables: readonly EncounterTableLibraryProjectionV1[]
  selectedTableId: string | null
  loading: boolean
  searchTerm: string
  statusFilter: EncounterTableStatusFilter
  environmentFilter: string
  minimumLevel: number | null
  maximumLevel: number | null
  environments: readonly string[]
}>()

const emit = defineEmits<{
  select: [table: EncounterTableLibraryProjectionV1]
  create: []
  'update:searchTerm': [value: string]
  'update:statusFilter': [value: EncounterTableStatusFilter]
  'update:environmentFilter': [value: string]
  'update:minimumLevel': [value: number | null]
  'update:maximumLevel': [value: number | null]
}>()

const numberFromEvent = (event: Event): number | null => {
  const value = (event.target as HTMLInputElement).value
  return value === '' ? null : Number(value)
}
</script>

<template>
  <section class="table-library" aria-labelledby="table-library-heading">
    <header class="library-heading">
      <div>
        <p class="eyebrow">Campaign authority</p>
        <h2 id="table-library-heading">Encounter tables</h2>
        <p>{{ tables.length }} matching {{ tables.length === 1 ? 'table' : 'tables' }}</p>
      </div>
      <button type="button" class="primary-action" @click="emit('create')">
        <PhPlus :size="18" weight="bold" aria-hidden="true" />
        New table
      </button>
    </header>

    <div class="filters" role="search" aria-label="Filter encounter tables">
      <label class="search-field">
        <span class="sr-only">Search encounter tables</span>
        <PhMagnifyingGlass :size="18" aria-hidden="true" />
        <input
          type="search"
          :value="searchTerm"
          placeholder="Search names and habitats"
          @input="emit('update:searchTerm', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label>
        <span>Status</span>
        <select :value="statusFilter" @change="emit('update:statusFilter', ($event.target as HTMLSelectElement).value as EncounterTableStatusFilter)">
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </label>
      <label>
        <span>Habitat</span>
        <select :value="environmentFilter" @change="emit('update:environmentFilter', ($event.target as HTMLSelectElement).value)">
          <option value="all">All habitats</option>
          <option v-for="environment in environments" :key="environment" :value="environment">{{ environment }}</option>
        </select>
      </label>
      <div class="level-filter">
        <span>Level overlap</span>
        <div>
          <input :value="minimumLevel ?? ''" type="number" min="1" max="100" inputmode="numeric" aria-label="Minimum level" placeholder="Min" @input="emit('update:minimumLevel', numberFromEvent($event))">
          <span aria-hidden="true">–</span>
          <input :value="maximumLevel ?? ''" type="number" min="1" max="100" inputmode="numeric" aria-label="Maximum level" placeholder="Max" @input="emit('update:maximumLevel', numberFromEvent($event))">
        </div>
      </div>
    </div>

    <div v-if="loading" class="library-state" role="status">Loading campaign tables…</div>
    <div v-else-if="tables.length === 0" class="library-state">
      <PhArchiveBox :size="34" weight="duotone" aria-hidden="true" />
      <strong>No tables match these filters</strong>
      <span>Change a filter or create a campaign table.</span>
    </div>
    <div v-else class="table-list" role="listbox" aria-label="Encounter tables">
      <button
        v-for="table in tables"
        :key="table.tableId"
        type="button"
        role="option"
        class="table-card"
        :class="{ selected: table.tableId === selectedTableId }"
        :aria-selected="table.tableId === selectedTableId"
        @click="emit('select', table)"
      >
        <span class="card-title-row">
          <strong>{{ table.name }}</strong>
          <span v-if="table.status === 'archived'" class="status-chip">Archived</span>
        </span>
        <span class="card-summary">Lv {{ table.levelRange.minimum }}–{{ table.levelRange.maximum }} · {{ table.speciesRowCount }} species</span>
        <span class="tag-row">
          <span v-for="tag in table.environmentTags" :key="tag">{{ tag }}</span>
          <span v-if="table.nothingWeight > 0">Nothing {{ table.nothingWeight }}w</span>
        </span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.table-library {
  min-width: 0;
  border: 1px solid var(--rule);
  border-radius: 16px;
  background: var(--paper-soft);
  overflow: hidden;
  box-shadow: var(--shadow-card);
}

.library-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 1.25rem;
  border-bottom: 1px solid var(--rule-soft);
}

.eyebrow {
  margin: 0 0 0.25rem;
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h2 { margin: 0; font-size: 1.25rem; }
.library-heading p:last-child { margin: 0.3rem 0 0; color: var(--ink-muted); font-size: 0.86rem; }

.primary-action {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid var(--accent);
  border-radius: 10px;
  padding: 0.65rem 0.9rem;
  background: var(--accent-soft);
  color: var(--accent);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.primary-action:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
.primary-action:focus-visible, .table-card:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.filters {
  display: grid;
  grid-template-columns: minmax(190px, 1fr) repeat(3, minmax(110px, auto));
  gap: 0.65rem;
  align-items: end;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--rule-soft);
  background: color-mix(in srgb, var(--paper) 58%, transparent);
}

.filters label > span,
.level-filter > span {
  display: block;
  margin-bottom: 0.32rem;
  color: var(--ink-muted);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.search-field {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--rule);
  border-radius: 9px;
  padding-inline: 0.7rem;
  background: var(--paper-deep);
  color: var(--ink-muted);
}
.search-field > span { display: none !important; }
.search-field input { width: 100%; border: 0; padding: 0; background: transparent; }
input, select { min-height: 44px; border: 1px solid var(--rule); border-radius: 9px; padding: 0.55rem 0.65rem; background: var(--paper-deep); color: var(--ink); font: inherit; }
.level-filter > div { display: flex; align-items: center; gap: 0.3rem; }
.level-filter input { width: 4.4rem; }

.table-list { max-height: 58vh; overflow: auto; padding: 0.75rem; }
.table-card { width: 100%; display: grid; gap: 0.42rem; border: 1px solid transparent; border-bottom-color: var(--rule-soft); border-radius: 10px; padding: 0.85rem; background: transparent; color: var(--ink); text-align: left; font: inherit; cursor: pointer; }
.table-card:hover { background: var(--paper-hover); border-color: var(--rule); }
.table-card.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--paper-soft)); box-shadow: inset 3px 0 0 var(--accent); }
.card-title-row { display: flex; justify-content: space-between; gap: 0.5rem; align-items: center; }
.card-summary { color: var(--ink-muted); font-size: 0.84rem; }
.status-chip, .tag-row span { border: 1px solid var(--rule); border-radius: 999px; padding: 0.18rem 0.48rem; color: var(--ink-muted); font-family: var(--font-mono); font-size: 0.66rem; }
.status-chip { border-color: color-mix(in srgb, #efb34c 55%, var(--rule)); color: #efb34c; }
.tag-row { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.library-state { min-height: 14rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.45rem; padding: 2rem; color: var(--ink-muted); text-align: center; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 840px) {
  .filters { grid-template-columns: 1fr 1fr; }
  .search-field { grid-column: 1 / -1; }
  .table-list { max-height: none; }
}
@media (max-width: 520px) {
  .library-heading { flex-direction: column; }
  .primary-action { width: 100%; }
  .filters { grid-template-columns: 1fr; }
  .search-field { grid-column: auto; }
}
</style>
