<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue'
import type { RefKind } from '~/data/ptuReference'
import { computeAnchoredTooltipPosition, type TooltipPlacement } from '~/utils/anchoredTooltip'
import { describeRefTarget, getRefTooltipDetail } from '~/utils/refLinks'

const props = defineProps<{
  /** Which reference index to look the entry up in. */
  kind: RefKind
  /** The raw name as written on the source data (pokedex / sheet). */
  name: string
  /** Optional override of the link text (e.g. ``H01 Cut``). Defaults to ``name``. */
  display?: string
}>()

const refTarget = computed(() => describeRefTarget(props.kind, props.name))
const descriptor = computed(() => refTarget.value.descriptor)
const targetPath = computed(() => refTarget.value.targetPath)

const labelText = computed(() => props.display ?? props.name)

const tooltipDetail = computed(() => getRefTooltipDetail(props.kind, props.name))

const linkTitle = computed(() => tooltipDetail.value ? undefined : (descriptor.value.canonical ?? props.name))

const anchorEl = ref<HTMLElement | null>(null)
const tooltipComponent = ref<{ rootEl: HTMLElement | null } | null>(null)
const tooltipId = useId()
const isTooltipVisible = ref(false)
const tooltipReady = ref(false)
const tooltipPlacement = ref<TooltipPlacement>('bottom')
const tooltipPosition = ref({ top: -9999, left: -9999 })
const tooltipStyle = computed(() => ({
  top: `${tooltipPosition.value.top}px`,
  left: `${tooltipPosition.value.left}px`,
}))

let animationFrame: number | null = null
let listenersAttached = false

const updateTooltipPosition = () => {
  const tooltipEl = tooltipComponent.value?.rootEl
  if (typeof window === 'undefined' || !anchorEl.value || !tooltipEl || !isTooltipVisible.value) return

  const { top, left, placement } = computeAnchoredTooltipPosition(
    anchorEl.value.getBoundingClientRect(),
    tooltipEl.getBoundingClientRect(),
    { width: window.innerWidth, height: window.innerHeight },
  )

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
      <ReferenceTooltip
        v-if="tooltipDetail && isTooltipVisible"
        :id="tooltipId"
        ref="tooltipComponent"
        :detail="tooltipDetail"
        :placement="tooltipPlacement"
        :ready="tooltipReady"
        :style="tooltipStyle"
      />
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

</style>
