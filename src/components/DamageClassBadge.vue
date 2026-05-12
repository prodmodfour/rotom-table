<script setup lang="ts">
import { computed } from 'vue'

const CATEGORY_SLUGS: Record<string, string> = {
  physical: 'physical',
  special: 'special',
  status: 'status',
}

const titleCase = (value: string) =>
  value ? value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase() : 'Unknown'

const props = withDefaults(defineProps<{
  category: string | null | undefined
  size?: 'xs' | 'sm' | 'md' | 'lg'
  decorative?: boolean
}>(), {
  size: 'sm',
  decorative: false,
})

const rawCategory = computed(() => String(props.category ?? '').trim())
const normalizedCategory = computed(() => CATEGORY_SLUGS[rawCategory.value.toLowerCase()])
const slug = computed(() => normalizedCategory.value ?? 'status')
const label = computed(() => titleCase(normalizedCategory.value ?? (rawCategory.value || 'Status')))
const src = computed(() => `/badges/categories/${slug.value}.png`)
const alt = computed(() => props.decorative ? '' : `${label.value} damage class`)
</script>

<template>
  <img
    class="source-badge damage-class-badge"
    :class="`source-badge--${size}`"
    :src="src"
    :alt="alt"
    :title="label"
    :aria-hidden="decorative ? 'true' : undefined"
    draggable="false"
  />
</template>

<style scoped>
.source-badge {
  display: inline-block;
  width: auto;
  max-width: 100%;
  object-fit: contain;
  object-position: center;
  vertical-align: middle;
  user-select: none;
}

.source-badge--xs { height: 1.18rem; }
.source-badge--sm { height: 1.5rem; }
.source-badge--md { height: 1.9rem; }
.source-badge--lg { height: 2.35rem; }
</style>
