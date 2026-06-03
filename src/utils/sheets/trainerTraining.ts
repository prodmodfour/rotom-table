import type { CharacterSheet } from '~/types/characterSheet'
import type {
  SkillRank,
  TrainerEdgeEntry,
  TrainerFeatureEntry,
  TrainerSheet,
  TrainerSkillKey,
} from '~/types/trainerSheet'
import { SKILL_RANK_TO_VALUE } from '~/utils/skillRanks'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'

export type TrainerTrainingSkillKey = Extract<TrainerSkillKey, 'command' | 'intimidate' | 'generalEd' | 'pokeEd'>

export const TRAINING_SESSION_TARGET_LIMIT = 6

export const TRAINING_SKILL_LABELS: Record<TrainerTrainingSkillKey, string> = {
  command: 'Command',
  intimidate: 'Intimidate',
  generalEd: 'General Ed',
  pokeEd: 'Pokémon Ed',
}

const normalizeName = (value: unknown): string => (
  typeof value === 'string'
    ? value
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*\([^)]*\)\s*$/g, '')
        .toLowerCase()
    : ''
)

const normalizeLooseText = (value: unknown): string => (
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : ''
)

const namedEntry = <T extends { name?: string }>(entries: readonly T[] | undefined, name: string): T | null => {
  const key = normalizeName(name)
  return entries?.find((entry) => normalizeName(entry.name) === key) ?? null
}

export const trainerHasFeatureNamed = (sheet: TrainerSheet, name: string): boolean =>
  Boolean(namedEntry<TrainerFeatureEntry>(sheet.features, name))

export const trainerHasEdgeNamed = (sheet: TrainerSheet, name: string): boolean =>
  Boolean(namedEntry<TrainerEdgeEntry>(sheet.edges, name))

const skillAliases = (skillKey: TrainerTrainingSkillKey): readonly string[] => {
  switch (skillKey) {
    case 'command': return ['command']
    case 'intimidate': return ['intimidate']
    case 'generalEd': return ['general ed', 'general education', 'generaled']
    case 'pokeEd': return ['pokémon ed', 'pokemon ed', 'pokémon education', 'pokemon education', 'poke ed', 'pokeed']
  }
}

const entrySpecializesSkill = (
  entry: TrainerEdgeEntry,
  skillKey: TrainerTrainingSkillKey,
): boolean => {
  if (entry.basicSkill === skillKey) return true

  const name = normalizeLooseText(entry.name)
  const parenthetical = normalizeLooseText(entry.name.match(/\(([^)]*)\)/)?.[1])
  const notes = normalizeLooseText(entry.notes)
  return skillAliases(skillKey).some((alias) => (
    parenthetical === alias ||
    name.includes(` ${alias}`) ||
    notes.includes(alias)
  ))
}

const trainerHasVirtuosoForSkill = (
  sheet: TrainerSheet,
  skillKey: TrainerTrainingSkillKey,
): boolean => Boolean(
  sheet.edges?.some((edge) => normalizeName(edge.name) === 'virtuoso' && entrySpecializesSkill(edge, skillKey)),
)

export const trainerSkillRankValueForTraining = (
  sheet: TrainerSheet,
  skillKey: TrainerTrainingSkillKey = 'command',
): number => {
  const rankValue = resolveTrainerSkills(sheet).find((skill) => skill.key === skillKey)?.rankValue
    ?? SKILL_RANK_TO_VALUE.Untrained
  return trainerHasVirtuosoForSkill(sheet, skillKey) ? Math.max(rankValue, 8) : rankValue
}

export const trainingExperienceBonusForRankValue = (rankValue: number): number => {
  if (rankValue >= 8) return 15
  if (rankValue >= SKILL_RANK_TO_VALUE.Expert) return 10
  if (rankValue >= SKILL_RANK_TO_VALUE.Novice) return 5
  return 0
}

export const trainerExperienceTrainingLimit = (
  sheet: TrainerSheet,
  skillKey: TrainerTrainingSkillKey = 'command',
): number => {
  const baseLimit = trainerSkillRankValueForTraining(sheet, skillKey)
  return trainerHasEdgeNamed(sheet, 'Train the Reserves') ? baseLimit * 2 : baseLimit
}

export const trainerExperienceTrainingBonus = (
  sheet: TrainerSheet,
  skillKey: TrainerTrainingSkillKey = 'command',
): number => {
  const rankBonus = trainingExperienceBonusForRankValue(trainerSkillRankValueForTraining(sheet, skillKey))
  return rankBonus + (trainerHasEdgeNamed(sheet, 'Trainer of Champions') ? 5 : 0)
}

export const pokemonTrainingExperienceGain = (
  sheet: TrainerSheet,
  pokemon: Pick<CharacterSheet, 'level'>,
  skillKey: TrainerTrainingSkillKey = 'command',
): number => Math.floor(Math.max(1, pokemon.level ?? 1) / 2) + trainerExperienceTrainingBonus(sheet, skillKey)

export const trainerSkillRankNameForTraining = (
  sheet: TrainerSheet,
  skillKey: TrainerTrainingSkillKey = 'command',
): SkillRank | 'Virtuoso' => {
  if (trainerHasVirtuosoForSkill(sheet, skillKey)) return 'Virtuoso'
  return resolveTrainerSkills(sheet).find((skill) => skill.key === skillKey)?.rank ?? 'Untrained'
}
