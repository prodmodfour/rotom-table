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
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { executeStartTurnModalLivePlayCommandUseCase } from '~~/server/useCases/applyStartTurnModalCommand'
import { MAPS_ROOT } from '~~/server/utils/mapPaths'
import type { CharacterSheet } from '~/types/characterSheet'
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

const earlyBirdSheet = (enabled: boolean): CharacterSheet => ({
  slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', level: 20, revision: 3, types: ['Electric'],
  abilities: enabled ? [{
    name: 'Early Bird',
    automation: {
      schemaVersion: 1, instanceId: 'base:early-bird', canonicalId: 'Early Bird',
      definitionVersion: null, selections: [],
    },
  }] : [],
  movelist: [],
  stats: {
    hp: { added: 20 }, atk: { added: 20 }, def: { added: 20 },
    satk: { added: 20 }, sdef: { added: 20 }, spd: { added: 20 },
  },
  combat: { currentHp: 100, conditions: ['Sleep'] },
})

const createHarness = (initialMap: TabletopMap = baseMap(), hasEarlyBird = false) => {
  let storedMap = initialMap
  const published: unknown[] = []
  const executor = createAuthoritativeLivePlayCommandExecutor({
    opStore: createInMemoryLivePlayOpStore(),
    queue: createInProcessMapWriteQueue(),
    ...acceptedRealtimeTestHooks(published),
  })
  const mapRepository = {
    getBySlug: vi.fn((slug: string) => (slug === 'arena' ? storedMap : null)),
    applyLivePlayUpdate: vi.fn((input: { slug: string; expectedRevision: number; nextMap: TabletopMap }) => {
      if (input.slug !== 'arena' || input.expectedRevision !== storedMap.revision) return 'stale' as const
      storedMap = {
        ...input.nextMap,
        revision: input.expectedRevision + 1,
      }
      return 'applied' as const
    }),
  }
  const sheetRevision = 3
  const sheetRepository = {
    getByRef: vi.fn((kind: string, slug: string) => kind === 'pokemon' && slug === 'pikachu'
      ? {
          kind: 'pokemon' as const, slug: 'pikachu',
          sheet: earlyBirdSheet(hasEarlyBird) as unknown as Record<string, unknown>,
          revision: sheetRevision, updatedAt: 100,
        }
      : null),
    assertRevisions: vi.fn(),
  }
  const deps = {
    commandExecutor: executor,
    mapRepository,
    sheetRepository,
    database: { withTransaction: <T>(work: () => T) => work() },
    relativePath: vi.fn((filePath: string) => filePath.replace(`${MAPS_ROOT}/`, 'data/maps/')),
    now: vi.fn(() => 2_000),
    rollD20: vi.fn(() => 14),
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
            schemaVersion: 3,
            dismissedTurn: {
              activeId: 'token-pikachu',
              round: 2,
              dismissedAt: 2_000,
            },
            conditionResolutions: [],
          },
        },
      },
    })
    expect(harness.published).toEqual([
      expect.objectContaining({ channel: 'map:arena', type: 'live-play-command-accepted', opId: 'op_turnmodal1', revision: 5 }),
    ])
    expect(harness.deps.sheetRepository.getByRef).not.toHaveBeenCalled()
    expect(harness.deps.sheetRepository.assertRevisions).not.toHaveBeenCalled()
  })

  it('records condition roll results through the authoritative executor', async () => {
    const harness = createHarness()

    const response = await execute(harness, dismissCommand({
      opId: 'op_turnmodal_condition',
      payload: {
        action: 'resolveCondition',
        activeId: 'token-pikachu',
        round: 2,
        condition: 'Paralysis',
        occurrence: 0,
        resolution: 'roll',
      },
    }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(readStartTurnModalState(harness.storedMap.metadata).conditionResolutions).toEqual([{
      activeId: 'token-pikachu',
      round: 2,
      condition: 'Paralysis',
      occurrence: 0,
      resolution: 'roll',
      roll: 14,
      modifier: 0,
      finalValue: 14,
      dc: 11,
      success: true,
      resolvedAt: 2_000,
    }])
    expect(harness.deps.sheetRepository.assertRevisions).toHaveBeenCalledWith([{
      kind: 'pokemon', slug: 'pikachu', revision: 3,
    }])
    expect(acceptedPatches(response)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
      payload: {
        action: 'resolveCondition',
        current: {
          startTurnModal: {
            conditionResolutions: [expect.objectContaining({
              condition: 'Paralysis',
              resolution: 'roll',
              roll: 14,
            })],
          },
        },
      },
    })
  })

  it('applies Early Bird as an authoritative +3 modifier only to Sleep saves', async () => {
    const harness = createHarness(baseMap(), true)

    const response = await execute(harness, dismissCommand({
      opId: 'op_turnmodal_early_bird',
      payload: {
        action: 'resolveCondition', activeId: 'token-pikachu', round: 2,
        condition: 'Sleep', occurrence: 0, resolution: 'roll',
      },
    }))

    expect(response.result).toMatchObject({ ok: true })
    expect(readStartTurnModalState(harness.storedMap.metadata).conditionResolutions[0])
      .toMatchObject({ roll: 14, modifier: 3, finalValue: 17, success: true })
    expect(harness.deps.sheetRepository.assertRevisions).toHaveBeenCalledWith([{
      kind: 'pokemon', slug: 'pikachu', revision: 3,
    }])
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
