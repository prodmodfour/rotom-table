import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterZone } from '#shared/moveAutomation/encounterZones'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, MapVoxelV2, SheetPlacement, TabletopMap } from '~/types/map'
import type { MovementCapabilitySpeeds } from '~/types/movement'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  resolveMovement,
  type AuthoritativeMovementSheets,
  type ResolveMovementInput,
  type ResolvePassMovementInput,
} from '~~/server/domain/movement/resolveMovement'
import {
  advanceEncounterGlobalFields,
  createEncounterGlobalFieldZone,
} from '~~/server/domain/moveAutomation/fieldLifecycle'
import { activeEquipmentState } from '../fixtures/equipment'

const pokemonSheet = (
  slug: string,
  options: {
    readonly species?: string
    readonly revision?: number
    readonly capabilities?: MovementCapabilitySpeeds
  } = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: options.species ?? 'Bulbasaur',
  level: 10,
  revision: options.revision ?? 1,
  capabilities: options.capabilities,
})

const placement = (
  id: string,
  x: number,
  z: number,
  sheetSlug = id,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z },
})

const map = (
  placements: readonly SheetPlacement[] = [placement('actor', 0, 0)],
  overrides: Partial<TabletopMap> = {},
): TabletopMap => ({
  schemaVersion: 2,
  slug: 'movement-arena',
  name: 'Movement Arena',
  revision: 7,
  dimensions: { x: 8, y: 4, z: 8 },
  groundLevelY: 0,
  voxels: [],
  placements: [...placements],
  ...overrides,
})

const sheets = (
  pokemon: readonly CharacterSheet[],
): AuthoritativeMovementSheets => ({
  pokemon: new Map(pokemon.map(sheet => [sheet.slug, sheet])),
  trainer: new Map<string, TrainerSheet>(),
})

const input = (options: {
  readonly map?: TabletopMap
  readonly sheets?: AuthoritativeMovementSheets
  readonly placementId?: string
  readonly destination?: { readonly x: number; readonly y: number; readonly z: number }
  readonly policy?: ResolveMovementInput['policy']
} = {}): ResolveMovementInput => ({
  map: options.map ?? map(),
  sheets: options.sheets ?? sheets([
    pokemonSheet('actor', { capabilities: { overland: 6, swim: 0, sky: 0, levitate: 0 } }),
  ]),
  placementId: options.placementId ?? 'actor',
  mode: 'shift',
  destination: options.destination ?? { x: 2, y: 0, z: 2 },
  ...(options.policy === undefined ? {} : { policy: options.policy }),
})

const passInput = (options: {
  readonly map?: TabletopMap
  readonly sheets?: AuthoritativeMovementSheets
  readonly placementId?: string
  readonly direction?: ResolvePassMovementInput['direction']
  readonly maximumDistance?: number
} = {}): ResolvePassMovementInput => ({
  map: options.map ?? map(),
  sheets: options.sheets ?? sheets([
    pokemonSheet('actor', { capabilities: { overland: 6, swim: 0, sky: 0, levitate: 0 } }),
  ]),
  placementId: options.placementId ?? 'actor',
  mode: 'pass',
  direction: options.direction ?? 'east',
  maximumDistance: options.maximumDistance ?? 4,
})

const wall = (x: number, z: number): MapVoxelV2 => ({
  x,
  y: 0,
  z,
  materialId: 'airship_wall_bulkhead',
})

const barrier = (x: number, z: number) => parseEncounterZone({
  id: `zone.barrier.${x}-${z}`,
  kind: 'barrier',
  source: {
    kind: 'operation',
    operationId: `operation.barrier.${x}-${z}`,
    moveId: 'barrier',
    placementId: 'actor',
  },
  sideId: null,
  geometry: { kind: 'cells', cells: [{ x, y: 0, z }] },
  layer: 1,
  duration: { kind: 'scene', remaining: null },
  stacking: { kind: 'independent', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['barrier'],
  payload: { barrierId: 'barrier' },
})

describe('authoritative movement oracle', () => {
  it('applies hash-current static equipment capability contributions', () => {
    const trainer: TrainerSheet = {
      slug: 'runner', name: 'Runner', level: 10,
      capabilities: { overland: 5 },
      equipmentState: activeEquipmentState({
        ownerKind: 'trainer', ownerSlug: 'runner', slotId: 'feet', canonicalItemId: 'Running Shoes',
      }),
    }
    const trainerPlacement: SheetPlacement = {
      id: 'runner', sheetKind: 'trainer', sheetSlug: 'runner', position: { x: 0, y: 0, z: 0 },
    }
    const result = resolveMovement(input({
      map: map([trainerPlacement]),
      sheets: { pokemon: new Map(), trainer: new Map([['runner', trainer]]) },
      placementId: 'runner',
      destination: { x: 5, y: 0, z: 0 },
    }))

    expect(result).toMatchObject({ ok: true, capabilityLimit: 6, effectiveLimit: 6 })
    if (result.ok) expect(result.capabilities.used).toContainEqual({
      key: 'overland', label: 'Overland', speed: 6,
    })
  })

  it('applies contextual Snow Boots and Flippers speeds to the traversed terrain', () => {
    const trainerPlacement: SheetPlacement = {
      id: 'terrain-runner', sheetKind: 'trainer', sheetSlug: 'terrain-runner', position: { x: 0, y: 0, z: 0 },
    }
    const trainerWith = (canonicalItemId: 'Snow Boots' | 'Flippers'): TrainerSheet => ({
      slug: 'terrain-runner', name: 'Terrain Runner', level: 10,
      capabilities: { overland: 5, swim: 2 },
      equipmentState: activeEquipmentState({
        ownerKind: 'trainer', ownerSlug: 'terrain-runner', slotId: 'feet', canonicalItemId,
      }),
    })
    const snow = resolveMovement(input({
      map: map([trainerPlacement], {
        dimensions: { x: 8, y: 4, z: 8 },
        voxels: Array.from({ length: 5 }, (_, index) => ({
          x: index + 1, y: 0, z: 0, materialId: 'snow',
          blocksMovement: false, tags: ['basic-terrain', 'snow'],
        })),
      }),
      sheets: { pokemon: new Map(), trainer: new Map([['terrain-runner', trainerWith('Snow Boots')]]) },
      placementId: 'terrain-runner',
      destination: { x: 5, y: 0, z: 0 },
    }))
    expect(snow).toMatchObject({
      ok: false, reasonCode: 'movement-cost-exceeds-limit', capabilityLimit: 4, effectiveLimit: 4,
    })

    const submerged = resolveMovement(input({
      map: map([trainerPlacement], {
        dimensions: { x: 8, y: 4, z: 8 },
        voxels: Array.from({ length: 4 }, (_, index) => ({
          x: index + 1, y: 0, z: 0, materialId: 'deep_water',
        })),
      }),
      sheets: { pokemon: new Map(), trainer: new Map([['terrain-runner', trainerWith('Flippers')]]) },
      placementId: 'terrain-runner',
      destination: { x: 4, y: 0, z: 0 },
    }))
    expect(submerged).toMatchObject({
      ok: true, capabilityLimit: 4, effectiveLimit: 4,
      capabilities: { used: [{ key: 'swim', label: 'Swim', speed: 4 }] },
    })
  })

  it('derives path, PTU cost, capabilities, terrain, occupancy, and triggering steps', () => {
    const result = resolveMovement(input())

    expect(result).toMatchObject({
      ok: true,
      reasonCode: 'movement-legal',
      placementId: 'actor',
      mode: 'shift',
      policy: {
        kind: 'standard',
        allowSamePosition: false,
        maximumCost: null,
      },
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 2, y: 0, z: 2 },
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 1 },
        { x: 2, y: 0, z: 2 },
      ],
      cost: 3,
      capabilityLimit: 6,
      effectiveLimit: 6,
      footprint: { base: 1, clearance: 1 },
      collision: null,
      consultedPlacementIds: ['actor'],
      sheetReads: [{ kind: 'pokemon', slug: 'actor', revision: 1 }],
    })
    if (!result.ok) throw new Error('expected legal authoritative movement')

    expect(result.capabilities.used).toEqual([
      { key: 'overland', label: 'Overland', speed: 6 },
    ])
    expect(result.occupancy).toEqual({
      originCells: [{ x: 0, y: 0, z: 0 }],
      destinationCells: [{ x: 2, y: 0, z: 2 }],
      checkedPlacementIds: [],
    })
    expect(result.triggeringSteps).toEqual([
      {
        index: 1,
        from: { x: 0, y: 0, z: 0 },
        to: { x: 1, y: 0, z: 1 },
        cost: 1,
        cumulativeCost: 1,
        diagonal: true,
        slowCostApplied: false,
        capabilities: [{ key: 'overland', label: 'Overland', speed: 6 }],
        terrain: {
          requirements: ['overland'],
          slow: false,
          air: false,
          airHeight: 0,
          hoverable: true,
        },
        leftAdjacentPlacementIds: [],
        leftCells: [{ x: 0, y: 0, z: 0 }],
        enteredCells: [{ x: 1, y: 0, z: 1 }],
        finalDestination: false,
      },
      {
        index: 2,
        from: { x: 1, y: 0, z: 1 },
        to: { x: 2, y: 0, z: 2 },
        cost: 2,
        cumulativeCost: 3,
        diagonal: true,
        slowCostApplied: false,
        capabilities: [{ key: 'overland', label: 'Overland', speed: 6 }],
        terrain: {
          requirements: ['overland'],
          slow: false,
          air: false,
          airHeight: 0,
          hoverable: true,
        },
        leftAdjacentPlacementIds: [],
        leftCells: [{ x: 1, y: 0, z: 1 }],
        enteredCells: [{ x: 2, y: 0, z: 2 }],
        finalDestination: true,
      },
    ])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.path)).toBe(true)
    expect(Object.isFrozen(result.triggeringSteps[0]?.terrain)).toBe(true)
  })

  it('records the exact step where authoritative footprint adjacency is lost', () => {
    const arena = map([
      placement('actor', 0, 1),
      placement('defender', 0, 0),
    ], { dimensions: { x: 5, y: 2, z: 4 } })
    const result = resolveMovement(input({
      map: arena,
      sheets: sheets([
        pokemonSheet('actor', { capabilities: { overland: 6 } }),
        pokemonSheet('defender'),
      ]),
      destination: { x: 2, y: 0, z: 1 },
    }))

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error('expected legal adjacency-leaving movement')
    expect(result.triggeringSteps.map(step => ({
      index: step.index,
      leftAdjacentPlacementIds: step.leftAdjacentPlacementIds,
    }))).toEqual([
      { index: 1, leftAdjacentPlacementIds: [] },
      { index: 2, leftAdjacentPlacementIds: ['defender'] },
    ])
    expect(Object.isFrozen(result.triggeringSteps[1]?.leftAdjacentPlacementIds)).toBe(true)
  })

  it('derives a straight Pass destination, occupancy, and triggers while crossing placements', () => {
    const arena = map([
      placement('actor', 0, 1),
      placement('crossed', 1, 1),
      placement('occupied-end', 4, 1),
    ], {
      dimensions: { x: 7, y: 2, z: 3 },
    })
    const result = resolveMovement(passInput({
      map: arena,
      sheets: sheets([
        pokemonSheet('actor', { revision: 4, capabilities: { overland: 6 } }),
        pokemonSheet('crossed', { revision: 5 }),
        pokemonSheet('occupied-end', { revision: 6 }),
      ]),
    }))

    expect(result).toMatchObject({
      ok: true,
      reasonCode: 'movement-legal',
      mode: 'pass',
      policy: {
        kind: 'pass',
        direction: 'east',
        maximumCost: 4,
      },
      origin: { x: 0, y: 0, z: 1 },
      destination: { x: 3, y: 0, z: 1 },
      path: [
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
        { x: 3, y: 0, z: 1 },
      ],
      cost: 3,
      capabilityLimit: 6,
      effectiveLimit: 4,
      occupancy: {
        destinationCells: [{ x: 3, y: 0, z: 1 }],
        checkedPlacementIds: ['crossed', 'occupied-end'],
      },
      consultedPlacementIds: ['actor', 'crossed', 'occupied-end'],
      sheetReads: [
        { kind: 'pokemon', slug: 'actor', revision: 4 },
        { kind: 'pokemon', slug: 'crossed', revision: 5 },
        { kind: 'pokemon', slug: 'occupied-end', revision: 6 },
      ],
    })
    if (!result.ok) throw new Error('expected legal Pass movement')
    expect(result.triggeringSteps.map(step => step.enteredCells)).toEqual([
      [{ x: 1, y: 0, z: 1 }],
      [{ x: 2, y: 0, z: 1 }],
      [{ x: 3, y: 0, z: 1 }],
    ])
    expect(result.triggeringSteps.map(step => step.finalDestination)).toEqual([false, false, true])
    expect(Object.isFrozen(result.triggeringSteps)).toBe(true)
  })

  it('keeps Pass on its declared line and chooses the farthest capability-legal empty endpoint', () => {
    const blockedLine = resolveMovement(passInput({
      map: map([placement('actor', 0, 1)], {
        dimensions: { x: 6, y: 2, z: 4 },
        voxels: [wall(3, 1)],
      }),
    }))
    expect(blockedLine).toMatchObject({
      ok: true,
      destination: { x: 2, y: 0, z: 1 },
      path: [
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ],
    })

    const capabilityLimited = resolveMovement(passInput({
      sheets: sheets([
        pokemonSheet('actor', { capabilities: { overland: 2 } }),
      ]),
    }))
    expect(capabilityLimited).toMatchObject({
      ok: true,
      destination: { x: 2, y: 0, z: 0 },
      cost: 2,
      capabilityLimit: 2,
      effectiveLimit: 2,
    })
  })

  it('fails Pass when every endpoint is occupied and ignores forged endpoint/path hints', () => {
    const occupiedArena = map([
      placement('actor', 0, 0),
      ...[1, 2, 3, 4].map(x => placement(`blocker-${x}`, x, 0)),
    ], { dimensions: { x: 6, y: 2, z: 2 } })
    const occupiedSheets = sheets([
      pokemonSheet('actor', { capabilities: { overland: 6 } }),
      ...[1, 2, 3, 4].map(x => pokemonSheet(`blocker-${x}`)),
    ])
    expect(resolveMovement(passInput({ map: occupiedArena, sheets: occupiedSheets }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-destination-occupied',
    })

    const authoritative = passInput()
    const forged = resolveMovement({
      ...authoritative,
      destination: { x: 7, y: 0, z: 7 },
      path: [{ x: 7, y: 0, z: 7 }],
      cost: 0,
    } as ResolvePassMovementInput & { destination: GridAnchor; path: GridAnchor[]; cost: number })
    expect(forged).toMatchObject({
      ok: true,
      destination: { x: 4, y: 0, z: 0 },
      cost: 4,
    })
  })

  it('uses authoritative mixed capabilities and records slow terrain cost per step', () => {
    const actor = pokemonSheet('actor', {
      capabilities: { overland: 4, swim: 2, sky: 0, levitate: 0 },
    })
    const waterResult = resolveMovement(input({
      map: map(undefined, {
        dimensions: { x: 4, y: 2, z: 2 },
        voxels: [{ x: 1, y: 0, z: 0, materialId: 'deep_water' }],
      }),
      sheets: sheets([actor]),
      destination: { x: 2, y: 0, z: 0 },
    }))

    expect(waterResult).toMatchObject({
      ok: true,
      cost: 2,
      capabilityLimit: 3,
      capabilities: {
        used: [
          { key: 'overland', speed: 4 },
          { key: 'swim', speed: 2 },
        ],
      },
    })
    if (!waterResult.ok) throw new Error('expected mixed terrain movement')
    expect(waterResult.triggeringSteps[0]).toMatchObject({
      capabilities: [{ key: 'swim', speed: 2 }],
      terrain: { requirements: ['swim'] },
      slowCostApplied: false,
    })

    const slowResult = resolveMovement(input({
      map: map(undefined, {
        dimensions: { x: 3, y: 2, z: 2 },
        voxels: [{
          x: 1,
          y: 0,
          z: 0,
          materialId: 'mud',
          blocksMovement: false,
        }],
      }),
      sheets: sheets([actor]),
      destination: { x: 1, y: 0, z: 0 },
    }))

    expect(slowResult).toMatchObject({ ok: true, cost: 2 })
    if (!slowResult.ok) throw new Error('expected slow terrain movement')
    expect(slowResult.triggeringSteps).toEqual([
      expect.objectContaining({
        cost: 2,
        cumulativeCost: 2,
        slowCostApplied: true,
        terrain: expect.objectContaining({ slow: true }),
      }),
    ])
  })

  it('applies and removes Gravity grounding and aerial endpoint limits through the oracle', () => {
    const gravity = createEncounterGlobalFieldZone({
      kind: 'room',
      fieldId: 'gravity',
      source: {
        kind: 'operation',
        operationId: 'operation.gravity',
        moveId: 'move.gravity',
        placementId: 'actor',
      },
      sideId: null,
      duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      replacementGroup: 'field.room.gravity',
    })
    const activeMap = map(undefined, {
      encounterState: {
        ...createEmptyEncounterState(),
        zones: [gravity],
      },
    })
    const flyer = sheets([
      pokemonSheet('actor', {
        capabilities: { overland: 0, sky: 6, levitate: 0 },
      }),
    ])

    const allowedLowEndpoint = resolveMovement(input({
      map: activeMap,
      sheets: flyer,
      destination: { x: 0, y: 1, z: 0 },
    }))
    expect(allowedLowEndpoint).toMatchObject({
      ok: true,
      movementProfile: { state: { grounding: 'grounded' } },
      capabilities: { used: [{ key: 'sky', speed: 6 }] },
    })

    expect(resolveMovement(input({
      map: activeMap,
      sheets: flyer,
      destination: { x: 0, y: 2, z: 0 },
    }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-gravity-altitude-limit',
      destination: { x: 0, y: 2, z: 0 },
    })

    const expired = advanceEncounterGlobalFields({
      zones: [gravity],
      event: { kind: 'round-end' },
    })
    expect(expired.transitions).toEqual([
      expect.objectContaining({ zoneId: gravity.id, kind: 'expired' }),
    ])
    const afterExpiry = resolveMovement(input({
      map: {
        ...activeMap,
        encounterState: {
          ...activeMap.encounterState!,
          zones: expired.zones,
        },
      },
      sheets: flyer,
      destination: { x: 0, y: 2, z: 0 },
    }))
    expect(afterExpiry).toMatchObject({
      ok: true,
      destination: { x: 0, y: 2, z: 0 },
      movementProfile: { state: { grounding: 'airborne' } },
      capabilities: { used: [{ key: 'sky', speed: 6 }] },
    })
  })

  it('derives large-footprint occupancy transitions from authoritative sheet geometry', () => {
    const actor = pokemonSheet('actor', {
      species: 'Snorlax',
      revision: 4,
      capabilities: { overland: 6 },
    })
    const result = resolveMovement(input({
      map: map([placement('actor', 0, 1)], {
        dimensions: { x: 6, y: 3, z: 5 },
      }),
      sheets: sheets([actor]),
      destination: { x: 1, y: 0, z: 1 },
    }))

    expect(result).toMatchObject({
      ok: true,
      footprint: { base: 2, clearance: 2 },
      sheetReads: [{ kind: 'pokemon', slug: 'actor', revision: 4 }],
    })
    if (!result.ok) throw new Error('expected large-footprint movement')
    expect(result.occupancy.originCells).toHaveLength(8)
    expect(result.occupancy.destinationCells).toHaveLength(8)
    expect(result.triggeringSteps).toHaveLength(1)
    expect(result.triggeringSteps[0]?.leftCells).toHaveLength(4)
    expect(result.triggeringSteps[0]?.enteredCells).toHaveLength(4)
  })

  it('lets Amorphous squeeze through a tight route but requires its normal endpoint footprint', () => {
    const actor = pokemonSheet('actor', { species: 'Goodra', revision: 4 })
    const tightRoute = map([placement('actor', 0, 0)], {
      dimensions: { x: 6, y: 3, z: 2 },
      voxels: [wall(2, 1), wall(3, 1)],
    })
    const legal = resolveMovement(input({
      map: tightRoute,
      sheets: sheets([actor]),
      destination: { x: 4, y: 0, z: 0 },
    }))

    expect(legal).toMatchObject({
      ok: true,
      destination: { x: 4, y: 0, z: 0 },
      footprint: { base: 2, clearance: 2 },
      occupancy: {
        destinationCells: expect.arrayContaining([
          { x: 4, y: 0, z: 0 },
          { x: 5, y: 1, z: 1 },
        ]),
      },
    })

    const blockedEndpoint = resolveMovement(input({
      map: { ...tightRoute, voxels: [...tightRoute.voxels, wall(5, 1)] },
      sheets: sheets([actor]),
      destination: { x: 4, y: 0, z: 0 },
    }))
    expect(blockedEndpoint).toMatchObject({
      ok: false,
      reasonCode: 'movement-destination-terrain-blocked',
      footprint: { base: 2, clearance: 2 },
      collision: {
        kind: 'terrain',
        voxelCells: expect.arrayContaining([{ x: 5, y: 0, z: 1 }]),
      },
    })
  })

  it('returns typed endpoint collision failures with map-order evidence', () => {
    const arena = map([
      placement('actor', 0, 0),
      placement('first-blocker', 2, 0),
      placement('second-blocker', 2, 0),
    ])
    const result = resolveMovement(input({
      map: arena,
      sheets: sheets([
        pokemonSheet('actor', { capabilities: { overland: 6 } }),
        pokemonSheet('first-blocker', { revision: 2 }),
        pokemonSheet('second-blocker', { revision: 3 }),
      ]),
      destination: { x: 2, y: 0, z: 0 },
    }))

    expect(result).toMatchObject({
      ok: false,
      reasonCode: 'movement-destination-occupied',
      collision: {
        kind: 'placement',
        at: { x: 2, y: 0, z: 0 },
        placementIds: ['first-blocker', 'second-blocker'],
        voxelCells: [],
      },
      occupancy: {
        checkedPlacementIds: ['first-blocker', 'second-blocker'],
      },
      consultedPlacementIds: ['actor', 'first-blocker', 'second-blocker'],
      sheetReads: [
        { kind: 'pokemon', slug: 'actor', revision: 1 },
        { kind: 'pokemon', slug: 'first-blocker', revision: 2 },
        { kind: 'pokemon', slug: 'second-blocker', revision: 3 },
      ],
    })
  })

  it('distinguishes terrain, capability, route, bounds, and cost failures', () => {
    const walker = sheets([
      pokemonSheet('actor', {
        capabilities: { overland: 6, swim: 0, sky: 0, levitate: 0, burrow: 0 },
      }),
    ])

    expect(resolveMovement(input({
      map: map(undefined, { voxels: [wall(1, 0)] }),
      sheets: walker,
      destination: { x: 1, y: 0, z: 0 },
    }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-destination-terrain-blocked',
      collision: {
        kind: 'terrain',
        voxelCells: [{ x: 1, y: 0, z: 0 }],
      },
    })

    expect(resolveMovement(input({
      map: map(undefined, {
        encounterState: {
          ...createEmptyEncounterState(),
          zones: [barrier(1, 0)],
        },
      }),
      sheets: walker,
      destination: { x: 1, y: 0, z: 0 },
    }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-destination-terrain-blocked',
      collision: {
        kind: 'terrain',
        voxelCells: [{ x: 1, y: 0, z: 0 }],
      },
    })

    expect(resolveMovement(input({
      map: map(undefined, {
        voxels: [{ x: 1, y: 0, z: 0, materialId: 'deep_water' }],
      }),
      sheets: walker,
      destination: { x: 1, y: 0, z: 0 },
    }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-capability-missing',
      collision: null,
    })

    expect(resolveMovement(input({
      map: map(undefined, {
        dimensions: { x: 3, y: 2, z: 3 },
        voxels: [wall(1, 0), wall(1, 1), wall(1, 2)],
      }),
      sheets: walker,
      destination: { x: 2, y: 0, z: 1 },
    }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-route-blocked',
      collision: { kind: 'route', at: null },
    })

    expect(resolveMovement(input({
      sheets: walker,
      destination: { x: 8, y: 0, z: 0 },
    }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-destination-out-of-bounds',
      collision: { kind: 'bounds' },
    })

    expect(resolveMovement(input({
      sheets: walker,
      destination: { x: 2, y: 0, z: 0 },
      policy: { kind: 'standard', maximumCost: 1 },
    }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-cost-exceeds-limit',
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      cost: 2,
      capabilityLimit: 6,
      effectiveLimit: 1,
      collision: null,
    })
  })

  it('lets an explicit GM policy replace only the capability-speed ceiling', () => {
    const slowActor = sheets([
      pokemonSheet('actor', { capabilities: { overland: 1, swim: 0, sky: 0, levitate: 0 } }),
    ])
    const standard = resolveMovement(input({
      sheets: slowActor,
      destination: { x: 4, y: 0, z: 0 },
    }))
    const overridden = resolveMovement(input({
      sheets: slowActor,
      destination: { x: 4, y: 0, z: 0 },
      policy: { kind: 'gm-override' },
    }))

    expect(standard).toMatchObject({
      ok: false,
      reasonCode: 'movement-cost-exceeds-limit',
      capabilityLimit: 1,
    })
    expect(overridden).toMatchObject({
      ok: true,
      policy: {
        kind: 'gm-override',
        allowSamePosition: false,
        maximumCost: 1_000,
      },
      cost: 4,
      capabilityLimit: 1,
      effectiveLimit: 1_000,
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
    })

    expect(resolveMovement(input({
      map: map(undefined, {
        dimensions: { x: 5, y: 2, z: 2 },
        voxels: [wall(1, 0), wall(1, 1)],
      }),
      sheets: slowActor,
      destination: { x: 4, y: 0, z: 0 },
      policy: { kind: 'gm-override' },
    }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-route-blocked',
    })
  })

  it('fails closed for missing, duplicate, unresolved, malformed, and no-op inputs', () => {
    expect(resolveMovement(input({ placementId: 'missing' }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-placement-missing',
    })

    const duplicated = placement('actor', 1, 0)
    expect(resolveMovement(input({
      map: map([placement('actor', 0, 0), duplicated]),
    }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-placement-duplicate',
    })

    expect(resolveMovement(input({
      sheets: sheets([]),
    }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-placement-unresolved',
    })

    expect(resolveMovement(input({
      destination: { x: 0.5, y: 0, z: 0 },
    }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-destination-invalid',
    })

    expect(resolveMovement(input({
      destination: { x: 0, y: 0, z: 0 },
    }))).toMatchObject({
      ok: false,
      reasonCode: 'movement-same-position-disallowed',
    })

    expect(resolveMovement(input({
      destination: { x: 0, y: 0, z: 0 },
      policy: { kind: 'standard', allowSamePosition: true },
    }))).toMatchObject({
      ok: true,
      cost: 0,
      path: [{ x: 0, y: 0, z: 0 }],
      triggeringSteps: [],
    })
  })

  it('breaks equal-cost path ties deterministically and ignores client-style path or cost fields', () => {
    const arena = map([
      placement('actor', 0, 1),
      placement('blocker', 1, 1),
    ], {
      dimensions: { x: 4, y: 2, z: 4 },
    })
    const authoritativeInput = input({
      map: arena,
      sheets: sheets([
        pokemonSheet('actor', { capabilities: { overland: 8 } }),
        pokemonSheet('blocker'),
      ]),
      destination: { x: 2, y: 0, z: 1 },
    })

    const first = resolveMovement(authoritativeInput)
    const second = resolveMovement(authoritativeInput)
    const forged = resolveMovement({
      ...authoritativeInput,
      path: [{ x: 99, y: 99, z: 99 }],
      cost: 0,
    } as ResolveMovementInput & { path: unknown; cost: number })

    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
    expect(forged).toEqual(first)
    if (!first.ok) throw new Error('expected deterministic movement route')
    expect(first.path).toEqual([
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 2 },
      { x: 2, y: 0, z: 1 },
    ])
  })
})
