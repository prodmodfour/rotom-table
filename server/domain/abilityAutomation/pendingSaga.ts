import {
  PENDING_ABILITY_SAGA_SCHEMA_VERSION,
  createPendingAbilitySaga,
  parsePendingAbilitySaga,
  parsePendingAbilitySagaCommand,
  type PendingAbilitySaga,
  type PendingAbilitySagaActorKind,
  type PendingAbilitySagaCommand,
  type PendingAbilitySagaReceipt,
  type PendingAbilitySagaStatus,
} from '#shared/abilityAutomation/pendingSaga'
import type { PendingAbilityRead, PendingAbilityResponseOwner } from '#shared/abilityAutomation/pendingResolution'
import { assertPendingAbilityResolutionReads } from './pendingResolution'

export interface PendingAbilitySagaAuthorization {
  readonly kind: PendingAbilitySagaActorKind
  readonly id: string | null
}

export interface PendingAbilitySagaTransitionResult {
  readonly status: 'applied' | 'duplicate'
  readonly saga: PendingAbilitySaga
}

export interface PendingAbilitySagaTransaction {
  readonly load: (resolutionId: string) => unknown | null
  readonly compareAndSet: (
    resolutionId: string,
    expectedSagaVersion: number,
    saga: PendingAbilitySaga,
  ) => boolean
}

export interface PendingAbilitySagaStore {
  readonly transaction: <Result>(callback: (transaction: PendingAbilitySagaTransaction) => Result) => Result
}

export type PendingAbilitySagaTransitionErrorCode =
  | 'not-found'
  | 'unauthorized'
  | 'command-id-conflict'
  | 'stale-saga'
  | 'terminal'
  | 'invalid-transition'
  | 'invalid-option'
  | 'not-expired'
  | 'recovery-read-conflict'
  | 'concurrent-conflict'

export class PendingAbilitySagaTransitionError extends Error {
  constructor(readonly code: PendingAbilitySagaTransitionErrorCode, detail: string) {
    super(detail)
    this.name = 'PendingAbilitySagaTransitionError'
  }
}

const fail = (code: PendingAbilitySagaTransitionErrorCode, detail: string): never => {
  throw new PendingAbilitySagaTransitionError(code, detail)
}
const ownerMatches = (
  owner: PendingAbilityResponseOwner,
  authorization: PendingAbilitySagaAuthorization,
): boolean => authorization.kind === 'gm'
  || (owner.kind === authorization.kind && owner.id === authorization.id)
const isOwner = (saga: PendingAbilitySaga, authorization: PendingAbilitySagaAuthorization): boolean => (
  saga.resolution.window.owners.some(owner => ownerMatches(owner, authorization))
)
const needsOwner = (action: PendingAbilitySagaCommand['action']): boolean => (
  action === 'select' || action === 'pass' || action === 'cancel'
)
const needsGm = (action: PendingAbilitySagaCommand['action']): boolean => (
  action === 'force-pass' || action === 'gm-recover'
)
const needsSystem = (action: PendingAbilitySagaCommand['action']): boolean => (
  action === 'expire' || action === 'commit' || action === 'conflict'
)
const resultingStatus = (action: PendingAbilitySagaCommand['action']): PendingAbilitySagaStatus => {
  if (action === 'select') return 'resuming'
  if (action === 'pass') return 'passed'
  if (action === 'force-pass') return 'force-passed'
  if (action === 'cancel') return 'cancelled'
  if (action === 'expire') return 'expired'
  if (action === 'commit') return 'committed'
  if (action === 'conflict') return 'conflicted'
  return 'recovered'
}

export const transitionPendingAbilitySaga = (input: {
  readonly saga: unknown
  readonly command: unknown
  readonly authorization: PendingAbilitySagaAuthorization
  readonly revisionForRecovery?: (read: PendingAbilityRead) => number | null
}): PendingAbilitySagaTransitionResult => {
  const saga = parsePendingAbilitySaga(input.saga)
  const command = parsePendingAbilitySagaCommand(input.command)
  const existing = saga.receipts.find(receipt => receipt.commandId === command.commandId)
  if (existing) {
    if (existing.requestSha256 === command.requestSha256
      && existing.action === command.action
      && existing.optionId === command.optionId) {
      return Object.freeze({ status: 'duplicate', saga })
    }
    fail('command-id-conflict', 'Pending ability command ID was reused with different intent.')
  }
  if (command.resolutionId !== saga.resolution.resolutionId
    || command.windowId !== saga.resolution.window.windowId) {
    fail('invalid-transition', 'Pending ability command identifies another resolution or window.')
  }
  if (command.expectedSagaVersion !== saga.sagaVersion) {
    fail('stale-saga', 'Pending ability saga changed before this command.')
  }
  if (saga.terminal !== null) fail('terminal', 'Pending ability saga is already terminal.')
  if (command.occurredAt < saga.updatedAt) fail('invalid-transition', 'Pending ability command time regressed.')
  const authorization = input.authorization
  if (!authorization || !['principal', 'placement', 'profile', 'side', 'gm', 'system'].includes(authorization.kind)
    || (authorization.kind === 'system') !== (authorization.id === null)) {
    fail('unauthorized', 'Pending ability command authorization is invalid.')
  }
  if (needsOwner(command.action) && !isOwner(saga, authorization)) {
    fail('unauthorized', 'Only an eligible owner or GM may answer or cancel this window.')
  }
  if (needsGm(command.action) && authorization.kind !== 'gm') {
    fail('unauthorized', 'This pending ability transition requires a GM.')
  }
  if (needsSystem(command.action) && authorization.kind !== 'system') {
    fail('unauthorized', 'This pending ability transition requires the server system actor.')
  }
  if (command.action === 'select') {
    if (saga.status !== 'pending') fail('invalid-transition', 'Selection requires a pending window.')
    if (!saga.resolution.window.options.some(option => option.id === command.optionId)) {
      fail('invalid-option', 'Selected option was not issued for this window.')
    }
  }
  if ((command.action === 'pass' || command.action === 'force-pass') && saga.status !== 'pending') {
    fail('invalid-transition', 'Pass requires a pending window.')
  }
  if (command.action === 'commit' && saga.status !== 'resuming') {
    fail('invalid-transition', 'Commit requires a resumed selected option.')
  }
  if (command.action === 'expire') {
    const expiresAt = saga.resolution.expiresAt
    if (expiresAt === null || command.occurredAt < expiresAt) {
      fail('not-expired', 'Pending ability window has not reached expiry.')
    }
  }
  if (command.action === 'gm-recover') {
    const revisionForRecovery = input.revisionForRecovery
    if (!revisionForRecovery) {
      fail('recovery-read-conflict', 'GM recovery requires complete read-set revalidation.')
    }
    try {
      assertPendingAbilityResolutionReads(
        saga.resolution,
        revisionForRecovery as (read: PendingAbilityRead) => number | null,
      )
    }
    catch {
      fail('recovery-read-conflict', 'GM recovery read set is stale or unavailable.')
    }
  }
  const nextStatus = resultingStatus(command.action)
  const nextVersion = saga.sagaVersion + 1
  const receipt: PendingAbilitySagaReceipt = Object.freeze({
    sagaVersion: nextVersion,
    commandId: command.commandId,
    requestSha256: command.requestSha256,
    action: command.action,
    resultingStatus: nextStatus,
    optionId: command.optionId,
    actorKind: authorization.kind,
    actorId: authorization.id,
    occurredAt: command.occurredAt,
    reasonCode: command.reasonCode,
    chainId: saga.resolution.trigger.chainId,
    triggerId: saga.resolution.trigger.triggerId,
    eventId: saga.resolution.trigger.eventId,
  })
  const terminal = nextStatus === 'resuming' ? null : {
    status: nextStatus,
    commandId: command.commandId,
    occurredAt: command.occurredAt,
    reasonCode: command.reasonCode,
  }
  const next = parsePendingAbilitySaga({
    schemaVersion: PENDING_ABILITY_SAGA_SCHEMA_VERSION,
    resolution: saga.resolution,
    sagaVersion: nextVersion,
    status: nextStatus,
    updatedAt: command.occurredAt,
    selectedOptionId: command.action === 'select' ? command.optionId : saga.selectedOptionId,
    receipts: [...saga.receipts, receipt],
    terminal,
  })
  return Object.freeze({ status: 'applied', saga: next })
}

export const applyPendingAbilitySagaCommand = (input: {
  readonly store: PendingAbilitySagaStore
  readonly command: unknown
  readonly authorization: PendingAbilitySagaAuthorization
  readonly revisionForRecovery?: (read: PendingAbilityRead) => number | null
}): PendingAbilitySagaTransitionResult => {
  const command = parsePendingAbilitySagaCommand(input.command)
  return input.store.transaction((transaction) => {
    const stored = transaction.load(command.resolutionId)
      ?? fail('not-found', 'Pending ability saga was not found.')
    const result = transitionPendingAbilitySaga({
      saga: stored,
      command,
      authorization: input.authorization,
      ...(input.revisionForRecovery ? { revisionForRecovery: input.revisionForRecovery } : {}),
    })
    if (result.status === 'duplicate') return result
    if (!transaction.compareAndSet(
      command.resolutionId,
      command.expectedSagaVersion,
      result.saga,
    )) fail('concurrent-conflict', 'Pending ability saga changed during commit.')
    return result
  })
}

export { createPendingAbilitySaga }
