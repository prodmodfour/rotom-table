import { referenceDetailPath } from '~/utils/reference/routes'

export type PokedexReferenceKind = 'move' | 'ability' | 'capability'

const REFERENCE_SLUG_ALIASES: Partial<Record<PokedexReferenceKind, Record<string, string>>> = {
  move: {
    'struggle-materialiser': 'struggle-materializer',
  },
  capability: {
    mountable: 'mountable-x',
    teleporter: 'teleporter-x',
    materialiser: 'materializer',
    'aura-reader': 'aura-reader',
  },
}

export const toPokedexReferenceSlug = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['\u2019]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const stripParenthetical = (value: string): string => value
  .replace(/\s*\([^)]*\)\s*$/g, '')
  .trim()

const stripCapabilityParams = (value: string): string => stripParenthetical(value)
  .replace(/\s+\d+(?:\/\d+)?\s*$/g, '')
  .trim()
  // Reverse soft-hyphen splits like "Mount able".
  .replace(/([a-z])\s+([a-z])/g, '$1$2')

export const normalizePokedexReferenceName = (
  kind: PokedexReferenceKind,
  name: string,
): string => {
  if (kind === 'ability') return stripParenthetical(name)
  if (kind === 'capability') return stripCapabilityParams(name)
  return name.trim()
}

export const pokedexReferencePath = (
  kind: PokedexReferenceKind,
  name: string,
): string | null => {
  const normalizedName = normalizePokedexReferenceName(kind, name)
  const slug = toPokedexReferenceSlug(normalizedName)
  if (!slug) return null

  return referenceDetailPath(kind, REFERENCE_SLUG_ALIASES[kind]?.[slug] ?? slug)
}
