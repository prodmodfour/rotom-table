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
import {
  breedingProjectGuidanceReason,
  type BreedingProjectGuidanceProjectionV1,
  type BreedingProjectGuidanceReasonId,
} from '#shared/breeding/projectGuidance'
import type {
  BreedingProjectChoiceMessageId,
  BreedingProjectChoiceOptionV1,
  BreedingProjectChoicesProjectionV1,
  BreedingProjectTraitChoiceAuthorityV1,
} from '#shared/breeding/projectChoices'
import { BREEDING_PROJECT_WIZARD_STEPS } from '~/composables/breeding/useBreedingProjectWizard'

const props = defineProps<{
  open: boolean
  projection: BreedingProjectWizardProjectionV1 | null
  guidance: BreedingProjectGuidanceProjectionV1 | null
  choices?: BreedingProjectChoicesProjectionV1 | null
  ownershipContexts: readonly BreedingWorkshopOwnershipContextV1[]
  destinationTrainerSlug: string | null
  breederTrainerSlug: string | null
  selectedParentSlugs: ReadonlySet<string>
  activeStep: number
  loading: boolean
  confirming?: boolean
  error: string | null
  canReview: boolean
}>()

const emit = defineEmits<{
  close: []
  retry: []
  selectDestination: [trainerSheetSlug: string]
  selectBreeder: [trainerSheetSlug: string]
  toggleParent: [pokemonSheetSlug: string]
  selectOption: [optionId: string, siblingOptionIds: readonly string[]]
  confirmProject: []
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
const applicableReasons = computed(() => props.guidance?.applicableReasonIds.map(
  reasonId => breedingProjectGuidanceReason(reasonId),
) ?? [])
const sourceContributions = computed(() => props.guidance?.sourceContributions ?? [])
const skillOptions = computed(() => props.choices?.skillChoice.options ?? [])
const roleOptions = computed(() => props.choices?.parentRoleChoice.options ?? [])
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
const candidateReasons = (reasonIds: readonly string[]) => reasonIds.map(
  reasonId => breedingProjectGuidanceReason(reasonId as BreedingProjectGuidanceReasonId),
)
const sourceStatus = (status: string): string => status === 'active'
  ? 'Active'
  : status === 'choice-required' ? 'Choice required' : 'Unavailable'
const skillLabel = (skillId: string): string => ({
  'general-education': 'General Education',
  perception: 'Perception',
  'pokemon-education': 'Pokémon Education',
})[skillId] ?? skillId
const parentMeta = (candidate: (typeof candidates.value)[number]): string => {
  const values = [
    candidate.speciesId,
    candidate.genderId,
    candidate.level === null ? null : `Level ${candidate.level}`,
  ].filter((value): value is string => value !== null)
  return values.length > 0 ? values.join(' · ') : 'Details unavailable'
}
const selectChoice = (option: BreedingProjectChoiceOptionV1, siblings: readonly BreedingProjectChoiceOptionV1[]): void => {
  emit('selectOption', option.optionId, siblings.map(entry => entry.optionId))
}
const traitLabel = (choice: BreedingProjectTraitChoiceAuthorityV1): string => ({
  nature: 'Nature',
  ability: 'Ability',
  gender: 'Gender',
})[choice.traitKind]
const traitStatus = (choice: BreedingProjectTraitChoiceAuthorityV1): string => choice.status === 'choice-authorised'
  ? `Choice authorised at ${choice.requiredRank}`
  : choice.status === 'random-only'
    ? `Random resolution · requires ${choice.requiredRank}`
    : 'Unavailable until current Breeder authority resolves'
const confirmationMessages: Readonly<Record<BreedingProjectChoiceMessageId, string>> = Object.freeze({
  'breeding.project-choices.selection-incomplete': 'Complete the current Trainer and parent selections.',
  'breeding.project-choices.cross-owner-consent-required': 'Cross-owner Projects require a separate private consent workflow before mechanics can be resolved.',
  'breeding.project-choices.breeder-choice-required': 'Choose the current Dilettante Skill before confirming.',
  'breeding.project-choices.breeder-unavailable': 'Current Breeder authority is unavailable.',
  'breeding.project-choices.creation-rejected': 'Current Project creation authority rejected this confirmation.',
  'breeding.project-choices.maturity-review-required': 'Every parent requires current GM maturity confirmation.',
  'breeding.project-choices.parent-role-review-required': 'A current GM parent-role decision is required.',
  'breeding.project-choices.current-validation-required': 'Current setup validation is unavailable.',
  'breeding.project-choices.ready-to-confirm': 'Explicit confirmation will rebuild authority and create this Project.',
  'breeding.project-choices.project-created': 'Project created. Its first 240 campaign minutes are now in progress.',
  'breeding.project-choices.project-awaiting-consent': 'Project created and awaiting the required owner consent.',
})
const confirmationMessage = computed(() => {
  const messageId = props.choices?.confirmation.messageId
  return messageId ? confirmationMessages[messageId] : 'Current server validation is required.'
})
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

          <section class="breeding-project-wizard__sources" aria-labelledby="wizard-sources-title">
            <h4 id="wizard-sources-title">Current source contributions</h4>
            <article
              v-for="source in sourceContributions"
              :key="`${source.sourceKind}:${source.sourceCanonicalId}`"
              class="breeding-project-wizard__source"
            >
              <div>
                <strong>{{ source.sourceCanonicalId }}</strong>
                <span :class="`is-${source.status}`">{{ sourceStatus(source.status) }}</span>
              </div>
              <p v-if="source.skillApplication">
                {{ skillLabel(source.skillApplication.skillId) }} · {{ source.skillApplication.rank }} ·
                check total {{ source.skillApplication.skillTotal >= 0 ? '+' : '' }}{{ source.skillApplication.skillTotal }}
              </p>
              <template v-else-if="source.reasonId">
                <p>{{ breedingProjectGuidanceReason(source.reasonId).summary }}</p>
                <p><strong>Next:</strong> {{ breedingProjectGuidanceReason(source.reasonId).recovery }}</p>
              </template>
              <p v-else>Provides {{ source.contributionIds.join(' and ') }}.</p>
            </article>
          </section>

          <fieldset
            v-if="choices?.skillChoice.status === 'required' || choices?.skillChoice.status === 'selected'"
            class="breeding-project-wizard__choice-group"
            :disabled="loading"
          >
            <legend>Dilettante Breeder Skill</legend>
            <p>Dilettante requires one current mandated Skill. Only the opaque server options below are accepted.</p>
            <label v-for="option in skillOptions" :key="option.optionId">
              <input
                type="radio"
                name="breeding-project-skill-choice"
                :checked="option.selected"
                @change="selectChoice(option, skillOptions)"
              >
              <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
            </label>
          </fieldset>
        </section>

        <section v-else-if="activeStep === 2" aria-labelledby="wizard-parents-title">
          <p class="breeding-project-wizard__eyebrow">Step 3</p>
          <h3 id="wizard-parents-title">Choose two parents</h3>
          <p>Select exactly two current roster entries. Unavailable entries cannot be selected.</p>
          <p class="breeding-project-wizard__selection-count" role="status" aria-live="polite">
            {{ selectedParentSlugs.size }} of 2 parents selected
          </p>

          <div v-if="candidates.length > 0" class="breeding-project-wizard__parents">
            <div
              v-for="candidate in candidates"
              :key="candidate.parentSheetSlug"
              class="breeding-project-wizard__parent"
              :class="{
                'is-selected': selectedParentSlugs.has(candidate.parentSheetSlug),
                'is-unavailable': candidate.availability.status !== 'selectable',
              }"
            >
              <label>
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
              <details
                v-if="candidate.availability.reasonIds.length > 0"
                class="breeding-project-wizard__reason-details"
              >
                <summary>Why unavailable</summary>
                <div v-for="reason in candidateReasons(candidate.availability.reasonIds)" :key="reason.reasonId">
                  <strong>{{ reason.title }}</strong>
                  <small>{{ reason.summary }}</small>
                  <small><strong>Next:</strong> {{ reason.recovery }}</small>
                </div>
              </details>
            </div>
          </div>
          <div v-else class="breeding-project-wizard__state" data-testid="breeding-wizard-no-parents">
            <PhEgg :size="24" weight="duotone" aria-hidden="true" />
            <div>
              <h3>No parent candidates are available</h3>
              <p>Add current Pokémon to an authorized Trainer roster, then retry.</p>
            </div>
          </div>
          <div
            v-if="projection.reviewStatus === 'pair-unavailable'"
            class="breeding-project-wizard__reason-list"
            role="alert"
          >
            <article
              v-for="reason in applicableReasons.filter(entry => entry.severity === 'error')"
              :key="reason.reasonId"
              class="breeding-project-wizard__notice"
            >
              <div>
                <strong>{{ reason.title }}</strong>
                <p>{{ reason.summary }}</p>
                <p><strong>Next:</strong> {{ reason.recovery }}</p>
              </div>
            </article>
          </div>
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

          <section class="breeding-project-wizard__review-guidance" aria-labelledby="wizard-review-guidance-title">
            <h3 id="wizard-review-guidance-title">Validation guidance</h3>
            <article
              v-for="reason in applicableReasons"
              :key="reason.reasonId"
              class="breeding-project-wizard__guidance"
              :class="`is-${reason.severity}`"
            >
              <strong>{{ reason.title }}</strong>
              <p>{{ reason.summary }}</p>
              <p><strong>Next:</strong> {{ reason.recovery }}</p>
            </article>
          </section>

          <section v-if="choices" class="breeding-project-wizard__final-choices" aria-labelledby="wizard-final-choices-title">
            <h3 id="wizard-final-choices-title">Current server-issued choices</h3>

            <div class="breeding-project-wizard__trait-grid" aria-label="Egg production trait authority">
              <article v-for="trait in choices.traitChoices" :key="trait.traitKind">
                <strong>{{ traitLabel(trait) }}</strong>
                <p>{{ traitStatus(trait) }}</p>
                <small>Resolved at Egg production, never from browser mechanics.</small>
              </article>
            </div>

            <fieldset
              v-for="maturity in choices.maturityChoices"
              :key="maturity.parentOrdinal"
              class="breeding-project-wizard__choice-group"
              :disabled="loading || maturity.status === 'confirmed' || maturity.status === 'unavailable'"
            >
              <legend>{{ maturity.parentLabel }} maturity</legend>
              <p v-if="maturity.status === 'confirmed'">Current audited GM confirmation is recorded.</p>
              <p v-else-if="maturity.status === 'unavailable'">A GM must review this exact parent revision.</p>
              <label v-else-if="maturity.option">
                <input
                  type="checkbox"
                  :checked="maturity.option.selected"
                  @change="selectChoice(maturity.option, [maturity.option])"
                >
                <span><strong>{{ maturity.option.label }}</strong><small>{{ maturity.option.description }}</small></span>
              </label>
            </fieldset>

            <fieldset
              v-if="choices.parentRoleChoice.status !== 'not-required'"
              class="breeding-project-wizard__choice-group"
              :disabled="loading || choices.parentRoleChoice.status === 'unavailable'"
            >
              <legend>Parent roles</legend>
              <p v-if="choices.parentRoleChoice.status === 'unavailable'">A GM must resolve parent roles without exposing private mechanics.</p>
              <label v-for="option in roleOptions" v-else :key="option.optionId">
                <input
                  type="radio"
                  name="breeding-project-parent-role"
                  :checked="option.selected"
                  @change="selectChoice(option, roleOptions)"
                >
                <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
              </label>
            </fieldset>

            <details class="breeding-project-wizard__campaign-settings">
              <summary>Current campaign settings</summary>
              <dl>
                <div v-for="setting in choices.campaignSettings" :key="setting.campaignOptionId">
                  <dt>{{ setting.label }}</dt>
                  <dd>{{ setting.valueLabel }}</dd>
                </div>
              </dl>
            </details>
          </section>

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

          <section
            v-if="guidance?.gmDiagnostics"
            class="breeding-project-wizard__diagnostics"
            aria-labelledby="wizard-diagnostics-title"
            data-testid="breeding-project-gm-diagnostics"
          >
            <h3 id="wizard-diagnostics-title">GM diagnostics</h3>
            <dl>
              <div><dt>Parent directory</dt><dd>{{ guidance.gmDiagnostics.selectableCandidateCount }} selectable · {{ guidance.gmDiagnostics.unavailableCandidateCount }} unavailable</dd></div>
              <div><dt>Ownership</dt><dd>{{ guidance.gmDiagnostics.ownershipTopology }}</dd></div>
              <div><dt>Breeder source</dt><dd>{{ sourceStatus(guidance.gmDiagnostics.breederAuthorityStatus) }}</dd></div>
              <div><dt>Maturity</dt><dd>{{ guidance.gmDiagnostics.maturityPolicy }}<template v-if="guidance.gmDiagnostics.minimumMaturityLevel !== null"> · Level {{ guidance.gmDiagnostics.minimumMaturityLevel }}</template></dd></div>
              <div><dt>Consent</dt><dd>{{ guidance.gmDiagnostics.consentStatus }}</dd></div>
              <div><dt>Compatibility</dt><dd>{{ guidance.gmDiagnostics.compatibilityPreviewStatus }}</dd></div>
              <div><dt>Location</dt><dd>Campaign Workshop · no facility authority</dd></div>
              <div><dt>Creation</dt><dd>Final server validation required</dd></div>
            </dl>
          </section>

          <div
            class="breeding-project-wizard__confirmation"
            :class="{ 'is-created': choices?.confirmation.status === 'created' }"
          >
            <p role="status" aria-live="polite">{{ confirmationMessage }}</p>
            <button
              v-if="choices?.confirmation.status !== 'created'"
              type="button"
              class="breeding-project-wizard__button"
              :disabled="loading || confirming || !choices?.confirmation.canConfirm"
              @click="emit('confirmProject')"
            >
              {{ confirming ? 'Creating project…' : 'Confirm and create project' }}
            </button>
            <strong v-else>Created</strong>
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

.breeding-project-wizard__sources,
.breeding-project-wizard__review-guidance,
.breeding-project-wizard__diagnostics {
  display: grid;
  gap: 0.65rem;
  margin-top: 1rem;
}

.breeding-project-wizard__source,
.breeding-project-wizard__guidance,
.breeding-project-wizard__diagnostics {
  padding: 0.8rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-1);
}

.breeding-project-wizard__source > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.breeding-project-wizard__source span {
  padding: 0.2rem 0.55rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-round);
  font-size: 0.76rem;
  font-weight: 700;
}

.breeding-project-wizard__source span.is-active,
.breeding-project-wizard__guidance.is-info {
  border-color: var(--rt-success);
}

.breeding-project-wizard__source span.is-choice-required,
.breeding-project-wizard__guidance.is-warning {
  border-color: var(--rt-pending);
}

.breeding-project-wizard__source span.is-unavailable,
.breeding-project-wizard__guidance.is-error {
  border-color: var(--rt-danger);
}

.breeding-project-wizard__source p,
.breeding-project-wizard__guidance p {
  margin: 0.4rem 0 0;
  color: var(--rt-text-muted);
  line-height: 1.45;
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
  display: grid;
  gap: 0.65rem;
  min-height: 4.5rem;
  padding: 0.75rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-1);
}

.breeding-project-wizard__parent > label {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  cursor: pointer;
}

.breeding-project-wizard__parent.is-selected {
  border-color: var(--rt-focus);
}

.breeding-project-wizard__parent.is-unavailable {
  opacity: 0.78;
}

.breeding-project-wizard__parent.is-unavailable > label {
  cursor: not-allowed;
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

.breeding-project-wizard__reason-details {
  border-top: 1px solid var(--rt-rule);
}

.breeding-project-wizard__reason-details summary {
  display: flex;
  align-items: center;
  min-height: 44px;
  color: var(--rt-text-strong);
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 700;
}

.breeding-project-wizard__reason-details > div + div {
  margin-top: 0.65rem;
}

.breeding-project-wizard__reason-details small {
  line-height: 1.4;
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

.breeding-project-wizard__reason-list {
  display: grid;
  gap: 0.65rem;
  margin-top: 0.8rem;
}

.breeding-project-wizard__notice p {
  margin: 0.35rem 0 0;
  color: var(--rt-text-muted);
  line-height: 1.45;
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

.breeding-project-wizard__choice-group,
.breeding-project-wizard__final-choices,
.breeding-project-wizard__campaign-settings {
  margin-top: 1rem;
  padding: 0.8rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-1);
}

.breeding-project-wizard__choice-group {
  display: grid;
  gap: 0.55rem;
}

.breeding-project-wizard__choice-group legend {
  padding-inline: 0.3rem;
  color: var(--rt-text-strong);
  font-weight: 700;
}

.breeding-project-wizard__choice-group > p {
  margin: 0;
  color: var(--rt-text-muted);
  line-height: 1.45;
}

.breeding-project-wizard__choice-group label {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  min-height: 44px;
  padding: 0.55rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  cursor: pointer;
}

.breeding-project-wizard__choice-group input {
  width: 1.1rem;
  height: 1.1rem;
  flex: 0 0 auto;
  margin-top: 0.1rem;
  accent-color: var(--rt-brand);
}

.breeding-project-wizard__choice-group span,
.breeding-project-wizard__choice-group small {
  display: block;
}

.breeding-project-wizard__choice-group small,
.breeding-project-wizard__trait-grid small {
  margin-top: 0.2rem;
  color: var(--rt-text-muted);
  line-height: 1.4;
}

.breeding-project-wizard__trait-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
}

.breeding-project-wizard__trait-grid article {
  padding: 0.7rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-2);
}

.breeding-project-wizard__trait-grid p {
  margin: 0.35rem 0 0;
  color: var(--rt-text-strong);
  font-size: 0.85rem;
}

.breeding-project-wizard__campaign-settings summary {
  min-height: 44px;
  color: var(--rt-text-strong);
  cursor: pointer;
  font-weight: 700;
}

.breeding-project-wizard__campaign-settings dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
  margin: 0;
}

.breeding-project-wizard__campaign-settings dl > div {
  padding: 0.5rem;
  background: var(--rt-surface-2);
}

.breeding-project-wizard__campaign-settings dt {
  color: var(--rt-text-muted);
  font-size: 0.76rem;
  font-weight: 700;
}

.breeding-project-wizard__campaign-settings dd {
  margin: 0.2rem 0 0;
  color: var(--rt-text-strong);
}

.breeding-project-wizard__confirmation.is-created {
  padding: 0.75rem;
  border: 1px solid var(--rt-success);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-1);
}

.breeding-project-wizard__diagnostics dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
}

.breeding-project-wizard__diagnostics dl > div {
  padding: 0.6rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-2);
}

.breeding-project-wizard__diagnostics dt {
  color: var(--rt-text-muted);
  font-size: 0.76rem;
  font-weight: 700;
  text-transform: uppercase;
}

.breeding-project-wizard__diagnostics dd {
  margin: 0.25rem 0 0;
  color: var(--rt-text-strong);
  font-weight: 700;
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
.breeding-project-wizard__parent:has(input:focus-visible),
.breeding-project-wizard__choice-group label:has(input:focus-visible) {
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
  .breeding-project-wizard__summary,
  .breeding-project-wizard__trait-grid,
  .breeding-project-wizard__campaign-settings dl,
  .breeding-project-wizard__diagnostics dl {
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
