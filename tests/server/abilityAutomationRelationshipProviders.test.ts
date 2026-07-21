import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  AuthoritativeAbilityRelationshipProviderError,
  resolveAuthoritativeAbilityRelationshipProviders,
} from '../../server/domain/abilityAutomation/relationshipProviders'
import {
  AbilityRelationshipProviderValidationError,
  parseAbilityRelationshipProviders,
  projectAbilityRelationshipResolution,
  resolveAbilityRelationshipProviders,
  type AbilityRelationshipFact,
  type AbilityRelationshipProviderEffect,
} from '#shared/abilityAutomation/relationshipProviders'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'

const placements = [
  { id: 'actor', sheetKind: 'pokemon' as const, sheetSlug: 'actor', position: { x: 0, y: 0, z: 0 }, sideId: 'red' },
  { id: 'supporter', sheetKind: 'pokemon' as const, sheetSlug: 'supporter', position: { x: 1, y: 0, z: 0 }, sideId: 'red' },
  { id: 'target', sheetKind: 'pokemon' as const, sheetSlug: 'target', position: { x: 3, y: 0, z: 0 }, sideId: 'blue' },
  { id: 'protector', sheetKind: 'pokemon' as const, sheetSlug: 'protector', position: { x: 2, y: 0, z: 0 }, sideId: 'blue' },
  { id: 'redirect-low', sheetKind: 'pokemon' as const, sheetSlug: 'redirect-low', position: { x: 1, y: 0, z: 2 }, sideId: 'blue' },
  { id: 'redirect-high', sheetKind: 'pokemon' as const, sheetSlug: 'redirect-high', position: { x: 2, y: 0, z: 2 }, sideId: 'blue' },
]
const relation = (left: string, right: string): 'self' | 'ally' | 'enemy' | 'unknown' => {
  if (left === right) return 'self'
  const leftSide = placements.find(value => value.id === left)?.sideId
  const rightSide = placements.find(value => value.id === right)?.sideId
  return leftSide && rightSide ? leftSide === rightSide ? 'ally' : 'enemy' : 'unknown'
}
const predicate = (overrides: Record<string, unknown> = {}) => ({
  moveTypes: [], requiredKeywords: [], excludedKeywords: [], areaPolicy: 'any',
  ...overrides,
})
const provider = (
  providerId: string,
  sourcePlacementId: string,
  effect: AbilityRelationshipProviderEffect | Record<string, unknown>,
  priority = 0,
) => ({
  schemaVersion: 1,
  providerId,
  abilityInstanceId: `base:${sourcePlacementId}:0`,
  canonicalId: 'Friend Guard',
  sourcePlacementId,
  priority,
  reasonCode: `ability.${providerId}`,
  effect,
})
const providers = () => [
  provider('ally-aura', 'supporter', {
    kind: 'scope', scopeId: 'scope.friend-guard', geometry: 'aura',
    relations: ['ally', 'self'], minimumRange: 0, maximumRange: 2,
    cardinalOnly: false, requiresLineOfSight: false, tags: ['ally', 'aura'],
  }, 1),
  provider('red-side', 'supporter', {
    kind: 'scope', scopeId: 'scope.red-side', geometry: 'side',
    relations: ['ally', 'self'], minimumRange: 0, maximumRange: null,
    cardinalOnly: false, requiresLineOfSight: false, tags: ['side'],
  }, 2),
  provider('adjacent-allies', 'supporter', {
    kind: 'scope', scopeId: 'scope.adjacent', geometry: 'adjacent',
    relations: ['ally'], minimumRange: 1, maximumRange: 1,
    cardinalOnly: true, requiresLineOfSight: false, tags: ['adjacent'],
  }, 3),
  provider('intercept-target', 'protector', {
    kind: 'interception', protectedRelations: ['ally'],
    maximumDistanceToProtected: 1, maximumDistanceToActor: null,
    cardinalOnly: true, requiresLineOfSight: true,
    predicate: predicate({ areaPolicy: 'single-target-only' }),
  }, 5),
  provider('redirect-low', 'redirect-low', {
    kind: 'redirection', mode: 'mandatory', maximumDistanceToActor: 4,
    requiresLineOfSight: true, predicate: predicate({ moveTypes: ['electric'], areaPolicy: 'single-target-only' }),
  }, 1),
  provider('redirect-high', 'redirect-high', {
    kind: 'redirection', mode: 'mandatory', maximumDistanceToActor: 4,
    requiresLineOfSight: true, predicate: predicate({ moveTypes: ['electric'], areaPolicy: 'single-target-only' }),
  }, 2),
]
const fact: AbilityRelationshipFact = {
  actorPlacementId: 'actor', targetPlacementIds: ['target'],
  moveType: 'electric', keywords: ['ranged'], area: false,
}
const distance = (left: string, right: string): number | null => {
  const a = placements.find(value => value.id === left)
  const b = placements.find(value => value.id === right)
  return a && b ? Math.max(Math.abs(a.position.x - b.position.x), Math.abs(a.position.z - b.position.z)) : null
}
const context = (): AuthoritativeAbilityContext => {
  const map: TabletopMap = {
    schemaVersion: 2, slug: 'relationship-map', name: 'Relationship Map', revision: 1,
    dimensions: { x: 8, y: 2, z: 8 }, voxels: [], placements,
    encounterState: {
      ...createEmptyEncounterState(),
      sides: {
        red: { id: 'red', label: 'Red', status: 'active' },
        blue: { id: 'blue', label: 'Blue', status: 'active' },
      },
    },
  }
  const tokens = placements.map(value => ({
    id: value.id, position: value.position, base: 1, clearance: 1,
  }))
  const byId = new Map(placements.map(value => [value.id, value]))
  return {
    map,
    actor: { placement: byId.get('actor')! },
    source: { placement: byId.get('actor')! },
    targets: [{ placement: byId.get('target')! }],
    placements,
    tokens,
    queries: {
      placements: { get: (id: string) => byId.get(id) ?? null },
      tokens: { get: (id: string) => tokens.find(value => value.id === id) ?? null },
      relationships: {
        sideId: (id: string) => byId.get(id)?.sideId ?? null,
        relation,
      },
      effectiveAbilities: {
        activeForPlacement: (id: string) => byId.has(id)
          ? [{ instanceId: `base:${id}:0`, canonicalId: 'Friend Guard', effective: true }]
          : [],
      },
    },
  } as unknown as AuthoritativeAbilityContext
}

describe('ability ally/enemy, aura, side, adjacency, interception, and redirection providers', () => {
  it('strictly validates relational geometry and move predicates', () => {
    expect(parseAbilityRelationshipProviders(providers())).toHaveLength(6)
    expect(() => parseAbilityRelationshipProviders([{
      ...providers()[0], inferredAlly: true,
    }])).toThrowError(AbilityRelationshipProviderValidationError)
    expect(() => parseAbilityRelationshipProviders([
      provider('bad-adjacency', 'supporter', {
        kind: 'scope', scopeId: 'scope.bad', geometry: 'adjacent', relations: ['ally'],
        minimumRange: 0, maximumRange: 2, cardinalOnly: true,
        requiresLineOfSight: false, tags: [],
      }),
    ])).toThrowError(/exact range 1/)
  })

  it('projects ally aura, same-side, and cardinal adjacency memberships', () => {
    const result = resolveAbilityRelationshipProviders({
      providers: providers().slice(0, 3), fact,
      placementIds: placements.map(value => value.id),
      sideId: id => placements.find(value => value.id === id)?.sideId ?? null,
      relation,
      distance,
      cardinallyAdjacent: (left, right) => distance(left, right) === 1
        && placements.find(value => value.id === left)?.position.z === placements.find(value => value.id === right)?.position.z,
      lineOfSight: () => true,
    })
    expect(result.scopes).toEqual([
      expect.objectContaining({ scopeId: 'scope.friend-guard', placementIds: ['actor', 'supporter'], sideIds: ['red'] }),
      expect.objectContaining({ scopeId: 'scope.red-side', placementIds: ['actor', 'supporter'], sideIds: ['red'] }),
      expect.objectContaining({ scopeId: 'scope.adjacent', placementIds: ['actor'], tags: ['adjacent'] }),
    ])
  })

  it('creates private interception offers without changing targets before a response', () => {
    const result = resolveAbilityRelationshipProviders({
      providers: [providers()[3]!], fact,
      placementIds: placements.map(value => value.id),
      sideId: id => placements.find(value => value.id === id)?.sideId ?? null,
      relation, distance,
      cardinallyAdjacent: (left, right) => distance(left, right) === 1,
      lineOfSight: () => true,
    })
    expect(result.interceptionOffers).toEqual([{
      providerId: 'intercept-target', responderPlacementId: 'protector',
      protectedPlacementId: 'target', actorPlacementId: 'actor', priority: 5,
    }])
    expect(result.targetPlacementIds).toEqual(['target'])
  })

  it('arbitrates mandatory redirection by priority and retains shadow evidence', () => {
    const result = resolveAbilityRelationshipProviders({
      providers: providers().slice(4), fact,
      placementIds: placements.map(value => value.id),
      sideId: id => placements.find(value => value.id === id)?.sideId ?? null,
      relation, distance, cardinallyAdjacent: () => false, lineOfSight: () => true,
    })
    expect(result.targetPlacementIds).toEqual(['redirect-high'])
    expect(result.redirectionOffers).toEqual([
      expect.objectContaining({ providerId: 'redirect-high', redirectedTargetPlacementIds: ['redirect-high'] }),
    ])
    expect(result.trace).toContainEqual(expect.objectContaining({
      providerId: 'redirect-low', status: 'shadowed',
    }))
  })

  it('default-denies private interception/redirection offers to public and unrelated viewers', () => {
    const resolution = resolveAuthoritativeAbilityRelationshipProviders({
      context: context(), providers: providers(), fact,
    })
    const publicView = projectAbilityRelationshipResolution({ resolution, authorization: 'public' })
    expect(Object.keys(publicView)).toEqual(['scopes', 'targetPlacementIds'])
    expect(JSON.stringify(publicView)).not.toContain('intercept-target')
    const unrelated = projectAbilityRelationshipResolution({
      resolution, authorization: 'responder', responderPlacementId: 'supporter',
    })
    expect(unrelated).toMatchObject({ interceptionOffers: [], redirectionOffers: [] })
    const protector = projectAbilityRelationshipResolution({
      resolution, authorization: 'responder', responderPlacementId: 'protector',
    })
    expect(protector).toMatchObject({
      interceptionOffers: [expect.objectContaining({ providerId: 'intercept-target' })],
      redirectionOffers: [],
    })
  })

  it('does not redirect area attacks through a single-target-only provider', () => {
    const result = resolveAbilityRelationshipProviders({
      providers: providers().slice(4), fact: { ...fact, area: true },
      placementIds: placements.map(value => value.id),
      sideId: id => placements.find(value => value.id === id)?.sideId ?? null,
      relation, distance, cardinallyAdjacent: () => false, lineOfSight: () => true,
    })
    expect(result.targetPlacementIds).toEqual(['target'])
    expect(result.redirectionOffers).toEqual([])
    expect(result.trace.every(entry => entry.status === 'predicate-false')).toBe(true)
  })

  it('rebuilds geometry and LOS from the authoritative map and rejects inactive sources', () => {
    const result = resolveAuthoritativeAbilityRelationshipProviders({
      context: context(), providers: providers(), fact,
    })
    expect(result.scopes[0]).toMatchObject({ placementIds: ['actor', 'supporter'] })
    expect(result.interceptionOffers).toHaveLength(1)
    expect(result.targetPlacementIds).toEqual(['redirect-high'])

    const inactive = context()
    ;(inactive.queries.effectiveAbilities as unknown as { activeForPlacement: () => unknown[] }).activeForPlacement = () => []
    expect(() => resolveAuthoritativeAbilityRelationshipProviders({
      context: inactive, providers: providers(), fact,
    })).toThrowError(AuthoritativeAbilityRelationshipProviderError)
  })
})
