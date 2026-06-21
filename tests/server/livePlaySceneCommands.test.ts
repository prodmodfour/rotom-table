import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type SetSceneLivePlayCommand,
} from '#shared/livePlayCommands'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { createInMemoryLivePlayOpStore } from '~~/server/livePlay/opStore'
import { executeLivePlaySceneCommandUseCase } from '~~/server/useCases/applyLivePlaySceneCommand'
import { MAPS_ROOT } from '~~/server/utils/mapPaths'
import type { TabletopMap } from '~/types/map'

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 4,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: {},
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const setSceneCommand = (
  overrides: Partial<SetSceneLivePlayCommand> = {},
): SetSceneLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_setscene1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
  scopes: [{ kind: 'map', lane: 'scene' }],
  payload: { name: 'Moonlit Rooftop' },
  ...overrides,
})

const createHarness = (initialMap: TabletopMap = baseMap()) => {
  let storedMap = initialMap
  const published: unknown[] = []
  const executor = createAuthoritativeLivePlayCommandExecutor({
    opStore: createInMemoryLivePlayOpStore(),
    queue: createInProcessMapWriteQueue(),
  })
  const mapRepository = {
    getBySlug: vi.fn(async (slug: string) => (slug === 'arena' ? storedMap : null)),
    applyLivePlayUpdate: vi.fn(async (input: { slug: string; expectedRevision: number; nextMap: TabletopMap }) => {
      if (input.slug !== 'arena' || input.expectedRevision !== storedMap.revision) return 'stale' as const
      storedMap = {
        ...input.nextMap,
        revision: input.expectedRevision + 1,
      }
      return 'applied' as const
    }),
  }
  const deps = {
    commandExecutor: executor,
    mapRepository,
    publishRealtimeEvent: vi.fn((event) => published.push(event)),
    relativePath: vi.fn((filePath: string) => filePath.replace(`${MAPS_ROOT}/`, 'data/maps/')),
    now: vi.fn(() => 2_000),
  }

  return {
    deps,
    published,
    get storedMap() {
      return storedMap
    },
  }
}

const execute = (harness: ReturnType<typeof createHarness>, command: SetSceneLivePlayCommand, role: 'gm' | 'player' = 'gm') =>
  executeLivePlaySceneCommandUseCase({
    role,
    command,
    clientId: `${role}-client`,
    expectedType: command.type,
  }, harness.deps)

const acceptedPatches = (response: Awaited<ReturnType<typeof execute>>) => (
  response.result.ok && !('duplicate' in response.result) ? response.result.patches : []
)

describe('live-play scene commands', () => {
  it('starts and ends active scenes through the authoritative executor', async () => {
    const harness = createHarness(baseMap({
      moveUsage: {
        byPlacementId: {
          'token-a': {
            tackle: { moveName: 'Tackle', frequency: 'scene', uses: 1 },
          },
        },
      },
    }))

    const start = await execute(harness, setSceneCommand())

    expect(start.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.activeScene).toEqual({ name: 'Moonlit Rooftop', startedAt: 2_000 })
    expect(harness.storedMap.moveUsage).toBeUndefined()
    expect(start.activeScene).toEqual({ name: 'Moonlit Rooftop', startedAt: 2_000 })
    expect(acceptedPatches(start)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_SCENE,
      scopes: [{ kind: 'map', lane: 'scene' }],
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
        previous: null,
        current: { name: 'Moonlit Rooftop', startedAt: 2_000 },
      },
    })
    expect(harness.published).toEqual([
      expect.objectContaining({ channel: 'map:arena', type: 'live-play-command-accepted', opId: 'op_setscene1', revision: 5 }),
    ])

    const end = await execute(harness, setSceneCommand({
      opId: 'op_endscene1',
      baseRevision: 5,
      payload: { name: null },
    }))

    expect(end.result).toMatchObject({ ok: true, previousRevision: 5, revision: 6 })
    expect(harness.storedMap.activeScene).toBeUndefined()
    expect(acceptedPatches(end)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_SCENE,
      payload: {
        previous: { name: 'Moonlit Rooftop', startedAt: 2_000 },
        current: null,
      },
    })
  })

  it('rejects player scene changes', async () => {
    const harness = createHarness()

    const response = await execute(harness, setSceneCommand(), 'player')

    expect(response.result).toMatchObject({ ok: false, reason: 'unauthorized' })
    expect(harness.storedMap.activeScene).toBeUndefined()
  })
})
