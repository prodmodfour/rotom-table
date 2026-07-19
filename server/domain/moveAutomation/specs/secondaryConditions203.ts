import {
  FIERY_WRATH_DARK_BRANCH_ID,
  FIERY_WRATH_FIRE_BRANCH_ID,
  FREEZING_GLARE_ICE_BRANCH_ID,
  FREEZING_GLARE_PSYCHIC_BRANCH_ID,
} from '#shared/moveAutomation/canonicalMoveBranches'
import type {
  MoveConditionEffectOperation,
  MoveDamageClass,
  MoveDamageEffectOperation,
  MoveEffectOperation,
  MoveRollEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveSpec, MoveSpecTargetingDeclaration } from '#shared/moveAutomation/spec'
import { SECONDARY_CONDITIONS_203_HANDLER_ID } from '../handlers/secondaryConditions203'
import type { MoveSpecV2Registration } from '../registry'

const singleTarget = (): MoveSpecTargetingDeclaration => ({
  kind: 'single-target',
  minTargets: 1,
  maxTargets: 1,
  selector: { kind: 'selected-targets' },
})

const alternateSingleTarget = (
  baseBranchId: string,
  alternateBranchId: string,
): MoveSpecTargetingDeclaration => ({
  ...singleTarget(),
  branches: [{ id: baseBranchId, ...singleTarget() }, {
    id: alternateBranchId,
    ...singleTarget(),
  }],
})

const accuracyOperation = (input: {
  readonly slug: string
  readonly evasionRule?: boolean
}): MoveRollEffectOperation => ({
  id: `${input.slug}.accuracy`,
  kind: 'roll',
  source: { kind: 'move', id: `move.${input.slug}` },
  recipients: { kind: 'attacked-targets' },
  phase: 'accuracy',
  reasonCode: `${input.slug}.accuracy-check`,
  payload: {
    rollId: `${input.slug}.accuracy-roll`,
    formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
    ...(input.evasionRule
      ? {
          evasionRule: {
            kind: 'ignore-when-flanked' as const,
            sourceId: 'dynamic-punch.flanked-target',
            reasonCode: 'dynamic-punch.ignore-flanked-evasion',
          },
        }
      : {}),
  },
})

const damageOperation = (input: {
  readonly slug: string
  readonly damageBase: number
  readonly damageClass: MoveDamageClass
  readonly moveType: string
  readonly typeEffectiveness?: MoveDamageEffectOperation['payload']['typeEffectiveness']
  readonly attackStat?: MoveDamageEffectOperation['payload']['attackStat']
}): MoveDamageEffectOperation => ({
  id: `${input.slug}.damage`,
  kind: 'damage',
  source: { kind: 'operation', id: `${input.slug}.accuracy` },
  recipients: { kind: 'hit-targets' },
  phase: 'damage',
  reasonCode: `${input.slug}.damage`,
  payload: {
    damageClass: input.damageClass,
    damageBase: input.damageBase,
    moveType: input.moveType,
    accuracyRollId: `${input.slug}.accuracy-roll`,
    criticalRollId: `${input.slug}.accuracy-roll`,
    ...(input.typeEffectiveness ? { typeEffectiveness: input.typeEffectiveness } : {}),
    ...(input.attackStat ? { attackStat: input.attackStat } : {}),
  },
})

const conditionOperation = (input: {
  readonly slug: string
  readonly id: string
  readonly conditionId: string
  readonly trigger?: { readonly kind: 'range'; readonly minimum: number }
    | { readonly kind: 'natural-rolls'; readonly values: readonly number[] }
  readonly sourceOperationId?: string
}): MoveConditionEffectOperation => ({
  id: `${input.slug}.${input.id}`,
  kind: 'condition',
  source: {
    kind: 'operation',
    id: input.sourceOperationId ?? `${input.slug}.damage`,
  },
  recipients: { kind: 'hit-targets' },
  phase: 'after-damage',
  reasonCode: `${input.slug}.${input.id}`,
  payload: {
    action: 'apply',
    conditionId: input.conditionId,
    conditionSource: null,
    filter: null,
    randomChoice: null,
    ...(input.trigger
      ? {
          accuracyRollTrigger: {
            rollId: `${input.slug}.accuracy-roll`,
            trigger: input.trigger,
          },
        }
      : {}),
    applyTypeImmunity: true,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: input.conditionId === 'flinch'
      ? { kind: 'add-stack', maxStacks: 64 }
      : { kind: 'refresh', maxStacks: null },
  },
})

const usageOperation = (slug: string): MoveEffectOperation => ({
  id: `${slug}.usage`,
  kind: 'usage',
  source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: 'actor' },
  phase: 'usage',
  reasonCode: `${slug}.frequency-use`,
  payload: {
    action: 'spend',
    resourceId: `${slug}.frequency-use`,
    amount: 1,
  },
})

const logOperation = (slug: string): MoveEffectOperation => ({
  id: `${slug}.log-completed`,
  kind: 'log',
  source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: 'none' },
  phase: 'cleanup',
  reasonCode: `${slug}.completed`,
  payload: { messageKey: `move.${slug}.completed`, arguments: [] },
})

const fangCoinOperations = (
  slug: 'fire-fang' | 'ice-fang',
  typedCondition: 'burned' | 'frozen',
): readonly MoveEffectOperation[] => {
  const typedOperationId = `${slug}.coin-${typedCondition}`
  const flinchOperationId = `${slug}.coin-flinch`
  const coin: MoveRollEffectOperation = {
    id: `${slug}.secondary-coin`,
    kind: 'roll',
    source: { kind: 'operation', id: `${slug}.damage` },
    recipients: { kind: 'hit-targets' },
    phase: 'after-damage',
    reasonCode: `${slug}.secondary-coin`,
    payload: {
      rollId: `${slug}.secondary-coin-roll`,
      formula: { kind: 'table', tableId: `${slug}.secondary-coin-table` },
      table: {
        tableId: `${slug}.secondary-coin-table`,
        distribution: 'equal',
        entries: [{
          id: typedCondition,
          weight: null,
          operationIds: [typedOperationId],
          predicate: null,
        }, {
          id: 'flinch',
          weight: null,
          operationIds: [flinchOperationId],
          predicate: null,
        }],
        maximumRerolls: 0,
      },
    },
  }
  const coinTrigger = { kind: 'natural-rolls' as const, values: [18, 19] }
  const exactTwenty = { kind: 'natural-rolls' as const, values: [20] }
  return [
    coin,
    conditionOperation({
      slug,
      id: `coin-${typedCondition}`,
      conditionId: typedCondition,
      trigger: coinTrigger,
      sourceOperationId: coin.id,
    }),
    conditionOperation({
      slug,
      id: 'coin-flinch',
      conditionId: 'flinch',
      trigger: coinTrigger,
      sourceOperationId: coin.id,
    }),
    conditionOperation({
      slug,
      id: `natural-20-${typedCondition}`,
      conditionId: typedCondition,
      trigger: exactTwenty,
    }),
    conditionOperation({
      slug,
      id: 'natural-20-flinch',
      conditionId: 'flinch',
      trigger: exactTwenty,
    }),
  ]
}

const reviewedSpec = (input: {
  readonly canonicalId: string
  readonly slug: string
  readonly targeting?: MoveSpecTargetingDeclaration
  readonly operations: readonly MoveEffectOperation[]
  readonly handler?: boolean
  readonly tags: readonly string[]
}): MoveSpec => Object.freeze({
  schemaVersion: 2,
  canonicalId: input.canonicalId,
  version: 2,
  targeting: input.targeting ?? singleTarget(),
  preconditions: [],
  costs: [{
    id: `${input.slug}.cost.standard-action`,
    phase: 'pay' as const,
    cost: { kind: 'action-resource' as const, resource: 'standard' as const, amount: 1 },
  }],
  phases: [
    { phase: 'accuracy' as const, operations: [accuracyOperation({
      slug: input.slug,
      evasionRule: input.canonicalId === 'Dynamic Punch',
    })] },
    ...(['Fiery Wrath', 'Freezing Glare'].includes(input.canonicalId)
      ? []
      : [{ phase: 'damage' as const, operations: input.operations.filter(operation => operation.phase === 'damage') }]),
    ...(input.operations.some(operation => operation.phase === 'after-damage')
      ? [{ phase: 'after-damage' as const, operations: input.operations.filter(operation => operation.phase === 'after-damage') }]
      : []),
    { phase: 'usage' as const, operations: [usageOperation(input.slug)] },
    { phase: 'cleanup' as const, operations: [logOperation(input.slug)] },
  ],
  registeredHandlerId: input.handler ? SECONDARY_CONDITIONS_203_HANDLER_ID : null,
  presentation: {
    displayName: input.canonicalId,
    vfxKey: `move.${input.slug}`,
    tags: [...input.tags],
  },
})

export const CHATTER_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Chatter',
  slug: 'chatter',
  handler: true,
  tags: ['condition', 'damage', 'flying', 'sonic', 'reaction'],
  operations: [
    damageOperation({ slug: 'chatter', damageBase: 7, damageClass: 'special', moveType: 'flying' }),
    conditionOperation({
      slug: 'chatter',
      id: 'confusion',
      conditionId: 'confused',
      trigger: { kind: 'range', minimum: 16 },
    }),
  ],
})

export const DYNAMIC_PUNCH_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Dynamic Punch',
  slug: 'dynamic-punch',
  tags: ['condition', 'damage', 'fighting', 'flanking'],
  operations: [
    damageOperation({
      slug: 'dynamic-punch',
      damageBase: 10,
      damageClass: 'physical',
      moveType: 'fighting',
    }),
    conditionOperation({
      slug: 'dynamic-punch',
      id: 'confusion',
      conditionId: 'confused',
    }),
  ],
})

export const FIERY_WRATH_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Fiery Wrath',
  slug: 'fiery-wrath',
  handler: true,
  targeting: alternateSingleTarget(FIERY_WRATH_DARK_BRANCH_ID, FIERY_WRATH_FIRE_BRANCH_ID),
  tags: ['alternate-type', 'condition', 'damage', 'dark', 'fire'],
  operations: [],
})

export const FIRE_FANG_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Fire Fang',
  slug: 'fire-fang',
  tags: ['condition', 'damage', 'fire', 'random'],
  operations: [
    damageOperation({ slug: 'fire-fang', damageBase: 7, damageClass: 'physical', moveType: 'fire' }),
    ...fangCoinOperations('fire-fang', 'burned'),
  ],
})

export const FREEZE_DRY_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Freeze-Dry',
  slug: 'freeze-dry',
  tags: ['damage', 'ice', 'type-override'],
  operations: [damageOperation({
    slug: 'freeze-dry',
    damageBase: 7,
    damageClass: 'special',
    moveType: 'ice',
    typeEffectiveness: {
      immunity: 'honor',
      resistance: 'honor',
      weakness: 'honor',
      effectivenessOverride: null,
      defenderTypeOverrides: [{ defenderType: 'water', relation: 'weak' }],
    },
  })],
})

export const FREEZING_GLARE_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Freezing Glare',
  slug: 'freezing-glare',
  handler: true,
  targeting: alternateSingleTarget(
    FREEZING_GLARE_PSYCHIC_BRANCH_ID,
    FREEZING_GLARE_ICE_BRANCH_ID,
  ),
  tags: ['alternate-type', 'condition', 'damage', 'ice', 'psychic'],
  operations: [],
})

export const ICE_FANG_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Ice Fang',
  slug: 'ice-fang',
  tags: ['condition', 'damage', 'ice', 'random'],
  operations: [
    damageOperation({ slug: 'ice-fang', damageBase: 7, damageClass: 'physical', moveType: 'ice' }),
    ...fangCoinOperations('ice-fang', 'frozen'),
  ],
})

const actorStat = (stat: 'attack' | 'special-attack') => ({
  kind: 'stat' as const,
  subject: { kind: 'actor' as const },
  stat,
  combatStagePolicy: 'honor' as const,
  stageModifierPolicy: 'honor' as const,
})

const targetDefense = (stat: 'defense' | 'special-defense') => ({
  kind: 'stat' as const,
  subject: { kind: 'current-target' as const },
  stat,
  combatStagePolicy: 'honor' as const,
  stageModifierPolicy: 'honor' as const,
})

export const SHELL_SIDE_ARM_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Shell Side Arm',
  slug: 'shell-side-arm',
  tags: ['alternate-damage-class', 'condition', 'damage', 'poison', 'stat-selection'],
  operations: [
    damageOperation({
      slug: 'shell-side-arm',
      damageBase: 9,
      moveType: 'poison',
      damageClass: {
        kind: 'compare-stats',
        operator: 'less-than',
        left: targetDefense('defense'),
        right: targetDefense('special-defense'),
        whenTrue: 'physical',
        whenFalse: 'special',
      },
      attackStat: {
        kind: 'max',
        values: [actorStat('attack'), actorStat('special-attack')],
      },
    }),
    conditionOperation({
      slug: 'shell-side-arm',
      id: 'poison',
      conditionId: 'poisoned',
      trigger: { kind: 'range', minimum: 17 },
    }),
  ],
})

const registration = (
  canonicalId: string,
  spec: MoveSpec,
): MoveSpecV2Registration => Object.freeze({
  canonicalId,
  sourceModule: 'server/domain/moveAutomation/specs/secondaryConditions203.ts',
  spec,
})

export const SECONDARY_CONDITIONS_203_MOVE_SPEC_REGISTRATIONS = Object.freeze([
  registration('Chatter', CHATTER_MOVE_SPEC),
  registration('Dynamic Punch', DYNAMIC_PUNCH_MOVE_SPEC),
  registration('Fiery Wrath', FIERY_WRATH_MOVE_SPEC),
  registration('Fire Fang', FIRE_FANG_MOVE_SPEC),
  registration('Freeze-Dry', FREEZE_DRY_MOVE_SPEC),
  registration('Freezing Glare', FREEZING_GLARE_MOVE_SPEC),
  registration('Ice Fang', ICE_FANG_MOVE_SPEC),
  registration('Shell Side Arm', SHELL_SIDE_ARM_MOVE_SPEC),
])
