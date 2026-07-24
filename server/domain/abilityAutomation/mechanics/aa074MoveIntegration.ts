import { createHash } from 'node:crypto'
import type {
  MoveEffectOperation,
  MoveConditionEffectOperation,
  MoveHealEffectOperation,
  MoveItemEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import { AA074_HELIOVOLT_SUNNY_CAPABILITY } from '#shared/abilityAutomation/aa074'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA074_HELIOVOLT_REASON = 'ability.heliovolt.optional-weather' as const
export const AA074_HORDE_BREAK_REASON = 'ability.horde-break.optional-cleanse' as const
export const AA074_HONEY_THIEF_STEAL_REASON = 'ability.honey-thief.steal-digestion-buff' as const
export const AA074_HONEY_THIEF_TEMP_HP_REASON = 'ability.honey-thief.temporary-hp' as const

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const reactionRequest = (input: {
  readonly id: string
  readonly ownerId: string
}): MoveReactionRequestEffectOperation => ({
  id: input.id,
  kind: 'reaction-request',
  source: { kind: 'lifecycle-event', id: `ability.heliovolt.owner:${input.ownerId}` },
  recipients: { kind: 'none' },
  phase: 'hit',
  reasonCode: AA074_HELIOVOLT_REASON,
  payload: {
    requestId: `${input.id}.response`,
    promptKey: 'ability.heliovolt.use',
    options: [{ id: 'ability.heliovolt.use', labelKey: 'ability.heliovolt.evasion-and-sun' }],
    allowPass: true,
    timing: 'post-hit',
    priority: 40,
    ownerPlacementIds: [input.ownerId],
  },
})

const heliovoltOperations = (input: {
  readonly moveIdentity: string
  readonly ownerId: string
  readonly abilityInstanceId: string
}): readonly MoveEffectOperation[] => {
  const suffix = shortHash(input.moveIdentity, input.ownerId, input.abilityInstanceId, 'heliovolt')
  const requestId = `ability.heliovolt.request.${suffix}`
  const baseDefinition = {
    duration: { kind: 'rounds' as const, boundary: 'end' as const, remaining: 1 },
    stacks: 1,
    charges: null,
    stackPolicy: { kind: 'refresh' as const, maxStacks: null },
    chargePolicy: { kind: 'none' as const, amount: null },
    tags: ['ability', 'aa074', 'heliovolt'],
    dispel: { policy: 'matching-tags' as const, tags: ['heliovolt'] },
    transferPolicy: 'expire' as const,
  }
  return Object.freeze([
    reactionRequest({ id: requestId, ownerId: input.ownerId }),
    {
      id: `ability.heliovolt.evasion.${suffix}`,
      kind: 'temporary-effect',
      source: { kind: 'operation', id: requestId },
      recipients: { kind: 'response-owner' },
      phase: 'schedule',
      reasonCode: 'ability.heliovolt.evasion',
      payload: {
        action: 'add', effectId: `ability.heliovolt.evasion.${input.abilityInstanceId}`,
        recipientScope: 'placements',
        definition: {
          ...baseDefinition,
          kind: 'numeric-modifier',
          payload: { attribute: 'evasion', operation: 'add', value: 1, rounding: 'none' },
        },
      },
    } satisfies MoveTemporaryEffectOperation,
    {
      id: `ability.heliovolt.sunny.${suffix}`,
      kind: 'temporary-effect',
      source: { kind: 'operation', id: requestId },
      recipients: { kind: 'response-owner' },
      phase: 'schedule',
      reasonCode: 'ability.heliovolt.considered-sunny',
      payload: {
        action: 'add', effectId: `ability.heliovolt.sunny.${input.abilityInstanceId}`,
        recipientScope: 'placements',
        definition: {
          ...baseDefinition,
          kind: 'capability',
          payload: { capabilityId: AA074_HELIOVOLT_SUNNY_CAPABILITY, action: 'grant' },
        },
      },
    } satisfies MoveTemporaryEffectOperation,
  ])
}

const helperOperations = (input: {
  readonly moveIdentity: string
  readonly ownerId: string
  readonly targetId: string
  readonly abilityInstanceId: string
  readonly turnEndBoundaries: 1 | 2
}): readonly MoveEffectOperation[] => {
  const suffix = shortHash(
    input.moveIdentity, input.ownerId, input.targetId, input.abilityInstanceId, 'helper',
  )
  const definition = (attribute: 'accuracy' | 'skill-check') => ({
    kind: 'numeric-modifier' as const,
    duration: { kind: 'turns' as const, subject: 'source' as const, boundary: 'end' as const, remaining: input.turnEndBoundaries },
    stacks: 1,
    charges: null,
    stackPolicy: { kind: 'refresh' as const, maxStacks: null },
    chargePolicy: { kind: 'none' as const, amount: null },
    tags: ['ability', 'aa074', 'helper', attribute],
    payload: { attribute, operation: 'add' as const, value: 1, rounding: 'none' as const },
    dispel: { policy: 'matching-tags' as const, tags: ['helper', attribute] },
    transferPolicy: 'expire' as const,
  })
  return Object.freeze((['accuracy', 'skill-check'] as const).map(attribute => ({
    id: `ability.helper.${attribute}.${suffix}`,
    kind: 'temporary-effect',
    source: { kind: 'lifecycle-event', id: `ability.helper.owner:${input.ownerId}` },
    recipients: { kind: 'attacked-targets' },
    phase: 'schedule',
    reasonCode: `ability.helper.${attribute}`,
    payload: {
      action: 'add',
      effectId: `ability.helper.${attribute}.${input.abilityInstanceId}.${input.targetId}`,
      recipientScope: 'placements',
      definition: definition(attribute),
    },
  } satisfies MoveTemporaryEffectOperation)))
}

const storedDigestionNames = (
  sheet: CharacterSheet | TrainerSheet,
  kind: 'pokemon' | 'trainer',
): readonly string[] => {
  const array = kind === 'pokemon'
    ? (sheet as CharacterSheet).items?.digestionFoods
    : (sheet as TrainerSheet).digestionFoods
  if (array !== undefined && (!Array.isArray(array)
    || array.length > 3
    || array.some(value => typeof value !== 'string' || !value.trim()))) return Object.freeze([])
  const legacy = kind === 'pokemon'
    ? (sheet as CharacterSheet).items?.digestionFood
    : (sheet as TrainerSheet).digestion
  const honeyPaws = kind === 'pokemon'
    ? (sheet as CharacterSheet).items?.honeyPawsFood
    : (sheet as TrainerSheet).honeyPawsFood
  return Object.freeze([
    ...(Array.isArray(array) ? array : []),
    ...(typeof legacy === 'string' && legacy.trim() ? [legacy] : []),
    ...(typeof honeyPaws === 'string' && honeyPaws.trim() ? [honeyPaws] : []),
  ])
}

export const aa074TargetHasDigestionBuff = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
): boolean => {
  const placement = context.queries.placements.get(placementId)
  const resolved = placement ? context.queries.sheets.forPlacement(placement) : null
  if (!placement || !resolved) return false
  if (storedDigestionNames(resolved.sheet, resolved.kind).length > 0) return true
  return resolved.kind === 'pokemon' && (resolved.sheet as CharacterSheet).berryStorage?.entries
    .some(entry => entry.quantity > 0) === true
}

const honeyThiefOperations = (input: {
  readonly moveIdentity: string
  readonly ownerId: string
  readonly abilityInstanceId: string
}): readonly [MoveItemEffectOperation, MoveHealEffectOperation] => {
  const suffix = shortHash(input.moveIdentity, input.ownerId, input.abilityInstanceId)
  const stealId = `ability.honey-thief.steal.${suffix}`
  return Object.freeze([{
    id: stealId,
    kind: 'item',
    source: { kind: 'operation', id: 'bug-bite.damage' },
    recipients: { kind: 'hit-targets' },
    phase: 'after-damage',
    reasonCode: AA074_HONEY_THIEF_STEAL_REASON,
    payload: { action: 'digest-buff', canonicalItemIds: null, onUnavailable: 'no-op' },
  }, {
    id: `ability.honey-thief.temp-hp.${suffix}`,
    kind: 'heal',
    source: { kind: 'operation', id: stealId },
    recipients: { kind: 'actor' },
    phase: 'after-damage',
    reasonCode: AA074_HONEY_THIEF_TEMP_HP_REASON,
    payload: {
      mode: 'gain', pool: 'temporary-hit-points',
      calculation: { kind: 'percent-max', percent: 10 },
      bounds: { minimum: null, maximum: null }, rounding: 'floor',
      injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
    },
  }])
}

/** Replace Bug Bite's compatibility self-trade only when Honey Thief owns a reviewed target trade. */
export const applyAa074HoneyThiefOperations = (
  operations: readonly MoveEffectOperation[],
): readonly MoveEffectOperation[] => operations.some(operation => (
  operation.reasonCode === AA074_HONEY_THIEF_STEAL_REASON
))
  ? Object.freeze(operations.filter(operation => !(
      operation.kind === 'item' && operation.reasonCode === 'bug-bite.digest-buff'
    )))
  : operations

const hordeBreakOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const actorId = input.context.actor.placement.id
  const changesToSolo = input.operations.some(operation => (
    operation.kind === 'temporary-effect'
    && operation.recipients.kind === 'actor'
    && operation.payload.action === 'add'
    && operation.payload.definition.kind === 'creature-rule-overlay'
    && operation.payload.definition.payload.domain === 'form'
    && operation.payload.definition.payload.action === 'replace'
    && operation.payload.definition.payload.value.trim().toLowerCase() === 'solo-form'
  ))
  if (!changesToSolo
    || input.context.actor.token.creatureRules?.formId?.trim().toLowerCase() !== 'school-form'
    || !input.context.queries.abilities.has(actorId, 'Horde Break')
    || !input.context.queries.resources.actionAvailable(actorId, 'free')) return Object.freeze([])
  const suffix = shortHash(input.context.resolutionId ?? 'resolution', actorId, 'horde-break')
  const requestId = `ability.horde-break.request.${suffix}`
  const request: MoveReactionRequestEffectOperation = {
    id: requestId,
    kind: 'reaction-request',
    source: { kind: 'lifecycle-event', id: `ability.horde-break.owner:${actorId}` },
    recipients: { kind: 'none' },
    phase: 'schedule',
    reasonCode: AA074_HORDE_BREAK_REASON,
    payload: {
      requestId: `${requestId}.response`,
      promptKey: 'ability.horde-break.use',
      options: [{ id: 'ability.horde-break.use', labelKey: 'ability.horde-break.clear-statuses' }],
      allowPass: true,
      timing: 'post-hit',
      priority: 40,
      ownerPlacementIds: [actorId],
    },
  }
  const clear: MoveConditionEffectOperation = {
    id: `ability.horde-break.clear.${suffix}`,
    kind: 'condition',
    source: { kind: 'operation', id: requestId },
    recipients: { kind: 'response-owner' },
    phase: 'cleanup',
    reasonCode: 'ability.horde-break.clear-statuses',
    payload: {
      action: 'clear', conditionId: null, conditionSource: null,
      filter: {
        groups: ['persistent', 'volatile'],
        conditionIds: [], excludedConditionIds: [],
      },
      randomChoice: null, duration: null, saveTiming: 'canonical',
      stackPolicy: { kind: 'refresh', maxStacks: null },
    },
  }
  return Object.freeze([request, clear])
}

/** Add the optional reaction only for a sealed School Form → Solo Form operation. */
export const applyAa074HordeBreakOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const added = hordeBreakOperations(input)
  return added.length === 0 ? input.operations : Object.freeze([...input.operations, ...added])
}

const directSingleTargetMove = (script: MoveAutomationScript): boolean => (
  /(?:^|,)\s*1 Target(?:,|$)/i.test(script.range)
  && !/(?:burst|blast|cone|line|field|self)/i.test(script.range)
)

/** Rebuilt from exact effective runtimes for immediate, nested, pending, and resumed execution. */
export const aa074MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const moveIdentity = input.context.resolutionId ?? `${input.moveSourceId}:${input.script.moveName}`
  const abilities = input.context.queries.abilities.activeForPlacement(actorId)

  const heliovolt = abilities.find(ability => ability.canonicalId === 'Heliovolt')
  if (heliovolt
    && input.script.type.trim().toLowerCase() === 'electric'
    && input.context.queries.resources.actionAvailable(actorId, 'swift')) {
    operations.push(...heliovoltOperations({
      moveIdentity, ownerId: actorId, abilityInstanceId: heliovolt.instanceId,
    }))
  }

  const uniqueTargets = [...new Set(input.authoritativeTargetIds)]
  const helper = abilities.find(ability => ability.canonicalId === 'Helper')
  if (helper && uniqueTargets.length === 1 && directSingleTargetMove(input.script)
    && input.context.queries.relationships.resolve(actorId, uniqueTargets[0]!).relationship === 'ally') {
    operations.push(...helperOperations({
      moveIdentity, ownerId: actorId, targetId: uniqueTargets[0]!,
      abilityInstanceId: helper.instanceId,
      turnEndBoundaries: input.context.map.encounterState?.history.currentTurn?.placementId === actorId
        || input.context.map.initiative?.activeId === actorId ? 2 : 1,
    }))
  }

  const honeyThief = abilities.find(ability => ability.canonicalId === 'Honey Thief')
  if (honeyThief && input.script.moveName === 'Bug Bite' && uniqueTargets.length === 1
    && aa074TargetHasDigestionBuff(input.context, uniqueTargets[0]!)) {
    operations.push(...honeyThiefOperations({
      moveIdentity, ownerId: actorId, abilityInstanceId: honeyThief.instanceId,
    }))
  }
  return Object.freeze(operations)
}
