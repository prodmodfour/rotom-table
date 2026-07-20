<script setup lang="ts">
interface AttackOfOpportunityAttentionMarker {
  readonly id: string
  readonly left: number
  readonly top: number
}

defineProps<{
  markers: readonly AttackOfOpportunityAttentionMarker[]
}>()
</script>

<template>
  <div v-if="markers.length" class="aoo-attention-layer" aria-hidden="true">
    <div
      v-for="marker in markers"
      :key="marker.id"
      class="aoo-attention-marker"
      :style="{ left: `${marker.left}px`, top: `${marker.top}px` }"
    >
      <span class="aoo-attention-marker__ring" />
      <span class="aoo-attention-marker__label">AoO checkpoint</span>
    </div>
  </div>
</template>

<style scoped>
.aoo-attention-layer {
  position: absolute;
  z-index: 8;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.aoo-attention-marker {
  position: absolute;
  width: 82px;
  height: 82px;
  transform: translate(-50%, -50%);
}

.aoo-attention-marker__ring {
  position: absolute;
  inset: 0;
  border: 3px solid #ef4444;
  border-radius: 999px;
  box-shadow: 0 0 0 7px color-mix(in srgb, #ef4444 18%, transparent), 0 0 24px color-mix(in srgb, #ef4444 58%, transparent);
}

.aoo-attention-marker__label {
  position: absolute;
  top: calc(100% + 0.25rem);
  left: 50%;
  padding: 0.2rem 0.42rem;
  border: 1px solid color-mix(in srgb, #ef4444 70%, var(--rule-strong));
  border-radius: 999px;
  background: color-mix(in srgb, var(--paper) 94%, transparent);
  box-shadow: 0 5px 14px rgba(0, 0, 0, 0.3);
  color: #dc2626;
  font-size: 0.64rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  transform: translateX(-50%);
  white-space: nowrap;
}

@media (prefers-reduced-motion: no-preference) {
  .aoo-attention-marker__ring {
    animation: aoo-attention-pulse 1.5s ease-in-out infinite;
  }

  @keyframes aoo-attention-pulse {
    0%, 100% { opacity: 0.72; transform: scale(0.94); }
    50% { opacity: 1; transform: scale(1.06); }
  }
}
</style>
