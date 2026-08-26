<script setup lang="ts">
import { computed } from 'vue'
import { PhArchive, PhArrowSquareOut, PhCopy, PhDownloadSimple, PhPencilSimple, PhTrayArrowUp } from '@phosphor-icons/vue'
import type { EncounterTableDocumentV1 } from '~/types/gmCampaignToolkit'

const props = defineProps<{
  table: EncounterTableDocumentV1
  busy: boolean
  sourceReview: {
    state: 'not-applicable' | 'migration-bound' | 'current' | 'source-changed' | 'source-missing'
    sourceName: string | null
    sourceRevision: number | null
  } | null
}>()
const emit = defineEmits<{ edit: []; archive: []; copy: []; export: [] }>()
const totalWeight = computed(() => props.table.rows.reduce((sum, row) => sum + row.weight, 0))
const chance = (weight: number): string => `${((weight / totalWeight.value) * 100).toFixed(weight / totalWeight.value >= 0.1 ? 1 : 2).replace(/\.0$/, '')}%`
const predicateLabel = (values: readonly string[]): string => values.length ? values.join(', ') : 'Any'
const sourceLabel = computed(() => ({
  'campaign-authored': 'Campaign authored',
  'legacy-migration': 'Migrated and verified',
  imported: 'Imported copy',
  copied: 'Campaign copy',
})[props.table.provenance.kind])
</script>

<template>
  <article class="table-detail">
    <header class="detail-heading">
      <div>
        <div class="heading-meta"><span :class="['status-chip', table.status]">{{ table.status }}</span><span>Revision {{ table.revision }}</span><span>{{ sourceLabel }}</span></div>
        <h2>{{ table.name }}</h2>
        <div class="tag-row"><span v-for="tag in table.environmentTags" :key="tag">{{ tag }}</span></div>
      </div>
      <NuxtLink v-if="table.status === 'active'" :to="`/generate?table=${encodeURIComponent(table.tableId)}`" class="prepare-link">
        Prepare wild encounter <PhArrowSquareOut :size="17" aria-hidden="true" />
      </NuxtLink>
    </header>

    <aside v-if="sourceReview?.state === 'source-changed' || sourceReview?.state === 'source-missing'" class="drift-notice" role="status">
      <strong>{{ sourceReview.state === 'source-changed' ? 'Source table has a newer accepted revision' : 'Source table is no longer available' }}</strong>
      <span>This copy stays pinned and unchanged. Compare it with the source before deliberately updating campaign material.</span>
    </aside>

    <section class="summary-grid" aria-label="Table policy summary">
      <div><span>Rows</span><strong>{{ table.rows.filter(row => row.kind === 'species').length }} species</strong></div>
      <div><span>Group size</span><strong>{{ table.groupSizePolicy.minimum === table.groupSizePolicy.maximum ? table.groupSizePolicy.minimum : `${table.groupSizePolicy.minimum}–${table.groupSizePolicy.maximum}` }}</strong></div>
      <div><span>Time</span><strong>{{ predicateLabel(table.predicates.timeOfDay) }}</strong></div>
      <div><span>Weather</span><strong>{{ predicateLabel(table.predicates.weather) }}</strong></div>
    </section>

    <section class="roll-section" aria-labelledby="weighted-outcomes-heading">
      <header><div><p class="eyebrow">Reviewed distribution</p><h3 id="weighted-outcomes-heading">Weighted outcomes</h3></div><span>{{ totalWeight }} total weight</span></header>
      <div class="table-scroll">
        <table>
          <thead><tr><th scope="col">Outcome</th><th scope="col">Levels</th><th scope="col">Weight</th><th scope="col">Chance</th><th scope="col">Availability</th></tr></thead>
          <tbody>
            <tr v-for="row in table.rows" :key="row.rowId" :class="{ nothing: row.kind === 'nothing' }">
              <th scope="row">{{ row.kind === 'nothing' ? 'Nothing' : row.speciesId }}</th>
              <td>{{ row.kind === 'species' ? (row.minLevel === row.maxLevel ? `Lv ${row.minLevel}` : `Lv ${row.minLevel}–${row.maxLevel}`) : '—' }}</td>
              <td>{{ row.weight }}</td>
              <td>{{ chance(row.weight) }}</td>
              <td>{{ predicateLabel(row.predicates.timeOfDay) }} · {{ predicateLabel(row.predicates.weather) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="table.notes" class="notes-section"><p class="eyebrow">Private GM notes</p><p>{{ table.notes }}</p></section>

    <footer class="detail-actions">
      <button type="button" :disabled="busy" @click="emit('edit')"><PhPencilSimple :size="17" /> Edit</button>
      <button type="button" :disabled="busy" @click="emit('copy')"><PhCopy :size="17" /> Copy</button>
      <button type="button" :disabled="busy" @click="emit('export')"><PhDownloadSimple :size="17" /> Export</button>
      <button type="button" :disabled="busy" :class="{ 'archive-action': table.status === 'active', 'restore-action': table.status === 'archived' }" @click="emit('archive')">
        <PhArchive v-if="table.status === 'active'" :size="17" /><PhTrayArrowUp v-else :size="17" />
        {{ table.status === 'active' ? 'Archive' : 'Restore' }}
      </button>
    </footer>
  </article>
</template>

<style scoped>
.table-detail { min-width: 0; display: grid; gap: 1rem; }
.detail-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
h2 { margin: 0.35rem 0 0.55rem; font-size: clamp(1.45rem, 3vw, 2rem); }
.heading-meta, .tag-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; color: var(--ink-muted); font: 700 0.7rem var(--font-mono); }
.heading-meta > span + span::before { content: '·'; margin-right: 0.4rem; }
.status-chip { border: 1px solid var(--rule); border-radius: 999px; padding: 0.2rem 0.48rem; text-transform: uppercase; letter-spacing: 0.08em; }
.status-chip.active { border-color: color-mix(in srgb, #67d7ad 60%, var(--rule)); color: #67d7ad; }
.status-chip.archived { border-color: color-mix(in srgb, #efb34c 60%, var(--rule)); color: #efb34c; }
.tag-row span { border: 1px solid var(--rule); border-radius: 999px; padding: 0.2rem 0.5rem; }
.prepare-link { min-height: 44px; display: inline-flex; flex: none; align-items: center; gap: 0.4rem; border: 1px solid var(--accent); border-radius: 9px; padding: 0.6rem 0.8rem; background: var(--accent-soft); color: var(--accent); text-decoration: none; font-weight: 800; }
.prepare-link:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.drift-notice { display: grid; gap: 0.25rem; border: 1px solid color-mix(in srgb, #efb34c 58%, var(--rule)); border-left-width: 4px; border-radius: 9px; padding: 0.75rem 0.85rem; background: color-mix(in srgb, #efb34c 7%, transparent); }
.drift-notice span { color: var(--ink-muted); font-size: 0.82rem; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--rule-soft); border-radius: 10px; overflow: hidden; }
.summary-grid div { padding: 0.75rem; background: color-mix(in srgb, var(--paper) 45%, transparent); }
.summary-grid div + div { border-left: 1px solid var(--rule-soft); }
.summary-grid span { display: block; margin-bottom: 0.25rem; color: var(--ink-muted); font-size: 0.68rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.summary-grid strong { font-size: 0.86rem; text-transform: capitalize; }
.roll-section, .notes-section { border: 1px solid var(--rule-soft); border-radius: 12px; overflow: hidden; }
.roll-section > header { display: flex; justify-content: space-between; align-items: end; gap: 1rem; padding: 0.9rem 1rem; border-bottom: 1px solid var(--rule-soft); }
.roll-section h3, .roll-section p { margin: 0; }
.roll-section > header > span { color: var(--ink-muted); font: 700 0.7rem var(--font-mono); }
.eyebrow { margin: 0 0 0.25rem; color: var(--accent); font: 800 0.68rem var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
th, td { padding: 0.65rem 0.8rem; border-bottom: 1px solid var(--rule-soft); text-align: left; white-space: nowrap; }
thead th { color: var(--ink-muted); font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase; }
tbody th { color: var(--ink); }
tr.nothing th { color: var(--ink-muted); font-style: italic; }
tbody tr:last-child > * { border-bottom: 0; }
.notes-section { padding: 0.9rem 1rem; }
.notes-section p:last-child { margin: 0; color: var(--ink-muted); white-space: pre-wrap; }
.detail-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 0.45rem; padding-top: 0.25rem; }
.detail-actions button { min-height: 44px; display: inline-flex; align-items: center; gap: 0.35rem; border: 1px solid var(--rule); border-radius: 8px; padding: 0.55rem 0.72rem; background: var(--paper-soft); color: var(--ink); font: inherit; font-weight: 750; cursor: pointer; }
.detail-actions button:hover { border-color: var(--accent); color: var(--accent); }
.detail-actions .archive-action:hover { border-color: var(--accent-strong, #ff4553); color: var(--accent-strong, #ff4553); }
.detail-actions .restore-action { border-color: color-mix(in srgb, #67d7ad 55%, var(--rule)); color: #67d7ad; }
.detail-actions button:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 680px) { .detail-heading { flex-direction: column; } .prepare-link { width: 100%; justify-content: center; box-sizing: border-box; } .summary-grid { grid-template-columns: 1fr 1fr; } .summary-grid div:nth-child(3) { border-left: 0; border-top: 1px solid var(--rule-soft); } .summary-grid div:nth-child(4) { border-top: 1px solid var(--rule-soft); } }
</style>
