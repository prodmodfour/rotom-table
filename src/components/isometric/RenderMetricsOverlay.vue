<script setup lang="ts">
import { computed } from 'vue'
import type { IsometricRenderMetricsSnapshot } from '~/utils/isometric/renderMetrics'
import { createEmptyIsometricRenderMetricsSnapshot } from '~/utils/isometric/renderMetrics'
import { createRenderMetricsOverlayViewModel } from '~/utils/isometric/renderMetricsOverlay'

const props = defineProps<{
  /** Hidden by default; callers should only enable this behind the render debug gate. */
  enabled?: boolean
  /** Optional live metrics. Null/omitted data keeps the shell useful for early Track 1 tickets. */
  metrics?: IsometricRenderMetricsSnapshot | null
  title?: string
}>()

const overlayTitle = computed(() => props.title ?? 'Render metrics')
const metricsSnapshot = computed(() => props.metrics ?? createEmptyIsometricRenderMetricsSnapshot())
const viewModel = computed(() => createRenderMetricsOverlayViewModel(metricsSnapshot.value))
</script>

<template>
  <aside
    v-if="props.enabled"
    class="render-metrics-overlay"
    aria-label="Isometric render metrics"
  >
    <header class="render-metrics-overlay__header">
      <div>
        <p class="render-metrics-overlay__eyebrow">Track 1 debug</p>
        <h2>{{ overlayTitle }}</h2>
      </div>
      <span class="render-metrics-overlay__badge">dev</span>
    </header>

    <p class="render-metrics-overlay__sample">
      Sample: {{ viewModel.sampledAtLabel }}
    </p>

    <section class="render-metrics-overlay__section" aria-label="Frame timing metrics">
      <h3>Frames</h3>
      <dl class="render-metrics-overlay__grid">
        <div
          v-for="row in viewModel.frameRows"
          :key="row.key"
          class="render-metrics-overlay__row"
        >
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </section>

    <section class="render-metrics-overlay__section" aria-label="Frame reasons">
      <h3>Reasons</h3>
      <p class="render-metrics-overlay__muted">
        Last:
        <template v-if="viewModel.lastReasonLabels.length">
          {{ viewModel.lastReasonLabels.join(', ') }}
        </template>
        <template v-else>
          none yet
        </template>
      </p>
      <dl
        v-if="viewModel.reasonRows.length"
        class="render-metrics-overlay__grid render-metrics-overlay__grid--reasons"
      >
        <div
          v-for="row in viewModel.reasonRows"
          :key="row.key"
          class="render-metrics-overlay__row"
        >
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
      <p v-else class="render-metrics-overlay__muted">
        No frame reasons recorded yet.
      </p>
    </section>

    <section class="render-metrics-overlay__section" aria-label="WebGL renderer metrics">
      <h3>Renderer</h3>
      <p v-if="!viewModel.hasRendererInfo" class="render-metrics-overlay__muted">
        Waiting for the next renderer info sample.
      </p>
      <dl class="render-metrics-overlay__grid">
        <div
          v-for="row in viewModel.rendererRows"
          :key="row.key"
          class="render-metrics-overlay__row"
        >
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </section>
  </aside>
</template>

<style scoped>
.render-metrics-overlay {
  position: absolute;
  z-index: 12;
  right: 1rem;
  bottom: 1rem;
  width: min(22rem, calc(100% - 2rem));
  max-height: min(80vh, 42rem);
  overflow: hidden auto;
  padding: 0.8rem;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--rule-strong));
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.018)),
    color-mix(in srgb, var(--paper) 90%, transparent);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.44);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  line-height: 1.35;
  pointer-events: none;
  backdrop-filter: blur(12px) saturate(125%);
  -webkit-backdrop-filter: blur(12px) saturate(125%);
}

.render-metrics-overlay__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.55rem;
}

.render-metrics-overlay__eyebrow,
.render-metrics-overlay__sample,
.render-metrics-overlay__muted {
  margin: 0;
  color: var(--ink-muted);
}

.render-metrics-overlay__eyebrow {
  color: var(--accent);
  font-size: 0.62rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.render-metrics-overlay h2,
.render-metrics-overlay h3 {
  margin: 0;
  color: var(--ink-bright);
}

.render-metrics-overlay h2 {
  font-size: 0.92rem;
}

.render-metrics-overlay h3 {
  margin-bottom: 0.35rem;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.render-metrics-overlay__badge {
  padding: 0.12rem 0.34rem;
  border: 1px solid color-mix(in srgb, var(--accent) 52%, var(--rule-strong));
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  font-size: 0.62rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.render-metrics-overlay__section {
  margin-top: 0.72rem;
  padding-top: 0.62rem;
  border-top: 1px solid var(--rule);
}

.render-metrics-overlay__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.18rem;
  margin: 0;
}

.render-metrics-overlay__grid--reasons {
  margin-top: 0.38rem;
}

.render-metrics-overlay__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 0.75rem;
}

.render-metrics-overlay dt {
  min-width: 0;
  overflow: hidden;
  color: var(--ink-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.render-metrics-overlay dd {
  margin: 0;
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  text-align: right;
}

@media (max-width: 720px) {
  .render-metrics-overlay {
    right: 0.6rem;
    bottom: 0.6rem;
    width: min(19rem, calc(100% - 1.2rem));
    max-height: 56vh;
    font-size: 0.66rem;
  }
}
</style>
