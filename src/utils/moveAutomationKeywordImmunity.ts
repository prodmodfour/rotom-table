import {
  GROUNDSOURCE_IMMUNITY_SUPPRESSION_CONDITIONS,
  normalizeMoveAutomationSpecialConditionName,
} from '~/utils/moveAutomationSpecialConditions'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export const POWDER_KEYWORD = 'Powder'
export const POWDER_IMMUNITY_SOURCE = 'Grass type (Powder)'

const GROUNDSOURCE_KEYWORD = 'Groundsource'

export type MoveAutomationKeywordImmunityTarget = Pick<SpawnedPokemon, 'defenderTypes' | 'conditions'>

export const normalizeMoveAutomationKeyword = (keyword: string): string =>
  keyword.trim().replace(/\s+/g, ' ').toLowerCase()

export const moveAutomationKeywordsInclude = (
  moveKeywords: readonly string[] | null | undefined,
  keyword: string,
): boolean => (moveKeywords ?? []).some((entry) => normalizeMoveAutomationKeyword(entry) === normalizeMoveAutomationKeyword(keyword))

export const moveAutomationMoveHasPowderKeyword = (
  moveKeywords: readonly string[] | null | undefined,
): boolean => moveAutomationKeywordsInclude(moveKeywords, POWDER_KEYWORD)

export const moveAutomationScriptHasPowderKeyword = (
  script: Pick<MoveAutomationScript, 'keywords'> | null | undefined,
): boolean => moveAutomationMoveHasPowderKeyword(script?.keywords)

const targetHasDefenderType = (
  target: Pick<SpawnedPokemon, 'defenderTypes'>,
  type: string,
): boolean => target.defenderTypes.some((entry) => entry.trim().toLowerCase() === type.toLowerCase())

export const moveAutomationTargetHasPowderImmunity = (
  target: Pick<SpawnedPokemon, 'defenderTypes'>,
): boolean => targetHasDefenderType(target, 'Grass')

export const moveAutomationPowderImmunitySource = (
  script: Pick<MoveAutomationScript, 'keywords'> | null | undefined,
  target: Pick<SpawnedPokemon, 'defenderTypes'>,
): string | null => moveAutomationScriptHasPowderKeyword(script) && moveAutomationTargetHasPowderImmunity(target)
  ? POWDER_IMMUNITY_SOURCE
  : null

export const moveAutomationGroundsourceImmunitySuppressionSource = (
  target: Pick<SpawnedPokemon, 'conditions'>,
): string | null => {
  for (const condition of target.conditions ?? []) {
    const normalized = normalizeMoveAutomationSpecialConditionName(condition)
    if (normalized && GROUNDSOURCE_IMMUNITY_SUPPRESSION_CONDITIONS.includes(
      normalized as (typeof GROUNDSOURCE_IMMUNITY_SUPPRESSION_CONDITIONS)[number],
    )) return normalized
  }
  return null
}

export const moveAutomationTargetSuppressesGroundsourceImmunity = (
  target: Pick<SpawnedPokemon, 'conditions'>,
): boolean => moveAutomationGroundsourceImmunitySuppressionSource(target) != null

export const moveAutomationPassiveImmunityKeywordsForTarget = (
  moveKeywords: readonly string[] | null | undefined,
  target: MoveAutomationKeywordImmunityTarget,
  options: { readonly suppressGroundsourceImmunity?: boolean } = {},
): readonly string[] | null | undefined => {
  if (!moveAutomationKeywordsInclude(moveKeywords, GROUNDSOURCE_KEYWORD)) return moveKeywords
  if (
    !options.suppressGroundsourceImmunity
    && !moveAutomationTargetSuppressesGroundsourceImmunity(target)
  ) return moveKeywords
  return (moveKeywords ?? []).filter((keyword) => (
    !moveAutomationKeywordsInclude([keyword], GROUNDSOURCE_KEYWORD)
  ))
}
