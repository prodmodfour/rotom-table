import type {
  MoveBranchEffectOperation,
  MoveConditionEffectOperation,
  MoveEffectOperation,
  MoveUsageEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'
import {
  reviewedDamage,
  reviewedHeal,
  reviewedStage,
} from '../specs/reviewedSpecBuilder'

export const HP_COHORTS_211_217_HANDLER_ID = 'ma211-217.hp-outliers' as const

const dynamicDamageMoves = new Set([
  'Brine', 'Crush Grip', 'Dragon Energy', 'Eruption', 'Water Spout', 'Wring Out',
])

const ratio = (current: number, maximum: number): number => (
  maximum > 0 ? Math.max(0, Math.min(1, current / maximum)) : 0
)

const dynamicDamageBase = (context: RegisteredMoveHandlerContext): number => {
  const name = context.intent.moveName
  if (name === 'Brine' || name === 'Crush Grip' || name === 'Wring Out') {
    const target = context.selectedPlacements[0]
    if (!target) throw new Error(`${name} requires one authoritative target.`)
    context.reads.recordPlacement(target)
    const token = context.queries.tokens.get(target.id)
    if (!token) throw new Error(`${name} target is unavailable.`)
    const hpRatio = ratio(token.currentHp, token.fullMaxHp ?? token.maxHp)
    if (name === 'Brine') return hpRatio < 0.5 ? 13 : 7
    return Math.max(1, 12 - Math.floor((1 - hpRatio) * 10 + 1e-9))
  }
  const actor = context.actor.token
  const hpRatio = ratio(actor.currentHp, actor.fullMaxHp ?? actor.maxHp)
  return Math.max(1, 15 - Math.floor((1 - hpRatio) * 10 + 1e-9))
}

const dynamicDamageOperation = (context: RegisteredMoveHandlerContext): MoveEffectOperation => {
  const definitions: Record<string, {
    readonly slug: string
    readonly damageClass: 'physical' | 'special'
    readonly moveType: string
    readonly area: boolean
  }> = {
    Brine: { slug: 'brine', damageClass: 'special', moveType: 'water', area: false },
    'Crush Grip': { slug: 'crush-grip', damageClass: 'physical', moveType: 'normal', area: false },
    'Dragon Energy': { slug: 'dragon-energy', damageClass: 'special', moveType: 'dragon', area: true },
    Eruption: { slug: 'eruption', damageClass: 'special', moveType: 'fire', area: true },
    'Water Spout': { slug: 'water-spout', damageClass: 'special', moveType: 'water', area: true },
    'Wring Out': { slug: 'wring-out', damageClass: 'special', moveType: 'normal', area: false },
  }
  const definition = definitions[context.intent.moveName]!
  return reviewedDamage({
    slug: definition.slug,
    damageBase: dynamicDamageBase(context),
    damageClass: definition.damageClass,
    moveType: definition.moveType,
    ...(definition.area ? {} : { recipients: 'hit-targets' as const }),
  })
}

const STAT_OPTIONS = Object.freeze([
  ['atk', 'attack'],
  ['def', 'defense'],
  ['satk', 'special-attack'],
  ['sdef', 'special-defense'],
  ['spd', 'speed'],
] as const)

type StageId = (typeof STAT_OPTIONS)[number][0]
type StatId = (typeof STAT_OPTIONS)[number][1]

const statValue = (
  context: RegisteredMoveHandlerContext,
  placementId: string,
  stat: StatId,
): number => context.queries.stats.resolve(placementId, {
  stat,
  combatStagePolicy: 'honor',
  stageModifierPolicy: 'honor',
})?.value ?? (() => { throw new Error(`${stat} is unavailable for ${placementId}.`) })()

const highestStages = (
  context: RegisteredMoveHandlerContext,
  placementId: string,
  allowed: readonly (readonly [StageId, StatId])[] = STAT_OPTIONS,
): { readonly value: number; readonly stages: readonly StageId[] } => {
  const values = allowed.map(([stage, stat]) => ({ stage, value: statValue(context, placementId, stat) }))
  const maximum = Math.max(...values.map(value => value.value))
  return { value: maximum, stages: values.filter(value => value.value === maximum).map(value => value.stage) }
}

const stageChoice = (input: {
  readonly slug: string
  readonly recipients: 'actor' | 'hit-targets'
  readonly stages: readonly StageId[]
  readonly value: number
  readonly sourceOperationId: string
  readonly reason: 'raise' | 'lower'
  readonly healAmount?: number
}): readonly MoveEffectOperation[] => {
  const stageOperations = input.stages.map(stage => reviewedStage({
    slug: input.slug,
    id: `${input.reason}-${stage}`,
    recipients: input.recipients,
    stage: 'selected-stat',
    selectedStage: stage,
    value: input.value,
    sourceOperationId: input.sourceOperationId,
  }))
  if (input.stages.length === 1) {
    const stage = stageOperations[0]!
    return [
      stage,
      ...(input.healAmount === undefined ? [] : [reviewedHeal({
        slug: input.slug,
        id: `heal-from-${input.stages[0]}`,
        recipients: 'actor',
        calculation: { kind: 'fixed', value: input.healAmount },
        sourceOperationId: stage.id,
        operationOutcomeTrigger: { operationId: stage.id, outcome: 'applied' },
      })]),
    ]
  }
  const branchId = `${input.slug}.choose-highest-stat`
  const options = input.stages.map(stage => ({
    id: stage,
    labelKey: `stat.${stage}`,
    operationIds: [
      `${input.slug}.${input.reason}-${stage}`,
      ...(input.healAmount === undefined ? [] : [`${input.slug}.heal-from-${stage}`]),
    ],
  }))
  const choice: MoveBranchEffectOperation = {
    id: branchId,
    kind: 'branch',
    source: { kind: 'operation', id: input.sourceOperationId },
    recipients: { kind: input.recipients },
    phase: 'after-damage',
    reasonCode: `${input.slug}.choose-highest-stat`,
    payload: {
      kind: 'choice',
      selectionId: `${input.slug}.highest-stat`,
      scope: 'resolution',
      owner: 'actor',
      requestId: `${input.slug}.highest-stat`,
      promptKey: `move.${input.slug}.choose-highest-stat`,
      options,
      pass: null,
    },
  }
  return [
    choice,
    ...stageOperations,
    ...(input.healAmount === undefined ? [] : input.stages.map(stage => reviewedHeal({
      slug: input.slug,
      id: `heal-from-${stage}`,
      recipients: 'actor',
      calculation: { kind: 'fixed', value: input.healAmount! },
      sourceOperationId: `${input.slug}.${input.reason}-${stage}`,
      operationOutcomeTrigger: {
        operationId: `${input.slug}.${input.reason}-${stage}`,
        outcome: 'applied',
      },
    }))),
  ]
}

const mysticalPower = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const highest = highestStages(context, context.actor.placement.id)
  return stageChoice({
    slug: 'mystical-power',
    recipients: 'actor',
    stages: highest.stages,
    value: 1,
    sourceOperationId: 'mystical-power.damage',
    reason: 'raise',
  })
}

const strengthSap = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const target = context.selectedPlacements[0]
  if (!target) throw new Error('Strength Sap requires one authoritative target.')
  const highest = highestStages(context, target.id, [
    ['atk', 'attack'],
    ['satk', 'special-attack'],
  ])
  return stageChoice({
    slug: 'strength-sap',
    recipients: 'hit-targets',
    stages: highest.stages,
    value: -1,
    sourceOperationId: 'strength-sap.accuracy',
    reason: 'lower',
    healAmount: Math.max(0, Math.floor(highest.value)),
  })
}

const pollenPuffUsage = (
  context: RegisteredMoveHandlerContext,
): readonly MoveEffectOperation[] => {
  const target = context.selectedPlacements[0]
  if (!target) throw new Error('Pollen Puff requires one authoritative target.')
  const relationship = context.queries.relationships.resolve(
    context.actor.placement.id,
    target.id,
  ).relationship
  if (relationship !== 'ally') return []
  const usage: MoveUsageEffectOperation = {
    id: 'pollen-puff.ally-usage',
    kind: 'usage',
    source: { kind: 'move', id: 'move.pollen-puff' },
    recipients: { kind: 'actor' },
    phase: 'usage',
    reasonCode: 'pollen-puff.ally-once-per-scene',
    payload: {
      action: 'spend',
      resourceId: 'pollen-puff.ally-use',
      amount: 1,
      resource: {
        moveName: 'Pollen Puff (Ally)',
        moveKey: 'pollen-puff-ally',
        frequency: 'Scene',
      },
    },
  }
  return [usage]
}

const purify = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const target = context.selectedPlacements[0]
  if (!target) throw new Error('Purify requires one authoritative target.')
  const state = context.queries.targetStates.resolve(target.id)
  if (!state) throw new Error('Purify target state is unavailable.')
  const removableCount = state.conditionIds.length
  const clear: MoveConditionEffectOperation = {
    id: 'purify.clear-statuses',
    kind: 'condition',
    source: { kind: 'move', id: 'move.purify' },
    recipients: { kind: 'selected-targets' },
    phase: 'hit',
    reasonCode: 'purify.clear-permanent-and-volatile',
    payload: {
      action: 'clear',
      conditionId: null,
      conditionSource: null,
      filter: {
        groups: ['persistent', 'volatile'],
        conditionIds: [],
        excludedConditionIds: [],
      },
      randomChoice: null,
      duration: null,
      saveTiming: 'canonical',
      stackPolicy: { kind: 'refresh', maxStacks: null },
    },
  }
  const tick = Math.max(1, Math.floor((context.actor.token.fullMaxHp ?? context.actor.token.maxHp) / 10))
  return [
    clear,
    reviewedHeal({
      slug: 'purify',
      id: 'heal-per-status',
      recipients: 'actor',
      calculation: { kind: 'fixed', value: tick * removableCount },
      sourceOperationId: clear.id,
      operationOutcomeTrigger: { operationId: clear.id, outcome: 'applied' },
    }),
  ]
}

const run = (context: RegisteredMoveHandlerContext) => {
  let operations: readonly MoveEffectOperation[]
  if (dynamicDamageMoves.has(context.intent.moveName)) operations = [dynamicDamageOperation(context)]
  else if (context.intent.moveName === 'Mystical Power') operations = mysticalPower(context)
  else if (context.intent.moveName === 'Strength Sap') operations = strengthSap(context)
  else if (context.intent.moveName === 'Purify') operations = purify(context)
  else if (context.intent.moveName === 'Pollen Puff') operations = pollenPuffUsage(context)
  else throw new Error(`HP cohort handler cannot execute ${context.intent.moveName}.`)
  return {
    operations,
    traceEntries: [{
      kind: 'predicate' as const,
      phase: 'declare' as const,
      predicateId: `hp-cohort.${context.intent.moveName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      outcome: true,
      reasonCode: 'hp-cohort.authoritative-context-resolved',
      input: { operationCount: operations.length },
    }],
  }
}

export const HP_COHORTS_211_217_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration =
  Object.freeze({ id: HP_COHORTS_211_217_HANDLER_ID, version: 1, run })
