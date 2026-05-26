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
  DELETE_TOKEN_COMMAND_SCOPE_FIELD,
  DELETE_TOKEN_COMMAND_TYPE,
  DELETE_TOKEN_COMMAND_VALIDATION_CODES,
  MOVE_TOKEN_COMMAND_SCOPE_FIELD,
  MOVE_TOKEN_COMMAND_TYPE,
  MOVE_TOKEN_COMMAND_VALIDATION_CODES,
  SESSION_TOKEN_FACING_DIRECTIONS,
  SPAWN_TOKEN_COMMAND_SCOPE_FIELD,
  SPAWN_TOKEN_COMMAND_TYPE,
  SPAWN_TOKEN_COMMAND_VALIDATION_CODES,
  TURN_TOKEN_COMMAND_SCOPE_FIELD,
  TURN_TOKEN_COMMAND_TYPE,
  TURN_TOKEN_COMMAND_VALIDATION_CODES,
  assertValidDeleteTokenCommand,
  assertValidMoveTokenCommand,
  assertValidSpawnTokenCommand,
  assertValidTurnTokenCommand,
  createDeleteTokenCommandScope,
  createMoveTokenCommandScope,
  createSpawnTokenCommandScope,
  createTurnTokenCommandScope,
  isDeleteTokenCommandValidationCode,
  isMoveTokenCommandValidationCode,
  isMoveTokenPosition,
  isSessionTokenFacingDirection,
  isSpawnTokenCommandValidationCode,
  isSpawnTokenPlacementPayload,
  isTurnTokenCommandValidationCode,
  validateDeleteTokenCommand,
  validateMoveTokenCommand,
  validateSpawnTokenCommand,
  validateTurnTokenCommand,
  type DeleteTokenCommand,
  type DeleteTokenCommandPayload,
  type DeleteTokenCommandValidationCode,
  type MoveTokenCommand,
  type MoveTokenCommandPayload,
  type MoveTokenCommandValidationCode,
  type MoveTokenGridPosition,
  type SpawnTokenCommand,
  type SpawnTokenCommandPayload,
  type SpawnTokenCommandValidationCode,
  type TurnTokenCommand,
  type TurnTokenCommandPayload,
  type TurnTokenCommandValidationCode,
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

const buildTurnTokenCommand = (
  overrides: Partial<TurnTokenCommandPayload> = {},
  actor: PlayerSessionActor | GmSessionActor = playerActor,
): TurnTokenCommand<typeof actor> => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor,
  type: TURN_TOKEN_COMMAND_TYPE,
  opId,
  baseRevision: parseSessionRevision(7),
  scopes: [createTurnTokenCommandScope(tokenResource)],
  payload: {
    tokenId: 'token-pikachu',
    facing: 'north-west',
    ...overrides,
  },
})

const buildSpawnTokenCommand = (
  overrides: Partial<SpawnTokenCommandPayload['placement']> = {},
  actor: PlayerSessionActor | GmSessionActor = gmActor,
): SpawnTokenCommand<typeof actor> => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor,
  type: SPAWN_TOKEN_COMMAND_TYPE,
  opId,
  baseRevision: parseSessionRevision(7),
  scopes: [createSpawnTokenCommandScope(tokenResource)],
  payload: {
    placement: {
      id: 'token-pikachu',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 4, y: 1, z: 6 },
      facing: 'south-east',
      ...overrides,
    },
  },
})

const buildDeleteTokenCommand = (
  overrides: Partial<DeleteTokenCommandPayload> = {},
  actor: PlayerSessionActor | GmSessionActor = gmActor,
): DeleteTokenCommand<typeof actor> => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor,
  type: DELETE_TOKEN_COMMAND_TYPE,
  opId,
  baseRevision: parseSessionRevision(7),
  scopes: [createDeleteTokenCommandScope(tokenResource)],
  payload: {
    tokenId: 'token-pikachu',
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

describe('turnToken command contract and validator', () => {
  it('defines the command type, payload, facing values, and token facing scope helper', () => {
    const payload = {
      tokenId: 'token-pikachu',
      facing: 'north-west',
    } as const satisfies TurnTokenCommandPayload
    const scope = createTurnTokenCommandScope(tokenResource)

    expect(TURN_TOKEN_COMMAND_TYPE).toBe('turnToken')
    expect(TURN_TOKEN_COMMAND_SCOPE_FIELD).toBe('facing')
    expect(SESSION_TOKEN_FACING_DIRECTIONS).toEqual([
      'south-east',
      'north-east',
      'north-west',
      'south-west',
    ])
    expect(TURN_TOKEN_COMMAND_VALIDATION_CODES).toContain('invalid-facing')
    expect(isTurnTokenCommandValidationCode('permission-denied')).toBe(true)
    expect(isTurnTokenCommandValidationCode('invalid-position')).toBe(false)
    expect(isSessionTokenFacingDirection(payload.facing)).toBe(true)
    expect(isSessionTokenFacingDirection('north')).toBe(false)
    expect(scope).toEqual({
      lane: 'token',
      resource: tokenResource,
      field: 'facing',
      mapSlug: 'viridian-gym',
    })

    expectTypeOf<(typeof TURN_TOKEN_COMMAND_VALIDATION_CODES)[number]>()
      .toEqualTypeOf<TurnTokenCommandValidationCode>()
  })

  it('accepts valid player and GM turnToken commands with token-control permission checks', () => {
    const playerCommand = buildTurnTokenCommand()
    const playerResult = validateTurnTokenCommand(playerCommand, { assignments })
    const gmCommand = buildTurnTokenCommand({}, gmActor)
    const gmResult = validateTurnTokenCommand(gmCommand)

    expect(playerResult.valid).toBe(true)
    if (!playerResult.valid) throw new Error('expected player turnToken command to validate')
    expect(playerResult.payload).toEqual({ tokenId: 'token-pikachu', facing: 'north-west' })
    expect(playerResult.resource).toEqual(tokenResource)
    expect(playerResult.permission).toMatchObject({ allowed: true, role: 'player' })
    expect(assertValidTurnTokenCommand(playerCommand, { assignments })).toBe(playerCommand)
    expectTypeOf(playerResult.command).toMatchTypeOf<SessionCommandEnvelope<'turnToken'>>()

    expect(gmResult.valid).toBe(true)
    if (!gmResult.valid) throw new Error('expected GM turnToken command to validate')
    expect(gmResult.permission).toMatchObject({ allowed: true, role: 'gm' })
  })

  it('validates turnToken command type, payload facing shape, and matching facing scope', () => {
    const invalidPayloadCommand = {
      ...buildTurnTokenCommand(),
      type: 'moveToken',
      payload: {
        tokenId: '',
        facing: 'north',
      },
    }
    const invalidScopeCommand = {
      ...buildTurnTokenCommand(),
      scopes: [
        {
          lane: 'token',
          resource: tokenResource,
          field: 'position',
          mapSlug: 'viridian-gym',
        },
      ],
    }

    const payloadResult = validateTurnTokenCommand(invalidPayloadCommand, { assignments })
    const payloadIssueByPath = new Map(payloadResult.issues.map((issue) => [issue.path, issue]))
    const scopeResult = validateTurnTokenCommand(invalidScopeCommand, { assignments })

    expect(payloadResult.valid).toBe(false)
    expect(payloadIssueByPath.get('type')?.code).toBe('invalid-command-type')
    expect(payloadIssueByPath.get('payload.tokenId')?.code).toBe('invalid-token-id')
    expect(payloadIssueByPath.get('payload.facing')?.code).toBe('invalid-facing')
    expect(scopeResult.valid).toBe(false)
    expect(scopeResult.issues).toMatchObject([
      {
        path: 'scopes',
        code: 'invalid-token-scope',
      },
    ])
  })

  it('denies player turnToken commands for unassigned, hidden, or unknown-player token control', () => {
    const unassignedCommand = {
      ...buildTurnTokenCommand({ tokenId: 'token-eevee' }),
      scopes: [createTurnTokenCommandScope(unassignedTokenResource)],
    }
    const hiddenAssignment = {
      ...assignment,
      visibleResources: [],
    } satisfies PlayerAssignmentRecord
    const unknownPlayerCommand = buildTurnTokenCommand({}, otherPlayerActor)

    const unassignedResult = validateTurnTokenCommand(unassignedCommand, { assignments })
    const hiddenResult = validateTurnTokenCommand(buildTurnTokenCommand(), {
      assignments: [hiddenAssignment],
    })
    const unknownResult = validateTurnTokenCommand(unknownPlayerCommand, { assignments })

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
    expect(() => assertValidTurnTokenCommand(unassignedCommand, { assignments }, 'test turn'))
      .toThrow('test turn is invalid')
  })
})

describe('spawnToken command contract and validator', () => {
  it('defines the GM-only spawnToken command, payload, and token spawn scope helper', () => {
    const payload = {
      placement: {
        id: 'token-pikachu',
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
        position: { x: 4, y: 1, z: 6 },
        facing: 'south-east',
      },
    } as const satisfies SpawnTokenCommandPayload
    const scope = createSpawnTokenCommandScope(tokenResource)

    expect(SPAWN_TOKEN_COMMAND_TYPE).toBe('spawnToken')
    expect(SPAWN_TOKEN_COMMAND_SCOPE_FIELD).toBe('spawn')
    expect(SPAWN_TOKEN_COMMAND_VALIDATION_CODES).toContain('permission-denied')
    expect(isSpawnTokenCommandValidationCode('invalid-sheet-kind')).toBe(true)
    expect(isSpawnTokenCommandValidationCode('invalid-op-id')).toBe(false)
    expect(isSpawnTokenPlacementPayload(payload.placement)).toBe(true)
    expect(scope).toEqual({
      lane: 'token',
      resource: tokenResource,
      field: 'spawn',
      mapSlug: 'viridian-gym',
    })

    expectTypeOf<(typeof SPAWN_TOKEN_COMMAND_VALIDATION_CODES)[number]>()
      .toEqualTypeOf<SpawnTokenCommandValidationCode>()
  })

  it('accepts valid GM spawnToken commands and rejects player actors as unauthorized', () => {
    const gmCommand = buildSpawnTokenCommand()
    const gmResult = validateSpawnTokenCommand(gmCommand)
    const playerCommand = buildSpawnTokenCommand({}, playerActor)
    const playerResult = validateSpawnTokenCommand(playerCommand)

    expect(gmResult.valid).toBe(true)
    if (!gmResult.valid) throw new Error('expected GM spawnToken command to validate')
    expect(gmResult.command).toBe(gmCommand)
    expect(gmResult.payload).toEqual(gmCommand.payload)
    expect(gmResult.resource).toEqual(tokenResource)
    expect(gmResult.permission).toMatchObject({ allowed: true, role: 'gm' })
    expect(assertValidSpawnTokenCommand(gmCommand)).toBe(gmCommand)
    expectTypeOf(gmResult.command).toMatchTypeOf<SessionCommandEnvelope<'spawnToken'>>()

    expect(playerResult.valid).toBe(false)
    expect(playerResult).toMatchObject({
      permission: { allowed: false, reason: 'gm-required', role: 'player' },
    })
  })

  it('validates spawnToken payload shape and matching token spawn scope', () => {
    const invalidPayloadCommand = {
      ...buildSpawnTokenCommand(),
      payload: {
        placement: {
          id: '',
          sheetKind: 'item',
          sheetSlug: '',
          position: { x: -1, y: 1.5, z: Number.NaN },
          facing: 'north',
          initiative: 1.25,
        },
      },
    }
    const invalidScopeCommand = {
      ...buildSpawnTokenCommand(),
      scopes: [createMoveTokenCommandScope(tokenResource)],
    }

    const payloadResult = validateSpawnTokenCommand(invalidPayloadCommand)
    const payloadIssueByPath = new Map(payloadResult.issues.map((issue) => [issue.path, issue]))
    const scopeResult = validateSpawnTokenCommand(invalidScopeCommand)

    expect(payloadResult.valid).toBe(false)
    expect(payloadIssueByPath.get('payload.placement.id')?.code).toBe('invalid-token-id')
    expect(payloadIssueByPath.get('payload.placement.sheetKind')?.code).toBe('invalid-sheet-kind')
    expect(payloadIssueByPath.get('payload.placement.sheetSlug')?.code).toBe('invalid-sheet-slug')
    expect(payloadIssueByPath.get('payload.placement.position.x')?.code).toBe('invalid-position')
    expect(payloadIssueByPath.get('payload.placement.position.y')?.code).toBe('invalid-position')
    expect(payloadIssueByPath.get('payload.placement.position.z')?.code).toBe('invalid-position')
    expect(payloadIssueByPath.get('payload.placement.facing')?.code).toBe('invalid-facing')
    expect(payloadIssueByPath.get('payload.placement.initiative')?.code).toBe('invalid-initiative')
    expect(scopeResult.valid).toBe(false)
    expect(scopeResult.issues).toMatchObject([
      {
        path: 'scopes',
        code: 'invalid-token-scope',
      },
    ])
  })
})

describe('deleteToken command contract and validator', () => {
  it('defines the GM-only deleteToken command, payload, and token delete scope helper', () => {
    const payload = {
      tokenId: 'token-pikachu',
    } as const satisfies DeleteTokenCommandPayload
    const scope = createDeleteTokenCommandScope(tokenResource)

    expect(DELETE_TOKEN_COMMAND_TYPE).toBe('deleteToken')
    expect(DELETE_TOKEN_COMMAND_SCOPE_FIELD).toBe('delete')
    expect(DELETE_TOKEN_COMMAND_VALIDATION_CODES).toContain('permission-denied')
    expect(isDeleteTokenCommandValidationCode('invalid-token-id')).toBe(true)
    expect(isDeleteTokenCommandValidationCode('invalid-position')).toBe(false)
    expect(scope).toEqual({
      lane: 'token',
      resource: tokenResource,
      field: 'delete',
      mapSlug: 'viridian-gym',
    })

    expectTypeOf<(typeof DELETE_TOKEN_COMMAND_VALIDATION_CODES)[number]>()
      .toEqualTypeOf<DeleteTokenCommandValidationCode>()
    expectTypeOf(payload).toMatchTypeOf<DeleteTokenCommandPayload>()
  })

  it('accepts valid GM deleteToken commands and rejects player actors as unauthorized', () => {
    const gmCommand = buildDeleteTokenCommand()
    const gmResult = validateDeleteTokenCommand(gmCommand)
    const playerCommand = buildDeleteTokenCommand({}, playerActor)
    const playerResult = validateDeleteTokenCommand(playerCommand)

    expect(gmResult.valid).toBe(true)
    if (!gmResult.valid) throw new Error('expected GM deleteToken command to validate')
    expect(gmResult.command).toBe(gmCommand)
    expect(gmResult.payload).toEqual({ tokenId: 'token-pikachu' })
    expect(gmResult.resource).toEqual(tokenResource)
    expect(gmResult.permission).toMatchObject({ allowed: true, role: 'gm' })
    expect(assertValidDeleteTokenCommand(gmCommand)).toBe(gmCommand)
    expectTypeOf(gmResult.command).toMatchTypeOf<SessionCommandEnvelope<'deleteToken'>>()

    expect(playerResult.valid).toBe(false)
    expect(playerResult).toMatchObject({
      permission: { allowed: false, reason: 'gm-required', role: 'player' },
    })
  })

  it('validates deleteToken payload shape and matching token delete scope', () => {
    const invalidPayloadCommand = {
      ...buildDeleteTokenCommand(),
      type: 'spawnToken',
      payload: {
        tokenId: '',
      },
    }
    const invalidScopeCommand = {
      ...buildDeleteTokenCommand(),
      scopes: [createTurnTokenCommandScope(tokenResource)],
    }

    const payloadResult = validateDeleteTokenCommand(invalidPayloadCommand)
    const payloadIssueByPath = new Map(payloadResult.issues.map((issue) => [issue.path, issue]))
    const scopeResult = validateDeleteTokenCommand(invalidScopeCommand)

    expect(payloadResult.valid).toBe(false)
    expect(payloadIssueByPath.get('type')?.code).toBe('invalid-command-type')
    expect(payloadIssueByPath.get('payload.tokenId')?.code).toBe('invalid-token-id')
    expect(scopeResult.valid).toBe(false)
    expect(scopeResult.issues).toMatchObject([
      {
        path: 'scopes',
        code: 'invalid-token-scope',
      },
    ])
    expect(() => assertValidDeleteTokenCommand(invalidScopeCommand, {}, 'test delete'))
      .toThrow('test delete is invalid')
  })
})
