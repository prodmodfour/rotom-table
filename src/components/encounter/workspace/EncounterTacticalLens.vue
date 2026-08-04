<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EncounterWorkspacePreferences } from '#shared/encounterWorkspace/preferences'
import { battlefieldWorkshopPath } from '#shared/encounterWorkspace/routes'
import {
  createEncounterTacticalAdoptionMessage,
  parseEncounterTacticalChildMessage,
} from '#shared/encounterWorkspace/tacticalProtocol'
const props = defineProps<{
  mapSlug: string
  mapRevision: number
  open: boolean
  mode: EncounterWorkspacePreferences['tacticalMode']
  selectedParticipantId: string | null
  selectedTargetIds?: readonly string[]
  actionOfferId?: string | null
}>()
const emit = defineEmits<{
  close: []
  selectParticipant: [participantId: string | null]
  updateMode: [mode: EncounterWorkspacePreferences['tacticalMode']]
  ready: [startupMs: number]
  stale: [revision: number]
}>()
const frame = ref<HTMLIFrameElement | null>(null)
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const loadStartedAt = ref(0)
const frameUrl = computed(() => {
  const query = new URLSearchParams({
    encounterLens: '1',
    expectedRevision: String(props.mapRevision),
  })
  if (props.selectedParticipantId) query.set('selected', props.selectedParticipantId)
  return `${battlefieldWorkshopPath(props.mapSlug)}?${query.toString()}`
})
const postAdoption = (): void => {
  frame.value?.contentWindow?.postMessage(createEncounterTacticalAdoptionMessage({
    mapSlug: props.mapSlug,
    mapRevision: props.mapRevision,
    selectedParticipantId: props.selectedParticipantId,
    actionOfferId: props.actionOfferId ?? null,
    selectedTargetIds: props.selectedTargetIds ?? [],
  }), window.location.origin)
}
const loaded = (): void => {
  // iframe load only means the nested application booted; renderer readiness
  // is acknowledged by the revision-bound child message below.
  postAdoption()
}
const failed = (): void => { status.value = 'error' }
const receiveMessage = (event: MessageEvent): void => {
  if (event.origin !== window.location.origin || event.source !== frame.value?.contentWindow) return
  const data = parseEncounterTacticalChildMessage(event.data)
  if (!data || data.mapSlug !== props.mapSlug) return
  if (data.type === 'ready') {
    if (Number.isSafeInteger(data.mapRevision) && data.mapRevision !== props.mapRevision) {
      emit('stale', data.mapRevision)
      return
    }
    if (status.value !== 'ready') {
      status.value = 'ready'
      emit('ready', Math.max(0, Math.round(performance.now() - loadStartedAt.value)))
    }
    postAdoption()
  }
  else if (data.type === 'selection') emit('selectParticipant', data.participantId)
  else if (data.type === 'revision' && Number.isSafeInteger(data.mapRevision) && data.mapRevision !== props.mapRevision) {
    emit('stale', data.mapRevision)
  }
  else if (data.type === 'close') emit('close')
}
watch(() => props.open, async (open) => {
  if (!open) {
    status.value = 'idle'
    return
  }
  status.value = 'loading'
  loadStartedAt.value = performance.now()
  await nextTick()
  postAdoption()
}, { immediate: true })
watch(() => [props.mapRevision, props.selectedParticipantId, props.actionOfferId, ...(props.selectedTargetIds ?? [])], () => {
  if (props.open && status.value === 'ready') postAdoption()
})
onMounted(() => window.addEventListener('message', receiveMessage))
onBeforeUnmount(() => window.removeEventListener('message', receiveMessage))
</script>

<template>
  <section
    v-if="open"
    class="encounter-tactical-lens rt-world-overlay"
    :data-mode="mode"
    aria-labelledby="encounter-tactical-lens-heading"
  >
    <header class="encounter-tactical-lens__toolbar">
      <div>
        <p>Exact geometry</p>
        <h2 id="encounter-tactical-lens-heading">Tactical battlefield</h2>
      </div>
      <div role="group" aria-label="Tactical lens layout">
        <button type="button" :aria-pressed="mode === 'embedded'" @click="emit('updateMode', 'embedded')">Compact</button>
        <button type="button" :aria-pressed="mode === 'split'" @click="emit('updateMode', 'split')">Split</button>
        <button type="button" :aria-pressed="mode === 'picture-in-picture'" @click="emit('updateMode', 'picture-in-picture')">Picture in picture</button>
        <button type="button" :aria-pressed="mode === 'full-screen'" @click="emit('updateMode', 'full-screen')">Full screen</button>
      </div>
      <a :href="battlefieldWorkshopPath(mapSlug)" target="_blank" rel="noopener">Open Workshop</a>
      <button type="button" class="encounter-tactical-lens__close" @click="emit('close')">Return to stage</button>
    </header>
    <div class="encounter-tactical-lens__viewport">
      <p v-if="status === 'loading'" role="status">Starting the tactical renderer…</p>
      <p v-else-if="status === 'error'" role="alert">The tactical renderer could not start. Open the Battlefield Workshop instead.</p>
      <iframe
        ref="frame"
        :src="frameUrl"
        :title="`Tactical battlefield for ${mapSlug}`"
        allow="fullscreen"
        @load="loaded"
        @error="failed"
      />
    </div>
  </section>
</template>

<style scoped>
.encounter-tactical-lens { position: relative; z-index: 20; width: 100%; min-height: 28rem; display: grid; grid-template-rows: auto minmax(22rem, 1fr); overflow: hidden; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-bg-canvas); box-shadow: var(--rt-elevation-4); }
.encounter-tactical-lens[data-mode='embedded'] { max-width: 56rem; height: min(55dvh, 38rem); margin: 1rem auto; }
.encounter-tactical-lens[data-mode='split'] { height: min(70dvh, 52rem); margin: 0.75rem 0; }
.encounter-tactical-lens[data-mode='picture-in-picture'] { position: fixed; right: 1rem; bottom: 1rem; width: min(46rem, calc(100vw - 2rem)); height: min(55dvh, 36rem); }
.encounter-tactical-lens[data-mode='full-screen'] { position: fixed; inset: 0; width: 100vw; height: 100dvh; border: 0; border-radius: 0; }
.encounter-tactical-lens__toolbar { min-width: 0; display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem; border-bottom: 1px solid var(--rt-rule); background: var(--rt-surface-1); }
.encounter-tactical-lens__toolbar > div:first-child { margin-right: auto; }
.encounter-tactical-lens__toolbar p { margin: 0; color: var(--rt-info); font-size: var(--rt-type-meta-xs-size); font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.encounter-tactical-lens__toolbar h2 { margin: 0; font-size: var(--rt-type-heading-md-size); }
.encounter-tactical-lens__toolbar [role='group'] { display: flex; gap: 0.25rem; }
.encounter-tactical-lens__toolbar button,
.encounter-tactical-lens__toolbar a { min-height: var(--rt-touch-minimum); display: inline-flex; align-items: center; padding: 0.45rem 0.65rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; text-decoration: none; }
.encounter-tactical-lens__toolbar button[aria-pressed='true'] { border-color: var(--rt-focus); }
.encounter-tactical-lens__close { border-color: var(--rt-info) !important; }
.encounter-tactical-lens__viewport { position: relative; min-height: 0; background: #050608; }
.encounter-tactical-lens__viewport > p { position: absolute; z-index: 1; inset: 1rem auto auto 1rem; padding: 0.6rem; background: var(--rt-surface-1); }
.encounter-tactical-lens iframe { width: 100%; height: 100%; display: block; border: 0; }
@media (max-width: 58rem) {
  .encounter-tactical-lens__toolbar { align-items: stretch; flex-wrap: wrap; }
  .encounter-tactical-lens__toolbar > div:first-child { width: 100%; }
  .encounter-tactical-lens__toolbar [role='group'] { max-width: 100%; overflow-x: auto; }
  .encounter-tactical-lens[data-mode='picture-in-picture'] { right: 0.5rem; bottom: 0.5rem; width: calc(100vw - 1rem); height: 62dvh; }
}
@media (max-width: 42rem) {
  .encounter-tactical-lens[data-mode] { position: fixed; inset: 0; z-index: var(--rt-layer-modal); width: 100vw; max-width: none; height: 100dvh; min-height: 100dvh; margin: 0; border: 0; border-radius: 0 !important; }
  .encounter-tactical-lens__toolbar [role='group'] button:not([aria-pressed='true']) { display: none; }
  .encounter-tactical-lens__toolbar a { display: none; }
}
</style>
