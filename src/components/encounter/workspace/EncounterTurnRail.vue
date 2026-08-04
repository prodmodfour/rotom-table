<script setup lang="ts">
import { computed } from 'vue'
import type { EncounterWorkspaceParticipant, EncounterWorkspaceTurn } from '#shared/encounterWorkspace/model'

const props = withDefaults(defineProps<{
  turn: EncounterWorkspaceTurn
  participants: readonly EncounterWorkspaceParticipant[]
  canAdvance?: boolean
  commandsBlocked?: boolean
  busy?: boolean
}>(), {
  canAdvance: false,
  commandsBlocked: false,
  busy: false,
})
const emit = defineEmits<{
  inspect: [participantId: string]
  previous: []
  next: []
}>()
const participantById = computed(() => new Map(props.participants.map(value => [value.participantId, value])))
const labelFor = (participantId: string): string => participantById.value.get(participantId)?.displayName ?? 'Visible participant'
</script>

<template>
  <section class="encounter-turn-rail" aria-label="Turn order">
    <div class="encounter-turn-rail__round">
      <span>Round</span>
      <strong class="rt-numeric">{{ turn.round }}</strong>
    </div>
    <button
      v-if="canAdvance"
      type="button"
      class="encounter-turn-rail__advance"
      :disabled="commandsBlocked || busy || turn.entries.length === 0"
      aria-label="Previous initiative turn"
      @click="emit('previous')"
    >
      <span aria-hidden="true">←</span>
    </button>
    <ol>
      <li
        v-for="entry in turn.entries"
        :key="entry.participantId"
        :data-state="entry.state"
      >
        <button
          type="button"
          :aria-current="entry.state === 'current' ? 'step' : undefined"
          :aria-label="`${labelFor(entry.participantId)}, initiative ${entry.initiative ?? 'not set'}, ${entry.state}${entry.waitingDecisionCount ? `, ${entry.waitingDecisionCount} waiting decisions` : ''}`"
          @click="emit('inspect', entry.participantId)"
        >
          <span class="encounter-turn-rail__state" aria-hidden="true">
            {{ entry.state === 'past' ? '✓' : entry.state === 'current' ? '◆' : entry.state === 'fainted' ? '×' : '·' }}
          </span>
          <span class="encounter-turn-rail__identity">
            <strong>{{ labelFor(entry.participantId) }}</strong>
            <small>
              {{ entry.state }}
              <template v-if="entry.waitingDecisionCount"> · {{ entry.waitingDecisionCount }} waiting</template>
            </small>
          </span>
          <span class="rt-numeric">{{ entry.initiative ?? '—' }}</span>
        </button>
      </li>
    </ol>
    <button
      v-if="canAdvance"
      type="button"
      class="encounter-turn-rail__advance"
      :disabled="commandsBlocked || busy || turn.entries.length === 0"
      aria-label="Next initiative turn"
      @click="emit('next')"
    >
      <span aria-hidden="true">→</span>
    </button>
  </section>
</template>

<style scoped>
.encounter-turn-rail { display: flex; align-items: stretch; min-width: 0; height: 4.5rem; border-bottom: 1px solid var(--rt-rule); background: var(--rt-surface-1); }
.encounter-turn-rail__round { width: 5rem; display: grid; flex: 0 0 auto; place-items: center; border-right: 1px solid var(--rt-rule); }
.encounter-turn-rail__round span { color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); letter-spacing: 0.08em; text-transform: uppercase; }
.encounter-turn-rail__round strong { font-size: 1.35rem; }
.encounter-turn-rail ol { display: flex; flex: 1 1 auto; gap: 0.35rem; min-width: 0; margin: 0; padding: 0.35rem; overflow-x: auto; list-style: none; scroll-snap-type: x proximity; }
.encounter-turn-rail li { flex: 0 0 auto; scroll-snap-align: center; }
.encounter-turn-rail li > button { min-width: 10rem; height: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.5rem; padding: 0.4rem 0.6rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text); font: inherit; text-align: left; }
.encounter-turn-rail li > button:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 2px; }
.encounter-turn-rail li[data-state='current'] > button { border-color: var(--rt-focus); background: color-mix(in srgb, var(--rt-info) 14%, var(--rt-surface-2)); color: var(--rt-text-strong); }
.encounter-turn-rail li[data-state='past'] > button { opacity: 0.72; }
.encounter-turn-rail li[data-state='fainted'] > button { opacity: 0.56; text-decoration: line-through; }
.encounter-turn-rail__identity { min-width: 0; }
.encounter-turn-rail__identity strong,
.encounter-turn-rail__identity small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.encounter-turn-rail__identity small { color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); text-transform: capitalize; }
.encounter-turn-rail__state { color: var(--rt-info); }
.encounter-turn-rail__advance { width: var(--rt-touch-minimum); flex: 0 0 var(--rt-touch-minimum); border: 0; border-inline: 1px solid var(--rt-rule); background: var(--rt-surface-2); color: var(--rt-text-strong); font: 800 1.25rem/1 var(--rt-font-interface); }
.encounter-turn-rail__advance:disabled { opacity: 0.45; }
@media (max-width: 34rem) { .encounter-turn-rail__round { width: 3.75rem; } }
</style>
