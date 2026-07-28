import { mapChannel } from '#shared/realtime'
import {
  ABILITY_AUTOMATION_REALTIME_EVENT_TYPE,
  ABILITY_AUTOMATION_REALTIME_SCHEMA_VERSION,
} from '#shared/abilityAutomation/realtime'
import { createRealtimeEventMaterial } from '#shared/realtimeEventLog'
import type { AbilityResolutionPublicResult } from '#shared/abilityAutomation/results'
import type { AppendRealtimeEventInput } from '../../storage/realtimeEventRepository'

export const abilityAutomationAcceptedRealtimeDedupeKey = (input: {
  readonly mapSlug: string
  readonly operationId: string
}): string => `ability-resolution:${input.mapSlug}:${input.operationId}:accepted`

/** Public event contains only enough revision evidence to force a safe snapshot. */
export const abilityAutomationAcceptedRealtimeAppendInput = (
  result: AbilityResolutionPublicResult,
): AppendRealtimeEventInput => {
  if (result.kind !== 'accepted') {
    throw new Error('Only committed Ability resolutions can publish an accepted realtime event.')
  }
  const dedupeKey = abilityAutomationAcceptedRealtimeDedupeKey({
    mapSlug: result.mapSlug,
    operationId: result.operationId,
  })
  const material = createRealtimeEventMaterial({
    event: {
      channel: mapChannel(result.mapSlug),
      type: ABILITY_AUTOMATION_REALTIME_EVENT_TYPE,
      revision: result.revision,
      data: {
        schemaVersion: ABILITY_AUTOMATION_REALTIME_SCHEMA_VERSION,
        mapSlug: result.mapSlug,
        previousRevision: result.previousRevision,
        revision: result.revision,
        status: 'committed',
        ...(result.encounterPresentation === undefined
          ? {}
          : { presentation: result.encounterPresentation }),
      },
    },
    access: { kind: 'map-access', mapSlug: result.mapSlug },
    dedupeKey,
  })
  return {
    event: material.event,
    access: material.access,
    dedupeKey: material.dedupeKey!,
  }
}
