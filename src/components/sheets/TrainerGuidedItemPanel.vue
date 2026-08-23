<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind } from '#shared/sheets'
import {
  useItemGuidedAdjudication,
  type ItemGuidedAcceptedResult,
} from '~/composables/items/useItemGuidedAdjudication'

const props = withDefaults(defineProps<{
  sheet: TrainerSheet | CharacterSheet
  ownerKind?: SheetKind
  profileId?: string | null
  enabled?: boolean
}>(), {
  ownerKind: 'trainer',
  profileId: null,
  enabled: true,
})
const emit = defineEmits<{ accepted: [response: ItemGuidedAcceptedResult] }>()
const messageRef = ref<HTMLElement | null>(null)

const coordinator = useItemGuidedAdjudication({
  mode: 'owner',
  ownerKind: () => props.ownerKind,
  ownerSlug: () => props.sheet.slug,
  ownerRevision: () => props.sheet.revision ?? null,
  profileId: () => props.profileId,
  onAccepted: async response => emit('accepted', response),
})
watch(() => [coordinator.status.value, coordinator.message.value] as const, async ([status, message]) => {
  if (!message || (status !== 'conflict' && status !== 'error')) return
  await nextTick()
  messageRef.value?.focus({ preventScroll: true })
})
</script>

<template>
  <section
    v-if="coordinator.uncertain.value || coordinator.requests.value.length || coordinator.reBreatherOffers.value.length || coordinator.message.value"
    class="trainer-guided"
    aria-labelledby="trainer-guided-title"
  >
    <header>
      <div>
        <p>Guided equipment &amp; items</p>
        <h3 id="trainer-guided-title">GM requests</h3>
      </div>
      <span v-if="coordinator.requests.value.length">{{ coordinator.requests.value.length }} waiting</span>
    </header>

    <div v-if="coordinator.uncertain.value" class="trainer-guided__uncertain" role="alert">
      <strong>Result uncertain</strong>
      <p>{{ coordinator.message.value }}</p>
      <button type="button" @click="coordinator.retryExact">Retry exact command</button>
    </div>

    <template v-else>
      <article v-for="request in coordinator.requests.value" :key="request.requestId" class="trainer-guided__request">
        <div>
          <strong>{{ request.itemLabel }}</strong>
          <span>Waiting for bounded GM adjudication</span>
          <small>{{ request.reservationLabel ?? request.timingLabel }}</small>
        </div>
        <button
          type="button"
          :disabled="coordinator.busy.value || !request.canCancel"
          @click="coordinator.cancel(request)"
        >
          Cancel request
        </button>
        <p>{{ request.boundaryLabel }}</p>
      </article>

      <article v-for="offer in coordinator.reBreatherOffers.value" :key="offer.offerId" class="trainer-guided__offer">
        <div>
          <strong>{{ offer.actionLabel }}</strong>
          <span>{{ offer.statusLabel }}</span>
          <small>{{ offer.timingLabel }} · self</small>
        </div>
        <button
          type="button"
          :disabled="!enabled || coordinator.busy.value || !offer.enabled"
          @click="coordinator.declareReBreather(offer)"
        >
          {{ coordinator.busy.value ? 'Sending…' : 'Request GM confirmation' }}
        </button>
        <p v-if="offer.unavailableReason">{{ offer.unavailableReason }}</p>
        <p v-else>No Capability or equipment-state change occurs before GM acceptance.</p>
      </article>

      <div
        v-if="coordinator.message.value"
        ref="messageRef"
        class="trainer-guided__message"
        :role="coordinator.status.value === 'conflict' || coordinator.status.value === 'error' ? 'alert' : 'status'"
        :aria-live="coordinator.status.value === 'conflict' || coordinator.status.value === 'error' ? 'assertive' : 'polite'"
        tabindex="-1"
      >
        <span>{{ coordinator.message.value }}</span>
        <button v-if="!coordinator.busy.value" type="button" @click="coordinator.dismiss">Dismiss</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.trainer-guided {
  display: grid;
  gap: .75rem;
  border: 1px solid var(--rt-border, var(--rule-soft));
  border-radius: var(--rt-radius-large, 12px);
  background: var(--rt-surface-1, var(--paper-deep));
  padding: .9rem;
}
.trainer-guided header,
.trainer-guided__request,
.trainer-guided__offer,
.trainer-guided__message { display: flex; align-items: center; justify-content: space-between; gap: .8rem; }
.trainer-guided header p { margin: 0 0 .15rem; color: var(--rt-pending, #ffc247); font-size: .72rem; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
.trainer-guided h3 { margin: 0; color: var(--rt-text-strong, var(--ink-bright)); }
.trainer-guided header > span { color: var(--rt-pending, #ffc247); font-weight: 800; }
.trainer-guided__request,
.trainer-guided__offer { flex-wrap: wrap; border-left: 3px solid var(--rt-pending, #ffc247); background: var(--rt-surface-2, var(--paper-inset)); padding: .75rem; }
.trainer-guided__request > div,
.trainer-guided__offer > div { display: grid; gap: .18rem; }
.trainer-guided strong { color: var(--rt-text-strong, var(--ink-bright)); }
.trainer-guided small,
.trainer-guided p { color: var(--rt-text-muted, var(--ink-soft)); }
.trainer-guided__request > p,
.trainer-guided__offer > p { flex-basis: 100%; margin: 0; font-size: .86rem; }
.trainer-guided button { min-height: 44px; border: 1px solid var(--rt-border-strong, var(--rule)); border-radius: var(--rt-radius-medium, 8px); background: var(--rt-surface-3, var(--paper-inset)); color: var(--rt-text, var(--ink)); cursor: pointer; font: inherit; font-weight: 750; padding: .6rem .85rem; }
.trainer-guided__offer button,
.trainer-guided__uncertain button { border-color: var(--rt-pending, #ffc247); background: var(--rt-brand, #df2d32); color: #fff; }
.trainer-guided button:focus-visible,
.trainer-guided__message:focus-visible { outline: 3px solid color-mix(in srgb, var(--rt-focus, #20c8e5) 55%, transparent); outline-offset: 2px; }
.trainer-guided button:disabled { cursor: not-allowed; opacity: .5; }
.trainer-guided__uncertain { display: grid; gap: .4rem; border: 2px solid var(--rt-pending, #ffc247); padding: .8rem; }
.trainer-guided__uncertain p { margin: 0; }
.trainer-guided__uncertain button { justify-self: start; }
.trainer-guided__message { border-top: 1px solid var(--rt-border, var(--rule-soft)); padding-top: .65rem; color: var(--rt-text-muted, var(--ink-soft)); }
@media (max-width: 640px) {
  .trainer-guided header,
  .trainer-guided__request,
  .trainer-guided__offer,
  .trainer-guided__message { align-items: stretch; flex-direction: column; }
  .trainer-guided button { width: 100%; }
}
</style>
