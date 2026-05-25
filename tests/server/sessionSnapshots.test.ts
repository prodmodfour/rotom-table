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
import { parseSessionId } from '#shared/sessionIdentity'
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
  serializeSessionSnapshot,
  sessionSnapshotDirectoryPathFor,
  sessionSnapshotFilePathFor,
  writeSessionSnapshot,
} from '~~/server/utils/sessionSnapshots'

interface MapDocumentFixture {
  readonly slug: string
  readonly name: string
  readonly tokens: readonly string[]
}

const sessionId = parseSessionId('session_snapshot000001')
const otherSessionId = parseSessionId('session_snapshot000002')
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
