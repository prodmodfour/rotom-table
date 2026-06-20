import type { DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'
import type { PokedexCapabilities, PokedexEvolution, PokedexRecord } from '~/types/pokemon'

// "Capability List" rendered as a sequence of items (mostly RefLinks). Each
// entry has a ``ref`` name (the canonical capability for the link lookup) and
// a ``display`` string (which may include numbers or ``(args)``). Core numeric
// capabilities (Overland/Sky/Swim/Jump/Power/...) resolve to markdown-sourced
// capability definitions for hover tooltips.
export interface CapabilityToken {
  display: string
  /** Link lookup name, or null to render as plain text only. */
  ref: string | null
}

// TM/HM, Egg, and Tutor moves rendered as arrays of link tokens so the
// template can interleave commas between RefLinks.
export interface MoveToken {
  name: string
  display: string
}

export interface DisplayedPokedexEvolution extends PokedexEvolution {
  displaySpecies: string
  displayCondition: string | null
  href: string | null
}

// Skill abbreviations matching the printed book (Athl, Acro, Percep…).
const SKILL_ABBREVIATIONS: Record<string, string> = {
  Athletics: 'Athl',
  Acrobatics: 'Acro',
  Combat: 'Combat',
  Stealth: 'Stealth',
  Perception: 'Percep',
  Focus: 'Focus',
}

export const isPlacementOnlyEntry = (entry: PokedexRecord | null | undefined): boolean => (
  Boolean(entry) && !entry?.base_stats && !entry?.abilities && !entry?.level_up_moves
)

export const genderSummaryForEntry = (entry: PokedexRecord | null | undefined): string | null => {
  if (!entry) return null

  if (entry.genderless) {
    return 'Genderless'
  }

  if (entry.male_pct != null || entry.female_pct != null) {
    return `${entry.male_pct ?? 0}% M / ${entry.female_pct ?? 0}% F`
  }

  return null
}

// One-page index for the bottom-right page number.
export const pageNumberForSelectedEntry = (
  selectedId: string | null | undefined,
  filteredEntries: Array<Pick<DisplayPokedexEntry, 'id'>>,
  allEntries: Array<Pick<DisplayPokedexEntry, 'id'>>,
): number | null => {
  if (!selectedId) return null

  const filteredIndex = filteredEntries.findIndex((entry) => entry.id === selectedId)
  if (filteredIndex >= 0) return filteredIndex + 1

  const allIndex = allEntries.findIndex((entry) => entry.id === selectedId)
  return allIndex >= 0 ? allIndex + 1 : null
}

export const capabilityTokensForEntry = (entry: PokedexRecord | null | undefined): CapabilityToken[] => {
  const capabilities = entry?.capabilities as PokedexCapabilities | undefined
  if (!capabilities) return []

  const numbered: Array<[string, number | string | undefined]> = [
    ['Overland', capabilities.overland],
    ['Sky', capabilities.sky],
    ['Swim', capabilities.swim],
    ['Levitate', capabilities.levitate],
    ['Burrow', capabilities.burrow],
    ['Jump', capabilities.jump],
    ['Power', capabilities.power],
  ]

  const tokens: CapabilityToken[] = []
  for (const [label, value] of numbered) {
    if (value === undefined || value === null || value === 0 || value === '0') continue
    tokens.push({ display: `${label} ${value}`, ref: label })
  }
  for (const extra of capabilities.other ?? []) {
    if (!extra) continue
    // Use the raw label as both display and ref; RefLink will normalise the
    // ref via stripCapabilityParams() / aliases.
    tokens.push({ display: extra, ref: extra })
  }
  return tokens
}

export const tmHmTokensForEntry = (entry: PokedexRecord | null | undefined): MoveToken[] => {
  const moves = entry?.tm_hm_moves
  if (!moves || moves.length === 0) return []

  return moves.map((move) => {
    const prefix = move.kind === 'HM' ? 'H' : ''
    return { name: move.name, display: `${prefix}${move.number} ${move.name}` }
  })
}

export const eggMoveTokensForEntry = (entry: PokedexRecord | null | undefined): MoveToken[] => (
  (entry?.egg_moves ?? []).map((name) => ({ name, display: name }))
)

export const tutorMoveTokensForEntry = (entry: PokedexRecord | null | undefined): MoveToken[] => (
  (entry?.tutor_moves ?? []).map((move) => ({
    name: move.name,
    display: move.heart_scale ? `${move.name} (N)` : move.name,
  }))
)

export const skillPhraseForEntry = (entry: PokedexRecord | null | undefined): string => {
  const skills = entry?.skills
  if (!skills) return ''

  return Object.entries(skills)
    .map(([skill, value]) => `${SKILL_ABBREVIATIONS[skill] ?? skill} ${value}`)
    .join(', ')
}

export const heightLabelForEntry = (entry: PokedexRecord | null | undefined): string | null => {
  if (!entry || entry.height == null) return null

  const meters = entry.height
  const totalInches = meters / 0.0254
  const feet = Math.floor(totalInches / 12)
  const inches = Math.round(totalInches - feet * 12)
  const sizeSuffix = entry.size ? ` (${entry.size})` : ''
  return `${feet}' ${inches}" / ${meters.toFixed(1)}m${sizeSuffix}`
}

export const weightLabelForEntry = (entry: PokedexRecord | null | undefined): string | null => {
  if (!entry || entry.weight == null) return null
  // PTU "weight class" is a small integer; we only know the class number.
  return `Weight Class ${entry.weight}`
}

export const eggGroupSummaryForEntry = (entry: PokedexRecord | null | undefined): string | null => {
  const groups = entry?.egg_groups
  if (!groups || groups.length === 0) return null
  return groups.join(' / ')
}

export const dietSummaryForEntry = (entry: PokedexRecord | null | undefined): string | null => {
  const diet = entry?.diet
  if (!diet || diet.length === 0) return null
  return diet.join(', ')
}

export const habitatSummaryForEntry = (entry: PokedexRecord | null | undefined): string | null => {
  const habitat = entry?.habitat
  if (!habitat || habitat.length === 0) return null
  return habitat.join(', ')
}
