<script setup lang="ts">
import { computed } from 'vue'
import type { AcceptedEncounterPresentation } from '#shared/encounterPresentation'

const props = defineProps<{
  presentations: readonly AcceptedEncounterPresentation[]
  reducedMotion: boolean
}>()

const hints = computed(() => props.presentations.flatMap(presentation => presentation.vfx.map(hint => ({
  ...hint,
  presentationId: presentation.presentationId,
}))))
</script>

<template>
  <div
    class="encounter-vfx"
    :class="{ 'encounter-vfx--reduced': reducedMotion }"
    aria-hidden="true"
    data-testid="encounter-vfx-overlay"
  >
    <div
      v-for="hint in hints"
      :key="`${hint.presentationId}:${hint.vfxId}`"
      class="encounter-vfx__hint"
      :class="[`encounter-vfx__hint--${hint.kind}`, `encounter-vfx__hint--${hint.tone}`]"
      :data-vfx-id="hint.vfxId"
      :data-source-participant-id="hint.sourceParticipantId ?? undefined"
      :data-target-participant-ids="hint.targetParticipantIds.join(',')"
    >
      <span>{{ hint.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.encounter-vfx {
  position: absolute;
  inset: 0;
  z-index: 24;
  display: grid;
  place-items: center;
  overflow: hidden;
  pointer-events: none;
}
.encounter-vfx__hint {
  grid-area: 1 / 1;
  min-width: 9rem;
  border: 2px solid rgb(168 145 255 / 70%);
  border-radius: 999px;
  background: radial-gradient(circle, rgb(118 88 255 / 28%), transparent 68%);
  padding: 1.3rem 2rem;
  color: white;
  font-weight: 800;
  text-align: center;
  text-shadow: 0 2px 6px black;
  animation: encounter-presentation-pulse 1.1s ease-out both;
}
.encounter-vfx__hint--positive { border-color: rgb(94 228 167 / 75%); }
.encounter-vfx__hint--negative,
.encounter-vfx__hint--warning,
.encounter-vfx__hint--urgent { border-color: rgb(255 139 92 / 80%); }
.encounter-vfx__hint--projectile,
.encounter-vfx__hint--beam { animation-name: encounter-presentation-travel; }
.encounter-vfx__hint--movement { animation-name: encounter-presentation-shift; }
.encounter-vfx__hint--area,
.encounter-vfx__hint--burst { min-width: 16rem; min-height: 8rem; }
.encounter-vfx--reduced .encounter-vfx__hint {
  animation: encounter-presentation-fade 0.3s linear both;
}
@keyframes encounter-presentation-pulse {
  from { opacity: 0; transform: scale(0.45); }
  40% { opacity: 1; }
  to { opacity: 0; transform: scale(1.35); }
}
@keyframes encounter-presentation-travel {
  from { opacity: 0; transform: translateX(-18vw) scale(0.7); }
  45% { opacity: 1; }
  to { opacity: 0; transform: translateX(18vw) scale(1); }
}
@keyframes encounter-presentation-shift {
  from { opacity: 0; transform: translateY(8vh); }
  35% { opacity: 1; }
  to { opacity: 0; transform: translateY(-8vh); }
}
@keyframes encounter-presentation-fade {
  from { opacity: 0.85; }
  to { opacity: 0; }
}
</style>
