<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  defaultPokedexProfileImageCropControls,
  drawPokedexProfileImageCrop,
  getPokedexProfileImageSourceMetrics,
  POKEDEX_PROFILE_IMAGE_HEIGHT,
  POKEDEX_PROFILE_IMAGE_WIDTH,
  type PokedexProfileImageSourceMetrics,
} from '~/utils/pokedex/profileImageCropper'

const props = defineProps<{
  currentImageUrl: string | null
  errorMessage: string | null
  isSaving: boolean
  sourceImageUrl: string
  species: string
  statusMessage: string | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'save', imageDataUrl: string): void
}>()

const previewCanvas = ref<HTMLCanvasElement | null>(null)
const sourcePreviewUrl = ref<string | null>(null)
const loadingMessage = ref('Loading source sprite…')
const loadErrorMessage = ref<string | null>(null)
const controls = reactive(defaultPokedexProfileImageCropControls())

let loadedSource: HTMLCanvasElement | null = null
let sourceMetrics: PokedexProfileImageSourceMetrics | null = null
let activeLoadId = 0
let dragPointerId: number | null = null
let lastDragPoint: { x: number; y: number } | null = null

const resetControls = (): void => {
  const defaults = defaultPokedexProfileImageCropControls()
  controls.zoom = defaults.zoom
  controls.offsetX = defaults.offsetX
  controls.offsetY = defaults.offsetY
}

const renderPreview = (): void => {
  const canvas = previewCanvas.value
  if (!canvas || !loadedSource || !sourceMetrics) return

  const context = canvas.getContext('2d')
  if (!context) return

  drawPokedexProfileImageCrop(context, loadedSource, sourceMetrics, controls)
}

const loadSourceImage = (url: string): void => {
  activeLoadId += 1
  const loadId = activeLoadId
  loadedSource = null
  sourceMetrics = null
  sourcePreviewUrl.value = null
  loadErrorMessage.value = null
  loadingMessage.value = 'Loading source sprite…'
  resetControls()

  if (!import.meta.client) return

  const image = new Image()
  image.decoding = 'async'
  image.onload = () => {
    if (loadId !== activeLoadId) return

    const scratch = document.createElement('canvas')
    sourceMetrics = getPokedexProfileImageSourceMetrics(image, scratch)
    loadedSource = scratch
    sourcePreviewUrl.value = url
    loadingMessage.value = ''
    requestAnimationFrame(renderPreview)
  }
  image.onerror = () => {
    if (loadId !== activeLoadId) return
    loadErrorMessage.value = 'Unable to load the source sprite for cropping.'
    loadingMessage.value = ''
  }
  image.src = url
}

const resetCrop = (): void => {
  resetControls()
  renderPreview()
}

const nudgeCrop = (deltaX: number, deltaY: number): void => {
  controls.offsetX += deltaX
  controls.offsetY += deltaY
  renderPreview()
}

const beginPreviewDrag = (event: PointerEvent): void => {
  if (!loadedSource || props.isSaving) return
  dragPointerId = event.pointerId
  lastDragPoint = { x: event.clientX, y: event.clientY }
  previewCanvas.value?.setPointerCapture(event.pointerId)
}

const dragPreview = (event: PointerEvent): void => {
  if (dragPointerId !== event.pointerId || !lastDragPoint) return
  const nextPoint = { x: event.clientX, y: event.clientY }
  nudgeCrop(nextPoint.x - lastDragPoint.x, nextPoint.y - lastDragPoint.y)
  lastDragPoint = nextPoint
}

const endPreviewDrag = (event: PointerEvent): void => {
  if (dragPointerId !== event.pointerId) return
  previewCanvas.value?.releasePointerCapture(event.pointerId)
  dragPointerId = null
  lastDragPoint = null
}

const saveCrop = (): void => {
  const canvas = previewCanvas.value
  if (!canvas || !loadedSource || !sourceMetrics || props.isSaving) return
  renderPreview()
  emit('save', canvas.toDataURL('image/png'))
}

watch(() => props.sourceImageUrl, loadSourceImage, { immediate: true })
watch(() => [controls.zoom, controls.offsetX, controls.offsetY], renderPreview)

onBeforeUnmount(() => {
  activeLoadId += 1
})
</script>

<template>
  <div
    class="profile-cropper-backdrop"
    role="presentation"
    @pointerdown.self="emit('close')"
  >
    <section
      class="profile-cropper"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-cropper-title"
      @pointerdown.stop
    >
      <header class="profile-cropper__header">
        <div>
          <p class="profile-cropper__eyebrow">GM profile image cropper</p>
          <h2 id="profile-cropper-title">Recrop {{ species }}</h2>
        </div>
        <button
          type="button"
          class="profile-cropper__close"
          :disabled="isSaving"
          aria-label="Close profile image cropper"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <p class="profile-cropper__help">
        Profile images are the rectangular Pokémon portraits used by initiative,
        combat log, capture feedback, and other live-play profile displays.
        Drag the preview or adjust the controls, then save a new campaign override image.
      </p>

      <div class="profile-cropper__stage">
        <figure class="profile-cropper__source">
          <figcaption>Source sprite</figcaption>
          <div class="profile-cropper__source-frame">
            <img
              v-if="sourcePreviewUrl"
              :src="sourcePreviewUrl"
              :alt="`${species} source sprite`"
            />
            <span v-else>{{ loadErrorMessage ?? loadingMessage }}</span>
          </div>
        </figure>

        <figure class="profile-cropper__preview">
          <figcaption>New profile image</figcaption>
          <div class="profile-cropper__preview-frame">
            <canvas
              ref="previewCanvas"
              :width="POKEDEX_PROFILE_IMAGE_WIDTH"
              :height="POKEDEX_PROFILE_IMAGE_HEIGHT"
              aria-label="Profile image crop preview"
              @pointerdown="beginPreviewDrag"
              @pointermove="dragPreview"
              @pointerup="endPreviewDrag"
              @pointercancel="endPreviewDrag"
            />
          </div>
        </figure>

        <figure v-if="currentImageUrl" class="profile-cropper__current">
          <figcaption>Current saved image</figcaption>
          <div class="profile-cropper__current-frame">
            <img :src="currentImageUrl" :alt="`${species} current profile image`" />
          </div>
        </figure>
      </div>

      <div class="profile-cropper__controls" aria-label="Profile image crop controls">
        <label>
          <span>Zoom</span>
          <input
            v-model.number="controls.zoom"
            type="range"
            min="0.25"
            max="4"
            step="0.01"
            :disabled="isSaving || !sourcePreviewUrl"
          />
          <strong>{{ Math.round(controls.zoom * 100) }}%</strong>
        </label>
        <label>
          <span>Horizontal</span>
          <input
            v-model.number="controls.offsetX"
            type="range"
            min="-160"
            max="160"
            step="1"
            :disabled="isSaving || !sourcePreviewUrl"
          />
          <strong>{{ Math.round(controls.offsetX) }}px</strong>
        </label>
        <label>
          <span>Vertical</span>
          <input
            v-model.number="controls.offsetY"
            type="range"
            min="-120"
            max="120"
            step="1"
            :disabled="isSaving || !sourcePreviewUrl"
          />
          <strong>{{ Math.round(controls.offsetY) }}px</strong>
        </label>
      </div>

      <div class="profile-cropper__nudge-row" aria-label="Nudge crop">
        <button type="button" :disabled="isSaving || !sourcePreviewUrl" @click="nudgeCrop(0, -1)">↑</button>
        <button type="button" :disabled="isSaving || !sourcePreviewUrl" @click="nudgeCrop(-1, 0)">←</button>
        <button type="button" :disabled="isSaving || !sourcePreviewUrl" @click="nudgeCrop(1, 0)">→</button>
        <button type="button" :disabled="isSaving || !sourcePreviewUrl" @click="nudgeCrop(0, 1)">↓</button>
        <button type="button" :disabled="isSaving || !sourcePreviewUrl" @click="resetCrop">Reset crop</button>
      </div>

      <p v-if="loadErrorMessage" class="profile-cropper__message profile-cropper__message--error">
        {{ loadErrorMessage }}
      </p>
      <p v-if="errorMessage" class="profile-cropper__message profile-cropper__message--error">
        {{ errorMessage }}
      </p>
      <p v-else-if="statusMessage" class="profile-cropper__message profile-cropper__message--success">
        {{ statusMessage }}
      </p>

      <footer class="profile-cropper__actions">
        <button type="button" class="profile-cropper__button" :disabled="isSaving" @click="emit('close')">
          Close
        </button>
        <button
          type="button"
          class="profile-cropper__button profile-cropper__button--primary"
          :disabled="isSaving || !sourcePreviewUrl || Boolean(loadErrorMessage)"
          @click="saveCrop"
        >
          {{ isSaving ? 'Saving…' : 'Save profile image' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.profile-cropper-backdrop {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(5, 6, 8, 0.72);
  backdrop-filter: blur(4px) saturate(125%);
  -webkit-backdrop-filter: blur(4px) saturate(125%);
}

.profile-cropper {
  width: min(760px, 100%);
  max-height: min(92vh, 900px);
  overflow: auto;
  border: 1px solid var(--rule-soft);
  border-radius: 18px;
  background: color-mix(in srgb, var(--paper-soft) 94%, transparent);
  box-shadow: var(--shadow-card);
  color: var(--ink);
  padding: 1rem;
}

.profile-cropper__header,
.profile-cropper__actions,
.profile-cropper__nudge-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.profile-cropper__eyebrow {
  margin: 0 0 0.2rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.profile-cropper__header h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
}

.profile-cropper__close,
.profile-cropper__button,
.profile-cropper__nudge-row button {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-weight: 800;
}

.profile-cropper__close {
  width: 34px;
  height: 34px;
  padding: 0;
  font-size: 1.4rem;
  line-height: 1;
}

.profile-cropper__button,
.profile-cropper__nudge-row button {
  padding: 0.45rem 0.85rem;
}

.profile-cropper__close:hover:not(:disabled),
.profile-cropper__close:focus-visible:not(:disabled),
.profile-cropper__button:hover:not(:disabled),
.profile-cropper__button:focus-visible:not(:disabled),
.profile-cropper__nudge-row button:hover:not(:disabled),
.profile-cropper__nudge-row button:focus-visible:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.profile-cropper__close:disabled,
.profile-cropper__button:disabled,
.profile-cropper__nudge-row button:disabled {
  cursor: wait;
  opacity: 0.64;
}

.profile-cropper__help {
  margin: 0.85rem 0 1rem;
  color: var(--ink-muted);
  line-height: 1.45;
}

.profile-cropper__stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 1.1fr);
  gap: 0.8rem;
  align-items: stretch;
}

.profile-cropper__source,
.profile-cropper__preview,
.profile-cropper__current {
  margin: 0;
}

.profile-cropper__current {
  grid-column: 1 / -1;
}

.profile-cropper__source figcaption,
.profile-cropper__preview figcaption,
.profile-cropper__current figcaption {
  margin-bottom: 0.35rem;
  color: var(--ink-muted);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.profile-cropper__source-frame,
.profile-cropper__preview-frame,
.profile-cropper__current-frame {
  min-height: 126px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background:
    linear-gradient(45deg, color-mix(in srgb, var(--ink) 7%, transparent) 25%, transparent 25%),
    linear-gradient(-45deg, color-mix(in srgb, var(--ink) 7%, transparent) 25%, transparent 25%),
    var(--paper-inset);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px;
  overflow: hidden;
  padding: 0.75rem;
}

.profile-cropper__source-frame img {
  max-width: 100%;
  max-height: 156px;
  image-rendering: pixelated;
}

.profile-cropper__source-frame span {
  color: var(--ink-muted);
  font-weight: 800;
}

.profile-cropper__preview-frame canvas,
.profile-cropper__current-frame img {
  width: 384px;
  max-width: 100%;
  height: 144px;
  image-rendering: pixelated;
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: transparent;
}

.profile-cropper__preview-frame canvas {
  cursor: grab;
  touch-action: none;
}

.profile-cropper__preview-frame canvas:active {
  cursor: grabbing;
}

.profile-cropper__current-frame {
  min-height: auto;
}

.profile-cropper__controls {
  display: grid;
  gap: 0.75rem;
  margin: 1rem 0;
}

.profile-cropper__controls label {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr) 4rem;
  gap: 0.75rem;
  align-items: center;
}

.profile-cropper__controls span {
  color: var(--ink-muted);
  font-weight: 900;
}

.profile-cropper__controls strong {
  color: var(--ink-bright);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  text-align: right;
}

.profile-cropper__nudge-row {
  flex-wrap: wrap;
  justify-content: flex-start;
}

.profile-cropper__message {
  margin: 0.85rem 0 0;
  border-radius: 12px;
  padding: 0.75rem 0.9rem;
  font-weight: 700;
}

.profile-cropper__message--error {
  background: color-mix(in srgb, var(--bad) 14%, transparent);
  color: var(--bad);
}

.profile-cropper__message--success {
  background: color-mix(in srgb, var(--good) 14%, transparent);
  color: var(--good);
}

.profile-cropper__actions {
  justify-content: flex-end;
  margin-top: 1rem;
}

.profile-cropper__button--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}

.profile-cropper__button--primary:hover:not(:disabled),
.profile-cropper__button--primary:focus-visible:not(:disabled) {
  color: var(--accent-contrast);
  filter: brightness(1.08);
}

@media (max-width: 720px) {
  .profile-cropper__stage,
  .profile-cropper__controls label {
    grid-template-columns: 1fr;
  }

  .profile-cropper__controls strong {
    text-align: left;
  }

  .profile-cropper__actions {
    justify-content: stretch;
  }

  .profile-cropper__button {
    flex: 1 1 auto;
  }
}
</style>
