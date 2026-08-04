<script setup lang="ts">
import { computed } from 'vue'
import type { EncounterActionSummary } from '#shared/encounterWorkspace/primitives'
import type { EncounterVisualState } from '#shared/encounterWorkspace/designTokens'

const props = defineProps<{
  action: EncounterActionSummary
}>()

const emit = defineEmits<{
  activate: [actionId: string]
  inspect: [actionId: string]
}>()

const unavailable = computed(() => props.action.availability === 'unavailable')
const state = computed<EncounterVisualState>(() => unavailable.value
  ? 'unavailable'
  : (props.action.state ?? 'idle'))
const signal = computed(() => {
  const category = props.action.category.toLocaleLowerCase()
  if (category.includes('attack') || category.includes('move')) return 'var(--rt-brand)'
  if (category.includes('movement') || category.includes('position')) return 'var(--rt-focus)'
  if (category.includes('reaction') || category.includes('interrupt')) return 'var(--rt-pending)'
  if (category.includes('support') || category.includes('team')) return 'var(--rt-success)'
  return 'var(--rt-info)'
})
</script>

<template>
  <article
    class="encounter-action rt-surface rt-signal-spine"
    :data-rt-state="state"
    :data-action-id="action.id"
    :data-recommended="action.recommended || undefined"
    data-rt-layer="persistent"
    data-rt-elevation="1"
    :style="{ '--rt-signal': signal }"
  >
    <header class="encounter-action__header">
      <span class="encounter-action__identity">
        <strong class="rt-type-action-md">{{ action.name }}</strong>
        <span class="rt-type-meta-xs">{{ action.category }} · {{ action.timing }} · {{ action.source }}</span>
      </span>
      <span v-if="action.recommended" class="encounter-action__recommended rt-status-chip">Recommended</span>
    </header>

    <dl class="encounter-action__facts rt-type-body-sm">
      <div v-if="action.cost">
        <dt>Cost</dt>
        <dd>{{ action.cost }}</dd>
      </div>
      <div v-if="action.usage">
        <dt>Usage</dt>
        <dd class="rt-numeric">{{ action.usage }}</dd>
      </div>
      <div v-if="action.scope">
        <dt>Scope</dt>
        <dd>{{ action.scope }}</dd>
      </div>
    </dl>

    <p v-if="unavailable" class="encounter-action__reason" role="note">
      <strong>Unavailable:</strong> {{ action.unavailableReason || 'This action is not currently available.' }}
    </p>

    <footer class="encounter-action__footer">
      <button
        type="button"
        class="rt-control rt-control--primary"
        :disabled="unavailable"
        @click="emit('activate', action.id)"
      >
        {{ unavailable ? 'Unavailable' : `Use ${action.name}` }}
      </button>
      <button type="button" class="rt-control" @click="emit('inspect', action.id)">
        Explain
      </button>
    </footer>
  </article>
</template>

<style scoped>
.encounter-action {
  display: grid;
  gap: var(--rt-space-3);
  padding: var(--rt-card-padding) var(--rt-card-padding) var(--rt-card-padding) calc(var(--rt-card-padding) + var(--rt-space-1));
}

.encounter-action__header,
.encounter-action__footer,
.encounter-action__facts,
.encounter-action__facts > div {
  display: flex;
}

.encounter-action__header {
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rt-space-2);
}

.encounter-action__identity {
  display: grid;
  min-width: 0;
  gap: var(--rt-space-1);
}

.encounter-action__identity strong,
.encounter-action__identity span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.encounter-action__recommended {
  border-color: var(--rt-focus);
  color: var(--rt-focus);
}

.encounter-action__facts {
  flex-wrap: wrap;
  gap: var(--rt-space-2) var(--rt-space-4);
  margin: 0;
}

.encounter-action__facts > div {
  gap: var(--rt-space-1);
}

.encounter-action__facts dt {
  color: var(--rt-text-muted);
}

.encounter-action__facts dd {
  margin: 0;
  color: var(--rt-text-strong);
  font-weight: 700;
}

.encounter-action__reason {
  margin: 0;
  padding: var(--rt-space-2);
  border-left: var(--rt-border-strong) solid var(--rt-text-muted);
  background: var(--rt-surface-2);
  color: var(--rt-text);
  font-size: var(--rt-type-body-sm-size);
  line-height: var(--rt-type-body-sm-line);
}

.encounter-action__footer {
  flex-wrap: wrap;
  gap: var(--rt-space-2);
}

.encounter-action__footer .rt-control:first-child {
  flex: 1 1 11rem;
}

[data-rt-state='unavailable'] .encounter-action__footer .rt-control--primary {
  border-color: var(--rt-rule);
  background: var(--rt-surface-2);
  color: var(--rt-text-muted);
}
</style>
