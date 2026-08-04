<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import EncounterParticipantCard from '~/components/encounter/EncounterParticipantCard.vue'
import type { EncounterActionOffer } from '#shared/encounterPresentation/contracts'
import type {
  EncounterWorkspaceAudience,
  EncounterWorkspaceParticipant,
  EncounterWorkspaceSide,
  EncounterWorkspaceTeam,
} from '#shared/encounterWorkspace/model'
import {
  groupEncounterWorkspaceParticipants,
  workspaceParticipantSummary,
  type EncounterParticipantAcceptedState,
} from '#shared/encounterWorkspace/participantPresentation'

const props = defineProps<{
  side: EncounterWorkspaceSide
  participants: readonly EncounterWorkspaceParticipant[]
  teams: readonly EncounterWorkspaceTeam[]
  audience: EncounterWorkspaceAudience
  selectedParticipantId: string | null
  inspectedParticipantId: string | null
  acceptedStates: ReadonlyMap<string, EncounterParticipantAcceptedState>
  teamOperations?: readonly EncounterActionOffer[]
}>()
const emit = defineEmits<{
  select: [participantId: string]
  inspect: [participantId: string]
  activateTeamOperation: [offerId: string]
}>()
const expandedGroups = ref<ReadonlySet<string>>(new Set())
const sideParticipants = computed(() => props.participants.filter(participant => (
  props.side.sideId === 'unaligned' ? participant.side === null : participant.side?.id === props.side.sideId
)))
const activeParticipants = computed(() => sideParticipants.value.filter(participant => participant.onMap && !participant.reserve))
const displayGroups = computed(() => groupEncounterWorkspaceParticipants(activeParticipants.value))
const sideTeams = computed(() => props.teams.filter(team => (
  props.side.sideId === 'unaligned' ? team.sideId === null : team.sideId === props.side.sideId
)))
const participantById = computed(() => new Map(props.participants.map(participant => [participant.participantId, participant])))
const cardVariant = computed(() => props.audience === 'gm' || props.audience === 'diagnostic'
  ? 'gm' as const
  : props.audience === 'player-owner' ? 'owner' as const : 'public' as const)
watch(() => props.inspectedParticipantId, (participantId) => {
  if (!participantId) return
  const group = displayGroups.value.find(value => value.kind === 'wild-group' && value.participantIds.includes(participantId))
  if (!group || expandedGroups.value.has(group.groupId)) return
  expandedGroups.value = new Set([...expandedGroups.value, group.groupId])
}, { immediate: true })

const toggleGroup = (groupId: string): void => {
  const next = new Set(expandedGroups.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  expandedGroups.value = next
}
</script>

<template>
  <section class="encounter-side-roster" :aria-labelledby="`side-${side.sideId}-heading`">
    <header>
      <h2 :id="`side-${side.sideId}-heading`">
        <span aria-hidden="true" :style="{ color: side.accent ?? undefined }">{{ side.symbol }}</span>
        {{ side.label }}
      </h2>
      <span>{{ activeParticipants.length }} active</span>
    </header>

    <div class="encounter-side-roster__participants">
      <template v-for="group in displayGroups" :key="group.groupId">
        <article v-if="group.kind === 'wild-group'" class="encounter-wild-group">
          <button
            type="button"
            :aria-expanded="expandedGroups.has(group.groupId)"
            :aria-controls="`group-${group.groupId}`"
            @click="toggleGroup(group.groupId)"
          >
            <span class="encounter-wild-group__stack" aria-hidden="true">
              <span v-for="index in Math.min(3, group.participants.length)" :key="index">{{ group.participants[index - 1]?.displayName.slice(0, 1) }}</span>
            </span>
            <span><strong>{{ group.label }}</strong><small>Individual state remains authoritative</small></span>
            <span aria-hidden="true">{{ expandedGroups.has(group.groupId) ? '−' : '+' }}</span>
          </button>
          <div v-if="expandedGroups.has(group.groupId)" :id="`group-${group.groupId}`" class="encounter-wild-group__members">
            <EncounterParticipantCard
              v-for="participant in group.participants"
              :id="`participant-${participant.participantId}`"
              :key="participant.participantId"
              :participant="workspaceParticipantSummary(participant)"
              :variant="cardVariant"
              :selected="selectedParticipantId === participant.participantId"
              :state="acceptedStates.get(participant.participantId)?.state"
              compact
              @select="emit('select', $event)"
              @inspect="emit('inspect', $event)"
            />
          </div>
        </article>
        <EncounterParticipantCard
          v-else-if="group.participants[0]"
          :id="`participant-${group.participants[0].participantId}`"
          :participant="workspaceParticipantSummary(group.participants[0])"
          :variant="cardVariant"
          :selected="selectedParticipantId === group.participants[0].participantId"
          :state="acceptedStates.get(group.participants[0].participantId)?.state"
          compact
          @select="emit('select', $event)"
          @inspect="emit('inspect', $event)"
        />
      </template>
    </div>

    <p v-if="side.hiddenParticipantCount" class="encounter-side-roster__hidden">
      <span aria-hidden="true">?</span>
      {{ side.hiddenParticipantCount }} hidden {{ side.hiddenParticipantCount === 1 ? 'participant' : 'participants' }}
    </p>

    <section v-for="team in sideTeams" :key="team.trainerParticipantId" class="encounter-team-roster">
      <h3>{{ participantById.get(team.trainerParticipantId)?.displayName || 'Trainer' }}’s team</h3>
      <div v-if="team.activeParticipantIds.length" class="encounter-team-roster__active">
        <span v-for="participantId in team.activeParticipantIds" :key="participantId">
          {{ participantById.get(participantId)?.displayName || 'Active Pokémon' }}
        </span>
      </div>
      <details v-if="team.reserves.length">
        <summary>{{ team.reserves.length }} {{ team.reserves.length === 1 ? 'reserve' : 'reserves' }}</summary>
        <ul>
          <li v-for="reserve in team.reserves" :key="reserve.reserveId">
            <span class="encounter-team-roster__portrait" aria-hidden="true">{{ reserve.displayName.slice(0, 1) }}</span>
            <span><strong>{{ reserve.displayName }}</strong><small>{{ reserve.location }}</small></span>
          </li>
        </ul>
      </details>
      <div v-if="teamOperations?.some(offer => offer.actor.participantId === team.trainerParticipantId)" class="encounter-team-roster__operations" aria-label="Trainer team actions">
        <button v-for="offer in teamOperations.filter(value => value.actor.participantId === team.trainerParticipantId)" :key="offer.offerId" type="button" @click="emit('activateTeamOperation', offer.offerId)">
          {{ offer.presentation.label }}
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.encounter-side-roster { display: grid; gap: 0.65rem; }
.encounter-side-roster + .encounter-side-roster { margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--rt-rule); }
.encounter-side-roster > header { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
.encounter-side-roster h2,
.encounter-team-roster h3 { margin: 0; color: var(--rt-text-strong); font-size: var(--rt-type-heading-md-size); }
.encounter-side-roster > header > span { color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); }
.encounter-side-roster__participants { display: grid; gap: 0.45rem; }
.encounter-side-roster__hidden { display: flex; align-items: center; gap: 0.5rem; margin: 0; padding: 0.6rem; border: 1px dashed var(--rt-rule); border-radius: var(--rt-radius-small); color: var(--rt-text-muted); }
.encounter-side-roster__hidden span { display: grid; place-items: center; width: 1.75rem; height: 1.75rem; border-radius: 50%; background: var(--rt-surface-3); }
.encounter-wild-group { border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-1); overflow: hidden; }
.encounter-wild-group > button { width: 100%; min-height: var(--rt-touch-minimum); display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.65rem; border: 0; padding: 0.65rem; background: var(--rt-surface-2); color: var(--rt-text); font: inherit; text-align: left; }
.encounter-wild-group > button span:nth-child(2) strong,
.encounter-wild-group > button span:nth-child(2) small { display: block; }
.encounter-wild-group > button small { color: var(--rt-text-muted); }
.encounter-wild-group__stack { display: flex; padding-left: 0.6rem; }
.encounter-wild-group__stack span { display: grid; place-items: center; width: 2rem; height: 2rem; margin-left: -0.6rem; border: 2px solid var(--rt-surface-2); border-radius: 50%; background: var(--rt-surface-3); color: var(--rt-text-strong); font-weight: 800; }
.encounter-wild-group__members { display: grid; gap: 0.35rem; padding: 0.4rem; }
.encounter-team-roster { padding: 0.7rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-2); }
.encounter-team-roster h3 { font-size: var(--rt-type-action-md-size); }
.encounter-team-roster__active { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.5rem; }
.encounter-team-roster__active > span { padding: 0.2rem 0.45rem; border-radius: 999px; background: var(--rt-surface-3); font-size: var(--rt-type-meta-xs-size); }
.encounter-team-roster summary { min-height: var(--rt-touch-minimum); display: flex; align-items: center; cursor: pointer; font-weight: 700; }
.encounter-team-roster ul { display: grid; gap: 0.35rem; margin: 0; padding: 0; list-style: none; }
.encounter-team-roster li { display: flex; align-items: center; gap: 0.5rem; }
.encounter-team-roster li strong,
.encounter-team-roster li small { display: block; }
.encounter-team-roster li small { color: var(--rt-text-muted); }
.encounter-team-roster__portrait { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: 50%; background: var(--rt-surface-3); font-weight: 800; }
.encounter-team-roster__operations { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.6rem; }
.encounter-team-roster__operations button { min-height: var(--rt-touch-minimum); border: 1px solid var(--rt-info); border-radius: var(--rt-radius-small); background: var(--rt-surface-1); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
</style>
