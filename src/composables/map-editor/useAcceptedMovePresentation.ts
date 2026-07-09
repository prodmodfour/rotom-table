import type { LivePlayMovePresentationSummary } from '#shared/livePlayMovePresentation'
import {
  MOVE_VFX_KIND,
  MOVE_VFX_SOURCE_KIND,
  type MoveAnimationEvent,
} from '~/types/moveAnimation'
import {
  MOVE_VFX_TONE,
  moveVfxColorForTone,
  moveVfxColorForType,
} from '~/utils/moveAnimationPalette'
import { MOVE_VFX_DEFAULT_DURATIONS_MS } from '~/utils/isometric/moveVfxTiming'

type MaybePromise<T> = T | Promise<T>

export type AcceptedMovePresentationEnqueueHandler = (
  events: readonly MoveAnimationEvent[],
) => MaybePromise<unknown>

export interface UseAcceptedMovePresentationOptions {
  readonly enqueueMoveAnimations: AcceptedMovePresentationEnqueueHandler
  readonly enqueueAndPublishMoveAnimations?: AcceptedMovePresentationEnqueueHandler
  readonly nowMs?: () => number
  readonly seenOperationLimit?: number
}

export interface PresentAcceptedMoveOptions {
  /** Publish the same visual-only batch as an optional low-latency hint. */
  readonly publishHint?: boolean
}

export type PresentAcceptedMoveResult =
  | {
      readonly status: 'presented'
      readonly events: readonly MoveAnimationEvent[]
    }
  | {
      readonly status: 'duplicate'
      readonly events: readonly []
    }

const DEFAULT_SEEN_OPERATION_LIMIT = 500

const defaultNowMs = (): number => {
  const performanceNow = globalThis.performance?.now
  if (typeof performanceNow === 'function') return performanceNow.call(globalThis.performance)
  return Date.now()
}

const safeNowMs = (nowMs: () => number): number => {
  const value = nowMs()
  return Number.isFinite(value) ? value : 0
}

const eventBase = (
  presentation: LivePlayMovePresentationSummary,
  nowMs: number,
) => ({
  sourceKind: MOVE_VFX_SOURCE_KIND.move,
  sourceLabel: presentation.move.name,
  moveName: presentation.move.name,
  userId: presentation.actorPlacementId,
  createdAtMs: nowMs,
})

const areaEvent = (
  presentation: LivePlayMovePresentationSummary,
  nowMs: number,
): MoveAnimationEvent | null => {
  const area = presentation.area
  if (!area || presentation.pass) return null
  const base = {
    ...eventBase(presentation, nowMs),
    id: `${presentation.operationId}-accepted-area`,
    areaCells: area.cells.map((cell) => ({ ...cell })),
    ...(area.direction ? { areaDirection: area.direction } : {}),
    palette: moveVfxColorForType(presentation.move.type),
  }

  if (area.templateKind === 'line') {
    return {
      ...base,
      kind: MOVE_VFX_KIND.lineSweep,
      durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.long,
    }
  }
  if (area.templateKind === 'cone') {
    return {
      ...base,
      kind: MOVE_VFX_KIND.coneSweep,
      durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.long,
    }
  }
  if (
    area.templateKind === 'burst'
    || area.templateKind === 'close-blast'
    || area.templateKind === 'ranged-blast'
    || area.templateKind === 'cardinally-adjacent'
  ) {
    return {
      ...base,
      kind: MOVE_VFX_KIND.radialBurst,
      durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.long,
    }
  }
  return {
    ...base,
    kind: MOVE_VFX_KIND.areaPulse,
    durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.normal,
  }
}

const passEvent = (
  presentation: LivePlayMovePresentationSummary,
  nowMs: number,
): MoveAnimationEvent | null => {
  const pass = presentation.pass
  if (!pass) return null
  return {
    ...eventBase(presentation, nowMs),
    id: `${presentation.operationId}-accepted-pass`,
    kind: MOVE_VFX_KIND.dash,
    durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.long,
    originCell: { ...pass.from },
    destinationCell: { ...pass.destination },
    pathCells: pass.pathCells.map((cell) => ({ ...cell })),
    palette: moveVfxColorForType(presentation.move.type),
  }
}

const targetOutcomeEvents = (
  presentation: LivePlayMovePresentationSummary,
  nowMs: number,
): MoveAnimationEvent[] => {
  const hitTargetIds = new Set(presentation.hitTargetIds)
  return presentation.attackedTargetIds.map((targetId, index): MoveAnimationEvent => {
    const sequence = String(index + 1).padStart(3, '0')
    if (!hitTargetIds.has(targetId)) {
      return {
        ...eventBase(presentation, nowMs),
        id: `${presentation.operationId}-accepted-miss-${sequence}`,
        kind: MOVE_VFX_KIND.miss,
        durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.quick,
        targetId,
        palette: moveVfxColorForTone(MOVE_VFX_TONE.miss),
      }
    }
    return {
      ...eventBase(presentation, nowMs),
      id: `${presentation.operationId}-accepted-hit-${sequence}`,
      kind: MOVE_VFX_KIND.targetFlash,
      durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.quick,
      targetId,
      tone: 'hit',
      shake: true,
      palette: moveVfxColorForType(presentation.move.type),
    }
  })
}

/**
 * Plans generic VFX exclusively from the durable accepted-result summary.
 * The operation ID owns every event ID, so all delivery channels materialize
 * the same one-shot visual batch without rerunning move rules.
 */
export const planAcceptedMovePresentation = (
  presentation: LivePlayMovePresentationSummary,
  nowMs: number,
): readonly MoveAnimationEvent[] => {
  const events: MoveAnimationEvent[] = []
  const pass = passEvent(presentation, nowMs)
  const area = areaEvent(presentation, nowMs)
  if (pass) events.push(pass)
  if (area) events.push(area)
  events.push(...targetOutcomeEvents(presentation, nowMs))

  if (events.length === 0) {
    events.push({
      ...eventBase(presentation, nowMs),
      id: `${presentation.operationId}-accepted-self`,
      kind: MOVE_VFX_KIND.selfPulse,
      durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.normal,
      palette: moveVfxColorForType(presentation.move.type),
    })
  }
  return events
}

const warnAcceptedMovePresentationFailure = (error: unknown): void => {
  console.warn('[useAcceptedMovePresentation] accepted move presentation failed', error)
}

/**
 * Owns per-map accepted-move presentation idempotency.
 *
 * Durable HTTP, SSE/replay, status, and duplicate terminals all call the same
 * method. A bounded operation-ID set prevents replay even after the transient
 * renderer queue has already aged out the original VFX. Transient map-action
 * batches may arrive first, but are only optional visual hints.
 */
export const useAcceptedMovePresentation = (options: UseAcceptedMovePresentationOptions) => {
  const nowMs = options.nowMs ?? defaultNowMs
  const seenLimit = Math.max(1, Math.floor(options.seenOperationLimit ?? DEFAULT_SEEN_OPERATION_LIMIT))
  const seenOperationIds = new Set<string>()
  const seenOperationOrder: string[] = []

  const rememberOperation = (operationId: string): boolean => {
    if (seenOperationIds.has(operationId)) return false
    seenOperationIds.add(operationId)
    seenOperationOrder.push(operationId)
    while (seenOperationOrder.length > seenLimit) {
      const dropped = seenOperationOrder.shift()
      if (dropped) seenOperationIds.delete(dropped)
    }
    return true
  }

  const hasPresented = (operationId: string | null | undefined): boolean => (
    typeof operationId === 'string' && seenOperationIds.has(operationId)
  )

  const present = (
    presentation: LivePlayMovePresentationSummary,
    presentOptions: PresentAcceptedMoveOptions = {},
  ): PresentAcceptedMoveResult => {
    if (!rememberOperation(presentation.operationId)) return { status: 'duplicate', events: [] }

    const events = planAcceptedMovePresentation(presentation, safeNowMs(nowMs))
    const enqueue = presentOptions.publishHint && options.enqueueAndPublishMoveAnimations
      ? options.enqueueAndPublishMoveAnimations
      : options.enqueueMoveAnimations
    try {
      void Promise.resolve(enqueue(events)).catch(warnAcceptedMovePresentationFailure)
    } catch (error) {
      warnAcceptedMovePresentationFailure(error)
    }
    return { status: 'presented', events }
  }

  return {
    present,
    hasPresented,
  }
}
