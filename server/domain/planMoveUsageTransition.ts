import type { TabletopMap } from '~/types/map'
import type { MapMoveUsageState, SheetMoveUsageState } from '~/types/moveUsage'
import {
  eotMoveUsageState,
  getMapMoveUsageEntry,
  getSheetDailyMoveUsageEntry,
  limitedMoveUsageState,
  normalizeMoveUsageRound,
  normalizeSheetMoveUsage,
  parseMoveFrequency,
  recordMapMoveUsage,
  recordSheetDailyMoveUsage,
  type MoveFrequencyKind,
  type ParsedMoveFrequency,
} from '~/utils/moveUsage'
import { deepCloneJson } from '~/utils/serialization'

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

export interface PlanMoveUsageTransitionInput {
  readonly map: Pick<TabletopMap, 'moveUsage' | 'activeScene' | 'initiative'>
  readonly sheetMoveUsage?: SheetMoveUsageState
  readonly placementId: string
  readonly move: MoveUsageTransitionMove
  readonly usedAt?: number
}

export interface PlannedMoveUsageTransition {
  readonly tracking: UseMoveTracking
  readonly frequency: ParsedMoveFrequency
  readonly previousUsage: UseMoveUsageSummary
  readonly usage: UseMoveUsageSummary
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
    nextMapMoveUsage: detachedMapMoveUsage(nextMapMoveUsage),
    nextSheetMoveUsage: detachedSheetMoveUsage(nextSheetMoveUsage),
  }
}

export const planMoveUsageTransition = (input: PlanMoveUsageTransitionInput): PlannedMoveUsageTransition => {
  assertValidInput(input)
  const frequency = parseMoveFrequency(input.move.frequency)

  if (frequency.kind === 'eot') return planEotUsageTransition(input, frequency)
  if (frequency.kind === 'scene') return planSceneUsageTransition(input, frequency)
  if (frequency.kind === 'daily') return planDailyUsageTransition(input, frequency)

  const usage = untrackedUsageSummary(input.move, frequency)
  return {
    tracking: 'none',
    frequency,
    previousUsage: usage,
    usage,
  }
}

export const isMoveUsageTransitionError = (value: unknown): value is MoveUsageTransitionError =>
  value instanceof MoveUsageTransitionError
