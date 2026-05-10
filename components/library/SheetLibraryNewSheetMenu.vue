<script setup lang="ts">
import { PhCaretDown, PhPlus } from '@phosphor-icons/vue'
import LibraryIntroActionButton from '~/components/library/LibraryIntroActionButton.vue'
import type { SheetLibraryKind } from '~/utils/sheetLibrary'

defineProps<{
  open: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  toggle: []
  close: []
  createSheet: [kind: SheetLibraryKind]
}>()
</script>

<template>
  <div class="sheet-menu-wrap">
    <LibraryIntroActionButton
      variant="primary"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="emit('toggle')"
    >
      <PhPlus :size="16" weight="bold" />
      New sheet
      <PhCaretDown :size="12" weight="bold" aria-hidden="true" />
    </LibraryIntroActionButton>

    <div v-if="open" class="sheet-menu" role="menu">
      <button
        type="button"
        class="sheet-menu__item"
        role="menuitem"
        :disabled="disabled"
        @click="emit('createSheet', 'pokemon')"
      >
        Pokémon
      </button>
      <button
        type="button"
        class="sheet-menu__item"
        role="menuitem"
        :disabled="disabled"
        @click="emit('createSheet', 'trainer')"
      >
        Trainer
      </button>
    </div>
  </div>

  <div
    v-if="open"
    class="sheet-menu-backdrop"
    @click="emit('close')"
    @contextmenu.prevent="emit('close')"
  ></div>
</template>

<style scoped>
.sheet-menu-wrap {
  position: relative;
  display: inline-flex;
}

.sheet-menu {
  position: absolute;
  top: calc(100% + 0.3rem);
  left: 0;
  z-index: 50;
  min-width: 160px;
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card), 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 0.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.sheet-menu__item {
  display: flex;
  align-items: center;
  padding: 0.45rem 0.7rem;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  text-align: left;
  border-radius: 7px;
  cursor: pointer;
}

.sheet-menu__item:hover:not(:disabled),
.sheet-menu__item:focus-visible {
  background: var(--paper-hover);
  color: var(--ink-bright);
  outline: none;
}

.sheet-menu__item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sheet-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: transparent;
}
</style>
