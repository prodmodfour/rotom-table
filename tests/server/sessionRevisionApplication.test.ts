import { describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
} from '#shared/sessionCommandResults'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
  type SessionCommandEnvelope,
} from '#shared/sessionCommands'
import {
  parseClientId,
  parsePlayerId,
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import type { SessionActor } from '#shared/sessionPermissions'
import {
  parseMapRevision,
  parseSessionRevision,
  type SessionRevision,
} from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  upsertSessionPlayerRecord,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import { SESSION_EVENT_LOG_SCHEMA_VERSION } from '~~/server/utils/sessionEventLog'
import {
  applyAcceptedSessionCommandEffect,
  type AcceptedSessionCommandPatchEvent,
} from '~~/server/utils/sessionRevisionApplication'

interface TokenPositionFixture {
  readonly x: number
  readonly y: number
  readonly z: number
}

interface TokenFixture {
  readonly id: string
  readonly position: TokenPositionFixture
}

interface MapDocumentFixture {
  readonly slug: string
  readonly name: string
  readonly tokens: readonly TokenFixture[]
}

interface MoveTokenPayloadFixture {
  readonly tokenId: string
  readonly mapSlug: string
  readonly to: TokenPositionFixture
}

interface TokenMovedPatchPayloadFixture {
  readonly tokenId: string
  readonly mapSlug: string
  readonly from: TokenPositionFixture
  readonly to: TokenPositionFixture
}

const sessionId = parseSessionId('session_revision0001')
const otherSessionId = parseSessionId('session_revision0002')
const gmClientId = parseClientId('client_revisionGM01')
const playerClientId = parseClientId('client_revisionPL01')
const playerId = parsePlayerId('player_revision01')
const displayName = sanitizeSessionDisplayName('Revision Player')
const opId = parseOpId('op_revisionapply01')
const processedAt = '2026-05-25T05:00:00.000Z'
const recordedAt = '2026-05-25T05:00:00.050Z'
const createdAt = '2026-05-25T04:50:00.000Z'

const gmActor: SessionActor = {
  role: 'gm',
  clientId: gmClientId,
}

const createViridianDocument = (position: TokenPositionFixture): MapDocumentFixture => ({
  slug: 'viridian-gym',
  name: 'Viridian Gym',
  tokens: [{ id: 'token_pikachu', position }],
})

const pewterDocument: MapDocumentFixture = {
  slug: 'pewter-gym',
  name: 'Pewter Gym',
  tokens: [{ id: 'token_geodude', position: { x: 1, y: 1, z: 0 } }],
}

const viridianMap = createAuthoritativeSessionMapState<MapDocumentFixture>({
  mapSlug: 'viridian-gym',
  revision: parseMapRevision(4),
  document: createViridianDocument({ x: 4, y: 8, z: 0 }),
})

const pewterMap = createAuthoritativeSessionMapState<MapDocumentFixture>({
  mapSlug: 'pewter-gym',
  revision: parseMapRevision(1),
  document: pewterDocument,
})

const createState = (
  overrides: Partial<Parameters<typeof createAuthoritativeSessionState<MapDocumentFixture>>[0]> = {},
): AuthoritativeSessionState<MapDocumentFixture> =>
  createAuthoritativeSessionState<MapDocumentFixture>({
    sessionId,
    createdAt,
    updatedAt: createdAt,
    revision: parseSessionRevision(2),
    selectedMapSlug: 'viridian-gym',
    maps: [viridianMap, pewterMap],
    ...overrides,
  })

const createMoveTokenCommand = (
  overrides: Partial<SessionCommandEnvelope<'moveToken', MoveTokenPayloadFixture, SessionActor, SessionRevision>> = {},
): SessionCommandEnvelope<'moveToken', MoveTokenPayloadFixture, SessionActor, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: 'moveToken',
  opId,
  baseRevision: parseSessionRevision(2),
  scopes: [
    {
      lane: 'token',
      mapSlug: 'viridian-gym',
      resource: {
        kind: 'token',
        tokenId: 'token_pikachu',
        mapSlug: 'viridian-gym',
      },
    },
  ],
  payload: {
    tokenId: 'token_pikachu',
    mapSlug: 'viridian-gym',
    to: { x: 5, y: 8, z: 0 },
  },
  metadata: {
    clientIssuedAt: '2026-05-25T04:59:59.000Z',
    clientSequence: 3,
    traceId: 'trace-revision-application',
  },
  ...overrides,
})

const tokenMovedPayload: TokenMovedPatchPayloadFixture = {
  tokenId: 'token_pikachu',
  mapSlug: 'viridian-gym',
  from: { x: 4, y: 8, z: 0 },
  to: { x: 5, y: 8, z: 0 },
}

describe('applyAcceptedSessionCommandEffect', () => {
  it('increments session and touched map revisions and records accepted-command metadata', () => {
    const state = createState()
    const command = createMoveTokenCommand()
    const nextViridianDocument = createViridianDocument(tokenMovedPayload.to)

    const applied = applyAcceptedSessionCommandEffect({
      state,
      command,
      eventType: 'tokenMoved',
      eventPayload: tokenMovedPayload,
      mapEffects: [
        {
          mapSlug: 'viridian-gym',
          document: nextViridianDocument,
        },
      ],
    }, { processedAt })

    expect(applied.previousState).toBe(state)
    expect(applied.previousRevision).toBe(2)
    expect(applied.currentRevision).toBe(3)
    expect(applied.state.revision).toBe(3)
    expect(applied.state.updatedAt).toBe(processedAt)
    expect(state.revision).toBe(2)
    expect(state.updatedAt).toBe(createdAt)
    expect(state.maps.find((map) => map.mapSlug === 'viridian-gym')?.revision).toBe(4)
    expect(state.maps.find((map) => map.mapSlug === 'viridian-gym')?.document.tokens[0]?.position).toEqual({
      x: 4,
      y: 8,
      z: 0,
    })

    const viridian = applied.state.maps.find((map) => map.mapSlug === 'viridian-gym')
    const pewter = applied.state.maps.find((map) => map.mapSlug === 'pewter-gym')
    expect(viridian).toMatchObject({ mapSlug: 'viridian-gym', revision: 5 })
    expect(viridian?.document.tokens[0]?.position).toEqual(tokenMovedPayload.to)
    expect(pewter).toMatchObject({ mapSlug: 'pewter-gym', revision: 1, document: pewterDocument })
    expect(applied.mapRevisionChanges).toEqual([
      {
        mapSlug: 'viridian-gym',
        previousRevision: parseMapRevision(4),
        currentRevision: parseMapRevision(5),
        document: nextViridianDocument,
      },
    ])

    expect(applied.patchEvent).toEqual({
      eventId: 'event_rev_3',
      eventType: 'tokenMoved',
      revision: parseSessionRevision(3),
      commandType: 'moveToken',
      opId,
      actor: gmActor,
      scopes: command.scopes,
      payload: tokenMovedPayload,
    } satisfies AcceptedSessionCommandPatchEvent<'tokenMoved', TokenMovedPatchPayloadFixture>)
    expect(applied.result).toEqual({
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'accepted',
      accepted: true,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: gmActor,
      currentRevision: parseSessionRevision(3),
      scopes: command.scopes,
      event: applied.patchEvent,
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-revision-application',
      },
    })
    expect(applied.eventLogEntry).toMatchObject({
      schemaVersion: SESSION_EVENT_LOG_SCHEMA_VERSION,
      kind: 'command',
      sessionId,
      revision: 3,
      recordedAt: processedAt,
      command: { type: 'moveToken', opId },
      result: { status: 'accepted', currentRevision: 3, event: applied.patchEvent },
    })
  })

  it('supports non-map state effects, deterministic event IDs, and explicit metadata', () => {
    const state = createState({ maps: [viridianMap] })
    const command = createMoveTokenCommand({
      scopes: [{ lane: 'session', field: 'players' }],
      metadata: { traceId: 'trace-overridden' },
    })

    const applied = applyAcceptedSessionCommandEffect({
      state,
      command,
      eventType: 'playerJoined',
      eventPayload: { playerId, displayName },
      stateEffect: (nextState, context) => {
        expect(nextState.revision).toBe(3)
        expect(nextState.updatedAt).toBe(processedAt)
        expect(context).toMatchObject({
          previousRevision: 2,
          currentRevision: 3,
          processedAt,
          mapRevisionChanges: [],
        })

        return upsertSessionPlayerRecord(nextState, {
          playerId,
          displayName,
          joinedAt: processedAt,
          updatedAt: processedAt,
        }, {
          revision: context.currentRevision,
          updatedAt: context.processedAt,
        })
      },
    }, {
      processedAt,
      recordedAt,
      eventIdFactory: ({ revision, commandType }) => `event_${commandType}_${revision}`,
      resultMetadata: {
        serverProcessedAt: '2026-05-25T05:00:00.010Z',
        traceId: 'trace-server-override',
        attributes: { persisted: false },
      },
      eventLogMetadata: {
        source: 'unit-test',
        attributes: { durable: false },
      },
    })

    expect(applied.state.players).toEqual([
      {
        playerId,
        displayName,
        joinedAt: processedAt,
        updatedAt: processedAt,
      },
    ])
    expect(applied.patchEvent).toMatchObject({
      eventId: 'event_moveToken_3',
      eventType: 'playerJoined',
      revision: 3,
      payload: { playerId, displayName },
    })
    expect(applied.result.metadata).toEqual({
      serverProcessedAt: '2026-05-25T05:00:00.010Z',
      traceId: 'trace-server-override',
      attributes: { persisted: false },
    })
    expect(applied.eventLogEntry.recordedAt).toBe(recordedAt)
    expect(applied.eventLogEntry.metadata).toEqual({
      source: 'unit-test',
      attributes: { durable: false },
    })
  })

  it('rejects invalid accepted-effect inputs before returning authoritative metadata', () => {
    const state = createState()
    const command = createMoveTokenCommand()
    const otherSessionCommand = createMoveTokenCommand({ sessionId: otherSessionId })

    expect(() =>
      applyAcceptedSessionCommandEffect({
        state,
        command: otherSessionCommand,
        eventType: 'tokenMoved',
        eventPayload: tokenMovedPayload,
      }, { processedAt }),
    ).toThrow('Accepted command sessionId must match authoritative session state')

    expect(() =>
      applyAcceptedSessionCommandEffect({
        state,
        command,
        eventType: 'tokenMoved',
        eventPayload: tokenMovedPayload,
        mapEffects: [
          { mapSlug: 'viridian-gym', document: createViridianDocument(tokenMovedPayload.to) },
          { mapSlug: 'viridian-gym', document: createViridianDocument(tokenMovedPayload.to) },
        ],
      }, { processedAt }),
    ).toThrow('Map effect for "viridian-gym" was provided more than once')

    expect(() =>
      applyAcceptedSessionCommandEffect({
        state,
        command,
        eventType: 'tokenMoved',
        eventPayload: tokenMovedPayload,
        mapEffects: [
          { mapSlug: 'unknown-map', document: createViridianDocument(tokenMovedPayload.to) },
        ],
      }, { processedAt }),
    ).toThrow('Cannot apply map effect for unknown session map "unknown-map"')

    expect(() =>
      applyAcceptedSessionCommandEffect({
        state,
        command,
        eventType: 'tokenMoved',
        eventPayload: tokenMovedPayload,
        stateEffect: (nextState) => ({
          ...nextState,
          revision: parseSessionRevision(99),
        }),
      }, { processedAt }),
    ).toThrow('Accepted command stateEffect must preserve the helper-assigned session revision')
  })

  it('requires explicit null instead of undefined for empty patch payloads', () => {
    expect(() =>
      applyAcceptedSessionCommandEffect({
        state: createState(),
        command: createMoveTokenCommand(),
        eventType: 'tokenMoved',
        eventPayload: undefined,
      }, { processedAt }),
    ).toThrow('eventPayload must be provided; use null for events without payload data')
  })
})
