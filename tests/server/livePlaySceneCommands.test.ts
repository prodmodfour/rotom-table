import { describe, expect, it, vi } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type SetSceneLivePlayCommand,
} from '#shared/livePlayCommands'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { createInMemoryLivePlayOpStore } from '~~/server/livePlay/opStore'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { executeLivePlaySceneCommandUseCase } from '~~/server/useCases/applyLivePlaySceneCommand'
import { createSceneLifecycleEvents } from '~~/server/domain/moveAutomation/planSceneLifecycle'
import { MAPS_ROOT } from '~~/server/utils/mapPaths'
import { applyLivePlayPatchesToMap } from '~/utils/livePlayPatches'
import type { TabletopMap } from '~/types/map'
import {
  applyItemFormChangeCandidate,
  resolveItemFormChangeCandidate,
} from '~~/server/domain/itemAutomation/formChanges'
import {
  FORM_CHANGE_POKEMON_PLACEMENT_ID,
  FORM_CHANGE_TRAINER_PLACEMENT_ID,
  createFormChangeMap,
  createFormChangePokemon,
  createFormChangeTrainer,
} from '../fixtures/itemFormChanges'

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
  const deps = {
    commandExecutor: executor,
    mapRepository,
    database: { withTransaction: <T>(work: () => T) => work() },
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
      metadata: {
        encounterName: 'Rooftop Ambush',
        moveLog: [{ at: 1_000, userName: 'Foil', moveName: 'Ember', lines: ['Foil used Ember.'] }],
        initiativeLog: [{ at: 1_100, userName: 'Foil', actionName: 'Initiative', lines: ['Foil has gained initiative!'] }],
      },
    }))

    const start = await execute(harness, setSceneCommand())

    expect(start.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.activeScene).toEqual({ name: 'Moonlit Rooftop', startedAt: 2_000 })
    expect(harness.storedMap.moveUsage).toBeUndefined()
    expect(harness.storedMap.metadata).toEqual({ encounterName: 'Rooftop Ambush' })
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
    expect(harness.storedMap.metadata).toEqual({ encounterName: 'Rooftop Ambush' })
    expect(acceptedPatches(end)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_SCENE,
      payload: {
        previous: { name: 'Moonlit Rooftop', startedAt: 2_000 },
        current: null,
      },
    })
  })

  it('publishes exact Mega form initiative reversal so connected clients converge at Scene end', async () => {
    const pokemon = createFormChangePokemon('mega-mewtwo-y', {
      species: 'Mewtwo', types: ['Psychic'], abilities: [{ name: 'Pressure' }],
    })
    const trainer = createFormChangeTrainer()
    const sourceMap = createFormChangeMap({
      slug: 'arena', revision: 4,
      initiative: { activeId: FORM_CHANGE_POKEMON_PLACEMENT_ID, round: 2 },
    })
    const candidate = resolveItemFormChangeCandidate({
      map: sourceMap,
      actorPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
      targetPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
      sheets: {
        pokemon: new Map([[pokemon.slug, pokemon]]),
        trainer: new Map([[trainer.slug, trainer]]),
      },
    })
    const activeMap = applyItemFormChangeCandidate({
      map: sourceMap, candidate, operationId: 'operation-live-scene-mega', acceptedAt: 5_200,
    })
    expect(activeMap.placements.find(row => row.id === FORM_CHANGE_POKEMON_PLACEMENT_ID)?.initiative).toBe(14)
    const remote = structuredClone(activeMap)
    const harness = createHarness(activeMap)
    const response = await execute(harness, setSceneCommand({
      opId: 'op_end_mega_scene', payload: { name: null },
    }))
    const patches = acceptedPatches(response)
    expect(patches[0]?.payload).toMatchObject({
      lifecycle: {
        placementInitiativeChanges: [{
          placementId: FORM_CHANGE_POKEMON_PLACEMENT_ID, previous: 14, current: 13,
        }],
      },
    })
    expect(harness.storedMap.encounterState?.itemFormChanges?.entries).toEqual([])
    expect(harness.storedMap.placements.find(row => row.id === FORM_CHANGE_POKEMON_PLACEMENT_ID)?.initiative).toBe(13)
    expect(applyLivePlayPatchesToMap({
      map: remote, mapSlug: 'arena', previousRevision: 4, revision: 5, patches,
    })).toMatchObject({ ok: true, applied: true })
    expect(remote.encounterState?.itemFormChanges?.entries).toEqual([])
    expect(remote.placements.find(row => row.id === FORM_CHANGE_POKEMON_PLACEMENT_ID)?.initiative).toBe(13)
    expect(remote.placements.find(row => row.id === FORM_CHANGE_TRAINER_PLACEMENT_ID)?.initiative).toBe(14)
  })

  it('expires scene effects and clears every scene-local resource and compatibility prompt', async () => {
    const oldScene = { name: 'Old Scene', startedAt: 1_000 }
    const expiring = parseEncounterEffect({
      id: 'effect.scene-expiring',
      kind: 'numeric-modifier',
      source: {
        operationId: 'operation.scene-expiring',
        moveId: 'move.scene-expiring',
        placementId: 'token-a',
      },
      affected: { placementIds: ['token-a'], sideIds: [], cells: [] },
      createdRound: 1,
      createdTurn: 0,
      duration: { kind: 'scene', remaining: null },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['scene-test'],
      payload: { attribute: 'damage', operation: 'add', value: 1, rounding: 'none' },
      dispel: { policy: 'none', tags: [] },
      suppression: { sources: [] },
    })
    const persistent = parseEncounterEffect({
      ...expiring,
      id: 'effect.persistent',
      source: {
        operationId: 'operation.persistent',
        moveId: 'move.persistent',
        placementId: 'token-a',
      },
      duration: { kind: 'permanent', remaining: null },
      suppression: {
        sources: [{ effectId: expiring.id, reasonCode: 'effect.scene-suppression' }],
      },
    })
    const initialMap = baseMap({
      activeScene: oldScene,
      temporaryHitPoints: { scene: oldScene, byPlacementId: { 'token-a': 8 } },
      moveUsage: {
        scene: oldScene,
        byPlacementId: {
          'token-a': {
            tackle: { moveName: 'Tackle', frequency: 'scene', uses: 1 },
          },
        },
      },
      encounterState: {
        ...createEmptyEncounterState(),
        effects: [expiring, persistent],
      },
      metadata: {
        encounterName: 'Keep me',
        moveLog: [{ at: 1, lines: ['old'] }],
        initiativeLog: [{ at: 1, lines: ['old'] }],
        attackOfOpportunity: {
          schemaVersion: 1,
          prompts: [{
            id: 'prompt-old',
            attackerId: 'token-a',
            attackerName: 'A',
            provokerId: 'token-b',
            provokerName: 'B',
            reason: 'movement',
            round: 1,
          }],
          usedRoundByAttackerId: { 'token-a': 1 },
        },
        startTurnModal: {
          schemaVersion: 2,
          dismissedTurn: { activeId: 'token-a', round: 1 },
          conditionResolutions: [],
        },
        activeOrderEffects: [{ id: 'old-order' }],
      },
    })
    const harness = createHarness(initialMap)

    const response = await execute(harness, setSceneCommand({
      opId: 'op_scene_cleanup',
      payload: { name: null },
    }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.activeScene).toBeUndefined()
    expect(harness.storedMap.temporaryHitPoints).toBeUndefined()
    expect(harness.storedMap.moveUsage).toBeUndefined()
    expect(harness.storedMap.metadata).toEqual({ encounterName: 'Keep me' })
    expect(harness.storedMap.encounterState?.effects).toEqual([
      expect.objectContaining({ id: 'effect.persistent', suppression: { sources: [] } }),
    ])
    expect(harness.storedMap.encounterState).toMatchObject({
      counters: {},
      turnResources: {},
      pendingResolutionSummaries: [],
    })

    const patches = acceptedPatches(response)
    expect(patches[0]?.payload).toMatchObject({
      lifecycle: {
        events: [expect.objectContaining({ kind: 'scene-end' })],
        effectTransitions: [
          expect.objectContaining({ effectId: 'effect.scene-expiring', kind: 'expired' }),
          expect.objectContaining({ effectId: 'effect.persistent', kind: 'suppression-cleared' }),
        ],
        previousTemporaryHitPoints: initialMap.temporaryHitPoints,
        currentTemporaryHitPoints: null,
        previousMoveUsage: initialMap.moveUsage,
        currentMoveUsage: null,
      },
    })

    const remote = JSON.parse(JSON.stringify(initialMap)) as TabletopMap
    expect(applyLivePlayPatchesToMap({
      map: remote,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches,
    })).toMatchObject({ ok: true, applied: true })
    expect(remote.encounterState).toEqual(harness.storedMap.encounterState)
    expect(remote.metadata).toEqual(harness.storedMap.metadata)
    expect(remote.temporaryHitPoints).toBeUndefined()
    expect(remote.moveUsage).toBeUndefined()
  })

  it('uses stable name-independent scene identities and orders replacement boundaries', () => {
    const previous = { name: 'Old label', startedAt: 100 }
    const current = { name: 'New label', startedAt: 200 }
    const replacement = createSceneLifecycleEvents({
      mapSlug: 'arena',
      previous,
      current,
      operationId: 'op_replace_scene',
    })
    const laterEnd = createSceneLifecycleEvents({
      mapSlug: 'arena',
      previous: { ...previous, name: 'Renamed display label' },
      current: null,
      operationId: 'op_end_scene',
    })

    expect(replacement.map(event => event.kind)).toEqual(['scene-end', 'scene-start'])
    expect(replacement[0]?.sceneId).toBe(laterEnd[0]?.sceneId)
    expect(replacement[0]?.sceneId).not.toBe(replacement[1]?.sceneId)
    expect(new Set(replacement.map(event => event.eventId)).size).toBe(2)
  })

  it('rejects player scene changes', async () => {
    const harness = createHarness()

    const response = await execute(harness, setSceneCommand(), 'player')

    expect(response.result).toMatchObject({ ok: false, reason: 'unauthorized' })
    expect(harness.storedMap.activeScene).toBeUndefined()
  })
})
