import type {
  MoveFieldEffectOperation,
  MoveHazardEffectOperation,
  MoveLogEffectOperation,
  MoveUsageEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  LivePlayMovePresentationAreaGeometry,
  LivePlayMovePresentationIdentity,
  LivePlayMovePresentationPassGeometry,
  LivePlayMovePresentationSummary,
} from '#shared/livePlayMovePresentation'
import type {
  MoveResolutionAuditTrace,
  MoveResolutionTraceJsonValue,
  MoveResolutionTraceOperationOutcome,
} from '#shared/moveAutomation/trace'
import type { GridAnchor, TabletopMap } from '~/types/map'
import type { MoveStructuredLogProjection } from '~/utils/moveLog'
import type {
  MoveUsageTransitionMove,
  UseMoveUsageSummary,
} from '../../planMoveUsageTransition'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from '../context'
import type { MoveSpecEmittedOperation } from '../executeSpec'
import type { MoveStateChangePlan } from '../plan'
import type { MoveEffectDynamicRecipientSets } from './effectRecipients'

export type MoveMapEffectOperation =
  | MoveFieldEffectOperation
  | MoveHazardEffectOperation
  | MoveUsageEffectOperation
  | MoveLogEffectOperation

export interface MoveResolvedMapEffectOperation
  extends Omit<MoveSpecEmittedOperation, 'operation'> {
  readonly operation: MoveMapEffectOperation
}

/** Server-resolved cell sets consumed by typed encounter-zone geometry. */
export interface MoveHazardGeometryResolution {
  readonly cellSets?: ReadonlyMap<string, readonly GridAnchor[]>
}

/** A reviewed usage resource binds an operation ID to one authoritative move owner. */
export interface MoveUsageEffectResource {
  readonly resourceId: string
  readonly placementId: string
  readonly move: MoveUsageTransitionMove
}

export interface MoveAcceptedPresentationProjection {
  readonly operationId: string
  readonly move: LivePlayMovePresentationIdentity
  readonly selectedTargetIds?: readonly string[]
  readonly area?: LivePlayMovePresentationAreaGeometry
  readonly pass?: LivePlayMovePresentationPassGeometry
}

export interface MoveMapOperationResult {
  readonly operationId: string
  readonly operationKind: MoveMapEffectOperation['kind']
  readonly phase: MoveMapEffectOperation['phase']
  readonly reasonCode: string
  readonly recipientIds: readonly string[]
  readonly outcome: Exclude<MoveResolutionTraceOperationOutcome, 'pending'>
  readonly details: MoveResolutionTraceJsonValue
}

export interface MoveUsageOperationProjection {
  readonly operationId: string
  readonly resourceId: string
  readonly previousUsage: UseMoveUsageSummary
  readonly usage: UseMoveUsageSummary
}

export interface ReduceMoveMapOperationsInput {
  readonly context: AuthoritativeMoveRulesContext
  /** Optional server-reduced core state composed before map-operation lanes. */
  readonly initialMap?: TabletopMap
  /** Exact server-emitted operations, retained in canonical phase/operation order. */
  readonly operations: readonly MoveResolvedMapEffectOperation[]
  readonly dynamicRecipients: MoveEffectDynamicRecipientSets
  /** Preserve an ancestry-linked child's explicit actor/source context. */
  readonly contextForOperation?: (
    operation: MoveMapEffectOperation,
  ) => AuthoritativeMoveRulesContext
  readonly usageResources?: readonly MoveUsageEffectResource[]
  readonly hazards?: MoveHazardGeometryResolution
  readonly presentation: MoveAcceptedPresentationProjection
  readonly actorName?: string
  readonly frequency?: string | null
  /** Optional server-authored compatibility lines; structured operations remain authoritative evidence. */
  readonly logLines?: readonly string[]
  readonly trace: MoveResolutionAuditTrace
  readonly maxLogEntries?: number
}

export interface MoveMapOperationReduction {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly previousRevision: number
  readonly revision: number
  readonly stateChanges: MoveStateChangePlan
  readonly operationResults: readonly MoveMapOperationResult[]
  readonly usage: readonly MoveUsageOperationProjection[]
  readonly structuredLog: readonly MoveStructuredLogProjection[]
  readonly presentation: LivePlayMovePresentationSummary
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly trace: MoveResolutionAuditTrace
}
