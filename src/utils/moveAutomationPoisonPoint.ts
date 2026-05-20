import { POISON_POINT_ABILITY_NAME } from '~/utils/abilityAutomation'
import { moveAutomationConditionImmunitySource } from '~/utils/moveAutomationConditionImmunity'
import { sheetHasCanonicalAbility } from '~/utils/sheetAbilities'
import {
  conditionBaseName,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import type {
  MoveAutomationConditionUpdate,
  MoveAutomationPoisonPointPrompt,
  MoveAutomationScript,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const POISONED_CONDITION_NAME = 'Poisoned'
const BADLY_POISONED_CONDITION_NAME = 'Badly Poisoned'
const POISON_AFFLICTION_NAMES = new Set([POISONED_CONDITION_NAME, BADLY_POISONED_CONDITION_NAME])

const normalizeMoveKey = (value: unknown): string => typeof value === 'string'
  ? value.trim().toLowerCase()
  : ''

const isMeleeKeyword = (keyword: string): boolean => /^Melee$/i.test(keyword.trim())

export const isPoisonPointTriggeringMove = (
  script: Pick<MoveAutomationScript, 'range' | 'keywords'> | null | undefined,
): boolean => Boolean(script && (
  script.keywords.some(isMeleeKeyword)
  || /\bMelee\b/i.test(script.range)
))

export const tokenHasPoisonPoint = (
  token: Pick<SpawnedPokemon, 'abilityNames'>,
): boolean => sheetHasCanonicalAbility(token.abilityNames, POISON_POINT_ABILITY_NAME)

export const tokenHasPoisonAffliction = (
  token: Pick<SpawnedPokemon, 'conditions'>,
): boolean => normalizeConditionNames(token.conditions)
  .some((condition) => POISON_AFFLICTION_NAMES.has(conditionBaseName(condition) ?? condition))

export const poisonPointAttackerBlockSource = (attacker: SpawnedPokemon): string | null => {
  if (tokenHasPoisonAffliction(attacker)) return POISONED_CONDITION_NAME
  return moveAutomationConditionImmunitySource(POISONED_CONDITION_NAME, attacker)
}

export const tokenCanPoisonPointAttacker = (
  defender: Pick<SpawnedPokemon, 'abilityNames'>,
  attacker: SpawnedPokemon,
): boolean => tokenHasPoisonPoint(defender) && !poisonPointAttackerBlockSource(attacker)

export const poisonPointReactionPromptKey = (
  prompt: Pick<MoveAutomationPoisonPointPrompt, 'defenderId' | 'attackerId' | 'moveName'>,
): string => [prompt.defenderId, prompt.attackerId, normalizeMoveKey(prompt.moveName)].join('|')

const defaultPoisonPointPromptId = (prompt: Omit<MoveAutomationPoisonPointPrompt, 'id'>): string => [
  'poison-point',
  prompt.defenderId,
  prompt.attackerId,
  normalizeMoveKey(prompt.moveName).replace(/[^a-z0-9]+/g, '-') || 'move',
  Date.now().toString(36),
  Math.random().toString(36).slice(2, 8),
].join('-')

export interface BuildPoisonPointReactionPromptsInput {
  attacker: SpawnedPokemon
  moveName: string
  hitTargets: readonly SpawnedPokemon[]
  script: Pick<MoveAutomationScript, 'range' | 'keywords'> | null | undefined
  existingPrompts?: readonly MoveAutomationPoisonPointPrompt[]
  idFactory?: (prompt: Omit<MoveAutomationPoisonPointPrompt, 'id'>) => string
}

export const buildPoisonPointReactionPrompts = ({
  attacker,
  moveName,
  hitTargets,
  script,
  existingPrompts = [],
  idFactory = defaultPoisonPointPromptId,
}: BuildPoisonPointReactionPromptsInput): MoveAutomationPoisonPointPrompt[] => {
  if (!moveName.trim() || !isPoisonPointTriggeringMove(script)) return []
  if (poisonPointAttackerBlockSource(attacker)) return []

  const seen = new Set(existingPrompts.map(poisonPointReactionPromptKey))
  const prompts: MoveAutomationPoisonPointPrompt[] = []

  for (const defender of hitTargets) {
    if (defender.id === attacker.id) continue
    if (!tokenHasPoisonPoint(defender)) continue

    const withoutId = {
      defenderId: defender.id,
      defenderName: defender.species,
      attackerId: attacker.id,
      attackerName: attacker.species,
      moveName,
    }
    const key = poisonPointReactionPromptKey(withoutId)
    if (seen.has(key)) continue

    seen.add(key)
    prompts.push({
      id: idFactory(withoutId),
      ...withoutId,
    })
  }

  return prompts
}

export const buildPoisonPointReactionConditionUpdate = (
  attacker: SpawnedPokemon,
  defender: SpawnedPokemon,
): MoveAutomationConditionUpdate | null => {
  if (!tokenCanPoisonPointAttacker(defender, attacker)) return null
  return {
    id: attacker.id,
    conditions: normalizeConditionNames([
      ...attacker.conditions,
      POISONED_CONDITION_NAME,
    ]),
  }
}
