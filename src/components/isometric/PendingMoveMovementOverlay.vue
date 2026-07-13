<script setup lang="ts">
import { computed } from 'vue'
import type { MoveAutomationAreaDirection } from '~/types/moveAutomation'
import type { GridAnchor } from '~/types/map'
import type { PendingMoveResponseOptionReference } from '~/composables/map-editor/usePendingMoveResponses'

interface PendingMoveMovementOverlayChoice {
  readonly reference: PendingMoveResponseOptionReference
  readonly actorPlacementId: string
  readonly canonicalMoveId: string
  readonly destination: GridAnchor
  readonly direction?: MoveAutomationAreaDirection
  readonly left: number
  readonly top: number
  readonly disabled: boolean
}

const props = defineProps<{
  choices: readonly PendingMoveMovementOverlayChoice[]
}>()

const emit = defineEmits<{
  choose: [reference: PendingMoveResponseOptionReference]
}>()

const moveNames = computed(() => [...new Set(props.choices.map(choice => choice.canonicalMoveId))])

const promptLabel = computed(() => moveNames.value.length === 1
  ? `Select a server-approved destination for ${moveNames.value[0]}.`
  : 'Select a server-approved destination on the battlefield.')

const directionLabel = (direction: MoveAutomationAreaDirection): string => (
  direction
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
)

const choiceLabel = (choice: PendingMoveMovementOverlayChoice): string => {
  const destination = choice.destination
  const coordinate = `(${destination.x}, ${destination.y}, ${destination.z})`
  return choice.direction
    ? `${choice.canonicalMoveId}: choose ${directionLabel(choice.direction)} movement to ${coordinate}`
    : `${choice.canonicalMoveId}: choose movement destination ${coordinate}`
}

const choose = (choice: PendingMoveMovementOverlayChoice): void => {
  if (choice.disabled) return
  emit('choose', {
    resolutionId: choice.reference.resolutionId,
    windowId: choice.reference.windowId,
    optionId: choice.reference.optionId,
  })
}
</script>

<template>
  <div
    v-if="props.choices.length"
    class="pending-movement-choice-hud"
    aria-live="polite"
  >
    <strong>Choose movement</strong>
    <span>{{ promptLabel }}</span>
  </div>

  <div
    v-if="props.choices.length"
    class="pending-movement-choice-layer"
    aria-label="Legal move destinations"
    @contextmenu.prevent
  >
    <button
      v-for="choice in props.choices"
      :key="`${choice.reference.resolutionId}:${choice.reference.windowId}:${choice.reference.optionId}`"
      type="button"
      class="pending-movement-choice-button"
      :style="{ left: `${choice.left}px`, top: `${choice.top}px` }"
      :disabled="choice.disabled"
      :aria-label="choiceLabel(choice)"
      :title="choiceLabel(choice)"
      @pointerdown.stop
      @click.stop="choose(choice)"
    >
      <span aria-hidden="true">◆</span>
      <small v-if="choice.direction">{{ directionLabel(choice.direction) }}</small>
    </button>
  </div>
</template>

<style scoped>
.pending-movement-choice-hud {
  position: absolute;
  z-index: 10;
  top: var(--map-top-info-top, calc(var(--map-overlay-gutter, 0.75rem) + var(--map-initiative-info-bar-height, 4rem) + 0.6rem));
  left: 50%;
  display: grid;
  gap: 0.15rem;
  max-width: min(28rem, calc(100% - 2rem));
  padding: 0.55rem 0.8rem;
  border: 1px solid color-mix(in srgb, var(--accent) 68%, var(--rule-soft));
  border-radius: 12px;
  background: color-mix(in srgb, var(--paper) 94%, transparent);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
  color: var(--ink);
  text-align: center;
  transform: translateX(-50%);
  pointer-events: none;
}

.pending-movement-choice-hud strong {
  color: var(--accent);
}

.pending-movement-choice-hud span {
  font-size: 0.78rem;
}

.pending-movement-choice-layer {
  position: absolute;
  z-index: 9;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.pending-movement-choice-button {
  position: absolute;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--paper) 78%, transparent);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 20%, transparent), 0 5px 14px rgba(0, 0, 0, 0.35);
  color: var(--accent);
  cursor: crosshair;
  transform: translate(-50%, -50%);
  pointer-events: auto;
}

.pending-movement-choice-button small {
  position: absolute;
  top: 100%;
  padding: 0.1rem 0.25rem;
  border-radius: 5px;
  background: var(--paper);
  color: var(--ink);
  font-size: 0.62rem;
  font-weight: 800;
  white-space: nowrap;
}

.pending-movement-choice-button:hover,
.pending-movement-choice-button:focus-visible {
  background: var(--accent);
  color: var(--paper);
}

.pending-movement-choice-button:focus-visible {
  outline: 2px solid var(--ink-bright);
  outline-offset: 5px;
}

.pending-movement-choice-button:disabled {
  cursor: wait;
  opacity: 0.48;
}
</style>
