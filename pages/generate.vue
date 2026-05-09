<script setup lang="ts">
import { encounterTables } from '~/utils/encounterTables'

useHead({
  title: 'Generate · Rotom Table',
})

const route = useRoute()
const router = useRouter()

const {
  region,
  tableKey,
  count,
  outRoot,
  preview,
  tablesForRegion,
  selectedTable,
  rolledPreview,
  rollPreview,
  generating,
  error,
  result,
  generate,
  openFiles,
  toggleFile,
} = useEncounterGenerationPage({
  query: route.query,
  replaceQuery: (query) => router.replace({ query }),
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
          as <code>CharacterSheet</code> JSON files — drop them under
          <code>data/sheets/</code> (the default) and they show up immediately
          on the <NuxtLink class="inline-link" to="/sheets">Sheets</NuxtLink>
          page. Browse all available tables on the
          <NuxtLink class="inline-link" to="/encounter-tables">Encounter Tables</NuxtLink>
          page.
        </p>
      </section>
    </header>

    <main class="generate-main">
      <EncounterGenerateSetupCard
        v-model:region="region"
        v-model:table-key="tableKey"
        v-model:count="count"
        v-model:out-root="outRoot"
        v-model:preview="preview"
        :tables-for-region="tablesForRegion"
        :selected-table="selectedTable"
        :generating="generating"
        @roll-preview="rollPreview"
        @generate="generate"
      />

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

      <EncounterGenerateResultCard
        v-if="result"
        :result="result"
        :table-key="tableKey"
        :count="count"
        :open-files="openFiles"
        @toggle-file="toggleFile"
      />
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
  font-family: var(--font-book);
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
  font-family: var(--font-mono);
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
  font-family: var(--font-book);
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
  font-family: var(--font-ui);
}

.panel-subtle.warn {
  color: var(--warn);
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
  font-family: var(--font-book);
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
  font-family: var(--font-mono);
  font-size: 0.9rem;
  white-space: pre-wrap;
}

</style>
