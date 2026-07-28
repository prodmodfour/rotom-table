export type CapabilityArtSize = 'sm' | 'md' | 'lg' | 'hero'

export interface CapabilityArtDefinition {
  /** Deep background color for the square badge. */
  color: string
  /** Bright accent used for glows/details. */
  accent: string
  /** Hand-authored SVG motif rendered in the badge center. */
  icon: string
  /** Optional short mark shown at the badge foot. */
  label?: string
}

export interface CapabilityArtFallbackPalette {
  backgrounds: readonly string[]
  accents: readonly string[]
}

export const CAPABILITY_ART_SIZE_PX: Record<CapabilityArtSize, number> = {
  sm: 62,
  md: 84,
  lg: 116,
  hero: 210,
}

export const escapeCapabilityArtXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export const capabilityArtInitials = (name: string): string => {
  const parts = name
    .replace(/X-Ray/i, 'X Ray')
    .split(/[^A-Za-z0-9Δ₽]+/)
    .filter(Boolean)
  if (!parts.length) return 'CAP'
  if (parts.length === 1) return parts[0]!.slice(0, 3).toUpperCase()
  return parts.map((part) => part[0]!).join('').slice(0, 3).toUpperCase()
}

export const hashCapabilityArtName = (name: string): number => {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash
}

export const fallbackCapabilityArt = (
  name: string,
  palette: CapabilityArtFallbackPalette,
): CapabilityArtDefinition => {
  const backgrounds = palette.backgrounds.length ? palette.backgrounds : ['#12151b']
  const accents = palette.accents.length ? palette.accents : ['#ff1f2d']
  const hash = hashCapabilityArtName(name)
  return {
    color: backgrounds[hash % backgrounds.length] ?? '#12151b',
    accent: accents[(hash >>> 3) % accents.length] ?? '#ff1f2d',
    icon: 'generic',
    label: capabilityArtInitials(name),
  }
}

export type CapabilityArtLookup = (name: string) => boolean

const CAPABILITY_ART_ALIASES: Record<string, string> = {
  Mountable: 'Mountable X',
  'Throw Range': 'Throwing Range',
  Materialiser: 'Materializer',
  materialiser: 'Materializer',
  'Aura  Reader': 'Aura Reader',
}

export const normalizeCapabilityArtName = (raw: string, hasArt: CapabilityArtLookup): string => {
  const trimmed = raw.trim()
  let name = trimmed
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+\d+(?:\/\d+)?\s*$/g, '')
    .trim()
    .replace(/([a-z])\s+([a-z])/g, '$1$2')

  if (hasArt(trimmed)) return trimmed
  name = CAPABILITY_ART_ALIASES[name] ?? name
  return hasArt(name) ? name : trimmed
}
