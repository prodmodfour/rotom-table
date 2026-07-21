import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  AbilityTargetingResolutionError,
  resolveAuthoritativeAbilityTargets,
} from '../../server/domain/abilityAutomation/targeting'
import {
  AbilityTargetingValidationError,
  parseAbilityTargetingPredicate,
} from '#shared/abilityAutomation/targeting'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from '../../server/domain/abilityAutomation/sharedKernelExtensions'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'

const token = (id: string, x: number, z: number) => ({
  id, position: { x, y: 0, z }, base: 1, clearance: 1,
})
const placements = [
  { id: 'actor-token', position: { x: 2, y: 0, z: 2 }, sideId: 'red' },
  { id: 'ally-token', position: { x: 3, y: 0, z: 2 }, sideId: 'red' },
  { id: 'diagonal-token', position: { x: 3, y: 0, z: 3 }, sideId: 'blue' },
  { id: 'blocked-token', position: { x: 5, y: 0, z: 2 }, sideId: 'blue' },
  { id: 'far-token', position: { x: 8, y: 0, z: 2 }, sideId: 'red' },
]
const context = (): AuthoritativeAbilityContext => ({
  actor: { placement: placements[0], token: token('actor-token', 2, 2) },
  placements,
  tokens: [
    token('actor-token', 2, 2), token('ally-token', 3, 2),
    token('diagonal-token', 3, 3), token('blocked-token', 5, 2), token('far-token', 8, 2),
  ],
  sides: {
    red: { id: 'red', label: 'Red', status: 'active' },
    blue: { id: 'blue', label: 'Blue', status: 'active' },
  },
  map: {
    slug: 'targeting-arena', revision: 3,
    dimensions: { x: 10, y: 4, z: 10 },
    voxels: [{ x: 4, y: 0, z: 2, materialId: 'stone', blocksSight: true }],
    hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: createEmptyEncounterState(),
  },
} as unknown as AuthoritativeAbilityContext)

const policy = (overrides: Record<string, unknown> = {}) => ({
  kind: 'ability-targeting',
  relationship: 'any',
  willingness: 'any',
  excludeActor: true,
  minimumRange: 0,
  maximumRange: 10,
  visibility: 'ignored',
  lineOfSight: 'ignored',
  geometry: { kind: 'direct' },
  ...overrides,
})

describe('authoritative ability relationships, range, and geometry', () => {
  it('strictly registers targeting policy semantics', () => {
    const parsed = parseAbilityTargetingPredicate(policy())
    expect(parsed).toMatchObject({
      relationship: 'any', maximumRange: 10, geometry: { kind: 'direct' },
    })
    expect(ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY.resolve('predicate', 'ability-targeting'))
      .toMatchObject({ version: 1 })
    expect(() => parseAbilityTargetingPredicate({ ...policy(), rawTargetIds: ['enemy'] }))
      .toThrowError(AbilityTargetingValidationError)
  })

  it('combines authoritative range, ally relation, willingness, and visibility', () => {
    const result = resolveAuthoritativeAbilityTargets({
      context: context(),
      predicate: policy({
        relationship: 'ally', willingness: 'willing', maximumRange: 3, visibility: 'required',
      }),
      requestedPlacementIds: ['far-token', 'ally-token', 'diagonal-token'],
      visiblePlacementIds: ['actor-token', 'ally-token', 'diagonal-token', 'blocked-token'],
      willingnessDeclarations: [{ targetPlacementId: 'ally-token', willingness: 'willing' }],
    })
    expect(result.legalTargetPlacementIds).toEqual(['ally-token'])
    expect(result.eligibleTargetPlacementIds).toEqual(['ally-token'])
    expect(result.geometryEvaluations.find(value => value.placementId === 'far-token'))
      .toMatchObject({ reasonCode: 'target-geometry-out-of-range' })
    expect(result.predicateEvaluations.map(value => value.targetPlacementId)).toEqual([
      'far-token', 'ally-token', 'diagonal-token',
    ])
  })

  it('distinguishes cardinal footprint adjacency from diagonal adjacency', () => {
    const result = resolveAuthoritativeAbilityTargets({
      context: context(),
      predicate: policy({
        minimumRange: 1, maximumRange: 1,
        geometry: { kind: 'adjacent', cardinalOnly: true },
      }),
      requestedPlacementIds: ['ally-token', 'diagonal-token'],
    })
    expect(result.authoritativeCandidatePlacementIds).toEqual(['ally-token'])
    expect(result.eligibleTargetPlacementIds).toEqual(['ally-token'])
  })

  it('uses authoritative voxel and Barrier line of sight without trusting requested IDs', () => {
    const blocked = resolveAuthoritativeAbilityTargets({
      context: context(),
      predicate: policy({ relationship: 'enemy', lineOfSight: 'required' }),
      requestedPlacementIds: ['blocked-token', 'ally-token'],
    })
    expect(blocked.eligibleTargetPlacementIds).toEqual([])
    expect(blocked.geometryEvaluations.find(value => value.placementId === 'blocked-token'))
      .toMatchObject({ lineOfSight: false, reasonCode: 'target-geometry-line-of-sight-blocked' })
  })

  it('derives Burst and Cone cells and recipients from server geometry', () => {
    const burst = resolveAuthoritativeAbilityTargets({
      context: context(),
      predicate: policy({ geometry: { kind: 'area', templateKind: 'burst', size: 2, range: null } }),
      requestedPlacementIds: ['ally-token', 'diagonal-token', 'far-token'],
    })
    expect(burst.areaCells.length).toBeGreaterThan(0)
    expect(burst.authoritativeCandidatePlacementIds).toEqual(['ally-token', 'diagonal-token'])
    expect(burst.eligibleTargetPlacementIds).toEqual(['ally-token', 'diagonal-token'])

    const cone = resolveAuthoritativeAbilityTargets({
      context: context(),
      predicate: policy({ geometry: { kind: 'area', templateKind: 'cone', size: 3, range: null } }),
      requestedPlacementIds: ['ally-token', 'blocked-token'],
      direction: 'east',
    })
    expect(cone.authoritativeCandidatePlacementIds).toContain('ally-token')
    expect(() => resolveAuthoritativeAbilityTargets({
      context: context(),
      predicate: policy({ geometry: { kind: 'area', templateKind: 'cone', size: 3, range: null } }),
      requestedPlacementIds: [],
    })).toThrowError(AbilityTargetingResolutionError)
  })

  it('validates free-aim Ranged Blast centers against reviewed range', () => {
    const ranged = policy({
      geometry: { kind: 'area', templateKind: 'ranged-blast', size: 1, range: 3 },
    })
    expect(resolveAuthoritativeAbilityTargets({
      context: context(), predicate: ranged, requestedPlacementIds: ['blocked-token'],
      center: { x: 5, y: 0, z: 2 },
    }).areaCells.length).toBeGreaterThan(0)
    expect(() => resolveAuthoritativeAbilityTargets({
      context: context(), predicate: ranged, requestedPlacementIds: [],
      center: { x: 8, y: 0, z: 2 },
    })).toThrowError(/outside reviewed range/)
  })

  it('fails closed when required server visibility is absent or malformed', () => {
    const required = policy({ visibility: 'required' })
    expect(() => resolveAuthoritativeAbilityTargets({
      context: context(), predicate: required, requestedPlacementIds: [],
    })).toThrowError(/requires server vision/)
    expect(() => resolveAuthoritativeAbilityTargets({
      context: context(), predicate: required, requestedPlacementIds: [],
      visiblePlacementIds: ['made-up-token'],
    })).toThrowError(/invalid/)
  })
})
