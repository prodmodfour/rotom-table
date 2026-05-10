<script setup lang="ts">
import { SHEET_LIBRARY_PATH } from '~/utils/sheetRoutes'

defineProps<{
  tableCount: number
}>()
</script>

<template>
  <section class="panel-card intro">
    <div class="intro-heading">
      <h1>Generate Encounters</h1>
      <span class="badge">{{ tableCount }} tables</span>
    </div>
    <p class="intro-copy">
      Roll on an encounter table and stat the results with the same pipeline
      as <code>just encounter &lt;region&gt; &lt;table&gt; &lt;count&gt;</code>.
      Output lands in <code>&lt;outRoot&gt;/&lt;table&gt;_&lt;count&gt;/</code>
      as <code>CharacterSheet</code> JSON files — drop them under
      <code>data/sheets/</code> (the default) and they show up immediately
      on the <NuxtLink class="inline-link" :to="SHEET_LIBRARY_PATH">Sheets</NuxtLink>
      page. Browse all available tables on the
      <NuxtLink class="inline-link" to="/encounter-tables">Encounter Tables</NuxtLink>
      page.
    </p>
  </section>
</template>

<style scoped>
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
</style>
