<script setup lang="ts">
defineProps<{
  preview: boolean
  failures: number
  relDir: string
  fileCount: number
  tableKey: string
  count: number
}>()
</script>

<template>
  <header class="result-heading">
    <h2 class="panel-title">
      {{ preview ? 'Preview generated' : 'Generated folder' }}
      <span v-if="failures > 0" class="panel-subtle warn">
        {{ failures }} failure(s)
      </span>
    </h2>
    <div class="result-pills">
      <span v-if="!preview" class="badge">{{ relDir }}</span>
      <span class="badge">{{ fileCount }} file(s)</span>
    </div>
  </header>

  <p v-if="!preview" class="result-hint">
    Files written to
    <code>{{ relDir }}/</code>.
    The folder name auto-increments (<code>{{ tableKey }}_{{ count }}</code>,
    <code>{{ tableKey }}_{{ count }}-2</code>…) so repeat runs don't clobber.
  </p>
</template>

<style scoped>
.panel-title {
  margin: 0;
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

code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  color: var(--accent);
}

.result-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.4rem;
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
</style>
