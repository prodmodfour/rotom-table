import { createHash } from 'node:crypto'
import {
  ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  encounterPresentationStableId,
  parseAcceptedEncounterPresentation,
  parseEncounterPendingInteractionView,
  type AcceptedEncounterPresentation,
  type EncounterParticipantPresentationRef,
  type EncounterPendingInteractionView,
  type RuleSourceRef,
} from '#shared/encounterPresentation'
import { equipmentActionPresentation } from '#shared/itemAutomation/equipmentActionPresentation'
import type { TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { StoredEquipmentActionOperation } from '../../storage/equipmentActionOperationRepository'
import type { StoredItemGuidedRequestRecord } from '../../storage/itemGuidedRequestRepository'
import { encounterItemParticipantDirectory } from './presentation'

export interface ProjectedEquipmentActionPresentations {
  readonly pending: readonly EncounterPendingInteractionView[]
  readonly accepted: readonly AcceptedEncounterPresentation[]
}

const publicToken = (namespace: string, value: string): string => createHash('sha256')
  .update(`${namespace}\u0000${value}`)
  .digest('hex')
  .slice(0, 24)

const sourceFor = (canonicalItemId: string, label = canonicalItemId): RuleSourceRef => ({
  sourceKind: 'item',
  canonicalId: canonicalItemId,
  instanceId: null,
  displayName: label,
  referenceHref: null,
})

const uniqueParticipants = (
  values: readonly (EncounterParticipantPresentationRef | null)[],
): readonly EncounterParticipantPresentationRef[] => [...new Map(values.flatMap(value => (
  value ? [[value.participantId, value] as const] : []
))).values()]

const equipmentOutcome = (record: StoredEquipmentActionOperation): {
  readonly kind: 'accepted' | 'hit' | 'miss' | 'critical'
  readonly label: string
  readonly tone: 'positive' | 'neutral' | 'warning'
} => {
  const reasons = new Set(record.result.receipts.map(receipt => receipt.reasonCode))
  if ([...reasons].some(reason => reason.endsWith('.critical'))) {
    return { kind: 'critical', label: 'Critical success', tone: 'positive' }
  }
  if ([...reasons].some(reason => reason.endsWith('.miss'))) {
    return { kind: 'miss', label: 'Attack missed', tone: 'neutral' }
  }
  if ([...reasons].some(reason => reason.endsWith('.hit'))) {
    return { kind: 'hit', label: 'Attack hit', tone: 'positive' }
  }
  return { kind: 'accepted', label: 'Action resolved', tone: 'positive' }
}

const projectEquipmentAccepted = (input: {
  readonly record: StoredEquipmentActionOperation
  readonly map: TabletopMap
  readonly participants: ReadonlyMap<string, EncounterParticipantPresentationRef>
}): AcceptedEncounterPresentation | null => {
  const { record } = input
  if (record.result.status !== 'accepted'
    || record.result.mapRevision <= record.command.baseRevision) return null
  const presentation = equipmentActionPresentation(record.result.actionId)
  const token = publicToken('equipment-action', record.result.operationId)
  const actor = input.participants.get(record.result.actorPlacementId) ?? null
  const affected = uniqueParticipants(record.result.targetPlacementIds.map(id => input.participants.get(id) ?? null))
  const outcome = equipmentOutcome(record)
  const outcomeParticipants = affected.length > 0 ? affected.map(value => value.participantId) : [actor?.participantId ?? null]
  const participantIds = [...new Set([actor?.participantId ?? null, ...affected.map(value => value.participantId)].filter(
    (value): value is string => value !== null,
  ))]
  const rollDetail = record.result.rolls.length > 0
    ? record.result.rolls.map(roll => `1d20 ${roll.modifier >= 0 ? '+' : '−'} ${Math.abs(roll.modifier)} = ${roll.total}`).join(' · ')
    : null
  const headline = outcome.kind === 'miss'
    ? `${presentation.label} missed`
    : outcome.kind === 'critical'
      ? `${presentation.label} critically succeeded`
      : `${presentation.label} resolved`
  const resultDetail = outcome.kind === 'miss'
    ? [rollDetail, 'No on-hit equipment effect was applied.'].filter(Boolean).join(' · ')
    : [presentation.summary, rollDetail].filter(Boolean).join(' · ')
  return parseAcceptedEncounterPresentation({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    presentationId: encounterPresentationStableId('accepted-equipment', token),
    operationId: encounterPresentationStableId('equipment-operation', token),
    mapSlug: input.map.slug,
    previousRevision: record.command.baseRevision,
    revision: record.result.mapRevision,
    source: sourceFor(presentation.canonicalItemId, presentation.label),
    actor,
    affectedParticipants: affected,
    outcomes: outcomeParticipants.map((participantId, index) => ({
      outcomeId: encounterPresentationStableId('equipment-outcome', token, String(index)),
      kind: outcome.kind,
      participantId,
      label: outcome.label,
      tone: outcome.tone,
      preventedBy: [],
    })),
    changes: [],
    explanations: [],
    causal: {
      groupId: encounterPresentationStableId('equipment-causal', token),
      parentPresentationId: null,
      depth: 0,
      sequence: 0,
    },
    headline: { label: headline, description: resultDetail, iconKey: 'source.item', tone: outcome.tone },
    splash: { label: presentation.label, description: null, iconKey: 'source.item', tone: outcome.tone },
    vfx: [{
      vfxId: encounterPresentationStableId('equipment-vfx', token),
      kind: 'status',
      sourceParticipantId: actor?.participantId ?? null,
      targetParticipantIds: affected.map(value => value.participantId),
      cells: [],
      tone: outcome.tone,
      duration: 'short',
      reducedMotionKind: 'static',
      label: presentation.label,
    }],
    announcements: [{
      announcementId: encounterPresentationStableId('announcement', token),
      priority: 'polite',
      message: headline,
      dedupeKey: encounterPresentationStableId('accepted-equipment', token),
    }],
    history: [{
      entryId: encounterPresentationStableId('history-equipment', token),
      occurredAt: record.createdAt,
      headline,
      detail: resultDetail,
      tone: outcome.tone,
      participantIds,
    }],
    correction: null,
  })
}

const guidedActorId = (record: StoredItemGuidedRequestRecord): string | null => (
  record.authority.sourceKind === 'equipped-fishing-rod'
  || record.authority.sourceKind === 'snag-machine-conversion'
) ? record.authority.actorPlacementId : null

const projectGuidedPending = (input: {
  readonly record: StoredItemGuidedRequestRecord
  readonly map: TabletopMap
  readonly participants: ReadonlyMap<string, EncounterParticipantPresentationRef>
}): EncounterPendingInteractionView | null => {
  if (input.record.status !== 'pending') return null
  const token = publicToken('guided-request', input.record.requestId)
  const interactionId = encounterPresentationStableId('guided-item-pending', token)
  const actorId = guidedActorId(input.record)
  const actor = actorId ? input.participants.get(actorId) ?? null : null
  return parseEncounterPendingInteractionView({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    projection: 'public',
    interactionId,
    mapSlug: input.map.slug,
    mapRevision: input.map.revision,
    status: 'pending',
    source: sourceFor(input.record.canonicalItemId),
    actor,
    prompt: `${input.record.canonicalItemId} is waiting for authorised adjudication.`,
    outstandingChoiceCount: 1,
    allowPass: false,
    allowCancel: false,
    expiresAt: null,
    announcement: {
      announcementId: encounterPresentationStableId('announcement', interactionId),
      priority: 'polite',
      message: `${input.record.canonicalItemId} is waiting for authorised adjudication.`,
      dedupeKey: encounterPresentationStableId('guided-pending', token),
    },
  })
}

const projectGuidedAccepted = (input: {
  readonly record: StoredItemGuidedRequestRecord
  readonly map: TabletopMap
  readonly participants: ReadonlyMap<string, EncounterParticipantPresentationRef>
}): AcceptedEncounterPresentation | null => {
  const { record } = input
  if (record.status === 'pending' || !record.result || !record.terminalOperationId) return null
  const authority = record.authority
  if (authority.sourceKind !== 'equipped-fishing-rod' && authority.sourceKind !== 'snag-machine-conversion') return null
  const token = publicToken('guided-terminal', record.terminalOperationId)
  const actor = input.participants.get(authority.actorPlacementId) ?? null
  const accepted = record.status === 'accepted'
  const headline = accepted
    ? record.result.acceptedSummary ?? `${record.canonicalItemId} adjudication accepted.`
    : `${record.canonicalItemId} request cancelled.`
  const revision = Math.max(1, authority.declarationMapRevision)
  return parseAcceptedEncounterPresentation({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    presentationId: encounterPresentationStableId('accepted-guided-item', token),
    operationId: encounterPresentationStableId('guided-item-operation', token),
    mapSlug: input.map.slug,
    previousRevision: revision - 1,
    revision,
    source: sourceFor(record.canonicalItemId),
    actor,
    affectedParticipants: [],
    outcomes: [{
      outcomeId: encounterPresentationStableId('guided-item-outcome', token),
      kind: accepted ? 'accepted' : 'abandoned',
      participantId: actor?.participantId ?? null,
      label: accepted ? 'Adjudication accepted' : 'Request cancelled',
      tone: accepted ? 'positive' : 'warning',
      preventedBy: [],
    }],
    changes: [],
    explanations: [],
    causal: {
      groupId: encounterPresentationStableId('guided-item-causal', token),
      parentPresentationId: null,
      depth: 0,
      sequence: 0,
    },
    headline: { label: headline, description: null, iconKey: 'source.item', tone: accepted ? 'positive' : 'warning' },
    splash: { label: record.canonicalItemId, description: null, iconKey: 'source.item', tone: accepted ? 'positive' : 'warning' },
    vfx: [],
    announcements: [{
      announcementId: encounterPresentationStableId('announcement', token),
      priority: 'polite',
      message: headline,
      dedupeKey: encounterPresentationStableId('accepted-guided-item', token),
    }],
    history: [{
      entryId: encounterPresentationStableId('history-guided-item', token),
      occurredAt: record.updatedAt,
      headline,
      detail: null,
      tone: accepted ? 'positive' : 'warning',
      participantIds: actor ? [actor.participantId] : [],
    }],
    correction: null,
  })
}

/** Project only role-safe equipment receipts and guided lifecycle state. Exact custody and GM evidence remain absent. */
export const projectEquipmentActionPresentations = (input: {
  readonly equipmentRecords: readonly StoredEquipmentActionOperation[]
  readonly guidedRecords: readonly StoredItemGuidedRequestRecord[]
  readonly map: TabletopMap
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
}): ProjectedEquipmentActionPresentations => {
  const participants = encounterItemParticipantDirectory(input)
  const pending = input.guidedRecords.flatMap(record => {
    const view = projectGuidedPending({ record, map: input.map, participants })
    return view ? [view] : []
  })
  const accepted = [
    ...input.equipmentRecords.flatMap(record => {
      const view = projectEquipmentAccepted({ record, map: input.map, participants })
      return view ? [view] : []
    }),
    ...input.guidedRecords.flatMap(record => {
      const view = projectGuidedAccepted({ record, map: input.map, participants })
      return view ? [view] : []
    }),
  ]
  return Object.freeze({ pending: Object.freeze(pending), accepted: Object.freeze(accepted) })
}
