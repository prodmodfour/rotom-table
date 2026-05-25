import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  type SessionCommandAcceptedResult,
} from '#shared/sessionCommandResults'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
  type SessionCommandEnvelope,
} from '#shared/sessionCommands'
import { parseClientId, parseSessionId } from '#shared/sessionIdentity'
import type { SessionActor } from '#shared/sessionPermissions'
import { parseSessionRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  SESSION_EVENT_LOG_FILE_NAME,
  SESSION_EVENT_LOG_SCHEMA_VERSION,
  appendSessionEventLogEntry,
  createSessionCommandEventLogEntry,
  createSessionEventLogEntry,
  serializeSessionEventLogEntry,
  sessionEventLogDirectoryPathFor,
  sessionEventLogFilePathFor,
  validateSessionEventLogEntry,
  type SessionEventLogEntry,
} from '~~/server/utils/sessionEventLog'

interface MoveTokenPayloadFixture {
  readonly tokenId: string
  readonly mapSlug: string
  readonly to: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
}

interface TokenMovedEventFixture {
  readonly type: 'tokenMoved'
  readonly tokenId: string
  readonly mapSlug: string
  readonly to: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
}

const sessionId = parseSessionId('session_eventlog0001')
const otherSessionId = parseSessionId('session_eventlog0002')
const gmClientId = parseClientId('client_eventlogGM01')
const opId = parseOpId('op_eventlogmove0001')
const otherOpId = parseOpId('op_eventlogmove0002')
const recordedAt = '2026-05-25T04:00:00.000Z'
const secondRecordedAt = '2026-05-25T04:01:00.000Z'

const gmActor: SessionActor = {
  role: 'gm',
  clientId: gmClientId,
}

let roots: string[] = []

const tempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-session-event-log-'))
  roots.push(root)
  return root
}

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
    clientIssuedAt: '2026-05-25T03:59:59.000Z',
    clientSequence: 7,
    traceId: 'trace-event-log-move',
  },
  ...overrides,
})

const createAcceptedMoveTokenResult = (
  command = createMoveTokenCommand(),
  overrides: Partial<SessionCommandAcceptedResult<'moveToken', TokenMovedEventFixture, SessionRevision>> = {},
): SessionCommandAcceptedResult<'moveToken', TokenMovedEventFixture, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'accepted',
  accepted: true,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: command.type,
  actor: command.actor,
  currentRevision: parseSessionRevision(3),
  scopes: command.scopes,
  event: {
    type: 'tokenMoved',
    tokenId: command.payload.tokenId,
    mapSlug: command.payload.mapSlug,
    to: command.payload.to,
  },
  metadata: {
    serverProcessedAt: recordedAt,
    traceId: 'trace-event-log-move',
  },
  ...overrides,
})

const parseJsonLines = (raw: string): Record<string, unknown>[] =>
  raw
    .trimEnd()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('session event log entries', () => {
  it('creates a JSON-lines command entry for an authoritative command result', () => {
    const command = createMoveTokenCommand()
    const result = createAcceptedMoveTokenResult(command)

    const entry = createSessionCommandEventLogEntry(command, result, {
      recordedAt,
      metadata: {
        source: 'unit-test',
        traceId: 'trace-event-log-move',
        attributes: { durable: true, attempt: 1 },
      },
    })
    const line = serializeSessionEventLogEntry(entry)
    const parsed = JSON.parse(line) as Record<string, unknown>
    const validation = validateSessionEventLogEntry(parsed, { expectedSessionId: sessionId })

    expect(entry).toMatchObject({
      schemaVersion: SESSION_EVENT_LOG_SCHEMA_VERSION,
      kind: 'command',
      sessionId,
      revision: 3,
      recordedAt,
      command: { type: 'moveToken', opId },
      result: { status: 'accepted', currentRevision: 3 },
    })
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
    expect(parsed).toMatchObject({
      schemaVersion: SESSION_EVENT_LOG_SCHEMA_VERSION,
      kind: 'command',
      sessionId,
      revision: 3,
      recordedAt,
      result: {
        schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
        status: 'accepted',
      },
    })
    expect(validation.valid).toBe(true)
  })

  it('validates expected session scoping for parsed log entries', () => {
    const entry = createSessionCommandEventLogEntry(
      createMoveTokenCommand(),
      createAcceptedMoveTokenResult(),
      { recordedAt },
    )
    const parsed = JSON.parse(serializeSessionEventLogEntry(entry)) as Record<string, unknown>

    const validation = validateSessionEventLogEntry(parsed, { expectedSessionId: otherSessionId })

    expect(validation.valid).toBe(false)
    if (!validation.valid) {
      expect(validation.issues).toContainEqual(expect.objectContaining({
        path: 'entry.sessionId',
        code: 'session-id-mismatch',
      }))
    }
  })

  it('rejects command entries whose result no longer matches the command operation', () => {
    const command = createMoveTokenCommand()
    const mismatchedResult = createAcceptedMoveTokenResult(command, { opId: otherOpId })

    expect(() =>
      createSessionCommandEventLogEntry(command, mismatchedResult, { recordedAt }),
    ).toThrow(/result\.opId.*command\.opId/)
  })
})

describe('appendSessionEventLogEntry', () => {
  it('appends a complete command entry under a session-scoped local data path', () => {
    const root = tempRoot()
    const entry = createSessionCommandEventLogEntry(
      createMoveTokenCommand(),
      createAcceptedMoveTokenResult(),
      { recordedAt },
    )

    const result = appendSessionEventLogEntry(entry, { rootDir: root, flushToDisk: false })
    const raw = readFileSync(result.filePath, 'utf8')
    const lines = parseJsonLines(raw)

    expect(result.directoryPath).toBe(sessionEventLogDirectoryPathFor(sessionId, { rootDir: root }))
    expect(result.filePath).toBe(join(root, sessionId, SESSION_EVENT_LOG_FILE_NAME))
    expect(result.filePath).toBe(sessionEventLogFilePathFor(sessionId, { rootDir: root }))
    expect(result.bytesWritten).toBe(Buffer.byteLength(raw, 'utf8'))
    expect(raw.endsWith('\n')).toBe(true)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      kind: 'command',
      sessionId,
      revision: 3,
      result: { status: 'accepted', currentRevision: 3 },
    })
  })

  it('preserves existing entries and writes one JSON object per line', () => {
    const root = tempRoot()
    const commandEntry = createSessionCommandEventLogEntry(
      createMoveTokenCommand(),
      createAcceptedMoveTokenResult(),
      { recordedAt },
    )
    const presenceEntry = createSessionEventLogEntry(
      {
        sessionId,
        revision: parseSessionRevision(4),
        eventType: 'presence.snapshot',
        event: {
          connectedClients: 1,
          note: 'line one\nline two',
        },
        scopes: [{ lane: 'session' }],
      },
      { recordedAt: secondRecordedAt, metadata: { source: 'unit-test' } },
    )

    appendSessionEventLogEntry(commandEntry, { rootDir: root, flushToDisk: false })
    appendSessionEventLogEntry(presenceEntry, { rootDir: root, flushToDisk: false })

    const raw = readFileSync(sessionEventLogFilePathFor(sessionId, { rootDir: root }), 'utf8')
    const lines = parseJsonLines(raw)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ kind: 'command', revision: 3 })
    expect(lines[1]).toMatchObject({
      kind: 'event',
      eventType: 'presence.snapshot',
      revision: 4,
      event: { connectedClients: 1, note: 'line one\nline two' },
    })
  })

  it('serializes before creating session directories so invalid entries leave no local log', () => {
    const root = tempRoot()
    const circularEvent: Record<string, unknown> = { type: 'circular' }
    circularEvent.self = circularEvent
    const entry = createSessionEventLogEntry(
      {
        sessionId,
        revision: parseSessionRevision(4),
        eventType: 'debug.circular',
        event: circularEvent,
      },
      { recordedAt },
    )

    expect(() => appendSessionEventLogEntry(entry, { rootDir: root, flushToDisk: false })).toThrow(
      /circular/i,
    )
    expect(existsSync(sessionEventLogDirectoryPathFor(sessionId, { rootDir: root }))).toBe(false)
  })

  it('rejects malformed entries before appending to the optional log', () => {
    const root = tempRoot()
    const entry = createSessionCommandEventLogEntry(
      createMoveTokenCommand(),
      createAcceptedMoveTokenResult(),
      { recordedAt },
    )
    const malformedEntry = {
      ...entry,
      result: {
        ...entry.result,
        currentRevision: parseSessionRevision(99),
      },
    } as SessionEventLogEntry

    const validation = validateSessionEventLogEntry(malformedEntry)

    expect(validation.valid).toBe(false)
    expect(() =>
      appendSessionEventLogEntry(malformedEntry, { rootDir: root, flushToDisk: false }),
    ).toThrow(/currentRevision.*revision/)
    expect(existsSync(sessionEventLogDirectoryPathFor(sessionId, { rootDir: root }))).toBe(false)
  })
})
