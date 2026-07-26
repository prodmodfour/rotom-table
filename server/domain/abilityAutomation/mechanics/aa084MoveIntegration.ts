import { createHash } from 'node:crypto'
import type {
  MoveConditionEffectOperation,
  MoveDamageEffectOperation,
  MoveEffectOperation,
  MoveMultiHitEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveRollEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import type { PokemonTypeId } from '#shared/pokemonTypes'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveSpecResponseResolver } from '../../moveAutomation/responses'
import { aa066DazzlingBlocksPriorityMove } from './aa066StaticIntegration'

export const AA084_PRANKSTER_REASON = 'ability.prankster.optional-priority-advanced' as const
export const AA084_PROBABILITY_CONTROL_REASON = 'ability.probability-control.optional-reroll' as const
export const AA084_PROTEAN_REASON = 'ability.protean.optional-type-change' as const
export const AA084_PSIONIC_SCREECH_REASON = 'ability.psionic-screech.optional-psychic-type' as const
export const AA084_PROBABILITY_CONTROL_OPTION_PREFIX = 'ability.probability-control.reroll:' as const
export const AA084_PRANKSTER_OPTION_ID = 'ability.prankster.priority-advanced' as const
export const AA084_PROTEAN_OPTION_ID = 'ability.protean.change-type' as const
export const AA084_PSIONIC_SCREECH_OPTION_ID = 'ability.psionic-screech.psychic' as const

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const sceneAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly limit?: number
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  if (!sceneId) return false
  const ledger = input.context.map.encounterState?.abilityUsage
  if (ledger?.sceneId && ledger.sceneId !== sceneId) return true
  return (ledger?.entries.find(entry => entry.ownerId === input.ownerId
    && entry.abilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base')?.spent ?? 0) < (input.limit ?? 1)
}

const request = (input: {
  readonly id: string
  readonly sourceId: string
  readonly ownerId: string
  readonly reasonCode: string
  readonly optionId: string
  readonly promptKey: string
  readonly phase: MoveReactionRequestEffectOperation['phase']
  readonly timing: MoveReactionRequestEffectOperation['payload']['timing']
  readonly priority: number
}): MoveReactionRequestEffectOperation => ({
  id: input.id,
  kind: 'reaction-request',
  source: { kind: 'lifecycle-event', id: input.sourceId },
  recipients: { kind: 'none' },
  phase: input.phase,
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`,
    promptKey: input.promptKey,
    options: [{ id: input.optionId, labelKey: input.optionId }],
    allowPass: true,
    timing: input.timing,
    priority: input.priority,
    ownerPlacementIds: [input.ownerId],
  },
})

const marker = (input: {
  readonly id: string
  readonly requestId: string
  readonly recipients: 'actor' | 'response-owner'
  readonly tags: readonly string[]
  readonly capabilityId: string
}): MoveTemporaryEffectOperation => ({
  id: input.id,
  kind: 'temporary-effect',
  source: { kind: 'operation', id: input.requestId },
  recipients: { kind: input.recipients },
  phase: 'schedule',
  reasonCode: input.tags.join('.'),
  payload: {
    action: 'add', effectId: input.id, recipientScope: 'placements',
    definition: {
      kind: 'capability', duration: { kind: 'scene', remaining: null },
      stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'aa084', ...input.tags],
      payload: { capabilityId: input.capabilityId, action: 'grant' },
      dispel: { policy: 'matching-tags', tags: [...input.tags] },
      transferPolicy: 'expire',
    },
  },
})

const probabilityControlOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly identity: string
  readonly targetIds: readonly string[]
  readonly reviewedOperations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const actorId = input.context.actor.placement.id
  const rollPoints: Array<{
    operationId: string
    recipientKey: string
    phase: 'hit' | 'after-damage' | 'cleanup'
    timing: 'post-hit' | 'post-damage' | 'cleanup'
  }> = []
  for (const operation of input.reviewedOperations) {
    if (operation.kind === 'roll' && operation.payload.formula.kind !== 'table') {
      const recipientKeys = operation.recipients.kind === 'none'
        ? ['none']
        : operation.recipients.kind === 'actor'
          ? [actorId]
          : operation.recipients.kind === 'actor-and-attacked-targets'
            ? [actorId, ...input.targetIds]
            : input.targetIds
      for (const recipientKey of recipientKeys) rollPoints.push({
        operationId: operation.id,
        recipientKey,
        phase: operation.phase === 'accuracy' ? 'hit' : 'cleanup',
        timing: operation.phase === 'accuracy' ? 'post-hit' : 'cleanup',
      })
    }
    else if (operation.kind === 'damage') {
      for (const recipientKey of input.targetIds) rollPoints.push({
        operationId: operation.id,
        recipientKey,
        phase: 'after-damage',
        timing: 'post-damage',
      })
    }
  }
  if (rollPoints.length === 0) return []
  const providers = input.context.queries.placements.all().flatMap(placement => {
    if (!['self', 'ally'].includes(
      input.context.queries.relationships.resolve(placement.id, actorId).relationship,
    )) return []
    const ability = input.context.queries.abilities.activeForPlacement(placement.id)
      .find(candidate => candidate.canonicalId === 'Probability Control')
    if (!ability
      || !input.context.queries.resources.actionAvailable(placement.id, 'free')
      || !sceneAvailable({
        context: input.context,
        ownerId: placement.id,
        abilityInstanceId: ability.instanceId,
        canonicalId: 'Probability Control',
      })) return []
    return [{ ownerId: placement.id, abilityInstanceId: ability.instanceId }]
  }).sort((left, right) => left.ownerId.localeCompare(right.ownerId))
  return rollPoints.flatMap(point => providers.flatMap(provider => {
    const suffix = shortHash(
      input.identity, point.operationId, point.recipientKey,
      provider.ownerId, provider.abilityInstanceId,
    )
    const requestId = `ability.probability-control.request.${suffix}`
    const optionId = `${AA084_PROBABILITY_CONTROL_OPTION_PREFIX}${point.operationId}:${point.recipientKey}`
    return [
      request({
        id: requestId,
        sourceId: `ability.probability-control.roll:${point.operationId}:${point.recipientKey}`,
        ownerId: provider.ownerId,
        reasonCode: AA084_PROBABILITY_CONTROL_REASON,
        optionId,
        promptKey: 'ability.probability-control.reroll',
        phase: point.phase, timing: point.timing, priority: 112,
      }),
      marker({
        id: `ability.probability-control.residue.${suffix}`,
        requestId,
        recipients: 'response-owner',
        tags: ['probability-control', 'psychic-residue'],
        capabilityId: 'aa084.probability-control.psychic-residue',
      }),
    ]
  }))
}

const pranksterOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly identity: string
  readonly script: MoveAutomationScript
}): readonly MoveEffectOperation[] => {
  if (input.script.damageClass?.trim().toLowerCase() !== 'status') return []
  const actorId = input.context.actor.placement.id
  if (aa066DazzlingBlocksPriorityMove({
    map: input.context.map,
    placementId: actorId,
  })) return []
  const ability = input.context.queries.abilities.activeForPlacement(actorId)
    .find(candidate => candidate.canonicalId === 'Prankster')
  if (!ability) return []
  const suffix = shortHash(input.identity, actorId, ability.instanceId)
  return [request({
    id: `ability.prankster.request.${suffix}`,
    sourceId: 'ability.prankster.status-move',
    ownerId: actorId,
    reasonCode: AA084_PRANKSTER_REASON,
    optionId: AA084_PRANKSTER_OPTION_ID,
    promptKey: 'ability.prankster.use-priority-advanced',
    phase: 'declare', timing: 'declare', priority: 120,
  })]
}

const proteanOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly identity: string
  readonly moveType: PokemonTypeId | null
}): readonly MoveEffectOperation[] => {
  if (!input.moveType) return []
  const actorId = input.context.actor.placement.id
  const ability = input.context.queries.abilities.activeForPlacement(actorId)
    .find(candidate => candidate.canonicalId === 'Protean')
  if (!ability || !input.context.queries.resources.actionAvailable(actorId, 'swift')) return []
  const suffix = shortHash(input.identity, actorId, ability.instanceId, input.moveType)
  const requestId = `ability.protean.request.${suffix}`
  return [
    request({
      id: requestId,
      sourceId: `ability.protean.move:${input.moveType}`,
      ownerId: actorId,
      reasonCode: AA084_PROTEAN_REASON,
      optionId: AA084_PROTEAN_OPTION_ID,
      promptKey: `ability.protean.type.${input.moveType}`,
      phase: 'declare', timing: 'declare', priority: 118,
    }),
    {
      id: `ability.protean.type.${suffix}`,
      kind: 'temporary-effect',
      source: { kind: 'operation', id: requestId },
      recipients: { kind: 'response-owner' },
      phase: 'schedule',
      reasonCode: 'ability.protean.replace-type',
      payload: {
        action: 'add', effectId: `ability.protean.type.${actorId}`, recipientScope: 'placements',
        definition: {
          kind: 'creature-rule-overlay', duration: { kind: 'scene', remaining: null },
          stacks: 1, charges: null,
          stackPolicy: { kind: 'replace', maxStacks: null },
          chargePolicy: { kind: 'none', amount: null },
          tags: ['ability', 'aa084', 'protean', 'type'],
          payload: {
            domain: 'type', action: 'replace', values: [input.moveType],
            referencePlacementId: null, suppressionScope: null,
          },
          dispel: { policy: 'matching-tags', tags: ['protean', 'type'] },
          transferPolicy: 'expire',
        },
      },
    } satisfies MoveTemporaryEffectOperation,
  ]
}

const psionicScreechOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly identity: string
  readonly moveType: PokemonTypeId | null
}): readonly MoveEffectOperation[] => {
  if (input.moveType !== 'flying') return []
  const actorId = input.context.actor.placement.id
  const ability = input.context.queries.abilities.activeForPlacement(actorId)
    .find(candidate => candidate.canonicalId === 'Psionic Screech')
  if (!ability
    || !input.context.queries.resources.actionAvailable(actorId, 'free')
    || !sceneAvailable({
      context: input.context,
      ownerId: actorId,
      abilityInstanceId: ability.instanceId,
      canonicalId: 'Psionic Screech',
      limit: 2,
    })) return []
  const suffix = shortHash(input.identity, actorId, ability.instanceId)
  const requestId = `ability.psionic-screech.request.${suffix}`
  const flinch: MoveConditionEffectOperation = {
    id: `ability.psionic-screech.flinch.${suffix}`,
    kind: 'condition',
    source: { kind: 'operation', id: requestId },
    recipients: { kind: 'hit-targets' },
    phase: 'after-damage',
    reasonCode: 'ability.psionic-screech.flinch',
    payload: {
      action: 'apply', conditionId: 'flinch', conditionSource: null,
      filter: null, randomChoice: null, duration: null, saveTiming: 'canonical',
      stackPolicy: { kind: 'refresh', maxStacks: null },
    },
  }
  return [
    request({
      id: requestId,
      sourceId: 'ability.psionic-screech.flying-move',
      ownerId: actorId,
      reasonCode: AA084_PSIONIC_SCREECH_REASON,
      optionId: AA084_PSIONIC_SCREECH_OPTION_ID,
      promptKey: 'ability.psionic-screech.use',
      phase: 'declare', timing: 'declare', priority: 119,
    }),
    flinch,
  ]
}

const canonicalMoveType = (script: MoveAutomationScript): PokemonTypeId | null => {
  const type = script.type.trim().toLowerCase()
  const valid = new Set<PokemonTypeId>([
    'bug', 'dark', 'dragon', 'electric', 'fairy', 'fighting', 'fire', 'flying',
    'ghost', 'grass', 'ground', 'ice', 'normal', 'poison', 'psychic', 'rock', 'steel', 'water',
  ])
  return valid.has(type as PokemonTypeId) ? type as PokemonTypeId : null
}

export const aa084MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
  readonly reviewedOperations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const identity = input.context.resolutionId ?? `${input.moveSourceId}:${input.script.moveName}`
  const moveType = canonicalMoveType(input.script)
  return Object.freeze([
    ...pranksterOperations({ ...input, identity }),
    ...proteanOperations({ ...input, identity, moveType }),
    ...psionicScreechOperations({ ...input, identity, moveType }),
    ...probabilityControlOperations({
      ...input, identity, targetIds: input.authoritativeTargetIds,
    }),
  ])
}

const selectedReaction = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
  readonly reasonCode: string
  readonly optionId: string
}): boolean => input.operations.some(operation => (
  operation.kind === 'reaction-request'
  && operation.reasonCode === input.reasonCode
  && input.responses.resolve({
    requestId: operation.payload.requestId,
    options: operation.payload.options,
    allowPass: operation.payload.allowPass,
  })?.optionId === input.optionId
))

export const aa084PranksterSelected = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
}): boolean => selectedReaction({
  ...input, reasonCode: AA084_PRANKSTER_REASON, optionId: AA084_PRANKSTER_OPTION_ID,
})

export const aa084ProteanSelected = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
}): boolean => selectedReaction({
  ...input, reasonCode: AA084_PROTEAN_REASON, optionId: AA084_PROTEAN_OPTION_ID,
})

export const aa084PsionicScreechSelected = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
}): boolean => selectedReaction({
  ...input,
  reasonCode: AA084_PSIONIC_SCREECH_REASON,
  optionId: AA084_PSIONIC_SCREECH_OPTION_ID,
})

export interface Aa084ProbabilityControlSelection {
  readonly requestOperationId: string
  readonly ownerPlacementId: string
}

/**
 * Selected rerolls are consumed before their original roll's downstream
 * decisions. One Scene use can authorize only the first selected roll for each
 * owner, even though every legal roll point was issued up front for replay.
 */
export const aa084ProbabilityControlSelections = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
  readonly rollOperationId: string
  readonly recipientId: string
}): readonly Aa084ProbabilityControlSelection[] => {
  const selectedOwnerIds = new Set<string>()
  const selections: Aa084ProbabilityControlSelection[] = []
  const expectedOption = `${AA084_PROBABILITY_CONTROL_OPTION_PREFIX}${input.rollOperationId}:${input.recipientId}`
  for (const operation of input.operations) {
    if (operation.kind !== 'reaction-request'
      || operation.reasonCode !== AA084_PROBABILITY_CONTROL_REASON) continue
    const ownerPlacementId = operation.payload.ownerPlacementIds?.[0]
    if (!ownerPlacementId || selectedOwnerIds.has(ownerPlacementId)) continue
    const response = input.responses.resolve({
      requestId: operation.payload.requestId,
      options: operation.payload.options,
      allowPass: operation.payload.allowPass,
    })
    if (response?.optionId === null || response === null) continue
    if (response === undefined) continue
    selectedOwnerIds.add(ownerPlacementId)
    if (response.optionId === expectedOption) {
      selections.push({ requestOperationId: operation.id, ownerPlacementId })
    }
  }
  return Object.freeze(selections)
}

/** Apply response-selected Psionic Screech typing to every reviewed damage branch. */
export const applyAa084ReviewedOperations = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly moveOwnedOperationIds: ReadonlySet<string>
  readonly responses: MoveSpecResponseResolver
}): readonly MoveEffectOperation[] => {
  if (!aa084PsionicScreechSelected(input)) return input.operations
  return Object.freeze(input.operations.map((operation): MoveEffectOperation => {
    if (!input.moveOwnedOperationIds.has(operation.id)) return operation
    if (operation.kind === 'damage') return {
      ...operation,
      payload: { ...operation.payload, moveType: 'psychic' },
    } satisfies MoveDamageEffectOperation
    if (operation.kind === 'multi-hit') return {
      ...operation,
      payload: { ...operation.payload, damage: { ...operation.payload.damage, moveType: 'psychic' } },
    } satisfies MoveMultiHitEffectOperation
    return operation
  }))
}
