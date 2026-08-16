import { createHash } from 'node:crypto'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvents,
  type EncounterCampaignTimeAdvancedEvent,
  type EncounterEffectRemovedEvent,
  type EncounterEndEvent,
} from '#shared/moveAutomation/events'

const digest = (value: string): string => createHash('sha256')
  .update(value)
  .digest('hex')
  .slice(0, 24)

const boundedOperation = (operationId: string, prefix: string): string => {
  if (typeof operationId !== 'string' || operationId.length === 0 || operationId.trim() !== operationId) {
    throw new Error('Duration lifecycle operationId must be non-empty trimmed text.')
  }
  return `${prefix}.${digest(operationId)}`
}

/**
 * Stable identity for one accepted encounter-end boundary. It deliberately
 * binds both map and operation identity rather than pretending a map slug is
 * an Encounter Document or a reusable encounter-instance identity.
 */
export const encounterBoundaryId = (mapSlug: string, operationId: string): string => {
  if (typeof mapSlug !== 'string' || mapSlug.length === 0 || mapSlug.trim() !== mapSlug) {
    throw new Error('Encounter map slug must be non-empty trimmed text.')
  }
  if (typeof operationId !== 'string' || operationId.length === 0 || operationId.trim() !== operationId) {
    throw new Error('Encounter boundary operationId must be non-empty trimmed text.')
  }
  return `encounter-boundary.${digest(`${mapSlug}\u0000${operationId}`)}`
}

export const createEncounterEndLifecycleEvent = (input: {
  readonly mapSlug: string
  readonly operationId: string
  readonly reason: 'completed' | 'cancelled' | 'gm-ended'
}): EncounterEndEvent => parseEncounterEvents([{
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: `${boundedOperation(input.operationId, 'encounter-end')}.event`,
  kind: 'encounter-end',
  sourceOperationId: boundedOperation(input.operationId, 'encounter-end'),
  causalParentEventId: null,
  reasonCode: `encounter.end.${input.reason}`,
  encounterId: encounterBoundaryId(input.mapSlug, input.operationId),
}])[0] as EncounterEndEvent

export const createExplicitEffectDismissalLifecycleEvent = (input: {
  readonly effectId: string
  readonly operationId: string
}): EncounterEffectRemovedEvent => parseEncounterEvents([{
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: `${boundedOperation(input.operationId, 'effect-dismissal')}.event`,
  kind: 'effect-removed',
  sourceOperationId: boundedOperation(input.operationId, 'effect-dismissal'),
  causalParentEventId: null,
  reasonCode: 'effect.explicitly-dismissed',
  effectId: input.effectId,
}])[0] as EncounterEffectRemovedEvent

export const createCampaignTimeAdvancedLifecycleEvent = (input: {
  readonly operationId: string
  readonly previousCampaignMinute: number
  readonly campaignMinute: number
  readonly clockRevision: number
}): EncounterCampaignTimeAdvancedEvent => parseEncounterEvents([{
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: `${boundedOperation(input.operationId, 'campaign-time')}.event`,
  kind: 'campaign-time-advanced',
  sourceOperationId: boundedOperation(input.operationId, 'campaign-time'),
  causalParentEventId: null,
  reasonCode: 'campaign.time.advanced',
  previousCampaignMinute: input.previousCampaignMinute,
  campaignMinute: input.campaignMinute,
  clockRevision: input.clockRevision,
}])[0] as EncounterCampaignTimeAdvancedEvent
