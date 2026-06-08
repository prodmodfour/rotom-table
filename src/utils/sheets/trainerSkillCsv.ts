import type { TrainerSkillKey } from '~/types/trainerSheet'
import { TRAINER_SKILL_ORDER } from '~/utils/sheets/trainerSkillConstants'
import { parseCsvList } from '~/utils/sheets/csvFields'

const TRAINER_SKILL_LABELS_BY_KEY = new Map<TrainerSkillKey, string>(TRAINER_SKILL_ORDER)

const TRAINER_SKILL_EXTRA_ALIASES: Partial<Record<TrainerSkillKey, readonly string[]>> = {
  generalEd: ['General Education', 'Gen Ed'],
  medicineEd: ['Medicine Education', 'Med Ed'],
  occultEd: ['Occult Education'],
  pokeEd: ['Pokemon Ed', 'Pokémon Education', 'Pokemon Education', 'Poke Ed'],
  techEd: ['Tech Ed', 'Technology Education'],
}

export const trainerSkillLabel = (key: TrainerSkillKey): string =>
  TRAINER_SKILL_LABELS_BY_KEY.get(key) ?? key

export const normalizeTrainerSkillToken = (value: string): string =>
  value
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()

const trainerSkillKeyByToken = (() => {
  const lookup = new Map<string, TrainerSkillKey>()

  for (const [key, label] of TRAINER_SKILL_ORDER) {
    const aliases = [key, label, ...(TRAINER_SKILL_EXTRA_ALIASES[key] ?? [])]
    for (const alias of aliases) {
      lookup.set(normalizeTrainerSkillToken(alias), key)
    }
  }

  return lookup
})()

export const trainerSkillKeyFromInput = (value: string): TrainerSkillKey | undefined =>
  trainerSkillKeyByToken.get(normalizeTrainerSkillToken(value))

export const parseTrainerSkillCsvList = (
  raw: string,
  allowedKeys: readonly TrainerSkillKey[],
): TrainerSkillKey[] => {
  const allowed = new Set<TrainerSkillKey>(allowedKeys)
  const parsed: TrainerSkillKey[] = []

  for (const token of parseCsvList(raw)) {
    const key = trainerSkillKeyFromInput(token)
    if (!key || !allowed.has(key) || parsed.includes(key)) continue
    parsed.push(key)
  }

  return parsed
}

export const formatTrainerSkillCsvList = (
  values: readonly TrainerSkillKey[] | null | undefined,
): string => values?.map(trainerSkillLabel).join(', ') ?? ''

export const formatTrainerSkillCsvSingleOrList = (
  value: TrainerSkillKey | readonly TrainerSkillKey[] | null | undefined,
): string => {
  if (!value) return ''
  return typeof value === 'string'
    ? trainerSkillLabel(value)
    : formatTrainerSkillCsvList(value)
}
