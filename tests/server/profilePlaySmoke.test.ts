import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlayerProfileUseCase } from '~~/server/useCases/createPlayerProfile'
import { loadMapUseCase } from '~~/server/useCases/loadMap'
import { loadSheetUseCase } from '~~/server/useCases/loadSheet'
import { executeMapTokenLivePlayCommandUseCase } from '~~/server/useCases/applyMapTokenAction'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInMemoryLivePlayOpStore } from '~~/server/livePlay/opStore'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { saveSheetUseCase } from '~~/server/useCases/saveSheet'
import { updatePlayerProfileUseCase } from '~~/server/useCases/updatePlayerProfile'
import {
  createPlayerProfile as createStoredPlayerProfile,
  listPlayerProfiles,
  updatePlayerProfile as updateStoredPlayerProfile,
} from '~~/server/utils/playerProfileStorage'
import createMapRoute from '~~/server/api/maps/create.post'
import createSheetRoute from '~~/server/api/sheets/create.post'
import type { ApiClient } from '~/utils/apiClient'
import { PLAYER_PROFILE_API_PATHS } from '~/utils/apiRoutes'
import type { PlayerProfileSelectionStorage } from '~/utils/playerProfileSelectionStorage'
import { usePlayerProfiles } from '~/composables/usePlayerProfiles'
import { LIVE_PLAY_COMMAND_SCHEMA_VERSION, LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import type { SheetKind } from '#shared/sheets'
import type {
  PlayerProfile,
  RememberedPlayerProfileSelection,
} from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'

type PostRouteHandler = EventHandler<EventHandlerRequest, unknown>

const tempRoots: string[] = []

const createTempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-profile-play-smoke-'))
  tempRoots.push(root)
  return root
}

const sheetKey = (kind: SheetKind, slug: string): `${SheetKind}:${string}` => `${kind}:${slug}`

const invokePostRoute = async (
  handler: PostRouteHandler,
  options: { role?: 'gm' | 'player'; body?: unknown } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  return handler({
    method: 'POST',
    node: {
      req: {
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
  } as unknown as H3Event)
}

const createSelectionStorage = () => {
  let selected: RememberedPlayerProfileSelection | null = null
  const storage: PlayerProfileSelectionStorage = {
    remember: (selection) => {
      selected = selection
      return true
    },
    load: () => selected,
    clear: () => {
      selected = null
      return true
    },
  }

  return {
    storage,
    current: () => selected,
  }
}

const createPlayerProfileApiClient = (profileRoot: string): ApiClient => ({
  getJson: async <T = unknown>(request: string): Promise<T> => {
    if (request !== PLAYER_PROFILE_API_PATHS.list) {
      throw new Error(`Unexpected profile GET request: ${request}`)
    }
    return { profiles: listPlayerProfiles({ rootDir: profileRoot }) } as T
  },
  postJson: async <T = unknown>(request: string): Promise<T> => {
    throw new Error(`Unexpected profile POST request: ${request}`)
  },
})

const createArenaMap = (): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 2, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'linked-token',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
      turned: false,
    },
    {
      id: 'unlinked-token',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 3, y: 0, z: 3 },
      facing: 'north-west',
      turned: true,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: {},
  createdAt: 100,
  updatedAt: 100,
})

afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true })
  tempRoots.length = 0
})

describe('profile-based play smoke flow', () => {
  it('lets a selected profile play linked characters while blocking unlinked control and resource creation', async () => {
    const profileRoot = createTempRoot()
    const sheets = new Map<`${SheetKind}:${string}`, Record<string, unknown>>([
      [sheetKey('pokemon', 'pikachu'), {
        slug: 'pikachu',
        nickname: 'Pika',
        species: 'Pikachu',
        level: 5,
        player: false,
        revision: 0,
        updatedAt: 100,
      }],
      [sheetKey('pokemon', 'eevee'), {
        slug: 'eevee',
        nickname: 'Eevee',
        species: 'Eevee',
        level: 5,
        player: false,
        revision: 0,
        updatedAt: 100,
      }],
    ])

    const createdProfile = createPlayerProfileUseCase({
      role: 'gm',
      displayName: 'Ash Ketchum',
    }, {
      createProfile: (input) => createStoredPlayerProfile(input, { rootDir: profileRoot }),
    }).profile

    const linkedProfile = updatePlayerProfileUseCase({
      role: 'gm',
      profileId: createdProfile.id,
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
    }, {
      updateProfile: (profileId, input) => updateStoredPlayerProfile(profileId, input, { rootDir: profileRoot }),
      sheetExists: (ref) => sheets.has(sheetKey(ref.sheetKind, ref.sheetSlug)),
    }).profile

    expect(linkedProfile.linkedCharacters).toEqual([
      { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
    ])

    const selection = createSelectionStorage()
    const playerProfiles = usePlayerProfiles({
      apiClient: createPlayerProfileApiClient(profileRoot),
      selectionStorage: selection.storage,
      clock: () => '2026-05-27T12:00:00.000Z',
    })

    await expect(playerProfiles.reloadProfiles()).resolves.toEqual([linkedProfile])
    const rememberedProfile = playerProfiles.rememberProfileById(linkedProfile.id)

    expect(selection.current()).toEqual(rememberedProfile)
    expect(playerProfiles.selectedProfile.value).toEqual(linkedProfile)
    expect(playerProfiles.selectedLinkedCharacters.value).toEqual(linkedProfile.linkedCharacters)

    const selectedProfile = playerProfiles.selectedProfile.value as PlayerProfile
    let storedMap = createArenaMap()
    const mapWrites: TabletopMap[] = []
    const readSheet = (kind: SheetKind, slug: string) => {
      const sheet = sheets.get(sheetKey(kind, slug))
      return sheet ? { sheet } : null
    }
    const now = () => 1_700_000_000_000
    const relativePath = () => 'data/maps/arena.json'

    expect(loadMapUseCase({
      role: 'player',
      slug: 'arena',
    }, { mapRepository: { getBySlug: (slug: string) => (slug === storedMap.slug ? storedMap : null) } }).map).toEqual(storedMap)

    const liveCommandExecutor = createAuthoritativeLivePlayCommandExecutor({
      opStore: createInMemoryLivePlayOpStore(),
      queue: createInProcessMapWriteQueue(),
    })
    const liveMapRepository = {
      getBySlug: (slug: string) => (slug === storedMap.slug ? storedMap : null),
      applyLivePlayUpdate: (input: { slug: string; expectedRevision: number; nextMap: TabletopMap }) => {
        if (input.slug !== storedMap.slug || (storedMap.revision ?? 0) !== input.expectedRevision) return 'stale' as const
        storedMap = { ...input.nextMap, revision: input.expectedRevision + 1 }
        mapWrites.push(storedMap)
        return 'applied' as const
      },
    }

    const moveCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: 'op_profilemove',
      mapSlug: 'arena',
      baseRevision: 0,
      type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      scopes: [{ kind: 'token' as const, placementId: 'linked-token', field: 'position' as const }],
      payload: { placementId: 'linked-token', position: { x: 4, y: 0, z: 2 }, pathLength: 3 },
      clientId: 'player-client',
    }
    const moveResult = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command: moveCommand,
      clientId: 'player-client',
      playerProfile: selectedProfile,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, {
      commandExecutor: liveCommandExecutor,
      mapRepository: liveMapRepository,
      database: { withTransaction: <T>(work: () => T) => work() },
      readSheet,
      now,
      relativePath,
    })

    expect(moveResult.result).toMatchObject({ ok: true, revision: 1 })
    expect(moveResult.path).toBe('data/maps/arena.json')
    expect(moveResult.placement).toMatchObject({
      id: 'linked-token',
      position: { x: 4, y: 0, z: 2 },
    })
    expect(storedMap.placements.find((placement) => placement.id === 'linked-token')).toMatchObject({
      position: { x: 4, y: 0, z: 2 },
    })
    expect(storedMap.placements.find((placement) => placement.id === 'unlinked-token')).toMatchObject({
      position: { x: 3, y: 0, z: 3 },
    })
    expect('patches' in moveResult.result ? moveResult.result.patches : []).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'token.position', mapSlug: 'arena', revision: 1 }),
    ]))

    const sheetRepository = {
      getByRef: (kind: SheetKind, slug: string) => {
        const sheet = sheets.get(sheetKey(kind, slug))
        return sheet ? { kind, slug, sheet, revision: Number(sheet.revision ?? 0), updatedAt: Number(sheet.updatedAt ?? 0) } : null
      },
      list: (kind?: SheetKind) => [...sheets.entries()]
        .filter(([key]) => kind === undefined || key.startsWith(`${kind}:`))
        .map(([key, sheet]) => ({
          kind: key.split(':')[0] as SheetKind,
          slug: String(sheet.slug),
          document: sheet,
          revision: Number(sheet.revision ?? 0),
          updatedAt: Number(sheet.updatedAt ?? 0),
        })),
      replaceSetupSheet: (input: { kind: SheetKind; slug: string; expectedRevision: number; sheet: Record<string, unknown>; now: number; preservePlayerFlag?: boolean }) => {
        const key = sheetKey(input.kind, input.slug)
        const current = sheets.get(key)
        if (!current) return null
        if (Number(current.revision ?? 0) !== input.expectedRevision) throw new Error('stale sheet')
        const next = {
          ...input.sheet,
          slug: input.slug,
          player: input.preservePlayerFlag ? current.player : input.sheet.player,
          revision: input.expectedRevision + 1,
          updatedAt: input.now,
        }
        sheets.set(key, next)
        return {
          changed: true,
          sheet: { kind: input.kind, slug: input.slug, sheet: next, revision: input.expectedRevision + 1, updatedAt: input.now },
          path: `data/${input.kind === 'pokemon' ? 'sheets' : 'trainers'}/${input.slug}.json`,
        }
      },
    }

    const linkedSheetLoad = loadSheetUseCase({
      role: 'player',
      kind: 'pokemon',
      slug: 'pikachu',
      playerProfile: selectedProfile,
    }, { sheetRepository })

    expect(linkedSheetLoad.sheet).toMatchObject({ nickname: 'Pika', player: false })

    const savedSheet = saveSheetUseCase({
      role: 'player',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pikachu',
      sheet: {
        ...linkedSheetLoad.sheet,
        nickname: 'Sparky',
        playerProfileAccessible: true,
      },
      expectedRevision: 0,
      playerProfile: selectedProfile,
      clientId: 'player-client',
    }, {
      sheetRepository,
      isPlayerAccessible: (kind, slug) => sheets.get(sheetKey(kind, slug))?.player === true,
    })

    expect(savedSheet).toMatchObject({
      ok: true,
      slug: 'pikachu',
      sheet: {
        revision: 1,
        slug: 'pikachu',
        nickname: 'Sparky',
        species: 'Pikachu',
        level: 5,
        player: false,
      },
    })
    expect(sheets.get(sheetKey('pokemon', 'pikachu'))).toMatchObject({
      revision: 1,
      slug: 'pikachu',
      nickname: 'Sparky',
      species: 'Pikachu',
      level: 5,
      player: false,
    })

    const deniedMove = await executeMapTokenLivePlayCommandUseCase({
      role: 'player',
      command: {
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        opId: 'op_profiledeny',
        mapSlug: 'arena',
        baseRevision: 1,
        type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
        scopes: [{ kind: 'token' as const, placementId: 'unlinked-token', field: 'position' as const }],
        payload: { placementId: 'unlinked-token', position: { x: 5, y: 0, z: 5 } },
      },
      playerProfile: selectedProfile,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, {
      commandExecutor: liveCommandExecutor,
      mapRepository: liveMapRepository,
      database: { withTransaction: <T>(work: () => T) => work() },
      readSheet,
      now,
      relativePath,
    })
    expect(deniedMove.result).toMatchObject({ ok: false, reason: 'unauthorized', message: 'Token is not linked to selected player profile' })
    expect(mapWrites).toHaveLength(1)
    expect(storedMap.placements.find((placement) => placement.id === 'unlinked-token')).toMatchObject({
      position: { x: 3, y: 0, z: 3 },
    })

    await expect(invokePostRoute(createMapRoute, {
      role: 'player',
      body: { name: 'Player-built map' },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'GM login required',
    })
    await expect(invokePostRoute(createSheetRoute, {
      role: 'player',
      body: { kind: 'pokemon', folder: '' },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'GM login required',
    })
  })
})
