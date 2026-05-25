import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  SESSION_COMMAND_DUPLICATE_ORIGINAL_STATUSES,
  SESSION_COMMAND_REJECTION_REASONS,
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  SESSION_COMMAND_RESULT_STATUSES,
  isSessionCommandAcceptedResult,
  isSessionCommandDuplicateOriginalStatus,
  isSessionCommandDuplicateResult,
  isSessionCommandRejectedResult,
  isSessionCommandRejectionReason,
  isSessionCommandResultStatus,
  type SessionCommandAcceptedResult,
  type SessionCommandConflictResult,
  type SessionCommandDuplicateOriginalStatus,
  type SessionCommandDuplicateOriginalSummary,
  type SessionCommandDuplicateResult,
  type SessionCommandInvalidResult,
  type SessionCommandRejectedResult,
  type SessionCommandRejectionReason,
  type SessionCommandResult,
  type SessionCommandResultMetadata,
  type SessionCommandResultStatus,
  type SessionCommandStaleResult,
  type SessionCommandUnauthorizedResult,
  type SessionCommandValidationIssue,
} from '#shared/sessionCommandResults'
import { parseOpId, type SessionCommandScope } from '#shared/sessionCommands'
import {
  parseClientId,
  parsePlayerId,
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import type { PermissionDenied, PlayerSessionActor, SessionTokenResourceRef } from '#shared/sessionPermissions'
import { parseRevision, type Revision } from '#shared/sessionRevisions'

const sessionId = parseSessionId('session_results00001')
const playerId = parsePlayerId('player_result01')
const playerClientId = parseClientId('client_result01')
const displayName = sanitizeSessionDisplayName('Result Tester')
const opId = parseOpId('op_result0001')

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const tokenResource = {
  kind: 'token',
  tokenId: 'token-001',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionTokenResourceRef

const tokenScope = {
  lane: 'token',
  resource: tokenResource,
  field: 'position',
  mapSlug: 'viridian-gym',
} as const satisfies SessionCommandScope

interface TokenMovedEvent {
  readonly eventType: 'tokenMoved'
  readonly tokenId: string
  readonly to: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
}

interface TokenState {
  readonly tokenId: string
  readonly position: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
}

const currentTokenState = {
  tokenId: 'token-001',
  position: { x: 3, y: 4, z: 0 },
} as const satisfies TokenState

describe('session command result contract types', () => {
  it('defines result status, rejection reason, and duplicate-original reason vocabularies', () => {
    expect(SESSION_COMMAND_RESULT_SCHEMA_VERSION).toBe(1)
    expect(SESSION_COMMAND_RESULT_STATUSES).toEqual(['accepted', 'rejected', 'duplicate'])
    expect(SESSION_COMMAND_REJECTION_REASONS).toEqual([
      'invalid',
      'unauthorized',
      'stale',
      'conflict',
    ])
    expect(SESSION_COMMAND_DUPLICATE_ORIGINAL_STATUSES).toEqual(['accepted', 'rejected'])

    expect(isSessionCommandResultStatus('accepted')).toBe(true)
    expect(isSessionCommandResultStatus('ignored')).toBe(false)
    expect(isSessionCommandRejectionReason('stale')).toBe(true)
    expect(isSessionCommandRejectionReason('permission-denied')).toBe(false)
    expect(isSessionCommandDuplicateOriginalStatus('rejected')).toBe(true)
    expect(isSessionCommandDuplicateOriginalStatus('duplicate')).toBe(false)

    expectTypeOf<(typeof SESSION_COMMAND_RESULT_STATUSES)[number]>().toEqualTypeOf<SessionCommandResultStatus>()
    expectTypeOf<(typeof SESSION_COMMAND_REJECTION_REASONS)[number]>().toEqualTypeOf<SessionCommandRejectionReason>()
    expectTypeOf<(typeof SESSION_COMMAND_DUPLICATE_ORIGINAL_STATUSES)[number]>().toEqualTypeOf<
      SessionCommandDuplicateOriginalStatus
    >()
  })

  it('models accepted command acknowledgements with authoritative revision and safe event data', () => {
    const metadata = {
      serverProcessedAt: '2026-05-25T00:00:00.000Z',
      traceId: 'move-token-result-001',
      attributes: {
        persisted: true,
        retryCount: 0,
        note: null,
      },
    } as const satisfies SessionCommandResultMetadata

    const accepted = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'accepted',
      accepted: true,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: playerActor,
      currentRevision: parseRevision(8),
      scopes: [tokenScope],
      event: {
        eventType: 'tokenMoved',
        tokenId: 'token-001',
        to: { x: 4, y: 5, z: 0 },
      },
      metadata,
    } as const satisfies SessionCommandAcceptedResult<'moveToken', TokenMovedEvent>

    expect(accepted.status).toBe('accepted')
    expect(accepted.accepted).toBe(true)
    expect(accepted.currentRevision).toBe(8)
    expect(accepted.event.to).toEqual({ x: 4, y: 5, z: 0 })
    expect(isSessionCommandAcceptedResult(accepted)).toBe(true)
    expect(isSessionCommandRejectedResult(accepted)).toBe(false)

    expectTypeOf(accepted).toMatchTypeOf<SessionCommandResult<'moveToken', TokenMovedEvent>>()
    expectTypeOf(accepted.currentRevision).toMatchTypeOf<Revision>()
  })

  it('models invalid, unauthorized, stale, and conflict rejections with safe reconciliation fields', () => {
    const validationIssue = {
      path: 'payload.to.x',
      code: 'number.required',
      message: 'Destination x coordinate is required.',
      expected: 'number',
      received: 'undefined',
    } as const satisfies SessionCommandValidationIssue

    const invalid = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'rejected',
      accepted: false,
      reason: 'invalid',
      message: 'The moveToken command is malformed.',
      retryable: false,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: playerActor,
      currentRevision: parseRevision(8),
      scopes: [tokenScope],
      issues: [validationIssue],
    } as const satisfies SessionCommandInvalidResult<'moveToken'>

    const permission = {
      allowed: false,
      role: 'player',
      reason: 'resource-not-assigned',
      message: 'This token is not assigned to the player.',
      resource: tokenResource,
    } as const satisfies PermissionDenied

    const unauthorized = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'rejected',
      accepted: false,
      reason: 'unauthorized',
      message: 'This player cannot control the token.',
      retryable: false,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: playerActor,
      currentRevision: parseRevision(8),
      scopes: [tokenScope],
      permission,
      resource: tokenResource,
      currentState: currentTokenState,
    } as const satisfies SessionCommandUnauthorizedResult<'moveToken', TokenState>

    const stale = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'rejected',
      accepted: false,
      reason: 'stale',
      message: 'The token moved after the command was created.',
      retryable: true,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: playerActor,
      baseRevision: parseRevision(7),
      currentRevision: parseRevision(9),
      scopes: [tokenScope],
      changedScopes: [tokenScope],
      currentState: currentTokenState,
    } as const satisfies SessionCommandStaleResult<'moveToken', TokenState>

    const conflict = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'rejected',
      accepted: false,
      reason: 'conflict',
      message: 'The destination is no longer available.',
      retryable: true,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: playerActor,
      currentRevision: parseRevision(10),
      scopes: [tokenScope],
      conflictingScopes: [tokenScope],
      conflictRevision: parseRevision(10),
      currentState: currentTokenState,
    } as const satisfies SessionCommandConflictResult<'moveToken', TokenState>

    expect(isSessionCommandRejectedResult(invalid)).toBe(true)
    expect(invalid.issues).toEqual([validationIssue])
    expect(unauthorized.permission.reason).toBe('resource-not-assigned')
    expect(stale.baseRevision).toBe(7)
    expect(stale.currentState.position).toEqual({ x: 3, y: 4, z: 0 })
    expect(conflict.conflictingScopes[0]?.resource).toEqual(tokenResource)

    const summarizeRejection = (
      result: SessionCommandRejectedResult<'moveToken', TokenState>,
    ): SessionCommandRejectionReason => {
      switch (result.reason) {
        case 'invalid':
          expectTypeOf(result.issues).toMatchTypeOf<readonly SessionCommandValidationIssue[]>()
          break
        case 'unauthorized':
          expectTypeOf(result.permission).toMatchTypeOf<PermissionDenied | undefined>()
          break
        case 'stale':
          expectTypeOf(result.currentState).toEqualTypeOf<TokenState>()
          break
        case 'conflict':
          expectTypeOf(result.conflictingScopes).toMatchTypeOf<readonly SessionCommandScope[]>()
          break
      }
      return result.reason
    }

    expect([invalid, unauthorized, stale, conflict].map(summarizeRejection)).toEqual([
      'invalid',
      'unauthorized',
      'stale',
      'conflict',
    ])
  })

  it('models duplicate opId replies without reapplying the command', () => {
    const duplicateAccepted = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'duplicate',
      duplicate: true,
      idempotent: true,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: playerActor,
      currentRevision: parseRevision(11),
      scopes: [tokenScope],
      original: {
        status: 'accepted',
        revision: parseRevision(8),
      },
    } as const satisfies SessionCommandDuplicateResult<'moveToken'>

    const duplicateRejected = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'duplicate',
      duplicate: true,
      idempotent: true,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: playerActor,
      currentRevision: parseRevision(11),
      scopes: [tokenScope],
      original: {
        status: 'rejected',
        revision: parseRevision(9),
        reason: 'stale',
      },
    } as const satisfies SessionCommandDuplicateResult<'moveToken'>

    expect(isSessionCommandDuplicateResult(duplicateAccepted)).toBe(true)
    expect(duplicateAccepted.original.status).toBe('accepted')
    expect(duplicateAccepted.original.revision).toBe(8)
    expect(duplicateRejected.original.reason).toBe('stale')
    expect(duplicateRejected.currentRevision).toBe(11)

    expectTypeOf(duplicateAccepted.original).toMatchTypeOf<SessionCommandDuplicateOriginalSummary>()
    expectTypeOf(duplicateRejected).toMatchTypeOf<SessionCommandResult<'moveToken'>>()
  })
})
