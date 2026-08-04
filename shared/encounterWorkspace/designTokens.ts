import rawDesignTokens from '../../data/encounter-workspace/design-tokens.v1.json'

export const ENCOUNTER_DESIGN_TOKEN_SCHEMA_VERSION = 1 as const
export const ENCOUNTER_DESIGN_TOKEN_SET_ID = 'rotom-encounter-design-v1' as const

export const ENCOUNTER_CONTEXTS = ['field-guide', 'workshop', 'live-encounter'] as const
export type EncounterDesignContext = typeof ENCOUNTER_CONTEXTS[number]

export const ENCOUNTER_THEMES = ['dark', 'light'] as const
export type EncounterTheme = typeof ENCOUNTER_THEMES[number]

export const ENCOUNTER_DENSITIES = ['comfortable', 'standard', 'compact'] as const
export type EncounterDensity = typeof ENCOUNTER_DENSITIES[number]

export const ENCOUNTER_VISUAL_STATES = [
  'idle',
  'hover',
  'focused',
  'selected',
  'pending',
  'accepted',
  'corrected',
  'unavailable',
] as const
export type EncounterVisualState = typeof ENCOUNTER_VISUAL_STATES[number]

export const ENCOUNTER_VISUAL_LAYERS = [
  'world',
  'persistent',
  'decision',
  'system',
  'inspector',
] as const
export type EncounterVisualLayer = typeof ENCOUNTER_VISUAL_LAYERS[number]

export interface EncounterThemeColors {
  bgWorld: string
  bgCanvas: string
  surface1: string
  surface2: string
  surface3: string
  textStrong: string
  text: string
  textMuted: string
  rule: string
  brand: string
  onBrand: string
  focus: string
  pending: string
  success: string
  danger: string
  info: string
}

export interface EncounterContrastPair {
  id: string
  theme: EncounterTheme
  foreground: keyof EncounterThemeColors
  background: keyof EncounterThemeColors
  minimum: number
}

export interface EncounterDesignTokens {
  schemaVersion: number
  tokenSetId: string
  source: string
  sourceTicket: string
  themes: Record<EncounterTheme, { colorScheme: EncounterTheme, colors: EncounterThemeColors }>
  contexts: Record<EncounterDesignContext, {
    surfaceOpacity: number
    defaultDensity: EncounterDensity
    displayFamily: 'interface' | 'book'
    worldTreatment: string
  }>
  spacing: Record<string, string>
  radii: Record<string, string>
  borders: Record<string, string>
  elevation: Record<string, string>
  typography: {
    families: Record<'interface' | 'book' | 'numeric', string>
    roles: Record<string, { size: string, lineHeight: number, weight: number, tracking: string }>
  }
  motion: {
    durations: Record<string, string>
    easings: Record<string, string>
    vocabulary: string[]
  }
  density: Record<EncounterDensity, { controlHeight: string, cardPadding: string, regionGap: string }>
  breakpoints: Record<string, string>
  touch: { minimumTarget: string }
  zIndex: Record<string, number>
  contrastPairs: EncounterContrastPair[]
}

export const encounterDesignTokens = rawDesignTokens as EncounterDesignTokens

const parseHex = (value: string): [number, number, number] => {
  const match = /^#([0-9a-f]{6})$/i.exec(value)
  if (!match) throw new Error(`Encounter design colour must be six-digit hex: ${value}`)
  const hex = match[1]!
  return [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number]
}

const linearChannel = (channel: number): number => {
  const normalized = channel / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

export const relativeLuminance = (color: string): number => {
  const [red, green, blue] = parseHex(color).map(linearChannel)
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
}

export const contrastRatio = (foreground: string, background: string): number => {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (light + 0.05) / (dark + 0.05)
}

export interface EncounterContrastResult extends EncounterContrastPair {
  foregroundValue: string
  backgroundValue: string
  ratio: number
  passes: boolean
}

export const evaluateEncounterContrastPairs = (
  tokens: EncounterDesignTokens = encounterDesignTokens,
): EncounterContrastResult[] => tokens.contrastPairs.map((pair) => {
  const colors = tokens.themes[pair.theme].colors
  const foregroundValue = colors[pair.foreground]
  const backgroundValue = colors[pair.background]
  const ratio = contrastRatio(foregroundValue, backgroundValue)
  return {
    ...pair,
    foregroundValue,
    backgroundValue,
    ratio,
    passes: ratio >= pair.minimum,
  }
})

export const assertEncounterDesignTokens = (
  tokens: EncounterDesignTokens = encounterDesignTokens,
): void => {
  if (tokens.schemaVersion !== ENCOUNTER_DESIGN_TOKEN_SCHEMA_VERSION) {
    throw new Error(`Unsupported encounter design token schema ${tokens.schemaVersion}.`)
  }
  if (tokens.tokenSetId !== ENCOUNTER_DESIGN_TOKEN_SET_ID) {
    throw new Error(`Unsupported encounter design token set ${tokens.tokenSetId}.`)
  }
  const failed = evaluateEncounterContrastPairs(tokens).filter(result => !result.passes)
  if (failed.length > 0) {
    throw new Error(`Encounter token contrast failed: ${failed.map(result => result.id).join(', ')}.`)
  }
}
