<script setup lang="ts">
import { computed } from 'vue'
import type { SpriteVisualBounds } from '~/types/pokemon'
import { getSpriteVisualBoundsFrameDebugMetrics } from '~/utils/spriteVisualBounds'

const props = defineProps<{
  species: string
  spriteUrl: string | null
  visualBounds?: SpriteVisualBounds | null
  showVisualBoundsOverlay?: boolean
}>()

const formatDebugPercent = (value: number): string => `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`

const formatDebugPixels = (value: number): string => `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}px`

const spriteVisualBoundsDebugMetrics = computed(() => getSpriteVisualBoundsFrameDebugMetrics(props.visualBounds))

const spriteFrameStyle = computed(() => {
  const metrics = spriteVisualBoundsDebugMetrics.value

  return {
    '--sprite-visual-translate-x': `${metrics.translation.xPercent}%`,
    '--sprite-visual-translate-y': `${metrics.translation.yPercent}%`,
    '--sprite-debug-canvas-left': `${metrics.canvas.leftPercent}%`,
    '--sprite-debug-canvas-top': `${metrics.canvas.topPercent}%`,
    '--sprite-debug-canvas-width': `${metrics.canvas.widthPercent}%`,
    '--sprite-debug-canvas-height': `${metrics.canvas.heightPercent}%`,
    '--sprite-debug-bounds-left': `${metrics.bounds?.leftPercent ?? 0}%`,
    '--sprite-debug-bounds-top': `${metrics.bounds?.topPercent ?? 0}%`,
    '--sprite-debug-bounds-width': `${metrics.bounds?.widthPercent ?? 0}%`,
    '--sprite-debug-bounds-height': `${metrics.bounds?.heightPercent ?? 0}%`,
    '--sprite-debug-body-center-x': `${metrics.bodyCenter?.xPercent ?? metrics.canvasCenter.xPercent}%`,
    '--sprite-debug-body-center-y': `${metrics.bodyCenter?.yPercent ?? metrics.canvasCenter.yPercent}%`,
  }
})

const spriteVisualBoundsDebugReadout = computed(() => {
  const metrics = spriteVisualBoundsDebugMetrics.value
  const bounds = props.visualBounds

  return {
    floating: metrics.floating ? 'yes' : 'no',
    canvas: bounds ? `${formatDebugPixels(bounds.canvasWidth)} × ${formatDebugPixels(bounds.canvasHeight)}` : 'missing',
    bounds: metrics.bounds && bounds
      ? `L ${formatDebugPixels(bounds.left)} T ${formatDebugPixels(bounds.top)} · ${formatDebugPixels(bounds.width)} × ${formatDebugPixels(bounds.height)}`
      : 'No visual-bounds metadata',
    bodyCenter: metrics.bodyCenter
      ? `${formatDebugPercent(metrics.bodyCenter.xPercent)} / ${formatDebugPercent(metrics.bodyCenter.yPercent)}`
      : 'missing',
    cageCenter: `${formatDebugPercent(metrics.cageCenter.xPercent)} / ${formatDebugPercent(metrics.cageCenter.yPercent)}`,
    translation: `${formatDebugPercent(metrics.translation.xPercent)} / ${formatDebugPercent(metrics.translation.yPercent)}`,
  }
})
</script>

<template>
  <div class="sprite-frame" :style="spriteFrameStyle">
    <div class="sprite-frame__inner">
      <img
        v-if="spriteUrl"
        :src="spriteUrl"
        :alt="species"
      />
      <span v-else class="sprite-missing">no sprite</span>

      <div
        v-if="showVisualBoundsOverlay"
        class="sprite-visual-bounds-debug"
        aria-label="Sprite visual-bounds debug overlay"
      >
        <span class="sprite-visual-bounds-debug__cage-centre" aria-hidden="true" />
        <span class="sprite-visual-bounds-debug__cage-label" aria-hidden="true">cage centre</span>

        <div class="sprite-visual-bounds-debug__artwork" aria-hidden="true">
          <div class="sprite-visual-bounds-debug__canvas">
            <span class="sprite-visual-bounds-debug__canvas-centre" />
            <template v-if="spriteVisualBoundsDebugMetrics.bounds">
              <span class="sprite-visual-bounds-debug__bounds" />
              <span class="sprite-visual-bounds-debug__body-centre" />
            </template>
          </div>
        </div>

        <dl class="sprite-visual-bounds-debug__readout">
          <div>
            <dt>Floating</dt>
            <dd>{{ spriteVisualBoundsDebugReadout.floating }}</dd>
          </div>
          <div>
            <dt>Canvas</dt>
            <dd>{{ spriteVisualBoundsDebugReadout.canvas }}</dd>
          </div>
          <div>
            <dt>Bounds</dt>
            <dd>{{ spriteVisualBoundsDebugReadout.bounds }}</dd>
          </div>
          <div>
            <dt>Body centre</dt>
            <dd>{{ spriteVisualBoundsDebugReadout.bodyCenter }}</dd>
          </div>
          <div>
            <dt>Cage centre</dt>
            <dd>{{ spriteVisualBoundsDebugReadout.cageCenter }}</dd>
          </div>
          <div>
            <dt>Translate</dt>
            <dd>{{ spriteVisualBoundsDebugReadout.translation }}</dd>
          </div>
        </dl>
      </div>
    </div>
    <span class="bracket bracket--tl" />
    <span class="bracket bracket--tr" />
    <span class="bracket bracket--bl" />
    <span class="bracket bracket--br" />
  </div>
</template>
