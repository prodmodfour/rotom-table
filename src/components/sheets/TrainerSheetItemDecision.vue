<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import InventorySourceSelector from '~/components/inventory/InventorySourceSelector.vue'
import InventoryRecoveryCard, { type InventoryRecoveryState } from '~/components/inventory/InventoryRecoveryCard.vue'
import {
  PhArrowClockwise,
  PhCheck,
  PhCheckCircle,
  PhCircleNotch,
  PhMagnifyingGlass,
  PhWarning,
  PhX,
} from '@phosphor-icons/vue'
import type { SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import type { InventorySourceSelectionV1 } from '#shared/itemAutomation/inventorySourceSelection'
import type { TrainerSheetItemActionStatus } from '~/composables/sheets/useTrainerSheetItemActions'

const props = withDefaults(defineProps<{
  offer: SheetItemActionOfferV1 | null
  sourceSelection?: InventorySourceSelectionV1 | null
  selectedTargetIds: readonly string[]
  selectedChoices?: Readonly<Record<string, readonly string[]>>
  status: TrainerSheetItemActionStatus
  message: string | null
  acceptedSheetLinks: readonly { readonly href: string, readonly label: string }[]
  busy: boolean
  recoveryOnline?: boolean
  exactRetryAvailable?: boolean
}>(), {
  sourceSelection: null,
  selectedChoices: () => ({}),
  recoveryOnline: true,
  exactRetryAvailable: true,
})

const emit = defineEmits<{
  chooseSource: [sourceSelectionId: string]
  chooseTarget: [targetId: string]
  chooseOption: [choiceId: string, optionId: string]
  confirm: []
  cancel: []
  retryExact: []
  refresh: []
}>()

const heading = ref<HTMLElement | null>(null)
const selectedTarget = computed(() => props.offer?.targeting?.options.find(option => (
  props.selectedTargetIds.includes(option.targetId)
)) ?? null)
const projectedChoices = computed(() => selectedTarget.value?.choices ?? [])
const choicesComplete = computed(() => projectedChoices.value.every((choice) => {
  const values = props.selectedChoices[choice.choiceId] ?? []
  return values.length >= choice.minimum && values.length <= choice.maximum
    && values.every(optionId => choice.options.some(option => option.optionId === optionId))
}))
const selectedChoiceFacts = computed(() => projectedChoices.value.flatMap(choice => (
  choice.options.filter(option => (props.selectedChoices[choice.choiceId] ?? []).includes(option.optionId))
    .flatMap(option => option.previewFacts)
)))
const previewFacts = computed(() => [
  ...selectedChoiceFacts.value,
  ...(selectedTarget.value?.previewFacts ?? []),
].filter((fact, index, values) => values.findIndex(value => (
  value.label === fact.label && value.value === fact.value
)) === index))
const permanentAdvancementIds = new Set([
  'HP Up', 'Protein', 'Iron', 'Calcium', 'Zinc', 'Carbos',
  'Heart Booster', 'PP Up', 'Rare Candy', 'Stat Suppressants',
])
const permanentAdvancement = computed(() => permanentAdvancementIds.has(props.offer?.source.canonicalId ?? ''))
const machineMoveLearning = computed(() => props.offer?.targeting?.options.some(option => (
  (option.choices ?? []).some(choice => choice.choiceId === 'machine-replacement')
)) === true)
const dowsing = computed(() => props.offer?.source.canonicalId === 'Dowsing Rod')
const itemEvolution = computed(() => props.offer?.targeting?.options.some(option => (
  (option.choices ?? []).some(choice => choice.choiceId === 'evolution-destination')
)) === true)
const selectedEvolutionDestination = computed(() => projectedChoices.value
  .find(choice => choice.choiceId === 'evolution-destination')
  ?.options.find(option => (props.selectedChoices['evolution-destination'] ?? []).includes(option.optionId))
  ?.label.replace(/^Evolve to /u, '') ?? null)
const projectedOptionLabel = (choiceId: string, label: string): string => (
  choiceId === 'evolution-confirmation' && selectedEvolutionDestination.value && selectedTarget.value
    ? `I understand this changes ${selectedTarget.value.label}’s species to ${selectedEvolutionDestination.value}.`
    : label
)
const targetSelectionComplete = computed(() => {
  const targeting = props.offer?.targeting
  if (!targeting) return true
  return props.selectedTargetIds.length >= targeting.minimum
    && props.selectedTargetIds.length <= targeting.maximum
})
const enabledTargetIndices = computed(() => props.offer?.targeting?.options
  .map((option, index) => option.enabled ? index : -1)
  .filter(index => index >= 0) ?? [])
const targetTabIndex = (targetId: string, index: number): 0 | -1 => {
  if (props.selectedTargetIds.includes(targetId)) return 0
  if (props.selectedTargetIds.length > 0) return -1
  return index === enabledTargetIndices.value[0] ? 0 : -1
}
const moveTargetFocus = async (event: KeyboardEvent, currentIndex: number) => {
  if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return
  const indices = enabledTargetIndices.value
  const currentPosition = indices.indexOf(currentIndex)
  if (currentPosition < 0 || indices.length === 0) return
  event.preventDefault()
  const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
  const nextIndex = indices[(currentPosition + direction + indices.length) % indices.length]
  if (nextIndex === undefined) return
  const nextTarget = props.offer?.targeting?.options[nextIndex]
  if (!nextTarget) return
  emit('chooseTarget', nextTarget.targetId)
  await nextTick()
  document.querySelector<HTMLElement>(`[data-sheet-item-target-index="${nextIndex}"]`)?.focus()
}
const inspectHref = computed(() => props.offer?.actions.find(action => action.kind === 'inspect')?.href ?? null)
const sharedCustody = computed(() => props.offer?.source.containerKind === 'group')
const sharedReservationCopy = computed(() => {
  if (!sharedCustody.value || !props.offer) return null
  const quantity = /^Consumes (\d+) /u.exec(props.offer.acceptanceNotice)?.[1]
  return quantity
    ? `If this use waits for a decision, ${quantity} item${quantity === '1' ? '' : 's'} ${quantity === '1' ? 'is' : 'are'} reserved on this exact shared row.`
    : 'Shared item custody and availability are rechecked when submitted.'
})
const hasMultipleSources = computed(() => (props.sourceSelection?.options.length ?? 0) > 1)
const quantityLabel = computed(() => props.sourceSelection && hasMultipleSources.value
  ? `${props.sourceSelection.totalQuantity} total across ${props.sourceSelection.options.length} rows`
  : `${props.offer?.source.quantity ?? 0} available`)
const recoveryState = computed<InventoryRecoveryState | null>(() => (
  props.status === 'uncertain' || props.status === 'conflict' || props.status === 'error' ? props.status : null
))
const systemOnly = computed(() => !props.offer && ['uncertain', 'pending-gm', 'conflict', 'error', 'accepted'].includes(props.status))
const statusTone = computed(() => props.status === 'accepted' ? 'success'
  : props.status === 'uncertain' ? 'uncertain'
    : props.status === 'conflict' || props.status === 'error' ? 'error' : 'neutral')

watch(
  () => [props.offer?.offerId ?? null, props.status, props.offer?.source.canonicalId ?? null] as const,
  async ([nextOffer, nextStatus, nextCanonicalId], previous) => {
    if (nextOffer === previous?.[0] && nextStatus === previous?.[1]) return
    const exactSourceSwitch = Boolean(nextOffer && previous?.[0]
      && nextStatus === 'ready' && previous[1] === 'ready' && nextCanonicalId === previous[2])
    if (exactSourceSwitch) return
    if (!nextOffer && !['uncertain', 'pending-gm', 'accepted', 'conflict', 'error'].includes(nextStatus)) return
    await nextTick()
    heading.value?.focus()
  },
  { immediate: true },
)
</script>

<template>
  <InventoryRecoveryCard
    v-if="recoveryState"
    :state="recoveryState"
    :message="message"
    :online="recoveryOnline"
    :busy="busy"
    :exact-retry-available="exactRetryAvailable"
    retry-label="Retry exact use"
    @retry-exact="emit('retryExact')"
    @reconcile="emit('refresh')"
  />
  <aside
    v-else-if="offer || systemOnly"
    class="sheet-item-decision"
    :class="`sheet-item-decision--${statusTone}`"
    :aria-busy="busy"
    aria-labelledby="sheet-item-decision-title"
  >
    <template v-if="status === 'uncertain'">
      <header class="sheet-item-decision__system-header">
        <PhWarning :size="24" weight="fill" aria-hidden="true" />
        <div>
          <p class="sheet-item-decision__eyebrow">Recovery required</p>
          <h2 id="sheet-item-decision-title" ref="heading" tabindex="-1">Item result uncertain</h2>
        </div>
      </header>
      <p class="sheet-item-decision__system-copy">{{ message }}</p>
      <p class="sheet-item-decision__safe-note">Exact retry reuses the original command and cannot consume the item twice.</p>
      <div class="sheet-item-decision__footer">
        <button type="button" class="sheet-item-button sheet-item-button--primary" :disabled="busy" @click="emit('retryExact')">
          <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
          Retry exact use
        </button>
      </div>
    </template>

    <template v-else-if="status === 'pending-gm'">
      <header class="sheet-item-decision__system-header">
        <PhCircleNotch :size="25" weight="bold" aria-hidden="true" />
        <div>
          <p class="sheet-item-decision__eyebrow">GM decision pending</p>
          <h2 id="sheet-item-decision-title" ref="heading" tabindex="-1">Item quantity reserved</h2>
        </div>
      </header>
      <p class="sheet-item-decision__system-copy" role="status">{{ message }}</p>
      <p class="sheet-item-decision__safe-note">Use, transfer, split, merge, and discard cannot spend the reserved quantity while this decision remains unresolved.</p>
      <div class="sheet-item-decision__footer">
        <button type="button" class="sheet-item-button" :disabled="busy" @click="emit('refresh')">
          <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
          Return to inventory
        </button>
      </div>
    </template>

    <template v-else-if="status === 'accepted'">
      <header class="sheet-item-decision__system-header">
        <PhCheckCircle :size="26" weight="fill" aria-hidden="true" />
        <div>
          <p class="sheet-item-decision__eyebrow">Accepted result</p>
          <h2 id="sheet-item-decision-title" ref="heading" tabindex="-1">Item use complete</h2>
        </div>
      </header>
      <p class="sheet-item-decision__system-copy" role="status">{{ message }}</p>
      <nav v-if="acceptedSheetLinks.length" class="sheet-item-decision__result-links" aria-label="Affected sheets">
        <NuxtLink v-for="link in acceptedSheetLinks" :key="link.href" :to="link.href">
          Open {{ link.label }}
        </NuxtLink>
      </nav>
      <p v-else class="sheet-item-decision__safe-note">Refresh to adopt the accepted sheet result on this device.</p>
      <div class="sheet-item-decision__footer">
        <button type="button" class="sheet-item-button" @click="emit('refresh')">
          <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
          Use another item
        </button>
      </div>
    </template>

    <template v-else-if="!offer">
      <header class="sheet-item-decision__system-header">
        <PhWarning :size="24" weight="fill" aria-hidden="true" />
        <div>
          <p class="sheet-item-decision__eyebrow">Item actions</p>
          <h2 id="sheet-item-decision-title" ref="heading" tabindex="-1">
            {{ status === 'conflict' ? 'Refresh required' : 'Item actions unavailable' }}
          </h2>
        </div>
      </header>
      <p class="sheet-item-decision__system-copy" role="alert">{{ message }}</p>
      <div class="sheet-item-decision__footer">
        <button type="button" class="sheet-item-button sheet-item-button--primary" :disabled="busy" @click="emit('refresh')">
          <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
          Refresh item actions
        </button>
      </div>
    </template>

    <template v-else>
      <header class="sheet-item-decision__header">
        <div>
          <p class="sheet-item-decision__eyebrow">{{ sharedCustody ? 'Use from shared inventory' : itemEvolution ? 'Evolution preview' : machineMoveLearning ? 'Move training' : permanentAdvancement ? 'Permanent advancement' : dowsing ? 'Dowsing search' : offer.timingLabel === 'Extended Action' ? 'Start treatment' : 'Use item' }}</p>
          <h2 id="sheet-item-decision-title" ref="heading" tabindex="-1">{{ offer.source.displayName }}</h2>
          <p class="sheet-item-decision__quantity">{{ quantityLabel }}</p>
        </div>
        <button type="button" class="sheet-item-decision__close" :disabled="busy" aria-label="Cancel item use" @click="emit('cancel')">
          <PhX :size="20" weight="bold" aria-hidden="true" />
        </button>
      </header>

      <InventorySourceSelector
        v-if="sourceSelection && hasMultipleSources"
        :selection="sourceSelection"
        :busy="busy"
        @select="emit('chooseSource', $event)"
      />

      <div class="sheet-item-decision__meta">
        <div v-if="!hasMultipleSources">
          <span>Source</span>
          <strong>{{ offer.source.containerLabel }} · {{ offer.source.sectionLabel }} · {{ offer.source.rowLabel }}</strong>
        </div>
        <div>
          <span>{{ sharedCustody ? 'Acting Trainer' : 'Owner' }}</span>
          <strong>{{ offer.actor.label }}</strong>
        </div>
        <div v-if="sharedCustody">
          <span>Custody</span>
          <strong>Shared item custody</strong>
        </div>
        <div>
          <span>Timing</span>
          <strong>{{ offer.timingLabel }}</strong>
        </div>
      </div>

      <p v-if="offer.description" class="sheet-item-decision__description">{{ offer.description }}</p>

      <section v-if="offer.targeting" class="sheet-item-decision__targets" aria-labelledby="sheet-item-target-heading">
        <h3 id="sheet-item-target-heading">Choose a target</h3>
        <div class="sheet-item-target-list" role="radiogroup" aria-labelledby="sheet-item-target-heading">
          <button
            v-for="(target, targetIndex) in offer.targeting.options"
            :key="target.targetId"
            type="button"
            role="radio"
            class="sheet-item-target"
            :class="{ 'is-selected': selectedTargetIds.includes(target.targetId) }"
            :aria-checked="selectedTargetIds.includes(target.targetId)"
            :data-sheet-item-target-index="targetIndex"
            :tabindex="targetTabIndex(target.targetId, targetIndex)"
            :disabled="busy || !target.enabled"
            @click="emit('chooseTarget', target.targetId)"
            @keydown="moveTargetFocus($event, targetIndex)"
          >
            <span class="sheet-item-target__mark" aria-hidden="true">
              <PhCheck v-if="selectedTargetIds.includes(target.targetId)" :size="16" weight="bold" />
            </span>
            <span class="sheet-item-target__monogram" aria-hidden="true">{{ target.label.slice(0, 1).toUpperCase() }}</span>
            <span class="sheet-item-target__identity">
              <strong>{{ target.kindLabel }} · {{ target.label }}</strong>
              <span v-if="target.summary">{{ target.summary }}</span>
              <span v-if="!target.enabled" class="sheet-item-target__reason">{{ target.unavailableReason?.label }}</span>
            </span>
            <span v-if="selectedTargetIds.includes(target.targetId)" class="sheet-item-target__selected">Selected</span>
          </button>
        </div>
      </section>

      <section
        v-for="choice in projectedChoices"
        :key="choice.choiceId"
        class="sheet-item-decision__choices"
        :aria-labelledby="`sheet-item-choice-${choice.choiceId}`"
      >
        <h3 :id="`sheet-item-choice-${choice.choiceId}`">{{ choice.label }}</h3>
        <div class="sheet-item-choice-list" :role="choice.presentation === 'radio' ? 'radiogroup' : 'group'">
          <label
            v-for="option in choice.options"
            :key="option.optionId"
            class="sheet-item-choice"
            :class="{ 'is-selected': (selectedChoices[choice.choiceId] ?? []).includes(option.optionId) }"
          >
            <input
              :type="choice.presentation === 'confirmation' ? 'checkbox' : 'radio'"
              :name="`sheet-item-choice-${choice.choiceId}`"
              :checked="(selectedChoices[choice.choiceId] ?? []).includes(option.optionId)"
              :disabled="busy"
              @change="emit('chooseOption', choice.choiceId, option.optionId)"
            >
            <span class="sheet-item-choice__identity">
              <strong>{{ projectedOptionLabel(choice.choiceId, option.label) }}</strong>
              <small v-if="option.description">{{ option.description }}</small>
            </span>
            <span v-if="(selectedChoices[choice.choiceId] ?? []).includes(option.optionId)" class="sheet-item-choice__selected">Selected</span>
          </label>
        </div>
      </section>

      <section v-if="selectedTarget" class="sheet-item-preview" aria-labelledby="sheet-item-preview-heading">
        <h3 id="sheet-item-preview-heading">{{ itemEvolution ? 'Evolution preview' : machineMoveLearning ? 'Training preview' : permanentAdvancement ? 'Permanent preview' : 'Preview' }}</h3>
        <div v-if="previewFacts.length" class="sheet-item-preview__facts">
          <div v-for="fact in previewFacts" :key="`${fact.label}:${fact.value}`" :class="`sheet-item-preview__fact--${fact.tone}`">
            <span>{{ fact.label }}</span>
            <strong>{{ fact.value }}</strong>
          </div>
        </div>
        <p v-if="selectedTarget.description" class="sheet-item-preview__description">{{ selectedTarget.description }}</p>
        <p class="sheet-item-preview__acceptance">{{ offer.acceptanceNotice }}</p>
        <p v-if="sharedReservationCopy" class="sheet-item-preview__acceptance sheet-item-preview__acceptance--pending">
          {{ sharedReservationCopy }}
        </p>
        <p v-if="itemEvolution" class="sheet-item-preview__acceptance sheet-item-preview__acceptance--boundary">
          No species, Stat, Move, Ability, equipment, or inventory change occurs until the server accepts this evolution.
        </p>
        <p v-if="offer.timingLabel === 'Extended Action'" class="sheet-item-preview__acceptance sheet-item-preview__acceptance--pending">
          {{ machineMoveLearning
            ? 'Starting stores this target, replacement, and confirmation only. No Move, Tutor Point, HM usage, or inventory change occurs until completion; completion revalidates and applies once.'
            : permanentAdvancement
              ? 'Permanent choice. Starting stores this target and choice only. No item or sheet change occurs until completion; completion revalidates and applies once.'
              : dowsing
                ? 'Starting stores the GM-confirmed terrain and optional Dowsing Skill Stunt only. No roll, daily use, Shard, inventory, or source change occurs until at least 10 campaign minutes have elapsed and completion is accepted.'
                : 'Starting stores the activity only. No roll, AP, HP, condition, or inventory change is applied until completion.' }}
        </p>
      </section>
      <p v-else class="sheet-item-decision__selection-help">Select one projected target to see the exact preview.</p>

      <div v-if="message" class="sheet-item-decision__notice" :class="{ 'is-error': status === 'conflict' || status === 'error' }" :role="status === 'conflict' || status === 'error' ? 'alert' : 'status'">
        <PhCircleNotch v-if="busy" class="sheet-item-decision__spinner" :size="18" weight="bold" aria-hidden="true" />
        <PhWarning v-else-if="status === 'conflict' || status === 'error'" :size="18" weight="fill" aria-hidden="true" />
        <span>{{ message }}</span>
      </div>

      <footer class="sheet-item-decision__footer">
        <button type="button" class="sheet-item-button" :disabled="busy" @click="emit('cancel')">Cancel</button>
        <NuxtLink v-if="inspectHref" class="sheet-item-button sheet-item-button--link" :to="inspectHref">
          <PhMagnifyingGlass :size="17" weight="bold" aria-hidden="true" />
          Inspect
        </NuxtLink>
        <button
          type="button"
          class="sheet-item-button sheet-item-button--primary"
          :disabled="busy || !targetSelectionComplete || !choicesComplete || status === 'conflict' || status === 'error'"
          @click="emit('confirm')"
        >
          <PhCircleNotch v-if="busy" class="sheet-item-decision__spinner" :size="18" weight="bold" aria-hidden="true" />
          <PhCheck v-else :size="18" weight="bold" aria-hidden="true" />
          {{ busy
            ? (offer.timingLabel === 'Extended Action' ? 'Starting…' : itemEvolution ? 'Evolving…' : 'Submitting…')
            : (offer.timingLabel === 'Extended Action'
                ? (machineMoveLearning ? 'Start Move Training' : permanentAdvancement ? 'Start Extended Action' : dowsing ? 'Start Dowsing Search' : 'Start treatment')
                : itemEvolution && selectedEvolutionDestination ? `Evolve to ${selectedEvolutionDestination}` : 'Confirm use') }}
        </button>
        <button v-if="status === 'conflict' || status === 'error'" type="button" class="sheet-item-button" :disabled="busy" @click="emit('refresh')">
          <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
          Refresh
        </button>
      </footer>
    </template>
  </aside>
</template>

<style scoped>
.sheet-item-decision {
  --sheet-item-signal: var(--rt-focus);
  position: sticky;
  top: 1rem;
  min-width: 0;
  align-self: start;
  border: 1px solid var(--rule-strong);
  border-left: 4px solid var(--sheet-item-signal);
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  color: var(--ink);
}

.sheet-item-decision--success {
  --sheet-item-signal: var(--rt-success);
}

.sheet-item-decision--uncertain {
  --sheet-item-signal: var(--rt-pending);
}

.sheet-item-decision--error {
  --sheet-item-signal: var(--rt-danger);
}

.sheet-item-decision__header,
.sheet-item-decision__system-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--rule);
  padding: 1rem;
}

.sheet-item-decision__system-header {
  justify-content: flex-start;
  color: var(--sheet-item-signal);
}

.sheet-item-decision__header h2,
.sheet-item-decision__system-header h2 {
  margin: 0.12rem 0 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: clamp(1.45rem, 2.2vw, 2rem);
  line-height: 1.05;
}

.sheet-item-decision__header h2:focus-visible,
.sheet-item-decision__system-header h2:focus-visible {
  outline: 2px solid var(--rt-focus);
  outline-offset: 4px;
}

.sheet-item-decision__eyebrow,
.sheet-item-decision__quantity {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.06em;
}

.sheet-item-decision__eyebrow {
  text-transform: uppercase;
}

.sheet-item-decision__quantity {
  margin-top: 0.4rem;
  font-variant-numeric: tabular-nums;
}

.sheet-item-decision__close {
  display: inline-grid;
  width: 2.75rem;
  height: 2.75rem;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  color: var(--ink-muted);
  cursor: pointer;
}

.sheet-item-decision__close:hover:not(:disabled),
.sheet-item-decision__close:focus-visible {
  border-color: var(--rt-focus);
  color: var(--ink-bright);
  outline: 2px solid var(--rt-focus);
  outline-offset: 2px;
}

.sheet-item-decision__meta {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 0.65fr);
  gap: 0.8rem;
  border-bottom: 1px solid var(--rule);
  padding: 0.85rem 1rem;
}

.sheet-item-decision__meta div {
  display: grid;
  gap: 0.18rem;
}

.sheet-item-decision__meta span,
.sheet-item-preview__fact--neutral span,
.sheet-item-preview__fact--positive span,
.sheet-item-preview__fact--warning span {
  color: var(--ink-muted);
  font-size: 0.75rem;
}

.sheet-item-decision__meta strong {
  color: var(--ink-bright);
  font-size: 0.88rem;
}

.sheet-item-decision__description,
.sheet-item-decision__selection-help,
.sheet-item-decision__system-copy,
.sheet-item-decision__safe-note {
  margin: 0;
  padding: 0.85rem 1rem;
  color: var(--ink-soft);
  font-size: 0.88rem;
  line-height: 1.5;
}

.sheet-item-decision__safe-note {
  border-top: 1px solid var(--rule);
  color: var(--ink-muted);
}

.sheet-item-decision__targets,
.sheet-item-decision__choices,
.sheet-item-preview {
  border-top: 1px solid var(--rule);
  padding: 0.9rem 1rem;
}

.sheet-item-decision__targets h3,
.sheet-item-decision__choices h3,
.sheet-item-preview h3 {
  margin: 0 0 0.65rem;
  color: var(--ink-bright);
  font-size: 0.92rem;
}

.sheet-item-target-list {
  display: grid;
  gap: 0.45rem;
  max-height: min(22rem, 42vh);
  overflow-y: auto;
  padding: 2px;
}

.sheet-item-target {
  display: grid;
  min-height: 3.5rem;
  grid-template-columns: 1.4rem 2.25rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.6rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.65rem;
  text-align: left;
  cursor: pointer;
}

.sheet-item-target:hover:not(:disabled),
.sheet-item-target:focus-visible {
  border-color: var(--rt-focus);
  outline: 2px solid var(--rt-focus);
  outline-offset: 1px;
}

.sheet-item-target.is-selected {
  border-color: var(--rt-focus);
  background: color-mix(in srgb, var(--paper-active) 82%, var(--rt-focus));
  box-shadow: inset 3px 0 0 var(--rt-focus);
}

.sheet-item-target:disabled {
  background: var(--paper-inset);
  color: var(--ink-muted);
  cursor: not-allowed;
}

.sheet-item-target__mark {
  display: inline-grid;
  width: 1.25rem;
  height: 1.25rem;
  place-items: center;
  border: 1px solid var(--rule-strong);
  color: var(--rt-focus);
}

.sheet-item-target.is-selected .sheet-item-target__mark {
  border-color: var(--rt-focus);
}

.sheet-item-target__monogram {
  display: inline-grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
}

.sheet-item-target__identity {
  display: grid;
  min-width: 0;
  gap: 0.18rem;
}

.sheet-item-target__identity strong {
  color: var(--ink-bright);
  font-size: 0.86rem;
}

.sheet-item-target__identity span {
  color: var(--ink-muted);
  font-size: 0.75rem;
  line-height: 1.3;
}

.sheet-item-target.is-selected .sheet-item-target__identity span {
  color: var(--ink-bright);
}

.sheet-item-target__identity .sheet-item-target__reason {
  color: var(--warn);
}

.sheet-item-target__selected {
  color: var(--rt-focus);
  font-size: 0.74rem;
  font-weight: 700;
}

.sheet-item-choice-list {
  display: grid;
  gap: 0.45rem;
}

.sheet-item-choice {
  display: grid;
  min-height: 2.75rem;
  grid-template-columns: 1.3rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.65rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  padding: 0.55rem 0.7rem;
  color: var(--ink);
  cursor: pointer;
}

.sheet-item-choice:hover,
.sheet-item-choice:has(input:focus-visible) {
  border-color: var(--rt-focus);
  outline: 2px solid var(--rt-focus);
  outline-offset: 1px;
}

.sheet-item-choice.is-selected {
  border-color: var(--rt-focus);
  box-shadow: inset 3px 0 0 var(--rt-focus);
}

.sheet-item-choice input {
  width: 1.1rem;
  height: 1.1rem;
  margin: 0;
  accent-color: var(--rt-focus);
}

.sheet-item-choice:has(input:disabled) {
  color: var(--ink-muted);
  cursor: not-allowed;
}

.sheet-item-choice__identity {
  display: grid;
  min-width: 0;
  gap: 0.14rem;
}

.sheet-item-choice__identity strong {
  color: var(--ink-bright);
  font-size: 0.86rem;
}

.sheet-item-choice__identity small {
  color: var(--ink-muted);
  font-size: 0.75rem;
  line-height: 1.35;
}

.sheet-item-choice__selected {
  color: var(--rt-focus);
  font-size: 0.72rem;
  font-weight: 800;
}

.sheet-item-preview {
  background: var(--paper-inset);
}

.sheet-item-preview__facts {
  display: grid;
  gap: 0.45rem;
}

.sheet-item-preview__facts > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--rule);
  padding: 0.35rem 0;
}

.sheet-item-preview__facts strong {
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
}

.sheet-item-preview__fact--positive strong {
  color: var(--rt-success);
}

.sheet-item-preview__fact--warning strong {
  color: var(--rt-pending);
}

.sheet-item-preview__description,
.sheet-item-preview__acceptance {
  margin: 0.65rem 0 0;
  color: var(--ink-soft);
  font-size: 0.8rem;
  line-height: 1.45;
}

.sheet-item-preview__acceptance {
  border-top: 1px solid var(--rule);
  padding-top: 0.65rem;
  color: var(--ink-bright);
}

.sheet-item-preview__acceptance--boundary {
  border: 1px solid color-mix(in srgb, var(--rt-info, var(--rt-focus)) 48%, var(--rule));
  background: color-mix(in srgb, var(--rt-info, var(--rt-focus)) 7%, var(--paper));
  padding: 0.65rem;
}

.sheet-item-preview__acceptance--pending {
  border: 1px solid color-mix(in srgb, var(--rt-pending) 58%, var(--rule));
  background: color-mix(in srgb, var(--rt-pending) 8%, var(--paper));
  padding: 0.65rem;
  color: var(--rt-pending);
}

.sheet-item-decision__notice {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  border-top: 1px solid var(--rule);
  padding: 0.75rem 1rem;
  color: var(--rt-pending);
  font-size: 0.82rem;
  line-height: 1.4;
}

.sheet-item-decision__notice.is-error {
  color: var(--rt-danger);
}

.sheet-item-decision__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.55rem;
  border-top: 1px solid var(--rule);
  padding: 0.9rem 1rem;
}

.sheet-item-button {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  color: var(--ink-bright);
  padding: 0.58rem 0.85rem;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}

.sheet-item-button:hover:not(:disabled),
.sheet-item-button:focus-visible {
  border-color: var(--rt-focus);
  outline: 2px solid var(--rt-focus);
  outline-offset: 2px;
}

.sheet-item-button--primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-contrast);
}

.sheet-item-button--primary:focus-visible {
  outline-width: 3px;
  outline-offset: 3px;
}

.sheet-item-button:disabled {
  border-color: var(--rule);
  background: var(--paper-inset);
  color: var(--ink-faint);
  cursor: not-allowed;
}

.sheet-item-decision__result-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0 1rem 1rem;
}

.sheet-item-decision__result-links a {
  min-height: 2.75rem;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--rt-success);
  padding: 0.5rem 0.75rem;
  color: var(--rt-success);
  font-weight: 700;
  text-decoration: none;
}

.sheet-item-decision__spinner {
  animation: sheet-item-spin 0.9s linear infinite;
}

@keyframes sheet-item-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .sheet-item-decision__spinner {
    animation: none;
  }
}

@media (max-width: 760px) {
  .sheet-item-decision {
    position: static;
  }

  .sheet-item-decision__meta {
    grid-template-columns: 1fr;
  }

  .sheet-item-decision__footer,
  .sheet-item-decision__result-links {
    display: grid;
    grid-template-columns: 1fr;
  }

  .sheet-item-button,
  .sheet-item-decision__result-links a {
    width: 100%;
  }

  .sheet-item-target {
    grid-template-columns: 1.4rem 2.25rem minmax(0, 1fr);
  }

  .sheet-item-target__selected {
    grid-column: 3;
  }

  .sheet-item-choice {
    grid-template-columns: 1.3rem minmax(0, 1fr);
  }

  .sheet-item-choice__selected {
    grid-column: 2;
  }
}
</style>
