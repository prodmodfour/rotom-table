import { createHash } from 'node:crypto'
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
  MoveReactionRequestEffectOperation,
  MoveUsageEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  isMoveUsageTransitionError,
  planMoveUsageTransition,
} from '../../planMoveUsageTransition'
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'
import { MOVE_SONIC_CANCELLATION_PRIORITY } from '../setupReactionDefinitions'

export const SECONDARY_CONDITIONS_203_HANDLER_ID =
  'ma203.secondary-condition-outliers' as const

const DROWN_OUT_MOVE_KEY = 'drown-out' as const
const DROWN_OUT_FREQUENCY = 'Scene x2' as const

const stablePlacementSuffix = (placementId: string): string => createHash('sha256')
  .update(placementId, 'utf8')
  .digest('hex')
  .slice(0, 16)

const normalizedAbility = (value: string): string => value.trim().toLowerCase()

const drownOutAvailable = (
  context: RegisteredMoveHandlerContext,
  placementId: string,
): boolean => {
  const placement = context.queries.placements.get(placementId)
  const sheet = placement ? context.queries.sheets.forPlacement(placement) : null
  if (!placement || !sheet) return false
  try {
    planMoveUsageTransition({
      map: context.map,
      sheetMoveUsage: sheet.sheet.moveUsage,
      placementId,
      move: {
        moveName: 'Drown Out',
        moveKey: DROWN_OUT_MOVE_KEY,
        frequency: DROWN_OUT_FREQUENCY,
      },
      usedAt: context.map.updatedAt,
      change: { action: 'spend', amount: 1 },
    })
    return true
  }
  catch (error) {
    if (isMoveUsageTransitionError(error)) return false
    throw error
  }
}

const drownOutHolderIds = (
  context: RegisteredMoveHandlerContext,
): readonly string[] => {
  const actorId = context.actor.placement.id
  const tokenById = new Map(context.queries.tokens.all().map(token => [token.id, token]))
  const holders: string[] = []
  // Absence is a mechanics decision: record every placed sheet whose current
  // ability projection was inspected, not only positive providers.
  for (const placement of context.queries.placements.all()) {
    context.reads.recordPlacement(placement)
    if (placement.id === actorId) continue
    const token = tokenById.get(placement.id)
    if (!token?.abilityNames?.some(name => normalizedAbility(name) === 'drown out')) continue
    if (context.queries.relationships.resolve(placement.id, actorId).relationship !== 'enemy') {
      continue
    }
    if (drownOutAvailable(context, placement.id)) holders.push(placement.id)
  }
  return Object.freeze(holders)
}

const drownOutOperations = (
  context: RegisteredMoveHandlerContext,
): readonly MoveEffectOperation[] => {
  const holders = drownOutHolderIds(context)
  const requests: MoveReactionRequestEffectOperation[] = []
  const usage: MoveUsageEffectOperation[] = []
  for (const placementId of holders) {
    const suffix = stablePlacementSuffix(placementId)
    const requestOperationId = `chatter.drown-out-request.${suffix}`
    requests.push({
      id: requestOperationId,
      kind: 'reaction-request',
      source: { kind: 'move', id: 'move.chatter' },
      recipients: { kind: 'none' },
      phase: 'declare',
      reasonCode: 'drown-out.cancellation-window',
      payload: {
        requestId: `drown-out.cancellation-request.${suffix}`,
        promptKey: 'ability.drown-out.reaction-response',
        options: [{
          id: 'ability.drown-out.use',
          labelKey: 'ability.drown-out.cancel-sonic-move',
        }],
        allowPass: true,
        timing: 'declare',
        priority: MOVE_SONIC_CANCELLATION_PRIORITY,
        ownerPlacementIds: [placementId],
        cancellation: {
          kind: 'cancel-move',
          retainTriggeringUsage: true,
        },
      },
    })
    usage.push({
      id: `chatter.drown-out-usage.${suffix}`,
      kind: 'usage',
      source: { kind: 'operation', id: requestOperationId },
      recipients: { kind: 'response-owner' },
      phase: 'usage',
      reasonCode: 'drown-out.frequency-use',
      payload: {
        action: 'spend',
        resourceId: `drown-out.frequency-use.${suffix}`,
        amount: 1,
        resource: {
          moveName: 'Drown Out',
          moveKey: DROWN_OUT_MOVE_KEY,
          frequency: DROWN_OUT_FREQUENCY,
        },
      },
    })
  }
  return Object.freeze([...requests, ...usage])
}

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
    const operations = drownOutOperations(context)
    return {
      operations,
      traceEntries: [{
        kind: 'predicate' as const,
        phase: 'declare' as const,
        predicateId: 'chatter.drown-out-available',
        outcome: operations.length > 0,
        reasonCode: operations.length > 0
          ? 'chatter.drown-out-window-required'
          : 'chatter.no-drown-out-holder',
        input: { requestCount: operations.length / 2 },
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
    version: 1,
    run: runSecondaryConditions203Handler,
  })
