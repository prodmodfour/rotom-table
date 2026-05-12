<script setup lang="ts">
withDefaults(defineProps<{
  to: string
  canDrag: boolean
  isDraggingSelf?: boolean
  align?: 'start' | 'center'
  variant?: 'default' | 'accented'
}>(), {
  align: 'start',
  isDraggingSelf: false,
  variant: 'default',
})

const emit = defineEmits<{
  contextmenu: [event: MouseEvent]
  dragstart: [event: DragEvent]
  dragend: []
}>()
</script>

<template>
  <NuxtLink
    :to="to"
    class="library-card"
    :class="{
      'is-dragging-self': isDraggingSelf,
      'library-card--centered': align === 'center',
      'library-card--accented': variant === 'accented',
    }"
    :draggable="canDrag"
    @contextmenu="emit('contextmenu', $event)"
    @dragstart="emit('dragstart', $event)"
    @dragend="emit('dragend')"
  >
    <slot />
  </NuxtLink>
</template>

<style scoped>
.library-card {
  display: flex;
  gap: 0.85rem;
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  color: var(--ink);
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    opacity 0.15s ease;
}

.library-card:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.library-card[draggable='true'] {
  cursor: grab;
}

.library-card[draggable='true']:active {
  cursor: grabbing;
}

.library-card.is-dragging-self {
  opacity: 0.4;
}

.library-card--centered {
  align-items: center;
}

.library-card--accented {
  border-left: 2px solid var(--rule-strong);
}

.library-card--accented:hover {
  border-color: var(--rule-active);
  border-left-color: var(--accent);
}
</style>
