import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

export const DEFAULT_TRAINER_ACCENT_COLOR = '#ff1f2d'

export const TRAINER_ACCENT_CSS_VARIABLE_NAMES = [
  '--accent',
  '--accent-rgb',
  '--accent-soft',
  '--accent-muted',
  '--rule-active',
  '--paper-active',
] as const

const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{6})$/

interface RgbColor {
  r: number
  g: number
  b: number
}

const clampChannel = (value: number): number => Math.min(255, Math.max(0, Math.round(value)))

const scaleChannel = (value: number, factor: number): number => clampChannel(value * factor)

const rgbToHex = ({ r, g, b }: RgbColor): string => (
  `#${[r, g, b].map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`
)

const hexToRgb = (hex: string): RgbColor => {
  const value = Number.parseInt(hex.slice(1), 16)
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  }
}

const scaleRgb = (rgb: RgbColor, factor: number): RgbColor => ({
  r: scaleChannel(rgb.r, factor),
  g: scaleChannel(rgb.g, factor),
  b: scaleChannel(rgb.b, factor),
})

export const normalizeTrainerAccentColor = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const match = HEX_COLOR_PATTERN.exec(value.trim())
  return match ? `#${match[1].toLowerCase()}` : null
}

const normalizedLinkedPokemonSlugs = (
  trainer: Pick<TrainerSheet, 'currentTeam' | 'boxedPokemon'>,
): Set<string> => new Set([
  ...(trainer.currentTeam ?? []),
  ...(trainer.boxedPokemon ?? []),
].map((slug) => slug.trim()).filter(Boolean))

export const trainerLinksPokemonSlug = (
  trainer: Pick<TrainerSheet, 'currentTeam' | 'boxedPokemon'>,
  pokemonSlug: string,
): boolean => normalizedLinkedPokemonSlugs(trainer).has(pokemonSlug.trim())

export const trainerAccentColorForPokemonSlug = (
  trainers: Iterable<TrainerSheet>,
  pokemonSlug: string,
): string | null => {
  const slug = pokemonSlug.trim()
  if (!slug) return null

  let linkedTrainerWithoutCustomAccent: TrainerSheet | null = null
  for (const trainer of trainers) {
    if (!trainerLinksPokemonSlug(trainer, slug)) continue
    const accentColor = normalizeTrainerAccentColor(trainer.accentColor)
    if (accentColor) return accentColor
    linkedTrainerWithoutCustomAccent ??= trainer
  }

  return linkedTrainerWithoutCustomAccent ? DEFAULT_TRAINER_ACCENT_COLOR : null
}

export const trainerAccentColorForPokemonSheet = (
  trainers: Iterable<TrainerSheet>,
  sheet: Pick<CharacterSheet, 'slug'> | null | undefined,
): string | null => sheet ? trainerAccentColorForPokemonSlug(trainers, sheet.slug) : null

export const trainerAccentCssVariables = (value: unknown): Record<string, string> => {
  const color = normalizeTrainerAccentColor(value) ?? DEFAULT_TRAINER_ACCENT_COLOR
  const rgb = hexToRgb(color)
  const rgbChannels = `${rgb.r}, ${rgb.g}, ${rgb.b}`

  return {
    '--accent': color,
    '--accent-rgb': rgbChannels,
    '--accent-soft': `rgba(${rgbChannels}, 0.16)`,
    '--accent-muted': rgbToHex(scaleRgb(rgb, 0.72)),
    '--rule-active': `rgba(${rgbChannels}, 0.68)`,
    '--paper-active': `rgba(${rgbChannels}, 0.12)`,
  }
}

export const setTrainerAccentCssVariables = (
  style: CSSStyleDeclaration,
  value: unknown,
): void => {
  for (const [property, propertyValue] of Object.entries(trainerAccentCssVariables(value))) {
    if (typeof style.setProperty === 'function') style.setProperty(property, propertyValue)
    else (style as unknown as Record<string, string>)[property] = propertyValue
  }
}

export const clearTrainerAccentCssVariables = (style: CSSStyleDeclaration): void => {
  for (const property of TRAINER_ACCENT_CSS_VARIABLE_NAMES) {
    if (typeof style.removeProperty === 'function') style.removeProperty(property)
    else delete (style as unknown as Record<string, string>)[property]
  }
}
