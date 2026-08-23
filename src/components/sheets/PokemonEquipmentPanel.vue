<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import EquipmentEncounterActionSummary from './EquipmentEncounterActionSummary.vue'
import { findItem } from '~~/data/ptuReference'
import { useEquipmentLifecycleOperations } from '~/composables/sheets/useEquipmentLifecycleOperations'
import type { TrainerEquipmentAcceptedResult } from '~/composables/sheets/useTrainerEquipmentOperations'
import type { ItemGuidedAcceptedResult } from '~/composables/items/useItemGuidedAdjudication'
import type { SaveStatus } from '~/composables/useEditableSheet'
import type { CharacterSheet } from '~/types/characterSheet'

const props = withDefaults(defineProps<{
  sheet: CharacterSheet
  heldItemName: string
  saveStatus?: SaveStatus
  profileId?: string | null
  canAdjudicateEquipment?: boolean
  prepareEquipmentAction?: () => Promise<void>
}>(), {
  saveStatus: 'idle',
  profileId: null,
  canAdjudicateEquipment: false,
  prepareEquipmentAction: undefined,
})
const emit = defineEmits<{
  equipmentAccepted: [response: TrainerEquipmentAcceptedResult | ItemGuidedAcceptedResult]
}>()

const authority = computed(() => props.sheet.equipmentState ?? props.sheet.equipmentProjection ?? null)
const assignment = computed(() => authority.value?.slots.find(slot => slot.slotId === 'held') ?? null)
const instance = computed(() => assignment.value?.instanceId
  ? authority.value?.instances.find(item => item.instanceId === assignment.value?.instanceId) ?? null
  : null)
const secondaryAssignment = computed(() => (
  authority.value?.slots.find(slot => slot.slotId === 'held-secondary') ?? null
))
const secondaryInstance = computed(() => secondaryAssignment.value?.instanceId
  ? authority.value?.instances.find(item => item.instanceId === secondaryAssignment.value?.instanceId) ?? null
  : null)
const issue = computed(() => props.sheet.equipmentState?.unresolved.find(entry => entry.slotId === 'held') ?? null)
const unresolvedCount = computed(() => props.sheet.equipmentState?.unresolved.length
  ?? props.sheet.equipmentProjection?.unresolvedCount
  ?? 0)
const displayedItemName = computed(() => (
  instance.value?.canonicalItemId
  ?? issue.value?.legacyDisplayName
  ?? props.heldItemName.trim()
))
const displayedItemReference = computed(() => displayedItemName.value ? findItem(displayedItemName.value) : null)
const secondaryDisplayedItemName = computed(() => secondaryInstance.value?.canonicalItemId ?? '')
const secondaryDisplayedItemReference = computed(() => (
  secondaryDisplayedItemName.value ? findItem(secondaryDisplayedItemName.value) : null
))
const activityReasonCodes = computed(() => {
  const activity = instance.value?.activity
  if (!activity) return []
  return 'reasonCodes' in activity ? activity.reasonCodes : activity.reasons.map(reason => reason.code)
})
const statusLabel = computed(() => {
  if (instance.value?.activity.status === 'active') return 'Active'
  if (instance.value?.activity.status === 'suppressed') return 'Suppressed'
  if (instance.value?.activity.status === 'broken') return 'Broken'
  if (activityReasonCodes.value.includes('equipment.definition-pending')) return 'Awaiting compatibility'
  if (instance.value) return 'Inactive'
  if (issue.value || unresolvedCount.value > 0) return 'Review required'
  if (authority.value) return 'Empty'
  return displayedItemName.value ? 'Legacy only' : 'Empty'
})
const secondaryStatusLabel = computed(() => {
  if (secondaryInstance.value?.activity.status === 'active') return 'Active'
  if (secondaryInstance.value?.activity.status === 'suppressed') return 'Suppressed'
  if (secondaryInstance.value?.activity.status === 'broken') return 'Broken'
  return secondaryInstance.value ? 'Inactive' : 'Empty'
})
const encounterActionSources = computed(() => [instance.value, secondaryInstance.value].flatMap(item => item ? [{
  canonicalItemId: item.canonicalItemId,
  activityStatus: item.activity.status,
}] : []))
const selectedLifecycleInstanceId = ref<string | null>(null)
const selectedLifecycleInstance = computed(() => props.sheet.equipmentState?.instances
  .find(item => item.instanceId === selectedLifecycleInstanceId.value) ?? null)
const lifecycle = useEquipmentLifecycleOperations({
  sheet: () => props.sheet,
  saveStatus: () => props.saveStatus,
  canAdjudicate: () => props.canAdjudicateEquipment,
  prepareForAction: async () => { await props.prepareEquipmentAction?.() },
  onAccepted: async response => emit('equipmentAccepted', response),
})
const guidedEnabled = computed(() => ['idle', 'saved'].includes(props.saveStatus)
  && !lifecycle.busy.value && lifecycle.status.value !== 'uncertain')
let lifecycleOrigin: HTMLElement | null = null
const openLifecycleFor = (instanceId: string) => {
  if (!props.sheet.equipmentState?.instances.some(item => item.instanceId === instanceId)) return
  lifecycleOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null
  selectedLifecycleInstanceId.value = instanceId
}
const openLifecycle = () => {
  if (instance.value) openLifecycleFor(instance.value.instanceId)
}
const closeLifecycle = async () => {
  selectedLifecycleInstanceId.value = null
  await nextTick()
  lifecycleOrigin?.focus()
  lifecycleOrigin = null
}
watch(selectedLifecycleInstance, (current) => {
  if (!current && selectedLifecycleInstanceId.value) selectedLifecycleInstanceId.value = null
})

const issueSummary = computed(() => {
  if (!issue.value) return ''
  const reason = ({
    'unknown-item': 'No canonical item matches this legacy value.',
    'missing-source': 'No authoritative inventory source was found.',
    'ambiguous-source': 'More than one inventory source could match.',
    'unsupported-item': 'This item does not yet have reviewed held-item support.',
    'invalid-assignment': 'The original whole-item assignment is ambiguous.',
  } as const)[issue.value.reason]
  const count = issue.value.candidateSourceInstanceIds.length
  return `${reason} ${count === 0 ? 'No candidate sources.' : `${count} candidate ${count === 1 ? 'source' : 'sources'}.`}`
})
</script>

<template>
  <div class="row two-col">
    <section class="panel-card" aria-labelledby="pokemon-held-item-title">
      <h2 id="pokemon-held-item-title" class="panel-title">
        Held Item
        <span class="panel-subtle">authoritative custody</span>
      </h2>

      <div
        v-if="unresolvedCount > 0"
        class="equipment-review-note equipment-review-note--warning"
        role="status"
        aria-live="polite"
      >
        <strong>Held-item review required</strong>
        <p>The legacy choice is inactive until a GM confirms one exact inventory source.</p>
        <small v-if="issue">{{ issueSummary }}</small>
      </div>
      <div
        v-else-if="activityReasonCodes.includes('equipment.definition-pending')"
        class="equipment-review-note"
        role="status"
      >
        <strong>Definition unavailable</strong>
        <p>This held item remains inactive until a current reviewed equipment definition is available.</p>
      </div>

      <dl class="kv-list">
        <div>
          <dt>Held Item</dt>
          <dd class="held-item-value" :class="{ 'held-item-value--empty': !displayedItemName }">
            <ItemSprite :item="displayedItemName" size="sm" />
            <span>{{ displayedItemName || 'None' }}</span>
            <small class="equipment-state-badge" :class="`equipment-state-badge--${statusLabel.toLowerCase().replaceAll(' ', '-')}`">
              {{ statusLabel }}
            </small>
            <button
              v-if="instance && canAdjudicateEquipment && sheet.equipmentState"
              type="button"
              class="equipment-review-button"
              :aria-pressed="selectedLifecycleInstanceId === instance.instanceId"
              :disabled="lifecycle.busy.value"
              @click="openLifecycle"
            >
              Review lifecycle
            </button>
          </dd>
        </div>
        <div v-if="secondaryInstance">
          <dt>Second Held Item</dt>
          <dd class="held-item-value">
            <ItemSprite :item="secondaryDisplayedItemName" size="sm" />
            <span>{{ secondaryDisplayedItemName }}</span>
            <small class="equipment-state-badge" :class="`equipment-state-badge--${secondaryStatusLabel.toLowerCase()}`">
              {{ secondaryStatusLabel }}
            </small>
            <button
              v-if="canAdjudicateEquipment && sheet.equipmentState"
              type="button"
              class="equipment-review-button"
              :aria-pressed="selectedLifecycleInstanceId === secondaryInstance.instanceId"
              :disabled="lifecycle.busy.value"
              @click="openLifecycleFor(secondaryInstance.instanceId)"
            >
              Review lifecycle
            </button>
          </dd>
        </div>
        <div>
          <dt>Effect</dt>
          <dd class="lookup-text">
            <template v-if="displayedItemReference?.effects.length">
              <p v-for="effect in displayedItemReference.effects" :key="effect">{{ effect }}</p>
            </template>
            <span v-else class="badge-empty">
              {{ displayedItemName ? 'No matching item in items.json' : '—' }}
            </span>
          </dd>
        </div>
        <div v-if="secondaryDisplayedItemReference?.effects.length">
          <dt>Second item effect</dt>
          <dd class="lookup-text">
            <p v-for="effect in secondaryDisplayedItemReference.effects" :key="effect">{{ effect }}</p>
          </dd>
        </div>
        <div v-if="displayedItemReference?.notes.length">
          <dt>Notes</dt>
          <dd class="lookup-text">
            <p v-for="note in displayedItemReference.notes" :key="note">{{ note }}</p>
          </dd>
        </div>
      </dl>

      <EquipmentEncounterActionSummary :sources="encounterActionSources" />

      <p v-if="!authority && displayedItemName" class="equipment-legacy-note">
        Legacy held-item text is retained for review but grants no mechanical effects.
      </p>
    </section>

    <section class="panel-card">
      <h2 class="panel-title">Weapon</h2>
      <dl class="kv-list">
        <div>
          <dt>Name</dt>
          <dd><EditableCell v-model="sheet.weapon!.name" placeholder="—" /></dd>
        </div>
        <div>
          <dt>DB Mod</dt>
          <dd><EditableCell v-model="sheet.weapon!.dbMod" type="number" /></dd>
        </div>
        <div>
          <dt>AC Mod</dt>
          <dd><EditableCell v-model="sheet.weapon!.acMod" type="number" /></dd>
        </div>
        <div>
          <dt>Description</dt>
          <dd>
            <EditableCell
              v-model="sheet.weapon!.description"
              type="textarea"
              placeholder="—"
              multiline
            />
          </dd>
        </div>
      </dl>
    </section>

    <div class="equipment-guided-cell">
      <TrainerGuidedItemPanel
        :sheet="sheet"
        owner-kind="pokemon"
        :profile-id="profileId"
        :enabled="guidedEnabled"
        @accepted="emit('equipmentAccepted', $event)"
      />
    </div>

    <div v-if="selectedLifecycleInstance" class="equipment-lifecycle-cell">
      <EquipmentLifecycleAdjudicator
        :instance="selectedLifecycleInstance"
        :busy="lifecycle.busy.value"
        @cancel="closeLifecycle"
        @submit="lifecycle.adjudicate"
      />
    </div>

    <div
      v-if="lifecycle.message.value"
      class="equipment-lifecycle-status"
      :class="`equipment-lifecycle-status--${lifecycle.status.value}`"
      role="status"
      aria-live="polite"
    >
      <span>{{ lifecycle.message.value }}</span>
      <button v-if="lifecycle.status.value === 'uncertain'" type="button" @click="lifecycle.retryExact">Retry exact command</button>
      <button v-else-if="!lifecycle.busy.value" type="button" @click="lifecycle.dismiss">Dismiss</button>
    </div>

    <div v-if="sheet.equipmentContributionProjection" class="equipment-contribution-cell">
      <EquipmentContributionInspector :projection="sheet.equipmentContributionProjection" />
    </div>
  </div>
</template>

<style scoped>
.row {
  display: grid;
  gap: 0.85rem;
}

.row.two-col { grid-template-columns: repeat(2, minmax(0, 1fr)); }

.equipment-guided-cell { grid-column: 1 / -1; }

.equipment-contribution-cell,
.equipment-lifecycle-cell,
.equipment-lifecycle-status {
  min-width: 0;
  grid-column: 1 / -1;
}

.equipment-review-button,
.equipment-lifecycle-status button {
  min-height: 2.25rem;
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  padding: 0.35rem 0.55rem;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
}

.equipment-review-button:hover:not(:disabled),
.equipment-review-button:focus-visible,
.equipment-review-button[aria-pressed="true"] {
  border-color: var(--accent);
  color: var(--accent);
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.equipment-lifecycle-status {
  display: flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid var(--rule-soft);
  border-left: 3px solid var(--accent);
  border-radius: 8px;
  background: var(--paper-soft);
  padding: 0.55rem 0.7rem;
  color: var(--ink-soft);
  font-size: 0.82rem;
}

.equipment-lifecycle-status--conflict,
.equipment-lifecycle-status--error,
.equipment-lifecycle-status--uncertain {
  border-left-color: var(--warn);
}

@media (max-width: 980px) {
  .row.two-col { grid-template-columns: 1fr; }
}

.panel-title {
  margin: 0 0 0.6rem;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.panel-subtle {
  font-size: 0.74rem;
  color: var(--ink-muted);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
  font-family: var(--font-ui);
}

.kv-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
}

.kv-list > div {
  display: grid;
  grid-template-columns: minmax(120px, max-content) 1fr;
  gap: 0.6rem;
  align-items: baseline;
}

.kv-list dt {
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.kv-list dd {
  margin: 0;
  color: var(--ink-bright);
}

.held-item-value {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  min-height: 2rem;
}

.held-item-value--empty {
  color: var(--ink-faint);
}

.equipment-review-note {
  display: grid;
  gap: 0.2rem;
  margin-bottom: 0.65rem;
  border: 1px solid var(--rule-soft);
  border-left: 3px solid var(--accent);
  border-radius: 8px;
  background: var(--paper-soft);
  padding: 0.55rem 0.65rem;
  color: var(--ink-soft);
  font-size: 0.82rem;
}

.equipment-review-note--warning {
  border-color: var(--rule-active);
}

.equipment-review-note strong {
  color: var(--ink-bright);
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.equipment-review-note p,
.equipment-legacy-note {
  margin: 0;
}

.equipment-review-note small,
.equipment-legacy-note {
  color: var(--ink-muted);
  font-size: 0.76rem;
}

.equipment-state-badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.4rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  padding: 0.12rem 0.4rem;
  color: var(--ink-muted);
  font-size: 0.66rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  line-height: 1;
  text-transform: uppercase;
}

.equipment-state-badge--active {
  border-color: var(--rule-active);
  color: var(--accent);
}

.equipment-state-badge--review-required,
.equipment-state-badge--legacy-only {
  border-color: var(--rule-active);
  color: var(--ink-bright);
}

.equipment-legacy-note {
  margin-top: 0.6rem;
}

.lookup-text {
  color: var(--ink-soft);
  font-size: 0.88rem;
  white-space: pre-wrap;
}

.lookup-text p { margin: 0; }
.lookup-text p + p { margin-top: 0.35rem; }
</style>
