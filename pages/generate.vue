<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  encounterRegions,
  encounterTables,
  findEncounterTable,
  formatRegionLabel,
  formatTableLabel,
  rollEncounters,
  tablesInRegion,
} from '~/utils/encounterTables'
import type { RolledEncounter } from '~/types/encounterTable'

useHead({
  title: 'Generate · Rotom Table',
})

const route = useRoute()
const router = useRouter()

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

const initialEntry = encounterTables[0] ?? null
const region = ref<string>(String(route.query.region ?? initialEntry?.region ?? ''))
const tableKey = ref<string>(String(route.query.table ?? initialEntry?.key ?? ''))
const count = ref<number>(3)
const outRoot = ref<string>('generated_pokemon')
const preview = ref<boolean>(false)

// Keep the table dropdown in sync with the region.
watch(region, (next) => {
  const tables = tablesInRegion(next)
  if (!tables.find((t) => t.key === tableKey.value)) {
    tableKey.value = tables[0]?.key ?? ''
  }
})

const tablesForRegion = computed(() => tablesInRegion(region.value))
const selectedTable = computed(() => findEncounterTable(region.value, tableKey.value))

// ---------------------------------------------------------------------------
// Roll preview (browser-only, no files written)
// ---------------------------------------------------------------------------

const rolledPreview = ref<RolledEncounter[]>([])

const rollPreview = () => {
  if (!selectedTable.value) return
  rolledPreview.value = rollEncounters(selectedTable.value.table, clampCount(count.value))
}

const clampCount = (n: number): number => {
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(30, Math.floor(n)))
}

// Auto-roll a fresh preview when the table or count changes, so the user
// sees example output immediately.
watch(
  [selectedTable, count],
  () => {
    if (selectedTable.value) rollPreview()
  },
  { immediate: true },
)

// ---------------------------------------------------------------------------
// Generation (server route → pokegen.sh)
// ---------------------------------------------------------------------------

interface GenerateFile {
  name: string
  error?: string
  content?: string
}

interface GenerateResult {
  ok: true
  dir: string
  relDir: string
  rolled: RolledEncounter[]
  files: GenerateFile[]
  failures: number
  preview: boolean
}

const generating = ref(false)
const error      = ref<string | null>(null)
const result     = ref<GenerateResult | null>(null)

const generate = async () => {
  if (!selectedTable.value) return
  generating.value = true
  error.value = null
  result.value = null
  try {
    const data = await $fetch<GenerateResult>('/api/encounters/generate', {
      method: 'POST',
      body: {
        region:   region.value,
        table:    tableKey.value,
        count:    clampCount(count.value),
        outRoot:  outRoot.value,
        preview:  preview.value,
      },
    })
    result.value = data
  } catch (err: unknown) {
    const status = (err as { statusMessage?: string; message?: string })?.statusMessage
      ?? (err as { message?: string })?.message
      ?? 'Unknown error'
    error.value = status
  } finally {
    generating.value = false
  }
}

// Open file content in a collapsible state per file.
const openFiles = ref<Set<string>>(new Set())
const toggleFile = (name: string) => {
  if (openFiles.value.has(name)) openFiles.value.delete(name)
  else openFiles.value.add(name)
}
const isOpen = (name: string) => openFiles.value.has(name)

// Update the URL when region/table change so links from /encounter-tables
// (and ordinary back/forward) work.
watch([region, tableKey], () => {
  router.replace({ query: { region: region.value, table: tableKey.value } })
})
</script>

<template>
  <div class="generate-layout">
    <header class="generate-header">
      <AppNavigation />

      <section class="panel-card intro">
        <div class="intro-heading">
          <h1>Generate Encounters</h1>
          <span class="badge">{{ encounterTables.length }} tables</span>
        </div>
        <p class="intro-copy">
          Roll on an encounter table and stat the results with the same pipeline
          as <code>just encounter &lt;region&gt; &lt;table&gt; &lt;count&gt;</code>.
          Output lands in <code>&lt;outRoot&gt;/&lt;table&gt;_&lt;count&gt;/</code>
          as PTU markdown stat blocks. Browse all available tables on the
          <NuxtLink class="inline-link" to="/encounter-tables">Encounter Tables</NuxtLink>
          page.
        </p>
      </section>
    </header>

    <main class="generate-main">
      <!-- ============ Form ============ -->
      <section class="panel-card form-card">
        <h2 class="panel-title">Roll setup</h2>

        <div class="form-grid">
          <label class="field">
            <span class="field-label">Region</span>
            <select v-model="region" :disabled="generating">
              <option v-for="r in encounterRegions" :key="r" :value="r">
                {{ formatRegionLabel(r) }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="field-label">Table</span>
            <select v-model="tableKey" :disabled="generating || tablesForRegion.length === 0">
              <option
                v-for="entry in tablesForRegion"
                :key="entry.key"
                :value="entry.key"
              >
                {{ entry.table.name }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="field-label">Count</span>
            <input
              v-model.number="count"
              type="number"
              min="1"
              max="30"
              :disabled="generating"
            />
          </label>

          <label class="field">
            <span class="field-label">Output root</span>
            <input
              v-model.trim="outRoot"
              type="text"
              :disabled="generating || preview"
              placeholder="generated_pokemon"
            />
          </label>
        </div>

        <div v-if="selectedTable" class="form-meta">
          <span class="meta-pill">
            Lv {{ selectedTable.table.min_level }}–{{ selectedTable.table.max_level }}
          </span>
          <span class="meta-pill">
            {{ selectedTable.table.entries.length }} entries
          </span>
          <span class="meta-pill subtle">
            {{ formatRegionLabel(selectedTable.region) }} /
            {{ formatTableLabel(selectedTable.key) }}
          </span>
        </div>

        <div class="form-actions">
          <label class="checkbox-field">
            <input v-model="preview" type="checkbox" :disabled="generating" />
            <span>Preview only — write to a tempdir, stream contents back, discard.</span>
          </label>

          <div class="button-row">
            <button
              type="button"
              class="ghost-button"
              :disabled="!selectedTable || generating"
              @click="rollPreview"
            >
              Re-roll preview
            </button>
            <button
              type="button"
              class="primary-button"
              :disabled="!selectedTable || generating"
              @click="generate"
            >
              {{ generating ? 'Generating…' : preview ? 'Preview generation' : 'Generate folder' }}
            </button>
          </div>
        </div>
      </section>

      <!-- ============ Roll preview ============ -->
      <section v-if="rolledPreview.length" class="panel-card preview-card">
        <h2 class="panel-title">
          Rolled encounters
          <span class="panel-subtle">browser-side preview · click <em>Generate folder</em> to stat</span>
        </h2>
        <ol class="rolled-list">
          <li v-for="(enc, index) in rolledPreview" :key="`${enc.species}-${index}-${enc.roll}`" class="rolled-row">
            <span class="rolled-num">{{ index + 1 }}.</span>
            <span class="rolled-roll">[{{ enc.roll }}]</span>
            <span class="rolled-species">{{ enc.species }}</span>
            <span class="rolled-level">Lv {{ enc.level }}</span>
          </li>
        </ol>
      </section>

      <!-- ============ Result ============ -->
      <section v-if="error" class="panel-card error-card">
        <h2 class="panel-title">Generation failed</h2>
        <p class="error-message">{{ error }}</p>
      </section>

      <section v-if="result" class="panel-card result-card">
        <header class="result-heading">
          <h2 class="panel-title">
            {{ result.preview ? 'Preview generated' : 'Generated folder' }}
            <span v-if="result.failures > 0" class="panel-subtle warn">
              {{ result.failures }} failure(s)
            </span>
          </h2>
          <div class="result-pills">
            <span v-if="!result.preview" class="badge">{{ result.relDir }}</span>
            <span class="badge">{{ result.files.length }} file(s)</span>
          </div>
        </header>

        <p v-if="!result.preview" class="result-hint">
          Files written to
          <code>{{ result.relDir }}/</code>.
          The folder name auto-increments (<code>{{ tableKey }}_{{ count }}</code>,
          <code>{{ tableKey }}_{{ count }}-2</code>…) so repeat runs don't clobber.
        </p>

        <ul class="result-files">
          <li
            v-for="file in result.files"
            :key="file.name"
            :class="['result-file', { 'has-error': file.error }]"
          >
            <button
              v-if="result.preview && file.content"
              type="button"
              class="result-file__head"
              @click="toggleFile(file.name)"
            >
              <span class="result-file__caret" :class="{ open: isOpen(file.name) }" aria-hidden="true">▸</span>
              <span class="result-file__name">{{ file.name }}</span>
            </button>
            <div v-else class="result-file__head">
              <span class="result-file__caret" aria-hidden="true">·</span>
              <span class="result-file__name">{{ file.name }}</span>
            </div>

            <p v-if="file.error" class="result-file__error">{{ file.error }}</p>
            <pre
              v-if="result.preview && file.content && isOpen(file.name)"
              class="result-file__body"
            >{{ file.content }}</pre>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>

<style scoped>
.generate-layout {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
}

.generate-header {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.generate-main {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 1.1rem 1.2rem;
}

.intro-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.4rem;
}

.intro-heading h1 {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.intro-copy {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.55;
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
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.88em;
  color: var(--accent);
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

.panel-title {
  margin: 0 0 0.85rem;
  font-family: var(--serif);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.panel-subtle {
  font-size: 0.74rem;
  color: var(--ink-muted);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
  font-family: Inter, sans-serif;
}

.panel-subtle.warn {
  color: var(--warn);
}

/* ---- Form ---- */

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.7rem;
  margin-bottom: 0.85rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.field-label {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

select,
input[type="text"],
input[type="number"] {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.75rem;
  outline: none;
  font: inherit;
}

select:focus,
input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

select:disabled,
input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.form-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.85rem;
}

.meta-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.18rem 0.6rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  color: var(--ink);
}

.meta-pill.subtle {
  color: var(--ink-muted);
  border-style: dashed;
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.checkbox-field {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  font-size: 0.85rem;
  color: var(--ink-soft);
  line-height: 1.4;
}

.checkbox-field input {
  width: auto;
  margin-top: 0.2rem;
  accent-color: var(--accent);
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.primary-button,
.ghost-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.55rem 1rem;
  border-radius: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.primary-button {
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.primary-button:hover:not(:disabled) {
  background: rgba(250, 189, 47, 0.22);
  color: var(--ink-bright);
}

.ghost-button {
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  color: var(--ink);
}

.ghost-button:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.primary-button:disabled,
.ghost-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ---- Roll preview ---- */

.rolled-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-variant-numeric: tabular-nums;
}

.rolled-row {
  display: grid;
  grid-template-columns: 2.5rem 4rem minmax(0, 1fr) 5rem;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.4rem 0.65rem;
  border-radius: 8px;
}

.rolled-row:nth-child(odd) {
  background: var(--paper-inset);
}

.rolled-num {
  color: var(--ink-muted);
  font-size: 0.85rem;
}

.rolled-roll {
  color: var(--accent);
  font-weight: 700;
  font-size: 0.85rem;
}

.rolled-species {
  font-family: var(--serif);
  font-size: 1.02rem;
  color: var(--ink-bright);
  letter-spacing: 0.02em;
}

.rolled-level {
  text-align: right;
  color: var(--ink);
  font-weight: 600;
}

/* ---- Result ---- */

.error-card {
  border-color: rgba(251, 73, 52, 0.45);
  background: rgba(251, 73, 52, 0.08);
}

.error-message {
  margin: 0;
  color: var(--bad);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9rem;
  white-space: pre-wrap;
}

.result-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.4rem;
}

.result-heading .panel-title {
  margin: 0;
}

.result-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: flex-end;
}

.result-hint {
  margin: 0 0 0.85rem;
  color: var(--ink-soft);
  font-size: 0.88rem;
}

.result-files {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.result-file {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  overflow: hidden;
}

.result-file.has-error {
  border-color: rgba(251, 73, 52, 0.45);
  background: rgba(251, 73, 52, 0.08);
}

.result-file__head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 0;
  background: transparent;
  color: var(--ink);
  cursor: default;
  text-align: left;
}

button.result-file__head {
  cursor: pointer;
  transition: background 0.15s ease;
}

button.result-file__head:hover {
  background: var(--paper-hover);
}

.result-file__caret {
  color: var(--accent);
  transition: transform 0.15s ease;
  font-size: 0.85rem;
}

.result-file__caret.open {
  transform: rotate(90deg);
}

.result-file__name {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.88rem;
  color: var(--ink-bright);
}

.has-error .result-file__name {
  color: var(--bad);
}

.result-file__error {
  margin: 0;
  padding: 0 0.75rem 0.55rem 1.85rem;
  color: var(--bad);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.82rem;
  white-space: pre-wrap;
}

.result-file__body {
  margin: 0;
  padding: 0.85rem 1rem;
  border-top: 1px solid var(--rule);
  background: var(--paper-inset);
  color: var(--ink-soft);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.45;
  overflow-x: auto;
  white-space: pre-wrap;
}

@media (max-width: 720px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .button-row {
    justify-content: stretch;
  }

  .button-row .primary-button,
  .button-row .ghost-button {
    flex: 1;
  }
}
</style>
