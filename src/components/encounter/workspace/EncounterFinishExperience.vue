<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type {
  FinishEncounterGateAction,
  FinishEncounterView,
} from '#shared/encounterSettlement/finish'
import type { FinishEncounterClientState } from '~/composables/encounter/useFinishEncounter'

const props = defineProps<{
  open: boolean
  state: FinishEncounterClientState
  view: FinishEncounterView | null
  error: string | null
  online: boolean
  canCommit: boolean
  canRetry: boolean
  canDiscard: boolean
}>()
const emit = defineEmits<{
  close: []
  refresh: []
  commit: []
  checkServer: []
  retryExact: []
  discardAndReviewFresh: []
  gateAction: [action: FinishEncounterGateAction]
}>()

const panel = ref<HTMLElement | null>(null)
const heading = ref<HTMLElement | null>(null)
const confirmed = ref(false)
const focusableSelector = 'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
const busy = computed(() => ['loading', 'saving', 'checking'].includes(props.state))
const ready = computed(() => props.view?.state === 'ready' && props.state !== 'error')
const accepted = computed(() => props.view?.state === 'accepted')
const sectionSteps = computed(() => [
  { id: 'finish-readiness', label: accepted.value ? 'Accepted' : 'Readiness', complete: Boolean(props.view) },
  { id: 'finish-consequences', label: 'Consequences', complete: Boolean(props.view?.consequences.length) },
  { id: 'finish-rewards', label: 'Rewards', complete: Boolean(props.view) },
  { id: 'finish-outcome', label: 'Outcome', complete: Boolean(props.view) },
  { id: 'finish-cleanup', label: 'Cleanup', complete: Boolean(props.view) },
  { id: 'finish-confirmation', label: accepted.value ? 'Complete' : 'Confirm', complete: accepted.value },
])

const focusSection = (id: string): void => {
  panel.value?.querySelector<HTMLElement>(`#${id}`)?.focus({ preventScroll: false })
}
const close = (): void => {
  if (!busy.value) emit('close')
}
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab' || !panel.value) return
  const focusable = [...panel.value.querySelectorAll<HTMLElement>(focusableSelector)]
    .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable.at(-1)!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  }
  else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
const submit = (): void => {
  if (confirmed.value && props.canCommit && !busy.value) emit('commit')
}

watch(() => props.open, async (open) => {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('finish-encounter-page-lock', open)
  if (!open) return
  confirmed.value = false
  await nextTick()
  heading.value?.focus({ preventScroll: true })
}, { immediate: true })
watch(() => props.view?.command, () => { confirmed.value = false })
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.documentElement.classList.remove('finish-encounter-page-lock')
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="finish-encounter-layer" data-testid="finish-encounter-layer">
      <section
        ref="panel"
        class="finish-encounter rt-design-system"
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-encounter-heading"
        :aria-describedby="error ? 'finish-encounter-alert' : undefined"
        data-rt-design-system="1"
        data-rt-context="live-encounter"
        :aria-busy="busy || undefined"
        @keydown="handleKeydown"
      >
        <header class="finish-encounter__header">
          <div>
            <p>Encounter settlement</p>
            <h2 id="finish-encounter-heading" ref="heading" tabindex="-1">Finish Encounter</h2>
            <span v-if="view" class="finish-encounter__encounter-name">{{ view.encounterName }}</span>
          </div>
          <button type="button" aria-label="Back to encounter" :disabled="busy" @click="close">×</button>
        </header>

        <p v-if="error" id="finish-encounter-alert" class="finish-encounter__alert" role="alert">{{ error }}</p>

        <div v-if="state === 'loading'" class="finish-encounter__state" role="status">
          <span class="finish-encounter__pulse" aria-hidden="true" />
          <h3>Preparing current settlement</h3>
          <p>Checking participants, consequences, rewards, outcomes, and temporary cleanup together…</p>
        </div>

        <div v-else-if="state === 'uncertain' || state === 'checking' || (state === 'saving' && !view)" class="finish-encounter__state finish-encounter__state--uncertain">
          <span class="finish-encounter__state-icon" aria-hidden="true">?</span>
          <h3>Settlement outcome needs recovery</h3>
          <p>The exact retained command is the only safe retry. Reconnection never submits it automatically.</p>
          <p v-if="!online" class="finish-encounter__offline">Offline · retry stays unavailable</p>
          <div class="finish-encounter__state-actions">
            <button type="button" :disabled="busy || !online" @click="emit('checkServer')">Check server</button>
            <button type="button" :disabled="!canRetry || busy" @click="emit('retryExact')">Retry exact command</button>
            <button type="button" :disabled="busy || !canDiscard" @click="emit('discardAndReviewFresh')">Discard and review current</button>
          </div>
        </div>

        <div v-else-if="state === 'error' && !view" class="finish-encounter__state">
          <span class="finish-encounter__state-icon" aria-hidden="true">!</span>
          <h3>Review unavailable</h3>
          <p>No settlement command has been sent. Return to the encounter or load current authority again.</p>
          <button type="button" :disabled="busy" @click="emit('refresh')">Try again</button>
        </div>

        <template v-else-if="view">
          <div class="finish-encounter__body">
            <nav class="finish-encounter__rail" aria-label="Settlement review sections">
              <ol>
                <li v-for="(step, index) in sectionSteps" :key="step.id" :data-current="index === 0 || undefined">
                  <button type="button" @click="focusSection(step.id)">
                    <span class="finish-encounter__step-mark" aria-hidden="true">{{ step.complete ? '✓' : index + 1 }}</span>
                    <span><small>Step {{ index + 1 }}</small>{{ step.label }}</span>
                  </button>
                </li>
              </ol>
            </nav>

            <div class="finish-encounter__review" tabindex="0" aria-label="Settlement details">
              <section
                id="finish-readiness"
                class="finish-encounter__readiness"
                :data-state="view.state"
                tabindex="-1"
                aria-labelledby="finish-readiness-title"
              >
                <span class="finish-encounter__readiness-icon" aria-hidden="true">{{ view.state === 'blocked' ? '!' : '✓' }}</span>
                <div>
                  <p>{{ view.state === 'ready' ? 'No unresolved decisions' : view.state === 'accepted' ? 'Atomic settlement accepted' : 'Resolve before settlement' }}</p>
                  <h3 id="finish-readiness-title">{{ view.readinessLabel }}</h3>
                  <span>{{ view.readinessDetail }}</span>
                </div>
              </section>

              <section v-if="view.gates.length" class="finish-encounter__gates" aria-labelledby="finish-gates-heading">
                <div class="finish-encounter__section-heading">
                  <div><p>Next task</p><h3 id="finish-gates-heading">Outstanding decisions</h3></div>
                  <span>{{ view.gates.length }}</span>
                </div>
                <ol>
                  <li v-for="(gate, index) in view.gates" :key="`${gate.kind}:${index}`">
                    <div><strong>{{ gate.title }}</strong><p>{{ gate.detail }}</p></div>
                    <button type="button" @click="emit('gateAction', gate.action)">{{ gate.actionLabel }}</button>
                  </li>
                </ol>
              </section>

              <div class="finish-encounter__totals" aria-label="Settlement totals">
                <span><strong class="rt-numeric">{{ view.participantCount }}</strong> participants</span>
                <span><strong class="rt-numeric">{{ view.rewards.length }}</strong> rewards</span>
                <span><strong class="rt-numeric">{{ view.cleanup.reduce((sum, row) => sum + row.sourceCount, 0) }}</strong> cleanup sources</span>
              </div>

              <section id="finish-consequences" class="finish-encounter__review-section" tabindex="-1" aria-labelledby="finish-consequences-heading">
                <div class="finish-encounter__section-heading">
                  <div><p>Will remain</p><h3 id="finish-consequences-heading">Persistent consequences</h3></div>
                  <span>Preserved</span>
                </div>
                <ul class="finish-encounter__rows">
                  <li v-for="row in view.consequences" :key="row.kind">
                    <span class="finish-encounter__row-icon" aria-hidden="true">◇</span>
                    <div><strong>{{ row.label }}</strong><p>{{ row.detail }}</p></div>
                    <span class="rt-numeric">{{ row.count }}</span>
                  </li>
                </ul>
              </section>

              <section id="finish-rewards" class="finish-encounter__review-section" tabindex="-1" aria-labelledby="finish-rewards-heading">
                <div class="finish-encounter__section-heading">
                  <div><p>Will be applied</p><h3 id="finish-rewards-heading">Rewards &amp; allocations</h3></div>
                  <span>{{ view.rewards.length }}</span>
                </div>
                <ul v-if="view.rewards.length" class="finish-encounter__rows">
                  <li v-for="(row, index) in view.rewards" :key="`${row.kind}:${index}`">
                    <span class="finish-encounter__row-icon" aria-hidden="true">＋</span>
                    <div><strong>{{ row.label }}</strong><p>{{ row.destinationLabel }}<template v-if="row.detail"> · {{ row.detail }}</template></p></div>
                    <span class="rt-numeric">{{ row.amountLabel }}</span>
                  </li>
                </ul>
                <p v-else class="finish-encounter__empty">No rewards are included in this settlement.</p>
              </section>

              <section id="finish-outcome" class="finish-encounter__review-section" tabindex="-1" aria-labelledby="finish-outcome-heading">
                <div class="finish-encounter__section-heading">
                  <div><p>Will be recorded</p><h3 id="finish-outcome-heading">Encounter outcome</h3></div>
                  <span>{{ view.outcomes.length }}</span>
                </div>
                <ul class="finish-encounter__rows">
                  <li v-for="(row, index) in view.outcomes" :key="`${row.kind}:${index}`">
                    <span class="finish-encounter__row-icon" aria-hidden="true">✓</span>
                    <div><strong>{{ row.label }}</strong><p>{{ row.visibility === 'gm' ? 'GM-only outcome' : 'Shared outcome' }}</p></div>
                    <span class="finish-encounter__result">{{ row.resultLabel }}</span>
                  </li>
                </ul>
              </section>

              <section id="finish-cleanup" class="finish-encounter__review-section" tabindex="-1" aria-labelledby="finish-cleanup-heading">
                <div class="finish-encounter__section-heading">
                  <div><p>Will be removed or reset</p><h3 id="finish-cleanup-heading">Temporary cleanup</h3></div>
                  <span>{{ view.cleanup.length }}</span>
                </div>
                <ul class="finish-encounter__rows">
                  <li v-for="row in view.cleanup" :key="row.kind">
                    <span class="finish-encounter__row-icon" aria-hidden="true">↺</span>
                    <div><strong>{{ row.label }}</strong><p>{{ row.detail }}</p></div>
                    <span class="finish-encounter__result">{{ row.actionLabel }}</span>
                  </li>
                </ul>
              </section>

              <section class="finish-encounter__outstanding" aria-labelledby="finish-outstanding-heading">
                <div class="finish-encounter__section-heading">
                  <div><p>After settlement</p><h3 id="finish-outstanding-heading">Outstanding work</h3></div>
                  <span aria-hidden="true">→</span>
                </div>
                <ul v-if="view.outstandingWork.length"><li v-for="(row, index) in view.outstandingWork" :key="`${row.kind}:${index}`"><strong>{{ row.label }}</strong><span>{{ row.detail }}</span></li></ul>
                <p v-else class="finish-encounter__empty">No non-blocking follow-up work is currently projected.</p>
              </section>

              <section v-if="accepted" class="finish-encounter__accepted" aria-labelledby="finish-accepted-heading">
                <h3 id="finish-accepted-heading">Settlement complete</h3>
                <p>{{ view.accepted?.historyFactCount ?? 0 }} history facts and {{ view.accepted?.attentionSourceCount ?? 0 }} follow-up items were recorded.</p>
                <nav aria-label="Continue after settlement">
                  <NuxtLink v-for="link in view.continuations" :key="link.kind" :to="link.href"><strong>{{ link.label }}</strong><span>{{ link.detail }}</span></NuxtLink>
                </nav>
              </section>
            </div>
          </div>

          <footer id="finish-confirmation" class="finish-encounter__footer" tabindex="-1">
            <label v-if="ready" class="finish-encounter__confirmation" :data-checked="confirmed || undefined">
              <input v-model="confirmed" type="checkbox" :disabled="busy">
              <span>I reviewed this settlement and understand it cannot be partly applied.</span>
            </label>
            <div class="finish-encounter__footer-actions">
              <button type="button" class="finish-encounter__back" :disabled="busy" @click="close">Back to encounter</button>
              <button v-if="ready" type="button" class="finish-encounter__commit" :disabled="!confirmed || !canCommit || busy" @click="submit">
                {{ state === 'saving' ? 'Finishing…' : 'Finish encounter' }}
              </button>
              <button v-else-if="view.state === 'blocked' || state === 'error'" type="button" class="finish-encounter__refresh" :disabled="busy" @click="emit('refresh')">Refresh review</button>
            </div>
          </footer>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
:global(html.finish-encounter-page-lock), :global(html.finish-encounter-page-lock body) { overflow: hidden; max-inline-size: 100%; }
:global(html.finish-encounter-page-lock body > #__nuxt) { inline-size: 100vw; block-size: 100dvh; overflow: clip; }
.finish-encounter-layer {
  position: fixed;
  z-index: calc(var(--rt-layer-modal) + 2);
  inset: 0;
  display: grid;
  place-items: center;
  padding: clamp(.5rem, 2vw, 1.5rem);
  background: rgb(2 5 9 / 82%);
  overscroll-behavior: contain;
}
.finish-encounter {
  position: relative;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  width: min(74rem, 100%);
  max-height: min(94dvh, 58rem);
  min-width: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--rt-focus) 42%, var(--rt-rule));
  border-radius: var(--rt-radius-medium);
  background: var(--rt-surface-1);
  box-shadow: var(--rt-elevation-5);
  clip-path: polygon(0 0, calc(100% - var(--rt-notch-size)) 0, 100% var(--rt-notch-size), 100% 100%, 0 100%);
  animation: finish-encounter-enter var(--rt-motion-panel) var(--rt-ease-enter) both;
}
.finish-encounter::before { content: ''; position: absolute; z-index: 2; inset: 0 auto 0 0; width: 3px; background: var(--rt-focus); pointer-events: none; }
.finish-encounter :where(div, section, nav, ol, ul, li, span, p, h2, h3, strong, label, button, a) { min-width: 0; }
.finish-encounter :where(p, h2, h3, strong, span, button, a) { overflow-wrap: anywhere; }
.finish-encounter__header { grid-row: 1; display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1rem clamp(1rem, 2.4vw, 2rem); border-bottom: 1px solid var(--rt-rule); background: var(--rt-bg-canvas); }
.finish-encounter__header p, .finish-encounter__section-heading p { margin: 0; color: var(--rt-focus); font-size: var(--rt-type-label-sm-size); font-weight: 850; letter-spacing: .09em; text-transform: uppercase; }
.finish-encounter__header h2 { margin: .12rem 0 0; color: var(--rt-text-strong); font-size: clamp(1.65rem, 3vw, 2.5rem); line-height: 1; }
.finish-encounter__encounter-name { display: block; margin-top: .35rem; color: var(--rt-text-muted); }
.finish-encounter__header > button { flex: 0 0 var(--rt-touch-minimum); width: var(--rt-touch-minimum); height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-size: 1.35rem; }
.finish-encounter__alert { grid-row: 2; margin: 0; padding: .7rem clamp(1rem, 2.4vw, 2rem); border-bottom: 1px solid color-mix(in srgb, var(--rt-danger) 55%, var(--rt-rule)); background: color-mix(in srgb, var(--rt-danger) 12%, var(--rt-bg-canvas)); color: var(--rt-text-strong); }
.finish-encounter__body { grid-row: 3; display: grid; grid-template-columns: minmax(11rem, 14rem) minmax(0, 1fr); min-height: 0; overflow: hidden; }
.finish-encounter__rail { min-width: 0; padding: 1rem .75rem; overflow-y: auto; border-right: 1px solid var(--rt-rule); background: var(--rt-bg-canvas); }
.finish-encounter__rail ol { display: grid; gap: .25rem; margin: 0; padding: 0; list-style: none; }
.finish-encounter__rail button { display: grid; grid-template-columns: 2rem minmax(0, 1fr); align-items: center; gap: .65rem; width: 100%; min-height: var(--rt-touch-minimum); padding: .4rem .5rem; border: 1px solid transparent; border-radius: var(--rt-radius-small); background: transparent; color: var(--rt-text); font: inherit; text-align: left; }
.finish-encounter__rail li[data-current] button { border-color: color-mix(in srgb, var(--rt-focus) 42%, transparent); background: color-mix(in srgb, var(--rt-focus) 8%, transparent); }
.finish-encounter__step-mark { display: grid; place-items: center; width: 1.75rem; height: 1.75rem; border: 1px solid var(--rt-rule); border-radius: 50%; color: var(--rt-success); font-weight: 900; }
.finish-encounter__rail small { display: block; color: var(--rt-text-muted); font-size: var(--rt-meta-xs-size, .75rem); }
.finish-encounter__review { min-width: 0; overflow: auto; padding: clamp(.85rem, 2vw, 1.5rem) clamp(1rem, 2.5vw, 2rem) 2rem; scroll-behavior: smooth; }
.finish-encounter__readiness { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 1rem; align-items: center; padding: 1rem; border: 1px solid color-mix(in srgb, var(--rt-success) 55%, var(--rt-rule)); border-left: 4px solid var(--rt-success); background: color-mix(in srgb, var(--rt-success) 8%, var(--rt-surface-2)); }
.finish-encounter__readiness[data-state='blocked'] { border-color: color-mix(in srgb, var(--rt-pending) 55%, var(--rt-rule)); border-left-color: var(--rt-pending); background: color-mix(in srgb, var(--rt-pending) 8%, var(--rt-surface-2)); }
.finish-encounter__readiness-icon { display: grid; place-items: center; width: 2.7rem; height: 2.7rem; border: 2px solid currentColor; border-radius: 50%; color: var(--rt-success); font-size: 1.35rem; font-weight: 900; }
.finish-encounter__readiness[data-state='blocked'] .finish-encounter__readiness-icon { color: var(--rt-pending); }
.finish-encounter__readiness p { margin: 0; color: var(--rt-success); font-size: var(--rt-type-label-sm-size); font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
.finish-encounter__readiness[data-state='blocked'] p { color: var(--rt-pending); }
.finish-encounter__readiness h3 { margin: .1rem 0; color: var(--rt-text-strong); font-size: var(--rt-type-heading-md-size); }
.finish-encounter__readiness span:last-child { color: var(--rt-text-muted); }
.finish-encounter__totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin: 1rem 0; border: 1px solid var(--rt-rule); background: var(--rt-rule); }
.finish-encounter__totals span { min-width: 0; padding: .75rem; background: var(--rt-bg-canvas); color: var(--rt-text-muted); }
.finish-encounter__totals strong { display: block; color: var(--rt-text-strong); font-size: 1.2rem; }
.finish-encounter__review-section { padding: 1.25rem 0; border-top: 1px solid var(--rt-rule); }
.finish-encounter__section-heading { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin-bottom: .65rem; }
.finish-encounter__section-heading h3 { margin: .1rem 0 0; color: var(--rt-text-strong); font-size: var(--rt-type-heading-md-size); }
.finish-encounter__section-heading > span { color: var(--rt-text-muted); font-weight: 750; }
.finish-encounter__rows, .finish-encounter__gates ol, .finish-encounter__outstanding ul { margin: 0; padding: 0; list-style: none; }
.finish-encounter__rows li { display: grid; grid-template-columns: 1.8rem minmax(0, 1fr) auto; align-items: center; gap: .7rem; min-width: 0; padding: .7rem .2rem; border-top: 1px solid color-mix(in srgb, var(--rt-rule) 72%, transparent); }
.finish-encounter__rows li:first-child { border-top: 0; }
.finish-encounter__rows strong, .finish-encounter__gates strong { color: var(--rt-text-strong); }
.finish-encounter__rows p, .finish-encounter__gates p { margin: .12rem 0 0; color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); overflow-wrap: anywhere; }
.finish-encounter__row-icon { color: var(--rt-focus); font-weight: 900; text-align: center; }
.finish-encounter__rows > li > span:last-child { max-width: 14rem; color: var(--rt-text); font-weight: 800; text-align: right; overflow-wrap: anywhere; }
.finish-encounter__result { text-transform: capitalize; }
.finish-encounter__empty { color: var(--rt-text-muted); }
.finish-encounter__gates { margin-top: 1rem; padding: 1rem; border: 1px solid color-mix(in srgb, var(--rt-pending) 58%, var(--rt-rule)); border-left: 4px solid var(--rt-pending); background: color-mix(in srgb, var(--rt-pending) 7%, var(--rt-bg-canvas)); }
.finish-encounter__gates li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem; padding: .7rem 0; border-top: 1px solid var(--rt-rule); }
.finish-encounter__gates li:first-child { border-top: 0; }
.finish-encounter__gates button, .finish-encounter__state button { min-height: var(--rt-touch-minimum); padding: .55rem .8rem; border: 1px solid var(--rt-focus); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 750; }
.finish-encounter__outstanding { margin-top: 1rem; padding: 1rem; border: 1px solid color-mix(in srgb, var(--rt-pending) 50%, var(--rt-rule)); border-left: 4px solid var(--rt-pending); background: color-mix(in srgb, var(--rt-pending) 7%, var(--rt-bg-canvas)); }
.finish-encounter__outstanding .finish-encounter__section-heading p, .finish-encounter__outstanding .finish-encounter__section-heading > span { color: var(--rt-pending); }
.finish-encounter__outstanding li { display: grid; gap: .1rem; padding: .4rem 0; }
.finish-encounter__outstanding li span { color: var(--rt-text-muted); }
.finish-encounter__accepted { margin-top: 1rem; padding: 1rem; border: 1px solid var(--rt-success); background: color-mix(in srgb, var(--rt-success) 8%, var(--rt-bg-canvas)); }
.finish-encounter__accepted h3 { margin: 0; color: var(--rt-text-strong); }
.finish-encounter__accepted p { color: var(--rt-text-muted); }
.finish-encounter__accepted nav { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }
.finish-encounter__accepted a { display: grid; gap: .15rem; min-height: var(--rt-touch-minimum); padding: .65rem; border: 1px solid var(--rt-rule); background: var(--rt-surface-2); color: var(--rt-text); text-decoration: none; }
.finish-encounter__accepted a span { color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); }
.finish-encounter__footer { grid-row: 4; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem; padding: .8rem clamp(1rem, 2.4vw, 2rem); border-top: 1px solid var(--rt-rule); background: var(--rt-bg-canvas); box-shadow: 0 -12px 28px rgb(0 0 0 / 20%); }
.finish-encounter__confirmation { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: .75rem; min-height: var(--rt-touch-minimum); padding: .45rem .65rem; border: 2px solid var(--rt-rule); background: var(--rt-surface-1); cursor: pointer; }
.finish-encounter__confirmation:focus-within { outline: 3px solid var(--rt-focus); outline-offset: 2px; border-color: var(--rt-focus); }
.finish-encounter__confirmation[data-checked] { border-color: var(--rt-success); }
.finish-encounter__confirmation input { width: 1.4rem; height: 1.4rem; accent-color: var(--rt-focus); }
.finish-encounter__footer-actions, .finish-encounter__state-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; }
.finish-encounter__footer button { min-height: var(--rt-touch-minimum); padding: .55rem 1rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); font: inherit; font-weight: 850; }
.finish-encounter__back { background: var(--rt-surface-2); color: var(--rt-text-strong); }
.finish-encounter__commit { min-width: 10.5rem; border-color: var(--rt-brand) !important; background: var(--rt-brand); color: var(--rt-on-brand); }
.finish-encounter__refresh { border-color: var(--rt-focus) !important; background: var(--rt-surface-2); color: var(--rt-text-strong); }
.finish-encounter button:disabled { cursor: not-allowed; opacity: .48; }
.finish-encounter button:focus-visible, .finish-encounter a:focus-visible, .finish-encounter [tabindex='-1']:focus-visible, .finish-encounter__review:focus-visible { outline: var(--rt-border-focus) solid var(--rt-focus); outline-offset: 2px; }
.finish-encounter__state { grid-row: 3; display: grid; overflow: auto; justify-items: start; align-content: center; min-height: min(60dvh, 30rem); padding: clamp(1.5rem, 5vw, 4rem); }
.finish-encounter__state h3 { margin: .5rem 0 .2rem; color: var(--rt-text-strong); font-size: var(--rt-type-heading-md-size); }
.finish-encounter__state p { max-width: 46rem; color: var(--rt-text-muted); }
.finish-encounter__state-icon { display: grid; place-items: center; width: 3rem; height: 3rem; border: 2px solid var(--rt-pending); border-radius: 50%; color: var(--rt-pending); font-size: 1.4rem; font-weight: 900; }
.finish-encounter__pulse { width: 2rem; height: 2rem; border: 3px solid var(--rt-rule); border-top-color: var(--rt-focus); border-radius: 50%; animation: finish-encounter-spin .8s linear infinite; }
.finish-encounter__offline { color: var(--rt-pending) !important; font-weight: 800; }
@keyframes finish-encounter-enter { from { opacity: 0; transform: translateY(16px) scale(.985); } }
@keyframes finish-encounter-spin { to { transform: rotate(360deg); } }
@media (max-width: 62rem) {
  .finish-encounter__body { grid-template-columns: 1fr; overflow: auto; }
  .finish-encounter__rail { overflow: visible; border-right: 0; border-bottom: 1px solid var(--rt-rule); }
  .finish-encounter__rail ol { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .finish-encounter__rail button { grid-template-columns: 1fr; justify-items: center; padding: .3rem; text-align: center; }
  .finish-encounter__rail button > span:last-child { font-size: .78rem; overflow-wrap: anywhere; }
  .finish-encounter__step-mark { width: 1.5rem; height: 1.5rem; }
  .finish-encounter__review { overflow: visible; }
  .finish-encounter__footer { grid-template-columns: 1fr; }
  .finish-encounter__footer-actions { justify-content: stretch; }
  .finish-encounter__footer-actions button { flex: 1 1 10rem; }
}
@media (max-width: 36rem) {
  .finish-encounter-layer { align-items: end; padding: 0; }
  .finish-encounter { width: 100%; max-height: 100dvh; border-right: 0; border-bottom: 0; border-left: 0; border-radius: 0; clip-path: none; }
  .finish-encounter__header { padding: .8rem 1rem; }
  .finish-encounter__rail { padding: .55rem; overflow: visible; }
  .finish-encounter__rail ol { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .finish-encounter__rail button { grid-template-columns: 1.5rem minmax(0, 1fr); justify-items: start; text-align: left; }
  .finish-encounter__review { padding: .8rem 1rem 1.5rem; }
  .finish-encounter__totals { grid-template-columns: 1fr; }
  .finish-encounter__rows li { grid-template-columns: 1.6rem minmax(0, 1fr); }
  .finish-encounter__rows > li > span:last-child { grid-column: 2; max-width: none; text-align: left; }
  .finish-encounter__gates li { grid-template-columns: 1fr; }
  .finish-encounter__gates button { width: 100%; }
  .finish-encounter__accepted nav { grid-template-columns: 1fr; }
  .finish-encounter__footer { padding: .7rem 1rem max(.7rem, env(safe-area-inset-bottom)); }
  .finish-encounter__footer-actions { display: grid; grid-template-columns: 1fr; }
  .finish-encounter__footer-actions button { width: 100%; }
}
@media (max-width: 12rem) {
  .finish-encounter__header { gap: .5rem; padding: .7rem; }
  .finish-encounter__header h2 { font-size: 1.55rem; }
  .finish-encounter__rail { padding: .45rem; }
  .finish-encounter__rail ol { grid-template-columns: 1fr; }
  .finish-encounter__review { padding: .65rem .7rem 1rem; }
  .finish-encounter__readiness { grid-template-columns: 1fr; padding: .7rem; }
  .finish-encounter__section-heading { display: grid; gap: .3rem; }
  .finish-encounter__accepted, .finish-encounter__outstanding, .finish-encounter__gates { padding: .7rem; }
  .finish-encounter__footer { padding: .65rem .7rem max(.65rem, env(safe-area-inset-bottom)); }
}
@media (prefers-reduced-motion: reduce) {
  .finish-encounter, .finish-encounter__pulse { animation: none; }
  .finish-encounter__review { scroll-behavior: auto; }
}
</style>
