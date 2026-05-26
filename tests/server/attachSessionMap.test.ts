import { describe, expect, it, vi } from 'vitest'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import {
  INITIAL_MAP_REVISION,
  incrementSessionRevision,
  parseMapRevision,
  parseSessionRevision,
} from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import { SESSION_HOST_ENABLE_ENV } from '~~/server/utils/sessionHosting'
import {
  SESSION_SNAPSHOT_SCHEMA_VERSION,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import {
  createInMemorySessionStore,
  type InMemorySessionStore,
} from '~~/server/utils/sessionStore'
import {
  attachSessionMapUseCase,
  type AttachSessionMapUseCaseInput,
} from '~~/server/useCases/attachSessionMap'

interface TestMapDocument {
  readonly slug: string
  readonly name: string
  readonly tokens: readonly { readonly id: string; readonly x: number }[]
  readonly metadata?: { readonly note: string }
}

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: '1' }
const createdAt = '2026-05-25T10:00:00.000Z'
const joinedAt = '2026-05-25T10:05:00.000Z'
const attachedAt = '2026-05-25T10:15:00.000Z'
const endedAt = '2026-05-25T10:30:00.000Z'

const sessionId = parseSessionId('session_attachmap001')
const unknownSessionId = parseSessionId('session_attachmap002')
const joinCode = parseJoinCode('ATTMAP2')
const gmKey = parseGmKey('gmkey_attachmapabcdefghijklmnopqrstuvwxyz')
const wrongGmKey = parseGmKey('gmkey_wrongattachmapabcdefghijklmnopq')
const gmClientId = parseClientId('client_attachGM1')
const playerId = parsePlayerId('player_attach01')
const playerDisplayName = parseSessionDisplayName('Misty')
const baseRevision = parseSessionRevision(3)
const preservedMapRevision = parseMapRevision(7)

const viridianMapSlug = 'viridian-gym' as SessionMapSlug
const pewterMapSlug = 'pewter-gym' as SessionMapSlug
const missingMapSlug = 'missing-gym' as SessionMapSlug

const defaultInput: AttachSessionMapUseCaseInput = {
  sessionId,
  gmKey,
  gmClientId,
  mapSlug: viridianMapSlug,
}

type SnapshotWriter = (
  state: AuthoritativeSessionState<TestMapDocument>,
  options?: WriteSessionSnapshotOptions<TestMapDocument>,
) => WriteSessionSnapshotResult<TestMapDocument>

const createSnapshotWriter = () => vi.fn((
  state: AuthoritativeSessionState<TestMapDocument>,
  options?: WriteSessionSnapshotOptions<TestMapDocument>,
): WriteSessionSnapshotResult<TestMapDocument> => {
  const writtenAt = options?.clock?.() ?? attachedAt
  return {
    directoryPath: `/tmp/${state.sessionId}`,
    filePath: `/tmp/${state.sessionId}/snapshot.json`,
    bytesWritten: 1,
    snapshot: {
      schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
      sessionId: state.sessionId,
      revision: state.revision,
      writtenAt,
      state,
    },
  }
})

const createPersistedMap = (slug: SessionMapSlug): TestMapDocument => ({
  slug,
  name: slug === viridianMapSlug ? 'Viridian Gym' : 'Pewter Gym',
  tokens: [{ id: `${slug}-token`, x: 1 }],
  metadata: { note: `persisted ${slug}` },
})

const createBaseState = (
  overrides: Partial<Parameters<typeof createAuthoritativeSessionState<TestMapDocument>>[0]> = {},
): AuthoritativeSessionState<TestMapDocument> => createAuthoritativeSessionState<TestMapDocument>({
  sessionId,
  revision: baseRevision,
  players: [
    {
      playerId,
      displayName: playerDisplayName,
      joinedAt,
      updatedAt: joinedAt,
    },
  ],
  assignments: [
    {
      playerId,
      displayName: playerDisplayName,
      controllableResources: [],
      visibleResources: [],
      updatedAt: joinedAt,
    },
  ],
  createdAt,
  updatedAt: createdAt,
  ...overrides,
})

const createStoreWithSession = (overrides: {
  readonly state?: AuthoritativeSessionState<TestMapDocument>
  readonly includeState?: boolean
  readonly status?: 'active' | 'ended'
} = {}): InMemorySessionStore<AuthoritativeSessionState<TestMapDocument>> => {
  const store = createInMemorySessionStore<AuthoritativeSessionState<TestMapDocument>>()
  const state = overrides.state ?? createBaseState()
  store.create({
    sessionId,
    joinCode,
    gmKey,
    revision: state.revision,
    createdAt,
    updatedAt: state.updatedAt,
    ...(overrides.includeState === false ? {} : { state }),
  })

  if (overrides.status === 'ended') {
    store.end(sessionId, { endedAt })
  }

  return store
}

const createMapDependencies = (maps: Record<string, TestMapDocument | undefined> = {
  [viridianMapSlug]: createPersistedMap(viridianMapSlug),
}) => {
  const findMapPath = vi.fn((slug: SessionMapSlug) => (
    maps[slug] === undefined ? null : `/maps/${slug}.json`
  ))
  const readMap = vi.fn((filePath: string): TestMapDocument => {
    const slug = filePath.replace(/^\/maps\//, '').replace(/\.json$/, '')
    const map = maps[slug]
    if (map === undefined) throw new Error(`unexpected map path ${filePath}`)
    return map
  })

  return { findMapPath, readMap }
}

const attachMap = (overrides: {
  readonly input?: AttachSessionMapUseCaseInput
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TestMapDocument>>
  readonly writeSnapshot?: SnapshotWriter
  readonly findMapPath?: (slug: SessionMapSlug) => string | null
  readonly readMap?: (filePath: string) => TestMapDocument
  readonly env?: Record<string, string | undefined>
} = {}) => {
  const store = overrides.store ?? createStoreWithSession()
  const mapDependencies = overrides.findMapPath === undefined || overrides.readMap === undefined
    ? createMapDependencies()
    : undefined
  const writeSnapshot = overrides.writeSnapshot ?? createSnapshotWriter()

  return attachSessionMapUseCase<TestMapDocument>(overrides.input ?? defaultInput, {
    env: overrides.env ?? enabledEnv,
    store,
    clock: () => attachedAt,
    findMapPath: overrides.findMapPath ?? mapDependencies?.findMapPath,
    readMap: overrides.readMap ?? mapDependencies?.readMap,
    writeSnapshot,
  })
}

const expectHttpError = (
  action: () => unknown,
  expected: { readonly statusCode: number; readonly message: string },
) => {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject(expected)
}

describe('attachSessionMapUseCase', () => {
  it('fails closed when session hosting is not explicitly enabled', () => {
    const store = createStoreWithSession()
    const mapDependencies = createMapDependencies()
    const writeSnapshot = createSnapshotWriter()

    expectHttpError(
      () => attachMap({
        store,
        writeSnapshot,
        findMapPath: mapDependencies.findMapPath,
        readMap: mapDependencies.readMap,
        env: {},
      }),
      {
        statusCode: 403,
        message: 'live session hosting is disabled. Set ROTOM_ENABLE_SESSION_HOST=1 to enable session endpoints.',
      },
    )

    expect(store.get(sessionId)?.state).toEqual(createBaseState())
    expect(mapDependencies.findMapPath).not.toHaveBeenCalled()
    expect(mapDependencies.readMap).not.toHaveBeenCalled()
    expect(writeSnapshot).not.toHaveBeenCalled()
  })

  it('attaches a persisted map clone, selects it, advances the session once, and writes a snapshot', () => {
    const store = createStoreWithSession()
    const persistedMap = createPersistedMap(viridianMapSlug)
    const mapDependencies = createMapDependencies({ [viridianMapSlug]: persistedMap })
    const writeSnapshot = createSnapshotWriter()
    const nextRevision = incrementSessionRevision(baseRevision)

    const result = attachMap({
      store,
      writeSnapshot,
      findMapPath: mapDependencies.findMapPath,
      readMap: mapDependencies.readMap,
    })

    expect(result.session).toEqual({
      sessionId,
      status: 'active',
      revision: nextRevision,
      selectedMapSlug: viridianMapSlug,
      mapCount: 1,
      createdAt,
      updatedAt: attachedAt,
    })
    expect(result.map).toEqual({
      mapSlug: viridianMapSlug,
      revision: INITIAL_MAP_REVISION,
      selected: true,
    })
    expect(result.selection).toEqual({
      behavior: 'select-attached-map',
      previousSelectedMapSlug: null,
      selectedMapSlug: viridianMapSlug,
    })
    expect(result.visibility).toEqual({
      behavior: 'visible-to-all-players',
      grantsJoinedPlayers: true,
      grantsFuturePlayers: true,
      visiblePlayerIds: [playerId],
    })
    expect(result.snapshot).toEqual({
      writtenAt: attachedAt,
      revision: nextRevision,
    })
    expect(result).not.toHaveProperty('gmKey')

    const stored = store.get(sessionId)
    expect(stored).toMatchObject({ revision: nextRevision, updatedAt: attachedAt })
    expect(stored?.state?.revision).toBe(nextRevision)
    expect(stored?.state?.updatedAt).toBe(attachedAt)
    expect(stored?.state?.selectedMapSlug).toBe(viridianMapSlug)
    expect(stored?.state?.maps).toHaveLength(1)
    expect(stored?.state?.maps[0]).toEqual({
      mapSlug: viridianMapSlug,
      revision: INITIAL_MAP_REVISION,
      document: persistedMap,
    })
    expect(stored?.state?.maps[0]?.document).not.toBe(persistedMap)
    expect(stored?.state?.assignments[0]?.visibleResources).toEqual([
      { kind: 'map', mapSlug: viridianMapSlug },
    ])
    expect(stored?.state?.assignments[0]?.updatedByClientId).toBe(gmClientId)

    ;(persistedMap.tokens as { id: string; x: number }[])[0].x = 99
    expect(stored?.state?.maps[0]?.document.tokens[0]?.x).toBe(1)

    expect(mapDependencies.findMapPath).toHaveBeenCalledWith(viridianMapSlug)
    expect(mapDependencies.readMap).toHaveBeenCalledWith(`/maps/${viridianMapSlug}.json`)
    expect(writeSnapshot).toHaveBeenCalledTimes(1)
    expect(writeSnapshot.mock.calls[0]?.[0]).toEqual(stored?.state)
  })

  it('preserves an existing session map revision and current selection when requested', () => {
    const existingViridianState = createAuthoritativeSessionMapState<TestMapDocument>({
      mapSlug: viridianMapSlug,
      revision: preservedMapRevision,
      document: createPersistedMap(viridianMapSlug),
    })
    const existingPewterState = createAuthoritativeSessionMapState<TestMapDocument>({
      mapSlug: pewterMapSlug,
      revision: parseMapRevision(2),
      document: createPersistedMap(pewterMapSlug),
    })
    const state = createBaseState({
      selectedMapSlug: pewterMapSlug,
      maps: [existingViridianState, existingPewterState],
    })
    const store = createStoreWithSession({ state })
    const refreshedMap = {
      ...createPersistedMap(viridianMapSlug),
      metadata: { note: 'refreshed persisted copy' },
    }
    const mapDependencies = createMapDependencies({ [viridianMapSlug]: refreshedMap })

    const result = attachMap({
      store,
      findMapPath: mapDependencies.findMapPath,
      readMap: mapDependencies.readMap,
      input: {
        ...defaultInput,
        selectedMapBehavior: 'preserve-current-selection',
        visibilityBehavior: 'gm-only',
      },
    })

    expect(result.map).toEqual({
      mapSlug: viridianMapSlug,
      revision: preservedMapRevision,
      selected: false,
    })
    expect(result.selection).toEqual({
      behavior: 'preserve-current-selection',
      previousSelectedMapSlug: pewterMapSlug,
      selectedMapSlug: pewterMapSlug,
    })
    expect(result.visibility).toEqual({
      behavior: 'gm-only',
      grantsJoinedPlayers: false,
      grantsFuturePlayers: false,
      visiblePlayerIds: [],
    })

    const stored = store.get(sessionId)
    const attachedMap = stored?.state?.maps.find((map) => map.mapSlug === viridianMapSlug)
    expect(stored?.state?.selectedMapSlug).toBe(pewterMapSlug)
    expect(attachedMap?.revision).toBe(preservedMapRevision)
    expect(attachedMap?.document.metadata?.note).toBe('refreshed persisted copy')
    expect(stored?.state?.revision).toBe(incrementSessionRevision(baseRevision))
  })

  it('rejects a missing persisted map without mutating the session', () => {
    const state = createBaseState()
    const store = createStoreWithSession({ state })
    const mapDependencies = createMapDependencies({})
    const writeSnapshot = createSnapshotWriter()

    expectHttpError(
      () => attachMap({
        store,
        writeSnapshot,
        findMapPath: mapDependencies.findMapPath,
        readMap: mapDependencies.readMap,
        input: { ...defaultInput, mapSlug: missingMapSlug },
      }),
      {
        statusCode: 404,
        message: 'Map missing-gym.json not found',
      },
    )

    expect(store.get(sessionId)?.state).toEqual(state)
    expect(mapDependencies.findMapPath).toHaveBeenCalledWith(missingMapSlug)
    expect(mapDependencies.readMap).not.toHaveBeenCalled()
    expect(writeSnapshot).not.toHaveBeenCalled()
  })

  it('rejects missing sessions, bad GM keys, ended sessions, and missing authoritative state before loading a map', () => {
    const emptyStore = createInMemorySessionStore<AuthoritativeSessionState<TestMapDocument>>()
    const activeStore = createStoreWithSession()
    const endedStore = createStoreWithSession({ status: 'ended' })
    const missingStateStore = createStoreWithSession({ includeState: false })
    const mapDependencies = createMapDependencies()
    const writeSnapshot = createSnapshotWriter()

    expectHttpError(
      () => attachMap({
        store: emptyStore,
        writeSnapshot,
        findMapPath: mapDependencies.findMapPath,
        readMap: mapDependencies.readMap,
        input: { ...defaultInput, sessionId: unknownSessionId },
      }),
      {
        statusCode: 404,
        message: 'No live session was found for the supplied session ID',
      },
    )
    expectHttpError(
      () => attachMap({
        store: activeStore,
        writeSnapshot,
        findMapPath: mapDependencies.findMapPath,
        readMap: mapDependencies.readMap,
        input: { ...defaultInput, gmKey: wrongGmKey },
      }),
      {
        statusCode: 403,
        message: 'The supplied GM key is not authorized to attach maps to this live session',
      },
    )
    expectHttpError(
      () => attachMap({
        store: endedStore,
        writeSnapshot,
        findMapPath: mapDependencies.findMapPath,
        readMap: mapDependencies.readMap,
      }),
      {
        statusCode: 409,
        message: 'The live session must be active before a map can be attached',
      },
    )
    expectHttpError(
      () => attachMap({
        store: missingStateStore,
        writeSnapshot,
        findMapPath: mapDependencies.findMapPath,
        readMap: mapDependencies.readMap,
      }),
      {
        statusCode: 500,
        message: 'The live session has no authoritative state available for map attachment',
      },
    )

    expect(activeStore.get(sessionId)?.state).toEqual(createBaseState())
    expect(endedStore.get(sessionId)?.state).toEqual(createBaseState())
    expect(mapDependencies.findMapPath).not.toHaveBeenCalled()
    expect(mapDependencies.readMap).not.toHaveBeenCalled()
    expect(writeSnapshot).not.toHaveBeenCalled()
  })

  it('rolls back the in-memory map attachment if the snapshot cannot be written', () => {
    const state = createBaseState()
    const store = createStoreWithSession({ state })
    const mapDependencies = createMapDependencies()
    const writeSnapshot = vi.fn(() => {
      throw new Error('disk full')
    })

    expectHttpError(
      () => attachMap({
        store,
        writeSnapshot,
        findMapPath: mapDependencies.findMapPath,
        readMap: mapDependencies.readMap,
      }),
      {
        statusCode: 500,
        message: 'Failed to write attached-map session snapshot: disk full',
      },
    )

    const stored = store.get(sessionId)
    expect(stored?.revision).toBe(baseRevision)
    expect(stored?.updatedAt).toBe(createdAt)
    expect(stored?.state).toEqual(state)
  })
})
