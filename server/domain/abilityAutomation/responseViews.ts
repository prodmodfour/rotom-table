import { deepFreezeStrictJson } from '#shared/automation/strictJson'
import type { AbilitySpecPhase } from '#shared/abilityAutomation/spec'
import {
  parsePendingAbilitySaga,
  type PendingAbilitySaga,
  type PendingAbilitySagaStatus,
} from '#shared/abilityAutomation/pendingSaga'
import type {
  PendingAbilityOwnerKind,
  PendingAbilityResponseOwner,
} from '#shared/abilityAutomation/pendingResolution'

export const ABILITY_RESPONSE_VIEW_SCHEMA_VERSION = 1 as const

export interface AbilityPendingViewAuthorization {
  readonly principalId: string | null
  readonly isGm: boolean
  readonly controlledPlacementIds: readonly string[]
  readonly profileIds: readonly string[]
  readonly sideIds: readonly string[]
}

interface AbilityPendingWindowViewBase {
  readonly schemaVersion: typeof ABILITY_RESPONSE_VIEW_SCHEMA_VERSION
  readonly resolutionId: string
  readonly mapSlug: string
  readonly revision: number
  readonly expiresAt: number | null
  readonly status: 'pending'
  readonly window: {
    readonly windowId: string
    readonly phase: AbilitySpecPhase
    readonly promptKey: string
    readonly options: readonly { readonly id: string; readonly presentationKey: string }[]
    readonly allowPass: true
  }
}

export interface AbilityPendingResponderView extends AbilityPendingWindowViewBase {
  readonly kind: 'ability-pending-responder-view'
}

export interface AbilityPendingGmView extends AbilityPendingWindowViewBase {
  readonly kind: 'ability-pending-gm-view'
  readonly ability: {
    readonly canonicalId: string
    readonly modeId: string
    readonly ownerPlacementId: string
    readonly abilityInstanceId: string
  }
  readonly owners: readonly PendingAbilityResponseOwner[]
}

export type AbilityPendingAuthorizedView = AbilityPendingResponderView | AbilityPendingGmView

export interface AbilityPendingSourceSummary {
  readonly schemaVersion: typeof ABILITY_RESPONSE_VIEW_SCHEMA_VERSION
  readonly kind: 'ability-pending-source-summary'
  readonly resolutionId: string
  readonly mapSlug: string
  readonly revision: number
  readonly status: 'pending'
  readonly presentationKey: 'ability.resolution.pending'
}

export interface AbilityPendingMapExistenceSummary {
  readonly schemaVersion: typeof ABILITY_RESPONSE_VIEW_SCHEMA_VERSION
  readonly kind: 'ability-pending-existence'
  readonly mapSlug: string
  readonly revision: number
  readonly pendingWindowCount: number
}

export interface AbilityPublicSagaLogRecord {
  readonly schemaVersion: typeof ABILITY_RESPONSE_VIEW_SCHEMA_VERSION
  readonly kind: 'ability-resolution'
  readonly outcome: 'resolved' | 'declined' | 'cancelled' | 'expired' | 'conflicted'
  readonly presentationKey: string
}

export interface AbilityPublicSagaReplayRecord extends AbilityPublicSagaLogRecord {
  readonly kind: 'ability-resolution'
  readonly occurredAt: number
}

export interface AbilityGmAccessAuditRecord {
  readonly principalId: string
  readonly resolutionId: string
  readonly assetIds: readonly ['response.authorized-prompt', 'response.legal-options', 'response.owner-principals']
}

export class AbilityResponseAuthorizationError extends Error {
  constructor() {
    super('Ability response view is unavailable.')
    this.name = 'AbilityResponseAuthorizationError'
  }
}

const deny = (): never => { throw new AbilityResponseAuthorizationError() }
const validIdList = (value: readonly string[]): boolean => Array.isArray(value)
  && value.length <= 512
  && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200)
  && new Set(value).size === value.length
const assertAuthorization = (value: AbilityPendingViewAuthorization): void => {
  if (!value || typeof value.isGm !== 'boolean'
    || (value.principalId !== null && (typeof value.principalId !== 'string' || value.principalId.length === 0))
    || (value.isGm && value.principalId === null)
    || !validIdList(value.controlledPlacementIds)
    || !validIdList(value.profileIds)
    || !validIdList(value.sideIds)) deny()
}
const ownerMatches = (
  owner: PendingAbilityResponseOwner,
  authorization: AbilityPendingViewAuthorization,
): boolean => {
  if (authorization.isGm) return true
  if (owner.kind === 'gm') return false
  if (owner.kind === 'principal') return owner.id === authorization.principalId
  const lists: Readonly<Record<Exclude<PendingAbilityOwnerKind, 'gm' | 'principal'>, readonly string[]>> = {
    placement: authorization.controlledPlacementIds,
    profile: authorization.profileIds,
    side: authorization.sideIds,
  }
  return owner.id !== null && lists[owner.kind].includes(owner.id)
}
const active = (saga: PendingAbilitySaga): boolean => saga.status === 'pending'
const baseWindow = (saga: PendingAbilitySaga) => ({
  windowId: saga.resolution.window.windowId,
  phase: saga.resolution.window.phase,
  promptKey: saga.resolution.window.promptKey,
  options: saga.resolution.window.options.map(option => ({
    id: option.id,
    presentationKey: option.presentationKey,
  })),
  allowPass: true as const,
})

/** HTTP response projection; authorization is resolved before any private option is read out. */
export const projectPendingAbilityResponseView = (input: {
  readonly saga: unknown
  readonly authorization: AbilityPendingViewAuthorization
  readonly auditGmAccess?: (record: AbilityGmAccessAuditRecord) => void
}): AbilityPendingAuthorizedView => {
  const saga = parsePendingAbilitySaga(input.saga)
  assertAuthorization(input.authorization)
  if (!active(saga)
    || !saga.resolution.window.owners.some(owner => ownerMatches(owner, input.authorization))) deny()
  if (input.authorization.isGm) {
    const auditGmAccess = input.auditGmAccess
    if (!auditGmAccess) deny()
    auditGmAccess!(Object.freeze({
      principalId: input.authorization.principalId!,
      resolutionId: saga.resolution.resolutionId,
      assetIds: Object.freeze([
        'response.authorized-prompt', 'response.legal-options', 'response.owner-principals',
      ] as const),
    }))
    return deepFreezeStrictJson({
      schemaVersion: ABILITY_RESPONSE_VIEW_SCHEMA_VERSION,
      kind: 'ability-pending-gm-view',
      resolutionId: saga.resolution.resolutionId,
      mapSlug: saga.resolution.mapSlug,
      revision: saga.resolution.revision,
      expiresAt: saga.resolution.expiresAt,
      status: 'pending',
      window: baseWindow(saga),
      ability: {
        canonicalId: saga.resolution.trigger.canonicalId,
        modeId: saga.resolution.trigger.modeId,
        ownerPlacementId: saga.resolution.trigger.ownerPlacementId,
        abilityInstanceId: saga.resolution.trigger.abilityInstanceId,
      },
      owners: saga.resolution.window.owners,
    }) as AbilityPendingGmView
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_RESPONSE_VIEW_SCHEMA_VERSION,
    kind: 'ability-pending-responder-view',
    resolutionId: saga.resolution.resolutionId,
    mapSlug: saga.resolution.mapSlug,
    revision: saga.resolution.revision,
    expiresAt: saga.resolution.expiresAt,
    status: 'pending',
    window: baseWindow(saga),
  }) as AbilityPendingResponderView
}

/** Source-controller command acknowledgement; no prompt, ability, eligibility, or responder data. */
export const projectPendingAbilitySourceSummary = (input: {
  readonly saga: unknown
  readonly controlledPlacementIds: readonly string[]
}): AbilityPendingSourceSummary => {
  const saga = parsePendingAbilitySaga(input.saga)
  if (!active(saga) || !validIdList(input.controlledPlacementIds)
    || !input.controlledPlacementIds.includes(saga.resolution.trigger.ownerPlacementId)) deny()
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_RESPONSE_VIEW_SCHEMA_VERSION,
    kind: 'ability-pending-source-summary',
    resolutionId: saga.resolution.resolutionId,
    mapSlug: saga.resolution.mapSlug,
    revision: saga.resolution.revision,
    status: 'pending',
    presentationKey: 'ability.resolution.pending',
  })
}

/** SSE/map projection reveals only aggregate existence for the selected map revision. */
export const projectPendingAbilityMapExistence = (input: {
  readonly sagas: readonly unknown[]
  readonly mapSlug: string
  readonly revision: number
}): AbilityPendingMapExistenceSummary => {
  if (!Array.isArray(input.sagas) || input.sagas.length > 1_024
    || typeof input.mapSlug !== 'string' || !Number.isSafeInteger(input.revision)) deny()
  const sagas = input.sagas.map(saga => parsePendingAbilitySaga(saga))
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_RESPONSE_VIEW_SCHEMA_VERSION,
    kind: 'ability-pending-existence',
    mapSlug: input.mapSlug,
    revision: input.revision,
    pendingWindowCount: sagas.filter(saga => (
      active(saga)
      && saga.resolution.mapSlug === input.mapSlug
      && saga.resolution.revision === input.revision
    )).length,
  })
}

const publicOutcome = (status: PendingAbilitySagaStatus): AbilityPublicSagaLogRecord['outcome'] => {
  if (status === 'committed' || status === 'recovered') return 'resolved'
  if (status === 'passed' || status === 'force-passed') return 'declined'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'expired') return 'expired'
  return 'conflicted'
}
const presentationKey = (outcome: AbilityPublicSagaLogRecord['outcome']): string => (
  `ability.resolution.${outcome}`
)

/** Public log allowlist: no ability, actor, target, responder, option, read, roll, or causal IDs. */
export const projectAbilityPublicSagaLog = (sagaValue: unknown): AbilityPublicSagaLogRecord => {
  const saga = parsePendingAbilitySaga(sagaValue)
  if (saga.terminal === null) deny()
  const outcome = publicOutcome(saga.status)
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_RESPONSE_VIEW_SCHEMA_VERSION,
    kind: 'ability-resolution',
    outcome,
    presentationKey: presentationKey(outcome),
  })
}

/** Public replay is the same allowlist plus accepted server time. */
export const projectAbilityPublicSagaReplay = (sagaValue: unknown): AbilityPublicSagaReplayRecord => {
  const saga = parsePendingAbilitySaga(sagaValue)
  const terminal = saga.terminal
  if (terminal === null) deny()
  const log = projectAbilityPublicSagaLog(saga)
  return deepFreezeStrictJson({ ...log, occurredAt: terminal!.occurredAt })
}
