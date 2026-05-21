import { findManeuver, maneuvers, toSlug } from '~~/data/ptuReference'
import type { PtuManeuver } from '~/types/ptuReference'
import type { SheetPlacement } from '~/types/map'
import type { TrainerManeuver, TrainerSheet } from '~/types/trainerSheet'

export type TokenManeuverSource = 'reference' | 'sheet'

export interface TokenManeuverMenuOption {
  name: string
  category: string | null
  action: string | null
  ac: number | string | null
  maneuverClass: string | null
  range: string | null
  trigger: string | null
  effect: string | null
  special: string | null
  source: TokenManeuverSource
  sourceLabel: string
}

export interface MapTokenManeuverSheetLookup {
  trainer?: Map<string, TrainerSheet>
}

const fallback = <T>(...values: T[]): NonNullable<T> | null => {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value as NonNullable<T>
  }
  return null
}

const optionFromReference = (maneuver: PtuManeuver): TokenManeuverMenuOption => ({
  name: maneuver.name,
  category: fallback(maneuver.category),
  action: fallback(maneuver.action),
  ac: fallback(maneuver.ac),
  maneuverClass: fallback(maneuver.maneuver_class),
  range: fallback(maneuver.range),
  trigger: fallback(maneuver.trigger),
  effect: fallback(maneuver.effect),
  special: fallback(maneuver.special),
  source: 'reference',
  sourceLabel: 'Reference',
})

const optionFromSheetManeuver = (
  maneuver: TrainerManeuver,
  reference: PtuManeuver | null = findManeuver(maneuver.name),
): TokenManeuverMenuOption => ({
  name: reference?.name ?? maneuver.name,
  category: fallback(reference?.category, 'Combat Maneuver'),
  action: fallback(maneuver.action, reference?.action),
  ac: fallback(maneuver.ac, reference?.ac),
  maneuverClass: fallback(maneuver.category, reference?.maneuver_class),
  range: fallback(maneuver.range, reference?.range),
  trigger: fallback(reference?.trigger),
  effect: fallback(maneuver.effect, reference?.effect),
  special: fallback(reference?.special),
  source: 'sheet',
  sourceLabel: 'Sheet Maneuver',
})

const addDedupedOption = (
  target: Map<string, TokenManeuverMenuOption>,
  option: TokenManeuverMenuOption,
) => {
  const key = toSlug(option.name)
  if (!key) return
  target.set(key, option)
}

export const referenceManeuverOptions = (): TokenManeuverMenuOption[] =>
  maneuvers.map(optionFromReference)

export const trainerManeuverOptionsForSheet = (sheet: TrainerSheet | null | undefined): TokenManeuverMenuOption[] => {
  const optionsBySlug = new Map<string, TokenManeuverMenuOption>()
  for (const maneuver of referenceManeuverOptions()) addDedupedOption(optionsBySlug, maneuver)
  for (const maneuver of sheet?.maneuvers ?? []) addDedupedOption(optionsBySlug, optionFromSheetManeuver(maneuver))
  return [...optionsBySlug.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export const maneuverOptionsForPlacement = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'> | null | undefined,
  sheets: MapTokenManeuverSheetLookup,
): TokenManeuverMenuOption[] => {
  if (!placement) return []
  if (placement.sheetKind !== 'trainer') return referenceManeuverOptions()

  return trainerManeuverOptionsForSheet(sheets.trainer?.get(placement.sheetSlug))
}
