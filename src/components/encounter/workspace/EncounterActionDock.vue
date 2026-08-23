<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EncounterOfferCard from './EncounterOfferCard.vue'
import EncounterContextualAffordances from './EncounterContextualAffordances.vue'
import { ENCOUNTER_ACTION_GROUPS, type EncounterActionGroup } from '#shared/encounterPresentation/catalog'
import type { EncounterActionOffer, EncounterContextualAffordance } from '#shared/encounterPresentation/contracts'
import {
  encounterActionGroupLabel,
  encounterActionRecencyKey,
  filterEncounterActionOffers,
  groupEncounterActionOffers,
  orderEncounterActionsByRecency,
  recordRecentEncounterAction,
  type EncounterActionDockFilters,
} from '#shared/encounterWorkspace/actionDock'

const props = withDefaults(defineProps<{
  offers: readonly EncounterActionOffer[]
  affordances?: readonly EncounterContextualAffordance[]
  actorParticipantId: string | null
  actorLabel: string
  selectedOfferId: string | null
  commandsBlocked: boolean
}>(), {
  affordances: () => [],
})
const emit = defineEmits<{
  activate: [offer: EncounterActionOffer]
  inspect: [offer: EncounterActionOffer]
  filter: [remainingCount: number]
}>()
const query = ref('')
const group = ref<EncounterActionGroup | 'all'>('all')
const availability = ref<EncounterActionDockFilters['availability']>('all')
const recentOnly = ref(false)
const recentActionKeys = ref<readonly string[]>([])
const searchRef = ref<HTMLInputElement | null>(null)
const RENDER_BATCH_SIZE = 80
const renderLimit = ref(RENDER_BATCH_SIZE)

const actorOffers = computed(() => props.offers.filter(offer => (
  props.actorParticipantId === null || offer.actor.participantId === props.actorParticipantId
)))
const availableGroups = computed(() => ENCOUNTER_ACTION_GROUPS.filter(value => actorOffers.value.some(offer => offer.group === value)))
const filtered = computed(() => filterEncounterActionOffers({
  offers: props.offers,
  actorParticipantId: props.actorParticipantId,
  filters: { query: query.value, group: group.value, availability: availability.value },
}))
const orderedFiltered = computed(() => recentOnly.value
  ? orderEncounterActionsByRecency(
      filtered.value.filter(offer => recentActionKeys.value.includes(encounterActionRecencyKey(offer))),
      recentActionKeys.value,
    )
  : filtered.value)
const visibleOffers = computed(() => orderedFiltered.value.slice(0, renderLimit.value))
const hiddenOfferCount = computed(() => Math.max(0, orderedFiltered.value.length - visibleOffers.value.length))
const grouped = computed(() => groupEncounterActionOffers(visibleOffers.value))
watch([query, group, availability, recentOnly, () => props.actorParticipantId], () => {
  renderLimit.value = RENDER_BATCH_SIZE
  emit('filter', orderedFiltered.value.length)
})
const activate = (offer: EncounterActionOffer): void => {
  recentActionKeys.value = recordRecentEncounterAction(recentActionKeys.value, encounterActionRecencyKey(offer))
  emit('activate', offer)
}
const keyboardHandler = (event: KeyboardEvent): void => {
  const target = event.target
  const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  if (event.key === '/' && !editing) {
    event.preventDefault()
    searchRef.value?.focus()
    return
  }
  if (editing || event.altKey || event.ctrlKey || event.metaKey) return
  const index = Number(event.key) - 1
  if (!Number.isSafeInteger(index) || index < 0 || index > 8) return
  const offer = visibleOffers.value[index]
  if (!offer || offer.availability.status !== 'available' || props.commandsBlocked) return
  event.preventDefault()
  activate(offer)
}
onMounted(() => window.addEventListener('keydown', keyboardHandler))
onBeforeUnmount(() => window.removeEventListener('keydown', keyboardHandler))
</script>

<template>
  <section class="encounter-action-dock" data-encounter-focus="action-dock" tabindex="-1">
    <header>
      <div>
        <p>Available actions</p>
        <h2>{{ actorLabel }}</h2>
      </div>
      <span aria-live="polite">{{ visibleOffers.length }} of {{ orderedFiltered.length }} shown<span v-if="commandsBlocked"> · commands paused</span></span>
    </header>
    <nav class="encounter-action-dock__group-tabs" aria-label="Action groups">
      <button type="button" :aria-pressed="group === 'all'" @click="group = 'all'">All actions</button>
      <button
        v-for="value in availableGroups"
        :key="value"
        type="button"
        :data-action-group="value"
        :aria-pressed="group === value"
        @click="group = value"
      >{{ encounterActionGroupLabel(value) }}</button>
    </nav>
    <div class="encounter-action-dock__filters" role="search" aria-label="Filter available actions">
      <label>
        <span>Search</span>
        <input ref="searchRef" v-model="query" type="search" placeholder="Action, source, timing…" aria-keyshortcuts="/">
      </label>
      <label>
        <span>Availability</span>
        <select v-model="availability">
          <option value="all">All</option>
          <option value="available">Available</option>
          <option value="unavailable">Unavailable</option>
        </select>
      </label>
      <button type="button" class="encounter-action-dock__recent" :aria-pressed="recentOnly" @click="recentOnly = !recentOnly">Recent</button>
    </div>

    <EncounterContextualAffordances
      :affordances="affordances"
      :offers="offers"
      :actor-participant-id="actorParticipantId"
      :commands-blocked="commandsBlocked"
      @activate="activate"
      @inspect="emit('inspect', $event)"
    />

    <div v-if="grouped.length" class="encounter-action-dock__groups">
      <section v-for="actionGroup in grouped" :key="actionGroup.group" :aria-labelledby="`action-group-${actionGroup.group}`">
        <h3 :id="`action-group-${actionGroup.group}`">{{ encounterActionGroupLabel(actionGroup.group) }}</h3>
        <div>
          <EncounterOfferCard
            v-for="offer in actionGroup.offers"
            :id="`action-${offer.offerId}`"
            :key="offer.offerId"
            :offer="offer"
            :selected="selectedOfferId === offer.offerId"
            :shortcut="visibleOffers.indexOf(offer) < 9 ? visibleOffers.indexOf(offer) + 1 : null"
            :commands-blocked="commandsBlocked"
            :compact="actionGroup.group === 'inventory'"
            @activate="activate"
            @inspect="emit('inspect', $event)"
          />
        </div>
      </section>
    </div>
    <p v-else class="encounter-action-dock__empty">
      {{ recentOnly ? 'No recent actions match these filters.' : 'No projected actions match these filters.' }}
    </p>
    <button
      v-if="hiddenOfferCount > 0"
      type="button"
      class="encounter-action-dock__more"
      @click="renderLimit += RENDER_BATCH_SIZE"
    >
      Show {{ Math.min(RENDER_BATCH_SIZE, hiddenOfferCount) }} more actions
    </button>
  </section>
</template>

<style scoped>
.encounter-action-dock { min-height: 100%; padding: 0.7rem; }
.encounter-action-dock > header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.encounter-action-dock > header p { margin: 0; color: var(--rt-info); font-size: var(--rt-type-label-sm-size); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.encounter-action-dock h2 { margin: 0; font-size: var(--rt-type-heading-md-size); }
.encounter-action-dock > header > span { color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); }
.encounter-action-dock__group-tabs { display: flex; gap: 0.35rem; margin-top: 0.55rem; padding-bottom: 0.2rem; overflow-x: auto; }
.encounter-action-dock__group-tabs button { min-height: var(--rt-touch-minimum); flex: 0 0 auto; padding: 0.4rem 0.75rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text); font: inherit; font-weight: 700; }
.encounter-action-dock__group-tabs button[aria-pressed='true'] { border-color: var(--rt-focus); background: color-mix(in srgb, var(--rt-focus) 12%, var(--rt-surface-2)); color: var(--rt-text-strong); }
.encounter-action-dock__filters { display: flex; align-items: flex-end; gap: 0.45rem; margin: 0.45rem 0 0.6rem; overflow-x: auto; }
.encounter-action-dock__filters label { display: grid; flex: 0 0 auto; gap: 0.15rem; }
.encounter-action-dock__filters label:first-child { min-width: min(18rem, 70vw); flex: 1 1 18rem; }
.encounter-action-dock__filters label > span { color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); font-weight: 700; text-transform: uppercase; }
.encounter-action-dock__filters input,
.encounter-action-dock__filters select,
.encounter-action-dock__filters button { min-height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text); font: inherit; }
.encounter-action-dock__filters input { width: 100%; padding: 0.45rem 0.65rem; }
.encounter-action-dock__filters select { padding: 0.4rem; }
.encounter-action-dock__filters button { padding: 0.4rem 0.75rem; font-weight: 700; }
.encounter-action-dock__filters button[aria-pressed='true'] { border-color: var(--rt-focus); color: var(--rt-text-strong); }
.encounter-action-dock__groups { display: flex; gap: 1rem; overflow-x: auto; scroll-snap-type: x proximity; }
.encounter-action-dock__groups > section { flex: 0 0 auto; scroll-snap-align: start; }
.encounter-action-dock__groups h3 { margin: 0.25rem 0; color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); letter-spacing: 0.08em; text-transform: uppercase; }
.encounter-action-dock__groups section > div { display: flex; gap: 0.55rem; }
.encounter-action-dock__empty { color: var(--rt-text-muted); }
.encounter-action-dock__more { min-height: var(--rt-touch-minimum); margin-top: .55rem; padding: .45rem .75rem; border: 1px solid var(--rt-focus); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.encounter-action-dock button:focus-visible,
.encounter-action-dock input:focus-visible,
.encounter-action-dock select:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 2px; }
</style>
