import type { RefKind } from '~~/data/ptuReference'

export const REFERENCE_PATH_BY_KIND = {
  move: '/moves',
  ability: '/abilities',
  capability: '/capabilities',
  condition: '/conditions',
  rule: '/rules',
  feature: '/features',
  edge: '/edges',
  item: '/items',
} as const satisfies Record<RefKind, string>

export const REFERENCE_PLURAL_LABEL_BY_KIND = {
  move: 'Moves',
  ability: 'Abilities',
  capability: 'Capabilities',
  condition: 'Conditions',
  rule: 'Rules',
  feature: 'Features',
  edge: 'Edges',
  item: 'Items',
} as const satisfies Record<RefKind, string>

export const referenceIndexPath = (kind: RefKind): string => REFERENCE_PATH_BY_KIND[kind]

export const referenceDetailPath = (kind: RefKind, slug: string): string =>
  `${referenceIndexPath(kind)}/${encodeURIComponent(slug)}`

export const referenceDetailPathOrNull = (kind: RefKind, slug: string | null | undefined): string | null =>
  slug ? referenceDetailPath(kind, slug) : null

export const referencePluralLabel = (kind: RefKind): string => REFERENCE_PLURAL_LABEL_BY_KIND[kind]

export const referenceAllBackLabel = (kind: RefKind): string => `← All ${referencePluralLabel(kind).toLowerCase()}`

export const referenceNotFoundBackLabel = (kind: RefKind): string => `← Back to all ${referencePluralLabel(kind).toLowerCase()}`
