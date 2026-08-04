<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import EncounterMotionCue from '~/components/encounter/EncounterMotionCue.vue'
import EncounterContributionExplanation from './EncounterContributionExplanation.vue'
import type { AcceptedEncounterPresentation } from '#shared/encounterPresentation/contracts'

export interface EncounterUncertainCommandView {
  readonly operationId: string
  readonly label: string
  readonly message: string
  readonly canRetry: boolean
  readonly canAbandon: boolean
}

const props = defineProps<{
  accepted: readonly AcceptedEncounterPresentation[]
  activePresentationId: string | null
  uncertain?: readonly EncounterUncertainCommandView[]
}>()
const emit = defineEmits<{
  open: [presentationId: string]
  retry: [operationId: string]
  abandon: [operationId: string]
}>()
const ordered = computed(() => [...props.accepted].sort((left, right) => (
  right.revision - left.revision
  || right.causal.depth - left.causal.depth
  || right.causal.sequence - left.causal.sequence
  || right.presentationId.localeCompare(left.presentationId)
)))
const HISTORY_BATCH_SIZE = 80
const historyLimit = ref(HISTORY_BATCH_SIZE)
const visibleHistory = computed(() => {
  const visible = ordered.value.slice(0, historyLimit.value)
  const active = props.activePresentationId
    ? ordered.value.find(value => value.presentationId === props.activePresentationId)
    : null
  return active && !visible.some(value => value.presentationId === active.presentationId)
    ? [...visible, active]
    : visible
})
const hiddenHistoryCount = computed(() => Math.max(0, ordered.value.length - historyLimit.value))
const latest = computed(() => ordered.value[0] ?? null)
watch(() => props.accepted, () => { historyLimit.value = HISTORY_BATCH_SIZE })
</script>

<template>
  <section class="encounter-event-feed" aria-labelledby="encounter-history-heading">
    <header id="encounter-history-heading" data-encounter-focus="result-heading" tabindex="-1">
      <p>Accepted history</p>
      <h2>Recent outcomes</h2>
    </header>
    <p v-if="latest" class="encounter-event-feed__announcement" aria-live="polite">
      {{ latest.headline.label }}
    </p>

    <section v-if="uncertain?.length" class="encounter-event-feed__uncertain" aria-label="Uncertain commands">
      <article v-for="command in uncertain" :key="command.operationId">
        <strong>{{ command.label }}</strong>
        <p>{{ command.message }}</p>
        <div>
          <button v-if="command.canRetry" type="button" @click="emit('retry', command.operationId)">Retry exact command</button>
          <button v-if="command.canAbandon" type="button" @click="emit('abandon', command.operationId)">Abandon local wait</button>
        </div>
      </article>
    </section>

    <ol v-if="ordered.length">
      <li
        v-for="(presentation, index) in visibleHistory"
        :id="`history-${presentation.presentationId}`"
        :key="presentation.presentationId"
        :data-presentation-id="presentation.presentationId"
        :data-active="activePresentationId === presentation.presentationId"
        :data-corrected="presentation.correction !== null"
        tabindex="-1"
      >
        <EncounterMotionCue :cue="presentation.correction ? 'correct' : index === 0 ? 'settle' : 'pulse'" :replay-key="presentation.presentationId">
          <article>
            <button type="button" class="encounter-event-feed__open" @click="emit('open', presentation.presentationId)">
              <span class="encounter-event-feed__revision rt-numeric">r{{ presentation.revision }}</span>
              <span>
                <strong>{{ presentation.headline.label }}</strong>
                <small>{{ presentation.source.displayName }}<template v-if="presentation.actor"> · {{ presentation.actor.displayName }}</template></small>
              </span>
            </button>
            <p v-if="presentation.correction" class="encounter-event-feed__correction">
              Corrects {{ presentation.correction.correctsPresentationId }} · {{ presentation.correction.reasonLabel }}
            </p>
            <details>
              <summary>Structured result</summary>
              <ul v-if="presentation.outcomes.length">
                <li v-for="outcome in presentation.outcomes" :key="outcome.outcomeId">{{ outcome.label }}</li>
              </ul>
              <dl v-if="presentation.changes.length">
                <div v-for="change in presentation.changes" :key="change.changeId">
                  <dt>{{ change.label }}</dt>
                  <dd class="rt-numeric"><template v-if="change.delta !== null">{{ change.delta > 0 ? '+' : '' }}{{ change.delta }}</template><template v-else>{{ change.operation }}</template></dd>
                </div>
              </dl>
              <EncounterContributionExplanation
                v-for="explanation in presentation.explanations"
                :key="explanation.explanationId"
                :explanation="explanation"
              />
            </details>
          </article>
        </EncounterMotionCue>
      </li>
    </ol>
    <button
      v-if="hiddenHistoryCount > 0"
      type="button"
      class="encounter-event-feed__more"
      @click="historyLimit += HISTORY_BATCH_SIZE"
    >
      Show {{ Math.min(HISTORY_BATCH_SIZE, hiddenHistoryCount) }} older outcomes
    </button>
    <p v-else-if="ordered.length === 0" class="encounter-event-feed__empty">Accepted actions will appear here in authoritative causal order.</p>
  </section>
</template>

<style scoped>
.encounter-event-feed { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--rt-rule); }
.encounter-event-feed > header p { margin: 0; color: var(--rt-info); font-size: var(--rt-type-label-sm-size); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.encounter-event-feed h2 { margin: 0; color: var(--rt-text-strong); font-size: var(--rt-type-heading-md-size); }
.encounter-event-feed__announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.encounter-event-feed__uncertain { display: grid; gap: 0.5rem; margin: 0.75rem 0; }
.encounter-event-feed__uncertain article { padding: 0.65rem; border: 1px solid var(--rt-danger); border-radius: var(--rt-radius-small); background: color-mix(in srgb, var(--rt-danger) 10%, var(--rt-surface-1)); }
.encounter-event-feed__uncertain p { margin: 0.2rem 0; }
.encounter-event-feed__uncertain div { display: flex; gap: 0.35rem; }
.encounter-event-feed__uncertain button { min-height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; }
.encounter-event-feed > ol { display: grid; gap: 0.5rem; margin: 0.75rem 0; padding: 0; list-style: none; }
.encounter-event-feed > ol > li { border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-1); overflow: hidden; }
.encounter-event-feed > ol > li[data-active='true'] { border-color: var(--rt-focus); }
.encounter-event-feed > ol > li[data-corrected='true'] { border-style: dashed; border-color: var(--rt-pending); }
.encounter-event-feed article { min-width: 0; }
.encounter-event-feed__open { width: 100%; min-height: var(--rt-touch-minimum); display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 0.55rem; padding: 0.6rem; border: 0; background: var(--rt-surface-2); color: var(--rt-text); font: inherit; text-align: left; }
.encounter-event-feed__open strong,
.encounter-event-feed__open small { display: block; }
.encounter-event-feed__open small { color: var(--rt-text-muted); }
.encounter-event-feed__revision { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: 50%; background: var(--rt-surface-3); }
.encounter-event-feed__correction { margin: 0; padding: 0.5rem 0.65rem; color: var(--rt-pending); }
.encounter-event-feed article > details { padding: 0.5rem 0.65rem; }
.encounter-event-feed summary { min-height: 2.25rem; display: flex; align-items: center; cursor: pointer; font-weight: 700; }
.encounter-event-feed ul { margin: 0; padding-left: 1.25rem; }
.encounter-event-feed dl { display: grid; gap: 0.25rem; }
.encounter-event-feed dl > div { display: flex; justify-content: space-between; gap: 0.5rem; }
.encounter-event-feed dd { margin: 0; }
.encounter-event-feed__more { width: 100%; min-height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.encounter-event-feed__empty { color: var(--rt-text-muted); }
</style>
