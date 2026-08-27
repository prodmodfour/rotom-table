<script setup lang="ts">
import { computed } from 'vue'
import { moveVfxColorForType } from '~/utils/moveAnimationPalette'

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

const TYPE_MARKS: Record<string, string> = {
  normal: 'NO',
  fighting: 'FG',
  flying: 'FL',
  poison: 'PO',
  ground: 'GR',
  rock: 'RO',
  bug: 'BU',
  ghost: 'GH',
  steel: 'ST',
  fire: 'FI',
  water: 'WA',
  grass: 'GA',
  electric: 'EL',
  psychic: 'PS',
  ice: 'IC',
  dragon: 'DR',
  dark: 'DA',
  fairy: 'FA',
  unknown: '??',
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
const mark = computed(() => TYPE_MARKS[slug.value] ?? TYPE_MARKS.unknown)
const palette = computed(() => moveVfxColorForType(label.value))
const badgeStyle = computed(() => ({
  '--badge-color': palette.value.primary,
  '--badge-accent': palette.value.glow,
}))
const ariaLabel = computed(() => props.decorative ? undefined : `${label.value} type`)
</script>

<template>
  <span
    class="source-badge type-badge"
    :class="`source-badge--${size}`"
    :data-type="slug"
    :style="badgeStyle"
    :aria-label="ariaLabel"
    :aria-hidden="decorative ? 'true' : undefined"
    :title="label"
  >
    <span class="source-badge__mark" aria-hidden="true">{{ mark }}</span>
    <span class="source-badge__label" aria-hidden="true">{{ label }}</span>
  </span>
</template>

<style scoped>
.source-badge {
  --badge-height: 1.5rem;
  --badge-font-size: 0.66rem;
  --badge-mark-size: 1.16rem;

  display: inline-flex;
  max-width: 100%;
  height: var(--badge-height);
  flex: 0 0 auto;
  align-items: center;
  gap: 0.28rem;
  padding: 0.11rem 0.48rem 0.11rem 0.14rem;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--badge-color) 58%, var(--rule-soft));
  border-radius: 999px;
  background:
    linear-gradient(110deg, color-mix(in srgb, var(--badge-color) 18%, transparent), transparent 58%),
    color-mix(in srgb, var(--paper-soft) 94%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--badge-color) 18%, transparent);
  color: var(--ink-bright);
  font-family: 'Atkinson Hyperlegible', sans-serif;
  font-size: var(--badge-font-size);
  font-weight: 900;
  letter-spacing: 0.055em;
  line-height: 1;
  text-transform: uppercase;
  vertical-align: middle;
  white-space: nowrap;
}

.source-badge__mark {
  display: grid;
  width: var(--badge-mark-size);
  height: var(--badge-mark-size);
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--badge-color) 68%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--badge-color) 18%, var(--paper));
  color: var(--badge-color);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.52em;
  font-weight: 900;
  letter-spacing: -0.06em;
  text-indent: -0.02em;
}

.source-badge__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-badge--xs {
  --badge-height: 1.18rem;
  --badge-font-size: 0.55rem;
  --badge-mark-size: 0.88rem;

  gap: 0.2rem;
  padding-right: 0.36rem;
}

.source-badge--sm {
  --badge-height: 1.5rem;
  --badge-font-size: 0.66rem;
  --badge-mark-size: 1.16rem;
}

.source-badge--md {
  --badge-height: 1.9rem;
  --badge-font-size: 0.78rem;
  --badge-mark-size: 1.48rem;

  gap: 0.36rem;
  padding-right: 0.62rem;
}

.source-badge--lg {
  --badge-height: 2.35rem;
  --badge-font-size: 0.92rem;
  --badge-mark-size: 1.83rem;

  gap: 0.44rem;
  padding-right: 0.76rem;
}
</style>
