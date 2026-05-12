<script setup lang="ts">
interface TypeEffectivenessRow {
  type: string
  label: string
  tone: string
}

defineProps<{
  rows: readonly TypeEffectivenessRow[]
  sheetTypes: readonly string[]
}>()
</script>

<template>
  <section v-if="rows.length" class="panel-card">
    <h2 class="panel-title">
      Type Effectiveness
      <span class="panel-subtle panel-subtle--types">
        <span>vs</span>
        <TypeBadge
          v-for="type in sheetTypes"
          :key="`effectiveness-${type}`"
          :type="type"
          size="xs"
        />
      </span>
    </h2>
    <div class="type-grid">
      <div
        v-for="row in rows"
        :key="row.type"
        :class="['type-cell', `type-cell--${row.tone}`]"
      >
        <span class="type-name"><TypeBadge :type="row.type" size="xs" /></span>
        <span class="type-mult">×{{ row.label }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel-title {
  margin: 0 0 0.6rem;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.panel-subtle {
  font-size: 0.74rem;
  color: var(--ink-muted);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
  font-family: var(--font-ui);
}

.panel-subtle--types {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(94px, 1fr));
  gap: 0.4rem;
}

.type-cell {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  padding: 0.45rem 0.55rem;
  background: var(--paper-inset);
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.type-cell--weak {
  background: rgba(251, 73, 52, 0.14);
  border-color: rgba(251, 73, 52, 0.45);
}

.type-cell--resist {
  background: rgba(184, 187, 38, 0.14);
  border-color: rgba(184, 187, 38, 0.45);
}

.type-cell--immune {
  background: rgba(168, 153, 132, 0.18);
  border-color: var(--rule-active);
  color: var(--ink-soft);
}

.type-name {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.type-mult {
  font-weight: 700;
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-bright);
}
</style>
