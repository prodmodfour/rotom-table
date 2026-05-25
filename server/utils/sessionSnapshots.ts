import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import type { SessionId } from '#shared/sessionIdentity'
import type { SessionRevision } from '#shared/sessionRevisions'
import type { AuthoritativeSessionState } from '#shared/sessionState'
import { joinSafeUnderRoot, PROJECT_ROOT } from './fsPaths'

export const SESSION_SNAPSHOT_SCHEMA_VERSION = 1 as const
export const SESSION_SNAPSHOT_FILE_NAME = 'snapshot.json'
export const SESSION_SNAPSHOT_TEMP_FILE_PREFIX = `${SESSION_SNAPSHOT_FILE_NAME}.tmp-`
export const SESSION_SNAPSHOT_ROOT = resolve(PROJECT_ROOT, 'data/sessions')

export type SessionSnapshotClock = () => string
export type SessionSnapshotTempFileNameFactory = () => string

export interface PersistedSessionSnapshot<TMapDocument = unknown> {
  readonly schemaVersion: typeof SESSION_SNAPSHOT_SCHEMA_VERSION
  readonly sessionId: SessionId
  readonly revision: SessionRevision
  readonly writtenAt: string
  /**
   * Server-owned authoritative state. This is persisted for reconnect/restart
   * recovery and must not be replaced by live-client whole-map autosaves.
   */
  readonly state: AuthoritativeSessionState<TMapDocument>
}

export interface CreatePersistedSessionSnapshotOptions {
  readonly writtenAt?: string
  readonly clock?: SessionSnapshotClock
}

export interface SessionSnapshotPathOptions {
  readonly rootDir?: string
}

export interface SessionSnapshotPublishContext<TMapDocument = unknown> {
  readonly directoryPath: string
  readonly filePath: string
  readonly tempFilePath: string
  readonly json: string
  readonly snapshot: PersistedSessionSnapshot<TMapDocument>
}

export interface WriteSessionSnapshotOptions<TMapDocument = unknown> extends SessionSnapshotPathOptions {
  readonly clock?: SessionSnapshotClock
  /**
   * Test/instrumentation hook for deterministic temp names. Production callers
   * should rely on the default unique name generator.
   */
  readonly tempFileName?: SessionSnapshotTempFileNameFactory
  /**
   * Hook invoked after the temp file is fully written/flushed but before it is
   * renamed over the latest snapshot path.
   */
  readonly onBeforePublish?: (context: SessionSnapshotPublishContext<TMapDocument>) => void
  /**
   * Defaults to true. Tests may disable fsync where a mocked filesystem cannot
   * support it; production snapshot writes should keep it enabled.
   */
  readonly flushToDisk?: boolean
}

export interface WriteSessionSnapshotResult<TMapDocument = unknown> {
  readonly directoryPath: string
  readonly filePath: string
  readonly snapshot: PersistedSessionSnapshot<TMapDocument>
  readonly bytesWritten: number
}

const defaultSessionSnapshotClock: SessionSnapshotClock = () => new Date().toISOString()

const normalizeSnapshotRoot = (rootDir: string = SESSION_SNAPSHOT_ROOT): string => resolve(rootDir)

const defaultTempFileName = (): string =>
  `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}${process.pid}-${Date.now()}-${randomUUID()}`

const closeFileBestEffort = (fd: number | undefined): void => {
  if (fd === undefined) return
  try {
    closeSync(fd)
  } catch {
    // Best-effort cleanup after a failed write path.
  }
}

const unlinkFileBestEffort = (path: string): void => {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // A stale temp file can be removed by cleanupStaleSessionSnapshotTempFiles.
  }
}

const flushDirectoryBestEffort = (directoryPath: string): void => {
  let fd: number | undefined
  try {
    fd = openSync(directoryPath, 'r')
    fsyncSync(fd)
  } catch {
    // Directory fsync is not available on every runtime/filesystem. The file
    // itself has already been flushed before rename; this is an extra guard.
  } finally {
    closeFileBestEffort(fd)
  }
}

export const sessionSnapshotDirectoryPathFor = (
  sessionId: SessionId,
  options: SessionSnapshotPathOptions = {},
): string => joinSafeUnderRoot(normalizeSnapshotRoot(options.rootDir), sessionId)

export const sessionSnapshotFilePathFor = (
  sessionId: SessionId,
  options: SessionSnapshotPathOptions = {},
): string => joinSafeUnderRoot(
  normalizeSnapshotRoot(options.rootDir),
  sessionId,
  SESSION_SNAPSHOT_FILE_NAME,
)

export const isSessionSnapshotTempFileName = (fileName: string): boolean =>
  fileName.startsWith(SESSION_SNAPSHOT_TEMP_FILE_PREFIX)

export const createPersistedSessionSnapshot = <TMapDocument = unknown>(
  state: AuthoritativeSessionState<TMapDocument>,
  options: CreatePersistedSessionSnapshotOptions = {},
): PersistedSessionSnapshot<TMapDocument> => ({
  schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
  sessionId: state.sessionId,
  revision: state.revision,
  writtenAt: options.writtenAt ?? options.clock?.() ?? defaultSessionSnapshotClock(),
  state,
})

export const serializeSessionSnapshot = <TMapDocument = unknown>(
  snapshot: PersistedSessionSnapshot<TMapDocument>,
): string => {
  const json = JSON.stringify(snapshot, null, 2)

  if (json === undefined) {
    throw new Error('Session snapshot could not be serialized to JSON')
  }

  const parsed = JSON.parse(json) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Session snapshot must serialize to a JSON object')
  }

  return `${json}\n`
}

export const cleanupStaleSessionSnapshotTempFiles = (
  sessionId: SessionId,
  options: SessionSnapshotPathOptions = {},
): readonly string[] => {
  const directoryPath = sessionSnapshotDirectoryPathFor(sessionId, options)
  let entries: Dirent[]

  try {
    entries = readdirSync(directoryPath, { withFileTypes: true })
  } catch {
    return []
  }

  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !isSessionSnapshotTempFileName(entry.name)) continue

    const tempFilePath = joinSafeUnderRoot(directoryPath, '', entry.name)
    try {
      unlinkSync(tempFilePath)
      removed.push(tempFilePath)
    } catch {
      // Leave files we cannot remove for later/manual cleanup.
    }
  }

  return removed.sort()
}

export const writeSessionSnapshot = <TMapDocument = unknown>(
  state: AuthoritativeSessionState<TMapDocument>,
  options: WriteSessionSnapshotOptions<TMapDocument> = {},
): WriteSessionSnapshotResult<TMapDocument> => {
  const snapshot = createPersistedSessionSnapshot(state, {
    clock: options.clock,
  })
  const json = serializeSessionSnapshot(snapshot)
  const filePath = sessionSnapshotFilePathFor(snapshot.sessionId, options)
  const directoryPath = dirname(filePath)
  const tempFileName = options.tempFileName ?? defaultTempFileName
  const tempFilePath = joinSafeUnderRoot(directoryPath, '', tempFileName())
  const flushToDisk = options.flushToDisk !== false

  mkdirSync(directoryPath, { recursive: true })

  let fd: number | undefined
  try {
    fd = openSync(tempFilePath, 'wx', 0o600)
    writeFileSync(fd, json, 'utf8')
    if (flushToDisk) fsyncSync(fd)
    closeSync(fd)
    fd = undefined

    options.onBeforePublish?.({
      directoryPath,
      filePath,
      tempFilePath,
      json,
      snapshot,
    })

    renameSync(tempFilePath, filePath)
    if (flushToDisk) flushDirectoryBestEffort(directoryPath)
  } catch (err) {
    closeFileBestEffort(fd)
    unlinkFileBestEffort(tempFilePath)
    throw err
  }

  return {
    directoryPath,
    filePath,
    snapshot,
    bytesWritten: Buffer.byteLength(json, 'utf8'),
  }
}
