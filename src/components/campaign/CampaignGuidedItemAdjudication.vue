<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID,
  type ItemGuidedDecisionOptionV1,
} from '#shared/itemAutomation/guidedAdjudication'
import { useItemGuidedAdjudication } from '~/composables/items/useItemGuidedAdjudication'

const coordinator = useItemGuidedAdjudication({ mode: 'gm' })
const selectedOptionId = ref<string | null>(null)

const active = coordinator.activeRequest
const selectedOption = computed<ItemGuidedDecisionOptionV1 | null>(() => (
  active.value?.choices.find(choice => choice.optionId === selectedOptionId.value) ?? null
))
const acceptLabel = computed(() => {
  if (!selectedOption.value) return 'Choose one bounded outcome'
  if (selectedOption.value.optionId === ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID) {
    return selectedOption.value.label
  }
  return `Accept ${selectedOption.value.label.toLocaleLowerCase('en-US')} outcome`
})

watch(() => active.value?.requestId, () => {
  selectedOptionId.value = active.value?.choices[0]?.optionId ?? null
}, { immediate: true })

const accept = async (): Promise<void> => {
  if (!active.value || !selectedOption.value) return
  await coordinator.resolve(active.value, selectedOption.value)
}
const cancel = async (): Promise<void> => {
  if (!active.value) return
  await coordinator.cancel(active.value)
}
</script>

<template>
  <section class="guided-workshop" aria-labelledby="guided-workshop-title">
    <header class="guided-workshop__header">
      <div class="guided-workshop__title-line">
        <h2 id="guided-workshop-title">Guided item adjudication</h2>
        <span class="guided-workshop__count">{{ coordinator.requests.value.length }} pending</span>
      </div>
      <button
        type="button"
        class="guided-workshop__refresh"
        :disabled="!coordinator.canRefresh.value"
        @click="coordinator.load"
      >
        <span aria-hidden="true">↻</span>
        Refresh
      </button>
    </header>

    <div v-if="coordinator.uncertain.value" class="guided-workshop__uncertain" role="alert">
      <div>
        <strong>Result uncertain</strong>
        <p>{{ coordinator.message.value }}</p>
      </div>
      <button type="button" @click="coordinator.retryExact">Retry exact command</button>
    </div>

    <div v-else-if="coordinator.status.value === 'loading' && !coordinator.projection.value" class="guided-workshop__empty" role="status">
      Loading the GM queue…
    </div>

    <div v-else-if="coordinator.requests.value.length === 0" class="guided-workshop__empty">
      <strong>No guided item decisions are waiting.</strong>
      <p>Interpretive tools, repulsive medicine, Poultice, and Re-Breather requests will appear here without exposing private custody evidence.</p>
      <p v-if="coordinator.message.value" role="status">{{ coordinator.message.value }}</p>
    </div>

    <div v-else class="guided-workshop__layout">
      <nav class="guided-queue" aria-label="Pending guided item requests">
        <button
          v-for="request in coordinator.requests.value"
          :key="request.requestId"
          type="button"
          class="guided-queue__item"
          :class="{ 'guided-queue__item--active': request.requestId === active?.requestId }"
          :aria-current="request.requestId === active?.requestId ? 'true' : undefined"
          @click="coordinator.selectRequest(request.requestId)"
        >
          <span class="guided-queue__glyph" aria-hidden="true">{{ request.requestKind === 'loyalty-consequence' ? '✚' : '◉' }}</span>
          <span class="guided-queue__copy">
            <strong>{{ request.itemLabel }}</strong>
            <span>{{ request.actorLabel }}<template v-if="request.actorLabel !== request.targetLabel"> → {{ request.targetLabel }}</template></span>
            <small>{{ request.timingLabel }}</small>
          </span>
          <span v-if="request.reservationLabel" class="guided-queue__reservation">Item reserved</span>
        </button>
      </nav>

      <article v-if="active" class="guided-decision">
        <p class="guided-decision__eyebrow">GM decision</p>
        <h3>{{ active.itemLabel }}</h3>
        <p class="guided-decision__declaration">
          {{ active.actorLabel }} declared this for {{ active.targetLabel }}
        </p>
        <p class="guided-decision__prompt">{{ active.prompt }}</p>

        <section class="guided-decision__context" aria-labelledby="guided-context-title">
          <h4 id="guided-context-title">Canonical rule context</h4>
          <p v-for="fact in active.canonicalFacts" :key="fact">{{ fact }}</p>
        </section>

        <fieldset class="guided-decision__choices" :disabled="coordinator.busy.value">
          <legend class="sr-only">Choose exactly one server-authorized outcome</legend>
          <label v-for="choice in active.choices" :key="choice.optionId" class="guided-choice">
            <input v-model="selectedOptionId" type="radio" name="guided-outcome" :value="choice.optionId">
            <span>
              <strong>{{ choice.label }}</strong>
              <small>{{ choice.description }}</small>
            </span>
          </label>
        </fieldset>

        <section class="guided-decision__settlement" aria-labelledby="guided-settlement-title">
          <h4 id="guided-settlement-title">Settlement on acceptance</h4>
          <ul>
            <li v-for="(fact, index) in active.settlementFacts" :key="fact">
              <span aria-hidden="true">{{ index === 0 ? '♥' : index === 1 ? '▣' : '▤' }}</span>
              <span>{{ fact }}</span>
            </li>
          </ul>
        </section>

        <div class="guided-decision__actions">
          <button
            type="button"
            class="guided-decision__cancel"
            :disabled="coordinator.busy.value || !active.canCancel"
            @click="cancel"
          >
            Cancel request
          </button>
          <button
            type="button"
            class="guided-decision__accept"
            :disabled="coordinator.busy.value || !selectedOption"
            @click="accept"
          >
            {{ coordinator.busy.value ? 'Accepting…' : acceptLabel }}
          </button>
        </div>
        <p class="guided-decision__boundary">{{ active.boundaryLabel }}</p>
      </article>
    </div>

    <div
      v-if="!coordinator.uncertain.value && coordinator.message.value"
      class="guided-workshop__message"
      :class="`guided-workshop__message--${coordinator.status.value}`"
      role="status"
      aria-live="polite"
    >
      <span>{{ coordinator.message.value }}</span>
      <button v-if="!coordinator.busy.value" type="button" @click="coordinator.dismiss">Dismiss</button>
    </div>
  </section>
</template>

<style scoped>
.guided-workshop {
  display: grid;
  gap: var(--rt-space-4, 1rem);
  border: 1px solid var(--rt-border, var(--rule-soft));
  border-radius: var(--rt-radius-large, 12px);
  background: var(--rt-surface-1, var(--paper-deep));
  color: var(--rt-text, var(--ink));
  padding: clamp(1rem, 2.2vw, 1.4rem);
  box-shadow: var(--rt-shadow-low, 0 8px 24px rgb(0 0 0 / 0.18));
}
.guided-workshop__header,
.guided-workshop__title-line,
.guided-decision__actions,
.guided-workshop__message,
.guided-workshop__uncertain {
  display: flex;
  align-items: center;
}
.guided-workshop__header { justify-content: space-between; gap: 1rem; }
.guided-workshop__title-line { flex-wrap: wrap; gap: .85rem; }
.guided-workshop h2,
.guided-decision h3,
.guided-decision h4 { margin: 0; color: var(--rt-text-strong, var(--ink-bright)); }
.guided-workshop h2 { font: 800 clamp(1.45rem, 3vw, 2rem)/1.1 var(--font-book); }
.guided-workshop__count { color: var(--rt-pending, #ffc247); font-weight: 800; }
.guided-workshop button { min-height: 44px; font: inherit; }
.guided-workshop__refresh,
.guided-decision__cancel,
.guided-workshop__message button {
  border: 1px solid var(--rt-border-strong, var(--rule));
  border-radius: var(--rt-radius-medium, 8px);
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text, var(--ink));
  cursor: pointer;
  padding: .62rem .95rem;
}
.guided-workshop__refresh { display: inline-flex; align-items: center; gap: .5rem; }
.guided-workshop__layout { display: grid; grid-template-columns: minmax(17rem, 2fr) minmax(0, 3fr); gap: var(--rt-space-4, 1rem); }
.guided-queue { display: grid; align-content: start; gap: .7rem; border-right: 1px solid var(--rt-border, var(--rule-soft)); padding-right: var(--rt-space-4, 1rem); }
.guided-queue__item {
  display: grid;
  grid-template-columns: 2.8rem minmax(0, 1fr) auto;
  align-items: center;
  gap: .8rem;
  width: 100%;
  border: 1px solid var(--rt-border, var(--rule-soft));
  border-radius: var(--rt-radius-medium, 8px);
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text, var(--ink));
  cursor: pointer;
  padding: .85rem;
  text-align: left;
}
.guided-queue__item--active { border-color: var(--rt-focus, #20c8e5); box-shadow: inset 0 0 0 1px var(--rt-focus, #20c8e5); }
.guided-queue__glyph { display: grid; place-items: center; width: 2.8rem; height: 2.8rem; border-radius: 50%; background: var(--rt-surface-3, #182026); color: var(--rt-brand, #f04a45); font-size: 1.35rem; }
.guided-queue__copy { display: grid; gap: .18rem; min-width: 0; }
.guided-queue__copy strong { color: var(--rt-text-strong, var(--ink-bright)); font-size: 1.04rem; }
.guided-queue__copy small { color: var(--rt-text-muted, var(--ink-soft)); }
.guided-queue__reservation { border: 1px solid var(--rt-pending, #ffc247); border-radius: 4px; color: var(--rt-pending, #ffc247); font-size: .78rem; padding: .3rem .45rem; }
.guided-decision { position: relative; display: grid; align-content: start; gap: .72rem; border-left: 4px solid var(--rt-pending, #ffc247); background: var(--rt-surface-2, var(--paper-inset)); padding: 1rem 1.15rem; }
.guided-decision__eyebrow { margin: 0; color: var(--rt-pending, #ffc247); font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
.guided-decision h3 { font: 800 clamp(1.55rem, 3vw, 2.25rem)/1.05 var(--font-book); }
.guided-decision__declaration,
.guided-decision__prompt,
.guided-decision__context p { margin: 0; }
.guided-decision__prompt { color: var(--rt-text-strong, var(--ink-bright)); font-size: 1.05rem; font-weight: 700; }
.guided-decision__context { display: grid; gap: .35rem; border: 1px solid var(--rt-border, var(--rule-soft)); border-radius: var(--rt-radius-medium, 8px); padding: .75rem .9rem; }
.guided-decision__choices { display: grid; gap: .55rem; margin: 0; border: 0; padding: 0; }
.guided-choice { display: flex; align-items: flex-start; gap: .7rem; min-height: 44px; border: 1px solid var(--rt-border, var(--rule-soft)); border-radius: var(--rt-radius-medium, 8px); cursor: pointer; padding: .68rem .8rem; }
.guided-choice:has(input:checked) { border-color: var(--rt-focus, #20c8e5); box-shadow: inset 0 0 0 1px var(--rt-focus, #20c8e5); }
.guided-choice input { flex: 0 0 auto; width: 1.25rem; height: 1.25rem; margin: .05rem 0 0; accent-color: var(--rt-focus, #20c8e5); }
.guided-choice span { display: grid; gap: .16rem; }
.guided-choice small { color: var(--rt-text-muted, var(--ink-soft)); }
.guided-decision__settlement { display: grid; gap: .4rem; }
.guided-decision__settlement ul { display: grid; margin: 0; border: 1px solid var(--rt-border, var(--rule-soft)); border-radius: var(--rt-radius-medium, 8px); padding: 0; list-style: none; }
.guided-decision__settlement li { display: grid; grid-template-columns: 1.8rem minmax(0, 1fr); gap: .55rem; padding: .56rem .75rem; }
.guided-decision__settlement li + li { border-top: 1px solid var(--rt-border, var(--rule-soft)); }
.guided-decision__settlement li > :first-child { color: var(--rt-success, #77d6a4); }
.guided-decision__actions { align-items: stretch; gap: .8rem; }
.guided-decision__cancel { flex: 0 0 auto; }
.guided-decision__accept {
  flex: 1 1 auto;
  border: 2px solid var(--rt-pending, #ffc247);
  border-radius: var(--rt-radius-medium, 8px);
  background: var(--rt-brand, #df2d32);
  color: var(--rt-on-brand, #07090d);
  cursor: pointer;
  font-weight: 900;
  padding: .7rem 1rem;
}
.guided-decision__boundary { margin: -.25rem 0 0; color: var(--rt-pending, #ffc247); text-align: right; }
.guided-workshop__empty { display: grid; gap: .35rem; min-height: 8rem; place-content: center; color: var(--rt-text-muted, var(--ink-soft)); text-align: center; }
.guided-workshop__empty p { margin: 0; }
.guided-workshop__uncertain { justify-content: space-between; gap: 1rem; border: 2px solid var(--rt-pending, #ffc247); background: var(--rt-surface-2, var(--paper-inset)); padding: 1rem; }
.guided-workshop__uncertain p { margin: .25rem 0 0; }
.guided-workshop__uncertain button { flex: 0 0 auto; border: 0; border-radius: var(--rt-radius-medium, 8px); background: var(--rt-brand, #df2d32); color: var(--rt-on-brand, #07090d); cursor: pointer; font-weight: 900; padding: .75rem 1rem; }
.guided-workshop__message { justify-content: space-between; gap: .8rem; border-top: 1px solid var(--rt-border, var(--rule-soft)); padding-top: .75rem; color: var(--rt-text-muted, var(--ink-soft)); }
.guided-workshop__message--conflict,
.guided-workshop__message--error { color: var(--rt-danger, #ff9b9b); }
.guided-workshop button:focus-visible,
.guided-choice:focus-within { outline: 3px solid color-mix(in srgb, var(--rt-focus, #20c8e5) 55%, transparent); outline-offset: 2px; }
.guided-workshop button:disabled { cursor: not-allowed; opacity: .52; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
@media (max-width: 820px) {
  .guided-workshop__layout { grid-template-columns: 1fr; }
  .guided-queue { border-right: 0; border-bottom: 1px solid var(--rt-border, var(--rule-soft)); padding: 0 0 1rem; }
  .guided-decision { border-left-width: 3px; }
}
@media (max-width: 560px) {
  .guided-workshop__header,
  .guided-workshop__uncertain,
  .guided-decision__actions,
  .guided-workshop__message { align-items: stretch; flex-direction: column; }
  .guided-workshop__refresh,
  .guided-decision__actions button,
  .guided-workshop__uncertain button { width: 100%; }
  .guided-queue__item { grid-template-columns: 2.5rem minmax(0, 1fr); }
  .guided-queue__reservation { grid-column: 2; justify-self: start; }
  .guided-decision__boundary { text-align: left; }
}
</style>
