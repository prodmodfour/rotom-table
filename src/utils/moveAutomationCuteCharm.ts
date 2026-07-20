import { CUTE_CHARM_ABILITY_NAME } from '#shared/abilityAutomation/legacyNames'
import { sheetHasCanonicalAbility } from '~/utils/sheetAbilities'
import {
  conditionBaseName,
  formatInfatuationCondition,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import type {
  MoveAutomationConditionUpdate,
  MoveAutomationCuteCharmPrompt,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export type CuteCharmGender = 'Male' | 'Female'

const normalizeMoveKey = (value: unknown): string => typeof value === 'string'
  ? value.trim().toLowerCase()
  : ''

export const normalizeCuteCharmGender = (value: unknown): CuteCharmGender | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (['m', 'male', 'man', 'boy', '♂'].includes(normalized)) return 'Male'
  if (['f', 'female', 'woman', 'girl', '♀'].includes(normalized)) return 'Female'
  return null
}

export const cuteCharmGendersAreOpposite = (left: unknown, right: unknown): boolean => {
  const leftGender = normalizeCuteCharmGender(left)
  const rightGender = normalizeCuteCharmGender(right)
  return Boolean(leftGender && rightGender && leftGender !== rightGender)
}

export const tokenHasCuteCharm = (
  token: Pick<SpawnedPokemon, 'abilityNames'>,
): boolean => sheetHasCanonicalAbility(token.abilityNames, CUTE_CHARM_ABILITY_NAME)

export const tokenHasInfatuation = (
  token: Pick<SpawnedPokemon, 'conditions'>,
): boolean => normalizeConditionNames(token.conditions)
  .some((condition) => conditionBaseName(condition) === 'Infatuation')

export const tokenCanCuteCharmAttacker = (
  defender: Pick<SpawnedPokemon, 'abilityNames' | 'gender'>,
  attacker: Pick<SpawnedPokemon, 'conditions' | 'gender'>,
): boolean => tokenHasCuteCharm(defender)
  && cuteCharmGendersAreOpposite(defender.gender, attacker.gender)
  && !tokenHasInfatuation(attacker)

export const cuteCharmReactionPromptKey = (
  prompt: Pick<MoveAutomationCuteCharmPrompt, 'defenderId' | 'attackerId' | 'moveName'>,
): string => [prompt.defenderId, prompt.attackerId, normalizeMoveKey(prompt.moveName)].join('|')

const defaultCuteCharmPromptId = (prompt: Omit<MoveAutomationCuteCharmPrompt, 'id'>): string => [
  'cute-charm',
  prompt.defenderId,
  prompt.attackerId,
  normalizeMoveKey(prompt.moveName).replace(/[^a-z0-9]+/g, '-') || 'move',
].join('-')

export interface BuildCuteCharmReactionPromptsInput {
  attacker: SpawnedPokemon
  moveName: string
  attackedTargets: readonly SpawnedPokemon[]
  existingPrompts?: readonly MoveAutomationCuteCharmPrompt[]
  idFactory?: (prompt: Omit<MoveAutomationCuteCharmPrompt, 'id'>) => string
}

export const buildCuteCharmReactionPrompts = ({
  attacker,
  moveName,
  attackedTargets,
  existingPrompts = [],
  idFactory = defaultCuteCharmPromptId,
}: BuildCuteCharmReactionPromptsInput): MoveAutomationCuteCharmPrompt[] => {
  if (!moveName.trim()) return []

  const seen = new Set(existingPrompts.map(cuteCharmReactionPromptKey))
  const prompts: MoveAutomationCuteCharmPrompt[] = []

  for (const defender of attackedTargets) {
    if (defender.id === attacker.id) continue
    if (!tokenCanCuteCharmAttacker(defender, attacker)) continue

    const withoutId = {
      defenderId: defender.id,
      defenderName: defender.species,
      attackerId: attacker.id,
      attackerName: attacker.species,
      moveName,
    }
    const key = cuteCharmReactionPromptKey(withoutId)
    if (seen.has(key)) continue

    seen.add(key)
    prompts.push({
      id: idFactory(withoutId),
      ...withoutId,
    })
  }

  return prompts
}

export const buildCuteCharmReactionConditionUpdate = (
  attacker: SpawnedPokemon,
  defender: SpawnedPokemon,
): MoveAutomationConditionUpdate | null => {
  if (!tokenCanCuteCharmAttacker(defender, attacker)) return null
  return {
    id: attacker.id,
    conditions: normalizeConditionNames([
      ...attacker.conditions,
      formatInfatuationCondition(defender.species),
    ]),
  }
}
