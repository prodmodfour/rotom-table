import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type UpdateStartTurnModalLivePlayCommand,
} from '#shared/livePlayCommands'
import { readStartTurnModalState } from '#shared/startTurnModalState'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { createInMemoryLivePlayOpStore } from '~~/server/livePlay/opStore'
import { executeStartTurnModalLivePlayCommandUseCase } from '~~/server/useCases/applyStartTurnModalCommand'
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
  placements: [
    {
      id: 'token-pikachu',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
    },
  ],
  lights: [],
  initiative: { activeId: 'token-pikachu', round: 2 },
  metadata: { encounterName: 'Rooftop Ambush' },
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const dismissCommand = (
  overrides: Partial<UpdateStartTurnModalLivePlayCommand> = {},
): UpdateStartTurnModalLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_turnmodal1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.UPDATE_START_TURN_MODAL,
  scopes: [{ kind: 'map', lane: 'metadata' }],
  payload: { action: 'dismiss', activeId: 'token-pikachu', round: 2 },
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

const execute = (
  harness: ReturnType<typeof createHarness>,
  command: UpdateStartTurnModalLivePlayCommand,
  role: 'gm' | 'player' = 'gm',
) => executeStartTurnModalLivePlayCommandUseCase({
  role,
  command,
  clientId: `${role}-client`,
  expectedType: command.type,
}, harness.deps)

const acceptedPatches = (response: Awaited<ReturnType<typeof execute>>) => (
  response.result.ok && !('duplicate' in response.result) ? response.result.patches : []
)

describe('live-play start-of-turn modal commands', () => {
  it('dismisses the current start-of-turn modal through the authoritative executor', async () => {
    const harness = createHarness()

    const response = await execute(harness, dismissCommand())

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(readStartTurnModalState(harness.storedMap.metadata).dismissedTurn).toEqual({
      activeId: 'token-pikachu',
      round: 2,
      dismissedAt: 2_000,
    })
    expect(harness.storedMap.metadata?.encounterName).toBe('Rooftop Ambush')
    expect(acceptedPatches(response)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
      scopes: [{ kind: 'map', lane: 'metadata' }],
      payload: {
        action: 'dismiss',
        previous: { encounterName: 'Rooftop Ambush' },
        current: {
          encounterName: 'Rooftop Ambush',
          startTurnModal: {
            schemaVersion: 1,
            dismissedTurn: {
              activeId: 'token-pikachu',
              round: 2,
              dismissedAt: 2_000,
            },
          },
        },
      },
    })
    expect(harness.published).toEqual([
      expect.objectContaining({ channel: 'map:arena', type: 'live-play-command-accepted', opId: 'op_turnmodal1', revision: 5 }),
    ])
  })

  it('rejects player dismissals', async () => {
    const harness = createHarness()

    const response = await execute(harness, dismissCommand(), 'player')

    expect(response.result).toMatchObject({ ok: false, reason: 'unauthorized' })
    expect(readStartTurnModalState(harness.storedMap.metadata).dismissedTurn).toBeNull()
  })

  it('rejects dismissals for stale active turns', async () => {
    const harness = createHarness(baseMap({ initiative: { activeId: 'token-pikachu', round: 3 } }))

    const response = await execute(harness, dismissCommand())

    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(readStartTurnModalState(harness.storedMap.metadata).dismissedTurn).toBeNull()
  })
})
