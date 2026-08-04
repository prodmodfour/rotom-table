<script setup lang="ts">
import type {
  EncounterWorkspaceClock,
  EncounterWorkspaceEnvironmentEntry,
  EncounterWorkspaceObjective,
  EncounterWorkspacePhase,
} from '#shared/encounterWorkspace/model'

defineProps<{
  environment: readonly EncounterWorkspaceEnvironmentEntry[]
  objectives: readonly EncounterWorkspaceObjective[]
  clocks: readonly EncounterWorkspaceClock[]
  phase: EncounterWorkspacePhase | null
  stakes: string | null
  limitations: readonly ('objectives' | 'phases' | 'stakes' | 'notes' | 'waves')[]
}>()
</script>

<template>
  <section class="encounter-environment" aria-labelledby="encounter-environment-heading">
    <header>
      <p>Battlefield state</p>
      <h2 id="encounter-environment-heading">Environment and objectives</h2>
    </header>
    <div v-if="environment.length" class="encounter-environment__entries">
      <article v-for="entry in environment" :key="entry.environmentId" :data-kind="entry.kind">
        <span aria-hidden="true">{{ entry.kind === 'weather' ? '☁' : entry.kind === 'terrain' ? '▧' : entry.kind === 'hazard' ? '⚠' : entry.kind === 'room' ? '⌂' : '◎' }}</span>
        <div><strong>{{ entry.label }}</strong><small>{{ entry.kind }}<template v-if="entry.scopeLabel"> · {{ entry.scopeLabel }}</template></small></div>
        <span v-if="entry.rounds !== null" class="rt-numeric">{{ entry.rounds }} rounds</span>
      </article>
    </div>
    <p v-else class="encounter-environment__empty">No visible weather, terrain, room, hazard, or zone effects.</p>

    <div v-if="objectives.length" class="encounter-environment__objectives">
      <article v-for="objective in objectives" :key="objective.objectiveId" :data-status="objective.status">
        <strong>{{ objective.label }}</strong>
        <span>{{ objective.status }}</span>
        <progress v-if="objective.progress !== null && objective.maximum !== null" :value="objective.progress" :max="objective.maximum">
          {{ objective.progress }} of {{ objective.maximum }}
        </progress>
      </article>
    </div>
    <div v-if="clocks.length" class="encounter-environment__clocks" aria-label="Encounter clocks">
      <article v-for="clock in clocks" :key="clock.clockId" :data-status="clock.status">
        <div><strong>{{ clock.label }}</strong><span>{{ clock.status }}</span></div>
        <progress :value="clock.progress" :max="clock.maximum">{{ clock.progress }} of {{ clock.maximum }}</progress>
      </article>
    </div>
    <div v-if="phase" class="encounter-environment__phase" aria-label="Encounter phase">
      <strong>{{ phase.label }}</strong>
      <span>{{ phase.summary || phase.status }}</span>
    </div>
    <div v-else-if="limitations.includes('phases')" class="encounter-environment__phase" aria-label="Encounter phase">
      <strong>Encounter phase</strong>
      <span>Not authored in the map-backed compatibility model</span>
    </div>
    <p v-if="stakes" class="encounter-environment__stakes"><strong>Stakes:</strong> {{ stakes }}</p>
    <p v-if="objectives.length === 0 && limitations.includes('objectives')" class="encounter-environment__limitation">
      Structured objectives are not authored by this map-backed encounter. None are inferred.
    </p>
  </section>
</template>

<style scoped>
.encounter-environment { max-width: 64rem; margin: 1.5rem auto; padding: 1rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-1); }
.encounter-environment header p { margin: 0; color: var(--rt-info); font-size: var(--rt-type-label-sm-size); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.encounter-environment h2 { margin: 0; font-size: var(--rt-type-heading-md-size); }
.encounter-environment__entries { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0.5rem; margin-top: 0.75rem; }
.encounter-environment__entries article { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.55rem; padding: 0.6rem; border-left: 3px solid var(--rt-info); background: var(--rt-surface-2); }
.encounter-environment__entries article[data-kind='hazard'] { border-left-color: var(--rt-danger); }
.encounter-environment__entries article[data-kind='weather'] { border-left-color: var(--rt-focus); }
.encounter-environment__entries strong,
.encounter-environment__entries small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.encounter-environment__entries small,
.encounter-environment__empty,
.encounter-environment__limitation { color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); }
.encounter-environment__objectives { display: grid; gap: 0.5rem; margin-top: 0.75rem; }
.encounter-environment__objectives article { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.5rem; }
.encounter-environment__objectives progress { grid-column: 1 / -1; width: 100%; }
.encounter-environment__clocks { display: grid; gap: .5rem; margin-top: .75rem; }
.encounter-environment__clocks article { padding: .6rem; border-inline-start: 3px solid var(--rt-pending); background: var(--rt-surface-2); }
.encounter-environment__clocks article > div { display: flex; justify-content: space-between; gap: 1rem; }
.encounter-environment__clocks progress { width: 100%; }
.encounter-environment__phase { display: flex; justify-content: space-between; gap: 1rem; margin-top: 0.75rem; padding: 0.6rem; border: 1px dashed var(--rt-rule); color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); }
.encounter-environment__phase strong { color: var(--rt-text-strong); }
.encounter-environment__stakes { padding: .6rem; border-inline-start: 3px solid var(--rt-info); background: var(--rt-surface-2); }
.encounter-environment__limitation { margin-bottom: 0; border-top: 1px solid var(--rt-rule); padding-top: 0.75rem; }
@media (max-width: 34rem) { .encounter-environment__phase { flex-direction: column; } }
</style>
