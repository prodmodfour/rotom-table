import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayPatch,
} from '#shared/livePlayCommands'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterZone } from '#shared/moveAutomation/encounterZones'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { applyLivePlayPatchesToMap } from '~/utils/livePlayPatches'
import type { TabletopMap } from '~/types/map'

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 4,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  voxels: [{ x: 0, y: 0, z: 0, materialId: 'meadow_grass' }],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-a',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
      turned: false,
      initiative: 10,
    },
    {
      id: 'token-b',
      sheetKind: 'trainer',
      sheetSlug: 'brock',
      position: { x: 2, y: 0, z: 2 },
      initiative: 5,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 100,
  ...overrides,
})

const patchBase = (type: LivePlayPatch['type'], payload: unknown): LivePlayPatch => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type,
  mapSlug: 'arena',
  revision: 5,
  scopes: [{ kind: 'map', lane: 'metadata' }],
  payload,
})

describe('live-play patch application', () => {
  it('adopts native field ownership with its compatibility field-effects patch', () => {
    const map = baseMap({ encounterState: createEmptyEncounterState() })
    const field = parseEncounterZone({
      id: 'zone.field.weather.test',
      kind: 'weather',
      source: {
        kind: 'operation',
        operationId: 'field.command.test',
        moveId: null,
        placementId: null,
      },
      sideId: null,
      geometry: { kind: 'battlefield' },
      layer: 1,
      duration: { kind: 'rounds', boundary: 'end', remaining: 3 },
      stacking: { kind: 'replace', maxLayers: null },
      fieldPolicy: {
        priority: 0,
        replacementGroup: 'field.weather',
        suppression: { sources: [] },
      },
      hooks: { entry: [], exit: [] },
      modifiers: { targeting: [], damage: [], movement: [] },
      tags: ['global-field', 'weather', 'sunny'],
      payload: { weatherId: 'sunny' },
    })
    const currentEncounterState = {
      ...createEmptyEncounterState(),
      zones: [field],
    }

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS, {
          command: 'setFieldEffect',
          previous: { weather: [], terrains: [], rooms: [] },
          current: { weather: [{ kind: 'sunny', rounds: 3 }], terrains: [], rooms: [] },
          previousEncounterState: createEmptyEncounterState(),
          currentEncounterState,
          fieldTransitions: [{
            zoneId: field.id,
            kind: 'added',
            reasonCode: 'field-added',
          }],
        }),
        scopes: [{ kind: 'map', lane: 'fieldEffects' }],
      }],
    })

    expect(result).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(map.fieldEffects).toEqual({
      weather: [{ kind: 'sunny', rounds: 3 }],
      terrains: [],
      rooms: [],
    })
    expect(map.encounterState?.zones).toEqual([field])
  })

  it('applies token movement and authoritative resource patches without replacing unrelated terrain arrays', () => {
    const map = baseMap({ encounterState: createEmptyEncounterState() })
    const originalVoxels = map.voxels
    const ledger = createEncounterTurnResourceLedger({
      placementId: 'token-a',
      round: 1,
      movementBudget: 6,
    })
    const spentLedger = {
      ...ledger,
      actions: {
        ...ledger.actions,
        shift: { ...ledger.actions.shift, spent: 1 },
      },
      movement: { ...ledger.movement, spent: 3 },
    }

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION, {
          placementId: 'token-a',
          position: { x: 4, y: 0, z: 3 },
          facing: 'north-east',
          turned: false,
          movementLogEntry: {
            at: 200,
            userId: 'token-a',
            userName: 'Pika',
            from: { x: 1, y: 0, z: 1 },
            to: { x: 4, y: 0, z: 3 },
          },
          turnResources: {
            previous: {},
            current: { 'token-a': spentLedger },
          },
        }),
        scopes: [{ kind: 'token', placementId: 'token-a', field: 'position' }],
      }],
    })

    expect(result).toMatchObject({ ok: true, applied: true, revision: 5, terrainChanged: false })
    expect(map.revision).toBe(5)
    expect(map.placements[0]).toMatchObject({
      id: 'token-a',
      position: { x: 4, y: 0, z: 3 },
      facing: 'north-east',
    })
    expect(map.voxels).toBe(originalVoxels)
    expect(map.metadata?.movementLog).toEqual([
      expect.objectContaining({ userId: 'token-a', to: { x: 4, y: 0, z: 3 } }),
    ])
    expect(map.encounterState?.turnResources['token-a']).toMatchObject({
      actions: { shift: { spent: 1 } },
      movement: { budget: 6, spent: 3 },
    })
  })

  it('rejects a token movement patch whose resource before-value is stale', () => {
    const ledger = createEncounterTurnResourceLedger({
      placementId: 'token-a',
      round: 1,
      movementBudget: 6,
    })
    const map = baseMap({
      encounterState: {
        ...createEmptyEncounterState(),
        turnResources: { 'token-a': ledger },
      },
    })

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION, {
          placementId: 'token-a',
          position: { x: 4, y: 0, z: 3 },
          turnResources: { previous: {}, current: {} },
        }),
        scopes: [{ kind: 'token', placementId: 'token-a', field: 'position' }],
      }],
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid-patch',
      message: expect.stringContaining('previous value does not match'),
    })
    expect(map.revision).toBe(4)
    expect(map.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
    expect(map.encounterState?.turnResources).toEqual({ 'token-a': ledger })
  })

  it('applies initiative patches and appends initiative log metadata', () => {
    const map = baseMap()

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE, {
        command: 'nextInitiative',
        previous: {
          activeId: null,
          round: 1,
          entries: [
            { tokenId: 'token-a', initiative: 10 },
            { tokenId: 'token-b', initiative: 5 },
          ],
        },
        current: {
          activeId: 'token-a',
          round: 2,
          entries: [
            { tokenId: 'token-a', initiative: 12 },
            { tokenId: 'token-b', initiative: null },
          ],
        },
        changedTokenIds: ['token-a', 'token-b'],
        logEntry: { at: 300, userId: 'token-a', actionName: 'Initiative' },
      })],
    })

    expect(result.ok).toBe(true)
    expect(map.initiative).toEqual({ activeId: 'token-a', round: 2 })
    expect(map.placements).toEqual([
      expect.objectContaining({ id: 'token-a', initiative: 12 }),
      expect.objectContaining({ id: 'token-b', initiative: null }),
    ])
    expect(map.metadata?.initiativeLog).toEqual([expect.objectContaining({ userId: 'token-a' })])
  })

  it('stores manual initiative order from initiative patches', () => {
    const map = baseMap()

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE, {
        command: 'setInitiative',
        previous: {
          activeId: null,
          round: 1,
          entries: [
            { tokenId: 'token-a', initiative: 10 },
            { tokenId: 'token-b', initiative: 5 },
          ],
        },
        current: {
          activeId: 'token-b',
          round: 3,
          manualOrderIds: ['token-b', 'token-a'],
          entries: [
            { tokenId: 'token-a', initiative: 10 },
            { tokenId: 'token-b', initiative: 5 },
          ],
        },
        changedTokenIds: [],
      })],
    })

    expect(result.ok).toBe(true)
    expect(map.initiative).toEqual({
      activeId: 'token-b',
      round: 3,
      manualOrderIds: ['token-b', 'token-a'],
    })
  })

  it('clears stale manual initiative order when an initiative patch omits manual order', () => {
    const map = baseMap({
      initiative: { activeId: 'token-a', round: 2, manualOrderIds: ['token-b', 'token-a'] },
    })

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE, {
        command: 'setInitiative',
        previous: {
          activeId: 'token-a',
          round: 2,
          manualOrderIds: ['token-b', 'token-a'],
          entries: [
            { tokenId: 'token-a', initiative: 10 },
            { tokenId: 'token-b', initiative: 5 },
          ],
        },
        current: {
          activeId: 'token-a',
          round: 2,
          entries: [
            { tokenId: 'token-a', initiative: 10 },
            { tokenId: 'token-b', initiative: 5 },
          ],
        },
        changedTokenIds: [],
      })],
    })

    expect(result.ok).toBe(true)
    expect(map.initiative).toEqual({ activeId: 'token-a', round: 2 })
    expect(map.initiative).not.toHaveProperty('manualOrderIds')
  })

  it('regresses manual initiative patch adoption and later clear', () => {
    const map = baseMap()

    const manualResult = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE, {
          command: 'setInitiative',
          previous: {
            activeId: null,
            round: 1,
            entries: [
              { tokenId: 'token-a', initiative: 10 },
              { tokenId: 'token-b', initiative: 5 },
            ],
          },
          current: {
            activeId: 'token-b',
            round: 1,
            manualOrderIds: ['token-b', 'token-a'],
            entries: [
              { tokenId: 'token-a', initiative: 10 },
              { tokenId: 'token-b', initiative: 5 },
            ],
          },
          changedTokenIds: [],
        }),
        scopes: [{ kind: 'map', lane: 'initiative' }],
      }],
    })

    expect(manualResult).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(map.initiative).toEqual({
      activeId: 'token-b',
      round: 1,
      manualOrderIds: ['token-b', 'token-a'],
    })

    const clearResult = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 5,
      revision: 6,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE, {
          command: 'setInitiative',
          previous: {
            activeId: 'token-b',
            round: 1,
            manualOrderIds: ['token-b', 'token-a'],
            entries: [
              { tokenId: 'token-a', initiative: 10 },
              { tokenId: 'token-b', initiative: 5 },
            ],
          },
          current: {
            activeId: 'token-a',
            round: 2,
            entries: [
              { tokenId: 'token-a', initiative: 10 },
              { tokenId: 'token-b', initiative: 5 },
            ],
          },
          changedTokenIds: [],
        }),
        revision: 6,
        scopes: [{ kind: 'map', lane: 'initiative' }],
      }],
    })

    expect(clearResult).toMatchObject({ ok: true, applied: true, revision: 6 })
    expect(map.initiative).toEqual({ activeId: 'token-a', round: 2 })
    expect(map.initiative).not.toHaveProperty('manualOrderIds')
  })

  it('applies tracked move usage patches and appends move log metadata', () => {
    const map = baseMap()

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE, {
          placementId: 'token-a',
          moveName: 'Thunderbolt',
          moveKey: 'thunderbolt',
          frequency: 'scene',
          tracking: 'map',
          usage: { uses: 1 },
          moveLogEntry: {
            at: 400,
            userId: 'token-a',
            userName: 'Pika',
            moveName: 'Thunderbolt',
            lines: ['Pika used Thunderbolt.', 'Frequency: Scene'],
          },
        }),
        scopes: [{ kind: 'token', placementId: 'token-a', field: 'moveUsage' }],
      }],
    })

    expect(result.ok).toBe(true)
    expect(map.moveUsage?.byPlacementId['token-a']?.thunderbolt).toMatchObject({
      moveName: 'Thunderbolt',
      frequency: 'scene',
      uses: 1,
    })
    expect(map.metadata?.moveLog).toEqual([
      expect.objectContaining({ userId: 'token-a', moveName: 'Thunderbolt' }),
    ])
  })

  it('appends move log metadata for sheet-tracked move usage patches', () => {
    const map = baseMap()

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE, {
          placementId: 'token-a',
          moveName: 'Rest',
          moveKey: 'rest',
          frequency: 'daily',
          tracking: 'sheet',
          moveLogEntry: {
            at: 450,
            userId: 'token-a',
            userName: 'Pika',
            moveName: 'Rest',
            lines: ['Pika used Rest.', 'Frequency: Daily'],
          },
        }),
        scopes: [{ kind: 'token', placementId: 'token-a', field: 'moveUsage' }],
      }],
    })

    expect(result.ok).toBe(true)
    expect(map.moveUsage).toBeUndefined()
    expect(map.metadata?.moveLog).toEqual([
      expect.objectContaining({ userId: 'token-a', moveName: 'Rest' }),
    ])
  })

  it('applies daily move usage patches to the current map Scene bucket', () => {
    const map = baseMap({ activeScene: { name: 'Moonlit Rooftop', startedAt: 200 } })

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE, {
          placementId: 'token-a',
          moveName: 'Rest',
          moveKey: 'rest',
          frequency: 'Daily x2',
          frequencyKind: 'daily',
          tracking: 'sheet',
          usage: { uses: 1, sceneUses: 1 },
          moveLogEntry: {
            at: 450,
            userId: 'token-a',
            userName: 'Pika',
            moveName: 'Rest',
            lines: ['Pika used Rest.', 'Frequency: Daily x2'],
          },
        }),
        scopes: [{ kind: 'token', placementId: 'token-a', field: 'moveUsage' }],
      }],
    })

    expect(result.ok).toBe(true)
    expect(map.moveUsage).toEqual({
      scene: { name: 'Moonlit Rooftop', startedAt: 200 },
      byPlacementId: {
        'token-a': {
          rest: { moveName: 'Rest', frequency: 'daily', uses: 1 },
        },
      },
    })
  })

  it('applies terrain patches to one voxel cell', () => {
    const map = baseMap()
    const originalVoxels = map.voxels

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN, {
        command: 'buildTerrainVoxel',
        cell: { x: 1, y: 0, z: 1 },
        previous: null,
        current: { x: 1, y: 0, z: 1, materialId: 'shallow_water' },
      })],
    })

    expect(result).toMatchObject({ ok: true, applied: true, terrainChanged: true })
    expect(map.voxels).toBe(originalVoxels)
    expect(map.voxels).toEqual([
      { x: 0, y: 0, z: 0, materialId: 'meadow_grass' },
      { x: 1, y: 0, z: 1, materialId: 'shallow_water' },
    ])
  })

  it('applies terrain batch patches to changed voxel cells', () => {
    const map = baseMap()

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN, {
        command: 'editTerrainVoxels',
        changes: [
          {
            cell: { x: 0, y: 0, z: 0 },
            previous: { x: 0, y: 0, z: 0, materialId: 'meadow_grass' },
            current: null,
            removed: { x: 0, y: 0, z: 0, materialId: 'meadow_grass' },
          },
          {
            cell: { x: 2, y: 0, z: 2 },
            previous: null,
            current: { x: 2, y: 0, z: 2, materialId: 'shallow_water' },
            built: { x: 2, y: 0, z: 2, materialId: 'shallow_water' },
          },
        ],
      })],
    })

    expect(result).toMatchObject({ ok: true, applied: true, terrainChanged: true })
    expect(map.voxels).toEqual([{ x: 2, y: 0, z: 2, materialId: 'shallow_water' }])
  })

  it('applies single-cell hazard patches without replacing unrelated hazard cells', () => {
    const map = baseMap({
      hazards: [
        { kind: 'spikes', x: 1, y: 0, z: 2 },
        { kind: 'fire', x: 2, y: 0, z: 2 },
      ],
    })

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS, {
          command: 'removeHazard',
          cell: { x: 1, y: 0, z: 2 },
          previous: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
          current: [],
          removed: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
        }),
        scopes: [{ kind: 'map', lane: 'hazards' }],
      }],
    })

    expect(result).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(map.hazards).toEqual([{ kind: 'fire', x: 2, y: 0, z: 2 }])
  })

  it('applies sent-out Pokémon placement patches', () => {
    const map = baseMap()

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS, {
        command: 'sendOutPokemon',
        trainerId: 'token-b',
        placementId: 'sent-out-eevee',
        previous: null,
        current: {
          id: 'sent-out-eevee',
          sheetKind: 'pokemon',
          sheetSlug: 'eevee',
          position: { x: 3, y: 0, z: 2 },
          sideId: 'rivals',
          facing: 'south-east',
          turned: false,
        },
      })],
    })

    expect(result).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(map.placements.at(-1)).toMatchObject({
      id: 'sent-out-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 3, y: 0, z: 2 },
      sideId: 'rivals',
    })
  })

  it('replaces metadata patches so removed authoritative keys do not survive shallow merges', () => {
    const map = baseMap({
      metadata: {
        keep: 'yes',
        attackOfOpportunity: {
          schemaVersion: 1,
          prompts: [{ id: 'old-prompt' }],
          usedRoundByAttackerId: {},
        },
        activeOrderEffects: [{ id: 'expired-order' }],
      },
    })

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MAP_METADATA, {
        command: 'nextInitiative',
        previous: map.metadata,
        current: { keep: 'yes' },
        clearedAttackOfOpportunityPromptIds: ['old-prompt'],
        expiredOrderEffectIds: ['expired-order'],
        progressedOrderEffectIds: [],
      })],
    })

    expect(result).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(map.metadata).toEqual({ keep: 'yes' })
  })

  it('applies active scene patches and clears combat log metadata', () => {
    const map = baseMap({
      metadata: {
        encounterName: 'Rooftop Ambush',
        moveLog: [{ at: 100, userName: 'Pika', moveName: 'Thunderbolt', lines: ['Pika used Thunderbolt.'] }],
        movementLog: [{ at: 110, userName: 'Pika', actionName: 'Movement', lines: ['Pika moved.'] }],
      },
    })

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.MAP_SCENE, {
          command: 'setScene',
          previous: null,
          current: { name: 'Moonlit Rooftop', startedAt: 200 },
        }),
        scopes: [{ kind: 'map', lane: 'scene' }],
      }],
    })

    expect(result).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(map.activeScene).toEqual({ name: 'Moonlit Rooftop', startedAt: 200 })
    expect(map.metadata).toEqual({ encounterName: 'Rooftop Ambush' })
  })

  it('applies MOVE_STATE patches as authoritative committed map lanes without mutating the payload', () => {
    const map = baseMap()
    const nextPlacements = [
      { ...map.placements[0]!, position: { x: 4, y: 0, z: 3 }, facing: 'north-east' as const, turned: false },
      map.placements[1]!,
    ]
    const payload = {
      command: 'resolveMove',
      updatedAt: 999,
      move: {
        schemaVersion: 1,
        actorPlacementId: 'token-a',
        moveName: 'Tackle',
        canonicalMoveName: 'Tackle',
        moveKey: 'tackle',
        frequency: 'Scene',
        damageFormula: null,
        selectedTargetIds: ['token-b'],
        script: { kind: 'explicit', type: 'Normal' },
        transaction: {
          userId: 'token-a',
          userName: 'Pika',
          moveName: 'Tackle',
          scriptKind: 'explicit',
          scriptVersion: 1,
          attackedTargetIds: ['token-b'],
          hitTargetIds: ['token-b'],
          hpUpdates: [],
          conditionUpdates: [],
          combatStageUpdates: [],
          hazardsToAdd: [],
          fieldEffectsToApply: [],
          logLines: ['Pika used Tackle.'],
        },
      },
      presentation: {
        schemaVersion: 1,
        operationId: 'op_movepatch01',
        actorPlacementId: 'token-a',
        move: { name: 'Tackle', type: 'Normal' },
        attackedTargetIds: ['token-b'],
        hitTargetIds: ['token-b'],
        outcomeKind: 'hit',
      },
      sheets: [],
      changes: {
        placements: { previous: map.placements, current: nextPlacements },
        temporaryHitPoints: {
          previous: null,
          current: { scene: { name: 'Scene A', startedAt: 900 }, byPlacementId: { 'token-b': 5 } },
        },
        moveUsage: {
          previous: null,
          current: { byPlacementId: { 'token-a': { tackle: { moveName: 'Tackle', frequency: 'scene', uses: 1 } } } },
        },
        hazards: { previous: [], current: [{ kind: 'fire', x: 2, y: 0, z: 2 }] },
        fieldEffects: { previous: { weather: [], terrains: [], rooms: [] }, current: { weather: [{ kind: 'sunny', rounds: 2 }], terrains: [], rooms: [] } },
        metadata: { previous: null, current: { moveLog: [{ at: 999, lines: ['Pika used Tackle.'] }] } },
        initiative: {
          previous: { activeId: 'token-a', round: 1 },
          current: { activeId: 'token-b', round: 1, manualOrderIds: ['token-b', 'token-a'] },
        },
      },
    }
    const beforePayload = JSON.stringify(payload)

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MOVE_STATE, payload)],
    })

    expect(result).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(map).toMatchObject({ revision: 5, updatedAt: 999 })
    expect(map.placements).toEqual(nextPlacements)
    expect(map.temporaryHitPoints).toEqual({ scene: { name: 'Scene A', startedAt: 900 }, byPlacementId: { 'token-b': 5 } })
    expect(map.moveUsage?.byPlacementId['token-a']?.tackle).toMatchObject({ moveName: 'Tackle', frequency: 'scene', uses: 1 })
    expect(map.hazards).toEqual([{ kind: 'fire', x: 2, y: 0, z: 2 }])
    expect(map.fieldEffects).toEqual({ weather: [{ kind: 'sunny', rounds: 2 }], terrains: [], rooms: [] })
    expect(map.metadata).toEqual({ moveLog: [{ at: 999, lines: ['Pika used Tackle.'] }] })
    expect(map.initiative).toEqual({
      activeId: 'token-b',
      round: 1,
      manualOrderIds: ['token-b', 'token-a'],
    })
    expect(JSON.stringify(payload)).toBe(beforePayload)
  })

  it('applies MOVE_STATE optional state deletions and rejects malformed payloads', () => {
    const map = baseMap({
      temporaryHitPoints: { scene: { name: 'Scene A', startedAt: 1 }, byPlacementId: { 'token-a': 4 } },
      moveUsage: { byPlacementId: { 'token-a': { tackle: { moveName: 'Tackle', frequency: 'scene', uses: 1 } } } },
      metadata: { moveLog: [] },
    })
    const move = {
      schemaVersion: 1,
      actorPlacementId: 'token-a',
      moveName: 'Tackle',
      canonicalMoveName: 'Tackle',
      moveKey: 'tackle',
      frequency: null,
      damageFormula: null,
      selectedTargetIds: [],
      script: { type: 'Normal' },
      transaction: {
        userId: 'token-a',
        userName: 'Pika',
        moveName: 'Tackle',
        scriptKind: 'explicit',
        scriptVersion: 1,
        attackedTargetIds: [],
        hitTargetIds: [],
        hpUpdates: [],
        conditionUpdates: [],
        combatStageUpdates: [],
        hazardsToAdd: [],
        fieldEffectsToApply: [],
        logLines: ['Pika used Tackle.'],
      },
    }

    const deleted = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MOVE_STATE, {
        command: 'resolveMove',
        updatedAt: 1000,
        move,
        presentation: {
          schemaVersion: 1,
          operationId: 'op_movepatch02',
          actorPlacementId: 'token-a',
          move: { name: 'Tackle', type: 'Normal' },
          attackedTargetIds: [],
          hitTargetIds: [],
          outcomeKind: 'self',
        },
        sheets: [],
        changes: {
          temporaryHitPoints: { previous: map.temporaryHitPoints, current: null },
          moveUsage: { previous: map.moveUsage, current: null },
          metadata: { previous: map.metadata, current: null },
          initiative: { previous: { activeId: 'token-a', round: 1 }, current: null },
        },
      })],
    })

    expect(deleted).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(map.temporaryHitPoints).toBeUndefined()
    expect(map.moveUsage).toBeUndefined()
    expect(map.metadata).toBeUndefined()
    expect(map.initiative).toBeUndefined()

    const malformed = applyLivePlayPatchesToMap({
      map: baseMap(),
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MOVE_STATE, { command: 'resolveMove', move: { actorPlacementId: 'token-a' } })],
    })
    expect(malformed).toMatchObject({ ok: false, reason: 'invalid-patch' })
  })

  it('requests reconciliation for unknown patch types and revision gaps', () => {
    const unknown = applyLivePlayPatchesToMap({
      map: baseMap(),
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase('unknown.patch' as LivePlayPatch['type'], {})],
    })
    expect(unknown).toMatchObject({ ok: false, reason: 'unknown-patch' })

    const gap = applyLivePlayPatchesToMap({
      map: baseMap(),
      mapSlug: 'arena',
      previousRevision: 3,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.TOKEN_FACING, { placementId: 'token-a', facing: 'north-west' })],
    })
    expect(gap).toMatchObject({ ok: false, reason: 'revision-gap' })
  })
})
