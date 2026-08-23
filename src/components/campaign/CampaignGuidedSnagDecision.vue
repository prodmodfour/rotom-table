<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ItemGuidedRequestProjectionV1 } from '#shared/itemAutomation/guidedAdjudication'

const props = defineProps<{
  request: ItemGuidedRequestProjectionV1
  busy: boolean
}>()
const emit = defineEmits<{
  submit: [decision: 'approve' | 'deny', gmNote: string | null]
  cancel: []
}>()

const authority = computed(() => props.request.resolution?.kind === 'snag-conversion'
  ? props.request.resolution : null)
const decision = ref<'approve' | 'deny' | null>(null)
const gmNote = ref('')
watch(() => props.request.requestId, () => {
  decision.value = null
  gmNote.value = ''
}, { immediate: true })
const submit = (): void => {
  if (!decision.value || props.busy) return
  emit('submit', decision.value, gmNote.value.trim() || null)
}
</script>

<template>
  <div v-if="authority" class="guided-snag">
    <fieldset :disabled="busy">
      <legend>Bounded legality decision</legend>
      <label v-for="option in authority.decisions" :key="option.decision">
        <input v-model="decision" type="radio" :value="option.decision">
        <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
      </label>
    </fieldset>
    <label class="guided-snag__note">
      <span>Private GM legality note <small>(optional)</small></span>
      <textarea v-model="gmNote" :disabled="busy" maxlength="500" rows="3" placeholder="Private evidence for approval or denial"></textarea>
      <small>Exact machine and Poké Ball identities remain server-only. This note is never publicly projected.</small>
    </label>
    <div class="guided-snag__actions">
      <button type="button" :disabled="busy || !request.canCancel" @click="emit('cancel')">Cancel request</button>
      <button type="button" class="guided-snag__accept" :disabled="busy || !decision" @click="submit">
        {{ busy ? 'Settling…' : decision === 'approve' ? 'Approve Snag Ball conversion' : decision === 'deny' ? 'Deny conversion' : 'Choose approval or denial' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.guided-snag { display: grid; gap: .75rem; }
.guided-snag fieldset,
.guided-snag__note { display: grid; gap: .55rem; margin: 0; border: 1px solid var(--rt-border, var(--rule-soft)); border-radius: var(--rt-radius-medium, 8px); padding: .75rem .85rem; }
.guided-snag legend { color: var(--rt-text-strong, var(--ink-bright)); font-weight: 800; }
.guided-snag fieldset label { min-height: 44px; display: flex; align-items: flex-start; gap: .65rem; border: 1px solid var(--rt-border, var(--rule-soft)); border-radius: var(--rt-radius-small, 6px); padding: .65rem .7rem; cursor: pointer; }
.guided-snag fieldset label:has(input:checked) { border-color: var(--rt-focus, #20c8e5); box-shadow: inset 0 0 0 1px var(--rt-focus, #20c8e5); }
.guided-snag input { width: 1.25rem; height: 1.25rem; flex: 0 0 auto; margin: .08rem 0 0; accent-color: var(--rt-focus, #20c8e5); }
.guided-snag fieldset span { display: grid; gap: .12rem; }
.guided-snag small { color: var(--rt-text-muted, var(--ink-muted)); }
.guided-snag__note > span { color: var(--rt-text, var(--ink)); font-size: .78rem; font-weight: 750; }
.guided-snag textarea { width: 100%; min-height: 5rem; resize: vertical; border: 1px solid var(--rt-border-strong, var(--rule)); border-radius: var(--rt-radius-small, 6px); background: var(--rt-surface-3, var(--paper)); color: var(--rt-text-strong, var(--ink-bright)); padding: .55rem .65rem; font: inherit; }
.guided-snag__actions { display: flex; align-items: stretch; gap: .75rem; }
.guided-snag__actions button { min-height: 44px; border: 1px solid var(--rt-border-strong, var(--rule)); border-radius: var(--rt-radius-medium, 8px); background: var(--rt-surface-2, var(--paper-inset)); color: var(--rt-text, var(--ink)); padding: .65rem .9rem; font: inherit; font-weight: 750; cursor: pointer; }
.guided-snag__actions .guided-snag__accept { flex: 1; border: 2px solid var(--rt-pending, #ffc247); background: var(--rt-brand, #df2d32); color: var(--rt-on-brand, #fff); font-weight: 900; }
.guided-snag :focus-visible { outline: 3px solid color-mix(in srgb, var(--rt-focus, #20c8e5) 55%, transparent); outline-offset: 2px; }
.guided-snag :disabled { cursor: not-allowed; opacity: .52; }
@media (max-width: 35rem) {
  .guided-snag__actions { flex-direction: column; }
  .guided-snag__actions button { width: 100%; }
}
</style>
