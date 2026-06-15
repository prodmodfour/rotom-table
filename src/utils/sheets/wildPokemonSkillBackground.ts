import type { CharacterSheetSkillBackground } from '~/types/characterSheet'
import { SHEET_SKILL_ORDER, type PokemonSheetSkillLabel } from './pokemonDerived'

export type WildPokemonSkillLabel = PokemonSheetSkillLabel

export const WILD_POKEMON_SKILL_LABELS: readonly WildPokemonSkillLabel[] = SHEET_SKILL_ORDER.map(([, label]) => label)

const SKILL_ORDER_INDEX = new Map<WildPokemonSkillLabel, number>(
  WILD_POKEMON_SKILL_LABELS.map((skill, index) => [skill, index]),
)

const RAISED_SKILL_FLAVOUR: Record<WildPokemonSkillLabel, { prefix: string; role: string }> = {
  Acrobatics: { prefix: 'Canopy', role: 'Branch-Darter' },
  Athletics: { prefix: 'Rugged', role: 'Trail-Bounder' },
  Charm: { prefix: 'Bright-Crested', role: 'Nest-Caller' },
  Combat: { prefix: 'Territorial', role: 'Den-Scrapper' },
  Command: { prefix: 'Pack-Minded', role: 'Flock-Rallier' },
  'General Ed': { prefix: 'Trailwise', role: 'Old-Path Keeper' },
  'Medicine Ed': { prefix: 'Herbwise', role: 'Berry-Tender' },
  'Occult Ed': { prefix: 'Moonlit', role: 'Omen-Lurker' },
  'Poké Ed': { prefix: 'Kin-Scented', role: 'Pack-Reader' },
  'Tech Ed': { prefix: 'Curious', role: 'Tool-Tapper' },
  Focus: { prefix: 'Still-Eyed', role: 'Stone-Watcher' },
  Guile: { prefix: 'Clever', role: 'Burrow-Trickster' },
  Intimidate: { prefix: 'Bristling', role: 'Ridge-Glower' },
  Intuition: { prefix: 'Windwise', role: 'Gust-Listener' },
  Perception: { prefix: 'Keen-Eyed', role: 'Horizon-Spotter' },
  Stealth: { prefix: 'Shadow-Pawed', role: 'Thicket-Stalker' },
  Survival: { prefix: 'Wildwise', role: 'Wild-Forager' },
}

const LOWERED_SKILL_FLAVOUR: Record<WildPokemonSkillLabel, string> = {
  Acrobatics: 'Grounded',
  Athletics: 'Unhurried',
  Charm: 'Wary',
  Combat: 'Gentle',
  Command: 'Solitary',
  'General Ed': 'Untamed',
  'Medicine Ed': 'Bitterleaf',
  'Occult Ed': 'Sunlit',
  'Poké Ed': 'Lone-Scent',
  'Tech Ed': 'Feral',
  Focus: 'Restless',
  Guile: 'Plain-Trail',
  Intimidate: 'Soft-Eyed',
  Intuition: 'Cautious',
  Perception: 'Close-Trail',
  Stealth: 'Open-Trail',
  Survival: 'Sheltered',
}

export const isWildPokemonSkillLabel = (value: string): value is WildPokemonSkillLabel =>
  SKILL_ORDER_INDEX.has(value as WildPokemonSkillLabel)

const normalizeRaisedPair = (raised: readonly string[]): [WildPokemonSkillLabel, WildPokemonSkillLabel] => {
  if (raised.length !== 2) throw new Error('Wild Pokémon skill background requires exactly two raised skills')

  const normalized = raised.map((skill) => {
    if (!isWildPokemonSkillLabel(skill)) throw new Error(`Unknown Pokémon skill: ${skill}`)
    return skill
  })
  if (normalized[0] === normalized[1]) {
    throw new Error('Wild Pokémon skill background raised skills must be distinct')
  }

  const sorted = [...normalized].sort((a, b) => SKILL_ORDER_INDEX.get(a)! - SKILL_ORDER_INDEX.get(b)!)
  return [sorted[0]!, sorted[1]!]
}

const normalizeLoweredSkill = (
  lowered: string | readonly string[],
  raised: readonly WildPokemonSkillLabel[],
): WildPokemonSkillLabel => {
  const skill = Array.isArray(lowered) ? lowered[0] : lowered
  if (Array.isArray(lowered) && lowered.length !== 1) {
    throw new Error('Wild Pokémon skill background requires exactly one lowered skill')
  }
  if (!isWildPokemonSkillLabel(skill)) throw new Error(`Unknown Pokémon skill: ${skill}`)
  if (raised.includes(skill)) {
    throw new Error('Wild Pokémon skill background lowered skill must not be raised')
  }
  return skill
}

const randomIndex = (length: number, random: () => number): number => {
  const roll = random()
  if (!Number.isFinite(roll)) return 0
  return Math.max(0, Math.min(length - 1, Math.floor(roll * length)))
}

const drawSkill = (pool: WildPokemonSkillLabel[], random: () => number): WildPokemonSkillLabel => {
  const index = randomIndex(pool.length, random)
  const [skill] = pool.splice(index, 1)
  return skill!
}

export const normalizeWildPokemonRaisedSkills = (
  raised: readonly string[],
): [WildPokemonSkillLabel, WildPokemonSkillLabel] => normalizeRaisedPair(raised)

export const wildPokemonSkillBackgroundName = (
  raised: readonly string[],
  lowered: string | readonly string[],
): string => {
  const normalizedRaised = normalizeRaisedPair(raised)
  const normalizedLowered = normalizeLoweredSkill(lowered, normalizedRaised)
  const [firstRaised, secondRaised] = normalizedRaised
  return `${LOWERED_SKILL_FLAVOUR[normalizedLowered]} ${RAISED_SKILL_FLAVOUR[firstRaised].prefix} ${RAISED_SKILL_FLAVOUR[secondRaised].role}`
}

export const rollWildPokemonSkillBackground = (random: () => number): CharacterSheetSkillBackground => {
  const pool = [...WILD_POKEMON_SKILL_LABELS]
  const raised = normalizeRaisedPair([
    drawSkill(pool, random),
    drawSkill(pool, random),
  ])
  const lowered = drawSkill(pool, random)

  return {
    description: wildPokemonSkillBackgroundName(raised, lowered),
    raised,
    lowered: [lowered],
  }
}
