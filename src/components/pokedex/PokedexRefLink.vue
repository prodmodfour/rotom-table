<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue'
import type { RefTooltipDetail } from '~/utils/refLinks'
import { useAnchoredTooltip } from '~/composables/reference/useAnchoredTooltip'
import { pokedexReferencePath, type PokedexReferenceKind } from '~/utils/pokedex/refLinks'

const props = defineProps<{
  kind: PokedexReferenceKind
  name: string
  display?: string
}>()

const labelText = computed(() => props.display ?? props.name)
const targetPath = computed(() => pokedexReferencePath(props.kind, props.name))
const tooltipDetail = shallowRef<RefTooltipDetail | null>(null)
const tooltipMissing = shallowRef(false)
let tooltipLoadPromise: Promise<void> | null = null
let interactionActive = false

const tooltipId = useId()
const {
  anchorEl,
  tooltipComponent,
  isTooltipVisible,
  tooltipReady,
  tooltipPlacement,
  tooltipStyle,
  showTooltip,
  hideTooltipNow,
} = useAnchoredTooltip(() => Boolean(tooltipDetail.value))

const ensureTooltipDetail = async () => {
  if (tooltipDetail.value || tooltipMissing.value) return

  tooltipLoadPromise ??= import('~/utils/refLinks')
    .then(({ getRefTooltipDetail }) => {
      tooltipDetail.value = getRefTooltipDetail(props.kind, props.name)
      tooltipMissing.value = !tooltipDetail.value
    })
    .finally(() => {
      tooltipLoadPromise = null
    })

  await tooltipLoadPromise
}

const showTooltipWhenReady = async () => {
  interactionActive = true
  await ensureTooltipDetail()
  if (interactionActive) {
    await showTooltip()
  }
}

const hideTooltip = () => {
  interactionActive = false
  hideTooltipNow()
}
</script>

<template>
  <span
    v-if="targetPath"
    ref="anchorEl"
    class="pokedex-ref-link-wrap"
    :class="{ 'pokedex-ref-link-wrap--has-tooltip': tooltipDetail }"
    :data-kind="kind"
    @pointerenter="showTooltipWhenReady"
    @pointerleave="hideTooltip"
    @focusin="showTooltipWhenReady"
    @focusout="hideTooltip"
    @keydown.esc.stop.prevent="hideTooltip"
  >
    <NuxtLink
      :to="targetPath"
      class="pokedex-ref-link"
      :data-kind="kind"
      :aria-describedby="tooltipDetail && isTooltipVisible ? tooltipId : undefined"
      prefetch-on="interaction"
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
  <span v-else class="pokedex-ref-link pokedex-ref-link--missing">{{ labelText }}</span>
</template>

<style scoped>
.pokedex-ref-link-wrap {
  position: relative;
  display: inline-block;
  max-width: 100%;
  vertical-align: baseline;
}

.pokedex-ref-link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
  text-decoration-style: dotted;
  cursor: pointer;
  transition: color 0.12s ease, text-decoration-color 0.12s ease;
}

.pokedex-ref-link:hover,
.pokedex-ref-link:focus-visible {
  color: var(--ink-bright);
  text-decoration-style: solid;
  text-decoration-color: var(--accent);
}

.pokedex-ref-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 3px;
}

.pokedex-ref-link--missing {
  color: var(--ink-muted);
  cursor: help;
  text-decoration-color: var(--rule);
}
</style>
