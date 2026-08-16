<script setup lang="ts">
import { computed } from 'vue'
import type { EncounterActionOffer } from '#shared/encounterPresentation/contracts'
import {
  encounterActionCostLabel,
  encounterActionTargetLabel,
  encounterActionUsageLabel,
} from '#shared/encounterWorkspace/actionDock'

const props = withDefaults(defineProps<{
  offer: EncounterActionOffer
  selected?: boolean
  shortcut?: number | null
  commandsBlocked?: boolean
  compact?: boolean
}>(), {
  selected: false,
  shortcut: null,
  commandsBlocked: false,
  compact: false,
})
const emit = defineEmits<{
  activate: [offer: EncounterActionOffer]
  inspect: [offer: EncounterActionOffer]
}>()
const available = computed(() => props.offer.availability.status === 'available' && !props.commandsBlocked)
const accessibleName = computed(() => [
  props.offer.presentation.label,
  props.offer.timing.label,
  encounterActionCostLabel(props.offer),
  encounterActionUsageLabel(props.offer),
  encounterActionTargetLabel(props.offer),
  props.offer.sourceContextLabel ?? '',
  props.offer.availability.status === 'available' ? 'available' : 'unavailable',
].join(', '))
</script>

<template>
  <article
    class="encounter-offer-card rt-surface rt-signal-spine"
    :class="{ 'encounter-offer-card--compact': compact }"
    :data-rt-state="selected ? 'selected' : offer.availability.status === 'available' ? 'idle' : 'unavailable'"
    tabindex="-1"
    data-rt-layer="persistent"
    data-rt-elevation="1"
  >
    <header>
      <span>{{ offer.source.sourceKind }}</span>
      <kbd v-if="shortcut !== null" :aria-label="`Keyboard shortcut ${shortcut}`">{{ shortcut }}</kbd>
    </header>
    <h3>{{ offer.presentation.label }}</h3>
    <p v-if="offer.sourceContextLabel" class="encounter-offer-card__source-context">{{ offer.sourceContextLabel }}</p>
    <p v-if="offer.presentation.description && !compact">{{ offer.presentation.description }}</p>
    <dl>
      <div><dt>Timing</dt><dd>{{ offer.timing.label }}</dd></div>
      <div><dt>Cost</dt><dd>{{ encounterActionCostLabel(offer) }}</dd></div>
      <div><dt>Usage</dt><dd class="rt-numeric">{{ encounterActionUsageLabel(offer) }}</dd></div>
      <div><dt>Scope</dt><dd>{{ encounterActionTargetLabel(offer) }}</dd></div>
    </dl>
    <details v-if="offer.availability.reasons.length" class="encounter-offer-card__reasons">
      <summary>Why unavailable?</summary>
      <ul>
        <li v-for="reason in offer.availability.reasons" :key="reason.code">
          <strong>{{ reason.label }}</strong>
          <span v-if="reason.sources.length">From {{ reason.sources.map(source => source.displayName).join(', ') }}</span>
          <span v-if="reason.diagnosticDetail">{{ reason.diagnosticDetail }}</span>
        </li>
      </ul>
    </details>
    <footer>
      <button type="button" class="encounter-offer-card__inspect" @click="emit('inspect', offer)">Details</button>
      <button
        type="button"
        class="encounter-offer-card__activate"
        :disabled="!available"
        :aria-label="accessibleName"
        @click="emit('activate', offer)"
      >
        {{ commandsBlocked ? 'Commands paused' : offer.availability.status === 'available' ? 'Choose' : 'Unavailable' }}
      </button>
    </footer>
  </article>
</template>

<style scoped>
.encounter-offer-card { width: min(19rem, 82vw); min-height: 15rem; display: flex; flex: 0 0 auto; flex-direction: column; padding: var(--rt-card-padding); }
.encounter-offer-card--compact { width: min(15rem, 74vw); min-height: 11.5rem; }
.encounter-offer-card > header,
.encounter-offer-card > footer { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.encounter-offer-card > header > span { color: var(--rt-info); font-size: var(--rt-type-meta-xs-size); font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.encounter-offer-card kbd { min-width: 1.65rem; padding: 0.15rem 0.35rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-3); color: var(--rt-text-strong); font: 700 var(--rt-type-meta-xs-size)/1.2 var(--rt-font-numeric); text-align: center; }
.encounter-offer-card h3 { margin: 0.55rem 0 0.2rem; color: var(--rt-text-strong); font-size: var(--rt-type-action-md-size); }
.encounter-offer-card > p { margin: 0 0 0.55rem; color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); }
.encounter-offer-card > .encounter-offer-card__source-context { margin-bottom: 0.25rem; color: var(--rt-info); font-size: var(--rt-type-meta-xs-size); font-weight: 700; }
.encounter-offer-card--compact dl > div:nth-child(1),
.encounter-offer-card--compact dl > div:nth-child(4) { display: none; }
.encounter-offer-card dl { display: grid; gap: 0.3rem; margin: 0.45rem 0; }
.encounter-offer-card dl > div { display: grid; grid-template-columns: 4rem minmax(0, 1fr); gap: 0.5rem; }
.encounter-offer-card dt { color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); text-transform: uppercase; }
.encounter-offer-card dd { min-width: 0; margin: 0; overflow: hidden; font-size: var(--rt-type-body-sm-size); text-overflow: ellipsis; }
.encounter-offer-card__reasons { margin: 0.4rem 0; color: var(--rt-danger); font-size: var(--rt-type-body-sm-size); }
.encounter-offer-card__reasons summary { min-height: 2.25rem; display: flex; align-items: center; cursor: pointer; font-weight: 700; }
.encounter-offer-card__reasons ul { margin: 0; padding-left: 1.2rem; }
.encounter-offer-card__reasons strong,
.encounter-offer-card__reasons span { display: block; }
.encounter-offer-card__reasons span { color: var(--rt-text-muted); }
.encounter-offer-card > footer { margin-top: auto; padding-top: 0.65rem; }
.encounter-offer-card > footer button { min-height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.encounter-offer-card__activate { flex: 1; border-color: var(--rt-info) !important; }
.encounter-offer-card__activate:disabled { border-color: var(--rt-rule) !important; opacity: 0.6; }
</style>
