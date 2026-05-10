import type { SheetKind } from '~/shared/sheets'

export const sheetEditorPath = (kind: SheetKind, slug: string): string => {
  const encodedSlug = encodeURIComponent(slug)
  return kind === 'trainer' ? `/sheets/trainers/${encodedSlug}` : `/sheets/${encodedSlug}`
}

export const sheetKindLabel = (kind: SheetKind): 'Pokémon' | 'Trainer' =>
  kind === 'pokemon' ? 'Pokémon' : 'Trainer'
