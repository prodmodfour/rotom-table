<script setup lang="ts">
import { computed } from 'vue'

const TYPE_SLUGS: Record<string, string> = {
  normal: 'normal',
  fighting: 'fighting',
  flying: 'flying',
  poison: 'poison',
  ground: 'ground',
  rock: 'rock',
  bug: 'bug',
  ghost: 'ghost',
  steel: 'steel',
  fire: 'fire',
  water: 'water',
  grass: 'grass',
  electric: 'electric',
  psychic: 'psychic',
  ice: 'ice',
  dragon: 'dragon',
  dark: 'dark',
  fairy: 'fairy',
  unknown: 'unknown',
  '???': 'unknown',
}

const titleCase = (value: string) =>
  value ? value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase() : 'Unknown'

const props = withDefaults(defineProps<{
  type: string | null | undefined
  size?: 'xs' | 'sm' | 'md' | 'lg'
  decorative?: boolean
}>(), {
  size: 'sm',
  decorative: false,
})

const rawType = computed(() => String(props.type ?? '').trim())
const slug = computed(() => TYPE_SLUGS[rawType.value.toLowerCase()] ?? 'unknown')
const label = computed(() => (slug.value === 'unknown' ? (rawType.value || 'Unknown') : titleCase(slug.value)))
const src = computed(() => `/badges/types/${slug.value}.png`)
const alt = computed(() => props.decorative ? '' : `${label.value} type`)
</script>

<template>
  <img
    class="source-badge type-badge"
    :class="`source-badge--${size}`"
    :src="src"
    :alt="alt"
    :title="label"
    :aria-hidden="decorative ? 'true' : undefined"
    draggable="false"
    loading="lazy"
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
