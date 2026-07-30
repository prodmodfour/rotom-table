import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { EncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import {
  projectCapabilityAutomationEncounterStateForPlayer,
  projectCapabilityAutomationMapForPlayer,
} from './clientStateProjection'

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const isTabletopMapShape = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & TabletopMap => (
  typeof value.slug === 'string'
  && isRecord(value.dimensions)
  && Array.isArray(value.placements)
  && Array.isArray(value.voxels)
)

const isEncounterStateShape = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & EncounterState => (
  value.schemaVersion === 1
  && isRecord(value.sides)
  && Array.isArray(value.effects)
  && isRecord(value.history)
  && isRecord(value.turnResources)
  && Array.isArray(value.zones)
  && Array.isArray(value.groundItems)
  && Array.isArray(value.pendingResolutionSummaries)
)

/**
 * Defense-in-depth for arbitrary accepted HTTP/realtime JSON. Complete map
 * loads still use the sheet-aware projector so they can emit current bounded
 * presentation states; nested patches without a complete sheet directory must
 * omit Capability authority rather than trying to infer public evidence.
 */
export const projectCapabilityAutomationJsonForPlayer = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(projectCapabilityAutomationJsonForPlayer)
  if (!isRecord(value)) return value
  if (isTabletopMapShape(value)) {
    const projected = projectCapabilityAutomationMapForPlayer(value)
    return Object.fromEntries(Object.entries(projected).flatMap(([key, entry]) => (
      key.startsWith('capability')
        ? []
        : [[key, projectCapabilityAutomationJsonForPlayer(entry)]]
    )))
  }
  if (isEncounterStateShape(value)) {
    const projected = projectCapabilityAutomationEncounterStateForPlayer(value)
    return Object.fromEntries(Object.entries(projected).flatMap(([key, entry]) => {
      // Keep the required, deliberately empty runtime shell while recursively
      // sanitizing every other nested encounter value.
      if (key === 'capabilityRuntime') {
        return [[key, projectCapabilityAutomationJsonForPlayer(entry)]]
      }
      return key.startsWith('capability')
        ? []
        : [[key, projectCapabilityAutomationJsonForPlayer(entry)]]
    }))
  }
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => (
    key.startsWith('capability')
      ? []
      : [[key, projectCapabilityAutomationJsonForPlayer(entry)]]
  )))
}

/** Preserve durable event identity while redacting Capability-private data. */
export const projectCapabilityAutomationRealtimeEventForPlayer = (
  event: PersistedRealtimeEvent,
): PersistedRealtimeEvent => {
  if (event.event.data === undefined && event.event.patches === undefined) return event
  return {
    ...event,
    event: {
      ...event.event,
      ...(event.event.data === undefined
        ? {}
        : { data: projectCapabilityAutomationJsonForPlayer(event.event.data) }),
      ...(event.event.patches === undefined
        ? {}
        : {
            patches: projectCapabilityAutomationJsonForPlayer(
              event.event.patches,
            ) as typeof event.event.patches,
          }),
    },
  }
}
