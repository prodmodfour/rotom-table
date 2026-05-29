<script setup lang="ts">
import { ref } from 'vue'
import type { StyleValue } from 'vue'
import type { TooltipPlacement } from '~/utils/anchoredTooltip'
import type { RefTooltipDetail } from '~/utils/refLinks'

defineProps<{
  id: string
  detail: RefTooltipDetail
  placement: TooltipPlacement
  ready: boolean
  style: StyleValue
}>()

const rootEl = ref<HTMLElement | null>(null)

defineExpose({ rootEl })
</script>

<template>
  <div
    :id="id"
    ref="rootEl"
    class="ref-tooltip"
    :class="[
      `ref-tooltip--${detail.kind}`,
      `ref-tooltip--${placement}`,
      { 'ref-tooltip--ready': ready },
    ]"
    :style="style"
    role="tooltip"
  >
    <header class="ref-tooltip__header">
      <span class="ref-tooltip__kind">{{ detail.kind }}</span>
      <strong>{{ detail.name }}</strong>
    </header>

    <div v-if="detail.meta.length" class="ref-tooltip__meta">
      <span
        v-for="meta in detail.meta"
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
      v-for="section in detail.sections"
      :key="section.heading"
      class="ref-tooltip__section"
    >
      <h4>{{ section.heading }}</h4>
      <p>{{ section.body }}</p>
    </section>
  </div>
</template>

<style scoped>
.ref-tooltip {
  position: fixed;
  z-index: 12000;
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
