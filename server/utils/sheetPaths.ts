import { relative, sep } from 'node:path'
import { SHEET_KINDS, type SheetKind } from '#shared/sheets'
import { CAMPAIGN_POKEMON_SHEETS_ROOT, CAMPAIGN_TRAINER_SHEETS_ROOT } from './campaignPaths'

export { SHEET_KINDS, isSheetKind, type SheetKind } from '#shared/sheets'

export interface SheetKindConfig {
  kind: SheetKind
  root: string
  defaultBaseSlug: string
  displayName: string
}

export const SHEET_KIND_CONFIG: Record<SheetKind, SheetKindConfig> = {
  pokemon: {
    kind: 'pokemon',
    root: CAMPAIGN_POKEMON_SHEETS_ROOT,
    defaultBaseSlug: 'new-pokemon',
    displayName: 'Pokémon',
  },
  trainer: {
    kind: 'trainer',
    root: CAMPAIGN_TRAINER_SHEETS_ROOT,
    defaultBaseSlug: 'new-trainer',
    displayName: 'Trainer',
  },
}

export const sheetRootFor = (kind: SheetKind): string => SHEET_KIND_CONFIG[kind].root

export const sheetRoots = (kind?: SheetKind): string[] =>
  kind ? [sheetRootFor(kind)] : SHEET_KINDS.map(sheetRootFor)

export const folderFromSheetPath = (kind: SheetKind, filePath: string): string => {
  const rel = relative(sheetRootFor(kind), filePath).split(sep).join('/')
  const lastSlash = rel.lastIndexOf('/')
  if (lastSlash === -1) return ''
  return rel.slice(0, lastSlash)
}
