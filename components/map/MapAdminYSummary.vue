<script setup lang="ts">
defineProps<{
  mapGroundLevelY: number
  mapSpecificYMin: number
  mapSpecificYMax: number
}>()
</script>

<template>
  <dl class="admin-y-summary">
    <div>
      <dt>Absolute ground layer</dt>
      <dd>{{ mapGroundLevelY }}</dd>
    </div>
    <div>
      <dt>Map-specific Y range</dt>
      <dd>{{ mapSpecificYMin }} … {{ mapSpecificYMax }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.admin-y-summary {
  display: grid;
  gap: 0.55rem;
  margin: 1rem 0 0;
}

.admin-y-summary div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  padding: 0.65rem 0.75rem;
}

.admin-y-summary dt,
.admin-y-summary dd {
  margin: 0;
}

.admin-y-summary dt {
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.admin-y-summary dd {
  color: var(--accent);
  font-weight: 800;
  white-space: nowrap;
}
</style>
