import { createHash } from 'node:crypto'
import {
  AA079_MARVEL_SCALE_CONDITIONS,
  AA079_MEGA_LAUNCHER_MOVE_IDS,
  aa079HasMimitreeRearm,
  aa079MagicGuardBlocksReason,
} from '#shared/abilityAutomation/aa079'
import type { MoveDamageEffectOperation, MoveDirectHpEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import { clampCombatStage } from '~/utils/combatStages'
import { normalizeConditionName } from '~/utils/statusConditions'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

const normalizedConditions = (token: Pick<SpawnedPokemon, 'conditions'>): ReadonlySet<string> => new Set(
  token.conditions.flatMap(condition => {
    const canonical = normalizeConditionName(condition)
    return canonical ? [canonical] : []
  }),
)

export const aa079MagicGuardBlocksDirectHp = (input: {
  readonly context: AuthoritativeMoveRulesContext | undefined
  readonly recipientId: string
  readonly operation: MoveDirectHpEffectOperation
}): boolean => input.context?.queries.abilities.has(input.recipientId, 'Magic Guard') === true
  && aa079MagicGuardBlocksReason(input.operation.reasonCode)

export const aa079MarvelScaleActive = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly recipient: SpawnedPokemon
}): boolean => input.context.queries.abilities.has(input.recipient.id, 'Marvel Scale')
  && AA079_MARVEL_SCALE_CONDITIONS.some(condition => normalizedConditions(input.recipient).has(condition))

/** Marvel Scale is a virtual conditional stage and therefore disappears immediately when cured/suppressed. */
export const aa079MarvelScaleRecipient = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly recipient: SpawnedPokemon
}): SpawnedPokemon => {
  if (!aa079MarvelScaleActive(input)) return input.recipient
  return {
    ...input.recipient,
    combatStages: {
      ...input.recipient.combatStages,
      def: clampCombatStage((input.recipient.combatStages?.def ?? 0) + 2),
    },
  }
}

export const aa079MegaLauncherDamageBaseBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName'>
}): 0 | 3 => input.context.queries.abilities.has(input.context.actor.placement.id, 'Mega Launcher')
  && (AA079_MEGA_LAUNCHER_MOVE_IDS as readonly string[]).includes(input.script.moveName)
  ? 3
  : 0

export const aa079MercilessForcesCritical = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientId: string
  readonly damaging: boolean
}): boolean => {
  if (!input.damaging
    || !input.context.queries.abilities.has(input.context.actor.placement.id, 'Merciless')) return false
  const recipient = input.context.queries.tokens.get(input.recipientId)
  if (!recipient) return false
  const conditions = normalizedConditions(recipient)
  return conditions.has('Poisoned') || conditions.has('Badly Poisoned')
}

export const aa079MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
}): readonly MoveDamageModifier[] => {
  if (input.moveType.trim().toLowerCase() !== 'psychic'
    || Math.max(0, input.actor.currentHp) * 3 > Math.max(1, input.actor.fullMaxHp ?? input.actor.maxHp)) {
    return Object.freeze([])
  }
  return Object.freeze(input.context.queries.abilities.activeForPlacement(input.actor.id)
    .filter(ability => ability.canonicalId === 'Mind Mold')
    .map((ability, index): MoveDamageModifier => ({
      id: `ability.mind-mold.last-chance.${createHash('sha256')
        .update(`${input.operation.id}\u0000${input.recipient.id}\u0000${ability.instanceId}`)
        .digest('hex').slice(0, 24)}`,
      stage: 'pre-type-modifiers',
      priority: 39 + index,
      source: { kind: 'ability', id: ability.instanceId },
      stackingGroup: `aa079-mind-mold:${ability.instanceId}`,
      reasonCode: 'ability.mind-mold.last-chance',
      operation: 'add',
      value: 5,
    })))
}

export const aa079MimitreeMimicFrequencyBypass = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly canonicalMoveId: string
}): boolean => input.canonicalMoveId === 'Mimic'
  && input.context.queries.abilities.has(input.context.actor.placement.id, 'Mimitree')
  && aa079HasMimitreeRearm({
    effects: input.context.map.encounterState?.effects,
    placementId: input.context.actor.placement.id,
  })
