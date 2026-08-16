import type {
  MoveBranchEffectOperation,
  MoveConditionEffectOperation,
  MoveEffectOperation,
  MoveTemporaryEffectOperation,
  MoveUsageEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'
import {
  reviewedCondition,
  reviewedDamage,
  reviewedMultiHit,
  reviewedStage,
  standardAccuracy,
} from '../specs/reviewedSpecBuilder'

export const DYNAMIC_DAMAGE_218_225_HANDLER_ID = 'ma218-225.dynamic-damage' as const

interface DamageDefinition {
  readonly slug: string
  readonly damageBase: number
  readonly damageClass: 'physical' | 'special'
  readonly moveType: string
}

const DEFINITIONS: Readonly<Record<string, DamageDefinition>> = Object.freeze({
  'Behemoth Bash': { slug: 'behemoth-bash', damageBase: 10, damageClass: 'physical', moveType: 'steel' },
  'Behemoth Blade': { slug: 'behemoth-blade', damageBase: 10, damageClass: 'physical', moveType: 'steel' },
  'Bolt Beak': { slug: 'bolt-beak', damageBase: 9, damageClass: 'physical', moveType: 'electric' },
  'Dragon Darts': { slug: 'dragon-darts', damageBase: 5, damageClass: 'physical', moveType: 'dragon' },
  'Dynamax Cannon': { slug: 'dynamax-cannon', damageBase: 10, damageClass: 'special', moveType: 'dragon' },
  'Echoed Voice': { slug: 'echoed-voice', damageBase: 4, damageClass: 'special', moveType: 'normal' },
  'Electro Ball': { slug: 'electro-ball', damageBase: 6, damageClass: 'special', moveType: 'electric' },
  'Facade': { slug: 'facade', damageBase: 7, damageClass: 'physical', moveType: 'normal' },
  'Fishious Rend': { slug: 'fishious-rend', damageBase: 9, damageClass: 'physical', moveType: 'water' },
  Flail: { slug: 'flail', damageBase: 7, damageClass: 'physical', moveType: 'normal' },
  'Fusion Bolt': { slug: 'fusion-bolt', damageBase: 10, damageClass: 'physical', moveType: 'electric' },
  'Fusion Flare': { slug: 'fusion-flare', damageBase: 10, damageClass: 'special', moveType: 'fire' },
  'Grass Knot': { slug: 'grass-knot', damageBase: 2, damageClass: 'special', moveType: 'grass' },
  'Gyro Ball': { slug: 'gyro-ball', damageBase: 6, damageClass: 'physical', moveType: 'steel' },
  'Heavy Slam': { slug: 'heavy-slam', damageBase: 4, damageClass: 'physical', moveType: 'steel' },
  Hex: { slug: 'hex', damageBase: 7, damageClass: 'special', moveType: 'ghost' },
  'Ice Ball': { slug: 'ice-ball', damageBase: 3, damageClass: 'physical', moveType: 'ice' },
  'Infernal Parade': { slug: 'infernal-parade', damageBase: 6, damageClass: 'special', moveType: 'ghost' },
  'Low Kick': { slug: 'low-kick', damageBase: 2, damageClass: 'physical', moveType: 'fighting' },
  Payback: { slug: 'payback', damageBase: 5, damageClass: 'physical', moveType: 'dark' },
  Punishment: { slug: 'punishment', damageBase: 6, damageClass: 'physical', moveType: 'dark' },
  Retaliate: { slug: 'retaliate', damageBase: 7, damageClass: 'physical', moveType: 'normal' },
  'Revelation Dance': { slug: 'revelation-dance', damageBase: 9, damageClass: 'special', moveType: 'normal' },
  Reversal: { slug: 'reversal', damageBase: 7, damageClass: 'physical', moveType: 'fighting' },
  Round: { slug: 'round', damageBase: 6, damageClass: 'special', moveType: 'normal' },
  'Secret Power': { slug: 'secret-power', damageBase: 7, damageClass: 'special', moveType: 'normal' },
  'Smelling Salts': { slug: 'smelling-salts', damageBase: 7, damageClass: 'physical', moveType: 'normal' },
  'Stomping Tantrum': { slug: 'stomping-tantrum', damageBase: 8, damageClass: 'physical', moveType: 'ground' },
  'Stored Power': { slug: 'stored-power', damageBase: 2, damageClass: 'special', moveType: 'psychic' },
  'Triple Axel': { slug: 'triple-axel', damageBase: 6, damageClass: 'physical', moveType: 'ice' },
  'Triple Kick': { slug: 'triple-kick', damageBase: 4, damageClass: 'physical', moveType: 'fighting' },
  'Trump Card': { slug: 'trump-card', damageBase: 6, damageClass: 'special', moveType: 'normal' },
  Venoshock: { slug: 'venoshock', damageBase: 7, damageClass: 'special', moveType: 'poison' },
  'Wake-Up Slap': { slug: 'wake-up-slap', damageBase: 5, damageClass: 'physical', moveType: 'fighting' },
})

const STAGE_KEYS = ['atk', 'def', 'satk', 'sdef', 'spd'] as const
const STATUS_IDS = new Set([
  'asleep', 'badly-poisoned', 'burned', 'cursed', 'frozen', 'paralyzed', 'poisoned', 'sleep',
])
const DANCE_MOVES = new Set([
  'Fiery Dance', 'Lunar Dance', 'Petal Dance', 'Quiver Dance', 'Revelation Dance',
  'Swords Dance', 'Teeter Dance', 'Victory Dance',
])

const target = (context: RegisteredMoveHandlerContext) => {
  const placement = context.selectedPlacements[0]
  if (!placement) throw new Error(`${context.intent.moveName} requires one authoritative target.`)
  context.reads.recordPlacement(placement)
  const token = context.queries.tokens.get(placement.id)
  const state = context.queries.targetStates.resolve(placement.id)
  if (!token || !state) throw new Error(`${context.intent.moveName} target state is unavailable.`)
  return { placement, token, state }
}

const positiveStages = (token: { readonly combatStages?: Partial<Record<(typeof STAGE_KEYS)[number], number>> }): number => (
  STAGE_KEYS.reduce((total, stage) => total + Math.max(0, token.combatStages?.[stage] ?? 0), 0)
)

const statusCount = (conditionIds: readonly string[]): number => (
  conditionIds.filter(id => STATUS_IDS.has(id)).length
)

const stat = (
  context: RegisteredMoveHandlerContext,
  placementId: string,
  id: 'speed',
): number => context.queries.stats.resolve(placementId, {
  stat: id,
  combatStagePolicy: 'honor',
  stageModifierPolicy: 'honor',
})?.value ?? 0

const initiativeBonus = (context: RegisteredMoveHandlerContext): number => {
  const selected = target(context)
  const actorInitiative = context.actor.placement.initiative
  const targetInitiative = selected.placement.initiative
  return typeof actorInitiative === 'number'
    && typeof targetInitiative === 'number'
    && targetInitiative < actorInitiative
    && !selected.state.actedThisRound
    ? 10
    : 0
}

const currentRound = (context: RegisteredMoveHandlerContext): number => (
  Math.max(1, context.map.initiative?.round ?? 1)
)

const contextualDefinition = (
  context: RegisteredMoveHandlerContext,
): DamageDefinition & {
  readonly preTypeDamageModifiers?: Parameters<typeof reviewedDamage>[0]['preTypeDamageModifiers']
} => {
  const name = context.intent.moveName
  const base = DEFINITIONS[name]
  if (!base) throw new Error(`Dynamic-damage handler cannot execute ${name}.`)
  const actor = context.actor.token
  const actorId = context.actor.placement.id
  const round = currentRound(context)
  let damageBase = base.damageBase
  let moveType = base.moveType
  const modifiers: Array<NonNullable<
    Parameters<typeof reviewedDamage>[0]['preTypeDamageModifiers']
  >[number]> = []
  const addModifier = (id: string, value: number): void => {
    if (value === 0) return
    modifiers.push({
      id: `${base.slug}.${id}`, priority: 100, stackingGroup: `${base.slug}.${id}`,
      reasonCode: `${base.slug}.${id}`, value: Math.trunc(value),
    })
  }

  if (['Behemoth Bash', 'Behemoth Blade', 'Dynamax Cannon', 'Punishment'].includes(name)) {
    const stages = positiveStages(target(context).token)
    damageBase = name === 'Punishment'
      ? Math.min(12, 6 + stages)
      : Math.min(20, 10 + stages * 2)
  }
  else if (name === 'Bolt Beak' || name === 'Fishious Rend') addModifier('slower-unacted-target', initiativeBonus(context))
  else if (name === 'Echoed Voice') {
    damageBase = context.queries.history.completedMoveCount('Echoed Voice', round - 1) > 0
      ? context.queries.history.completedMoveCount('Echoed Voice', round - 2) > 0 ? 12 : 8
      : 4
  }
  else if (name === 'Electro Ball') {
    const selected = target(context)
    addModifier('actor-speed', stat(context, actorId, 'speed'))
    addModifier('target-speed', -stat(context, selected.placement.id, 'speed'))
  }
  else if (name === 'Facade') {
    const actorState = context.queries.targetStates.resolve(actorId)
    if (actorState && statusCount(actorState.conditionIds) > 0) damageBase = 14
  }
  else if (name === 'Flail' || name === 'Reversal') damageBase = base.damageBase + Math.max(0, actor.injuries ?? 0)
  else if (name === 'Fusion Bolt' || name === 'Fusion Flare') {
    const counterpart = name === 'Fusion Bolt' ? 'Fusion Flare' : 'Fusion Bolt'
    if (
      context.queries.history.completedMoveCount(counterpart, round) > 0
      || context.queries.history.completedMoveCount(counterpart, round - 1) > 0
    ) damageBase += 3
  }
  else if (name === 'Grass Knot' || name === 'Low Kick') damageBase = Math.max(2, (target(context).state.weightClass ?? 1) * 2)
  else if (name === 'Gyro Ball') {
    const selected = target(context)
    addModifier(
      'speed-difference',
      Math.max(0, stat(context, selected.placement.id, 'speed') - stat(context, actorId, 'speed')),
    )
  }
  else if (name === 'Heavy Slam') {
    const actorWeight = context.queries.targetStates.resolve(actorId)?.weightClass ?? 1
    const targetWeight = target(context).state.weightClass ?? 1
    damageBase += Math.max(0, actorWeight - targetWeight) * 2
  }
  else if (name === 'Ice Ball') {
    const previous = context.queries.history.lastCompletedMove(actorId)
    const count = previous?.canonicalId === 'Ice Ball' && previous.succeeded
      ? context.queries.history.consecutiveUseCount(actorId, 'Ice Ball', target(context).placement.id)
      : 0
    damageBase = Math.min(15, 3 + count * 3)
  }
  else if (name === 'Payback') {
    const selected = target(context)
    const previous = context.queries.history.lastDamagingMoveReceived(actorId)
    if (previous?.actorPlacementId === selected.placement.id && previous.round === round - 1) damageBase = 10
  }
  else if (name === 'Retaliate') {
    const selected = target(context)
    const qualifies = context.queries.history.knockoutsSinceRound(Math.max(1, round - 2)).some(entry => (
      entry.actorPlacementId === selected.placement.id
      && context.queries.relationships.resolve(actorId, entry.targetPlacementId).relationship === 'ally'
    ))
    if (qualifies) damageBase = 14
  }
  else if (name === 'Revelation Dance') {
    moveType = context.queries.targetStates.resolve(actorId)?.typeIds[0] ?? 'normal'
    const danceCount = context.queries.history.completedMovesThisScene(actorId).filter(entry => (
      DANCE_MOVES.has(entry.canonicalId)
      && context.queries.history.moveUse(entry.resolutionId)?.completion?.round === round
    )).length
    addModifier('prior-dances', Math.min(15, danceCount * 5))
  }
  else if (name === 'Round') {
    damageBase = Math.min(12, 6 + context.queries.history.completedMoveCount('Round', round) * 2)
  }
  else if (name === 'Smelling Salts') {
    if (target(context).state.conditionIds.includes('paralyzed')) damageBase = 14
  }
  else if (name === 'Stomping Tantrum') {
    const previous = context.queries.history.lastCompletedMove(actorId)
    if (previous && previous.succeeded === false) damageBase = 15
  }
  else if (name === 'Stored Power') damageBase = Math.min(20, 2 + positiveStages(actor) * 2)
  else if (name === 'Trump Card') {
    damageBase = 6 + context.queries.history.completedMovesThisScene(actorId)
      .filter(entry => entry.canonicalId === 'Trump Card').length * 2
  }
  else if (name === 'Venoshock') {
    const ids = target(context).state.conditionIds
    if (ids.includes('poisoned') || ids.includes('badly-poisoned')) damageBase = 13
  }
  else if (name === 'Wake-Up Slap') {
    const ids = target(context).state.conditionIds
    if (ids.includes('sleep') || ids.includes('asleep')) damageBase = 10
  }
  else if (name === 'Triple Axel' || name === 'Triple Kick') {
    const attacksGivenUp = Math.max(0, 3 - context.selectedPlacements.length)
    damageBase += attacksGivenUp * (name === 'Triple Axel' ? 1 : 2)
  }

  return {
    ...base, damageBase, moveType,
    ...(modifiers.length ? { preTypeDamageModifiers: modifiers } : {}),
  }
}

const damageOperation = (
  context: RegisteredMoveHandlerContext,
  override: Partial<DamageDefinition> & { readonly id?: string } = {},
): MoveEffectOperation => {
  const definition = contextualDefinition(context)
  return reviewedDamage({
    ...definition,
    ...override,
    ...(override.id ? { id: override.id } : {}),
  })
}

const clearCondition = (slug: string, conditionId: string): MoveConditionEffectOperation => ({
  id: `${slug}.clear-${conditionId}`, kind: 'condition',
  source: { kind: 'operation', id: `${slug}.damage` }, recipients: { kind: 'hit-targets' },
  phase: 'after-damage', reasonCode: `${slug}.clear-${conditionId}`,
  payload: {
    action: 'clear', conditionId: null, conditionSource: null,
    filter: { groups: [], conditionIds: [conditionId], excludedConditionIds: [] },
    randomChoice: null, duration: null, saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
    operationOutcomeTrigger: { operationId: `${slug}.damage`, outcome: 'applied' },
  },
})

const alternateUsage = (slug: string): MoveUsageEffectOperation => ({
  id: `${slug}.alternate-usage`, kind: 'usage', source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: 'actor' }, phase: 'usage', reasonCode: `${slug}.alternate-once-per-scene`,
  payload: {
    action: 'spend', resourceId: `${slug}.alternate-use`, amount: 1,
    resource: { moveName: `${slug} alternate`, moveKey: `${slug}-alternate`, frequency: 'Scene' },
  },
})

const alternateDamage = (input: {
  readonly context: RegisteredMoveHandlerContext
  readonly slug: 'hex' | 'infernal-parade'
  readonly normalBase: number
  readonly boostedBase: number
  readonly eligible: boolean
}): readonly MoveEffectOperation[] => {
  if (!input.eligible) return [damageOperation(input.context, { damageBase: input.normalBase })]
  const normalId = `${input.slug}.damage-normal`
  const boostedId = `${input.slug}.damage-boosted`
  const branch: MoveBranchEffectOperation = {
    id: `${input.slug}.choose-alternate`, kind: 'branch',
    source: { kind: 'move', id: `move.${input.slug}` }, recipients: { kind: 'selected-targets' },
    phase: 'target', reasonCode: `${input.slug}.choose-alternate`,
    payload: {
      kind: 'choice', selectionId: `${input.slug}.alternate`, scope: 'resolution', owner: 'actor',
      requestId: `${input.slug}.alternate`, promptKey: `move.${input.slug}.choose-alternate`,
      options: [
        { id: 'normal', labelKey: 'move.alternate.normal', operationIds: [normalId] },
        { id: 'boosted', labelKey: 'move.alternate.boosted', operationIds: [boostedId, `${input.slug}.alternate-usage`] },
      ], pass: null,
    },
  }
  return [
    branch,
    damageOperation(input.context, { id: 'damage-normal', damageBase: input.normalBase }),
    damageOperation(input.context, { id: 'damage-boosted', damageBase: input.boostedBase }),
    alternateUsage(input.slug),
  ]
}

const infernalParade = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const eligible = context.selectedPlacements.some(placement => (
    statusCount(context.queries.targetStates.resolve(placement.id)?.conditionIds ?? []) > 0
  ))
  const operations = [...alternateDamage({
    context, slug: 'infernal-parade', normalBase: 6, boostedBase: 12, eligible,
  })]
  const damageIds = eligible
    ? ['infernal-parade.damage-normal', 'infernal-parade.damage-boosted']
    : ['infernal-parade.damage']
  for (const damageId of damageIds) {
    operations.push(reviewedCondition({
      slug: 'infernal-parade', id: `burn-${damageId.split('.').at(-1)}`,
      recipients: 'hit-targets', conditionId: 'burned', sourceOperationId: damageId,
      accuracyRollTrigger: { rollId: 'infernal-parade.accuracy-roll', trigger: { kind: 'range', minimum: 17 } },
      operationOutcomeTrigger: { operationId: damageId, outcome: 'applied' }, applyTypeImmunity: true,
    }))
  }
  return operations
}

const secretPower = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const targetPlacement = target(context).placement
  const terrains = context.queries.terrain.membership({ placementId: targetPlacement.id }).terrains
  const conditionId = terrains.some(value => value.kind === 'electric')
    ? 'paralyzed'
    : terrains.some(value => value.kind === 'misty')
      ? 'confused'
      : terrains.some(value => value.kind === 'grassy')
        ? 'sleep'
        : terrains.some(value => value.kind === 'psychic')
          ? 'flinched'
          : 'tripped'
  return [
    damageOperation(context),
    reviewedCondition({
      slug: 'secret-power', id: `environ-${conditionId}`, recipients: 'hit-targets', conditionId,
      sourceOperationId: 'secret-power.damage',
      accuracyRollTrigger: { rollId: 'secret-power.accuracy-roll', trigger: { kind: 'range', minimum: 17 } },
      operationOutcomeTrigger: { operationId: 'secret-power.damage', outcome: 'applied' },
      applyTypeImmunity: true,
    }),
  ]
}

const autotomize = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const weightClass = context.queries.targetStates.resolve(context.actor.placement.id)?.weightClass
  if (weightClass === null || weightClass === undefined) {
    throw new Error('Autotomize requires authoritative Weight Class.')
  }
  const weightEffect: MoveTemporaryEffectOperation = {
    id: 'autotomize.weight-class', kind: 'temporary-effect',
    source: { kind: 'move', id: 'move.autotomize' }, recipients: { kind: 'actor' },
    phase: 'schedule', reasonCode: 'autotomize.weight-class',
    payload: {
      action: 'add', effectId: 'autotomize.weight-class', recipientScope: 'placements',
      definition: {
        kind: 'numeric-modifier', duration: { kind: 'scene', remaining: null }, stacks: 1, charges: null,
        stackPolicy: { kind: 'replace', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
        tags: ['autotomize', 'weight-class'],
        payload: { attribute: 'weight-class', operation: 'set', value: Math.max(1, weightClass - 1), rounding: 'floor' },
        dispel: { policy: 'matching-tags', tags: ['autotomize'] }, transferPolicy: 'expire',
      },
    },
  }
  return [
    reviewedStage({ slug: 'autotomize', id: 'raise-speed', recipients: 'actor', stage: 'spd', value: 2, phase: 'hit' }),
    weightEffect,
  ]
}

const dragonDarts = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => (
  context.selectedPlacements.length === 1
    ? [reviewedMultiHit({
        slug: 'dragon-darts', damageBase: 5, damageClass: 'physical', moveType: 'dragon',
        count: { kind: 'fixed', hits: 2 },
        accuracy: {
          kind: 'per-hit', rollId: 'dragon-darts.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 }, stopOnMiss: false,
        },
      })]
    : [standardAccuracy('dragon-darts'), damageOperation(context)]
)

const run = (context: RegisteredMoveHandlerContext) => {
  const name = context.intent.moveName
  let operations: readonly MoveEffectOperation[]
  if (name === 'Autotomize') operations = autotomize(context)
  else if (name === 'Dragon Darts') operations = dragonDarts(context)
  else if (name === 'Hex') operations = alternateDamage({
    context, slug: 'hex', normalBase: 7, boostedBase: 13,
    eligible: statusCount(target(context).state.conditionIds) > 0,
  })
  else if (name === 'Infernal Parade') operations = infernalParade(context)
  else if (name === 'Secret Power') operations = secretPower(context)
  else if (name === 'Smelling Salts') operations = [
    damageOperation(context), clearCondition('smelling-salts', 'paralyzed'),
  ]
  else if (name === 'Wake-Up Slap') operations = [
    damageOperation(context), clearCondition('wake-up-slap', 'sleep'), clearCondition('wake-up-slap', 'asleep'),
  ]
  else operations = [damageOperation(context)]

  return {
    operations,
    traceEntries: [{
      kind: 'predicate' as const,
      phase: 'declare' as const,
      predicateId: `dynamic-damage.${name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')}`,
      outcome: true,
      reasonCode: 'dynamic-damage.authoritative-context-resolved',
      input: { operationCount: operations.length },
    }],
  }
}

export const DYNAMIC_DAMAGE_218_225_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration =
  Object.freeze({ id: DYNAMIC_DAMAGE_218_225_HANDLER_ID, version: 1, run })
