<script setup lang="ts">
import { computed } from 'vue'
import {
  MOVE_VFX_DEBUG_PREVIEW_OPTIONS,
  type MoveVfxDebugPreviewOption,
} from '~/utils/moveVfxDebugHarness'
import type { MoveVfxKind } from '~/types/moveAnimation'
import type { SpawnedPokemon } from '~/types/pokemon'

const props = defineProps<{
  selectedId: string | null
  spawnedPokemon: SpawnedPokemon[]
  controllablePlacementIds?: readonly string[]
  activeCount?: number
}>()

const emit = defineEmits<{
  (event: 'preview-kind', kind: MoveVfxKind): void
  (event: 'preview-all'): void
  (event: 'clear'): void
}>()

const selectedToken = computed(() => props.spawnedPokemon.find((pokemon) => pokemon.id === props.selectedId) ?? null)
const hasSelection = computed(() => Boolean(selectedToken.value))
const selectedTokenIsControllable = computed(() => (
  Boolean(props.selectedId)
  && (props.controllablePlacementIds?.includes(props.selectedId ?? '') ?? true)
))
const canPreviewSelection = computed(() => hasSelection.value && selectedTokenIsControllable.value)
const previewOptions = computed<readonly MoveVfxDebugPreviewOption[]>(() => MOVE_VFX_DEBUG_PREVIEW_OPTIONS)
const selectedTokenLabel = computed(() => {
  const token = selectedToken.value
  if (!token) return 'No token selected'

  return token.species || token.sheetSlug || token.id
})
const previewStatusText = computed(() => {
  if (!hasSelection.value) return 'Select a token on the map to enable synthetic previews.'
  if (!selectedTokenIsControllable.value) return `Selected token ${selectedTokenLabel.value} is not controllable, so previews are disabled.`
  return `Previewing from ${selectedTokenLabel.value}`
})
</script>

<template>
  <section
    class="move-vfx-debug-panel"
    aria-label="Move VFX debug harness"
    @click.stop
    @mousedown.stop
    @pointerdown.stop
    @wheel.stop
  >
    <header class="move-vfx-debug-panel__header">
      <div>
        <p class="move-vfx-debug-panel__eyebrow">Dev-only</p>
        <h2 class="move-vfx-debug-panel__title">Move VFX harness</h2>
      </div>
      <button
        class="move-vfx-debug-panel__clear"
        type="button"
        :disabled="(activeCount ?? 0) <= 0"
        @click="emit('clear')"
      >
        Clear
      </button>
    </header>

    <p class="move-vfx-debug-panel__status" :class="{ 'is-missing': !canPreviewSelection }">
      {{ previewStatusText }}
      <span v-if="activeCount"> · {{ activeCount }} active</span>
    </p>

    <button
      class="move-vfx-debug-panel__all"
      type="button"
      :disabled="!canPreviewSelection"
      @click="emit('preview-all')"
    >
      Play all primitives
    </button>

    <div class="move-vfx-debug-panel__grid">
      <button
        v-for="option in previewOptions"
        :key="option.kind"
        class="move-vfx-debug-panel__button"
        type="button"
        :disabled="!canPreviewSelection"
        :title="option.description"
        @click="emit('preview-kind', option.kind)"
      >
        {{ option.label }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.move-vfx-debug-panel {
  position: absolute;
  right: calc(var(--map-overlay-gutter, 0.75rem) + 0.25rem);
  bottom: calc(var(--map-overlay-gutter, 0.75rem) + 0.25rem);
  z-index: 10820;
  width: min(24rem, calc(100vw - var(--map-nav-rail-width, 0px) - 2rem));
  padding: 0.82rem;
  border: 1px solid color-mix(in srgb, var(--accent) 55%, rgba(255, 255, 255, 0.24));
  border-radius: 1rem;
  background: color-mix(in srgb, rgba(7, 9, 13, 0.9) 88%, var(--paper));
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.38);
  color: var(--ink-bright);
  backdrop-filter: blur(12px);
}

.move-vfx-debug-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.move-vfx-debug-panel__eyebrow,
.move-vfx-debug-panel__title,
.move-vfx-debug-panel__status {
  margin: 0;
}

.move-vfx-debug-panel__eyebrow {
  color: color-mix(in srgb, var(--accent) 78%, white 14%);
  font-size: 0.66rem;
  font-weight: 950;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.move-vfx-debug-panel__title {
  margin-top: 0.1rem;
  font-size: 0.98rem;
  line-height: 1.1;
}

.move-vfx-debug-panel__status {
  margin-top: 0.58rem;
  color: color-mix(in srgb, var(--ink-bright) 74%, transparent);
  font-size: 0.75rem;
  font-weight: 760;
  line-height: 1.35;
}

.move-vfx-debug-panel__status.is-missing {
  color: color-mix(in srgb, var(--warn, #ffd166) 72%, white 8%);
}

.move-vfx-debug-panel__clear,
.move-vfx-debug-panel__all,
.move-vfx-debug-panel__button {
  border: 1px solid color-mix(in srgb, var(--accent) 46%, rgba(255, 255, 255, 0.22));
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 22%, rgba(255, 255, 255, 0.08));
  color: var(--ink-bright);
  font: inherit;
  font-size: 0.73rem;
  font-weight: 900;
  cursor: pointer;
}

.move-vfx-debug-panel__clear {
  flex: 0 0 auto;
  padding: 0.34rem 0.62rem;
}

.move-vfx-debug-panel__all {
  width: 100%;
  margin-top: 0.72rem;
  padding: 0.52rem 0.72rem;
}

.move-vfx-debug-panel__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.42rem;
  margin-top: 0.55rem;
}

.move-vfx-debug-panel__button {
  min-height: 2rem;
  padding: 0.42rem 0.48rem;
  line-height: 1.12;
}

.move-vfx-debug-panel__clear:not(:disabled):hover,
.move-vfx-debug-panel__all:not(:disabled):hover,
.move-vfx-debug-panel__button:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--accent) 78%, white 18%);
  background: color-mix(in srgb, var(--accent) 36%, rgba(255, 255, 255, 0.12));
}

.move-vfx-debug-panel__clear:disabled,
.move-vfx-debug-panel__all:disabled,
.move-vfx-debug-panel__button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 840px) {
  .move-vfx-debug-panel {
    right: var(--map-overlay-gutter, 0.75rem);
    left: var(--map-overlay-gutter, 0.75rem);
    width: auto;
  }
}
</style>
