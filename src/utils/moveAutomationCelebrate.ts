import { CELEBRATE_ABILITY_NAME } from '#shared/abilityAutomation/legacyNames'
import { resolveMapAbilityAutomationTransaction } from '~/utils/abilityAutomationLegacyCompatibility'
import { sheetHasCanonicalAbility } from '~/utils/sheetAbilities'
import type { AbilityAutomationTransaction } from '~/types/abilityAutomation'
import type { MoveAutomationCelebratePrompt } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const normalizeMoveKey = (value: unknown): string => typeof value === 'string'
  ? value.trim().toLowerCase()
  : ''

export const tokenHasCelebrate = (
  token: Pick<SpawnedPokemon, 'abilityNames'>,
): boolean => sheetHasCanonicalAbility(token.abilityNames, CELEBRATE_ABILITY_NAME)

export const celebrateTriggerPromptKey = (
  prompt: Pick<MoveAutomationCelebratePrompt, 'attackerId' | 'moveName' | 'hitTargetIds'>,
): string => [
  prompt.attackerId,
  normalizeMoveKey(prompt.moveName),
  ...[...prompt.hitTargetIds].sort(),
].join('|')

const defaultCelebratePromptId = (prompt: Omit<MoveAutomationCelebratePrompt, 'id'>): string => [
  'celebrate',
  prompt.attackerId,
  normalizeMoveKey(prompt.moveName).replace(/[^a-z0-9]+/g, '-') || 'move',
].join('-')

export interface BuildCelebrateTriggerPromptsInput {
  attacker: SpawnedPokemon
  moveName: string
  damaging: boolean
  hitTargets: readonly SpawnedPokemon[]
  existingPrompts?: readonly MoveAutomationCelebratePrompt[]
  idFactory?: (prompt: Omit<MoveAutomationCelebratePrompt, 'id'>) => string
}

export const buildCelebrateTriggerPrompts = ({
  attacker,
  moveName,
  damaging,
  hitTargets,
  existingPrompts = [],
  idFactory = defaultCelebratePromptId,
}: BuildCelebrateTriggerPromptsInput): MoveAutomationCelebratePrompt[] => {
  if (!damaging || !moveName.trim() || !tokenHasCelebrate(attacker)) return []

  const eligibleHitTargets = hitTargets.filter((target) => target.id !== attacker.id)
  if (!eligibleHitTargets.length) return []

  const withoutId: Omit<MoveAutomationCelebratePrompt, 'id'> = {
    attackerId: attacker.id,
    attackerName: attacker.species,
    moveName,
    hitTargetIds: eligibleHitTargets.map((target) => target.id),
    hitTargetNames: eligibleHitTargets.map((target) => target.species),
  }

  const key = celebrateTriggerPromptKey(withoutId)
  if (existingPrompts.some((prompt) => celebrateTriggerPromptKey(prompt) === key)) return []

  return [{ id: idFactory(withoutId), ...withoutId }]
}

export const buildCelebrateTriggerTransaction = (
  attacker: SpawnedPokemon,
  target?: SpawnedPokemon | null,
): AbilityAutomationTransaction | null => resolveMapAbilityAutomationTransaction({
  abilityName: CELEBRATE_ABILITY_NAME,
  user: attacker,
  target,
})
