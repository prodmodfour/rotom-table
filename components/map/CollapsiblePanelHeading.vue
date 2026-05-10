<script setup lang="ts">
defineProps<{
  title: string
  badge: string
  collapsed: boolean
  controlsId: string
}>()

const emit = defineEmits<{
  (event: 'toggle-collapsed'): void
}>()
</script>

<template>
  <div class="panel-heading panel-heading--collapsible">
    <button
      type="button"
      class="section-toggle-button"
      :aria-expanded="!collapsed"
      :aria-controls="controlsId"
      @click="emit('toggle-collapsed')"
    >
      <span class="section-toggle-button__chevron" aria-hidden="true">
        {{ collapsed ? '›' : '⌄' }}
      </span>
      <span class="section-toggle-button__title">{{ title }}</span>
    </button>
    <span class="badge">{{ badge }}</span>
  </div>
</template>

<style scoped>
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.panel-heading--collapsible {
  margin-bottom: 0;
}

.section-toggle-button {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  background: transparent;
  color: var(--ink-bright);
  padding: 0;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.section-toggle-button:hover,
.section-toggle-button:focus-visible {
  color: var(--accent);
}

.section-toggle-button:focus-visible {
  outline: 2px solid rgba(250, 189, 47, 0.35);
  outline-offset: 3px;
  border-radius: 8px;
}

.section-toggle-button__chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  color: var(--accent);
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1;
}

.section-toggle-button__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
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
