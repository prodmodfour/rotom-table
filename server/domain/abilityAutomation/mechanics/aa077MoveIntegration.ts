import { createHash } from 'node:crypto'
import {
  AA077_KLUTZ_GROUND_DESTINATION_ID,
  AA077_KLUTZ_ITEM_REQUEST_ID,
  AA077_KLUTZ_ITEM_REQUIREMENT_ID,
  AA077_KLUTZ_ITEM_SET_ID,
  AA077_KLUTZ_NONE_OPTION_ID,
} from '#shared/abilityAutomation/aa077'
import { parseMoveItemChoiceDeclaration } from '#shared/moveAutomation/itemChoices'
import {
  parseMoveEffectOperation,
  type MoveChoiceRequestEffectOperation,
  type MoveEffectOperation,
  type MoveItemEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA077_KLUTZ_REASON = 'ability.klutz.optional-knock-to-ground' as const
export const AA077_KLUTZ_ITEM_REASON = 'ability.klutz.knock-to-ground' as const

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

export const AA077_KLUTZ_ITEM_CHOICE_DECLARATION = parseMoveItemChoiceDeclaration({
  setId: AA077_KLUTZ_ITEM_SET_ID,
  requirementId: AA077_KLUTZ_ITEM_REQUIREMENT_ID,
  owner: 'actor',
  emptyPolicy: 'no-op',
  filter: {
    referenceKinds: ['pokemon-held', 'trainer-equipment-slot'],
    canonicalItemIds: null,
    trainerEquipmentSlots: ['accessory'],
    minimumQuantity: 1,
  },
  destinations: [{
    id: AA077_KLUTZ_GROUND_DESTINATION_ID,
    kind: 'map-ground',
    labelKey: 'ability.klutz.destination.map-ground',
  }],
  noneOption: {
    id: AA077_KLUTZ_NONE_OPTION_ID,
    labelKey: 'ability.klutz.choose-none',
  },
})

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly abilityInstanceId: string
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  if (!sceneId) return false
  const ledger = input.context.map.encounterState?.abilityUsage
  if (ledger?.sceneId && ledger.sceneId !== sceneId) return true
  const spent = ledger?.entries.find(entry => (
    entry.ownerId === input.context.actor.placement.id
    && entry.abilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === 'Klutz'
    && entry.clauseId === 'base'
  ))?.spent ?? 0
  return spent < 1
}

const choiceOperation = (input: {
  readonly suffix: string
  readonly moveSourceId: string
}): MoveChoiceRequestEffectOperation => {
  const parsed = parseMoveEffectOperation({
    id: `ability.klutz.choose.${input.suffix}`,
    kind: 'choice-request',
    source: { kind: 'move', id: input.moveSourceId },
    recipients: { kind: 'hit-targets' },
    phase: 'after-damage',
    reasonCode: AA077_KLUTZ_REASON,
    payload: {
      requestId: `${AA077_KLUTZ_ITEM_REQUEST_ID}.${input.suffix}`,
      promptKey: 'ability.klutz.choose-target-item',
      options: [],
      allowPass: true,
      itemChoice: AA077_KLUTZ_ITEM_CHOICE_DECLARATION,
    },
  })
  if (parsed.kind !== 'choice-request') throw new Error('Klutz choice operation has the wrong kind.')
  return parsed
}

const itemOperation = (input: {
  readonly suffix: string
  readonly choice: MoveChoiceRequestEffectOperation
}): MoveItemEffectOperation => {
  const parsed = parseMoveEffectOperation({
    id: `ability.klutz.ground.${input.suffix}`,
    kind: 'item',
    source: { kind: 'operation', id: input.choice.id },
    recipients: { kind: 'hit-targets' },
    phase: 'after-damage',
    reasonCode: AA077_KLUTZ_ITEM_REASON,
    payload: {
      action: 'knock-to-ground',
      item: {
        kind: 'choice',
        requestId: input.choice.payload.requestId,
        destinationId: AA077_KLUTZ_GROUND_DESTINATION_ID,
      },
      quantity: 1,
      onUnavailable: 'no-op',
    },
  })
  if (parsed.kind !== 'item') throw new Error('Klutz item operation has the wrong kind.')
  return parsed
}

/** Reviewed post-hit item response rebuilt for immediate, nested, pending, and resumed Moves. */
export const aa077MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const melee = input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'melee')
  if (!input.script.damaging || !melee || input.authoritativeTargetIds.length === 0) {
    return Object.freeze([])
  }
  const actorId = input.context.actor.placement.id
  const klutz = input.context.queries.abilities.activeForPlacement(actorId)
    .find(ability => ability.canonicalId === 'Klutz')
  if (!klutz
    || !input.context.queries.resources.actionAvailable(actorId, 'free')
    || !sceneUseAvailable({ context: input.context, abilityInstanceId: klutz.instanceId })) {
    return Object.freeze([])
  }
  const suffix = shortHash(
    input.context.resolutionId ?? `${input.moveSourceId}:${input.script.moveName}`,
    actorId,
    klutz.instanceId,
    ...[...new Set(input.authoritativeTargetIds)].sort(),
  )
  const choice = choiceOperation({ suffix, moveSourceId: input.moveSourceId })
  return Object.freeze([choice, itemOperation({ suffix, choice })])
}
