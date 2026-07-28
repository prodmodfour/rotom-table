export const ABILITY_AUTOMATION_REALTIME_EVENT_TYPE = 'ability-resolution-accepted' as const
export const ABILITY_AUTOMATION_REALTIME_SCHEMA_VERSION = 1 as const

export interface AbilityAutomationAcceptedRealtimePayload {
  readonly schemaVersion: typeof ABILITY_AUTOMATION_REALTIME_SCHEMA_VERSION
  readonly mapSlug: string
  readonly previousRevision: number
  readonly revision: number
  readonly status: 'committed'
}
