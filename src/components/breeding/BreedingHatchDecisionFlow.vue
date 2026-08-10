<script setup lang="ts">
import {
  PhArrowClockwise,
  PhCheckCircle,
  PhEgg,
  PhSparkle,
  PhWarning,
  PhX,
} from '@phosphor-icons/vue'
import { nextTick, ref, watch } from 'vue'
import {
  breedingHatchDestinationLabel,
  breedingHatchDestinationReasonMessage,
  breedingHatchWorkflowOutcomeLabel,
  breedingHatchWorkflowReasonMessage,
  type BreedingHatchWorkflowProjectionV1,
} from '#shared/breeding/hatchWorkflow'
import { sheetEditorPath } from '~/utils/sheetRoutes'

const props = defineProps<{
  open: boolean
  projection: BreedingHatchWorkflowProjectionV1 | null
  loading: boolean
  submitting: boolean
  error: string | null
}>()
const emit = defineEmits<{
  close: []
  retry: []
  begin: [destinationOptionId: string]
  resolveSpecial: [optionId: string]
  complete: []
}>()
const title = ref<HTMLElement | null>(null)
const selectedDestinationOptionId = ref<string | null>(null)
const selectedSpecialOptionId = ref<string | null>(null)

const transitionMessage = (projection: BreedingHatchWorkflowProjectionV1): string => ({
  none: '',
  'hatch-started': 'Hatching started. The child is ready for final reveal.',
  'special-review-required': projection.audience === 'gm'
    ? 'A special result requires one bounded GM decision.'
    : 'A special result was detected. The GM must resolve it before the hatch continues.',
  'special-resolved': 'The special result was accepted. The child is ready for final reveal.',
  'child-revealed': `${projection.childReveal?.speciesName ?? 'The child'} hatched and joined the Trainer’s ${projection.childReveal?.destinationKind === 'team' ? 'team' : 'Box'}.`,
  'exact-replay': 'The already accepted hatch result was restored without repeating the action.',
})[projection.transition]
const genderLabel = (value: 'female' | 'male' | 'genderless'): string => ({
  female: 'Female', male: 'Male', genderless: 'Genderless',
})[value]
const confirmBegin = (): void => {
  if (selectedDestinationOptionId.value) emit('begin', selectedDestinationOptionId.value)
}
const confirmSpecial = (): void => {
  if (selectedSpecialOptionId.value) emit('resolveSpecial', selectedSpecialOptionId.value)
}
const childSheetPath = (slug: string): string => sheetEditorPath('pokemon', slug)
const trainerSheetPath = (slug: string): string => sheetEditorPath('trainer', slug)
const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && props.open && !props.submitting) emit('close')
}

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  title.value?.focus()
})
watch(() => props.projection?.egg.revision, () => {
  selectedDestinationOptionId.value = null
  selectedSpecialOptionId.value = null
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="hatch-flow-backdrop rt-design-system"
      data-rt-design-system="1"
      @keydown="onKeydown"
    >
      <section
        class="hatch-flow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hatch-flow-title"
        :aria-busy="loading || submitting"
      >
        <header class="hatch-flow__header">
          <div>
            <p>Authoritative Egg lifecycle</p>
            <h2 id="hatch-flow-title" ref="title" tabindex="-1">
              {{ projection ? `${projection.egg.speciesName} hatch` : 'Hatch decision' }}
            </h2>
          </div>
          <button
            type="button"
            class="hatch-flow__icon-button"
            aria-label="Close hatch decision"
            :disabled="submitting"
            @click="emit('close')"
          >
            <PhX :size="22" weight="bold" aria-hidden="true" />
          </button>
        </header>

        <div v-if="loading && !projection" class="hatch-flow__state" role="status" aria-live="polite">
          <PhEgg :size="30" weight="duotone" aria-hidden="true" />
          <div>
            <h3>Rebuilding current hatch authority</h3>
            <p>Checking the Egg, owner Trainer, campaign clock, and accepted lifecycle state…</p>
          </div>
        </div>

        <div v-else-if="error" class="hatch-flow__state hatch-flow__state--error" role="alert">
          <PhWarning :size="28" weight="duotone" aria-hidden="true" />
          <div>
            <h3>Hatch workflow unavailable</h3>
            <p>{{ error }}</p>
          </div>
          <button type="button" class="hatch-flow__button" @click="emit('retry')">
            <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
            Retry current state
          </button>
        </div>

        <template v-else-if="projection">
          <p
            v-if="transitionMessage(projection)"
            class="hatch-flow__announcement"
            role="status"
            aria-live="polite"
          >
            <PhCheckCircle :size="20" weight="fill" aria-hidden="true" />
            {{ transitionMessage(projection) }}
          </p>

          <div class="hatch-flow__summary">
            <span class="hatch-flow__status" :data-stage="projection.stage">
              {{ projection.stage.replaceAll('-', ' ') }}
            </span>
            <span>Egg revision {{ projection.egg.revision }}</span>
            <span>{{ projection.audience === 'gm' ? 'GM decision view' : 'Owner decision view' }}</span>
          </div>

          <div v-if="projection.recovery.state === 'pending'" class="hatch-flow__state hatch-flow__state--warning" role="status">
            <PhWarning :size="26" weight="duotone" aria-hidden="true" />
            <div>
              <h3>System recovery required</h3>
              <p>No hatch choice is available while an accepted result is uncertain. Refresh authoritative state instead.</p>
            </div>
            <button type="button" class="hatch-flow__button hatch-flow__button--secondary" @click="emit('retry')">
              Refresh recovery state
            </button>
          </div>

          <section v-else-if="projection.decision.kind === 'begin-hatch'" class="hatch-flow__decision hatch-flow__decision--stacked" aria-labelledby="begin-hatch-title">
            <div>
              <h3 id="begin-hatch-title">Choose where the child will join</h3>
              <p>The server rebuilt both destinations from the current Trainer roster. It will persist exactly one special-result roll only after you confirm an available choice.</p>
            </div>
            <fieldset class="hatch-flow__options hatch-flow__destinations">
              <legend>Child destination</legend>
              <label
                v-for="option in projection.destination.options"
                :key="option.optionId"
                :class="{ 'is-unavailable': option.availability === 'unavailable' }"
              >
                <input
                  v-model="selectedDestinationOptionId"
                  type="radio"
                  name="hatch-destination-option"
                  :value="option.optionId"
                  :disabled="option.availability === 'unavailable'"
                >
                <span>
                  <strong>{{ breedingHatchDestinationLabel(option.kind) }}</strong>
                  <small v-if="option.kind === 'team'">
                    {{ option.remainingTeamSlots }} of {{ projection.destination.teamCapacity }} team slots available
                  </small>
                  <small v-else>Always available for this ready Egg.</small>
                  <small v-if="option.reasonId" class="hatch-flow__option-warning">
                    {{ breedingHatchDestinationReasonMessage(option.reasonId) }}
                  </small>
                </span>
              </label>
            </fieldset>
            <p class="hatch-flow__selection-note">The accepted destination is bound to this hatch and cannot be changed during reveal.</p>
            <button
              type="button"
              class="hatch-flow__button"
              :disabled="!selectedDestinationOptionId || submitting"
              @click="confirmBegin"
            >
              <PhSparkle :size="19" weight="fill" aria-hidden="true" />
              {{ submitting ? 'Starting hatch…' : 'Confirm destination and begin hatch' }}
            </button>
          </section>

          <section
            v-else-if="projection.decision.kind === 'resolve-special' && projection.special.gmReview"
            class="hatch-flow__decision hatch-flow__decision--stacked"
            aria-labelledby="special-review-title"
          >
            <div>
              <p class="hatch-flow__eyebrow">Persisted d100: {{ projection.special.gmReview.rollTotal }}</p>
              <h3 id="special-review-title">Choose the bounded special result</h3>
              <p>This decision does not automatically make the child Shiny or alter its resolved Nature.</p>
            </div>
            <fieldset class="hatch-flow__options">
              <legend>Special hatch outcome</legend>
              <label v-for="option in projection.special.gmReview.options" :key="option.optionId">
                <input v-model="selectedSpecialOptionId" type="radio" name="hatch-special-option" :value="option.optionId">
                <span>
                  <strong>{{ option.label }}</strong>
                  <small>{{ option.description }}</small>
                </span>
              </label>
            </fieldset>
            <button
              type="button"
              class="hatch-flow__button"
              :disabled="!selectedSpecialOptionId || submitting"
              @click="confirmSpecial"
            >
              {{ submitting ? 'Accepting decision…' : 'Confirm special outcome' }}
            </button>
          </section>

          <section v-else-if="projection.decision.kind === 'complete-hatch'" class="hatch-flow__decision" aria-labelledby="complete-hatch-title">
            <PhSparkle :size="42" weight="duotone" aria-hidden="true" />
            <div>
              <p v-if="projection.special.outcomeId" class="hatch-flow__eyebrow">
                {{ breedingHatchWorkflowOutcomeLabel(projection.special.outcomeId) }} accepted
              </p>
              <h3 id="complete-hatch-title">Reveal and accept the child?</h3>
              <p>Confirmation atomically creates the initialized child sheet, links the Trainer’s {{ projection.destination.acceptedKind === 'team' ? 'active team' : 'Pokémon Box' }}, settles the Egg, and records lineage.</p>
              <button
                type="button"
                class="hatch-flow__button"
                :disabled="submitting"
                @click="emit('complete')"
              >
                <PhSparkle :size="19" weight="fill" aria-hidden="true" />
                {{ submitting ? 'Completing hatch…' : 'Confirm and reveal child' }}
              </button>
            </div>
          </section>

          <section v-else-if="projection.childReveal" class="hatch-flow__reveal" aria-labelledby="child-reveal-title">
            <div class="hatch-flow__reveal-mark" aria-hidden="true">
              <PhSparkle :size="54" weight="fill" />
            </div>
            <p class="hatch-flow__eyebrow">Accepted at campaign minute {{ projection.childReveal.hatchedAtCampaignMinute }}</p>
            <h3 id="child-reveal-title">{{ projection.childReveal.speciesName }} hatched!</h3>
            <p>The child is durably linked to the Trainer’s {{ projection.childReveal.destinationKind === 'team' ? 'team' : 'Box' }}.</p>
            <dl>
              <div><dt>Nature</dt><dd>{{ projection.childReveal.natureName }}</dd></div>
              <div><dt>Ability</dt><dd>{{ projection.childReveal.abilityName }}</dd></div>
              <div><dt>Gender</dt><dd>{{ genderLabel(projection.childReveal.genderId) }}</dd></div>
              <div><dt>Starting Level</dt><dd>{{ projection.childReveal.startingLevel }}</dd></div>
            </dl>
            <nav class="hatch-flow__navigation" aria-label="Accepted hatch navigation">
              <NuxtLink class="hatch-flow__button" :to="childSheetPath(projection.childReveal.childSheetSlug)">
                Open child sheet
              </NuxtLink>
              <NuxtLink class="hatch-flow__button hatch-flow__button--secondary" :to="trainerSheetPath(projection.trainerSheetSlug)">
                Open Trainer sheet
              </NuxtLink>
              <button type="button" class="hatch-flow__button hatch-flow__button--secondary" @click="emit('close')">Return to Workshop</button>
            </nav>
          </section>

          <div v-else class="hatch-flow__state">
            <PhEgg :size="28" weight="duotone" aria-hidden="true" />
            <div>
              <h3>{{ projection.stage === 'awaiting-gm' ? 'Waiting for the GM' : 'No hatch decision available' }}</h3>
              <p v-if="projection.decision.reasonId">{{ breedingHatchWorkflowReasonMessage(projection.decision.reasonId) }}</p>
            </div>
          </div>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.hatch-flow-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: color-mix(in srgb, var(--rt-bg-canvas) 72%, transparent);
  backdrop-filter: blur(5px);
}
.hatch-flow {
  width: min(100%, 42rem);
  max-height: min(90dvh, 54rem);
  overflow: auto;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-large);
  background: var(--rt-surface-1);
  box-shadow: var(--rt-elevation-3);
  color: var(--rt-text);
}
.hatch-flow__header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  border-bottom: 1px solid var(--rt-rule);
  background: var(--rt-surface-1);
}
.hatch-flow__header p,
.hatch-flow__eyebrow {
  margin: 0 0 0.25rem;
  color: var(--rt-focus);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.hatch-flow__header h2,
.hatch-flow h3,
.hatch-flow p { margin-top: 0; }
.hatch-flow__header h2 { margin-bottom: 0; color: var(--rt-text-strong); }
.hatch-flow__icon-button,
.hatch-flow__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-width: 44px;
  min-height: 44px;
  border: 1px solid var(--rt-brand);
  border-radius: var(--rt-radius-small);
  background: var(--rt-brand);
  color: var(--rt-on-brand);
  cursor: pointer;
  font: inherit;
  font-weight: 750;
}
.hatch-flow__icon-button { flex: 0 0 auto; border-color: var(--rt-rule); background: var(--rt-surface-2); color: var(--rt-text); }
.hatch-flow__button--secondary { border-color: var(--rt-rule); background: var(--rt-surface-2); color: var(--rt-text-strong); }
.hatch-flow__button:disabled,
.hatch-flow__icon-button:disabled { cursor: not-allowed; opacity: 0.55; }
.hatch-flow__button:focus-visible,
.hatch-flow__icon-button:focus-visible,
.hatch-flow__options input:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 2px; }
.hatch-flow__summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.8rem 1rem 0;
  color: var(--rt-text-muted);
  font-size: 0.8rem;
}
.hatch-flow__summary span {
  display: inline-flex;
  align-items: center;
  min-height: 2rem;
  padding: 0.2rem 0.6rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-round);
}
.hatch-flow__status { color: var(--rt-success); font-weight: 800; text-transform: capitalize; }
.hatch-flow__status[data-stage='awaiting-gm'],
.hatch-flow__status[data-stage='recovery'] { color: var(--rt-pending); }
.hatch-flow__announcement {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 1rem 0;
  padding: 0.75rem;
  border-left: 4px solid var(--rt-success);
  background: var(--rt-surface-2);
  color: var(--rt-text-strong);
}
.hatch-flow__announcement svg { flex: 0 0 auto; color: var(--rt-success); }
.hatch-flow__state,
.hatch-flow__decision,
.hatch-flow__reveal { margin: 1rem; padding: 1rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-2); }
.hatch-flow__state,
.hatch-flow__decision { display: flex; align-items: center; gap: 1rem; }
.hatch-flow__state > svg,
.hatch-flow__decision > svg { flex: 0 0 auto; color: var(--rt-focus); }
.hatch-flow__state p,
.hatch-flow__decision p,
.hatch-flow__reveal > p { margin-bottom: 0.8rem; color: var(--rt-text-muted); line-height: 1.55; }
.hatch-flow__state--error { border-color: var(--rt-danger); }
.hatch-flow__state--error > svg { color: var(--rt-danger); }
.hatch-flow__state--warning { border-color: var(--rt-pending); }
.hatch-flow__state--warning > svg { color: var(--rt-pending); }
.hatch-flow__decision--stacked { display: grid; align-items: initial; }
.hatch-flow__options { display: grid; gap: 0.5rem; margin: 0; padding: 0; border: 0; }
.hatch-flow__options legend { margin-bottom: 0.5rem; color: var(--rt-text-strong); font-weight: 800; }
.hatch-flow__options label { display: flex; gap: 0.7rem; min-height: 54px; padding: 0.7rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); cursor: pointer; }
.hatch-flow__options label:has(input:checked) { border-color: var(--rt-focus); background: var(--rt-surface-1); }
.hatch-flow__options input { width: 1.2rem; height: 1.2rem; margin-top: 0.15rem; accent-color: var(--rt-brand); }
.hatch-flow__options span { display: grid; gap: 0.2rem; }
.hatch-flow__options strong { color: var(--rt-text-strong); }
.hatch-flow__options small { color: var(--rt-text-muted); line-height: 1.4; }
.hatch-flow__options label.is-unavailable { cursor: not-allowed; opacity: 0.78; }
.hatch-flow__options label.is-unavailable input { cursor: not-allowed; }
.hatch-flow__options .hatch-flow__option-warning { color: var(--rt-pending); font-weight: 700; }
.hatch-flow__selection-note { margin: 0; color: var(--rt-text-muted); font-size: 0.86rem; }
.hatch-flow__reveal { position: relative; overflow: hidden; text-align: center; }
.hatch-flow__reveal-mark { color: var(--rt-success); animation: hatch-reveal 500ms ease-out both; }
.hatch-flow__reveal h3 { margin-bottom: 0.4rem; color: var(--rt-text-strong); font-size: clamp(1.5rem, 5vw, 2.2rem); }
.hatch-flow__reveal dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.65rem; margin: 1rem 0; text-align: left; }
.hatch-flow__reveal dl div { padding: 0.65rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); }
.hatch-flow__reveal dt { color: var(--rt-text-muted); font-size: 0.76rem; font-weight: 700; }
.hatch-flow__reveal dd { margin: 0.2rem 0 0; color: var(--rt-text-strong); font-weight: 750; }
.hatch-flow__navigation { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.6rem; }
.hatch-flow__navigation a { text-decoration: none; }
@keyframes hatch-reveal { from { opacity: 0; transform: scale(0.72) rotate(-12deg); } to { opacity: 1; transform: none; } }
@media (max-width: 520px) {
  .hatch-flow-backdrop { align-items: end; padding: 0; }
  .hatch-flow { max-height: 94dvh; border-radius: var(--rt-radius-large) var(--rt-radius-large) 0 0; }
  .hatch-flow__state,
  .hatch-flow__decision { align-items: flex-start; }
  .hatch-flow__reveal dl { grid-template-columns: 1fr; }
  .hatch-flow__button { width: 100%; }
  .hatch-flow__navigation { display: grid; }
}
@media (prefers-reduced-motion: reduce) {
  .hatch-flow__reveal-mark { animation: none; }
  .hatch-flow-backdrop { backdrop-filter: none; }
}
</style>
