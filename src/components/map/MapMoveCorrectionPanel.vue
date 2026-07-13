<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  GmMoveCorrectionDetails,
  GmMoveCorrectionEffectKind,
  GmMoveCorrectionOperationView,
  GmMoveCorrectionResourceView,
} from '#shared/moveAutomation/correctionViews'
import type { GmMoveCorrectionPanelStatus } from '~/composables/map-editor/useGmMoveCorrections'

const props = defineProps<{
  details?: GmMoveCorrectionDetails | null
  status: GmMoveCorrectionPanelStatus
  message?: string | null
}>()

const emit = defineEmits<{
  apply: [operationIds: readonly string[]]
  refresh: []
  close: []
}>()

const selectedOperationIds = ref<string[]>([])

const EFFECT_LABELS: Readonly<Record<GmMoveCorrectionEffectKind, string>> = {
  'temporary-hp': 'Temporary HP',
  'move-usage': 'Move usage',
  hazards: 'Battlefield hazards',
  'field-effects': 'Field effects',
  'encounter-sides': 'Encounter sides',
  'encounter-effects': 'Encounter effects',
  'encounter-counters': 'Encounter counters',
  'turn-resources': 'Turn resources',
  zones: 'Battlefield zones',
  placement: 'Token placement',
  hp: 'HP and Injuries',
  'combat-stages': 'Combat Stages',
  conditions: 'Conditions',
  history: 'Accepted history',
  'pending-resolution': 'Pending resolution transition',
  'external-resource': 'External resource',
  other: 'Other accepted effect',
}

const acceptedOperationIds = computed(() => new Set(
  (props.details?.corrections ?? [])
    .filter(correction => correction.status === 'accepted')
    .flatMap(correction => correction.operationIds),
))

const availableOperations = computed(() => (
  props.details?.operations.filter(operation => operation.availability === 'available') ?? []
))
const unavailableOperations = computed(() => (
  props.details?.operations.filter(operation => operation.availability === 'unavailable') ?? []
))
const selectableOperationIds = computed(() => new Set(
  availableOperations.value
    .filter(operation => !acceptedOperationIds.value.has(operation.operationId))
    .map(operation => operation.operationId),
))
const selectedCount = computed(() => selectedOperationIds.value.length)
const isPending = computed(() => props.status === 'pending')
const canApply = computed(() => selectedCount.value > 0 && !isPending.value)
const statusLabel = computed(() => {
  if (props.status === 'loading') return 'loading'
  if (props.status === 'pending') return 'pending'
  if (props.status === 'accepted') return 'accepted'
  if (props.status === 'conflicted') return 'conflicted'
  if (props.status === 'error') return 'error'
  return 'ready'
})

watch(
  () => [
    props.details?.originOperationId ?? '',
    [...selectableOperationIds.value].join('|'),
  ] as const,
  () => {
    selectedOperationIds.value = selectedOperationIds.value.filter(operationId => (
      selectableOperationIds.value.has(operationId)
    ))
  },
  { immediate: true },
)

const operationLabel = (operation: GmMoveCorrectionOperationView): string => (
  EFFECT_LABELS[operation.effectKind]
)

const resourceLabel = (resource: GmMoveCorrectionResourceView): string => {
  if (resource.kind === 'map') {
    return `Map ${resource.mapSlug} · accepted revision ${resource.acceptedRevision}`
  }
  if (resource.kind === 'sheet') {
    const kind = resource.sheetKind === 'pokemon' ? 'Pokémon sheet' : 'Trainer sheet'
    return `${kind} ${resource.sheetSlug} · accepted revision ${resource.acceptedRevision}`
  }
  return `Group inventory ${resource.resourceId} · accepted revision ${resource.acceptedRevision}`
}

const warningLabel = (
  operation: Extract<GmMoveCorrectionOperationView, { readonly availability: 'unavailable' }>,
): string => (
  operation.safety === 'externally-observed'
    ? 'Not reversible: this accepted result may already have been observed.'
    : 'Not reversible: this transition cannot be safely inverted.'
)

const isSelected = (operationId: string): boolean => selectedOperationIds.value.includes(operationId)
const isAlreadyCorrected = (operationId: string): boolean => acceptedOperationIds.value.has(operationId)

const toggleOperation = (operationId: string): void => {
  if (isPending.value || !selectableOperationIds.value.has(operationId)) return
  selectedOperationIds.value = isSelected(operationId)
    ? selectedOperationIds.value.filter(candidate => candidate !== operationId)
    : [...selectedOperationIds.value, operationId]
}

const submit = (): void => {
  if (!canApply.value) return
  emit('apply', [...selectedOperationIds.value])
}

const operationNameById = computed(() => new Map(
  (props.details?.operations ?? []).map(operation => [operation.operationId, operationLabel(operation)]),
))

const historyOperationLabels = (operationIds: readonly string[]): string => operationIds
  .map(operationId => operationNameById.value.get(operationId) ?? 'Reviewed compensation')
  .join(', ')

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const formatTime = (timestamp: number): string => dateFormatter.format(new Date(timestamp))
</script>

<template>
  <section
    v-if="props.status !== 'idle'"
    class="move-correction-panel"
    role="dialog"
    aria-labelledby="move-correction-heading"
    aria-live="polite"
  >
    <header class="move-correction-panel__header">
      <div>
        <p class="move-correction-panel__eyebrow">GM move correction</p>
        <h2 id="move-correction-heading">Safe operation details</h2>
      </div>
      <button
        type="button"
        class="move-correction-panel__close"
        aria-label="Close move correction details"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <div v-if="props.status === 'loading'" class="move-correction-panel__loading">
      Loading reviewed compensation metadata…
    </div>

    <template v-else-if="props.details">
      <div class="move-correction-panel__origin">
        <div>
          <span>Original accepted move</span>
          <strong>{{ props.details.moveName }}</strong>
        </div>
        <span class="move-correction-panel__state" :data-state="statusLabel">
          {{ statusLabel }}
        </span>
      </div>

      <dl class="move-correction-panel__origin-meta">
        <div>
          <dt>Original operation</dt>
          <dd><code>{{ props.details.originOperationId }}</code></dd>
        </div>
        <div>
          <dt>Accepted</dt>
          <dd>{{ formatTime(props.details.acceptedAt) }} · map r{{ props.details.acceptedRevision }}</dd>
        </div>
      </dl>

      <p class="move-correction-panel__guidance">
        Select only the effects that should be restored. The server rechecks exact current values and revisions before changing anything.
      </p>

      <fieldset class="move-correction-panel__operations" :disabled="isPending">
        <legend>Eligible compensations</legend>
        <p v-if="availableOperations.length === 0" class="move-correction-panel__empty">
          This move has no safely reversible effects.
        </p>
        <label
          v-for="operation in availableOperations"
          :key="operation.operationId"
          class="move-correction-operation"
          :class="{ 'move-correction-operation--applied': isAlreadyCorrected(operation.operationId) }"
        >
          <input
            type="checkbox"
            :value="operation.operationId"
            :checked="isSelected(operation.operationId)"
            :disabled="isAlreadyCorrected(operation.operationId) || isPending"
            @change="toggleOperation(operation.operationId)"
          />
          <span>
            <strong>{{ operationLabel(operation) }}</strong>
            <small>{{ resourceLabel(operation.resource) }}</small>
            <small v-if="isAlreadyCorrected(operation.operationId)" class="move-correction-operation__applied">
              Already corrected by an accepted audit entry
            </small>
          </span>
        </label>
      </fieldset>

      <section
        v-if="unavailableOperations.length > 0"
        class="move-correction-panel__warnings"
        aria-labelledby="move-correction-warnings-heading"
      >
        <h3 id="move-correction-warnings-heading">Non-reversible warnings</h3>
        <ul>
          <li v-for="operation in unavailableOperations" :key="operation.operationId">
            <strong>{{ operationLabel(operation) }}</strong>
            <span>{{ warningLabel(operation) }}</span>
            <small>{{ resourceLabel(operation.resource) }}</small>
          </li>
        </ul>
      </section>

      <p
        v-if="props.message"
        class="move-correction-panel__message"
        :data-state="statusLabel"
        :role="props.status === 'error' || props.status === 'conflicted' ? 'alert' : 'status'"
      >
        {{ props.message }}
      </p>

      <div class="move-correction-panel__actions">
        <button
          type="button"
          class="move-correction-panel__apply"
          :disabled="!canApply"
          @click="submit"
        >
          {{ isPending ? 'Applying correction…' : `Apply selected (${selectedCount})` }}
        </button>
        <button
          type="button"
          :disabled="isPending"
          @click="emit('refresh')"
        >
          Refresh details
        </button>
      </div>

      <section
        v-if="props.details.corrections.length > 0"
        class="move-correction-panel__history"
        aria-labelledby="move-correction-history-heading"
      >
        <h3 id="move-correction-history-heading">Correction history</h3>
        <ol>
          <li
            v-for="correction in props.details.corrections"
            :key="correction.correctionOperationId"
            :data-state="correction.status"
          >
            <div>
              <strong>{{ correction.status === 'accepted' ? 'Accepted correction' : 'Conflicted correction' }}</strong>
              <span>{{ formatTime(correction.createdAt) }}</span>
            </div>
            <p>{{ historyOperationLabels(correction.operationIds) }}</p>
            <dl>
              <div>
                <dt>Correction</dt>
                <dd><code>{{ correction.correctionOperationId }}</code></dd>
              </div>
              <div>
                <dt>Corrects original</dt>
                <dd><code>{{ correction.originOperationId }}</code></dd>
              </div>
            </dl>
            <p v-if="correction.message" class="move-correction-panel__history-message">
              {{ correction.message }}
            </p>
          </li>
        </ol>
      </section>
    </template>

    <div v-else class="move-correction-panel__error" role="alert">
      <p>{{ props.message ?? 'Move correction details are unavailable.' }}</p>
      <button type="button" @click="emit('refresh')">Retry load</button>
    </div>
  </section>
</template>

<style scoped>
.move-correction-panel {
  position: absolute;
  z-index: 15;
  top: max(4.4rem, var(--map-combat-log-top, 4.4rem));
  right: var(--map-overlay-gutter, 0.75rem);
  display: grid;
  gap: 0.75rem;
  width: min(31rem, calc(100vw - 1.5rem));
  max-height: calc(100vh - 5.4rem);
  padding: 0.85rem;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--accent) 64%, var(--rule-strong));
  border-radius: 16px;
  background: color-mix(in srgb, var(--paper) 97%, transparent);
  box-shadow: 0 22px 58px rgba(0, 0, 0, 0.42);
  color: var(--ink);
  pointer-events: auto;
}

.move-correction-panel__header,
.move-correction-panel__origin,
.move-correction-panel__actions,
.move-correction-panel__history li > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
}

.move-correction-panel h2,
.move-correction-panel h3,
.move-correction-panel p,
.move-correction-panel dl,
.move-correction-panel ol,
.move-correction-panel ul {
  margin: 0;
}

.move-correction-panel__eyebrow,
.move-correction-panel__origin span,
.move-correction-panel legend,
.move-correction-panel h3 {
  color: var(--accent);
  font-size: 0.69rem;
  font-weight: 900;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.move-correction-panel h2 {
  margin-top: 0.08rem;
  font-size: 1rem;
}

.move-correction-panel__close {
  width: 2rem;
  height: 2rem;
  padding: 0 !important;
  font-size: 1.25rem !important;
}

.move-correction-panel__origin {
  padding: 0.65rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
}

.move-correction-panel__origin > div {
  display: grid;
  gap: 0.12rem;
}

.move-correction-panel__origin strong {
  color: var(--ink-bright);
  font-size: 1.05rem;
}

.move-correction-panel__state {
  padding: 0.25rem 0.48rem;
  border: 1px solid currentColor;
  border-radius: 999px;
}

.move-correction-panel__state[data-state='accepted'] {
  color: #58bf72;
}

.move-correction-panel__state[data-state='conflicted'],
.move-correction-panel__state[data-state='error'] {
  color: #efad2f;
}

.move-correction-panel__origin-meta,
.move-correction-panel__history dl {
  display: grid;
  gap: 0.45rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.move-correction-panel dt {
  color: var(--muted);
  font-size: 0.65rem;
  font-weight: 800;
  text-transform: uppercase;
}

.move-correction-panel dd {
  margin: 0.1rem 0 0;
  overflow-wrap: anywhere;
  font-size: 0.74rem;
  font-weight: 750;
}

.move-correction-panel code {
  font-size: 0.68rem;
}

.move-correction-panel__guidance,
.move-correction-panel__message,
.move-correction-panel__loading,
.move-correction-panel__error,
.move-correction-panel__empty {
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.4;
}

.move-correction-panel__message[data-state='conflicted'],
.move-correction-panel__message[data-state='error'],
.move-correction-panel__error {
  color: #efad2f;
}

.move-correction-panel__operations {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  border: 0;
}

.move-correction-operation {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.55rem;
  align-items: start;
  padding: 0.6rem;
  border: 1px solid var(--rule-soft);
  border-radius: 11px;
  background: var(--paper-soft);
  cursor: pointer;
}

.move-correction-operation--applied {
  cursor: default;
  opacity: 0.72;
}

.move-correction-operation input {
  margin-top: 0.15rem;
}

.move-correction-operation > span,
.move-correction-panel__warnings li {
  display: grid;
  gap: 0.12rem;
}

.move-correction-operation small,
.move-correction-panel__warnings small {
  color: var(--muted);
  font-size: 0.7rem;
}

.move-correction-operation__applied {
  color: #58bf72 !important;
  font-weight: 800;
}

.move-correction-panel__warnings,
.move-correction-panel__history {
  display: grid;
  gap: 0.45rem;
  padding-top: 0.55rem;
  border-top: 1px solid var(--rule-soft);
}

.move-correction-panel__warnings ul,
.move-correction-panel__history ol {
  display: grid;
  gap: 0.45rem;
  padding: 0;
  list-style: none;
}

.move-correction-panel__warnings li,
.move-correction-panel__history li {
  padding: 0.58rem;
  border: 1px solid color-mix(in srgb, #efad2f 44%, var(--rule-soft));
  border-radius: 11px;
  background: color-mix(in srgb, #efad2f 7%, var(--paper-soft));
  font-size: 0.74rem;
}

.move-correction-panel__history li[data-state='accepted'] {
  border-color: color-mix(in srgb, #58bf72 48%, var(--rule-soft));
}

.move-correction-panel__history li {
  display: grid;
  gap: 0.38rem;
}

.move-correction-panel__history li > div span,
.move-correction-panel__history-message {
  color: var(--muted);
  font-size: 0.68rem;
}

.move-correction-panel__actions {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.move-correction-panel button {
  border: 1px solid var(--rule-strong);
  border-radius: 999px;
  background: var(--paper-accent);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 850;
  padding: 0.4rem 0.68rem;
}

.move-correction-panel__apply {
  border-color: color-mix(in srgb, var(--accent) 68%, var(--rule-strong)) !important;
  color: var(--accent) !important;
}

.move-correction-panel button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 600px) {
  .move-correction-panel {
    left: var(--map-overlay-gutter, 0.75rem);
    width: auto;
  }

  .move-correction-panel__origin-meta,
  .move-correction-panel__history dl {
    grid-template-columns: 1fr;
  }
}
</style>
