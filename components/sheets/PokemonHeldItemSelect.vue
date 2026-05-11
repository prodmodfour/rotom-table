<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { findItem, items } from '~/data/ptuReference'
import type { PtuItem } from '~/types/ptuReference'

interface HeldItemOption {
  value: string
  label: string
  detail: string
  item: PtuItem | null
  isCustom?: boolean
}

const props = withDefaults(defineProps<{
  modelValue?: string | null
  placeholder?: string
}>(), {
  modelValue: '',
  placeholder: 'None',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const rootEl = ref<HTMLElement | null>(null)
const triggerEl = ref<HTMLButtonElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)
const listboxEl = ref<HTMLElement | null>(null)

const open = ref(false)
const searchTerm = ref('')
const activeIndex = ref(0)

const listboxId = useId()
const normalizedModelValue = computed(() => props.modelValue?.trim() ?? '')
const selectedItem = computed(() => normalizedModelValue.value ? findItem(normalizedModelValue.value) : null)
const displayLabel = computed(() => selectedItem.value?.name ?? (normalizedModelValue.value || props.placeholder))
const hasCustomValue = computed(() => Boolean(normalizedModelValue.value && !selectedItem.value))

const itemDetail = (item: PtuItem): string => {
  const pieces = [
    ...item.categories.slice(0, 2),
    item.costs[0],
  ].filter(Boolean)
  return pieces.join(' · ')
}

const optionMatches = (item: PtuItem, query: string): boolean => {
  const haystack = [
    item.name,
    ...item.aliases,
    ...item.categories,
    ...item.sections,
    ...item.costs,
  ].join(' ').toLowerCase()
  return haystack.includes(query)
}

const filteredItems = computed(() => {
  const query = searchTerm.value.trim().toLowerCase()
  if (!query) return items
  return items.filter((item) => optionMatches(item, query))
})

const customOption = computed<HeldItemOption | null>(() => {
  if (!hasCustomValue.value) return null
  return {
    value: normalizedModelValue.value,
    label: normalizedModelValue.value,
    detail: 'Current custom value',
    item: null,
    isCustom: true,
  }
})

const options = computed<HeldItemOption[]>(() => [
  {
    value: '',
    label: props.placeholder,
    detail: 'No held item',
    item: null,
  },
  ...(customOption.value ? [customOption.value] : []),
  ...filteredItems.value.map((item) => ({
    value: item.name,
    label: item.name,
    detail: itemDetail(item),
    item,
  })),
])

const activeOption = computed(() => options.value[activeIndex.value] ?? options.value[0])

const isSelected = (option: HeldItemOption): boolean => {
  if (!normalizedModelValue.value) return option.value === ''
  return option.value === (selectedItem.value?.name ?? normalizedModelValue.value)
}

const scrollActiveIntoView = async () => {
  await nextTick()
  const listbox = listboxEl.value
  const activeNode = listbox?.querySelector<HTMLElement>(`[data-option-index="${activeIndex.value}"]`)
  activeNode?.scrollIntoView({ block: 'nearest' })
}

const setActiveIndex = (index: number) => {
  const maxIndex = Math.max(options.value.length - 1, 0)
  activeIndex.value = Math.min(Math.max(index, 0), maxIndex)
  void scrollActiveIntoView()
}

const selectedOptionIndex = (): number => {
  const index = options.value.findIndex(isSelected)
  return index >= 0 ? index : 0
}

const openMenu = async () => {
  open.value = true
  searchTerm.value = ''
  activeIndex.value = selectedOptionIndex()
  await nextTick()
  searchEl.value?.focus()
  await scrollActiveIntoView()
}

const closeMenu = async ({ focusTrigger = false } = {}) => {
  open.value = false
  searchTerm.value = ''
  if (focusTrigger) {
    await nextTick()
    triggerEl.value?.focus()
  }
}

const toggleMenu = () => {
  if (open.value) void closeMenu()
  else void openMenu()
}

const selectOption = (option: HeldItemOption) => {
  emit('update:modelValue', option.value)
  void closeMenu({ focusTrigger: true })
}

const onDocumentPointerDown = (event: PointerEvent) => {
  if (!open.value) return
  const target = event.target
  if (target instanceof Node && rootEl.value?.contains(target)) return
  void closeMenu()
}

const onTriggerKeydown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    void openMenu()
  }
}

const onMenuKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeMenu({ focusTrigger: true })
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    setActiveIndex(activeIndex.value + 1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    setActiveIndex(activeIndex.value - 1)
    return
  }

  if (event.key === 'Home') {
    event.preventDefault()
    setActiveIndex(0)
    return
  }

  if (event.key === 'End') {
    event.preventDefault()
    setActiveIndex(options.value.length - 1)
    return
  }

  if (event.key === 'Enter' && activeOption.value) {
    event.preventDefault()
    selectOption(activeOption.value)
  }
}

watch(options, () => {
  if (!options.value.length) {
    activeIndex.value = 0
    return
  }
  if (activeIndex.value >= options.value.length) activeIndex.value = options.value.length - 1
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})
</script>

<template>
  <div ref="rootEl" class="held-item-select">
    <button
      ref="triggerEl"
      type="button"
      class="held-item-select__trigger"
      :class="{ 'held-item-select__trigger--empty': !normalizedModelValue }"
      :aria-expanded="open"
      :aria-controls="listboxId"
      aria-haspopup="listbox"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <span class="held-item-select__sprite" aria-hidden="true">
        <ItemSprite v-if="selectedItem" :item="selectedItem" size="sm" />
        <span v-else class="held-item-select__sprite-placeholder">—</span>
      </span>
      <span class="held-item-select__label">{{ displayLabel }}</span>
      <span class="held-item-select__chevron" aria-hidden="true">▾</span>
    </button>

    <div
      v-if="open"
      class="held-item-select__menu"
      @keydown="onMenuKeydown"
    >
      <label class="held-item-select__search-label">
        <span class="sr-only">Search held items</span>
        <input
          ref="searchEl"
          v-model="searchTerm"
          class="held-item-select__search"
          type="search"
          autocomplete="off"
          placeholder="Search items…"
        />
      </label>

      <div
        :id="listboxId"
        ref="listboxEl"
        class="held-item-select__list"
        role="listbox"
        :aria-activedescendant="activeOption ? `${listboxId}-${activeIndex}` : undefined"
      >
        <button
          v-for="(option, index) in options"
          :id="`${listboxId}-${index}`"
          :key="`${option.value || 'none'}-${option.isCustom ? 'custom' : 'item'}`"
          type="button"
          class="held-item-select__option"
          :class="{
            'held-item-select__option--active': index === activeIndex,
            'held-item-select__option--selected': isSelected(option),
            'held-item-select__option--empty': option.value === '',
          }"
          role="option"
          :aria-selected="isSelected(option)"
          :data-option-index="index"
          @mouseenter="activeIndex = index"
          @click="selectOption(option)"
        >
          <span class="held-item-select__sprite" aria-hidden="true">
            <ItemSprite v-if="option.item" :item="option.item" size="sm" />
            <span v-else class="held-item-select__sprite-placeholder">—</span>
          </span>
          <span class="held-item-select__option-copy">
            <span class="held-item-select__option-label">{{ option.label }}</span>
            <span v-if="option.detail" class="held-item-select__option-detail">{{ option.detail }}</span>
          </span>
          <span v-if="isSelected(option)" class="held-item-select__selected-mark" aria-hidden="true">✓</span>
        </button>

        <p v-if="options.length === 1 && searchTerm.trim()" class="held-item-select__empty">
          No matching items.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.held-item-select {
  position: relative;
  width: min(100%, 28rem);
}

.held-item-select__trigger {
  display: inline-grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.45rem;
  width: min(100%, 18rem);
  min-height: 2.1rem;
  border: 1px solid var(--accent, #fabd2f);
  border-radius: 4px;
  background: var(--paper, #1d2021);
  color: var(--ink-bright, #fbf1c7);
  padding: 0.1rem 0.45rem;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.12);
}

.held-item-select__trigger:hover,
.held-item-select__trigger:focus-visible {
  background: var(--paper-hover, #32302f);
  outline: none;
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.2);
}

.held-item-select__trigger--empty {
  color: var(--ink-faint, #928374);
}

.held-item-select__sprite {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  flex: 0 0 1.6rem;
}

.held-item-select__sprite-placeholder {
  color: var(--ink-faint, #928374);
  font-size: 0.78rem;
}

.held-item-select__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.held-item-select__chevron {
  color: var(--ink-muted, #a89984);
  font-size: 0.78rem;
}

.held-item-select__menu {
  position: absolute;
  z-index: 40;
  top: calc(100% + 0.3rem);
  left: 0;
  width: min(28rem, calc(100vw - 2rem));
  border: 1px solid var(--rule-strong, #665c54);
  border-radius: 10px;
  background: var(--paper-soft, #282828);
  box-shadow: 0 18px 38px rgba(0, 0, 0, 0.58);
  padding: 0.45rem;
}

.held-item-select__search-label {
  display: block;
  margin-bottom: 0.4rem;
}

.held-item-select__search {
  width: 100%;
  border: 1px solid var(--rule-soft, #504945);
  border-radius: 8px;
  background: var(--paper, #1d2021);
  color: var(--ink-bright, #fbf1c7);
  padding: 0.35rem 0.5rem;
  outline: none;
}

.held-item-select__search:focus {
  border-color: var(--accent, #fabd2f);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.14);
}

.held-item-select__list {
  max-height: 20rem;
  overflow: auto;
  padding: 0.1rem;
}

.held-item-select__option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ink, #ebdbb2);
  padding: 0.35rem 0.4rem;
  text-align: left;
  cursor: pointer;
}

.held-item-select__option:hover,
.held-item-select__option--active {
  border-color: var(--rule-soft, #504945);
  background: var(--paper-hover, #32302f);
}

.held-item-select__option--selected {
  border-color: rgba(250, 189, 47, 0.55);
  background: rgba(250, 189, 47, 0.09);
}

.held-item-select__option--empty .held-item-select__option-label {
  color: var(--ink-faint, #928374);
  font-style: italic;
}

.held-item-select__option-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
}

.held-item-select__option-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-bright, #fbf1c7);
}

.held-item-select__option-detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-muted, #a89984);
  font-size: 0.74rem;
}

.held-item-select__selected-mark {
  color: var(--accent, #fabd2f);
  font-weight: 700;
}

.held-item-select__empty {
  margin: 0.5rem;
  color: var(--ink-faint, #928374);
  font-style: italic;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 720px) {
  .held-item-select,
  .held-item-select__trigger,
  .held-item-select__menu {
    width: 100%;
  }
}
</style>
