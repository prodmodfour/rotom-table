import {
  parseAcceptedEncounterPresentation,
  type AcceptedEncounterPresentation,
} from '../encounterPresentation'

export const ABILITY_AUTOMATION_REALTIME_EVENT_TYPE = 'ability-resolution-accepted' as const
export const ABILITY_AUTOMATION_REALTIME_SCHEMA_VERSION = 1 as const

export interface AbilityAutomationAcceptedRealtimePayload {
  readonly schemaVersion: typeof ABILITY_AUTOMATION_REALTIME_SCHEMA_VERSION
  readonly mapSlug: string
  readonly previousRevision: number
  readonly revision: number
  readonly status: 'committed'
  readonly presentation?: AcceptedEncounterPresentation
}

export type AbilityAutomationAcceptedRealtimePayloadParseResult =
  | { readonly valid: true; readonly payload: AbilityAutomationAcceptedRealtimePayload }
  | { readonly valid: false; readonly message: string }

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

/** Strictly validates the map-public Ability commit envelope and revision-bound presentation. */
export const parseAbilityAutomationAcceptedRealtimePayload = (
  value: unknown,
): AbilityAutomationAcceptedRealtimePayloadParseResult => {
  if (!isRecord(value)) return { valid: false, message: 'Ability accepted realtime data must be an object.' }
  const allowed = new Set(['schemaVersion', 'mapSlug', 'previousRevision', 'revision', 'status', 'presentation'])
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length > 0) return { valid: false, message: `Ability accepted realtime data has unknown fields: ${unknown.join(', ')}.` }
  if (value.schemaVersion !== ABILITY_AUTOMATION_REALTIME_SCHEMA_VERSION
    || typeof value.mapSlug !== 'string'
    || value.mapSlug.length === 0
    || value.mapSlug.length > 200
    || !Number.isSafeInteger(value.previousRevision)
    || Number(value.previousRevision) < 0
    || !Number.isSafeInteger(value.revision)
    || Number(value.revision) < Number(value.previousRevision)
    || value.status !== 'committed') {
    return { valid: false, message: 'Ability accepted realtime data has invalid identity or revision fields.' }
  }
  let presentation: AcceptedEncounterPresentation | undefined
  if (value.presentation !== undefined) {
    try {
      presentation = parseAcceptedEncounterPresentation(value.presentation)
    }
    catch (error) {
      return {
        valid: false,
        message: error instanceof Error ? error.message : 'Ability accepted presentation is invalid.',
      }
    }
    if (presentation.mapSlug !== value.mapSlug
      || presentation.previousRevision !== value.previousRevision
      || presentation.revision !== value.revision) {
      return { valid: false, message: 'Ability accepted presentation identity does not match its realtime envelope.' }
    }
  }
  return {
    valid: true,
    payload: Object.freeze({
      schemaVersion: ABILITY_AUTOMATION_REALTIME_SCHEMA_VERSION,
      mapSlug: value.mapSlug,
      previousRevision: Number(value.previousRevision),
      revision: Number(value.revision),
      status: 'committed',
      ...(presentation === undefined ? {} : { presentation }),
    }),
  }
}
