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
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
  type ClientId,
  type GmKey,
  type JoinCode,
  type PlayerId,
  type SessionId,
} from '#shared/sessionIdentity'
import type { SessionControllableResourceRef } from '#shared/sessionPermissions'
import { INITIAL_MAP_REVISION, parseSessionRevision } from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import { PROJECT_ROOT } from '~~/server/utils/fsPaths'
import { SESSION_HOST_ENABLE_ENV } from '~~/server/utils/sessionHosting'
import {
  SESSION_SNAPSHOT_FILE_NAME,
  SESSION_SNAPSHOT_ROOT,
  SESSION_SNAPSHOT_TEMP_FILE_PREFIX,
  cleanupStaleSessionSnapshotTempFiles,
  recoverSessionStateFromSnapshot,
  sessionSnapshotDirectoryPathFor,
  sessionSnapshotFilePathFor,
  writeSessionSnapshot,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'
import { joinPlayerSessionUseCase } from '~~/server/useCases/joinPlayerSession'
import { startGmSessionUseCase } from '~~/server/useCases/startGmSession'
import { updatePlayerAssignmentUseCase } from '~~/server/useCases/updatePlayerAssignment'

interface TestMapDocument {
  readonly slug: string
  readonly name: string
  readonly placements: readonly {
    readonly id: string
    readonly sheetKind: 'pokemon' | 'trainer'
    readonly sheetSlug: string
    readonly x: number
    readonly y: number
  }[]
  readonly gmNotes: readonly string[]
}

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: '1' }
const startedAt = '2026-05-26T16:00:00.000Z'
const joinedAt = '2026-05-26T16:05:00.000Z'
const attachedAt = '2026-05-26T16:10:00.000Z'
const assignedAt = '2026-05-26T16:15:00.000Z'

const sessionId = parseSessionId('session_attachpersist01')
const otherSessionId = parseSessionId('session_attachpersist02')
const joinCode = parseJoinCode('PRST23')
const gmKey = parseGmKey('gmkey_attachpersistabcdefghijklmnop')
const gmClientId = parseClientId('client_attachpersistgm')
const playerId = parsePlayerId('player_attachpersist01')
const playerClientId = parseClientId('client_attachpersistp1')
const displayName = parseSessionDisplayName('Leaf')
const mapSlug = 'session-persistence-map' as SessionMapSlug

const persistedMap: TestMapDocument = {
  slug: mapSlug,
  name: 'Session Persistence Map',
  placements: [
    {
      id: 'token-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      x: 4,
      y: 7,
    },
  ],
  gmNotes: ['server-owned note kept in ignored session storage'],
}

const eeveeToken = {
  kind: 'token',
  tokenId: 'token-eevee',
  mapSlug,
  sheetKind: 'pokemon',
  sheetSlug: 'eevee',
} satisfies SessionControllableResourceRef

type SnapshotWriter = (
  state: AuthoritativeSessionState<TestMapDocument>,
  options?: WriteSessionSnapshotOptions<TestMapDocument>,
) => WriteSessionSnapshotResult<TestMapDocument>

let roots: string[] = []

const tempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-session-map-persistence-'))
  roots.push(root)
  return root
}

const constantFactory = <TValue>(value: TValue) => () => value

const toPosix = (value: string): string => value.split(sep).join('/')

const listRelativeFiles = (root: string): readonly string[] => {
  if (!existsSync(root)) return []

  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
      } else if (entry.isFile()) {
        files.push(toPosix(relative(root, path)))
      }
    }
  }

  visit(root)
  return files.sort()
}

const createSnapshotWriter = (
  snapshotRoot: string,
  writes: WriteSessionSnapshotResult<TestMapDocument>[] = [],
): SnapshotWriter => {
  let writeIndex = 0

  return (state, options) => {
    writeIndex += 1
    const result = writeSessionSnapshot(state, {
      ...options,
      rootDir: snapshotRoot,
      tempFileName: () => `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}persistence-${writeIndex}`,
      flushToDisk: false,
    })
    writes.push(result)
    return result
  }
}

const createAttachedState = (): AuthoritativeSessionState<TestMapDocument> => createAuthoritativeSessionState({
  sessionId,
  revision: parseSessionRevision(2),
  selectedMapSlug: mapSlug,
  maps: [
    createAuthoritativeSessionMapState<TestMapDocument>({
      mapSlug,
      revision: INITIAL_MAP_REVISION,
      playerVisibleByDefault: true,
      document: persistedMap,
    }),
  ],
  players: [
    {
      playerId,
      displayName,
      joinedAt,
      updatedAt: joinedAt,
    },
  ],
  assignments: [
    {
      playerId,
      displayName,
      controllableResources: [],
      visibleResources: [{ kind: 'map', mapSlug }],
      updatedAt: attachedAt,
      updatedByClientId: gmClientId,
    },
  ],
  createdAt: startedAt,
  updatedAt: attachedAt,
})

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('session map persistence and recovery', () => {
  it('recovers session map state, selected map state, visibility, and assignments from snapshots', () => {
    const sandboxRoot = tempRoot()
    const snapshotRoot = join(sandboxRoot, 'data', 'sessions')
    const writes: WriteSessionSnapshotResult<TestMapDocument>[] = []
    const writeSnapshot = createSnapshotWriter(snapshotRoot, writes)
    const store = createInMemorySessionStore<AuthoritativeSessionState<TestMapDocument>>()

    startGmSessionUseCase<TestMapDocument>({}, {
      env: enabledEnv,
      store,
      clock: () => startedAt,
      generateSessionId: constantFactory<SessionId>(sessionId),
      generateJoinCode: constantFactory<JoinCode>(joinCode),
      generateGmKey: constantFactory<GmKey>(gmKey),
      generateClientId: constantFactory<ClientId>(gmClientId),
      writeSnapshot,
    })
    const joinResult = joinPlayerSessionUseCase<TestMapDocument>({ joinCode, displayName }, {
      env: enabledEnv,
      store,
      clock: () => joinedAt,
      generatePlayerId: constantFactory<PlayerId>(playerId),
      generateClientId: constantFactory<ClientId>(playerClientId),
      writeSnapshot,
    })
    const sessionMapState = createAuthoritativeSessionState<TestMapDocument>({
      sessionId,
      revision: parseSessionRevision(2),
      selectedMapSlug: mapSlug,
      maps: [
        createAuthoritativeSessionMapState<TestMapDocument>({
          mapSlug,
          revision: INITIAL_MAP_REVISION,
          playerVisibleByDefault: true,
          document: persistedMap,
        }),
      ],
      connectedClients: joinResult.state.connectedClients,
      players: joinResult.state.players,
      assignments: [
        {
          playerId,
          displayName,
          controllableResources: [],
          visibleResources: [{ kind: 'map', mapSlug }],
          updatedAt: attachedAt,
          updatedByClientId: gmClientId,
        },
      ],
      createdAt: joinResult.state.createdAt,
      updatedAt: attachedAt,
    })
    expect(store.setState(sessionId, sessionMapState, {
      revision: sessionMapState.revision,
      updatedAt: attachedAt,
    })?.revision).toBe(sessionMapState.revision)
    writeSnapshot(sessionMapState, { clock: () => attachedAt })
    const assignmentResult = updatePlayerAssignmentUseCase<TestMapDocument>({
      sessionId,
      gmKey,
      gmClientId,
      playerId,
      action: 'assign',
      resources: [eeveeToken],
    }, {
      env: enabledEnv,
      store,
      clock: () => assignedAt,
      writeSnapshot,
    })

    const recovery = recoverSessionStateFromSnapshot<TestMapDocument>(sessionId, { rootDir: snapshotRoot })

    if (!recovery.recovered) throw new Error(recovery.message)
    expect(recovery.revision).toBe(assignmentResult.state.revision)
    expect(recovery.state).toEqual(assignmentResult.state)
    expect(recovery.state.selectedMapSlug).toBe(mapSlug)
    expect(recovery.state.maps).toEqual([
      {
        mapSlug,
        revision: INITIAL_MAP_REVISION,
        playerVisibleByDefault: true,
        document: persistedMap,
      },
    ])
    expect(recovery.state.players).toEqual([
      {
        playerId,
        displayName,
        joinedAt,
        updatedAt: joinedAt,
      },
    ])
    expect(recovery.state.assignments).toEqual([
      {
        playerId,
        displayName,
        controllableResources: [eeveeToken],
        visibleResources: [{ kind: 'map', mapSlug }, eeveeToken],
        updatedAt: assignedAt,
        updatedByClientId: gmClientId,
      },
    ])

    expect(toPosix(relative(PROJECT_ROOT, SESSION_SNAPSHOT_ROOT))).toBe('data/sessions')
    expect(readFileSync(join(PROJECT_ROOT, '.gitignore'), 'utf8')).toMatch(/^data\/sessions\/$/m)
    expect(writes).toHaveLength(4)
    for (const write of writes) {
      expect(write.directoryPath).toBe(sessionSnapshotDirectoryPathFor(sessionId, { rootDir: snapshotRoot }))
      expect(write.filePath).toBe(sessionSnapshotFilePathFor(sessionId, { rootDir: snapshotRoot }))
    }
    expect(listRelativeFiles(sandboxRoot)).toEqual([
      `data/sessions/${sessionId}/${SESSION_SNAPSHOT_FILE_NAME}`,
    ])
    expect(existsSync(join(sandboxRoot, 'data', 'maps'))).toBe(false)
    expect(existsSync(join(sandboxRoot, 'data', 'sheets'))).toBe(false)
    expect(existsSync(join(sandboxRoot, sessionId))).toBe(false)

    const rawSnapshot = readFileSync(sessionSnapshotFilePathFor(sessionId, { rootDir: snapshotRoot }), 'utf8')
    expect(rawSnapshot).not.toContain(gmKey)
    expect(rawSnapshot).not.toContain(joinCode)
    expect(rawSnapshot).not.toContain('/persisted/maps/')
  })

  it('cleans stale temp files from attached-map snapshot directories without touching recovery data', () => {
    const snapshotRoot = join(tempRoot(), 'data', 'sessions')
    const state = createAttachedState()
    writeSessionSnapshot(state, {
      rootDir: snapshotRoot,
      clock: () => attachedAt,
      tempFileName: () => `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}initial`,
      flushToDisk: false,
    })
    const directoryPath = sessionSnapshotDirectoryPathFor(sessionId, { rootDir: snapshotRoot })
    const otherDirectoryPath = sessionSnapshotDirectoryPathFor(otherSessionId, { rootDir: snapshotRoot })
    mkdirSync(otherDirectoryPath, { recursive: true })

    const staleOne = join(directoryPath, `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}attach-one`)
    const staleTwo = join(directoryPath, `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}attach-two`)
    const unrelatedFile = join(directoryPath, 'notes.tmp')
    const otherSessionTemp = join(otherDirectoryPath, `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}other-session`)
    writeFileSync(staleOne, '{}', 'utf8')
    writeFileSync(staleTwo, '{}', 'utf8')
    writeFileSync(unrelatedFile, '{}', 'utf8')
    writeFileSync(otherSessionTemp, '{}', 'utf8')

    const removed = cleanupStaleSessionSnapshotTempFiles(sessionId, { rootDir: snapshotRoot })
    const recovery = recoverSessionStateFromSnapshot<TestMapDocument>(sessionId, { rootDir: snapshotRoot })

    expect(removed).toEqual([staleOne, staleTwo])
    expect(readdirSync(directoryPath).sort()).toEqual(['notes.tmp', SESSION_SNAPSHOT_FILE_NAME])
    expect(existsSync(otherSessionTemp)).toBe(true)
    if (!recovery.recovered) throw new Error(recovery.message)
    expect(recovery.state).toEqual(state)
    expect(recovery.state.selectedMapSlug).toBe(mapSlug)
    expect(recovery.state.assignments[0]?.visibleResources).toEqual([{ kind: 'map', mapSlug }])
  })
})
