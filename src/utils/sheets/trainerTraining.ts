import type { CharacterSheet, PokemonTrainedStatKey } from '~/types/characterSheet'
import type {
  SkillRank,
  TrainerSheet,
  TrainerSkillKey,
} from '~/types/trainerSheet'
import { SKILL_RANK_TO_VALUE } from '~/utils/skillRanks'
import { parseFeatureLabel } from '#shared/featureAutomation/catalog'
import { resolvedSheetFeatureClosure, resolvedSheetFeatureInstances, sheetHasCanonicalFeature } from '#shared/featureAutomation/sheetFeatures'
import { normalizePokemonTrainingFeatureName } from '~/utils/sheets/pokemonTrainingFeatures'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { parseEdgeLabel } from '#shared/edgeAutomation/catalog'
import { edgeChoiceValues, resolveEdgeInstance } from '#shared/edgeAutomation/instances'
import { sheetHasCanonicalEdge } from '#shared/edgeAutomation/sheetEdges'

export type TrainerTrainingSkillKey = Extract<TrainerSkillKey, 'command' | 'intimidate' | 'generalEd' | 'pokeEd'>
export type AceTrainerStatKey = PokemonTrainedStatKey

export const TRAINING_SESSION_TARGET_LIMIT = 6

export const ACE_TRAINER_STAT_OPTIONS = [
  { key: 'atk', label: 'Attack' },
  { key: 'def', label: 'Defense' },
  { key: 'satk', label: 'Sp. Atk' },
  { key: 'sdef', label: 'Sp. Def' },
  { key: 'spd', label: 'Speed' },
] as const satisfies readonly { key: AceTrainerStatKey; label: string }[]

export const TRAINING_SKILL_LABELS: Record<TrainerTrainingSkillKey, string> = {
  command: 'Command',
  intimidate: 'Intimidate',
  generalEd: 'General Ed',
  pokeEd: 'Pokémon Ed',
}

export const trainerHasFeatureNamed = (sheet: TrainerSheet, name: string): boolean => {
  const canonicalId = parseFeatureLabel(name).canonicalId
  return canonicalId ? sheetHasCanonicalFeature(sheet, canonicalId) : false
}

export const trainerHasClassNamed = (sheet: TrainerSheet, name: string): boolean => {
  const canonicalId = parseFeatureLabel(name).canonicalId
  return canonicalId ? resolvedSheetFeatureInstances(sheet).some(row => row.collection === 'classes' && row.status === 'ready' && row.data?.canonicalId === canonicalId) : false
}

export const trainerHasEdgeNamed = (sheet: TrainerSheet, name: string): boolean => {
  const canonicalId = parseEdgeLabel('trainer', name).canonicalId
  return canonicalId ? sheetHasCanonicalEdge(sheet, 'trainer', canonicalId) : false
}

/** Ace Trainer permits selecting a Trained Stat during a training session. */
export const trainerCanApplyAceTrainerTraining = (sheet: TrainerSheet): boolean =>
  trainerHasFeatureNamed(sheet, 'Ace Trainer') || trainerHasClassNamed(sheet, 'Ace Trainer')

/** Elite Trainer permits using multiple Training Features during a training session. */
export const trainerCanSelectPerPokemonTrainingFeatures = (sheet: TrainerSheet): boolean =>
  trainerHasFeatureNamed(sheet, 'Elite Trainer')

export const trainerOwnedPokemonTrainingFeatures = (sheet: TrainerSheet): ReadonlySet<string> => {
  const owned = new Set<string>()
  const add = (value: unknown): void => {
    const feature = normalizePokemonTrainingFeatureName(value)
    if (feature) owned.add(feature)
  }

  for (const source of resolvedSheetFeatureClosure(sheet)) add(source.canonicalId)
  for (const order of sheet.orders ?? []) add(order.name)
  add(sheet.trainingFeature)

  return owned
}

const ACE_TRAINER_STAT_LABELS = new Map<AceTrainerStatKey, string>(
  ACE_TRAINER_STAT_OPTIONS.map((option) => [option.key, option.label]),
)

const normalizeStatKeyText = (value: unknown): string => (
  typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
    : ''
)

const ACE_TRAINER_STAT_ALIASES: Record<string, AceTrainerStatKey> = {
  atk: 'atk',
  attack: 'atk',
  def: 'def',
  defense: 'def',
  defence: 'def',
  satk: 'satk',
  spatk: 'satk',
  'sp atk': 'satk',
  'special atk': 'satk',
  'special attack': 'satk',
  sdef: 'sdef',
  spdef: 'sdef',
  'sp def': 'sdef',
  'special def': 'sdef',
  'special defense': 'sdef',
  'special defence': 'sdef',
  spd: 'spd',
  speed: 'spd',
}

export const normalizeAceTrainerStatKey = (value: unknown): AceTrainerStatKey | null => {
  const key = normalizeStatKeyText(value)
  if (!key || key === 'hp') return null
  return ACE_TRAINER_STAT_ALIASES[key] ?? null
}

export const aceTrainerStatLabel = (value: unknown): string => {
  const key = normalizeAceTrainerStatKey(value)
  return key ? ACE_TRAINER_STAT_LABELS.get(key) ?? key : '—'
}

export const applyAceTrainerTrainedStat = (
  pokemon: CharacterSheet,
  value: unknown,
): AceTrainerStatKey | null => {
  const trainedStat = normalizeAceTrainerStatKey(value)
  if (!trainedStat) return null

  const previousStat = normalizeAceTrainerStatKey(pokemon.trainedStat)
  pokemon.trainedStat = trainedStat
  pokemon.stats ??= {}

  if (previousStat && previousStat !== trainedStat && pokemon.stats[previousStat]?.stage === 1) {
    pokemon.stats[previousStat] = {
      ...pokemon.stats[previousStat],
      stage: 0,
    }
  }

  const currentRow = pokemon.stats[trainedStat] ?? {}
  const currentStage = typeof currentRow.stage === 'number' && Number.isFinite(currentRow.stage)
    ? currentRow.stage
    : 0
  pokemon.stats[trainedStat] = {
    ...currentRow,
    stage: Math.max(1, currentStage),
  }

  return trainedStat
}

const trainerHasVirtuosoForSkill = (
  sheet: TrainerSheet,
  skillKey: TrainerTrainingSkillKey,
): boolean => (sheet.edges ?? []).some((edge, index) => {
  const resolved = resolveEdgeInstance({ family: 'trainer', entry: edge, ownerId: sheet.slug, index })
  return resolved.status === 'ready' && resolved.data?.canonicalId === 'Virtuoso'
    && edgeChoiceValues(resolved.data, 'skill').includes(skillKey)
})

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
): number => Math.max(
  1,
  Math.floor(Math.max(1, pokemon.level ?? 1) / 2) + trainerExperienceTrainingBonus(sheet, skillKey),
)

export const trainerSkillRankNameForTraining = (
  sheet: TrainerSheet,
  skillKey: TrainerTrainingSkillKey = 'command',
): SkillRank | 'Virtuoso' => {
  if (trainerHasVirtuosoForSkill(sheet, skillKey)) return 'Virtuoso'
  return resolveTrainerSkills(sheet).find((skill) => skill.key === skillKey)?.rank ?? 'Untrained'
}
