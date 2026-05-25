import { describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  type SessionCommandDuplicateResult,
} from '#shared/sessionCommandResults'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  formatOperationIdScopeKey,
  getCommandOperationIdScope,
  parseOpId,
  type SessionCommandEnvelope,
  type SessionCommandScope,
} from '#shared/sessionCommands'
import {
  parseClientId,
  parsePlayerId,
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import {
  canActorControlResource,
  canActorViewResource,
  isResourceControllableByPlayer,
  isResourceVisibleToPlayer,
  type GmSessionActor,
  type PlayerAssignmentRecord,
  type PlayerSessionActor,
  type SessionMapResourceRef,
  type SessionSheetResourceRef,
  type SessionTokenResourceRef,
} from '#shared/sessionPermissions'
import { parseRevision } from '#shared/sessionRevisions'
import { collectSessionCommandEnvelopeIssues } from '#shared/sessionCommandValidation'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionCommandAckMessage,
  type SessionCommandMessage,
} from '#shared/sessionMessages'

const sessionId = parseSessionId('session_regression01')
const otherSessionId = parseSessionId('session_regression02')
const playerId = parsePlayerId('player_regress01')
const otherPlayerId = parsePlayerId('player_regress02')
const gmClientId = parseClientId('client_regressGM')
const playerClientId = parseClientId('client_regress01')
const otherClientId = parseClientId('client_regress02')
const displayName = sanitizeSessionDisplayName('Regression Player')
const opId = parseOpId('op_regress0001')

const gmActor: GmSessionActor = {
  role: 'gm',
  clientId: gmClientId,
}

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const sameNameOtherPlayerActor: PlayerSessionActor = {
  role: 'player',
  playerId: otherPlayerId,
  clientId: otherClientId,
  displayName,
}

const visibleMap = {
  kind: 'map',
  mapSlug: 'viridian-gym',
} as const satisfies SessionMapResourceRef

const hiddenMap = {
  kind: 'map',
  mapSlug: 'rocket-hideout',
} as const satisfies SessionMapResourceRef

const pikachuSheet = {
  kind: 'sheet',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionSheetResourceRef

const tokenIdOnlyGrant = {
  kind: 'token',
  tokenId: 'token-pikachu',
} as const satisfies SessionTokenResourceRef

const assignedVisibleToken = {
  kind: 'token',
  tokenId: 'token-pikachu',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionTokenResourceRef

const unassignedVisibleToken = {
  kind: 'token',
  tokenId: 'token-eevee',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'eevee',
} as const satisfies SessionTokenResourceRef

const assignedHiddenToken = {
  kind: 'token',
  tokenId: 'token-secret',
  mapSlug: 'rocket-hideout',
} as const satisfies SessionTokenResourceRef

const tokenScope = {
  lane: 'token',
  resource: assignedVisibleToken,
  field: 'position',
  mapSlug: 'viridian-gym',
} as const satisfies SessionCommandScope

interface MoveTokenPayload {
  readonly tokenId: string
  readonly to: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
}

const moveTokenPayload = {
  tokenId: 'token-pikachu',
  to: { x: 6, y: 7, z: 0 },
} as const satisfies MoveTokenPayload

const buildMoveTokenCommand = (): SessionCommandEnvelope<
  'moveToken',
  MoveTokenPayload,
  PlayerSessionActor
> => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: 'moveToken',
  opId,
  baseRevision: parseRevision(4),
  scopes: [tokenScope],
  payload: moveTokenPayload,
  metadata: {
    clientIssuedAt: '2026-05-25T00:00:00.000Z',
    clientSequence: 3,
    traceId: 'trace-regression-001',
    attributes: {
      optimisticPreview: true,
      inputDevice: 'pointer',
      retryCount: 0,
      note: null,
    },
  },
})

describe('session schema and contract regression coverage', () => {
  it('locks representative command and duplicate-ack protocol serialization', () => {
    const command = buildMoveTokenCommand()
    const commandMessage = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'command',
      direction: 'client',
      sessionId,
      messageId: 'msg-command-001',
      sentAt: '2026-05-25T00:00:00.000Z',
      traceId: 'trace-regression-001',
      command,
    } as const satisfies SessionCommandMessage<typeof command>

    const duplicateResult = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'duplicate',
      duplicate: true,
      idempotent: true,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: playerActor,
      currentRevision: parseRevision(6),
      scopes: [tokenScope],
      original: {
        status: 'accepted',
        revision: parseRevision(5),
      },
    } as const satisfies SessionCommandDuplicateResult<'moveToken'>

    const duplicateAckMessage = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandAck',
      direction: 'server',
      sessionId,
      messageId: 'msg-duplicate-ack-001',
      sentAt: '2026-05-25T00:00:00.050Z',
      traceId: 'trace-regression-001',
      result: duplicateResult,
    } as const satisfies SessionCommandAckMessage<'moveToken'>

    expect([commandMessage, duplicateAckMessage].map((message) => JSON.stringify(message))).toEqual([
      [
        '{"schemaVersion":1,',
        '"type":"command",',
        '"direction":"client",',
        '"sessionId":"session_regression01",',
        '"messageId":"msg-command-001",',
        '"sentAt":"2026-05-25T00:00:00.000Z",',
        '"traceId":"trace-regression-001",',
        '"command":{',
        '"schemaVersion":1,',
        '"sessionId":"session_regression01",',
        '"actor":{"role":"player","playerId":"player_regress01",',
        '"clientId":"client_regress01","displayName":"Regression Player"},',
        '"type":"moveToken",',
        '"opId":"op_regress0001",',
        '"baseRevision":4,',
        '"scopes":[{"lane":"token",',
        '"resource":{"kind":"token","tokenId":"token-pikachu",',
        '"mapSlug":"viridian-gym","sheetKind":"pokemon","sheetSlug":"pikachu"},',
        '"field":"position","mapSlug":"viridian-gym"}],',
        '"payload":{"tokenId":"token-pikachu","to":{"x":6,"y":7,"z":0}},',
        '"metadata":{"clientIssuedAt":"2026-05-25T00:00:00.000Z",',
        '"clientSequence":3,"traceId":"trace-regression-001",',
        '"attributes":{"optimisticPreview":true,"inputDevice":"pointer",',
        '"retryCount":0,"note":null}}}}',
      ].join(''),
      [
        '{"schemaVersion":1,',
        '"type":"commandAck",',
        '"direction":"server",',
        '"sessionId":"session_regression01",',
        '"messageId":"msg-duplicate-ack-001",',
        '"sentAt":"2026-05-25T00:00:00.050Z",',
        '"traceId":"trace-regression-001",',
        '"result":{',
        '"schemaVersion":1,',
        '"status":"duplicate",',
        '"duplicate":true,',
        '"idempotent":true,',
        '"sessionId":"session_regression01",',
        '"opId":"op_regress0001",',
        '"commandType":"moveToken",',
        '"actor":{"role":"player","playerId":"player_regress01",',
        '"clientId":"client_regress01","displayName":"Regression Player"},',
        '"currentRevision":6,',
        '"scopes":[{"lane":"token",',
        '"resource":{"kind":"token","tokenId":"token-pikachu",',
        '"mapSlug":"viridian-gym","sheetKind":"pokemon","sheetSlug":"pikachu"},',
        '"field":"position","mapSlug":"viridian-gym"}],',
        '"original":{"status":"accepted","revision":5}}}',
      ].join(''),
    ])
  })

  const invalidEnvelopeCases = [
    {
      name: 'rejects non-object envelope values',
      envelope: [],
      expected: ['$:not-object'],
    },
    {
      name: 'keeps common required-field order stable',
      envelope: { schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION },
      expected: [
        'sessionId:missing-field',
        'actor:missing-field',
        'type:missing-field',
        'opId:missing-field',
        'baseRevision:missing-field',
        'scopes:missing-field',
        'payload:missing-field',
      ],
    },
    {
      name: 'rejects empty scope lists before command-specific validation',
      envelope: { ...buildMoveTokenCommand(), scopes: [] },
      expected: ['scopes:invalid-scopes'],
    },
    {
      name: 'rejects malformed common resource, metadata, and payload fields',
      envelope: {
        ...buildMoveTokenCommand(),
        scopes: [
          {
            lane: 'token',
            resource: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: '' },
            field: '',
          },
        ],
        metadata: { attributes: { nonFinite: Number.POSITIVE_INFINITY } },
        payload: undefined,
      },
      expected: [
        'payload:invalid-payload',
        'scopes[0].resource.sheetSlug:invalid-resource-ref',
        'scopes[0].field:invalid-scopes',
        'metadata.attributes.nonFinite:invalid-metadata',
      ],
    },
  ] as const

  it.each(invalidEnvelopeCases)('$name', ({ envelope, expected }) => {
    const issueSummary = collectSessionCommandEnvelopeIssues(envelope).map(
      (issue) => `${issue.path}:${issue.code}`,
    )

    expect(issueSummary).toEqual(expected)
  })

  it('scopes duplicate operation IDs by session, client, and opId', () => {
    const originalCommand = buildMoveTokenCommand()
    const retriedCommand = {
      ...originalCommand,
      metadata: { clientSequence: 4 },
    } satisfies SessionCommandEnvelope<'moveToken', MoveTokenPayload, PlayerSessionActor>
    const sameOpDifferentClient = {
      ...originalCommand,
      actor: { ...playerActor, clientId: otherClientId },
    } satisfies SessionCommandEnvelope<'moveToken', MoveTokenPayload, PlayerSessionActor>
    const sameOpDifferentSession = {
      ...originalCommand,
      sessionId: otherSessionId,
    } satisfies SessionCommandEnvelope<'moveToken', MoveTokenPayload, PlayerSessionActor>

    const originalKey = formatOperationIdScopeKey(getCommandOperationIdScope(originalCommand))
    const retryKey = formatOperationIdScopeKey(getCommandOperationIdScope(retriedCommand))
    const differentClientKey = formatOperationIdScopeKey(
      getCommandOperationIdScope(sameOpDifferentClient),
    )
    const differentSessionKey = formatOperationIdScopeKey(
      getCommandOperationIdScope(sameOpDifferentSession),
    )

    expect(originalKey).toBe('session_regression01:client_regress01:op_regress0001')
    expect(retryKey).toBe(originalKey)
    expect(differentClientKey).toBe('session_regression01:client_regress02:op_regress0001')
    expect(differentSessionKey).toBe('session_regression02:client_regress01:op_regress0001')
    expect(new Set([originalKey, retryKey, differentClientKey, differentSessionKey]).size).toBe(3)
  })

  it('locks player permission edge cases around visibility, assignment, and display-name reuse', () => {
    const assignment = {
      playerId,
      displayName,
      controllableResources: [pikachuSheet, tokenIdOnlyGrant, assignedHiddenToken],
      visibleResources: [visibleMap, pikachuSheet],
      updatedAt: '2026-05-25T00:00:00.000Z',
      updatedByClientId: gmClientId,
    } as const satisfies PlayerAssignmentRecord
    const assignments = [assignment] as const satisfies readonly PlayerAssignmentRecord[]

    expect(canActorViewResource(gmActor, assignments, hiddenMap)).toMatchObject({
      allowed: true,
      role: 'gm',
    })
    expect(canActorControlResource(gmActor, assignments, hiddenMap)).toMatchObject({
      allowed: true,
      role: 'gm',
    })

    expect(isResourceVisibleToPlayer(assignment, assignedVisibleToken)).toBe(true)
    expect(isResourceControllableByPlayer(assignment, assignedVisibleToken)).toBe(true)
    expect(canActorControlResource(playerActor, assignments, assignedVisibleToken)).toMatchObject({
      allowed: true,
      role: 'player',
    })

    expect(canActorViewResource(playerActor, assignments, unassignedVisibleToken)).toMatchObject({
      allowed: true,
      role: 'player',
    })
    expect(canActorControlResource(playerActor, assignments, unassignedVisibleToken)).toMatchObject({
      allowed: false,
      reason: 'resource-not-assigned',
      role: 'player',
    })

    expect(canActorViewResource(playerActor, assignments, assignedHiddenToken)).toMatchObject({
      allowed: false,
      reason: 'resource-not-visible',
      role: 'player',
    })
    expect(canActorControlResource(playerActor, assignments, assignedHiddenToken)).toMatchObject({
      allowed: false,
      reason: 'resource-not-visible',
      role: 'player',
    })
    expect(canActorControlResource(playerActor, assignments, visibleMap)).toMatchObject({
      allowed: false,
      reason: 'resource-not-controllable',
      role: 'player',
    })

    expect(canActorControlResource(sameNameOtherPlayerActor, assignments, assignedVisibleToken)).toMatchObject({
      allowed: false,
      reason: 'missing-player-identity',
      role: 'player',
    })
    expect(
      canActorControlResource(
        { role: 'player', playerId, clientId: otherClientId, displayName: '<unsafe>' },
        assignments,
        assignedVisibleToken,
      ),
    ).toMatchObject({
      allowed: false,
      reason: 'missing-player-identity',
      role: 'player',
    })
  })
})
