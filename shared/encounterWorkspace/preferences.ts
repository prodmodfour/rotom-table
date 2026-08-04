import type { EncounterDensity } from './designTokens'

export const ENCOUNTER_WORKSPACE_PREFERENCES_SCHEMA_VERSION = 1 as const
export const ENCOUNTER_WORKSPACE_PREFERENCES_STORAGE_KEY = 'rotom-table:encounter-workspace-preferences:v1'
export const ENCOUNTER_TACTICAL_MODES = ['embedded', 'split', 'picture-in-picture', 'full-screen'] as const
export type EncounterTacticalMode = typeof ENCOUNTER_TACTICAL_MODES[number]

export interface EncounterWorkspacePreferences {
  readonly schemaVersion: typeof ENCOUNTER_WORKSPACE_PREFERENCES_SCHEMA_VERSION
  readonly density: EncounterDensity
  readonly textSize: 'standard' | 'large' | 'table-distance'
  readonly colorVision: 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia'
  readonly contrast: 'standard' | 'high'
  readonly motion: 'system' | 'reduced' | 'full'
  readonly layout: 'auto' | 'table-display'
  readonly actionDock: 'compact' | 'expanded'
  readonly roster: 'expanded' | 'collapsed'
  readonly eventRail: 'expanded' | 'collapsed'
  readonly tacticalMode: EncounterTacticalMode
  readonly autoOpenExactTacticalChoices: boolean
  readonly rosterWidthPx: number
  readonly eventRailWidthPx: number
  readonly actionDockHeightPx: number
}

export const DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES: EncounterWorkspacePreferences = Object.freeze({
  schemaVersion: ENCOUNTER_WORKSPACE_PREFERENCES_SCHEMA_VERSION,
  density: 'standard',
  textSize: 'standard',
  colorVision: 'default',
  contrast: 'standard',
  motion: 'system',
  layout: 'auto',
  actionDock: 'expanded',
  roster: 'expanded',
  eventRail: 'expanded',
  tacticalMode: 'embedded',
  autoOpenExactTacticalChoices: true,
  rosterWidthPx: 288,
  eventRailWidthPx: 336,
  actionDockHeightPx: 280,
})

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const enumValue = <TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  fallback: TValue,
): TValue => typeof value === 'string' && allowed.includes(value as TValue) ? value as TValue : fallback

const boundedInteger = (value: unknown, minimum: number, maximum: number, fallback: number): number => (
  Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : fallback
)

/** Malformed or future local data degrades to safe presentation defaults only. */
export const parseEncounterWorkspacePreferences = (
  value: unknown,
): EncounterWorkspacePreferences => {
  if (!isRecord(value) || value.schemaVersion !== ENCOUNTER_WORKSPACE_PREFERENCES_SCHEMA_VERSION) {
    return { ...DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES }
  }
  return {
    schemaVersion: ENCOUNTER_WORKSPACE_PREFERENCES_SCHEMA_VERSION,
    density: enumValue(value.density, ['comfortable', 'standard', 'compact'], DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.density),
    textSize: enumValue(value.textSize, ['standard', 'large', 'table-distance'], DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.textSize),
    colorVision: enumValue(value.colorVision, ['default', 'deuteranopia', 'protanopia', 'tritanopia'], DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.colorVision),
    contrast: enumValue(value.contrast, ['standard', 'high'], DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.contrast),
    motion: enumValue(value.motion, ['system', 'reduced', 'full'], DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.motion),
    layout: enumValue(value.layout, ['auto', 'table-display'], DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.layout),
    actionDock: enumValue(value.actionDock, ['compact', 'expanded'], DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.actionDock),
    roster: enumValue(value.roster, ['expanded', 'collapsed'], DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.roster),
    eventRail: enumValue(value.eventRail, ['expanded', 'collapsed'], DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.eventRail),
    tacticalMode: enumValue(value.tacticalMode, ENCOUNTER_TACTICAL_MODES, DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.tacticalMode),
    autoOpenExactTacticalChoices: typeof value.autoOpenExactTacticalChoices === 'boolean'
      ? value.autoOpenExactTacticalChoices
      : DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.autoOpenExactTacticalChoices,
    rosterWidthPx: boundedInteger(value.rosterWidthPx, 220, 480, DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.rosterWidthPx),
    eventRailWidthPx: boundedInteger(value.eventRailWidthPx, 260, 560, DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.eventRailWidthPx),
    actionDockHeightPx: boundedInteger(value.actionDockHeightPx, 180, 520, DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.actionDockHeightPx),
  }
}

export const loadEncounterWorkspacePreferences = (
  storage: StorageLike,
): EncounterWorkspacePreferences => {
  try {
    const raw = storage.getItem(ENCOUNTER_WORKSPACE_PREFERENCES_STORAGE_KEY)
    return raw === null ? { ...DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES } : parseEncounterWorkspacePreferences(JSON.parse(raw))
  }
  catch {
    return { ...DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES }
  }
}

export const saveEncounterWorkspacePreferences = (
  storage: StorageLike,
  value: EncounterWorkspacePreferences,
): boolean => {
  try {
    storage.setItem(
      ENCOUNTER_WORKSPACE_PREFERENCES_STORAGE_KEY,
      JSON.stringify(parseEncounterWorkspacePreferences(value)),
    )
    return true
  }
  catch {
    return false
  }
}

/** Only local presentation data is serialized; no map, sheet, command, or option payload can enter this shape. */
export const encounterWorkspacePreferenceAttributes = (
  preferences: EncounterWorkspacePreferences,
): Readonly<Record<string, string>> => ({
  'data-rt-density': preferences.density,
  'data-rt-text-size': preferences.textSize,
  'data-rt-color-vision': preferences.colorVision,
  'data-rt-contrast': preferences.contrast,
  'data-rt-motion-preference': preferences.motion,
  'data-rt-layout': preferences.layout,
})
