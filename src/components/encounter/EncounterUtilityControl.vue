<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  treatment?: 'default' | 'primary' | 'danger'
  disabled?: boolean
  busy?: boolean
  expanded?: boolean
  controls?: string
  shortcut?: string
}>(), {
  treatment: 'default',
  disabled: false,
  busy: false,
  expanded: undefined,
  controls: undefined,
  shortcut: undefined,
})

const emit = defineEmits<{ activate: [] }>()
</script>

<template>
  <button
    type="button"
    class="encounter-utility rt-control"
    :class="{
      'rt-control--primary': treatment === 'primary',
      'rt-control--danger': treatment === 'danger',
    }"
    :disabled="disabled || busy"
    :aria-busy="busy"
    :aria-expanded="expanded"
    :aria-controls="controls"
    @click="emit('activate')"
  >
    <span v-if="$slots.icon" class="encounter-utility__icon" aria-hidden="true"><slot name="icon" /></span>
    <span>{{ busy ? `${label}…` : label }}</span>
    <kbd v-if="shortcut" class="encounter-utility__shortcut" :aria-label="`Keyboard shortcut ${shortcut}`">{{ shortcut }}</kbd>
  </button>
</template>

<style scoped>
.encounter-utility__icon {
  display: inline-grid;
  width: 1.25em;
  height: 1.25em;
  place-items: center;
}

.encounter-utility__shortcut {
  padding: var(--rt-space-1);
  border: var(--rt-border-hairline) solid currentColor;
  border-radius: var(--rt-radius-small) !important;
  color: inherit;
  font-size: var(--rt-type-meta-xs-size);
  line-height: 1;
}
</style>
