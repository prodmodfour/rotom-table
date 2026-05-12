<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PokedexEntrySummary } from '~/utils/pokedex/entryIndex'

const props = defineProps<{
  entries: PokedexEntrySummary[]
  errorMessage: string | null
  loading: boolean
  selectedId: string | null
}>()

const emit = defineEmits<{
  scroll: []
  'entry-list-ref': [element: HTMLElement | null]
}>()

const ESTIMATED_ENTRY_HEIGHT = 74
const ENTRY_GAP = 8
const ENTRY_STRIDE = ESTIMATED_ENTRY_HEIGHT + ENTRY_GAP
const OVERSCAN_COUNT = 8

const entryListRef = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
let resizeObserver: ResizeObserver | null = null

const emitEntryListRef = () => {
  emit('entry-list-ref', entryListRef.value)
}

const updateViewportHeight = () => {
  viewportHeight.value = entryListRef.value?.clientHeight ?? 0
}

const updateScrollTop = () => {
  scrollTop.value = entryListRef.value?.scrollTop ?? 0
}

const handleScroll = () => {
  updateScrollTop()
  emit('scroll')
}

const totalHeight = computed(() => (
  props.entries.length > 0
    ? props.entries.length * ESTIMATED_ENTRY_HEIGHT + (props.entries.length - 1) * ENTRY_GAP
    : 0
))
const visibleStart = computed(() => Math.max(
  0,
  Math.floor(scrollTop.value / ENTRY_STRIDE) - OVERSCAN_COUNT,
))
const visibleEnd = computed(() => Math.min(
  props.entries.length,
  Math.ceil((scrollTop.value + viewportHeight.value) / ENTRY_STRIDE) + OVERSCAN_COUNT,
))
const visibleEntries = computed(() => props.entries.slice(visibleStart.value, visibleEnd.value))
const visibleOffset = computed(() => visibleStart.value * ENTRY_STRIDE)

onMounted(() => {
  emitEntryListRef()
  updateViewportHeight()
  updateScrollTop()

  if (entryListRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(updateViewportHeight)
    resizeObserver.observe(entryListRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  emit('entry-list-ref', null)
})

watch(entryListRef, emitEntryListRef)
watch(() => props.entries.length, async () => {
  await nextTick()
  updateViewportHeight()
  updateScrollTop()
})
</script>

<template>
  <div class="entry-list-panel">
    <div v-if="entries.length > 0" ref="entryListRef" class="entry-list" @scroll.passive="handleScroll">
      <div class="entry-list__spacer" :style="{ height: `${totalHeight}px` }">
        <div class="entry-list__items" :style="{ transform: `translateY(${visibleOffset}px)` }">
          <PokedexEntryListItem
            v-for="entry in visibleEntries"
            :key="entry.id"
            :entry="entry"
            :selected="entry.id === selectedId"
          />
        </div>
      </div>
    </div>

    <p v-else-if="loading" class="empty-state">
      Loading searchable Pokédex index…
    </p>

    <p v-else-if="errorMessage" class="empty-state empty-state--error">
      {{ errorMessage }}
    </p>

    <p v-else class="empty-state">
      No Pokédex entries match those filters.
    </p>
  </div>
</template>

<style scoped>
.entry-list-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.entry-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  position: relative;
}

.entry-list__spacer {
  min-height: 100%;
  position: relative;
}

.entry-list__items {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  left: 0;
  position: absolute;
  right: 0;
  top: 0;
  will-change: transform;
}

.empty-state {
  margin: 0 0 0.9rem;
  color: var(--ink-muted);
  line-height: 1.5;
  font-size: 0.85rem;
}

.empty-state--error {
  color: var(--danger, #dc2626);
}

@media (max-width: 760px) {
  .entry-list-panel {
    overflow: visible;
  }

  .entry-list {
    max-height: 50vh;
    overflow: auto;
  }
}
</style>
