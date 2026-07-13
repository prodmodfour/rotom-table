import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, MapVoxelV2, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  footprintsOverlap,
  gridFootprintCells,
  isAnchorWithinBounds,
} from '~/utils/gridGeometry'
import {
  resolveAuthoritativeDisplacement,
  type AuthoritativeMovementSheets,
  type ResolveAuthoritativeDisplacementInput,
} from '~~/server/domain/movement/resolveMovement'
import { createDeterministicPropertyGenerator } from '../fixtures/moveAutomation/mechanicsProperties'

const placement = (
  id: string,
  position: GridAnchor,
  sheetSlug = id,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position,
})

const pokemonSheet = (
  slug: string,
  options: {
    readonly species?: string
    readonly revision?: number
    readonly capabilities?: NonNullable<CharacterSheet['capabilities']>
  } = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: options.species ?? 'Bulbasaur',
  level: 20,
  revision: options.revision ?? 1,
  capabilities: options.capabilities ?? { overland: 8 },
})

const sheets = (...pokemon: readonly CharacterSheet[]): AuthoritativeMovementSheets => ({
  pokemon: new Map(pokemon.map(sheet => [sheet.slug, sheet])),
  trainer: new Map<string, TrainerSheet>(),
})

const mapFixture = (options: {
  readonly placements?: readonly SheetPlacement[]
  readonly dimensions?: TabletopMap['dimensions']
  readonly voxels?: readonly MapVoxelV2[]
} = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'displacement-arena',
  name: 'Displacement Arena',
  revision: 7,
  dimensions: options.dimensions ?? { x: 8, y: 4, z: 8 },
  groundLevelY: 0,
  voxels: [...(options.voxels ?? [])],
  placements: [...(options.placements ?? [placement('actor', { x: 1, y: 0, z: 1 })])],
})

const wall = (x: number, y: number, z: number): MapVoxelV2 => ({
  x,
  y,
  z,
  materialId: 'airship_wall_bulkhead',
})

const input = (options: Partial<ResolveAuthoritativeDisplacementInput> = {}): ResolveAuthoritativeDisplacementInput => ({
  map: options.map ?? mapFixture(),
  sheets: options.sheets ?? sheets(pokemonSheet('actor')),
  placementId: options.placementId ?? 'actor',
  movementMode: options.movementMode ?? 'forced',
  vector: options.vector ?? { x: 1, y: 0, z: 0 },
  requestedDistance: options.requestedDistance ?? 4,
  distancePolicy: options.distancePolicy ?? 'up-to-distance',
})

describe('authoritative displacement oracle', () => {
  it('stops an up-to ray at bounds and rejects the same shortened full-distance ray', () => {
    const authoritative = input({
      map: mapFixture({
        dimensions: { x: 6, y: 3, z: 4 },
        placements: [placement('actor', { x: 3, y: 0, z: 1 })],
      }),
      requestedDistance: 5,
    })
    const upTo = resolveAuthoritativeDisplacement(authoritative)

    expect(upTo).toMatchObject({
      ok: true,
      reasonCode: 'displacement-legal',
      origin: { x: 3, y: 0, z: 1 },
      destination: { x: 5, y: 0, z: 1 },
      path: [
        { x: 3, y: 0, z: 1 },
        { x: 4, y: 0, z: 1 },
        { x: 5, y: 0, z: 1 },
      ],
      requestedDistance: 5,
      resolvedDistance: 2,
      shortened: true,
      shorteningReason: 'map-bounds',
      obstruction: {
        reason: 'map-bounds',
        at: { x: 6, y: 0, z: 1 },
        collision: { kind: 'bounds' },
      },
      consultedPlacementIds: ['actor'],
      sheetReads: [{ kind: 'pokemon', slug: 'actor', revision: 1 }],
    })

    const full = resolveAuthoritativeDisplacement({
      ...authoritative,
      distancePolicy: 'full-distance-required',
    })
    expect(full).toMatchObject({
      ok: false,
      reasonCode: 'displacement-full-distance-unavailable',
      partial: {
        destination: { x: 5, y: 0, z: 1 },
        resolvedDistance: 2,
        shorteningReason: 'map-bounds',
      },
    })
    expect(Object.isFrozen(full)).toBe(true)
    if (full.ok) throw new Error('Expected full-distance displacement to reject.')
    expect(Object.isFrozen(full.partial?.path)).toBe(true)
  })

  it('distinguishes blocking voxels, occupied footprints, height changes, and unavailable modes', () => {
    const blocking = resolveAuthoritativeDisplacement(input({
      map: mapFixture({ voxels: [wall(3, 0, 1)] }),
    }))
    expect(blocking).toMatchObject({
      ok: true,
      destination: { x: 2, y: 0, z: 1 },
      shorteningReason: 'blocking-terrain',
      obstruction: {
        at: { x: 3, y: 0, z: 1 },
        collision: {
          kind: 'terrain',
          voxelCells: [{ x: 3, y: 0, z: 1 }],
        },
      },
    })

    const occupied = resolveAuthoritativeDisplacement(input({
      map: mapFixture({
        placements: [
          placement('actor', { x: 1, y: 0, z: 1 }),
          placement('blocker', { x: 3, y: 0, z: 1 }),
        ],
      }),
      sheets: sheets(pokemonSheet('actor'), pokemonSheet('blocker', { revision: 2 })),
    }))
    expect(occupied).toMatchObject({
      ok: true,
      destination: { x: 2, y: 0, z: 1 },
      shorteningReason: 'occupied-footprint',
      obstruction: {
        collision: { kind: 'placement', placementIds: ['blocker'] },
      },
      consultedPlacementIds: ['actor', 'blocker'],
    })

    const height = resolveAuthoritativeDisplacement(input({
      map: mapFixture({
        placements: [placement('actor', { x: 1, y: 1, z: 1 })],
        voxels: [wall(1, 0, 1)],
      }),
    }))
    expect(height).toMatchObject({
      ok: true,
      destination: { x: 1, y: 1, z: 1 },
      resolvedDistance: 0,
      shorteningReason: 'height-change',
      obstruction: {
        at: { x: 2, y: 1, z: 1 },
        terrainRequirements: ['aerial'],
      },
    })

    const unavailableMode = resolveAuthoritativeDisplacement(input({
      map: mapFixture({
        voxels: [{ x: 3, y: 0, z: 1, materialId: 'deep_water' }],
      }),
      sheets: sheets(pokemonSheet('actor', {
        species: 'Diglett',
        capabilities: { overland: 8 },
      })),
    }))
    expect(unavailableMode).toMatchObject({
      ok: true,
      destination: { x: 2, y: 0, z: 1 },
      shorteningReason: 'movement-mode-unavailable',
      obstruction: {
        at: { x: 3, y: 0, z: 1 },
        terrainRequirements: ['swim'],
      },
    })
  })

  it('allows authoritative traversal modes without applying their speed as a move-distance ceiling', () => {
    const result = resolveAuthoritativeDisplacement(input({
      map: mapFixture({
        dimensions: { x: 7, y: 3, z: 3 },
        voxels: [
          { x: 2, y: 0, z: 1, materialId: 'deep_water' },
          { x: 3, y: 0, z: 1, materialId: 'deep_water' },
          { x: 4, y: 0, z: 1, materialId: 'deep_water' },
        ],
      }),
      sheets: sheets(pokemonSheet('actor', {
        capabilities: { overland: 1, swim: 1 },
      })),
      requestedDistance: 4,
      distancePolicy: 'full-distance-required',
      movementMode: 'voluntary',
    }))

    expect(result).toMatchObject({
      ok: true,
      destination: { x: 5, y: 0, z: 1 },
      resolvedDistance: 4,
      shortened: false,
      shorteningReason: 'none',
    })
  })

  it('fails closed for forged modes, policies, vectors, and distances', () => {
    expect(resolveAuthoritativeDisplacement({
      ...input(),
      movementMode: 'teleport',
    } as unknown as ResolveAuthoritativeDisplacementInput)).toMatchObject({
      ok: false,
      reasonCode: 'displacement-mode-unsupported',
    })
    expect(resolveAuthoritativeDisplacement({
      ...input(),
      distancePolicy: 'ignore-obstructions',
    } as unknown as ResolveAuthoritativeDisplacementInput)).toMatchObject({
      ok: false,
      reasonCode: 'displacement-policy-invalid',
    })
    expect(resolveAuthoritativeDisplacement({
      ...input(),
      vector: { x: 2, y: 0, z: 0 },
    })).toMatchObject({
      ok: false,
      reasonCode: 'displacement-vector-invalid',
    })
    expect(resolveAuthoritativeDisplacement({
      ...input(),
      requestedDistance: 1_001,
    })).toMatchObject({
      ok: false,
      reasonCode: 'displacement-distance-invalid',
    })
  })

  it('never emits an out-of-bounds or overlapping path over generated bounded arenas', () => {
    const generated = createDeterministicPropertyGenerator(0x0127_0001)
    const vectors = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: -1 },
      { x: -1, y: 0, z: 1 },
      { x: -1, y: 0, z: -1 },
    ] as const

    for (let caseIndex = 0; caseIndex < 192; caseIndex += 1) {
      const actorSpecies = generated.pick(['Bulbasaur', 'Snorlax'] as const)
      const actorBase = actorSpecies === 'Snorlax' ? 2 : 1
      const dimensions = {
        x: generated.integer(actorBase + 3, 16),
        y: 3,
        z: generated.integer(actorBase + 3, 16),
      }
      const origin = {
        x: generated.integer(0, dimensions.x - actorBase),
        y: 0,
        z: generated.integer(0, dimensions.z - actorBase),
      }
      const blockerAnchors: GridAnchor[] = []
      for (let z = 0; z < dimensions.z; z += 1) {
        for (let x = 0; x < dimensions.x; x += 1) {
          const candidate = { x, y: 0, z }
          if (!footprintsOverlap(
            origin,
            actorBase,
            actorBase,
            candidate,
            1,
            1,
          )) blockerAnchors.push(candidate)
        }
      }
      const blocker = generated.pick(blockerAnchors)
      const wallCandidates = blockerAnchors.filter(candidate => (
        candidate.x !== blocker.x || candidate.z !== blocker.z
      ))
      const wallCell = generated.pick(wallCandidates.length ? wallCandidates : blockerAnchors)
      const arena = mapFixture({
        dimensions,
        placements: [
          placement('actor', origin),
          placement('blocker', blocker),
        ],
        voxels: generated.integer(0, 1) === 1
          ? [wall(wallCell.x, wallCell.y, wallCell.z)]
          : [],
      })
      const authoritative = input({
        map: arena,
        sheets: sheets(
          pokemonSheet('actor', { species: actorSpecies, capabilities: { overland: 8 } }),
          pokemonSheet('blocker'),
        ),
        vector: generated.pick(vectors),
        requestedDistance: generated.integer(0, 24),
        movementMode: generated.pick(['forced', 'voluntary'] as const),
      })
      const upTo = resolveAuthoritativeDisplacement(authoritative)
      expect(upTo.ok, `generated displacement case ${caseIndex}`).toBe(true)
      if (!upTo.ok) continue

      expect(upTo.path[0]).toEqual(origin)
      expect(upTo.destination).toEqual(upTo.path.at(-1))
      expect(upTo.resolvedDistance).toBeLessThanOrEqual(upTo.requestedDistance)
      for (const anchor of upTo.path) {
        expect(
          isAnchorWithinBounds(anchor, { base: actorBase, clearance: actorBase }, dimensions),
          `bounds case ${caseIndex} at ${JSON.stringify(anchor)}`,
        ).toBe(true)
        expect(footprintsOverlap(
          anchor,
          actorBase,
          actorBase,
          blocker,
          1,
          1,
        ), `occupancy case ${caseIndex} at ${JSON.stringify(anchor)}`).toBe(false)
        const occupiedKeys = new Set(
          gridFootprintCells(anchor, { base: actorBase, clearance: actorBase })
            .map(cell => `${cell.x},${cell.y},${cell.z}`),
        )
        expect(occupiedKeys.has(`${wallCell.x},${wallCell.y},${wallCell.z}`)
          && arena.voxels.length > 0, `voxel case ${caseIndex}`).toBe(false)
      }

      const full = resolveAuthoritativeDisplacement({
        ...authoritative,
        distancePolicy: 'full-distance-required',
      })
      expect(full.ok, `full-distance symmetry case ${caseIndex}`).toBe(!upTo.shortened)
      if (!full.ok) {
        expect(full.reasonCode).toBe('displacement-full-distance-unavailable')
        expect(full.partial?.path).toEqual(upTo.path)
      }
    }
  })
})
