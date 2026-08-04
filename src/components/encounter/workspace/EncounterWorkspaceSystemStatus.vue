<script setup lang="ts">
import { computed } from 'vue'
import type { EncounterWorkspaceViewModel } from '#shared/encounterWorkspace/model'
import type { EncounterWorkspaceLoadStatus } from '~/composables/encounter/useEncounterWorkspaceLoader'

const props = defineProps<{
  workspace: EncounterWorkspaceViewModel
  loadStatus: EncounterWorkspaceLoadStatus
  connection: 'connected' | 'reconnecting' | 'offline'
  commandsBlocked: boolean
  message: string | null
}>()

defineEmits<{ retry: [] }>()

const connectionLabel = computed(() => {
  if (props.connection === 'connected') return 'Connected'
  if (props.connection === 'offline') return 'Offline'
  return 'Reconnecting'
})
const saveLabel = computed(() => (
  props.loadStatus === 'stale'
    ? `Stale after revision ${props.workspace.source.mapRevision}`
    : `Authoritative revision ${props.workspace.source.mapRevision}`
))
</script>

<template>
  <section
    class="encounter-system-status"
    :class="{ 'encounter-system-status--blocked': commandsBlocked }"
    aria-label="Encounter and connection status"
  >
    <div class="encounter-system-status__fact">
      <span>Scene</span>
      <strong>{{ workspace.scene.active ? workspace.scene.name || 'Active scene' : 'No active scene' }}</strong>
    </div>
    <div class="encounter-system-status__fact">
      <span>Encounter</span>
      <strong>{{ workspace.turn.currentParticipantId ? `Round ${workspace.turn.round}` : 'Waiting for initiative' }}</strong>
    </div>
    <div class="encounter-system-status__fact" aria-live="polite">
      <span>Connection</span>
      <strong :data-state="connection">{{ connectionLabel }}</strong>
    </div>
    <div class="encounter-system-status__fact">
      <span>Save authority</span>
      <strong>{{ saveLabel }}</strong>
    </div>
    <div v-if="commandsBlocked" class="encounter-system-status__recovery" role="alert">
      <span>{{ message || workspace.system.blockingMessage || 'Commands are paused until authoritative state is reconciled.' }}</span>
      <button type="button" @click="$emit('retry')">Reconcile now</button>
    </div>
  </section>
</template>

<style scoped>
.encounter-system-status {
  display: grid;
  grid-template-columns: repeat(4, minmax(8rem, 1fr));
  gap: 1px;
  border-bottom: 1px solid var(--rt-rule);
  background: var(--rt-rule);
}
.encounter-system-status__fact { min-width: 0; padding: 0.45rem 0.7rem; background: var(--rt-surface-1); }
.encounter-system-status__fact span { display: block; color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); letter-spacing: 0.08em; text-transform: uppercase; }
.encounter-system-status__fact strong { display: block; overflow: hidden; color: var(--rt-text-strong); font-size: var(--rt-type-body-sm-size); text-overflow: ellipsis; white-space: nowrap; }
.encounter-system-status__fact [data-state='connected'] { color: var(--rt-success); }
.encounter-system-status__fact [data-state='reconnecting'] { color: var(--rt-pending); }
.encounter-system-status__fact [data-state='offline'] { color: var(--rt-danger); }
.encounter-system-status__recovery {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.55rem 0.75rem;
  background: color-mix(in srgb, var(--rt-danger) 16%, var(--rt-surface-1));
  color: var(--rt-text-strong);
}
.encounter-system-status__recovery button {
  min-height: var(--rt-touch-minimum);
  border: 1px solid var(--rt-danger);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-2);
  color: var(--rt-text-strong);
  font: inherit;
  font-weight: 700;
}
@media (max-width: 52rem) {
  .encounter-system-status { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 30rem) {
  .encounter-system-status { grid-template-columns: 1fr; }
  .encounter-system-status__recovery { grid-column: 1; align-items: stretch; flex-direction: column; }
}
</style>
