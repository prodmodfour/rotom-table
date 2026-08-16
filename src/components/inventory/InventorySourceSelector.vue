<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { PhCheck } from '@phosphor-icons/vue'
import type { InventorySourceSelectionV1 } from '#shared/itemAutomation/inventorySourceSelection'

const props = defineProps<{
  selection: InventorySourceSelectionV1
  busy: boolean
}>()

const emit = defineEmits<{
  select: [sourceSelectionId: string]
}>()

const optionsRoot = ref<HTMLElement | null>(null)
const selectedIndex = computed(() => Math.max(0, props.selection.options.findIndex(option => option.selected)))

const choose = (sourceSelectionId: string) => {
  if (!props.busy) emit('select', sourceSelectionId)
}

const moveFocus = async (event: KeyboardEvent, currentIndex: number) => {
  if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
  const count = props.selection.options.length
  if (count < 2) return
  event.preventDefault()
  const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
  const nextIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? count - 1
      : (currentIndex + direction + count) % count
  const next = props.selection.options[nextIndex]
  if (!next) return
  choose(next.sourceSelectionId)
  await nextTick()
  optionsRoot.value?.querySelector<HTMLElement>(`[data-inventory-source-index="${nextIndex}"]`)?.focus()
}
</script>

<template>
  <section class="inventory-source-selector" aria-labelledby="inventory-source-selector-title">
    <header class="inventory-source-selector__header">
      <h3 id="inventory-source-selector-title">Choose source</h3>
      <span>{{ selection.options.length }} matching sources</span>
    </header>

    <div ref="optionsRoot" class="inventory-source-selector__options" role="radiogroup" aria-labelledby="inventory-source-selector-title">
      <button
        v-for="(option, index) in selection.options"
        :key="option.sourceSelectionId"
        type="button"
        role="radio"
        class="inventory-source-option"
        :class="{ 'is-selected': option.selected }"
        :aria-checked="option.selected"
        :tabindex="option.selected || (selectedIndex === 0 && index === 0) ? 0 : -1"
        :data-inventory-source-index="index"
        :disabled="busy"
        @click="choose(option.sourceSelectionId)"
        @keydown="moveFocus($event, index)"
      >
        <span class="inventory-source-option__mark" aria-hidden="true">
          <PhCheck v-if="option.selected" :size="16" weight="bold" />
        </span>
        <span class="inventory-source-option__identity">
          <strong>{{ option.containerLabel }} · {{ option.sectionLabel }} · {{ option.rowLabel }}</strong>
          <small>{{ option.quantity }} available</small>
        </span>
        <span v-if="option.selected" class="inventory-source-option__selected">Selected</span>
      </button>
    </div>

    <p>Selection and revision are rechecked when submitted.</p>
  </section>
</template>

<style scoped>
.inventory-source-selector {
  display: grid;
  gap: 0.55rem;
  border-bottom: 1px solid var(--rule);
  padding: 0.85rem 1rem;
}

.inventory-source-selector__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.inventory-source-selector__header h3 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-interface, inherit);
  font-size: 0.92rem;
}

.inventory-source-selector__header span,
.inventory-source-selector p {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.76rem;
  line-height: 1.4;
}

.inventory-source-selector__options {
  display: grid;
  gap: 0.45rem;
}

.inventory-source-option {
  width: 100%;
  min-height: 3.5rem;
  display: grid;
  grid-template-columns: 1.55rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.65rem;
  border: 1px solid var(--rule-soft);
  border-radius: 0.25rem;
  background: var(--paper-inset);
  color: var(--ink);
  padding: 0.55rem 0.7rem;
  text-align: left;
  cursor: pointer;
}

.inventory-source-option:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--rt-focus) 58%, var(--rule-soft));
  background: var(--paper-hover);
}

.inventory-source-option:focus-visible {
  border-color: var(--rt-focus);
  outline: 2px solid var(--rt-focus);
  outline-offset: 2px;
}

.inventory-source-option.is-selected {
  border-color: var(--rt-focus);
  box-shadow: inset 3px 0 0 var(--rt-focus);
}

.inventory-source-option:disabled {
  cursor: wait;
}

.inventory-source-option__mark {
  width: 1.45rem;
  height: 1.45rem;
  display: grid;
  place-items: center;
  border: 2px solid var(--ink-muted);
  border-radius: 50%;
  color: var(--paper);
}

.inventory-source-option.is-selected .inventory-source-option__mark {
  border-color: var(--rt-focus);
  background: var(--rt-focus);
}

.inventory-source-option__identity {
  min-width: 0;
  display: grid;
  gap: 0.15rem;
}

.inventory-source-option__identity strong,
.inventory-source-option__identity small {
  overflow-wrap: anywhere;
}

.inventory-source-option__identity strong {
  color: var(--ink-bright);
  font-size: 0.82rem;
  line-height: 1.3;
}

.inventory-source-option__identity small {
  color: var(--ink-muted);
  font-size: 0.74rem;
}

.inventory-source-option__selected {
  color: var(--rt-focus);
  font-size: 0.72rem;
  font-weight: 800;
}

@media (max-width: 760px) {
  .inventory-source-selector__header {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.15rem;
  }

  .inventory-source-option {
    grid-template-columns: 1.55rem minmax(0, 1fr);
  }

  .inventory-source-option__selected {
    grid-column: 2;
  }
}
</style>
