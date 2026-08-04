<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  label: string
  tone?: 'neutral' | 'brand' | 'focus' | 'pending' | 'success' | 'danger' | 'info'
  symbol?: string
  interactive?: boolean
  selected?: boolean
  disabled?: boolean
}>(), {
  tone: 'neutral',
  symbol: undefined,
  interactive: false,
  selected: false,
  disabled: false,
})

const emit = defineEmits<{ activate: [] }>()
const tag = computed(() => props.interactive ? 'button' : 'span')
</script>

<template>
  <component
    :is="tag"
    class="encounter-status-chip rt-status-chip"
    :class="`encounter-status-chip--${tone}`"
    :type="interactive ? 'button' : undefined"
    :disabled="interactive ? disabled : undefined"
    :aria-pressed="interactive ? selected : undefined"
    @click="interactive && emit('activate')"
  >
    <span v-if="symbol" aria-hidden="true">{{ symbol }}</span>
    <span>{{ label }}</span>
  </component>
</template>

<style scoped>
.encounter-status-chip--brand { border-color: var(--rt-brand); color: var(--rt-brand); }
.encounter-status-chip--focus { border-color: var(--rt-focus); color: var(--rt-focus); }
.encounter-status-chip--pending { border-color: var(--rt-pending); color: var(--rt-pending); }
.encounter-status-chip--success { border-color: var(--rt-success); color: var(--rt-success); }
.encounter-status-chip--danger { border-color: var(--rt-danger); color: var(--rt-danger); }
.encounter-status-chip--info { border-color: var(--rt-info); color: var(--rt-info); }

.encounter-status-chip[aria-pressed='true'] {
  background: var(--rt-focus);
  color: var(--rt-bg-world);
  outline: var(--rt-border-strong) solid var(--rt-text-strong);
  outline-offset: 2px;
}

.encounter-status-chip:disabled {
  border-style: dashed;
  color: var(--rt-text-muted);
}
</style>
