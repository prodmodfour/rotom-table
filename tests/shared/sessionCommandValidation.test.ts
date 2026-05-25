import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
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
import type { GmSessionActor, PlayerSessionActor, SessionTokenResourceRef } from '#shared/sessionPermissions'
import { parseRevision } from '#shared/sessionRevisions'
import {
  SESSION_COMMAND_REQUIRED_FIELDS,
  SESSION_COMMAND_VALIDATION_CODES,
  assertValidSessionCommandEnvelope,
  collectSessionCommandEnvelopeIssues,
  isRecord,
  isSessionCommandValidationCode,
  isValidSessionCommandEnvelope,
  validateSessionCommandEnvelope,
  type SessionCommandRequiredField,
  type SessionCommandValidationCode,
  type SessionCommandValidationResult,
} from '#shared/sessionCommandValidation'

const sessionId = parseSessionId('session_validate0001')
const playerId = parsePlayerId('player_validate1')
const gmClientId = parseClientId('client_validgm1')
const playerClientId = parseClientId('client_validpl1')
const displayName = sanitizeSessionDisplayName('Validation Player')
const opId = parseOpId('op_validate0001')

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

interface MoveTokenPayload {
  readonly tokenId: string
  readonly to: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
}

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
  baseRevision: parseRevision(7),
  scopes: [tokenScope],
  payload: {
    tokenId: 'token-001',
    to: { x: 4, y: 5, z: 0 },
  },
  metadata: {
    clientIssuedAt: '2026-05-25T00:00:00.000Z',
    clientSequence: 1,
    traceId: 'validation-test-001',
    attributes: {
      optimisticPreview: true,
      retryCount: 0,
      inputDevice: 'pointer',
      note: null,
    },
  },
})

describe('session command validation utilities', () => {
  it('defines common required fields and validation issue codes', () => {
    expect(SESSION_COMMAND_REQUIRED_FIELDS).toEqual([
      'schemaVersion',
      'sessionId',
      'actor',
      'type',
      'opId',
      'baseRevision',
      'scopes',
      'payload',
    ])
    expect(SESSION_COMMAND_VALIDATION_CODES).toContain('missing-field')
    expect(SESSION_COMMAND_VALIDATION_CODES).toContain('invalid-base-revision')
    expect(isSessionCommandValidationCode('invalid-op-id')).toBe(true)
    expect(isSessionCommandValidationCode('permission-denied')).toBe(false)
    expect(isRecord({ ok: true })).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)

    expectTypeOf<(typeof SESSION_COMMAND_REQUIRED_FIELDS)[number]>().toEqualTypeOf<SessionCommandRequiredField>()
    expectTypeOf<(typeof SESSION_COMMAND_VALIDATION_CODES)[number]>().toEqualTypeOf<SessionCommandValidationCode>()
  })

  it('accepts valid player and GM command envelopes without inspecting command-specific payloads', () => {
    const playerCommand = buildMoveTokenCommand()
    const playerResult = validateSessionCommandEnvelope<typeof playerCommand>(playerCommand)

    expect(playerResult.valid).toBe(true)
    expect(collectSessionCommandEnvelopeIssues(playerCommand)).toEqual([])
    expect(isValidSessionCommandEnvelope(playerCommand)).toBe(true)
    expect(assertValidSessionCommandEnvelope(playerCommand)).toBe(playerCommand)

    if (playerResult.valid) {
      expect(playerResult.command.payload.to).toEqual({ x: 4, y: 5, z: 0 })
      expectTypeOf(playerResult.command).toEqualTypeOf<typeof playerCommand>()
      expectTypeOf(playerResult).toMatchTypeOf<SessionCommandValidationResult<typeof playerCommand>>()
    }

    const unknownCommand: unknown = playerCommand
    if (isValidSessionCommandEnvelope(unknownCommand)) {
      expect(unknownCommand.opId).toBe(opId)
      expectTypeOf(unknownCommand).toMatchTypeOf<SessionCommandEnvelope>()
    }

    const gmCommand = {
      ...playerCommand,
      actor: gmActor,
      type: 'selectMap',
      scopes: [{ lane: 'map', mapSlug: 'viridian-gym' }],
      payload: { mapSlug: 'viridian-gym', arbitraryFutureField: { accepted: true } },
    } as const satisfies SessionCommandEnvelope<
      'selectMap',
      { readonly mapSlug: string; readonly arbitraryFutureField: { readonly accepted: boolean } },
      GmSessionActor
    >

    expect(validateSessionCommandEnvelope(gmCommand).valid).toBe(true)
  })

  it('reports non-object and missing common required field issues', () => {
    expect(collectSessionCommandEnvelopeIssues(null)).toMatchObject([
      {
        path: '$',
        code: 'not-object',
      },
    ])

    const missingEnvelope = { schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION }
    const issues = collectSessionCommandEnvelopeIssues(missingEnvelope)
    const issuePaths = issues.map((issue) => issue.path)

    expect(validateSessionCommandEnvelope(missingEnvelope).valid).toBe(false)
    expect(issuePaths).toEqual([
      'sessionId',
      'actor',
      'type',
      'opId',
      'baseRevision',
      'scopes',
      'payload',
    ])
    expect(issues.every((issue) => issue.code === 'missing-field')).toBe(true)
    expect(() => assertValidSessionCommandEnvelope(missingEnvelope, 'test command')).toThrow(
      'test command is invalid',
    )
  })

  it('validates session IDs, actor IDs, operation IDs, command type, and baseRevision', () => {
    const invalidEnvelope = {
      ...buildMoveTokenCommand(),
      schemaVersion: 2,
      sessionId: 'session_short',
      actor: {
        role: 'player',
        playerId: 'bad-player',
        clientId: 'bad-client',
        displayName: '<unsafe>',
      },
      type: 'Move Token',
      opId: 'not-an-op-id',
      baseRevision: -1,
    }

    const issues = collectSessionCommandEnvelopeIssues(invalidEnvelope)
    const issueByPath = new Map(issues.map((issue) => [issue.path, issue]))

    expect(issueByPath.get('schemaVersion')?.code).toBe('invalid-schema-version')
    expect(issueByPath.get('sessionId')?.code).toBe('invalid-session-id')
    expect(issueByPath.get('actor.clientId')?.code).toBe('invalid-client-id')
    expect(issueByPath.get('actor.playerId')?.code).toBe('invalid-player-id')
    expect(issueByPath.get('actor.displayName')?.code).toBe('invalid-display-name')
    expect(issueByPath.get('type')?.code).toBe('invalid-command-type')
    expect(issueByPath.get('opId')?.code).toBe('invalid-op-id')
    expect(issueByPath.get('baseRevision')?.code).toBe('invalid-base-revision')
  })

  it('validates common scope, resource reference, and metadata shapes', () => {
    const invalidEnvelope = {
      ...buildMoveTokenCommand(),
      scopes: [
        {
          lane: 'whole-document',
          resource: {
            kind: 'token',
            tokenId: '',
            mapSlug: '',
            sheetKind: 'npc',
            sheetSlug: '',
          },
          field: '',
          mapSlug: '',
          playerId: 'player invalid',
        },
      ],
      metadata: {
        clientIssuedAt: 123,
        clientSequence: 1.5,
        traceId: false,
        attributes: {
          nested: { unsafe: true },
          list: ['not', 'scalar'],
        },
      },
    }

    const issues = collectSessionCommandEnvelopeIssues(invalidEnvelope)
    const issueByPath = new Map(issues.map((issue) => [issue.path, issue]))

    expect(issueByPath.get('scopes[0].lane')?.code).toBe('invalid-scope-lane')
    expect(issueByPath.get('scopes[0].resource.tokenId')?.code).toBe('invalid-resource-ref')
    expect(issueByPath.get('scopes[0].resource.mapSlug')?.code).toBe('invalid-resource-ref')
    expect(issueByPath.get('scopes[0].resource.sheetKind')?.code).toBe('invalid-resource-ref')
    expect(issueByPath.get('scopes[0].resource.sheetSlug')?.code).toBe('invalid-resource-ref')
    expect(issueByPath.get('scopes[0].field')?.code).toBe('invalid-scopes')
    expect(issueByPath.get('scopes[0].mapSlug')?.code).toBe('invalid-scopes')
    expect(issueByPath.get('scopes[0].playerId')?.code).toBe('invalid-player-id')
    expect(issueByPath.get('metadata.clientIssuedAt')?.code).toBe('invalid-metadata')
    expect(issueByPath.get('metadata.clientSequence')?.code).toBe('invalid-metadata')
    expect(issueByPath.get('metadata.traceId')?.code).toBe('invalid-metadata')
    expect(issueByPath.get('metadata.attributes.nested')?.code).toBe('invalid-metadata')
    expect(issueByPath.get('metadata.attributes.list')?.received).toBe('array')
  })

  it('requires a present payload field but leaves payload-specific validation to command modules', () => {
    const commandWithLoosePayload = {
      ...buildMoveTokenCommand(),
      payload: {
        tokenId: '',
        to: { x: 'future-validator-checks-this', y: 5, z: 0 },
      },
    }

    const missingPayload = { ...buildMoveTokenCommand() } as Record<string, unknown>
    delete missingPayload.payload

    const undefinedPayload = {
      ...buildMoveTokenCommand(),
      payload: undefined,
    }

    expect(validateSessionCommandEnvelope(commandWithLoosePayload).valid).toBe(true)
    expect(collectSessionCommandEnvelopeIssues(missingPayload)).toMatchObject([
      {
        path: 'payload',
        code: 'missing-field',
      },
    ])
    expect(collectSessionCommandEnvelopeIssues(undefinedPayload)).toMatchObject([
      {
        path: 'payload',
        code: 'invalid-payload',
      },
    ])
  })
})
