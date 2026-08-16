<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { GridAnchor } from '~/types/map'
import type {
  DirectRepelPositioningProjectionV1,
  MapItemExplorationStatus,
} from '~/composables/encounter/useMapItemExploration'

const props = defineProps<{
  decisions: readonly DirectRepelPositioningProjectionV1[]
  status: MapItemExplorationStatus
  message: string | null
  busy: boolean
  commandsBlocked: boolean
}>()

const emit = defineEmits<{
  settle: [decisionId: string, destination: GridAnchor]
  retryExact: []
  refresh: []
  dismiss: []
}>()

const coordinates = reactive<Record<string, GridAnchor>>({})
const current = computed(() => props.decisions[0] ?? null)
const uncertain = computed(() => props.status === 'uncertain')
const failed = computed(() => props.status === 'conflict' || props.status === 'error')

const resetCoordinates = (): void => {
  for (const decision of props.decisions) {
    if (!coordinates[decision.decisionId]) coordinates[decision.decisionId] = { ...decision.targetPosition }
  }
  for (const decisionId of Object.keys(coordinates)) {
    if (!props.decisions.some(decision => decision.decisionId === decisionId)) delete coordinates[decisionId]
  }
}
watch(() => props.decisions.map(decision => `${decision.decisionId}:${decision.targetPosition.x},${decision.targetPosition.y},${decision.targetPosition.z}`).join('|'), resetCoordinates, { immediate: true })

const coordinate = (decision: DirectRepelPositioningProjectionV1, axis: 'x' | 'y' | 'z'): number => (
  coordinates[decision.decisionId]?.[axis] ?? decision.targetPosition[axis]
)
const setCoordinate = (decision: DirectRepelPositioningProjectionV1, axis: 'x' | 'y' | 'z', event: Event): void => {
  const target = event.target as HTMLInputElement
  const value = Number(target.value)
  coordinates[decision.decisionId] = {
    ...(coordinates[decision.decisionId] ?? decision.targetPosition),
    [axis]: Number.isSafeInteger(value) ? value : decision.targetPosition[axis],
  }
}
const destinationValid = (decision: DirectRepelPositioningProjectionV1): boolean => {
  const destination = coordinates[decision.decisionId]
  if (!destination) return false
  return (['x', 'y', 'z'] as const).every(axis => Number.isSafeInteger(destination[axis])
    && destination[axis] >= decision.destinationBounds[axis][0]
    && destination[axis] <= decision.destinationBounds[axis][1])
    && !(destination.x === decision.targetPosition.x
      && destination.y === decision.targetPosition.y
      && destination.z === decision.targetPosition.z)
}
const submit = (decision: DirectRepelPositioningProjectionV1): void => {
  const destination = coordinates[decision.decisionId]
  if (!destination || !destinationValid(decision)) return
  emit('settle', decision.decisionId, { ...destination })
}
</script>

<template>
  <section
    v-if="decisions.length || message"
    class="direct-repel"
    :class="{ 'direct-repel--uncertain': uncertain, 'direct-repel--failed': failed }"
    aria-labelledby="direct-repel-heading"
    :aria-busy="busy"
  >
    <header>
      <p>Pending item consequence</p>
      <h4 id="direct-repel-heading">Direct Repel positioning</h4>
    </header>

    <article v-if="current" class="direct-repel__decision">
      <div class="direct-repel__relationship">
        <strong>{{ current.sourceLabel }}</strong>
        <span aria-hidden="true">→</span>
        <strong>{{ current.targetLabel }}</strong>
      </div>
      <p>{{ current.itemLabel }} hit a wild Pokémon at or below Level {{ current.maximumAffectedWildLevel }}.</p>
      <p class="direct-repel__prompt">{{ current.prompt }}</p>
      <dl>
        <div>
          <dt>Source</dt>
          <dd class="rt-numeric">{{ current.sourcePosition.x }}, {{ current.sourcePosition.y }}, {{ current.sourcePosition.z }}</dd>
        </div>
        <div>
          <dt>Wild target</dt>
          <dd class="rt-numeric">{{ current.targetPosition.x }}, {{ current.targetPosition.y }}, {{ current.targetPosition.z }}</dd>
        </div>
      </dl>
      <form @submit.prevent="submit(current)">
        <fieldset :disabled="busy || commandsBlocked || uncertain">
          <legend>GM-selected Shift endpoint</legend>
          <label v-for="axis in (['x', 'y', 'z'] as const)" :key="axis">
            <span>{{ axis.toUpperCase() }}</span>
            <input
              type="number"
              step="1"
              :min="current.destinationBounds[axis][0]"
              :max="current.destinationBounds[axis][1]"
              :value="coordinate(current, axis)"
              :aria-describedby="`direct-repel-${axis}-bounds`"
              @input="setCoordinate(current, axis, $event)"
            >
            <small :id="`direct-repel-${axis}-bounds`">{{ current.destinationBounds[axis][0] }}–{{ current.destinationBounds[axis][1] }}</small>
          </label>
        </fieldset>
        <p class="direct-repel__consequence">Acceptance moves the target through authoritative Shift pathfinding and schedules forfeiture of its next Shift Action. Illegal, occupied, blocked, stale, or not-farther endpoints fail closed.</p>
        <button type="submit" :disabled="busy || commandsBlocked || uncertain || !destinationValid(current)">
          Accept exact endpoint
        </button>
      </form>
      <p v-if="decisions.length > 1" class="direct-repel__queue">{{ decisions.length - 1 }} more direct Repel decision{{ decisions.length === 2 ? '' : 's' }} will follow.</p>
    </article>

    <p v-if="message" class="direct-repel__message" :role="failed ? 'alert' : 'status'" aria-live="polite">{{ message }}</p>
    <footer v-if="uncertain || failed || (message && !current)">
      <button v-if="uncertain" type="button" :disabled="busy" @click="emit('retryExact')">Retry exact command</button>
      <button v-else-if="failed" type="button" :disabled="busy" @click="emit('refresh')">Refresh authority</button>
      <button v-else type="button" :disabled="busy" @click="emit('dismiss')">Dismiss result</button>
    </footer>
  </section>
</template>

<style scoped>
.direct-repel {
  display: grid;
  gap: var(--rt-space-3);
  padding: var(--rt-space-3);
  border: 1px solid var(--rt-rule);
  border-inline-start: 3px solid var(--rt-pending);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-2);
}
.direct-repel--failed { border-inline-start-color: var(--rt-danger); }
.direct-repel header p { margin: 0; color: var(--rt-pending); font-size: var(--rt-type-meta-xs-size); font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.direct-repel header h4 { margin: .15rem 0 0; color: var(--rt-text-strong); }
.direct-repel__decision { display: grid; gap: var(--rt-space-3); }
.direct-repel__relationship { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: var(--rt-space-2); }
.direct-repel__relationship strong:last-child { text-align: end; }
.direct-repel__decision > p, .direct-repel__message, .direct-repel__queue { margin: 0; color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); line-height: 1.45; }
.direct-repel__prompt { padding-inline-start: var(--rt-space-2); border-inline-start: 2px solid var(--rt-pending); color: var(--rt-text) !important; }
.direct-repel dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--rt-space-2); margin: 0; }
.direct-repel dl div { padding: var(--rt-space-2); border: 1px solid var(--rt-rule); background: var(--rt-surface-1); }
.direct-repel dt { color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); }
.direct-repel dd { margin: .2rem 0 0; color: var(--rt-text-strong); }
.direct-repel form { display: grid; gap: var(--rt-space-3); }
.direct-repel fieldset { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--rt-space-2); margin: 0; padding: var(--rt-space-3); border: 1px solid var(--rt-rule); }
.direct-repel legend { padding-inline: .3rem; color: var(--rt-text-strong); font-size: var(--rt-type-label-sm-size); font-weight: 800; }
.direct-repel label { display: grid; gap: .2rem; color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); }
.direct-repel input { width: 100%; min-height: var(--rt-touch-minimum); padding: .45rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-bg-canvas); color: var(--rt-text); font-family: var(--rt-font-numeric); }
.direct-repel input:focus-visible, .direct-repel button:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 3px; }
.direct-repel small { color: var(--rt-text-muted); font-family: var(--rt-font-numeric); font-size: var(--rt-type-meta-xs-size); }
.direct-repel__consequence { color: var(--rt-text-muted) !important; font-size: var(--rt-type-meta-xs-size) !important; }
.direct-repel button { min-height: var(--rt-touch-minimum); padding: .5rem .75rem; border: 1px solid var(--rt-brand); border-radius: var(--rt-radius-small); background: var(--rt-brand); color: var(--rt-on-brand); font: inherit; font-weight: 800; cursor: pointer; }
.direct-repel button:disabled { border-color: var(--rt-rule); background: var(--rt-surface-3); color: var(--rt-text-muted); cursor: not-allowed; }
.direct-repel__message { padding: var(--rt-space-2); border-inline-start: 2px solid var(--rt-pending); background: var(--rt-surface-1); }
.direct-repel--failed .direct-repel__message { border-inline-start-color: var(--rt-danger); }
.direct-repel footer { display: flex; justify-content: flex-end; }
@media (max-width: 32rem) {
  .direct-repel dl, .direct-repel fieldset { grid-template-columns: minmax(0, 1fr); }
  .direct-repel button { width: 100%; min-height: 48px; }
}
</style>
