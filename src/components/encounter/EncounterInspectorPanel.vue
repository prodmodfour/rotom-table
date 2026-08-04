<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  summary?: string
  authorized: boolean
  open?: boolean
  diagnostic?: boolean
}>(), {
  summary: undefined,
  open: false,
  diagnostic: false,
})
</script>

<template>
  <details
    v-if="authorized"
    class="encounter-inspector rt-surface"
    :open="open"
    data-rt-layer="inspector"
    :data-rt-elevation="diagnostic ? 5 : 2"
    :data-diagnostic="diagnostic || undefined"
  >
    <summary class="encounter-inspector__summary rt-focusable">
      <span>
        <strong class="rt-type-action-md">{{ title }}</strong>
        <span v-if="summary" class="rt-type-meta-xs">{{ summary }}</span>
      </span>
      <span aria-hidden="true">⌄</span>
    </summary>
    <div class="encounter-inspector__body rt-type-body-sm">
      <slot />
    </div>
  </details>
</template>

<style scoped>
.encounter-inspector {
  overflow: hidden;
}

.encounter-inspector__summary {
  display: flex;
  min-height: var(--rt-touch-minimum);
  align-items: center;
  justify-content: space-between;
  gap: var(--rt-space-3);
  padding: var(--rt-card-padding);
  cursor: pointer;
  list-style: none;
}

.encounter-inspector__summary::-webkit-details-marker {
  display: none;
}

.encounter-inspector__summary > span:first-child {
  display: grid;
  gap: var(--rt-space-1);
}

.encounter-inspector__body {
  padding: 0 var(--rt-card-padding) var(--rt-card-padding);
  border-top: var(--rt-border-hairline) solid var(--rt-rule);
  overflow-wrap: anywhere;
}

.encounter-inspector[data-diagnostic='true'] {
  font-family: var(--rt-font-numeric);
}
</style>
