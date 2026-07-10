import type { TabletopMap } from '~/types/map'
import type { MapMoveUsageState, SheetMoveUsageState } from '~/types/moveUsage'
import {
  eotMoveUsageState,
  getMapMoveUsageEntry,
  getSheetDailyMoveUsageEntry,
  limitedMoveUsageState,
  mapMoveUsageSceneMatches,
  normalizeMapMoveUsage,
  normalizeMoveUsageRound,
  normalizeSheetMoveUsage,
  parseMoveFrequency,
  recordMapMoveUsage,
  recordSheetDailyMoveUsage,
  type MoveFrequencyKind,
  type ParsedMoveFrequency,
} from '~/utils/moveUsage'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'

export type UseMoveTracking = 'map' | 'sheet' | 'none'

export interface UseMoveUsageSummary {
  readonly moveName: string
  readonly moveKey: string
  readonly frequency: string
  readonly frequencyKind: MoveFrequencyKind
  readonly tracking: UseMoveTracking
  readonly uses: number
  readonly maxUses?: number
  readonly remainingUses?: number
  readonly sceneUses?: number
  readonly sceneMaxUses?: number
  readonly sceneRemainingUses?: number
  readonly sceneAvailable?: boolean
  readonly lastUsedRound?: number | null
  readonly nextAvailableRound?: number | null
  readonly available: boolean
}

export type MoveUsageTransitionFailureReason = 'invalid' | 'conflict'

export type MoveUsageTransitionFailureCode =
  | 'invalid-placement-id'
  | 'invalid-move-name'
  | 'invalid-move-key'
  | 'invalid-used-at'
  | 'invalid-usage-action'
  | 'invalid-usage-amount'
  | 'eot-unavailable'
  | 'scene-unavailable'
  | 'daily-unavailable'
  | 'daily-scene-unavailable'

export class MoveUsageTransitionError extends Error {
  readonly reason: MoveUsageTransitionFailureReason
  readonly code: MoveUsageTransitionFailureCode
  readonly currentUsage?: UseMoveUsageSummary

  constructor(
    reason: MoveUsageTransitionFailureReason,
    code: MoveUsageTransitionFailureCode,
    message: string,
    currentUsage?: UseMoveUsageSummary,
  ) {
    super(message)
    this.name = 'MoveUsageTransitionError'
    this.reason = reason
    this.code = code
    if (currentUsage !== undefined) this.currentUsage = currentUsage
  }
}

export interface MoveUsageTransitionMove {
  readonly moveName: string
  readonly moveKey: string
  readonly frequency?: string | null
}

export type MoveUsageTransitionAction = 'spend' | 'restore' | 'set'

export interface MoveUsageTransitionChange {
  readonly action: MoveUsageTransitionAction
  /** Non-negative number of uses to spend/restore, or the exact count for set. */
  readonly amount: number
}

export interface PlanMoveUsageTransitionInput {
  readonly map: Pick<TabletopMap, 'moveUsage' | 'activeScene' | 'initiative'>
  readonly sheetMoveUsage?: SheetMoveUsageState
  readonly placementId: string
  readonly move: MoveUsageTransitionMove
  readonly usedAt?: number
  /** Defaults to spending one use for the accepted move. */
  readonly change?: MoveUsageTransitionChange
}

export interface PlannedMoveUsageTransition {
  readonly tracking: UseMoveTracking
  readonly frequency: ParsedMoveFrequency
  readonly previousUsage: UseMoveUsageSummary
  readonly usage: UseMoveUsageSummary
  /** Distinguishes a cleared usage bucket from a resource that was not touched. */
  readonly mapUsageChanged: boolean
  readonly sheetUsageChanged: boolean
  readonly nextMapMoveUsage?: MapMoveUsageState
  readonly nextSheetMoveUsage?: SheetMoveUsageState
}

const maxUsesFor = (frequency: ParsedMoveFrequency): number =>
  Math.max(1, frequency.usesPerPeriod ?? 1)

const assertValidInput = (input: PlanMoveUsageTransitionInput): void => {
  if (!input.placementId.trim()) {
    throw new MoveUsageTransitionError('invalid', 'invalid-placement-id', 'Move usage placement id is required.')
  }
  if (!input.move.moveName.trim()) {
    throw new MoveUsageTransitionError('invalid', 'invalid-move-name', 'Move usage move name is required.')
  }
  if (!input.move.moveKey.trim()) {
    throw new MoveUsageTransitionError('invalid', 'invalid-move-key', 'Move usage key is required.')
  }
  if (input.usedAt !== undefined && !Number.isFinite(input.usedAt)) {
    throw new MoveUsageTransitionError('invalid', 'invalid-used-at', 'Move usage timestamp must be finite when supplied.')
  }
  if (
    input.change !== undefined
    && input.change.action !== 'spend'
    && input.change.action !== 'restore'
    && input.change.action !== 'set'
  ) {
    throw new MoveUsageTransitionError('invalid', 'invalid-usage-action', 'Move usage action must be spend, restore, or set.')
  }
  if (
    input.change !== undefined
    && (!Number.isSafeInteger(input.change.amount) || input.change.amount < 0)
  ) {
    throw new MoveUsageTransitionError('invalid', 'invalid-usage-amount', 'Move usage amount must be a safe non-negative integer.')
  }
}

const untrackedUsageSummary = (
  move: MoveUsageTransitionMove,
  frequency: ParsedMoveFrequency,
): UseMoveUsageSummary => ({
  moveName: move.moveName,
  moveKey: move.moveKey,
  frequency: frequency.raw,
  frequencyKind: frequency.kind,
  tracking: 'none',
  uses: 0,
  available: true,
})

const eotUsageSummary = (
  move: MoveUsageTransitionMove,
  frequency: ParsedMoveFrequency,
  state: ReturnType<typeof eotMoveUsageState>,
): UseMoveUsageSummary => ({
  moveName: move.moveName,
  moveKey: move.moveKey,
  frequency: frequency.raw || 'EOT',
  frequencyKind: 'eot',
  tracking: 'map',
  uses: state.uses,
  lastUsedRound: state.lastUsedRound,
  nextAvailableRound: state.nextAvailableRound,
  available: state.available,
})

const limitedUsageSummary = (
  move: MoveUsageTransitionMove,
  frequency: ParsedMoveFrequency,
  tracking: Extract<UseMoveTracking, 'map' | 'sheet'>,
  state: ReturnType<typeof limitedMoveUsageState>,
): UseMoveUsageSummary => ({
  moveName: move.moveName,
  moveKey: move.moveKey,
  frequency: frequency.raw,
  frequencyKind: frequency.kind,
  tracking,
  uses: state.uses,
  maxUses: state.maxUses,
  remainingUses: state.remainingUses,
  available: state.available,
})

const dailyUsageSummary = (
  move: MoveUsageTransitionMove,
  frequency: ParsedMoveFrequency,
  dailyState: ReturnType<typeof limitedMoveUsageState>,
  sceneState: ReturnType<typeof limitedMoveUsageState>,
): UseMoveUsageSummary => ({
  moveName: move.moveName,
  moveKey: move.moveKey,
  frequency: frequency.raw,
  frequencyKind: 'daily',
  tracking: 'sheet',
  uses: dailyState.uses,
  maxUses: dailyState.maxUses,
  remainingUses: dailyState.remainingUses,
  sceneUses: sceneState.uses,
  sceneMaxUses: sceneState.maxUses,
  sceneRemainingUses: sceneState.remainingUses,
  sceneAvailable: sceneState.available,
  available: dailyState.available && sceneState.available,
})

const detachedMapMoveUsage = (usage: MapMoveUsageState | undefined): MapMoveUsageState | undefined =>
  usage === undefined ? undefined : deepCloneJson(usage)

const detachedSheetMoveUsage = (usage: SheetMoveUsageState | undefined): SheetMoveUsageState | undefined =>
  usage === undefined ? undefined : deepCloneJson(usage)

const planEotUsageTransition = (
  input: PlanMoveUsageTransitionInput,
  frequency: ParsedMoveFrequency,
): PlannedMoveUsageTransition => {
  const currentRound = normalizeMoveUsageRound(input.map.initiative?.round)
  const previousEntry = getMapMoveUsageEntry(
    input.map.moveUsage,
    input.placementId,
    input.move.moveKey,
    input.map.activeScene,
  )
  const before = eotMoveUsageState(previousEntry, currentRound)
  const previousUsage = eotUsageSummary(input.move, frequency, before)
  if (!before.available) {
    const roundText = before.nextAvailableRound == null ? 'later' : `round ${before.nextAvailableRound}`
    throw new MoveUsageTransitionError(
      'conflict',
      'eot-unavailable',
      `${input.move.moveName} is EOT and is not available until ${roundText}`,
      previousUsage,
    )
  }

  const nextMapMoveUsage = recordMapMoveUsage({
    usage: input.map.moveUsage,
    placementId: input.placementId,
    moveKey: input.move.moveKey,
    moveName: input.move.moveName,
    frequency: 'eot',
    currentRound,
    usedAt: input.usedAt,
    scene: input.map.activeScene,
  })
  const after = eotMoveUsageState(
    getMapMoveUsageEntry(nextMapMoveUsage, input.placementId, input.move.moveKey, input.map.activeScene),
    currentRound,
  )

  return {
    tracking: 'map',
    frequency,
    previousUsage,
    usage: eotUsageSummary(input.move, frequency, after),
    mapUsageChanged: true,
    sheetUsageChanged: false,
    nextMapMoveUsage: detachedMapMoveUsage(nextMapMoveUsage),
  }
}

const planSceneUsageTransition = (
  input: PlanMoveUsageTransitionInput,
  frequency: ParsedMoveFrequency,
): PlannedMoveUsageTransition => {
  const maxUses = maxUsesFor(frequency)
  const previousEntry = getMapMoveUsageEntry(
    input.map.moveUsage,
    input.placementId,
    input.move.moveKey,
    input.map.activeScene,
  )
  const before = limitedMoveUsageState(previousEntry?.frequency === 'scene' ? previousEntry : null, maxUses)
  const previousUsage = limitedUsageSummary(input.move, frequency, 'map', before)
  if (!before.available) {
    throw new MoveUsageTransitionError(
      'conflict',
      'scene-unavailable',
      `${input.move.moveName} has no remaining Scene uses`,
      previousUsage,
    )
  }

  const nextMapMoveUsage = recordMapMoveUsage({
    usage: input.map.moveUsage,
    placementId: input.placementId,
    moveKey: input.move.moveKey,
    moveName: input.move.moveName,
    frequency: 'scene',
    currentRound: normalizeMoveUsageRound(input.map.initiative?.round),
    usedAt: input.usedAt,
    scene: input.map.activeScene,
  })
  const after = limitedMoveUsageState(
    getMapMoveUsageEntry(nextMapMoveUsage, input.placementId, input.move.moveKey, input.map.activeScene),
    maxUses,
  )

  return {
    tracking: 'map',
    frequency,
    previousUsage,
    usage: limitedUsageSummary(input.move, frequency, 'map', after),
    mapUsageChanged: true,
    sheetUsageChanged: false,
    nextMapMoveUsage: detachedMapMoveUsage(nextMapMoveUsage),
  }
}

const planDailyUsageTransition = (
  input: PlanMoveUsageTransitionInput,
  frequency: ParsedMoveFrequency,
): PlannedMoveUsageTransition => {
  const maxUses = maxUsesFor(frequency)
  const previousSheetUsage = normalizeSheetMoveUsage(input.sheetMoveUsage)
  const dailyBefore = limitedMoveUsageState(getSheetDailyMoveUsageEntry(previousSheetUsage, input.move.moveKey), maxUses)
  const previousMapEntry = getMapMoveUsageEntry(
    input.map.moveUsage,
    input.placementId,
    input.move.moveKey,
    input.map.activeScene,
  )
  const sceneBefore = limitedMoveUsageState(previousMapEntry?.frequency === 'daily' ? previousMapEntry : null, 1)
  const previousUsage = dailyUsageSummary(input.move, frequency, dailyBefore, sceneBefore)
  if (!dailyBefore.available) {
    throw new MoveUsageTransitionError(
      'conflict',
      'daily-unavailable',
      `${input.move.moveName} has no remaining Daily uses`,
      previousUsage,
    )
  }
  if (!sceneBefore.available) {
    throw new MoveUsageTransitionError(
      'conflict',
      'daily-scene-unavailable',
      `${input.move.moveName} has already been used this Scene`,
      previousUsage,
    )
  }

  const nextSheetMoveUsage = recordSheetDailyMoveUsage({
    usage: previousSheetUsage,
    moveKey: input.move.moveKey,
    moveName: input.move.moveName,
    usedAt: input.usedAt,
  })
  const nextMapMoveUsage = recordMapMoveUsage({
    usage: input.map.moveUsage,
    placementId: input.placementId,
    moveKey: input.move.moveKey,
    moveName: input.move.moveName,
    frequency: 'daily',
    currentRound: normalizeMoveUsageRound(input.map.initiative?.round),
    usedAt: input.usedAt,
    scene: input.map.activeScene,
  })
  const dailyAfter = limitedMoveUsageState(getSheetDailyMoveUsageEntry(nextSheetMoveUsage, input.move.moveKey), maxUses)
  const sceneAfter = limitedMoveUsageState(
    getMapMoveUsageEntry(nextMapMoveUsage, input.placementId, input.move.moveKey, input.map.activeScene),
    1,
  )

  return {
    tracking: 'sheet',
    frequency,
    previousUsage,
    usage: dailyUsageSummary(input.move, frequency, dailyAfter, sceneAfter),
    mapUsageChanged: true,
    sheetUsageChanged: true,
    nextMapMoveUsage: detachedMapMoveUsage(nextMapMoveUsage),
    nextSheetMoveUsage: detachedSheetMoveUsage(nextSheetMoveUsage),
  }
}

const unchangedUsageTransition = (
  input: PlanMoveUsageTransitionInput,
  frequency: ParsedMoveFrequency,
): PlannedMoveUsageTransition => {
  if (frequency.kind === 'eot') {
    const state = eotMoveUsageState(
      getMapMoveUsageEntry(
        input.map.moveUsage,
        input.placementId,
        input.move.moveKey,
        input.map.activeScene,
      ),
      normalizeMoveUsageRound(input.map.initiative?.round),
    )
    const usage = eotUsageSummary(input.move, frequency, state)
    return {
      tracking: 'map',
      frequency,
      previousUsage: usage,
      usage,
      mapUsageChanged: false,
      sheetUsageChanged: false,
    }
  }

  if (frequency.kind === 'scene') {
    const entry = getMapMoveUsageEntry(
      input.map.moveUsage,
      input.placementId,
      input.move.moveKey,
      input.map.activeScene,
    )
    const state = limitedMoveUsageState(
      entry?.frequency === 'scene' ? entry : null,
      maxUsesFor(frequency),
    )
    const usage = limitedUsageSummary(input.move, frequency, 'map', state)
    return {
      tracking: 'map',
      frequency,
      previousUsage: usage,
      usage,
      mapUsageChanged: false,
      sheetUsageChanged: false,
    }
  }

  if (frequency.kind === 'daily') {
    const daily = limitedMoveUsageState(
      getSheetDailyMoveUsageEntry(
        normalizeSheetMoveUsage(input.sheetMoveUsage),
        input.move.moveKey,
      ),
      maxUsesFor(frequency),
    )
    const mapEntry = getMapMoveUsageEntry(
      input.map.moveUsage,
      input.placementId,
      input.move.moveKey,
      input.map.activeScene,
    )
    const scene = limitedMoveUsageState(
      mapEntry?.frequency === 'daily' ? mapEntry : null,
      1,
    )
    const usage = dailyUsageSummary(input.move, frequency, daily, scene)
    return {
      tracking: 'sheet',
      frequency,
      previousUsage: usage,
      usage,
      mapUsageChanged: false,
      sheetUsageChanged: false,
    }
  }

  const usage = untrackedUsageSummary(input.move, frequency)
  return {
    tracking: 'none',
    frequency,
    previousUsage: usage,
    usage,
    mapUsageChanged: false,
    sheetUsageChanged: false,
  }
}

const usageCountForChange = (
  current: number,
  change: MoveUsageTransitionChange,
): number => {
  if (change.action === 'spend') return current + change.amount
  if (change.action === 'restore') return Math.max(0, current - change.amount)
  return change.amount
}

const currentSceneMapUsage = (
  input: PlanMoveUsageTransitionInput,
): MapMoveUsageState | undefined => {
  const normalized = normalizeMapMoveUsage(input.map.moveUsage)
  return normalized && mapMoveUsageSceneMatches(normalized, input.map.activeScene)
    ? deepCloneJson(normalized)
    : undefined
}

const mapUsageWithExactCount = (options: {
  readonly input: PlanMoveUsageTransitionInput
  readonly frequency: Extract<ParsedMoveFrequency['kind'], 'eot' | 'scene' | 'daily'>
  readonly count: number
  readonly preserveTiming: boolean
}): MapMoveUsageState | undefined => {
  const { input } = options
  const previous = getMapMoveUsageEntry(
    input.map.moveUsage,
    input.placementId,
    input.move.moveKey,
    input.map.activeScene,
  )
  if (options.count === 0) {
    const next = currentSceneMapUsage(input)
    if (!next?.byPlacementId[input.placementId]?.[input.move.moveKey]) return next
    const moves = { ...next.byPlacementId[input.placementId] }
    delete moves[input.move.moveKey]
    if (Object.keys(moves).length > 0) next.byPlacementId[input.placementId] = moves
    else delete next.byPlacementId[input.placementId]
    return Object.keys(next.byPlacementId).length > 0 ? next : undefined
  }

  const seeded = recordMapMoveUsage({
    usage: input.map.moveUsage,
    placementId: input.placementId,
    moveKey: input.move.moveKey,
    moveName: input.move.moveName,
    frequency: options.frequency,
    currentRound: normalizeMoveUsageRound(input.map.initiative?.round),
    usedAt: input.usedAt,
    scene: input.map.activeScene,
  })
  const entry = seeded.byPlacementId[input.placementId]![input.move.moveKey]!
  entry.uses = options.count
  if (options.preserveTiming) {
    if (previous?.lastUsedRound === undefined) delete entry.lastUsedRound
    else entry.lastUsedRound = previous.lastUsedRound
    if (previous?.updatedAt === undefined) delete entry.updatedAt
    else entry.updatedAt = previous.updatedAt
  }
  return seeded
}

const sheetUsageWithExactCount = (options: {
  readonly input: PlanMoveUsageTransitionInput
  readonly count: number
  readonly preserveTiming: boolean
}): SheetMoveUsageState | undefined => {
  const previousUsage = normalizeSheetMoveUsage(options.input.sheetMoveUsage)
  const previous = getSheetDailyMoveUsageEntry(previousUsage, options.input.move.moveKey)
  if (options.count === 0) {
    if (!previous) return previousUsage
    const daily = { ...(previousUsage?.daily ?? {}) }
    delete daily[options.input.move.moveKey]
    return Object.keys(daily).length > 0 ? { daily } : undefined
  }

  const seeded = recordSheetDailyMoveUsage({
    usage: previousUsage,
    moveKey: options.input.move.moveKey,
    moveName: options.input.move.moveName,
    usedAt: options.input.usedAt,
  })
  const entry = seeded.daily[options.input.move.moveKey]!
  entry.uses = options.count
  if (options.preserveTiming) {
    if (previous?.updatedAt === undefined) delete entry.updatedAt
    else entry.updatedAt = previous.updatedAt
  }
  return seeded
}

const assertSpendAdjustmentAvailable = (
  frequency: ParsedMoveFrequency,
  change: MoveUsageTransitionChange,
  usage: UseMoveUsageSummary,
): void => {
  if (change.action !== 'spend' || change.amount === 0) return
  if (frequency.kind === 'eot' && !usage.available) {
    const roundText = usage.nextAvailableRound == null ? 'later' : `round ${usage.nextAvailableRound}`
    throw new MoveUsageTransitionError(
      'conflict',
      'eot-unavailable',
      `${usage.moveName} is EOT and is not available until ${roundText}`,
      usage,
    )
  }
  if (frequency.kind === 'scene' && change.amount > (usage.remainingUses ?? 0)) {
    throw new MoveUsageTransitionError(
      'conflict',
      'scene-unavailable',
      `${usage.moveName} has insufficient remaining Scene uses`,
      usage,
    )
  }
  if (frequency.kind === 'daily' && change.amount > (usage.remainingUses ?? 0)) {
    throw new MoveUsageTransitionError(
      'conflict',
      'daily-unavailable',
      `${usage.moveName} has insufficient remaining Daily uses`,
      usage,
    )
  }
  if (frequency.kind === 'daily' && change.amount > (usage.sceneRemainingUses ?? 0)) {
    throw new MoveUsageTransitionError(
      'conflict',
      'daily-scene-unavailable',
      `${usage.moveName} has insufficient remaining uses this Scene`,
      usage,
    )
  }
}

const planUsageAdjustment = (
  input: PlanMoveUsageTransitionInput,
  frequency: ParsedMoveFrequency,
  change: MoveUsageTransitionChange,
): PlannedMoveUsageTransition => {
  const unchanged = unchangedUsageTransition(input, frequency)
  if (unchanged.tracking === 'none' || change.amount === 0 && change.action !== 'set') {
    return unchanged
  }
  assertSpendAdjustmentAvailable(frequency, change, unchanged.previousUsage)

  if (frequency.kind === 'eot') {
    const nextCount = usageCountForChange(unchanged.previousUsage.uses, change)
    const nextMapMoveUsage = mapUsageWithExactCount({
      input,
      frequency: 'eot',
      count: nextCount,
      preserveTiming: change.action === 'restore' || nextCount === unchanged.previousUsage.uses,
    })
    const after = eotMoveUsageState(
      getMapMoveUsageEntry(
        nextMapMoveUsage,
        input.placementId,
        input.move.moveKey,
        input.map.activeScene,
      ),
      normalizeMoveUsageRound(input.map.initiative?.round),
    )
    const changed = !sameJsonValue(normalizeMapMoveUsage(input.map.moveUsage), nextMapMoveUsage)
    return {
      tracking: 'map',
      frequency,
      previousUsage: unchanged.previousUsage,
      usage: eotUsageSummary(input.move, frequency, after),
      mapUsageChanged: changed,
      sheetUsageChanged: false,
      ...(changed && nextMapMoveUsage !== undefined ? { nextMapMoveUsage } : {}),
    }
  }

  if (frequency.kind === 'scene') {
    const nextCount = usageCountForChange(unchanged.previousUsage.uses, change)
    const nextMapMoveUsage = mapUsageWithExactCount({
      input,
      frequency: 'scene',
      count: nextCount,
      preserveTiming: change.action === 'restore' || nextCount === unchanged.previousUsage.uses,
    })
    const after = limitedMoveUsageState(
      getMapMoveUsageEntry(
        nextMapMoveUsage,
        input.placementId,
        input.move.moveKey,
        input.map.activeScene,
      ),
      maxUsesFor(frequency),
    )
    const changed = !sameJsonValue(normalizeMapMoveUsage(input.map.moveUsage), nextMapMoveUsage)
    return {
      tracking: 'map',
      frequency,
      previousUsage: unchanged.previousUsage,
      usage: limitedUsageSummary(input.move, frequency, 'map', after),
      mapUsageChanged: changed,
      sheetUsageChanged: false,
      ...(changed && nextMapMoveUsage !== undefined ? { nextMapMoveUsage } : {}),
    }
  }

  if (frequency.kind === 'daily') {
    const dailyCount = usageCountForChange(unchanged.previousUsage.uses, change)
    const sceneCount = usageCountForChange(unchanged.previousUsage.sceneUses ?? 0, change)
    const nextSheetMoveUsage = sheetUsageWithExactCount({
      input,
      count: dailyCount,
      preserveTiming: change.action === 'restore' || dailyCount === unchanged.previousUsage.uses,
    })
    const nextMapMoveUsage = mapUsageWithExactCount({
      input,
      frequency: 'daily',
      count: sceneCount,
      preserveTiming: change.action === 'restore'
        || sceneCount === (unchanged.previousUsage.sceneUses ?? 0),
    })
    const dailyAfter = limitedMoveUsageState(
      getSheetDailyMoveUsageEntry(nextSheetMoveUsage, input.move.moveKey),
      maxUsesFor(frequency),
    )
    const sceneAfter = limitedMoveUsageState(
      getMapMoveUsageEntry(
        nextMapMoveUsage,
        input.placementId,
        input.move.moveKey,
        input.map.activeScene,
      ),
      1,
    )
    const mapChanged = !sameJsonValue(normalizeMapMoveUsage(input.map.moveUsage), nextMapMoveUsage)
    const sheetChanged = !sameJsonValue(normalizeSheetMoveUsage(input.sheetMoveUsage), nextSheetMoveUsage)
    return {
      tracking: 'sheet',
      frequency,
      previousUsage: unchanged.previousUsage,
      usage: dailyUsageSummary(input.move, frequency, dailyAfter, sceneAfter),
      mapUsageChanged: mapChanged,
      sheetUsageChanged: sheetChanged,
      ...(mapChanged && nextMapMoveUsage !== undefined ? { nextMapMoveUsage } : {}),
      ...(sheetChanged && nextSheetMoveUsage !== undefined ? { nextSheetMoveUsage } : {}),
    }
  }

  return unchanged
}

const planSingleSpend = (
  input: PlanMoveUsageTransitionInput,
  frequency: ParsedMoveFrequency,
): PlannedMoveUsageTransition => {
  if (frequency.kind === 'eot') return planEotUsageTransition(input, frequency)
  if (frequency.kind === 'scene') return planSceneUsageTransition(input, frequency)
  if (frequency.kind === 'daily') return planDailyUsageTransition(input, frequency)
  return unchangedUsageTransition(input, frequency)
}

export const planMoveUsageTransition = (input: PlanMoveUsageTransitionInput): PlannedMoveUsageTransition => {
  assertValidInput(input)
  const frequency = parseMoveFrequency(input.move.frequency)
  const change = input.change ?? { action: 'spend' as const, amount: 1 }

  if (change.action !== 'spend') return planUsageAdjustment(input, frequency, change)
  if (change.amount === 0) return unchangedUsageTransition(input, frequency)
  if (change.amount === 1) return planSingleSpend(input, frequency)
  return planUsageAdjustment(input, frequency, change)
}

export const isMoveUsageTransitionError = (value: unknown): value is MoveUsageTransitionError =>
  value instanceof MoveUsageTransitionError
