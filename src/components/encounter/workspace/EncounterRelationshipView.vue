<script setup lang="ts">
import { computed } from 'vue'
import type { EncounterActionOffer } from '#shared/encounterPresentation/contracts'
import type {
  EncounterWorkspaceEnvironmentEntry,
  EncounterWorkspaceParticipant,
} from '#shared/encounterWorkspace/model'
import { encounterRelationshipRows } from '#shared/encounterWorkspace/spatiality'

const props = defineProps<{
  offer: EncounterActionOffer
  actor: EncounterWorkspaceParticipant
  participants: readonly EncounterWorkspaceParticipant[]
  environment: readonly EncounterWorkspaceEnvironmentEntry[]
  selectedParticipantIds?: readonly string[]
}>()
const emit = defineEmits<{
  select: [participantId: string]
  inspect: [participantId: string]
  openTactical: []
}>()
const rows = computed(() => encounterRelationshipRows({
  actor: props.actor,
  participants: props.participants,
  targeting: props.offer.targeting,
  environment: props.environment,
}))
</script>

<template>
  <section class="encounter-relationship-view rt-surface" aria-labelledby="encounter-relationship-heading" data-rt-elevation="2">
    <header>
      <div>
        <p>Relationship view</p>
        <h2 id="encounter-relationship-heading">Around {{ actor.displayName }}</h2>
      </div>
      <button type="button" @click="emit('openTactical')">Open exact battlefield</button>
    </header>
    <p class="encounter-relationship-view__guardrail">
      Distances use projected token footprints. Visibility and eligibility remain server-validated when the action is submitted.
    </p>
    <div class="encounter-relationship-view__map">
      <article class="encounter-relationship-view__actor">
        <span aria-hidden="true">{{ actor.displayName.slice(0, 1) }}</span>
        <strong>{{ actor.displayName }}</strong>
        <small>Actor</small>
      </article>
      <ul>
        <li v-for="row in rows.filter(value => value.relation !== 'self')" :key="row.participantId" :data-relation="row.relation">
          <button
            type="button"
            :aria-pressed="selectedParticipantIds?.includes(row.participantId) ?? false"
            :aria-label="`${row.displayName}, ${row.relation}, ${row.distanceMeters === null ? 'distance unavailable' : `${row.distanceMeters} metres`}`"
            @click="emit('select', row.participantId)"
          >
            <span class="encounter-relationship-view__identity">
              <strong>{{ row.displayName }}</strong>
              <small>{{ row.sideLabel ?? 'Unaligned' }} · {{ row.relation }}</small>
            </span>
            <span class="encounter-relationship-view__distance rt-numeric">
              {{ row.distanceMeters === null ? '— m' : `${row.distanceMeters} m` }}
              <small>{{ row.adjacent === true ? 'Adjacent' : row.adjacent === false ? 'Not adjacent' : 'Adjacency unavailable' }}</small>
            </span>
            <span class="encounter-relationship-view__validation">Server validates</span>
          </button>
          <button type="button" class="encounter-relationship-view__inspect" :aria-label="`Inspect ${row.displayName}`" @click="emit('inspect', row.participantId)">i</button>
        </li>
      </ul>
    </div>
    <dl>
      <div v-if="rows[0]?.rangeLabels.length"><dt>Projected range</dt><dd>{{ rows[0]?.rangeLabels.join(' · ') }}</dd></div>
      <div v-if="rows[0]?.relationshipLabels.length"><dt>Relationship rule</dt><dd>{{ rows[0]?.relationshipLabels.join(' · ') }}</dd></div>
      <div><dt>Line of sight</dt><dd>{{ rows[0]?.lineOfSight === 'not-required' ? 'Not required by this offer' : 'Validated by the server' }}</dd></div>
      <div v-if="rows[0]?.zoneLabels.length"><dt>Relevant field</dt><dd>{{ rows[0]?.zoneLabels.join(' · ') }}</dd></div>
    </dl>
  </section>
</template>

<style scoped>
.encounter-relationship-view { max-width: 58rem; margin: 1rem auto; padding: 1rem; }
.encounter-relationship-view > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.encounter-relationship-view > header p { margin: 0; color: var(--rt-info); font-size: var(--rt-type-label-sm-size); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.encounter-relationship-view h2 { margin: 0; }
.encounter-relationship-view button { min-height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text); font: inherit; }
.encounter-relationship-view > header button { padding: 0.5rem 0.7rem; font-weight: 700; }
.encounter-relationship-view__guardrail { padding: 0.5rem; border-left: 3px solid var(--rt-info); color: var(--rt-text-muted); }
.encounter-relationship-view__map { display: grid; grid-template-columns: minmax(8rem, 0.45fr) minmax(0, 1.55fr); align-items: center; gap: 1rem; }
.encounter-relationship-view__actor { display: grid; place-items: center; gap: 0.2rem; padding: 1rem; text-align: center; }
.encounter-relationship-view__actor > span { width: 4rem; height: 4rem; display: grid; place-items: center; border: 2px solid var(--rt-focus); border-radius: 50%; background: var(--rt-surface-3); color: var(--rt-text-strong); font-size: 1.5rem; font-weight: 800; }
.encounter-relationship-view__actor small { color: var(--rt-info); text-transform: uppercase; }
.encounter-relationship-view ul { display: grid; gap: 0.35rem; margin: 0; padding: 0; list-style: none; }
.encounter-relationship-view li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.3rem; border-left: 3px solid var(--rt-rule); }
.encounter-relationship-view li[data-relation='ally'] { border-left-color: var(--rt-success); }
.encounter-relationship-view li[data-relation='foe'] { border-left-color: var(--rt-danger); }
.encounter-relationship-view li > button:first-child { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 0.6rem; padding: 0.5rem; border: 0; text-align: left; }
.encounter-relationship-view li > button:first-child[aria-pressed='true'] { outline: 2px solid var(--rt-focus); outline-offset: -2px; }
.encounter-relationship-view__identity strong,
.encounter-relationship-view__identity small,
.encounter-relationship-view__distance small { display: block; }
.encounter-relationship-view__identity small,
.encounter-relationship-view__distance small { color: var(--rt-text-muted); }
.encounter-relationship-view__distance { text-align: right; }
.encounter-relationship-view__validation { color: var(--rt-info); font-size: var(--rt-type-meta-xs-size); font-weight: 800; text-transform: uppercase; }
.encounter-relationship-view__inspect { width: var(--rt-touch-minimum); font-weight: 800; }
.encounter-relationship-view dl { display: grid; gap: 0.25rem; margin: 0.75rem 0 0; padding-top: 0.75rem; border-top: 1px solid var(--rt-rule); }
.encounter-relationship-view dl > div { display: grid; grid-template-columns: 9rem minmax(0, 1fr); gap: 0.5rem; }
.encounter-relationship-view dt { color: var(--rt-text-muted); }
.encounter-relationship-view dd { margin: 0; }
@media (max-width: 42rem) {
  .encounter-relationship-view__map { grid-template-columns: 1fr; }
  .encounter-relationship-view li > button:first-child { grid-template-columns: minmax(0, 1fr) auto; }
  .encounter-relationship-view__validation { grid-column: 1 / -1; }
}
</style>
