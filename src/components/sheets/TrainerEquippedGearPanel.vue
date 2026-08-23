<script setup lang="ts">
import { computed } from 'vue'
import EquipmentEncounterActionSummary from './EquipmentEncounterActionSummary.vue'
import { TRAINER_EQUIPMENT_SLOTS } from '~/utils/sheets/trainerInventorySections'
import type { TrainerEquipmentSlots } from '~/types/trainerSheet'
import type {
  EquipmentLegacyIssueReason,
  EquipmentSlotId,
  SheetEquipmentProjectionV1,
  SheetEquipmentStateV1,
} from '#shared/itemAutomation/equipment'

const props = withDefaults(defineProps<{
  equipmentSlots?: TrainerEquipmentSlots
  equipmentState?: SheetEquipmentStateV1
  equipmentProjection?: SheetEquipmentProjectionV1
  canManage?: boolean
  canAdjudicate?: boolean
  selectedInstanceId?: string | null
  busy?: boolean
}>(), {
  equipmentSlots: () => ({}),
  canManage: false,
  canAdjudicate: false,
  selectedInstanceId: null,
  busy: false,
})

const emit = defineEmits<{
  unequip: [instanceId: string]
  review: [instanceId: string]
}>()

const authority = computed(() => props.equipmentState ?? props.equipmentProjection ?? null)
const instancesById = computed(() => new Map(
  (authority.value?.instances ?? []).map(instance => [instance.instanceId, instance]),
))
const unresolved = computed(() => props.equipmentState?.unresolved ?? [])
const unresolvedCount = computed(() => props.equipmentState?.unresolved.length
  ?? props.equipmentProjection?.unresolvedCount
  ?? 0)
const pendingDefinitionCount = computed(() => (authority.value?.instances ?? []).filter((instance) => {
  const reasonCodes = 'reasonCodes' in instance.activity
    ? instance.activity.reasonCodes
    : instance.activity.reasons.map(reason => reason.code)
  return reasonCodes.includes('equipment.definition-pending')
}).length)

const issueReasonLabel = (reason: EquipmentLegacyIssueReason): string => ({
  'unknown-item': 'No canonical item matches this legacy value.',
  'missing-source': 'No authoritative inventory source was found.',
  'ambiguous-source': 'More than one inventory source could match.',
  'unsupported-item': 'This item does not yet have reviewed equipment support.',
  'invalid-assignment': 'The original slot or whole-item assignment is ambiguous.',
})[reason]

const compatibilityReasonLabel = (code: string): string | null => ({
  'equipment.record-stale': 'Canonical item data changed; review this item before it can be active.',
  'equipment.owner-incompatible': 'This item is not compatible with a Trainer.',
  'equipment.slot-incompatible': 'This item does not match its assigned slot set.',
  'equipment.slot-occupied': 'A required slot is occupied by another whole item.',
  'equipment.unresolved-slot': 'A required slot still has unresolved legacy equipment.',
  'equipment.exclusivity-conflict': 'This item conflicts with another equipped item.',
  'equipment.configuration-required': 'Choose the required item configuration before activation.',
  'equipment.configuration-invalid': 'The saved item configuration is not valid for this owner.',
  'equipment.configuration-stale': 'The saved item configuration needs review.',
  'equipment.capability-required': 'The owner is missing a required Capability.',
  'equipment.skill-required': 'The owner is missing a required Skill rank.',
  'equipment.species-incompatible': 'This item is restricted to another species.',
  'equipment.evolution-stage-incompatible': 'This item requires a different evolution stage.',
  'equipment.definition-pending': 'A current reviewed equipment definition is unavailable.',
  'equipment.suppression.guided': 'Suppressed by a reviewed GM adjudication.',
  'equipment.inactive.guided': 'Inactive by a reviewed GM adjudication.',
  'equipment.breakage.narrative': 'Broken by a reviewed GM adjudication.',
  'equipment.breakage.durability': 'Reviewed durability is depleted.',
}[code] ?? (code.startsWith('equipment.suppression.')
  ? 'Suppressed by an authoritative equipment source.'
  : code.startsWith('equipment.breakage.')
    ? 'Broken by an authoritative equipment source.'
    : code.startsWith('equipment.inactive.')
      ? 'Inactive by an authoritative equipment source.'
      : null))

const rows = computed(() => TRAINER_EQUIPMENT_SLOTS.map((slot) => {
  const assignment = authority.value?.slots.find(entry => entry.slotId === slot.key)
  const instance = assignment?.instanceId ? instancesById.value.get(assignment.instanceId) ?? null : null
  const issue = unresolved.value.find(entry => entry.slotId === slot.key) ?? null
  const legacyName = props.equipmentSlots[slot.key]?.trim() ?? ''
  const name = instance?.canonicalItemId ?? issue?.legacyDisplayName ?? legacyName
  const reasonCodes = instance
    ? 'reasonCodes' in instance.activity
      ? instance.activity.reasonCodes
      : instance.activity.reasons.map(reason => reason.code)
    : []
  const status = instance
    ? instance.activity.status === 'active'
      ? 'Active'
      : instance.activity.status === 'suppressed'
        ? 'Suppressed'
        : instance.activity.status === 'broken'
          ? 'Broken'
          : 'Awaiting compatibility'
    : issue
      ? 'Review required'
      : authority.value
        ? 'Empty'
        : legacyName
          ? 'Legacy only'
          : 'Empty'
  const instanceId = instance?.instanceId ?? null
  const firstAssignedSlot = instanceId
    ? authority.value?.slots.find(entry => entry.instanceId === instanceId)?.slotId ?? null
    : null
  return {
    ...slot,
    name,
    status,
    issue,
    instanceId,
    showActions: firstAssignedSlot === slot.key,
    reason: reasonCodes.map(compatibilityReasonLabel).find(Boolean) ?? null,
  }
}))

const fullIssueSummary = (slotId: EquipmentSlotId): string => {
  const issue = unresolved.value.find(entry => entry.slotId === slotId)
  if (!issue) return ''
  const candidateCopy = issue.candidateSourceInstanceIds.length === 0
    ? 'No candidate sources.'
    : `${issue.candidateSourceInstanceIds.length} candidate ${issue.candidateSourceInstanceIds.length === 1 ? 'source' : 'sources'}.`
  return `${issueReasonLabel(issue.reason)} ${candidateCopy}`
}

const encounterActionSources = computed(() => (authority.value?.instances ?? []).map((instance) => {
  const reasonCodes = 'reasonCodes' in instance.activity
    ? instance.activity.reasonCodes
    : instance.activity.reasons.map(reason => reason.code)
  return {
    canonicalItemId: instance.canonicalItemId,
    activityStatus: instance.activity.status,
    unavailableReason: reasonCodes.map(compatibilityReasonLabel).find(Boolean) ?? null,
  }
}))
</script>

<template>
  <section class="block" aria-labelledby="trainer-equipped-title">
    <h2 id="trainer-equipped-title" class="block-title">Equipped</h2>

    <div
      v-if="unresolvedCount > 0"
      class="equipment-migration-note equipment-migration-note--warning"
      role="status"
      aria-live="polite"
    >
      <strong>Equipment review required</strong>
      <p>
        {{ unresolvedCount }} legacy {{ unresolvedCount === 1 ? 'choice is' : 'choices are' }} inactive until a GM confirms an exact inventory source and legal slot.
      </p>
      <ul v-if="unresolved.length" class="equipment-migration-list">
        <li v-for="issue in unresolved" :key="issue.issueId">
          <span>{{ TRAINER_EQUIPMENT_SLOTS.find(slot => slot.key === issue.slotId)?.label ?? issue.slotId }} · {{ issue.legacyDisplayName }}</span>
          <small>{{ fullIssueSummary(issue.slotId) }}</small>
        </li>
      </ul>
    </div>

    <div
      v-else-if="pendingDefinitionCount > 0"
      class="equipment-migration-note"
      role="status"
    >
      <strong>Definition unavailable</strong>
      <p>Recovered gear remains inactive until a current reviewed equipment definition is available.</p>
    </div>

    <ul class="kv-list equipment-slot-list">
      <li v-for="row in rows" :key="row.key">
        <span>{{ row.label }}</span>
        <strong class="equipped-item" :class="{ 'equipped-item--empty': !row.name }">
          <ItemSprite :item="row.name" size="sm" />
          <span>{{ row.name || '—' }}</span>
          <small class="equipment-state-badge" :class="`equipment-state-badge--${row.status.toLowerCase().replaceAll(' ', '-')}`">
            {{ row.status }}
          </small>
          <span v-if="row.instanceId && row.showActions" class="equipment-row-actions">
            <button
              v-if="canAdjudicate"
              type="button"
              class="equipment-review-button"
              :class="{ 'equipment-review-button--selected': selectedInstanceId === row.instanceId }"
              :disabled="busy"
              :aria-pressed="selectedInstanceId === row.instanceId"
              :aria-label="`Review ${row.name} lifecycle`"
              @click="emit('review', row.instanceId)"
            >
              Review
            </button>
            <button
              v-if="canManage"
              type="button"
              class="equipment-return-button"
              :disabled="busy"
              :aria-label="`Return ${row.name} from ${row.label} to inventory`"
              @click="emit('unequip', row.instanceId)"
            >
              Return
            </button>
          </span>
        </strong>
        <small v-if="row.reason" class="equipment-slot-reason">{{ row.reason }}</small>
      </li>
    </ul>

    <EquipmentEncounterActionSummary :sources="encounterActionSources" />

    <p v-if="!authority && rows.some(row => row.name)" class="equipment-legacy-note">
      Legacy equipment text is retained for review but grants no mechanical effects.
    </p>
  </section>
</template>

<style scoped src="./trainerInventoryPanel.css"></style>
