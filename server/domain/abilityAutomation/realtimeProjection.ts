import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { EncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  projectAbilityAutomationEncounterStateForPlayer,
  projectAbilityAutomationSheetForPlayer,
} from './clientStateProjection'

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const isEncounterStateShape = (value: Record<string, unknown>): value is Record<string, unknown> & EncounterState => (
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
 * Accepted command patches may nest whole encounter snapshots at several
 * bounded payload paths. Walk their strict JSON and replace every such value
 * with the same public projection used by snapshot loads.
 */
export const projectAbilityAutomationJsonForPlayer = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(projectAbilityAutomationJsonForPlayer)
  if (!isRecord(value)) return value
  if (isEncounterStateShape(value)) {
    return projectAbilityAutomationEncounterStateForPlayer(value)
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, projectAbilityAutomationJsonForPlayer(entry)]),
  )
}

const projectSheetData = (
  data: unknown,
  sourceControllerCanInspect: boolean,
): unknown => {
  const projected = projectAbilityAutomationJsonForPlayer(data)
  if (!isRecord(projected) || !isRecord(projected.sheet)) return projected
  return {
    ...projected,
    sheet: projectAbilityAutomationSheetForPlayer(
      projected.sheet as unknown as CharacterSheet | TrainerSheet,
      sourceControllerCanInspect,
    ),
  }
}

/** Preserve durable sequence/cursor identity while redacting delivered data. */
export const projectAbilityAutomationRealtimeEventForPlayer = (input: {
  readonly event: PersistedRealtimeEvent
  readonly sourceControllerCanInspectSheet?: boolean
}): PersistedRealtimeEvent => {
  if (input.event.event.data === undefined && input.event.event.patches === undefined) {
    return input.event
  }
  return {
    ...input.event,
    event: {
      ...input.event.event,
      ...(input.event.event.data === undefined
        ? {}
        : {
            data: input.event.access.kind === 'sheet-access'
              ? projectSheetData(
                  input.event.event.data,
                  input.sourceControllerCanInspectSheet === true,
                )
              : projectAbilityAutomationJsonForPlayer(input.event.event.data),
          }),
      ...(input.event.event.patches === undefined
        ? {}
        : {
            patches: projectAbilityAutomationJsonForPlayer(
              input.event.event.patches,
            ) as typeof input.event.event.patches,
          }),
    },
  }
}
