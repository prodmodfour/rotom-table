import {
  MOXIE_ABILITY_NAME,
  resolveMapAbilityAutomationTransaction,
} from '~/utils/abilityAutomation'
import { sheetHasCanonicalAbility } from '~/utils/sheetAbilities'
import type { AbilityAutomationTransaction } from '~/types/abilityAutomation'
import type {
  MoveAutomationHpUpdate,
  MoveAutomationMoxiePrompt,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const normalizeMoveKey = (value: unknown): string => typeof value === 'string'
  ? value.trim().toLowerCase()
  : ''

export const tokenHasMoxie = (
  token: Pick<SpawnedPokemon, 'abilityNames'>,
): boolean => sheetHasCanonicalAbility(token.abilityNames, MOXIE_ABILITY_NAME)

export const moxieTriggerPromptKey = (
  prompt: Pick<MoveAutomationMoxiePrompt, 'attackerId' | 'moveName' | 'faintedTargetIds'>,
): string => [
  prompt.attackerId,
  normalizeMoveKey(prompt.moveName),
  ...[...prompt.faintedTargetIds].sort(),
].join('|')

const defaultMoxiePromptId = (prompt: Omit<MoveAutomationMoxiePrompt, 'id'>): string => [
  'moxie',
  prompt.attackerId,
  normalizeMoveKey(prompt.moveName).replace(/[^a-z0-9]+/g, '-') || 'move',
].join('-')

export interface BuildMoxieTriggerPromptsInput {
  attacker: SpawnedPokemon
  moveName: string
  hpUpdates: readonly MoveAutomationHpUpdate[]
  tokens: readonly SpawnedPokemon[]
  hitTargetIds?: readonly string[]
  existingPrompts?: readonly MoveAutomationMoxiePrompt[]
  idFactory?: (prompt: Omit<MoveAutomationMoxiePrompt, 'id'>) => string
}

export const buildMoxieTriggerPrompts = ({
  attacker,
  moveName,
  hpUpdates,
  tokens,
  hitTargetIds,
  existingPrompts = [],
  idFactory = defaultMoxiePromptId,
}: BuildMoxieTriggerPromptsInput): MoveAutomationMoxiePrompt[] => {
  if (!moveName.trim() || !tokenHasMoxie(attacker)) return []

  const tokenById = new Map(tokens.map((token) => [token.id, token]))
  const hitTargetIdSet = hitTargetIds?.length ? new Set(hitTargetIds) : null
  const faintedTargets = hpUpdates
    .filter((update) => update.id !== attacker.id)
    .filter((update) => update.currentHp <= 0)
    .filter((update) => !hitTargetIdSet || hitTargetIdSet.has(update.id))
    .map((update) => tokenById.get(update.id) ?? null)
    .filter((token): token is SpawnedPokemon => Boolean(token && token.currentHp > 0))

  if (!faintedTargets.length) return []

  const withoutId: Omit<MoveAutomationMoxiePrompt, 'id'> = {
    attackerId: attacker.id,
    attackerName: attacker.species,
    moveName,
    faintedTargetIds: faintedTargets.map((target) => target.id),
    faintedTargetNames: faintedTargets.map((target) => target.species),
  }

  const key = moxieTriggerPromptKey(withoutId)
  if (existingPrompts.some((prompt) => moxieTriggerPromptKey(prompt) === key)) return []

  return [{ id: idFactory(withoutId), ...withoutId }]
}

export const buildMoxieTriggerTransaction = (
  attacker: SpawnedPokemon,
  target?: SpawnedPokemon | null,
): AbilityAutomationTransaction | null => resolveMapAbilityAutomationTransaction({
  abilityName: MOXIE_ABILITY_NAME,
  user: attacker,
  target,
})
