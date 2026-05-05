<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue'
import {
  describeRef,
  findAbility,
  findCapability,
  findCondition,
  findMove,
  type RefKind,
} from '~/data/ptuReference'

type TooltipKind = Extract<RefKind, 'move' | 'ability' | 'capability' | 'condition'>

interface TooltipMeta {
  label: string
  value: string | number
  badge?: 'type' | 'damage-class'
}

interface TooltipSection {
  heading: string
  body: string
}

interface TooltipDetail {
  kind: TooltipKind
  name: string
  meta: TooltipMeta[]
  sections: TooltipSection[]
}

const props = defineProps<{
  /** Which reference index to look the entry up in. */
  kind: RefKind
  /** The raw name as written on the source data (pokedex / sheet). */
  name: string
  /** Optional override of the link text (e.g. ``H01 Cut``). Defaults to ``name``. */
  display?: string
}>()

const descriptor = computed(() => describeRef(props.kind, props.name))

const targetPath = computed(() => {
  const slug = descriptor.value.slug
  if (!slug) return null
  switch (props.kind) {
    case 'move':       return `/moves/${slug}`
    case 'ability':    return `/abilities/${slug}`
    case 'capability': return `/capabilities/${slug}`
    case 'condition':  return `/conditions/${slug}`
    case 'rule':       return `/rules/${slug}`
    case 'feature':    return `/features/${slug}`
    case 'edge':       return `/edges/${slug}`
    case 'item':       return `/items/${slug}`
  }
})

const labelText = computed(() => props.display ?? props.name)

const present = <T extends string | number | null | undefined>(value: T): value is Exclude<T, null | undefined | ''> =>
  value !== null && value !== undefined && value !== ''

const tooltipDetail = computed<TooltipDetail | null>(() => {
  switch (props.kind) {
    case 'move': {
      const move = findMove(props.name)
      if (!move) return null
      const meta: TooltipMeta[] = []
      if (present(move.type)) meta.push({ label: 'Type', value: move.type, badge: 'type' })
      if (present(move.damage_class)) meta.push({ label: 'Class', value: move.damage_class, badge: 'damage-class' })
      if (present(move.frequency)) meta.push({ label: 'Freq', value: move.frequency })
      if (move.damage_base !== null && move.damage_base !== undefined) meta.push({ label: 'DB', value: move.damage_base })
      if (present(move.damage_roll)) meta.push({ label: 'Roll', value: move.damage_roll })
      if (move.ac !== null && move.ac !== undefined) meta.push({ label: 'AC', value: move.ac })
      if (present(move.range)) meta.push({ label: 'Range', value: move.range })
      return {
        kind: 'move',
        name: move.name,
        meta,
        sections: present(move.effect) ? [{ heading: 'Effect', body: move.effect }] : [],
      }
    }

    case 'ability': {
      const ability = findAbility(props.name)
      if (!ability) return null
      return {
        kind: 'ability',
        name: ability.name,
        meta: present(ability.frequency) ? [{ label: 'Freq', value: ability.frequency }] : [],
        sections: [
          ...(present(ability.trigger) ? [{ heading: 'Trigger', body: ability.trigger }] : []),
          ...(present(ability.effect) ? [{ heading: 'Effect', body: ability.effect }] : []),
        ],
      }
    }

    case 'capability': {
      const capability = findCapability(props.name)
      if (!capability) return null
      return {
        kind: 'capability',
        name: capability.name,
        meta: present(capability.source) ? [{ label: 'Source', value: capability.source }] : [],
        sections: present(capability.effect) ? [{ heading: 'Effect', body: capability.effect }] : [],
      }
    }

    case 'condition': {
      const condition = findCondition(props.name)
      if (!condition) return null
      const meta: TooltipMeta[] = []
      if (present(condition.category)) meta.push({ label: 'Category', value: condition.category })
      if (present(condition.source)) meta.push({ label: 'Source', value: condition.source })
      return {
        kind: 'condition',
        name: condition.name,
        meta,
        sections: present(condition.effect) ? [{ heading: 'Effect', body: condition.effect }] : [],
      }
    }

    default:
      return null
  }
})

const linkTitle = computed(() => tooltipDetail.value ? undefined : (descriptor.value.canonical ?? props.name))

const anchorEl = ref<HTMLElement | null>(null)
const tooltipEl = ref<HTMLElement | null>(null)
const tooltipId = useId()
const isTooltipVisible = ref(false)
const tooltipReady = ref(false)
const tooltipPlacement = ref<'top' | 'bottom'>('bottom')
const tooltipPosition = ref({ top: -9999, left: -9999 })
const tooltipStyle = computed(() => ({
  top: `${tooltipPosition.value.top}px`,
  left: `${tooltipPosition.value.left}px`,
}))

let animationFrame: number | null = null
let listenersAttached = false

const updateTooltipPosition = () => {
  if (typeof window === 'undefined' || !anchorEl.value || !tooltipEl.value || !isTooltipVisible.value) return

  const margin = 12
  const gap = 8
  const anchorRect = anchorEl.value.getBoundingClientRect()
  const tooltipRect = tooltipEl.value.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const halfWidth = tooltipRect.width / 2

  let left = anchorRect.left + anchorRect.width / 2
  left = Math.max(margin + halfWidth, Math.min(viewportWidth - margin - halfWidth, left))

  let top = anchorRect.bottom + gap
  let placement: 'top' | 'bottom' = 'bottom'

  if (top + tooltipRect.height + margin > viewportHeight && anchorRect.top - gap - tooltipRect.height >= margin) {
    top = anchorRect.top - gap - tooltipRect.height
    placement = 'top'
  } else if (top + tooltipRect.height + margin > viewportHeight) {
    top = Math.max(margin, viewportHeight - margin - tooltipRect.height)
  }

  tooltipPosition.value = { top, left }
  tooltipPlacement.value = placement
  tooltipReady.value = true
}

const scheduleTooltipUpdate = () => {
  if (typeof window === 'undefined' || animationFrame !== null) return
  animationFrame = window.requestAnimationFrame(() => {
    animationFrame = null
    updateTooltipPosition()
  })
}

const addTooltipListeners = () => {
  if (typeof window === 'undefined' || listenersAttached) return
  window.addEventListener('resize', scheduleTooltipUpdate, { passive: true })
  window.addEventListener('scroll', scheduleTooltipUpdate, true)
  listenersAttached = true
}

const removeTooltipListeners = () => {
  if (typeof window === 'undefined' || !listenersAttached) return
  window.removeEventListener('resize', scheduleTooltipUpdate)
  window.removeEventListener('scroll', scheduleTooltipUpdate, true)
  listenersAttached = false
}

const cancelTooltipFrame = () => {
  if (typeof window !== 'undefined' && animationFrame !== null) {
    window.cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

const showTooltip = async () => {
  if (!tooltipDetail.value) return
  isTooltipVisible.value = true
  tooltipReady.value = false
  addTooltipListeners()
  await nextTick()
  updateTooltipPosition()
}

const hideTooltipNow = () => {
  cancelTooltipFrame()
  isTooltipVisible.value = false
  tooltipReady.value = false
  removeTooltipListeners()
}

onBeforeUnmount(() => {
  hideTooltipNow()
})
</script>

<template>
  <span
    v-if="targetPath"
    ref="anchorEl"
    class="ref-link-wrap"
    :class="{ 'ref-link-wrap--has-tooltip': tooltipDetail }"
    :data-kind="kind"
    @pointerenter="showTooltip"
    @pointerleave="hideTooltipNow"
    @focusin="showTooltip"
    @focusout="hideTooltipNow"
    @keydown.esc.stop.prevent="hideTooltipNow"
  >
    <NuxtLink
      :to="targetPath"
      class="ref-link"
      :data-kind="kind"
      :title="linkTitle"
      :aria-describedby="tooltipDetail && isTooltipVisible ? tooltipId : undefined"
    >{{ labelText }}</NuxtLink>

    <Teleport to="body">
      <div
        v-if="tooltipDetail && isTooltipVisible"
        :id="tooltipId"
        ref="tooltipEl"
        class="ref-tooltip"
        :class="[
          `ref-tooltip--${tooltipDetail.kind}`,
          `ref-tooltip--${tooltipPlacement}`,
          { 'ref-tooltip--ready': tooltipReady },
        ]"
        :style="tooltipStyle"
        role="tooltip"
      >
        <header class="ref-tooltip__header">
          <span class="ref-tooltip__kind">{{ tooltipDetail.kind }}</span>
          <strong>{{ tooltipDetail.name }}</strong>
        </header>

        <div v-if="tooltipDetail.meta.length" class="ref-tooltip__meta">
          <span
            v-for="meta in tooltipDetail.meta"
            :key="`${meta.label}-${meta.value}`"
            class="ref-tooltip__chip"
            :class="{ 'ref-tooltip__chip--badge': meta.badge }"
          >
            <template v-if="meta.badge === 'type'">
              <TypeBadge :type="String(meta.value)" size="xs" />
            </template>
            <template v-else-if="meta.badge === 'damage-class'">
              <DamageClassBadge :category="String(meta.value)" size="xs" />
            </template>
            <template v-else>
              <span class="ref-tooltip__chip-label">{{ meta.label }}</span>
              <span>{{ meta.value }}</span>
            </template>
          </span>
        </div>

        <section
          v-for="section in tooltipDetail.sections"
          :key="section.heading"
          class="ref-tooltip__section"
        >
          <h4>{{ section.heading }}</h4>
          <p>{{ section.body }}</p>
        </section>
      </div>
    </Teleport>
  </span>
  <span v-else class="ref-link ref-link--missing" :title="`No ${kind} entry for \u201c${name}\u201d`">{{ labelText }}</span>
</template>

<style scoped>
.ref-link-wrap {
  position: relative;
  display: inline-block;
  max-width: 100%;
  vertical-align: baseline;
}

.ref-link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
  text-decoration-style: dotted;
  cursor: pointer;
  transition: color 0.12s ease, text-decoration-color 0.12s ease;
}

.ref-link:hover,
.ref-link:focus-visible {
  color: var(--ink-bright);
  text-decoration-style: solid;
  text-decoration-color: var(--accent);
}

.ref-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 3px;
}

.ref-link--missing {
  cursor: help;
  text-decoration-color: var(--rule);
  color: var(--ink-muted);
}

.ref-link--missing:hover {
  color: var(--ink-muted);
}

.ref-tooltip {
  position: fixed;
  z-index: 10000;
  width: min(28rem, calc(100vw - 1.5rem));
  max-height: min(28rem, calc(100vh - 1.5rem));
  overflow: auto;
  overscroll-behavior: contain;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--rule-strong);
  border-radius: 12px;
  background: var(--paper-soft);
  background: color-mix(in srgb, var(--paper-soft) 96%, black 4%);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.65);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: 0.84rem;
  line-height: 1.45;
  text-align: left;
  white-space: normal;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%) translateY(-0.2rem);
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.ref-tooltip--top {
  transform: translateX(-50%) translateY(0.2rem);
}

.ref-tooltip--ready {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.ref-tooltip__header {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.ref-tooltip__header strong {
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.12rem;
  letter-spacing: 0.02em;
}

.ref-tooltip__kind {
  color: var(--accent);
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ref-tooltip__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.28rem;
  margin-bottom: 0.55rem;
}

.ref-tooltip__chip {
  display: inline-flex;
  align-items: baseline;
  gap: 0.24rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--ink-soft);
  padding: 0.18rem 0.48rem;
  font-size: 0.74rem;
}

.ref-tooltip__chip--badge {
  padding: 0.12rem 0.18rem;
  background: transparent;
  border-color: transparent;
}

.ref-tooltip__chip-label {
  color: var(--ink-muted);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ref-tooltip__section + .ref-tooltip__section {
  margin-top: 0.55rem;
}

.ref-tooltip__section h4 {
  margin: 0 0 0.2rem;
  color: var(--accent);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ref-tooltip__section p {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-book);
  font-size: 0.98rem;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
