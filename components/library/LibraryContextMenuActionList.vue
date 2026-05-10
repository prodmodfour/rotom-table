<script setup lang="ts">
import { PhArrowsOutCardinal, PhPencilSimple, PhTrash } from '@phosphor-icons/vue'

const emit = defineEmits<{
  enterMove: []
  enterRename: []
  enterDelete: []
}>()
</script>

<template>
  <button type="button" class="ctx-item" role="menuitem" @click="emit('enterMove')">
    <PhArrowsOutCardinal :size="16" weight="bold" />
    <span>Move…</span>
  </button>
  <button type="button" class="ctx-item" role="menuitem" @click="emit('enterRename')">
    <PhPencilSimple :size="16" weight="bold" />
    <span>Rename…</span>
  </button>
  <button type="button" class="ctx-item ctx-item--danger" role="menuitem" @click="emit('enterDelete')">
    <PhTrash :size="16" weight="bold" />
    <span>Delete</span>
  </button>
</template>

<style scoped>
.ctx-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.6rem;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  text-align: left;
  border-radius: 7px;
  cursor: pointer;
}

.ctx-item:hover,
.ctx-item:focus-visible {
  background: var(--paper-hover);
  color: var(--ink-bright);
  outline: none;
}

.ctx-item--danger {
  color: #d36464;
}

.ctx-item--danger:hover,
.ctx-item--danger:focus-visible {
  background: rgba(220, 80, 80, 0.16);
  color: #f08585;
}
</style>
