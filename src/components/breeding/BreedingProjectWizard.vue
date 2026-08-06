<script setup lang="ts">
import {
  PhArrowLeft,
  PhArrowRight,
  PhCheck,
  PhClock,
  PhEgg,
  PhWarning,
  PhX,
} from '@phosphor-icons/vue'
import { computed } from 'vue'
import type { BreedingWorkshopOwnershipContextV1 } from '#shared/breeding/workshop'
import type {
  BreedingProjectWizardProjectionV1,
} from '#shared/breeding/projectWizard'
import { BREEDING_PROJECT_WIZARD_STEPS } from '~/composables/breeding/useBreedingProjectWizard'

const props = defineProps<{
  open: boolean
  projection: BreedingProjectWizardProjectionV1 | null
  ownershipContexts: readonly BreedingWorkshopOwnershipContextV1[]
  destinationTrainerSlug: string | null
  breederTrainerSlug: string | null
  selectedParentSlugs: ReadonlySet<string>
  activeStep: number
  loading: boolean
  error: string | null
  canReview: boolean
}>()

const emit = defineEmits<{
  close: []
  retry: []
  selectDestination: [trainerSheetSlug: string]
  selectBreeder: [trainerSheetSlug: string]
  toggleParent: [pokemonSheetSlug: string]
  next: []
  previous: []
}>()

const availableContexts = computed(() => props.ownershipContexts.filter(
  context => context.availability === 'available',
))
const candidates = computed(() => props.projection?.parentDiscovery.trainerSheets
  .flatMap(trainer => trainer.candidates) ?? [])
const selectedCandidates = computed(() => candidates.value.filter(candidate => (
  props.selectedParentSlugs.has(candidate.parentSheetSlug)
)))
const nextDisabled = computed(() => props.loading
  || (props.activeStep === 2 && !props.canReview)
  || props.activeStep >= BREEDING_PROJECT_WIZARD_STEPS.length - 1)
const selectValue = (event: Event): string | null => {
  const target = event.target
  if (!target || typeof target !== 'object' || !('value' in target)
    || typeof target.value !== 'string' || !target.value) return null
  return target.value
}
const handleDestination = (event: Event): void => {
  const value = selectValue(event)
  if (value) emit('selectDestination', value)
}
const handleBreeder = (event: Event): void => {
  const value = selectValue(event)
  if (value) emit('selectBreeder', value)
}
const parentMeta = (candidate: (typeof candidates.value)[number]): string => {
  const values = [
    candidate.speciesId,
    candidate.genderId,
    candidate.level === null ? null : `Level ${candidate.level}`,
  ].filter((value): value is string => value !== null)
  return values.length > 0 ? values.join(' · ') : 'Details unavailable'
}
</script>

<template>
  <section
    v-if="open"
    class="breeding-project-wizard"
    aria-labelledby="breeding-project-wizard-title"
    :aria-busy="loading"
  >
    <header class="breeding-project-wizard__header">
      <div>
        <p class="breeding-project-wizard__eyebrow">New project</p>
        <h2 id="breeding-project-wizard-title">Plan a breeding project</h2>
        <p>Choose campaign contexts and parents. The server rechecks every selection before creation.</p>
      </div>
      <button
        type="button"
        class="breeding-project-wizard__icon-button"
        aria-label="Close project wizard"
        @click="emit('close')"
      >
        <PhX :size="20" weight="bold" aria-hidden="true" />
      </button>
    </header>

    <ol class="breeding-project-wizard__steps" aria-label="Project setup progress">
      <li
        v-for="(step, index) in BREEDING_PROJECT_WIZARD_STEPS"
        :key="step"
        :class="{ 'is-current': activeStep === index, 'is-complete': activeStep > index }"
        :aria-current="activeStep === index ? 'step' : undefined"
      >
        <span aria-hidden="true">
          <PhCheck v-if="activeStep > index" :size="14" weight="bold" />
          <template v-else>{{ index + 1 }}</template>
        </span>
        {{ step }}
      </li>
    </ol>

    <div v-if="error" class="breeding-project-wizard__state breeding-project-wizard__state--error" role="alert">
      <PhWarning :size="24" weight="duotone" aria-hidden="true" />
      <div>
        <h3>Project setup could not refresh</h3>
        <p>{{ error }}</p>
        <button type="button" class="breeding-project-wizard__button" @click="emit('retry')">Retry</button>
      </div>
    </div>

    <div v-else-if="loading && !projection" class="breeding-project-wizard__state" role="status" aria-live="polite">
      <PhEgg :size="26" weight="duotone" aria-hidden="true" />
      <div>
        <h3>Preparing current choices</h3>
        <p>Loading Trainer ownership, parents, and campaign time…</p>
      </div>
    </div>

    <template v-else-if="projection">
      <div class="breeding-project-wizard__content">
        <section v-if="activeStep === 0" aria-labelledby="wizard-destination-title">
          <p class="breeding-project-wizard__eyebrow">Step 1</p>
          <h3 id="wizard-destination-title">Choose the Egg destination</h3>
          <p>The destination Trainer owns the project and receives its resulting Egg.</p>
          <label class="breeding-project-wizard__field">
            <span>Destination Trainer</span>
            <select :value="destinationTrainerSlug" :disabled="loading" @change="handleDestination">
              <option
                v-for="context in availableContexts"
                :key="context.trainerSheetSlug"
                :value="context.trainerSheetSlug"
              >
                {{ context.displayName }}
              </option>
            </select>
          </label>
        </section>

        <section v-else-if="activeStep === 1" aria-labelledby="wizard-breeder-title">
          <p class="breeding-project-wizard__eyebrow">Step 2</p>
          <h3 id="wizard-breeder-title">Choose the Breeder</h3>
          <p>The selected Trainer performs the project’s server-authoritative Breeder check.</p>
          <label class="breeding-project-wizard__field">
            <span>Breeder Trainer</span>
            <select :value="breederTrainerSlug" :disabled="loading" @change="handleBreeder">
              <option
                v-for="context in availableContexts"
                :key="context.trainerSheetSlug"
                :value="context.trainerSheetSlug"
              >
                {{ context.displayName }}
              </option>
            </select>
          </label>
        </section>

        <section v-else-if="activeStep === 2" aria-labelledby="wizard-parents-title">
          <p class="breeding-project-wizard__eyebrow">Step 3</p>
          <h3 id="wizard-parents-title">Choose two parents</h3>
          <p>Select exactly two current roster entries. Unavailable entries cannot be selected.</p>
          <p class="breeding-project-wizard__selection-count" role="status" aria-live="polite">
            {{ selectedParentSlugs.size }} of 2 parents selected
          </p>

          <div v-if="candidates.length > 0" class="breeding-project-wizard__parents">
            <label
              v-for="candidate in candidates"
              :key="candidate.parentSheetSlug"
              class="breeding-project-wizard__parent"
              :class="{
                'is-selected': selectedParentSlugs.has(candidate.parentSheetSlug),
                'is-unavailable': candidate.availability.status !== 'selectable',
              }"
            >
              <input
                type="checkbox"
                :checked="selectedParentSlugs.has(candidate.parentSheetSlug)"
                :disabled="loading || candidate.availability.status !== 'selectable'
                  || (!selectedParentSlugs.has(candidate.parentSheetSlug) && selectedParentSlugs.size >= 2)"
                @change="emit('toggleParent', candidate.parentSheetSlug)"
              >
              <span>
                <strong>{{ candidate.label }}</strong>
                <small>{{ parentMeta(candidate) }}</small>
                <small v-if="candidate.availability.status !== 'selectable'">Unavailable</small>
              </span>
            </label>
          </div>
          <div v-else class="breeding-project-wizard__state" data-testid="breeding-wizard-no-parents">
            <PhEgg :size="24" weight="duotone" aria-hidden="true" />
            <div>
              <h3>No parent candidates are available</h3>
              <p>Add current Pokémon to an authorized Trainer roster, then retry.</p>
            </div>
          </div>
          <p
            v-if="projection.reviewStatus === 'pair-unavailable'"
            class="breeding-project-wizard__notice"
            role="alert"
          >
            This pair is unavailable under the current campaign authority.
          </p>
        </section>

        <section v-else aria-labelledby="wizard-review-title">
          <p class="breeding-project-wizard__eyebrow">Step 4</p>
          <h3 id="wizard-review-title">Review the project plan</h3>
          <dl class="breeding-project-wizard__summary">
            <div>
              <dt>Destination</dt>
              <dd>{{ projection.destination.displayName }}</dd>
            </div>
            <div>
              <dt>Breeder</dt>
              <dd>{{ projection.breeder.displayName }}</dd>
            </div>
            <div>
              <dt>Parents</dt>
              <dd>{{ selectedCandidates.map(candidate => candidate.label).join(' and ') }}</dd>
            </div>
            <div>
              <dt>Consent</dt>
              <dd>
                {{ projection.consentStatus === 'not-required'
                  ? 'Same-owner selection'
                  : 'Owner review required' }}
              </dd>
            </div>
          </dl>

          <div class="breeding-project-wizard__timeline" aria-labelledby="wizard-timeline-title">
            <PhClock :size="24" weight="duotone" aria-hidden="true" />
            <div>
              <h3 id="wizard-timeline-title">Campaign timeline</h3>
              <ol>
                <li>{{ projection.timeline.initialCampaignMinutes }} initial campaign minutes</li>
                <li>Breeder check at DC {{ projection.timeline.breederCheckDifficultyClass }}</li>
                <li>{{ projection.timeline.additionalCampaignMinutes }} additional campaign minutes after success</li>
                <li>Egg production when current validation succeeds</li>
              </ol>
              <p>Only the campaign clock advances this timeline.</p>
            </div>
          </div>

          <div class="breeding-project-wizard__confirmation">
            <p role="status">
              No project has been created. Final choices, consent, and current server validation are still required.
            </p>
            <button type="button" class="breeding-project-wizard__button" disabled>
              Create project
            </button>
          </div>
        </section>
      </div>

      <footer class="breeding-project-wizard__footer">
        <button
          type="button"
          class="breeding-project-wizard__button breeding-project-wizard__button--secondary"
          :disabled="activeStep === 0 || loading"
          @click="emit('previous')"
        >
          <PhArrowLeft :size="18" weight="bold" aria-hidden="true" />
          Back
        </button>
        <button
          v-if="activeStep < BREEDING_PROJECT_WIZARD_STEPS.length - 1"
          type="button"
          class="breeding-project-wizard__button"
          :disabled="nextDisabled"
          @click="emit('next')"
        >
          {{ activeStep === 2 ? 'Review project' : 'Continue' }}
          <PhArrowRight :size="18" weight="bold" aria-hidden="true" />
        </button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.breeding-project-wizard {
  display: grid;
  gap: 1rem;
  padding: clamp(1rem, 3vw, 1.5rem);
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-large);
  background: var(--rt-surface-1);
  box-shadow: var(--rt-elevation-1);
  color: var(--rt-text);
}

.breeding-project-wizard__header,
.breeding-project-wizard__footer,
.breeding-project-wizard__confirmation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.breeding-project-wizard h2,
.breeding-project-wizard h3,
.breeding-project-wizard p {
  margin-top: 0;
}

.breeding-project-wizard h2,
.breeding-project-wizard h3 {
  color: var(--rt-text-strong);
}

.breeding-project-wizard__header p,
.breeding-project-wizard__content > section > p,
.breeding-project-wizard__state p,
.breeding-project-wizard__timeline p,
.breeding-project-wizard__confirmation p {
  color: var(--rt-text-muted);
  line-height: 1.5;
}

.breeding-project-wizard__eyebrow {
  margin-bottom: 0.3rem;
  color: var(--rt-focus) !important;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.breeding-project-wizard__icon-button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-round);
  background: var(--rt-surface-2);
  color: var(--rt-text-strong);
  cursor: pointer;
}

.breeding-project-wizard__steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.breeding-project-wizard__steps li {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.55rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  color: var(--rt-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.breeding-project-wizard__steps li > span {
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  flex: 0 0 auto;
  border-radius: var(--rt-radius-round);
  background: var(--rt-surface-2);
}

.breeding-project-wizard__steps .is-current {
  border-color: var(--rt-focus);
  color: var(--rt-text-strong);
}

.breeding-project-wizard__steps .is-complete > span,
.breeding-project-wizard__steps .is-current > span {
  background: var(--rt-brand);
  color: var(--rt-on-brand);
}

.breeding-project-wizard__content {
  min-height: 18rem;
  padding: clamp(1rem, 3vw, 1.5rem);
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-medium);
  background: var(--rt-surface-2);
}

.breeding-project-wizard__field {
  display: grid;
  gap: 0.4rem;
  max-width: 34rem;
  color: var(--rt-text-muted);
  font-size: 0.85rem;
  font-weight: 700;
}

.breeding-project-wizard__field select {
  width: 100%;
  min-height: 44px;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-1);
  color: var(--rt-text-strong);
  font: inherit;
}

.breeding-project-wizard__selection-count {
  font-weight: 700;
}

.breeding-project-wizard__parents {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

.breeding-project-wizard__parent {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  min-height: 4.5rem;
  padding: 0.75rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-1);
  cursor: pointer;
}

.breeding-project-wizard__parent.is-selected {
  border-color: var(--rt-focus);
}

.breeding-project-wizard__parent.is-unavailable {
  cursor: not-allowed;
  opacity: 0.68;
}

.breeding-project-wizard__parent input {
  width: 1.15rem;
  height: 1.15rem;
  flex: 0 0 auto;
  margin-top: 0.15rem;
  accent-color: var(--rt-brand);
}

.breeding-project-wizard__parent span,
.breeding-project-wizard__parent small {
  display: block;
}

.breeding-project-wizard__parent small {
  margin-top: 0.2rem;
  color: var(--rt-text-muted);
}

.breeding-project-wizard__state,
.breeding-project-wizard__timeline,
.breeding-project-wizard__notice {
  display: flex;
  align-items: flex-start;
  gap: 0.8rem;
  padding: 0.9rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-1);
}

.breeding-project-wizard__state--error,
.breeding-project-wizard__notice {
  border-color: var(--rt-danger);
}

.breeding-project-wizard__summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
  margin: 0 0 1rem;
}

.breeding-project-wizard__summary > div {
  padding: 0.75rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-1);
}

.breeding-project-wizard__summary dt {
  color: var(--rt-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
}

.breeding-project-wizard__summary dd {
  margin: 0.25rem 0 0;
  color: var(--rt-text-strong);
  font-weight: 700;
}

.breeding-project-wizard__timeline ol {
  margin: 0.4rem 0;
  padding-left: 1.25rem;
}

.breeding-project-wizard__confirmation {
  margin-top: 1rem;
}

.breeding-project-wizard__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 44px;
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--rt-brand);
  border-radius: var(--rt-radius-small);
  background: var(--rt-brand);
  color: var(--rt-on-brand);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

.breeding-project-wizard__button--secondary {
  border-color: var(--rt-rule);
  background: var(--rt-surface-2);
  color: var(--rt-text-strong);
}

.breeding-project-wizard__button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.breeding-project-wizard__button:focus-visible,
.breeding-project-wizard__icon-button:focus-visible,
.breeding-project-wizard__field select:focus-visible,
.breeding-project-wizard__parent:has(input:focus-visible) {
  outline: 3px solid var(--rt-focus);
  outline-offset: 2px;
}

@media (max-width: 700px) {
  .breeding-project-wizard__header,
  .breeding-project-wizard__confirmation {
    align-items: flex-start;
  }

  .breeding-project-wizard__steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .breeding-project-wizard__parents,
  .breeding-project-wizard__summary {
    grid-template-columns: 1fr;
  }

  .breeding-project-wizard__confirmation {
    flex-direction: column;
  }

  .breeding-project-wizard__confirmation .breeding-project-wizard__button {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .breeding-project-wizard *,
  .breeding-project-wizard *::before,
  .breeding-project-wizard *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
