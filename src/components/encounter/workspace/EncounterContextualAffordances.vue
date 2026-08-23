<script setup lang="ts">
import { computed } from 'vue'
import type {
  EncounterActionOffer,
  EncounterContextualAffordance,
} from '#shared/encounterPresentation/contracts'

const props = defineProps<{
  affordances: readonly EncounterContextualAffordance[]
  offers: readonly EncounterActionOffer[]
  actorParticipantId: string | null
  commandsBlocked: boolean
}>()
const emit = defineEmits<{
  activate: [offer: EncounterActionOffer]
  inspect: [offer: EncounterActionOffer]
}>()

const rows = computed(() => {
  const offers = props.offers.filter(offer => (
    props.actorParticipantId === null || offer.actor.participantId === props.actorParticipantId
  ))
  const offerById = new Map(offers.map(offer => [offer.offerId, offer]))
  const explicitByOffer = new Map(props.affordances.flatMap(affordance => (
    affordance.linkedOfferId && offerById.has(affordance.linkedOfferId)
      ? [[affordance.linkedOfferId, affordance] as const]
      : []
  )))
  const contextual = offers.filter(offer => offer.roles.includes('contextual-affordance'))
  return contextual.map((offer) => {
    const affordance = explicitByOffer.get(offer.offerId) ?? null
    return {
      rowId: affordance?.affordanceId ?? `contextual-offer:${offer.offerId}`,
      offer,
      contextLabel: affordance
        ? `${affordance.contextKind} context`
        : offer.targeting[0]?.relationshipLabel ?? 'Encounter context',
    }
  }).sort((left, right) => (
    (left.offer.availability.status === 'available' ? 0 : 1)
    - (right.offer.availability.status === 'available' ? 0 : 1)
    || left.offer.offerOrder - right.offer.offerOrder
    || left.offer.presentation.label.localeCompare(right.offer.presentation.label)
  ))
})
const unavailableLabel = (offer: EncounterActionOffer): string => offer.availability.reasons
  .map(reason => reason.label).join(' · ') || 'Current encounter authority does not allow this action.'
</script>

<template>
  <section v-if="rows.length" class="encounter-contextual" aria-labelledby="encounter-contextual-title">
    <header>
      <div>
        <p>Context now</p>
        <h3 id="encounter-contextual-title">Relevant actions</h3>
      </div>
      <span aria-live="polite">{{ rows.filter(row => row.offer.availability.status === 'available').length }} available</span>
    </header>
    <ul>
      <li v-for="row in rows" :key="row.rowId" :data-available="row.offer.availability.status === 'available'">
        <div class="encounter-contextual__copy">
          <span>{{ row.contextLabel }}</span>
          <strong>{{ row.offer.presentation.label }}</strong>
          <small>{{ row.offer.timing.label }} · {{ row.offer.source.displayName }}</small>
          <small v-if="row.offer.availability.status === 'unavailable'" class="encounter-contextual__reason">
            Unavailable · {{ unavailableLabel(row.offer) }}
          </small>
        </div>
        <div class="encounter-contextual__actions">
          <button
            type="button"
            :aria-label="`Details for ${row.offer.presentation.label}`"
            @click="emit('inspect', row.offer)"
          >Details</button>
          <button
            type="button"
            class="encounter-contextual__choose"
            :disabled="commandsBlocked || row.offer.availability.status !== 'available'"
            :aria-label="commandsBlocked
              ? `${row.offer.presentation.label} unavailable while commands are paused`
              : row.offer.availability.status === 'available'
                ? `Choose ${row.offer.presentation.label}`
                : `${row.offer.presentation.label} unavailable: ${unavailableLabel(row.offer)}`"
            @click="emit('activate', row.offer)"
          >{{ commandsBlocked ? 'Paused' : row.offer.availability.status === 'available' ? 'Choose' : 'Unavailable' }}</button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.encounter-contextual { display: grid; gap: .45rem; margin-bottom: .65rem; padding-bottom: .65rem; border-bottom: 1px solid var(--rt-rule); }
.encounter-contextual > header { display: flex; align-items: end; justify-content: space-between; gap: .75rem; }
.encounter-contextual header p { margin: 0; color: var(--rt-pending); font-size: var(--rt-type-meta-xs-size); font-weight: 850; letter-spacing: .09em; text-transform: uppercase; }
.encounter-contextual h3 { margin: 0; color: var(--rt-text-strong); font-size: var(--rt-type-action-md-size); }
.encounter-contextual header > span { color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); }
.encounter-contextual ul { display: flex; gap: .45rem; margin: 0; padding: 0 0 .2rem; overflow-x: auto; scroll-snap-type: x proximity; list-style: none; }
.encounter-contextual li { width: min(23rem, 84vw); min-height: 7.5rem; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; flex: 0 0 auto; gap: .55rem; padding: .6rem; border: 1px solid var(--rt-rule); border-left: 3px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); scroll-snap-align: start; }
.encounter-contextual li[data-available='true'] { border-left-color: var(--rt-success); }
.encounter-contextual__copy { min-width: 0; display: grid; align-content: start; gap: .12rem; }
.encounter-contextual__copy > span { color: var(--rt-info); font-size: var(--rt-type-meta-xs-size); font-weight: 800; text-transform: uppercase; }
.encounter-contextual__copy strong { color: var(--rt-text-strong); }
.encounter-contextual__copy small { color: var(--rt-text-muted); }
.encounter-contextual__copy .encounter-contextual__reason { color: var(--rt-danger); }
.encounter-contextual__actions { display: grid; grid-template-rows: 1fr 1fr; gap: .3rem; }
.encounter-contextual button { min-width: 5.5rem; min-height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-3); color: var(--rt-text-strong); font: inherit; font-size: var(--rt-type-body-sm-size); font-weight: 750; }
.encounter-contextual__choose:not(:disabled) { border-color: var(--rt-info); }
.encounter-contextual button:disabled { cursor: not-allowed; opacity: .58; }
.encounter-contextual button:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 2px; }
@media (max-width: 34rem) {
  .encounter-contextual li { grid-template-columns: 1fr; }
  .encounter-contextual__actions { grid-template-columns: 1fr 1fr; grid-template-rows: auto; }
}
</style>
