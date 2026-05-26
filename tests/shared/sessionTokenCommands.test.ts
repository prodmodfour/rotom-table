import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  type SessionCommandEnvelope,
} from '#shared/sessionCommands'
import {
  parseClientId,
  parsePlayerId,
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import {
  type GmSessionActor,
  type PlayerAssignmentRecord,
  type PlayerSessionActor,
  type SessionTokenResourceRef,
} from '#shared/sessionPermissions'
import { parseSessionRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  MOVE_TOKEN_COMMAND_SCOPE_FIELD,
  MOVE_TOKEN_COMMAND_TYPE,
  MOVE_TOKEN_COMMAND_VALIDATION_CODES,
  assertValidMoveTokenCommand,
  createMoveTokenCommandScope,
  isMoveTokenCommandValidationCode,
  isMoveTokenPosition,
  validateMoveTokenCommand,
  type MoveTokenCommand,
  type MoveTokenCommandPayload,
  type MoveTokenCommandValidationCode,
  type MoveTokenGridPosition,
} from '#shared/sessionTokenCommands'
import { parseOpId } from '#shared/sessionCommands'

const sessionId = parseSessionId('session_movetoken001')
const playerId = parsePlayerId('player_move0001')
const otherPlayerId = parsePlayerId('player_move0002')
const gmClientId = parseClientId('client_moveGM01')
const playerClientId = parseClientId('client_movePL01')
const otherClientId = parseClientId('client_movePL02')
const displayName = sanitizeSessionDisplayName('Move Player')
const otherDisplayName = sanitizeSessionDisplayName('Other Mover')
const opId = parseOpId('op_movetoken001')

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

const otherPlayerActor: PlayerSessionActor = {
  role: 'player',
  playerId: otherPlayerId,
  clientId: otherClientId,
  displayName: otherDisplayName,
}

const tokenResource = {
  kind: 'token',
  tokenId: 'token-pikachu',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionTokenResourceRef

const tokenIdOnlyGrant = {
  kind: 'token',
  tokenId: 'token-pikachu',
} as const satisfies SessionTokenResourceRef

const unassignedTokenResource = {
  kind: 'token',
  tokenId: 'token-eevee',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'eevee',
} as const satisfies SessionTokenResourceRef

const assignment = {
  playerId,
  displayName,
  controllableResources: [tokenIdOnlyGrant],
  visibleResources: [{ kind: 'map', mapSlug: 'viridian-gym' }],
  updatedAt: '2026-05-26T00:00:00.000Z',
  updatedByClientId: gmClientId,
} as const satisfies PlayerAssignmentRecord

const assignments = [assignment] as const satisfies readonly PlayerAssignmentRecord[]

const buildMoveTokenCommand = (
  overrides: Partial<MoveTokenCommandPayload> = {},
  actor: PlayerSessionActor | GmSessionActor = playerActor,
): MoveTokenCommand<typeof actor> => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor,
  type: MOVE_TOKEN_COMMAND_TYPE,
  opId,
  baseRevision: parseSessionRevision(7),
  scopes: [createMoveTokenCommandScope(tokenResource)],
  payload: {
    tokenId: 'token-pikachu',
    to: { x: 4, y: 1, z: 6 },
    ...overrides,
  },
})

describe('moveToken command contract and validator', () => {
  it('defines the command type, payload, grid position, and token position scope helper', () => {
    const payload = {
      tokenId: 'token-pikachu',
      to: { x: 4, y: 1, z: 6 },
    } as const satisfies MoveTokenCommandPayload
    const scope = createMoveTokenCommandScope(tokenResource)

    expect(MOVE_TOKEN_COMMAND_TYPE).toBe('moveToken')
    expect(MOVE_TOKEN_COMMAND_SCOPE_FIELD).toBe('position')
    expect(MOVE_TOKEN_COMMAND_VALIDATION_CODES).toContain('permission-denied')
    expect(isMoveTokenCommandValidationCode('invalid-token-scope')).toBe(true)
    expect(isMoveTokenCommandValidationCode('invalid-op-id')).toBe(false)
    expect(isMoveTokenPosition(payload.to)).toBe(true)
    expect(isMoveTokenPosition({ x: 1, y: -1, z: 0 })).toBe(false)
    expect(scope).toEqual({
      lane: 'token',
      resource: tokenResource,
      field: 'position',
      mapSlug: 'viridian-gym',
    })

    expectTypeOf<(typeof MOVE_TOKEN_COMMAND_VALIDATION_CODES)[number]>()
      .toEqualTypeOf<MoveTokenCommandValidationCode>()
    expectTypeOf(payload.to).toMatchTypeOf<MoveTokenGridPosition>()
  })

  it('accepts a valid player moveToken command only when the token is assigned and visible', () => {
    const command = buildMoveTokenCommand()
    const result = validateMoveTokenCommand(command, { assignments })

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected moveToken command to validate')

    expect(result.command).toBe(command)
    expect(result.payload).toEqual({ tokenId: 'token-pikachu', to: { x: 4, y: 1, z: 6 } })
    expect(result.resource).toEqual(tokenResource)
    expect(result.permission).toMatchObject({ allowed: true, role: 'player' })
    expect(assertValidMoveTokenCommand(command, { assignments })).toBe(command)
    expectTypeOf(result.command).toEqualTypeOf<typeof command>()
    expectTypeOf(result.command.baseRevision).toEqualTypeOf<SessionRevision>()
    expectTypeOf(result.command).toMatchTypeOf<SessionCommandEnvelope<'moveToken'>>()
  })

  it('allows a GM moveToken command without player assignment records', () => {
    const command = buildMoveTokenCommand({}, gmActor)
    const result = validateMoveTokenCommand(command)

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected GM moveToken command to validate')
    expect(result.permission).toMatchObject({ allowed: true, role: 'gm' })
  })

  it('returns common envelope issues for malformed opId and baseRevision values', () => {
    const invalidEnvelope = {
      ...buildMoveTokenCommand(),
      opId: 'not-an-op-id',
      baseRevision: -1,
    }

    const result = validateMoveTokenCommand(invalidEnvelope, { assignments })

    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('expected invalid moveToken command')
    expect(result.issues.map((issue) => `${issue.path}:${issue.code}`)).toEqual([
      'opId:invalid-op-id',
      'baseRevision:invalid-base-revision',
    ])
  })

  it('validates command type and payload token/position shape', () => {
    const invalidPayloadCommand = {
      ...buildMoveTokenCommand(),
      type: 'turnToken',
      payload: {
        tokenId: '',
        to: { x: 1.5, y: -1, z: Number.NaN },
      },
    }

    const result = validateMoveTokenCommand(invalidPayloadCommand, { assignments })
    const issueByPath = new Map(result.issues.map((issue) => [issue.path, issue]))

    expect(result.valid).toBe(false)
    expect(issueByPath.get('type')?.code).toBe('invalid-command-type')
    expect(issueByPath.get('payload.tokenId')?.code).toBe('invalid-token-id')
    expect(issueByPath.get('payload.to.x')?.code).toBe('invalid-position')
    expect(issueByPath.get('payload.to.y')?.code).toBe('invalid-position')
    expect(issueByPath.get('payload.to.z')?.code).toBe('invalid-position')
  })

  it('requires a matching token position scope for permission and conflict checks', () => {
    const missingMatchingScope = {
      ...buildMoveTokenCommand(),
      scopes: [
        {
          lane: 'token',
          resource: unassignedTokenResource,
          field: 'facing',
          mapSlug: 'viridian-gym',
        },
      ],
    }

    const mismatchedMapScope = {
      ...buildMoveTokenCommand(),
      scopes: [
        {
          lane: 'token',
          resource: tokenResource,
          field: 'position',
          mapSlug: 'different-map',
        },
      ],
    }

    const missingResult = validateMoveTokenCommand(missingMatchingScope, { assignments })
    const mismatchResult = validateMoveTokenCommand(mismatchedMapScope, { assignments })

    expect(missingResult.valid).toBe(false)
    expect(missingResult.issues).toMatchObject([
      {
        path: 'scopes',
        code: 'invalid-token-scope',
      },
    ])

    expect(mismatchResult.valid).toBe(false)
    expect(mismatchResult.issues).toMatchObject([
      {
        path: 'scopes[0].mapSlug',
        code: 'invalid-token-scope',
      },
    ])
  })

  it('denies player moveToken commands for unassigned, hidden, or unknown-player token control', () => {
    const unassignedCommand = {
      ...buildMoveTokenCommand({ tokenId: 'token-eevee' }),
      scopes: [createMoveTokenCommandScope(unassignedTokenResource)],
    }
    const hiddenAssignment = {
      ...assignment,
      visibleResources: [],
    } satisfies PlayerAssignmentRecord
    const unknownPlayerCommand = buildMoveTokenCommand({}, otherPlayerActor)

    const unassignedResult = validateMoveTokenCommand(unassignedCommand, { assignments })
    const hiddenResult = validateMoveTokenCommand(buildMoveTokenCommand(), {
      assignments: [hiddenAssignment],
    })
    const unknownResult = validateMoveTokenCommand(unknownPlayerCommand, { assignments })

    expect(unassignedResult.valid).toBe(false)
    expect(unassignedResult).toMatchObject({
      permission: { allowed: false, reason: 'resource-not-assigned', role: 'player' },
    })
    expect(hiddenResult.valid).toBe(false)
    expect(hiddenResult).toMatchObject({
      permission: { allowed: false, reason: 'resource-not-visible', role: 'player' },
    })
    expect(unknownResult.valid).toBe(false)
    expect(unknownResult).toMatchObject({
      permission: { allowed: false, reason: 'missing-player-identity', role: 'player' },
    })
    expect(() => assertValidMoveTokenCommand(unassignedCommand, { assignments }, 'test move'))
      .toThrow('test move is invalid')
  })
})
