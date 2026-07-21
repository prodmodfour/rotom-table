import {
  ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION,
  parseAbilityResolutionAuthorizedView,
  parseAbilityResolutionPublicResult,
  type AcceptedAbilityResolutionAuthorizedView,
  type AcceptedAbilityResolutionPublicResult,
  type AbilityResolutionAuthorizedOperationSummary,
  type AbilityResolutionPublicOutcome,
  type PendingAbilityResolutionAuthorizedView,
  type PendingAbilityResolutionPublicResult,
} from '#shared/abilityAutomation/results'
import type { AbilitySpecPhase } from '#shared/abilityAutomation/spec'
import type { AbilityResolutionAuditTrace } from '#shared/abilityAutomation/trace'
import type { AbilityAutomationRollLedgerEntry } from '#shared/abilityAutomation/random'
import type { AbilityStatePlan } from './statePlan'

export const ABILITY_PUBLIC_PRESENTATION_KEYS = Object.freeze({
  accepted: 'ability.resolution.completed',
  pending: 'ability.resolution.pending',
})

export type AbilityResultAuthorizationKind =
  | 'authorized-gm'
  | 'source-controller'
  | 'eligible-responder'

export interface AbilityResultAuthorization {
  readonly kind: AbilityResultAuthorizationKind
  readonly principalId: string
}

export interface PrivateAcceptedAbilityOperation {
  readonly operationId: string
  readonly operationKind: string
  readonly outcome: AbilityResolutionPublicOutcome | 'pending'
  readonly recipientIds: readonly string[]
  readonly presentationKey: string
}

export interface PrivateAcceptedAbilityResult {
  readonly kind: 'accepted-private'
  readonly operationId: string
  readonly mapSlug: string
  readonly previousRevision: number
  readonly revision: number
  readonly actorPlacementId: string
  readonly outcome: AbilityResolutionPublicOutcome
  readonly statePlan: AbilityStatePlan
  readonly trace: AbilityResolutionAuditTrace
  readonly rollLedger: readonly AbilityAutomationRollLedgerEntry[]
  readonly operations: readonly PrivateAcceptedAbilityOperation[]
}

export interface PrivatePendingAbilityOption {
  readonly id: string
  readonly presentationKey: string
  /** Private mechanic references never enter authorized presentation. */
  readonly operationIds: readonly string[]
}

export interface PrivatePendingAbilityWindow {
  readonly windowId: string
  readonly kind: 'choice' | 'reaction'
  readonly phase: AbilitySpecPhase
  readonly promptKey: string
  readonly options: readonly PrivatePendingAbilityOption[]
  readonly allowPass: boolean
  readonly responderPrincipalIds: readonly string[]
}

export interface PrivatePendingAbilityResult {
  readonly kind: 'pending-private'
  readonly operationId: string
  readonly resolutionId: string
  readonly mapSlug: string
  readonly previousRevision: number
  readonly revision: number
  readonly canonicalId: string
  readonly modeId: string
  readonly actorPlacementId: string
  readonly phase: AbilitySpecPhase
  readonly createdAt: number
  readonly updatedAt: number
  readonly outstandingWindowCount: number
  readonly window: PrivatePendingAbilityWindow
  readonly trace: AbilityResolutionAuditTrace
  readonly rollLedger: readonly AbilityAutomationRollLedgerEntry[]
  readonly privateReadCount: number
}

export type PrivateAbilityResolutionResult =
  | PrivateAcceptedAbilityResult
  | PrivatePendingAbilityResult

export class AbilityResultAuthorizationError extends Error {
  constructor() {
    super('Ability result authorization is required.')
    this.name = 'AbilityResultAuthorizationError'
  }
}

const assertAuthorization = (value: AbilityResultAuthorization): void => {
  if (
    !value
    || !['authorized-gm', 'source-controller', 'eligible-responder'].includes(value.kind)
    || typeof value.principalId !== 'string'
    || value.principalId.length === 0
  ) {
    throw new AbilityResultAuthorizationError()
  }
}

export const projectAcceptedAbilityPublicResult = (
  result: PrivateAcceptedAbilityResult,
): AcceptedAbilityResolutionPublicResult => parseAbilityResolutionPublicResult({
  schemaVersion: ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION,
  kind: 'accepted',
  operationId: result.operationId,
  resolutionId: result.statePlan.resolutionId,
  mapSlug: result.mapSlug,
  previousRevision: result.previousRevision,
  revision: result.revision,
  status: 'committed',
  presentation: {
    key: ABILITY_PUBLIC_PRESENTATION_KEYS.accepted,
    outcome: result.outcome,
  },
}) as AcceptedAbilityResolutionPublicResult

export const projectAcceptedAbilityAuthorizedView = (input: {
  readonly result: PrivateAcceptedAbilityResult
  readonly authorization: AbilityResultAuthorization
}): AcceptedAbilityResolutionAuthorizedView => {
  assertAuthorization(input.authorization)
  const result = input.result
  const operations: readonly AbilityResolutionAuthorizedOperationSummary[] = result.operations.map(
    operation => ({
      operationId: operation.operationId,
      operationKind: operation.operationKind,
      outcome: operation.outcome,
      recipientCount: operation.recipientIds.length,
      presentationKey: operation.presentationKey,
    }),
  )
  return parseAbilityResolutionAuthorizedView({
    schemaVersion: ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION,
    kind: 'accepted-view',
    summary: projectAcceptedAbilityPublicResult(result),
    ability: {
      canonicalId: result.statePlan.runtime.canonicalId,
      modeId: result.statePlan.runtime.modeId,
      actorPlacementId: result.actorPlacementId,
    },
    operations,
  }) as AcceptedAbilityResolutionAuthorizedView
}

export const projectPendingAbilityPublicResult = (
  result: PrivatePendingAbilityResult,
): PendingAbilityResolutionPublicResult => parseAbilityResolutionPublicResult({
  schemaVersion: ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION,
  kind: 'pending',
  operationId: result.operationId,
  resolutionId: result.resolutionId,
  mapSlug: result.mapSlug,
  previousRevision: result.previousRevision,
  revision: result.revision,
  status: 'pending',
  phase: result.phase,
  outstandingWindowCount: result.outstandingWindowCount,
  createdAt: result.createdAt,
  updatedAt: result.updatedAt,
  presentation: {
    key: ABILITY_PUBLIC_PRESENTATION_KEYS.pending,
    outcome: null,
  },
}) as PendingAbilityResolutionPublicResult

export const projectPendingAbilityAuthorizedView = (input: {
  readonly result: PrivatePendingAbilityResult
  readonly authorization: AbilityResultAuthorization
}): PendingAbilityResolutionAuthorizedView => {
  assertAuthorization(input.authorization)
  const { result } = input
  const isGm = input.authorization.kind === 'authorized-gm'
  if (!isGm && !result.window.responderPrincipalIds.includes(input.authorization.principalId)) {
    throw new AbilityResultAuthorizationError()
  }
  return parseAbilityResolutionAuthorizedView({
    schemaVersion: ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION,
    kind: 'pending-view',
    summary: projectPendingAbilityPublicResult(result),
    ability: isGm
      ? {
          canonicalId: result.canonicalId,
          modeId: result.modeId,
          actorPlacementId: result.actorPlacementId,
        }
      : null,
    window: {
      windowId: result.window.windowId,
      kind: result.window.kind,
      phase: result.window.phase,
      promptKey: result.window.promptKey,
      options: result.window.options.map(option => ({
        id: option.id,
        presentationKey: option.presentationKey,
      })),
      allowPass: result.window.allowPass,
    },
  }) as PendingAbilityResolutionAuthorizedView
}
