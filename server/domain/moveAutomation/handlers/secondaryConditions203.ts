import {
  FIERY_WRATH_DARK_BRANCH_ID,
  FIERY_WRATH_FIRE_BRANCH_ID,
  FREEZING_GLARE_ICE_BRANCH_ID,
  FREEZING_GLARE_PSYCHIC_BRANCH_ID,
} from '#shared/moveAutomation/canonicalMoveBranches'
import type {
  MoveConditionEffectOperation,
  MoveDamageEffectOperation,
  MoveEffectOperation,
  MoveUsageEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'

export const SECONDARY_CONDITIONS_203_HANDLER_ID =
  'ma203.secondary-condition-outliers' as const

const conditionOperation = (input: {
  readonly id: string
  readonly damageOperationId: string
  readonly conditionId: string
  readonly minimum: number
}): MoveConditionEffectOperation => ({
  id: input.id,
  kind: 'condition',
  source: { kind: 'operation', id: input.damageOperationId },
  recipients: { kind: 'hit-targets' },
  phase: 'after-damage',
  reasonCode: `${input.id}.threshold`,
  payload: {
    action: 'apply',
    conditionId: input.conditionId,
    conditionSource: null,
    filter: null,
    randomChoice: null,
    accuracyRollTrigger: {
      rollId: input.damageOperationId.replace(/\.damage$/, '.accuracy-roll'),
      trigger: { kind: 'range', minimum: input.minimum },
    },
    applyTypeImmunity: true,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: input.conditionId === 'flinch'
      ? { kind: 'add-stack', maxStacks: 64 }
      : { kind: 'refresh', maxStacks: null },
  },
})

const alternateTypeOperations = (
  context: RegisteredMoveHandlerContext,
): readonly MoveEffectOperation[] => {
  const fiery = context.intent.moveName === 'Fiery Wrath'
  const moveSlug = fiery ? 'fiery-wrath' : 'freezing-glare'
  const canonicalMove = fiery ? 'Fiery Wrath' : 'Freezing Glare'
  const selectedBranch = context.intent.targetBranchId
  const alternate = fiery
    ? selectedBranch === FIERY_WRATH_FIRE_BRANCH_ID
    : selectedBranch === FREEZING_GLARE_ICE_BRANCH_ID
  const expectedBase = fiery
    ? FIERY_WRATH_DARK_BRANCH_ID
    : FREEZING_GLARE_PSYCHIC_BRANCH_ID
  if (!alternate && selectedBranch !== expectedBase) {
    throw new Error(`${canonicalMove} has an unavailable reviewed type branch.`)
  }
  const damageOperationId = `${moveSlug}.damage`
  const damage: MoveDamageEffectOperation = {
    id: damageOperationId,
    kind: 'damage',
    source: { kind: 'operation', id: `${moveSlug}.accuracy` },
    recipients: { kind: 'hit-targets' },
    phase: 'damage',
    reasonCode: `${moveSlug}.${alternate ? 'alternate' : 'base'}-type-damage`,
    payload: {
      damageClass: 'special',
      damageBase: 9,
      moveType: fiery
        ? alternate ? 'fire' : 'dark'
        : alternate ? 'ice' : 'psychic',
      accuracyRollId: `${moveSlug}.accuracy-roll`,
      criticalRollId: `${moveSlug}.accuracy-roll`,
    },
  }
  const threshold = conditionOperation({
    id: `${moveSlug}.${fiery ? 'flinch' : 'freeze'}`,
    damageOperationId,
    conditionId: fiery ? 'flinch' : 'frozen',
    minimum: fiery ? 17 : 19,
  })
  const alternateUsage: MoveUsageEffectOperation[] = alternate
    ? [{
        id: `${moveSlug}.alternate-type-usage`,
        kind: 'usage',
        source: { kind: 'move', id: `move.${moveSlug}` },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: `${moveSlug}.alternate-type-once-per-scene`,
        payload: {
          action: 'spend',
          resourceId: `${moveSlug}.alternate-type-scene-use`,
          amount: 1,
          resource: {
            moveName: `${canonicalMove} (${fiery ? 'Fire' : 'Ice'} Type)`,
            moveKey: `${moveSlug}-alternate-type`,
            frequency: 'Scene',
          },
        },
      }]
    : []
  return Object.freeze([damage, threshold, ...alternateUsage])
}

const runSecondaryConditions203Handler = (context: RegisteredMoveHandlerContext) => {
  if (context.intent.moveName === 'Chatter') {
    return {
      operations: [],
      traceEntries: [{
        kind: 'predicate' as const,
        phase: 'declare' as const,
        predicateId: 'chatter.drown-out-ability-runtime',
        outcome: true,
        reasonCode: 'chatter.drown-out-delegated-to-ability-runtime',
        input: { requestCount: 0 },
      }],
    }
  }
  if (context.intent.moveName === 'Fiery Wrath' || context.intent.moveName === 'Freezing Glare') {
    const operations = alternateTypeOperations(context)
    return {
      operations,
      traceEntries: [{
        kind: 'predicate' as const,
        phase: 'target' as const,
        predicateId: `${context.intent.moveName === 'Fiery Wrath' ? 'fiery-wrath' : 'freezing-glare'}.alternate-type`,
        outcome: operations.some(operation => operation.kind === 'usage'),
        reasonCode: operations.some(operation => operation.kind === 'usage')
          ? 'alternate-type-selected'
          : 'base-type-selected',
        input: { targetBranchId: context.intent.targetBranchId ?? null },
      }],
    }
  }
  throw new Error(`MA-203 handler cannot execute ${context.intent.moveName}.`)
}

export const SECONDARY_CONDITIONS_203_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration =
  Object.freeze({
    id: SECONDARY_CONDITIONS_203_HANDLER_ID,
    version: 2,
    run: runSecondaryConditions203Handler,
  })
