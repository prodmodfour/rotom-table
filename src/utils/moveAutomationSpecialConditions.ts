import { conditionLookupKey, normalizeConditionName } from '~/utils/statusConditions'

export const HELPING_HAND_CONDITION = 'Helping Hand'
export const YAWN_CONDITION = 'Yawn'
export const SUPERSONIC_ACCURACY_PENALTY_CONDITION = 'Supersonic Accuracy Penalty'
export const ELECTRIC_RESISTANT_COAT_CONDITION = 'Electric-Resistant Coat'
export const REFLECT_BLESSING_CONDITION = 'Reflect Blessing'
export const SWEET_SCENT_EVASION_PENALTY_CONDITION = 'Sweet Scent Evasion Penalty'

export const ROOST_GROUNDED_CONDITION = 'Roost Grounded'
export const SMACK_DOWN_GROUNDED_CONDITION = 'Smack Down Grounded'
export const GROUNDSOURCE_IMMUNITY_SUPPRESSED_CONDITION = 'Groundsource Immunity Suppressed'

export const GROUNDSOURCE_IMMUNITY_SUPPRESSION_CONDITIONS = [
  ROOST_GROUNDED_CONDITION,
  SMACK_DOWN_GROUNDED_CONDITION,
  GROUNDSOURCE_IMMUNITY_SUPPRESSED_CONDITION,
] as const

const MOVE_AUTOMATION_SPECIAL_CONDITIONS = [
  HELPING_HAND_CONDITION,
  YAWN_CONDITION,
  SUPERSONIC_ACCURACY_PENALTY_CONDITION,
  ELECTRIC_RESISTANT_COAT_CONDITION,
  REFLECT_BLESSING_CONDITION,
  SWEET_SCENT_EVASION_PENALTY_CONDITION,
  ...GROUNDSOURCE_IMMUNITY_SUPPRESSION_CONDITIONS,
] as const

const specialConditionByLookupKey = new Map(
  MOVE_AUTOMATION_SPECIAL_CONDITIONS.map((condition) => [conditionLookupKey(condition), condition]),
)

export const normalizeMoveAutomationSpecialConditionName = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const canonical = normalizeConditionName(raw)
  if (canonical) return canonical
  return specialConditionByLookupKey.get(conditionLookupKey(raw)) ?? null
}
