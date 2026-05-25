import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseClientId,
  parsePlayerId,
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import { parseMapRevision, parseSessionRevision } from '#shared/sessionRevisions'
import {
  SESSION_STATE_SCHEMA_VERSION,
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import {
  SESSION_SNAPSHOT_FILE_NAME,
  SESSION_SNAPSHOT_SCHEMA_VERSION,
  SESSION_SNAPSHOT_TEMP_FILE_PREFIX,
  cleanupStaleSessionSnapshotTempFiles,
  createPersistedSessionSnapshot,
  readSessionSnapshot,
  recoverSessionStateFromSnapshot,
  serializeSessionSnapshot,
  sessionSnapshotDirectoryPathFor,
  sessionSnapshotFilePathFor,
  validatePersistedSessionSnapshot,
  writeSessionSnapshot,
} from '~~/server/utils/sessionSnapshots'

interface MapDocumentFixture {
  readonly slug: string
  readonly name: string
  readonly tokens: readonly string[]
}

const sessionId = parseSessionId('session_snapshot000001')
const otherSessionId = parseSessionId('session_snapshot000002')
const gmClientId = parseClientId('client_snapshotGM01')
const otherClientId = parseClientId('client_snapshotGM02')
const playerId = parsePlayerId('player_snapshot01')
const displayName = sanitizeSessionDisplayName('Snapshot Player')
const createdAt = '2026-05-25T03:00:00.000Z'
const firstWrittenAt = '2026-05-25T03:01:00.000Z'
const secondWrittenAt = '2026-05-25T03:02:00.000Z'

const viridianMap = createAuthoritativeSessionMapState<MapDocumentFixture>({
  mapSlug: 'viridian-gym',
  revision: parseMapRevision(4),
  document: {
    slug: 'viridian-gym',
    name: 'Viridian Gym',
    tokens: ['token-pikachu'],
  },
})

const pewterMap = createAuthoritativeSessionMapState<MapDocumentFixture>({
  mapSlug: 'pewter-gym',
  revision: parseMapRevision(1),
  document: {
    slug: 'pewter-gym',
    name: 'Pewter Gym',
    tokens: ['token-geodude'],
  },
})

let roots: string[] = []

const tempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-session-snapshots-'))
  roots.push(root)
  return root
}

const createState = (
  overrides: Partial<Parameters<typeof createAuthoritativeSessionState<MapDocumentFixture>>[0]> = {},
): AuthoritativeSessionState<MapDocumentFixture> =>
  createAuthoritativeSessionState<MapDocumentFixture>({
    sessionId,
    createdAt,
    revision: parseSessionRevision(2),
    selectedMapSlug: 'viridian-gym',
    maps: [viridianMap, pewterMap],
    ...overrides,
  })

const readSnapshotJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

const writeRawSnapshotJson = (root: string, value: unknown): string => {
  const directoryPath = sessionSnapshotDirectoryPathFor(sessionId, { rootDir: root })
  const filePath = sessionSnapshotFilePathFor(sessionId, { rootDir: root })
  mkdirSync(directoryPath, { recursive: true })
  writeFileSync(
    filePath,
    typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )
  return filePath
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('session snapshot atomic writer', () => {
  it('creates a persisted snapshot envelope from authoritative session state', () => {
    const state = createState()
    const snapshot = createPersistedSessionSnapshot(state, { writtenAt: firstWrittenAt })
    const json = serializeSessionSnapshot(snapshot)

    expect(snapshot).toEqual({
      schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
      sessionId,
      revision: parseSessionRevision(2),
      writtenAt: firstWrittenAt,
      state,
    })
    expect(JSON.parse(json)).toMatchObject({
      schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
      sessionId,
      revision: 2,
      writtenAt: firstWrittenAt,
      state: {
        schemaVersion: SESSION_STATE_SCHEMA_VERSION,
        sessionId,
        revision: 2,
        selectedMapSlug: 'viridian-gym',
      },
    })
    expect(json.endsWith('\n')).toBe(true)
  })

  it('writes the latest snapshot JSON under a session-scoped local data path', () => {
    const root = tempRoot()
    const state = createState()

    const result = writeSessionSnapshot(state, {
      rootDir: root,
      clock: () => firstWrittenAt,
      tempFileName: () => `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}fixed`,
    })
    const raw = readFileSync(result.filePath, 'utf8')
    const parsed = readSnapshotJson(result.filePath)

    expect(result.directoryPath).toBe(sessionSnapshotDirectoryPathFor(sessionId, { rootDir: root }))
    expect(result.filePath).toBe(join(root, sessionId, SESSION_SNAPSHOT_FILE_NAME))
    expect(result.filePath).toBe(sessionSnapshotFilePathFor(sessionId, { rootDir: root }))
    expect(result.bytesWritten).toBe(Buffer.byteLength(raw, 'utf8'))
    expect(raw.endsWith('\n')).toBe(true)
    expect(parsed).toEqual(result.snapshot)
    expect(parsed).toMatchObject({
      schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
      sessionId,
      revision: 2,
      writtenAt: firstWrittenAt,
      state: {
        schemaVersion: SESSION_STATE_SCHEMA_VERSION,
        selectedMapSlug: 'viridian-gym',
        maps: [
          { mapSlug: 'pewter-gym', revision: 1 },
          { mapSlug: 'viridian-gym', revision: 4 },
        ],
      },
    })
    expect(readdirSync(result.directoryPath)).toEqual([SESSION_SNAPSHOT_FILE_NAME])
  })

  it('publishes by writing a temp file in the snapshot directory before rename', () => {
    const root = tempRoot()
    const firstState = createState({ selectedMapSlug: 'viridian-gym' })
    writeSessionSnapshot(firstState, {
      rootDir: root,
      clock: () => firstWrittenAt,
      tempFileName: () => `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}first`,
    })

    const secondState = createState({
      revision: parseSessionRevision(3),
      selectedMapSlug: 'pewter-gym',
    })
    const expectedTempPath = join(root, sessionId, `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}observed`)
    let observedBeforePublish = false

    writeSessionSnapshot(secondState, {
      rootDir: root,
      clock: () => secondWrittenAt,
      tempFileName: () => `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}observed`,
      onBeforePublish: ({ filePath, tempFilePath, json }) => {
        observedBeforePublish = true
        expect(tempFilePath).toBe(expectedTempPath)
        expect(existsSync(tempFilePath)).toBe(true)
        expect(readFileSync(tempFilePath, 'utf8')).toBe(json)
        expect(readSnapshotJson(filePath)).toMatchObject({
          writtenAt: firstWrittenAt,
          state: { selectedMapSlug: 'viridian-gym' },
        })
      },
    })

    expect(observedBeforePublish).toBe(true)
    expect(existsSync(expectedTempPath)).toBe(false)
    expect(readSnapshotJson(sessionSnapshotFilePathFor(sessionId, { rootDir: root }))).toMatchObject({
      writtenAt: secondWrittenAt,
      revision: 3,
      state: { selectedMapSlug: 'pewter-gym' },
    })
  })

  it('keeps the previous snapshot and removes the temp file when publish fails', () => {
    const root = tempRoot()
    const firstState = createState({ selectedMapSlug: 'viridian-gym' })
    writeSessionSnapshot(firstState, {
      rootDir: root,
      clock: () => firstWrittenAt,
      tempFileName: () => `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}first`,
    })

    const secondState = createState({
      revision: parseSessionRevision(3),
      selectedMapSlug: 'pewter-gym',
    })
    const failingTempPath = join(root, sessionId, `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}failing`)

    expect(() =>
      writeSessionSnapshot(secondState, {
        rootDir: root,
        clock: () => secondWrittenAt,
        tempFileName: () => `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}failing`,
        onBeforePublish: () => {
          throw new Error('simulated publish failure')
        },
      }),
    ).toThrow('simulated publish failure')

    expect(existsSync(failingTempPath)).toBe(false)
    expect(readSnapshotJson(sessionSnapshotFilePathFor(sessionId, { rootDir: root }))).toMatchObject({
      writtenAt: firstWrittenAt,
      revision: 2,
      state: { selectedMapSlug: 'viridian-gym' },
    })
  })

  it('serializes snapshots in memory before creating session directories', () => {
    const root = tempRoot()
    const circularDocument: Record<string, unknown> = { slug: 'circular-map' }
    circularDocument.self = circularDocument
    const circularState = createAuthoritativeSessionState<Record<string, unknown>>({
      sessionId,
      createdAt,
      maps: [
        createAuthoritativeSessionMapState<Record<string, unknown>>({
          mapSlug: 'circular-map',
          document: circularDocument,
        }),
      ],
    })

    expect(() => writeSessionSnapshot(circularState, { rootDir: root })).toThrow(
      /circular structure/i,
    )
    expect(readdirSync(root)).toEqual([])
  })

  it('cleans only stale session snapshot temp files', () => {
    const root = tempRoot()
    const directoryPath = sessionSnapshotDirectoryPathFor(sessionId, { rootDir: root })
    mkdirSync(directoryPath, { recursive: true })
    writeFileSync(join(directoryPath, SESSION_SNAPSHOT_FILE_NAME), '{}\n', 'utf8')
    writeFileSync(join(directoryPath, `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}one`), '{}', 'utf8')
    writeFileSync(join(directoryPath, `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}two`), '{}', 'utf8')
    writeFileSync(join(directoryPath, 'unrelated.tmp'), '{}', 'utf8')

    const removed = cleanupStaleSessionSnapshotTempFiles(sessionId, { rootDir: root })

    expect(removed).toEqual([
      join(directoryPath, `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}one`),
      join(directoryPath, `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}two`),
    ])
    expect(readdirSync(directoryPath).sort()).toEqual([
      SESSION_SNAPSHOT_FILE_NAME,
      'unrelated.tmp',
    ])
    expect(cleanupStaleSessionSnapshotTempFiles(otherSessionId, { rootDir: root })).toEqual([])
  })
})

describe('session snapshot reader and recovery', () => {
  it('loads the latest snapshot and validates the authoritative state shape', () => {
    const root = tempRoot()
    const state = createState({
      connectedClients: [
        {
          clientId: gmClientId,
          actor: { role: 'gm', clientId: gmClientId },
          status: 'connected',
          connectedAt: createdAt,
          lastSeenRevision: parseSessionRevision(2),
        },
      ],
      players: [
        {
          playerId,
          displayName,
          joinedAt: createdAt,
          updatedAt: secondWrittenAt,
        },
      ],
      assignments: [
        {
          playerId,
          displayName,
          controllableResources: [
            {
              kind: 'token',
              tokenId: 'token-pikachu',
              mapSlug: 'viridian-gym',
              sheetKind: 'pokemon',
              sheetSlug: 'pikachu',
            },
          ],
          visibleResources: [
            { kind: 'map', mapSlug: 'viridian-gym' },
            {
              kind: 'token',
              tokenId: 'token-pikachu',
              mapSlug: 'viridian-gym',
              sheetKind: 'pokemon',
              sheetSlug: 'pikachu',
            },
          ],
          updatedAt: secondWrittenAt,
          updatedByClientId: gmClientId,
        },
      ],
    })
    const writeResult = writeSessionSnapshot(state, {
      rootDir: root,
      clock: () => firstWrittenAt,
      tempFileName: () => `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}reader`,
    })

    const result = readSessionSnapshot<MapDocumentFixture>(sessionId, { rootDir: root })

    if (!result.ok) throw new Error(result.message)
    expect(result.filePath).toBe(writeResult.filePath)
    expect(result.bytesRead).toBe(Buffer.byteLength(readFileSync(result.filePath, 'utf8'), 'utf8'))
    expect(result.snapshot).toMatchObject({
      schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
      sessionId,
      revision: parseSessionRevision(2),
      writtenAt: firstWrittenAt,
      state: {
        schemaVersion: SESSION_STATE_SCHEMA_VERSION,
        sessionId,
        revision: parseSessionRevision(2),
        connectedClients: [
          {
            clientId: gmClientId,
            actor: { role: 'gm', clientId: gmClientId },
            status: 'connected',
            lastSeenRevision: parseSessionRevision(2),
          },
        ],
        players: [{ playerId, displayName }],
        assignments: [{ playerId, displayName, updatedByClientId: gmClientId }],
      },
    })
    expect(result.snapshot.state.maps.map((map) => map.mapSlug)).toEqual([
      'pewter-gym',
      'viridian-gym',
    ])
  })

  it('recovers authoritative session state for reconnect and restart paths', () => {
    const root = tempRoot()
    const state = createState({
      revision: parseSessionRevision(5),
      selectedMapSlug: 'pewter-gym',
    })
    writeSessionSnapshot(state, {
      rootDir: root,
      clock: () => secondWrittenAt,
      tempFileName: () => `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}recover`,
    })

    const recovery = recoverSessionStateFromSnapshot<MapDocumentFixture>(sessionId, { rootDir: root })

    if (!recovery.recovered) throw new Error(recovery.message)
    expect(recovery.source).toBe('snapshot')
    expect(recovery.filePath).toBe(sessionSnapshotFilePathFor(sessionId, { rootDir: root }))
    expect(recovery.revision).toBe(parseSessionRevision(5))
    expect(recovery.state).toEqual(state)
    expect(recovery.snapshot.writtenAt).toBe(secondWrittenAt)
    expect(recovery.warnings).toEqual([])
  })

  it('reports missing snapshots without creating session directories', () => {
    const root = tempRoot()

    const result = readSessionSnapshot(sessionId, { rootDir: root })
    const recovery = recoverSessionStateFromSnapshot(sessionId, { rootDir: root })

    if (result.ok) throw new Error('expected missing snapshot read to fail')
    expect(result.reason).toBe('not-found')
    expect(result.filePath).toBe(join(root, sessionId, SESSION_SNAPSHOT_FILE_NAME))
    expect(existsSync(join(root, sessionId))).toBe(false)
    expect(recovery).toMatchObject({
      recovered: false,
      source: 'snapshot',
      reason: 'not-found',
      filePath: join(root, sessionId, SESSION_SNAPSHOT_FILE_NAME),
    })
  })

  it('rejects invalid JSON snapshots without recovering client-owned state', () => {
    const root = tempRoot()
    writeRawSnapshotJson(root, '{"schemaVersion":')

    const result = readSessionSnapshot(sessionId, { rootDir: root })
    const recovery = recoverSessionStateFromSnapshot(sessionId, { rootDir: root })

    if (result.ok) throw new Error('expected invalid JSON read to fail')
    expect(result.reason).toBe('invalid-json')
    expect(result.error).toBeInstanceOf(SyntaxError)
    expect(recovery).toMatchObject({
      recovered: false,
      source: 'snapshot',
      reason: 'invalid-json',
    })
  })

  it('rejects snapshots for a different session before recovery', () => {
    const root = tempRoot()
    const state = createState()
    const snapshot = createPersistedSessionSnapshot(state, { writtenAt: firstWrittenAt })
    writeRawSnapshotJson(root, {
      ...snapshot,
      sessionId: otherSessionId,
    })

    const result = readSessionSnapshot(sessionId, { rootDir: root })

    if (result.ok) throw new Error('expected mismatched snapshot read to fail')
    expect(result.reason).toBe('invalid-shape')
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'snapshot.sessionId',
          code: 'session-id-mismatch',
        }),
        expect.objectContaining({
          path: 'snapshot.state.sessionId',
          code: 'session-id-mismatch',
        }),
      ]),
    )
  })

  it('rejects corrupted authoritative state records before recovery', () => {
    const root = tempRoot()
    const snapshot = createPersistedSessionSnapshot(createState(), { writtenAt: firstWrittenAt })
    writeRawSnapshotJson(root, {
      ...snapshot,
      state: {
        ...snapshot.state,
        connectedClients: [
          {
            clientId: gmClientId,
            actor: { role: 'gm', clientId: otherClientId },
            status: 'connected',
            connectedAt: createdAt,
          },
        ],
      },
    })

    const result = readSessionSnapshot(sessionId, { rootDir: root })
    const recovery = recoverSessionStateFromSnapshot(sessionId, { rootDir: root })

    if (result.ok) throw new Error('expected corrupted state read to fail')
    expect(result.reason).toBe('invalid-shape')
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'snapshot.state.connectedClients[0].actor.clientId',
          code: 'client-id-mismatch',
        }),
      ]),
    )
    expect(recovery).toMatchObject({
      recovered: false,
      source: 'snapshot',
      reason: 'invalid-shape',
    })
  })

  it('validates snapshot invariants without filesystem access', () => {
    const snapshotValue = JSON.parse(
      serializeSessionSnapshot(createPersistedSessionSnapshot(createState(), { writtenAt: firstWrittenAt })),
    ) as Record<string, unknown>
    const valid = validatePersistedSessionSnapshot<MapDocumentFixture>(snapshotValue, {
      expectedSessionId: sessionId,
    })

    expect(valid.valid).toBe(true)
    if (!valid.valid) throw new Error('expected validation success')
    expect(valid.snapshot.state.selectedMapSlug).toBe('viridian-gym')

    const invalid = validatePersistedSessionSnapshot<MapDocumentFixture>({
      ...snapshotValue,
      state: {
        ...(snapshotValue.state as Record<string, unknown>),
        selectedMapSlug: 'missing-map',
      },
    })

    expect(invalid.valid).toBe(false)
    if (invalid.valid) throw new Error('expected validation failure')
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'snapshot.state',
          code: 'invalid-state',
        }),
      ]),
    )
  })
})
