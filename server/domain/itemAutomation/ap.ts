import { createHash } from 'node:crypto'
import { featureApAvailable, type FeatureApState } from '#shared/featureAutomation/state'
import type { ItemActionCostSpec } from '#shared/itemAutomation/spec'
import type { ItemOperationPlanV1 } from '#shared/itemAutomation/operations'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  resolveTrainerFeatureApState,
} from '../featureAutomation/resources'

export interface ItemApDrainPreview {
  readonly amount: number
  readonly availableBefore: number
  readonly availableAfter: number
  readonly state: FeatureApState
}

const fail = (message: string): never => { throw new Error(message) }

const drainCost = (cost: ItemActionCostSpec): number => {
  if (cost.kind !== 'ap' || cost.resourceId !== 'drain'
    || !Number.isSafeInteger(cost.amount) || cost.amount < 1) {
    return fail('Item AP cost is not a reviewed positive drain.')
  }
  return cost.amount
}

/** Resolve one AP drain from authoritative Feature AP state without mutation. */
export const previewItemApDrain = (input: {
  readonly sheet: TrainerSheet
  readonly cost: ItemActionCostSpec
  readonly now: number
  readonly round: number | null
}): ItemApDrainPreview => {
  if (!Number.isSafeInteger(input.now) || input.now < 0
    || (input.round !== null && (!Number.isSafeInteger(input.round) || input.round < 0))) {
    return fail('Item AP drain requires a valid authoritative time boundary.')
  }
  const amount = drainCost(input.cost)
  const state = resolveTrainerFeatureApState(input.sheet)
  const availableBefore = featureApAvailable(state, input.now, input.round)
  if (availableBefore < amount) return fail(`The item actor requires ${amount} available AP.`)
  return Object.freeze({
    amount,
    availableBefore,
    availableAfter: availableBefore - amount,
    state,
  })
}

/** Re-evaluate time-sensitive AP availability immediately before commit. */
export const assertPlannedItemApDrainsCurrent = (input: {
  readonly plan: ItemOperationPlanV1
  readonly sheets: ReadonlyMap<string, AnyLiveSheet>
  readonly now: number
}): void => {
  if (!Number.isSafeInteger(input.now) || input.now < 0) fail('Item AP commit check requires a valid server timestamp.')
  for (const operation of input.plan.operations) {
    if (operation.kind !== 'resource' || operation.payload.action !== 'drain-ap') continue
    if (operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'trainer') {
      fail('Item AP drain lost its authoritative Trainer aggregate.')
    }
    const sheet = input.sheets.get(`trainer:${operation.aggregate.id}`)
    if (!sheet) fail('Item AP actor sheet is unavailable at commit.')
    const amount = operation.payload.amount
    const round = operation.payload.round
    if (!Number.isSafeInteger(amount) || Number(amount) < 1
      || (round !== null && (!Number.isSafeInteger(round) || Number(round) < 0))) {
      fail('Item AP drain payload is invalid at commit.')
    }
    const preview = previewItemApDrain({
      sheet: sheet as TrainerSheet,
      cost: { kind: 'ap', resourceId: 'drain', amount: Number(amount), label: 'Item AP drain' },
      now: input.now,
      round: round === null ? null : Number(round),
    })
    if (preview.availableBefore !== operation.payload.availableBefore
      || preview.availableAfter !== operation.payload.availableAfter) {
      fail('Item AP availability changed after planning.')
    }
  }
}

export const itemApDrainId = (operationId: string): string => (
  `item-ap-drain:${createHash('sha256').update(operationId).digest('hex').slice(0, 32)}`
)

/** Apply exactly one immutable, Extended-Rest-recoverable AP drain. */
export const applyItemApDrain = (input: {
  readonly sheet: TrainerSheet
  readonly operationId: string
  readonly canonicalItemId: string
  readonly sourceInstanceId: string
  readonly amount: number
  readonly availableBefore: number
  readonly availableAfter: number
  readonly createdAt: number
  readonly round: number | null
}): TrainerSheet => {
  const preview = previewItemApDrain({
    sheet: input.sheet,
    cost: { kind: 'ap', resourceId: 'drain', amount: input.amount, label: 'Item AP drain' },
    now: input.createdAt,
    round: input.round,
  })
  if (preview.availableBefore !== input.availableBefore
    || preview.availableAfter !== input.availableAfter) {
    return fail('Item AP drain no longer matches authoritative AP state.')
  }
  if (preview.state.drains.length >= 1_024) return fail('Item AP drain storage reached its bounded limit.')
  const drainId = itemApDrainId(input.operationId)
  if (preview.state.drains.some(drain => drain.drainId === drainId)) {
    return fail(`Item AP drain ${drainId} already exists.`)
  }
  const next = structuredClone(input.sheet)
  next.featureApState = Object.freeze({
    ...preview.state,
    drains: Object.freeze([...preview.state.drains, Object.freeze({
      drainId,
      sourceInstanceId: input.sourceInstanceId,
      canonicalId: input.canonicalItemId,
      amount: input.amount,
      recovery: 'extended-rest' as const,
      createdAt: input.createdAt,
    })]),
  })
  return next
}
