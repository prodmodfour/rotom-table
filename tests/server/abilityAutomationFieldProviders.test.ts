import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import { planAuthoritativeAbilityFieldProviders } from '../../server/domain/abilityAutomation/fieldProviders'
import {
  AbilityFieldProviderValidationError,
  parseAbilityFieldProviders,
} from '#shared/abilityAutomation/fieldProviders'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { SAND_TOMB_VORTEX_DEFINITION } from '../../server/domain/moveAutomation/vortex'
import type { TabletopMap } from '~/types/map'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'ability-field-map',
  name: 'Ability Field Map',
  revision: 6,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  voxels: [],
  placements: [{
    id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor',
    position: { x: 1, y: 0, z: 1 }, sideId: 'red',
  }, {
    id: 'target', sheetKind: 'pokemon', sheetSlug: 'target',
    position: { x: 3, y: 0, z: 1 }, sideId: 'blue',
  }],
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      red: { id: 'red', label: 'Red', status: 'active' },
      blue: { id: 'blue', label: 'Blue', status: 'active' },
    },
  },
})
const context = (): AuthoritativeAbilityContext => {
  const map = mapFixture()
  const actorPlacement = map.placements[0]!
  const targetPlacement = map.placements[1]!
  const actorToken = {
    id: 'actor', position: actorPlacement.position, base: 1, clearance: 1,
    defenderTypes: ['Fire'], abilityNames: [], conditions: [],
  }
  const targetToken = {
    id: 'target', position: targetPlacement.position, base: 1, clearance: 1,
    defenderTypes: ['Normal'], abilityNames: [], conditions: [], defenderCapabilities: {},
  }
  return {
    map,
    actor: { placement: actorPlacement, token: actorToken },
    source: { placement: actorPlacement, token: actorToken },
    targets: [{ placement: targetPlacement, token: targetToken }],
    placements: map.placements,
    tokens: [actorToken, targetToken],
    queries: {
      placements: { get: (id: string) => map.placements.find(value => value.id === id) ?? null },
      tokens: { get: (id: string) => id === 'actor' ? actorToken : id === 'target' ? targetToken : null },
      effectiveAbilities: {
        activeForPlacement: (id: string) => id === 'actor'
          ? [{ instanceId: 'base:actor:0', canonicalId: 'Drought', effective: true }]
          : [],
      },
    },
  } as unknown as AuthoritativeAbilityContext
}
const operation = (
  providerId: string,
  kind: 'field' | 'hazard' | 'temporary-effect',
  payload: Record<string, unknown>,
  recipients: 'none' | 'selected-targets' = 'none',
) => ({
  id: `operation.${providerId}`,
  kind,
  source: { kind: 'operation', id: providerId },
  recipients: { kind: recipients },
  phase: 'schedule',
  reasonCode: `ability.${providerId}`,
  payload,
})
const provider = (
  providerId: string,
  op: ReturnType<typeof operation>,
  recipientPlacementIds: readonly string[] = [],
  priority = 0,
) => ({
  schemaVersion: 1,
  providerId,
  abilityInstanceId: 'base:actor:0',
  canonicalId: 'Drought',
  sourcePlacementId: 'actor',
  ownerPlacementId: 'actor',
  recipientPlacementIds,
  priority,
  reasonCode: `ability.${providerId}`,
  operation: op,
})
const field = (providerId: string, category: 'weather' | 'terrain' | 'room', fieldId: string, priority = 0) => provider(
  providerId,
  operation(providerId, 'field', { action: 'apply', category, fieldId, rounds: 5 }),
  [],
  priority,
)
const hazard = () => provider('spikes', operation('spikes', 'hazard', {
  action: 'add',
  familyId: 'hazard.spikes',
  zoneKind: 'hazard',
  effectId: 'spikes',
  ownership: 'source-side',
  geometry: {
    kind: 'selection', cellSetId: 'cells.spikes',
    count: { kind: 'exact', count: 1 }, adjacency: 'orthogonal', connectedness: 'none',
  },
  layers: 1, maxLayers: 3, charges: null, maxCharges: null,
}))
const vortex = () => provider('vortex', operation('vortex', 'temporary-effect', {
  action: 'add',
  effectId: 'vortex.provider',
  recipientScope: 'placements',
  definition: SAND_TOMB_VORTEX_DEFINITION,
}, 'selected-targets'), ['target'])

describe('ability weather, terrain, room, hazard, vortex, zone, and battlefield providers', () => {
  it('strictly accepts only source-bound field, hazard, and typed-effect operations', () => {
    expect(parseAbilityFieldProviders([
      field('weather-rain', 'weather', 'rainy'), hazard(), vortex(),
    ])).toHaveLength(3)
    expect(() => parseAbilityFieldProviders([{
      ...field('weather-rain', 'weather', 'rainy'), inferredCells: [{ x: 1, y: 0, z: 1 }],
    }])).toThrowError(AbilityFieldProviderValidationError)
    expect(() => parseAbilityFieldProviders([{
      ...field('weather-rain', 'weather', 'rainy'),
      operation: {
        ...field('weather-rain', 'weather', 'rainy').operation,
        source: { kind: 'operation', id: 'different-provider' },
      },
    }])).toThrowError(/bind to its provider ID/)
  })

  it('atomically applies global weather, terrain, room, hazard, and Vortex state', () => {
    const result = planAuthoritativeAbilityFieldProviders({
      context: context(),
      providers: [
        field('weather-rain', 'weather', 'rainy', 1),
        field('terrain-electric', 'terrain', 'electric', 2),
        field('room-trick', 'room', 'trick', 3),
        { ...hazard(), priority: 4 },
        { ...vortex(), priority: 5 },
      ],
      hazardGeometry: { cellSets: new Map([['cells.spikes', [{ x: 2, y: 0, z: 2 }]]]) },
    })
    expect(result.operationResults.map(entry => entry.outcome)).toEqual([
      'applied', 'applied', 'applied', 'applied', 'applied',
    ])
    expect(result.currentMap.encounterState?.zones.map(zone => zone.kind)).toEqual([
      'weather', 'terrain', 'room', 'hazard',
    ])
    expect(result.currentMap.encounterState?.effects).toEqual([
      expect.objectContaining({
        kind: 'vortex',
        affected: expect.objectContaining({ placementIds: ['target'] }),
      }),
    ])
    expect(result.plan.expectedRevisions).toEqual([
      { kind: 'map', mapSlug: 'ability-field-map', expectedRevision: 6 },
    ])
    expect(result.plan.changes.some(change => change.kind === 'encounter-state')).toBe(true)
    expect(result.plan.changes.some(change => change.kind === 'map-field-effects')).toBe(true)
  })

  it('uses deterministic weather replacement and keeps legacy fields as projection only', () => {
    const result = planAuthoritativeAbilityFieldProviders({
      context: context(),
      providers: [
        field('weather-rain', 'weather', 'rainy', 1),
        field('weather-sun', 'weather', 'sunny', 2),
      ],
    })
    const weather = result.currentMap.encounterState?.zones.filter(zone => zone.kind === 'weather') ?? []
    expect(weather).toHaveLength(1)
    expect(weather[0]).toMatchObject({ payload: { weatherId: 'sunny' } })
    expect(result.currentMap.fieldEffects?.weather).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'sunny' }),
    ]))
  })

  it('runs bounded battlefield-zone cleanup through typed field mutation', () => {
    const remove = provider('remove-hazards', operation('remove-hazards', 'field', {
      action: 'mutate',
      mutation: {
        kind: 'remove',
        target: {
          zoneKinds: ['hazard'], source: 'any', side: 'any', requiredTags: [], geometry: null,
        },
      },
    }), [], 2)
    const result = planAuthoritativeAbilityFieldProviders({
      context: context(),
      providers: [{ ...hazard(), priority: 1 }, remove],
      hazardGeometry: { cellSets: new Map([['cells.spikes', [{ x: 2, y: 0, z: 2 }]]]) },
    })
    expect(result.operationResults).toEqual([
      expect.objectContaining({ operationKind: 'hazard', outcome: 'applied' }),
      expect.objectContaining({ operationKind: 'field', outcome: 'applied' }),
    ])
    expect(result.currentMap.encounterState?.zones.filter(zone => zone.kind === 'hazard')).toEqual([])
  })

  it('rejects inactive sources and unselected recipients before reduction', () => {
    const inactive = context()
    ;(inactive.queries.effectiveAbilities as unknown as { activeForPlacement: () => unknown[] }).activeForPlacement = () => []
    expect(() => planAuthoritativeAbilityFieldProviders({
      context: inactive, providers: [field('weather-rain', 'weather', 'rainy')],
    })).toThrowError(/source ability is inactive/)
    expect(() => planAuthoritativeAbilityFieldProviders({
      context: context(), providers: [{ ...vortex(), recipientPlacementIds: ['other'] }],
    })).toThrowError(/unselected recipient/)
  })
})
