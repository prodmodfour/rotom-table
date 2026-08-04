<script setup lang="ts">
import { computed } from 'vue'
import EncounterParticipantCard from '~/components/encounter/EncounterParticipantCard.vue'
import EncounterEnvironmentSummary from './EncounterEnvironmentSummary.vue'
import type {
  EncounterWorkspaceAudience,
  EncounterWorkspaceEnvironmentEntry,
  EncounterWorkspaceObjective,
  EncounterWorkspaceClock,
  EncounterWorkspacePhase,
  EncounterWorkspaceParticipant,
} from '#shared/encounterWorkspace/model'
import {
  workspaceParticipantSummary,
  type EncounterParticipantAcceptedState,
} from '#shared/encounterWorkspace/participantPresentation'

const props = defineProps<{
  participants: readonly EncounterWorkspaceParticipant[]
  currentParticipantId: string | null
  selectedParticipantId: string | null
  inspectedParticipantId: string | null
  audience: EncounterWorkspaceAudience
  environment: readonly EncounterWorkspaceEnvironmentEntry[]
  objectives: readonly EncounterWorkspaceObjective[]
  clocks: readonly EncounterWorkspaceClock[]
  phase: EncounterWorkspacePhase | null
  stakes: string | null
  limitations: readonly ('objectives' | 'phases' | 'stakes' | 'notes' | 'waves')[]
  acceptedStates: ReadonlyMap<string, EncounterParticipantAcceptedState>
}>()
const emit = defineEmits<{
  select: [participantId: string]
  inspect: [participantId: string]
  openTactical: [participantId: string | null]
}>()
const participantById = computed(() => new Map(props.participants.map(value => [value.participantId, value])))
const current = computed(() => props.currentParticipantId ? participantById.value.get(props.currentParticipantId) ?? null : null)
const inspected = computed(() => props.inspectedParticipantId ? participantById.value.get(props.inspectedParticipantId) ?? null : null)
const variant = computed(() => props.audience === 'gm' || props.audience === 'diagnostic'
  ? 'gm' as const
  : props.audience === 'player-owner' ? 'owner' as const : 'public' as const)
const latestChange = computed(() => {
  const entries = [...props.acceptedStates.entries()]
  return entries.at(-1) ?? null
})
</script>

<template>
  <section class="encounter-battle-stage">
    <div v-if="participants.length === 0" class="encounter-battle-stage__empty">
      <slot name="empty" />
    </div>
    <template v-else>
      <header
        id="encounter-current-actor"
        class="encounter-battle-stage__header"
        data-encounter-focus="current-actor"
        tabindex="-1"
      >
        <p>Current actor</p>
        <h1>{{ current?.displayName || 'Waiting for initiative' }}</h1>
        <span v-if="current">{{ current.side?.label || 'Unaligned' }} · {{ current.roleLabel }}</span>
      </header>

      <div v-if="current" class="encounter-battle-stage__actor">
        <EncounterParticipantCard
          :participant="workspaceParticipantSummary(current)"
          :variant="variant"
          :selected="selectedParticipantId === current.participantId"
          :state="acceptedStates.get(current.participantId)?.state"
          @select="emit('select', $event)"
          @inspect="emit('inspect', $event)"
        />
        <button type="button" class="encounter-battle-stage__tactical" @click="emit('openTactical', current.participantId)">
          <span aria-hidden="true">⌖</span>
          Tactical focus
        </button>
      </div>

      <p v-if="latestChange" class="encounter-battle-stage__change" aria-live="polite">
        {{ participantById.get(latestChange[0])?.displayName || 'A participant' }}:
        {{ latestChange[1].labels.join(', ') || (latestChange[1].state === 'corrected' ? 'result corrected' : 'authoritative state accepted') }}
      </p>

      <article v-if="inspected && inspected.participantId !== current?.participantId" class="encounter-battle-stage__inspector">
        <div>
          <p>Inspected participant</p>
          <h2>{{ inspected.displayName }}</h2>
          <span>{{ inspected.side?.label || 'Unaligned' }} · {{ inspected.roleLabel }}</span>
        </div>
        <dl>
          <div><dt>HP</dt><dd class="rt-numeric">{{ inspected.hp?.current ?? 'Private' }}<template v-if="inspected.hp">/{{ inspected.hp.maximum }}</template></dd></div>
          <div><dt>Temporary HP</dt><dd class="rt-numeric">{{ inspected.hp?.temporary ?? 'Private' }}</dd></div>
          <div><dt>Injuries</dt><dd class="rt-numeric">{{ audience === 'public' ? 'Private' : inspected.injuries }}</dd></div>
          <div><dt>Initiative</dt><dd class="rt-numeric">{{ inspected.initiative ?? '—' }}</dd></div>
        </dl>
      </article>

      <section class="encounter-battle-stage__cast" aria-labelledby="visible-cast-heading">
        <h2 id="visible-cast-heading">Battle stage</h2>
        <div>
          <button
            v-for="participant in participants"
            :key="participant.participantId"
            type="button"
            :aria-pressed="selectedParticipantId === participant.participantId"
            :data-current="participant.currentTurn"
            :data-state="acceptedStates.get(participant.participantId)?.state"
            @click="emit('select', participant.participantId)"
            @dblclick="emit('inspect', participant.participantId)"
          >
            <span class="encounter-battle-stage__portrait" aria-hidden="true">
              <img v-if="participant.portraitUrl" :src="participant.portraitUrl" alt="">
              <span v-else>{{ participant.displayName.slice(0, 1) }}</span>
            </span>
            <strong>{{ participant.displayName }}</strong>
            <small>{{ participant.fainted ? 'Fainted' : participant.conditions[0] || participant.roleLabel }}</small>
          </button>
        </div>
      </section>

      <EncounterEnvironmentSummary
        :environment="environment"
        :objectives="objectives"
        :clocks="clocks"
        :phase="phase"
        :stakes="stakes"
        :limitations="limitations"
      />
      <slot name="tactical" />
    </template>
  </section>
</template>

<style scoped>
.encounter-battle-stage { min-height: 100%; padding: clamp(1rem, 3vw, 2.5rem); background: radial-gradient(circle at 50% 0, color-mix(in srgb, var(--rt-info) 11%, transparent), transparent 34rem); }
.encounter-battle-stage__empty { max-width: 42rem; margin: 15vh auto; text-align: center; }
.encounter-battle-stage__header { text-align: center; }
.encounter-battle-stage__header p,
.encounter-battle-stage__inspector p { margin: 0 0 0.2rem; color: var(--rt-info); font-size: var(--rt-type-label-sm-size); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.encounter-battle-stage__header h1 { margin: 0; color: var(--rt-text-strong); font-size: var(--rt-type-display-lg-size); }
.encounter-battle-stage__header > span,
.encounter-battle-stage__inspector > div > span { color: var(--rt-text-muted); }
.encounter-battle-stage__actor { position: relative; max-width: 42rem; margin: 1.25rem auto; }
.encounter-battle-stage__tactical { position: relative; z-index: 2; min-height: var(--rt-touch-minimum); display: block; margin: 0.5rem 0 0 auto; border: 1px solid var(--rt-info); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.encounter-battle-stage__change { max-width: 42rem; margin: 1.5rem auto; padding: 0.65rem; border-left: 3px solid var(--rt-success); background: color-mix(in srgb, var(--rt-success) 10%, var(--rt-surface-1)); }
.encounter-battle-stage__inspector { max-width: 48rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: 1.5rem auto; padding: 1rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-1); }
.encounter-battle-stage__inspector h2 { margin: 0; }
.encounter-battle-stage__inspector dl { display: grid; grid-template-columns: repeat(2, auto); gap: 0.35rem 1rem; margin: 0; }
.encounter-battle-stage__inspector dl div { display: contents; }
.encounter-battle-stage__inspector dt { color: var(--rt-text-muted); }
.encounter-battle-stage__inspector dd { margin: 0; text-align: right; }
.encounter-battle-stage__cast { max-width: 64rem; margin: 2rem auto; }
.encounter-battle-stage__cast h2 { text-align: center; }
.encounter-battle-stage__cast > div { display: flex; justify-content: center; gap: 0.75rem; flex-wrap: wrap; }
.encounter-battle-stage__cast button { min-width: 8rem; min-height: 8rem; display: grid; place-items: center; gap: 0.25rem; padding: 0.75rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-1); color: var(--rt-text); font: inherit; }
.encounter-battle-stage__cast button[aria-pressed='true'],
.encounter-battle-stage__cast button[data-current='true'] { border-color: var(--rt-focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--rt-focus) 28%, transparent); }
.encounter-battle-stage__cast button[data-state='accepted'] { animation: rt-impact var(--rt-motion-selection) var(--rt-ease-enter) 1; }
.encounter-battle-stage__cast button[data-state='corrected'] { border-style: dashed; animation: rt-correct var(--rt-motion-panel) var(--rt-ease-standard) 1; }
.encounter-battle-stage__portrait { display: grid; place-items: center; width: 3.5rem; height: 3.5rem; overflow: hidden; border-radius: 50%; background: var(--rt-surface-3); color: var(--rt-text-strong); font-size: 1.5rem; font-weight: 800; }
.encounter-battle-stage__portrait img { width: 100%; height: 100%; object-fit: contain; }
.encounter-battle-stage__cast small { color: var(--rt-text-muted); }
@media (prefers-reduced-motion: reduce) { .encounter-battle-stage__cast button { animation: none !important; } }
@media (max-width: 42rem) { .encounter-battle-stage__inspector { align-items: stretch; flex-direction: column; } .encounter-battle-stage__inspector dl { width: 100%; } }
</style>
