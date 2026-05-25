import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  OP_ID_PREFIX,
  SESSION_COMMAND_ENVELOPE_VERSION,
  SESSION_COMMAND_SCOPE_LANES,
  createOpId,
  formatOperationIdScopeKey,
  getCommandOperationIdScope,
  isOpId,
  isSessionCommandScopeLane,
  isSessionCommandType,
  parseOpId,
  parseSessionCommandType,
  type OpId,
  type OperationId,
  type OperationIdScope,
  type OperationIdScopeKey,
  type SessionCommandBaseRevision,
  type SessionCommandEnvelope,
  type SessionCommandMetadata,
  type SessionCommandScope,
  type SessionCommandScopeLane,
} from '#shared/sessionCommands'
import {
  parseClientId,
  parsePlayerId,
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import type { PlayerSessionActor, SessionTokenResourceRef } from '#shared/sessionPermissions'
import {
  parseMapRevision,
  parseRevision,
  type MapRevision,
  type Revision,
} from '#shared/sessionRevisions'

const sessionId = parseSessionId('session_command00001')
const playerId = parsePlayerId('player_cmd00001')
const playerClientId = parseClientId('client_cmd00001')
const otherClientId = parseClientId('client_cmd00002')
const displayName = sanitizeSessionDisplayName('Command Tester')
const opId = parseOpId('op_command0001')

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

interface MoveTokenPayload {
  readonly tokenId: string
  readonly to: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
}

describe('session command envelope types', () => {
  it('brands validated operation IDs and creates prefixed UUID-based IDs', () => {
    const parsedOpId = parseOpId('op_abcDEF123_-z')
    const createdOpId = createOpId(() => '123e4567-e89b-12d3-a456-426614174000')

    expect(OP_ID_PREFIX).toBe('op_')
    expect(parsedOpId).toBe('op_abcDEF123_-z')
    expect(createdOpId).toBe('op_123e4567-e89b-12d3-a456-426614174000')
    expect(isOpId(parsedOpId)).toBe(true)
    expect(isOpId('op_short')).toBe(false)
    expect(isOpId('123e4567-e89b-12d3-a456-426614174000')).toBe(false)
    expect(() => parseOpId('op_short')).toThrow('opId must match')
    expect(() => createOpId(() => 'tiny')).toThrow('opId must match')

    expectTypeOf(parsedOpId).toEqualTypeOf<OpId>()
    expectTypeOf(parsedOpId).toEqualTypeOf<OperationId>()
  })

  it('defines command type names and resource scope lanes without command-specific payloads', () => {
    expect(isSessionCommandType('moveToken')).toBe(true)
    expect(isSessionCommandType('token.move')).toBe(true)
    expect(isSessionCommandType('modify-hp')).toBe(true)
    expect(isSessionCommandType('MoveToken')).toBe(false)
    expect(isSessionCommandType('move token')).toBe(false)
    expect(parseSessionCommandType('initiative.next')).toBe('initiative.next')
    expect(() => parseSessionCommandType('')).toThrow('commandType must match')

    expect(SESSION_COMMAND_SCOPE_LANES).toEqual([
      'session',
      'map',
      'token',
      'sheet',
      'initiative',
      'hazard',
      'field-effect',
      'terrain',
      'assignment',
    ])
    expect(isSessionCommandScopeLane('token')).toBe(true)
    expect(isSessionCommandScopeLane('whole-document')).toBe(false)

    const tokenScope = {
      lane: 'token',
      resource: tokenResource,
      field: 'position',
      mapSlug: 'viridian-gym',
    } as const satisfies SessionCommandScope

    expect(tokenScope.lane).toBe('token')
    expect(tokenScope.resource.tokenId).toBe('token-001')
    expectTypeOf(tokenScope.lane).toMatchTypeOf<SessionCommandScopeLane>()
  })

  it('models a command envelope with opId, baseRevision, actor, scope, payload, and metadata', () => {
    const metadata = {
      clientIssuedAt: '2026-05-25T00:00:00.000Z',
      clientSequence: 12,
      traceId: 'drag-preview-001',
      attributes: {
        optimisticPreview: true,
        inputDevice: 'pointer',
        retryCount: 0,
        note: null,
      },
    } as const satisfies SessionCommandMetadata

    const command = {
      schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
      sessionId,
      actor: playerActor,
      type: 'moveToken',
      opId,
      baseRevision: parseRevision(7),
      scopes: [
        {
          lane: 'token',
          resource: tokenResource,
          field: 'position',
          mapSlug: 'viridian-gym',
        },
      ],
      payload: {
        tokenId: 'token-001',
        to: { x: 4, y: 5, z: 0 },
      },
      metadata,
    } as const satisfies SessionCommandEnvelope<'moveToken', MoveTokenPayload, PlayerSessionActor>

    expect(command.schemaVersion).toBe(1)
    expect(command.sessionId).toBe(sessionId)
    expect(command.actor.clientId).toBe(playerClientId)
    expect(command.opId).toBe(opId)
    expect(command.baseRevision).toBe(7)
    expect(command.scopes[0]?.lane).toBe('token')
    expect(command.payload.to).toEqual({ x: 4, y: 5, z: 0 })
    expect(command.metadata.attributes?.optimisticPreview).toBe(true)

    expectTypeOf(command).toMatchTypeOf<
      SessionCommandEnvelope<'moveToken', MoveTokenPayload, PlayerSessionActor>
    >()
    expectTypeOf(command.baseRevision).toMatchTypeOf<Revision>()
    expectTypeOf(command.baseRevision).toMatchTypeOf<SessionCommandBaseRevision>()
  })

  it('keeps baseRevision generic so map-scoped command contracts can require map revisions', () => {
    const mapRevision = parseMapRevision(3)
    const mapCommand = {
      schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
      sessionId,
      actor: { role: 'gm', clientId: otherClientId },
      type: 'selectMap',
      opId: parseOpId('op_selectmap001'),
      baseRevision: mapRevision,
      scopes: [{ lane: 'map', mapSlug: 'viridian-gym' }],
      payload: { mapSlug: 'viridian-gym' },
    } as const satisfies SessionCommandEnvelope<
      'selectMap',
      { readonly mapSlug: string },
      { readonly role: 'gm'; readonly clientId: typeof otherClientId },
      MapRevision
    >

    expect(mapCommand.baseRevision).toBe(3)
    expectTypeOf(mapCommand.baseRevision).toEqualTypeOf<MapRevision>()
  })

  it('formats operation ID scope keys by session, client, and opId for idempotent retry tracking', () => {
    const scope = getCommandOperationIdScope({ sessionId, actor: playerActor, opId })
    const duplicateFromSameClient = { sessionId, clientId: playerClientId, opId } satisfies OperationIdScope
    const sameOpFromDifferentClient = { sessionId, clientId: otherClientId, opId } satisfies OperationIdScope

    expect(scope).toEqual(duplicateFromSameClient)
    expect(formatOperationIdScopeKey(scope)).toBe(`${sessionId}:${playerClientId}:${opId}`)
    expect(formatOperationIdScopeKey(duplicateFromSameClient)).toBe(formatOperationIdScopeKey(scope))
    expect(formatOperationIdScopeKey(sameOpFromDifferentClient)).not.toBe(
      formatOperationIdScopeKey(scope),
    )

    expectTypeOf(formatOperationIdScopeKey(scope)).toEqualTypeOf<OperationIdScopeKey>()
  })
})
