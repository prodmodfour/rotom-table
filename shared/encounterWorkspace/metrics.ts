export const ENCOUNTER_UX_METRIC_SCHEMA_VERSION = 1 as const
export const ENCOUNTER_UX_EVENTS = [
  'workspace-ready',
  'actor-selected',
  'action-dock-opened',
  'action-filtered',
  'action-activated',
  'decision-presented',
  'decision-submitted',
  'resolution-waiting',
  'resolution-settled',
  'tactical-lens-opened',
  'tactical-lens-ready',
  'system-recovery-opened',
  'system-recovery-terminal',
  'accepted-presentation-started',
  'accepted-presentation-settled',
] as const
export type EncounterUxEvent = typeof ENCOUNTER_UX_EVENTS[number]
export const ENCOUNTER_UX_VIEWPORTS = ['mobile', 'tablet', 'laptop', 'desktop', 'table-display'] as const
export const ENCOUNTER_UX_ROLE_KINDS = ['gm', 'player', 'public', 'diagnostic'] as const
export const ENCOUNTER_UX_INPUT_KINDS = ['unknown', 'keyboard', 'pointer', 'touch', 'switch'] as const
export const ENCOUNTER_UX_MOTION_PREFERENCES = ['system', 'reduced', 'full'] as const
export const ENCOUNTER_UX_SPATIALITY_LEVELS = ['none', 'participant', 'relationship', 'compact', 'exact'] as const
export const ENCOUNTER_UX_TERMINAL_STATUSES = ['none', 'accepted', 'rejected', 'adopted', 'abandoned', 'cancelled'] as const
export const ENCOUNTER_UX_FIXTURE_IDS = [
  'runtime',
  'simple-trainer-duel',
  'crowded-wild-pack',
  'boss-phases-environment',
  'private-reactions-reconnect',
  'capability-movement-feature',
] as const

export interface EncounterUxMetricSample {
  readonly schemaVersion: typeof ENCOUNTER_UX_METRIC_SCHEMA_VERSION
  readonly event: EncounterUxEvent
  /** Duration, count, or rate numerator defined by the versioned success criteria. */
  readonly value: number
  readonly dimensions: {
    readonly roleKind: typeof ENCOUNTER_UX_ROLE_KINDS[number]
    readonly viewportClass: typeof ENCOUNTER_UX_VIEWPORTS[number]
    readonly inputKind: typeof ENCOUNTER_UX_INPUT_KINDS[number]
    readonly motionPreference: typeof ENCOUNTER_UX_MOTION_PREFERENCES[number]
    readonly fixtureId: typeof ENCOUNTER_UX_FIXTURE_IDS[number]
    readonly spatialityLevel: typeof ENCOUNTER_UX_SPATIALITY_LEVELS[number]
    readonly terminalStatus: typeof ENCOUNTER_UX_TERMINAL_STATUSES[number]
  }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, expected: readonly string[], label: string): void => {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains unknown or missing fields.`)
  }
}
const enumValue = <T extends string>(value: unknown, allowed: readonly T[], label: string): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${label} is invalid.`)
  return value as T
}

/** Closed aggregate-only telemetry contract. IDs, prompts, choices, and arbitrary labels are rejected. */
export const parseEncounterUxMetricSample = (value: unknown): EncounterUxMetricSample => {
  if (!record(value)) throw new Error('Encounter UX metric sample must be an object.')
  exactKeys(value, ['schemaVersion', 'event', 'value', 'dimensions'], 'Encounter UX metric sample')
  if (value.schemaVersion !== ENCOUNTER_UX_METRIC_SCHEMA_VERSION) throw new Error('Encounter UX metric schemaVersion is unsupported.')
  if (typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value < 0 || value.value > 3_600_000) {
    throw new Error('Encounter UX metric value must be finite and bounded.')
  }
  if (!record(value.dimensions)) throw new Error('Encounter UX metric dimensions must be an object.')
  exactKeys(value.dimensions, [
    'roleKind', 'viewportClass', 'inputKind', 'motionPreference', 'fixtureId', 'spatialityLevel', 'terminalStatus',
  ], 'Encounter UX metric dimensions')
  return Object.freeze({
    schemaVersion: ENCOUNTER_UX_METRIC_SCHEMA_VERSION,
    event: enumValue(value.event, ENCOUNTER_UX_EVENTS, 'Encounter UX metric event'),
    value: value.value,
    dimensions: Object.freeze({
      roleKind: enumValue(value.dimensions.roleKind, ENCOUNTER_UX_ROLE_KINDS, 'Encounter UX metric roleKind'),
      viewportClass: enumValue(value.dimensions.viewportClass, ENCOUNTER_UX_VIEWPORTS, 'Encounter UX metric viewportClass'),
      inputKind: enumValue(value.dimensions.inputKind, ENCOUNTER_UX_INPUT_KINDS, 'Encounter UX metric inputKind'),
      motionPreference: enumValue(value.dimensions.motionPreference, ENCOUNTER_UX_MOTION_PREFERENCES, 'Encounter UX metric motionPreference'),
      fixtureId: enumValue(value.dimensions.fixtureId, ENCOUNTER_UX_FIXTURE_IDS, 'Encounter UX metric fixtureId'),
      spatialityLevel: enumValue(value.dimensions.spatialityLevel, ENCOUNTER_UX_SPATIALITY_LEVELS, 'Encounter UX metric spatialityLevel'),
      terminalStatus: enumValue(value.dimensions.terminalStatus, ENCOUNTER_UX_TERMINAL_STATUSES, 'Encounter UX metric terminalStatus'),
    }),
  })
}

export const encounterUxViewportClass = (width: number, tableDisplay: boolean): EncounterUxMetricSample['dimensions']['viewportClass'] => {
  if (tableDisplay && width >= 1280) return 'table-display'
  if (width < 640) return 'mobile'
  if (width < 900) return 'tablet'
  if (width < 1440) return 'laptop'
  return 'desktop'
}
