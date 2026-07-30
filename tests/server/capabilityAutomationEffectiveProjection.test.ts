import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'
import { reconcileCapabilityRuntimeSourceLoss } from '../../server/domain/capabilityAutomation/sourceLoss'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const pokemon = (slug: string, species: string, overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug, name: slug, species, level: 50, ...overrides,
})
const placement = (id: string, slug: string, x = 0): SheetPlacement => ({
  id, sheetKind: 'pokemon', sheetSlug: slug, position: { x, y: 1, z: 0 },
})
const mapFor = (placements: SheetPlacement[], encounterState = createEmptyEncounterState()): TabletopMap => ({
  id: 'map-id', slug: 'capability-map', name: 'Capability map', schemaVersion: 2,
  revision: 1, updatedAt: 100, dimensions: { x: 20, y: 10, z: 20 }, groundLevelY: 0,
  placements, voxels: [], encounterState,
} as TabletopMap)

describe('effective Capability projection', () => {
  it('resolves species defaults, sheet overrides, Move grants, and unresolved maintenance labels with provenance', () => {
    const actor = pokemon('shedinja', 'Shedinja', {
      capabilities: { overland: 8, other: ['Soulless', 'Not A Capability'] },
      movelist: [{ name: 'Fly' }],
    })
    const actorPlacement = placement('actor', actor.slug)
    const result = resolveEffectiveCapabilities({ map: mapFor([actorPlacement]), placement: actorPlacement, sheet: actor })
    expect(result.instances.find(instance => instance.canonicalId === 'Overland')).toMatchObject({
      value: 8, effective: true, primarySource: { kind: 'sheet-override' },
    })
    expect(result.instances.find(instance => instance.canonicalId === 'Sky')).toMatchObject({
      value: 8, effective: true,
    })
    expect(result.instances.find(instance => instance.canonicalId === 'Soulless')?.sources.length).toBeGreaterThan(0)
    expect(result.instances.find(instance => instance.canonicalId === 'Naturewalk')?.parameters).toEqual({
      kind: 'terrains', terrains: ['Grassland', 'Forest'],
    })
    expect(result.unresolved.map(entry => entry.normalizedLabel)).toContain('Not A Capability')
  })

  it('applies every independently selected Capability Poké Edge without collapsing repeated edge names', () => {
    const actor = pokemon('edge-user', '', {
      capabilities: { overland: 3, sky: 2, power: 4, jump: '1/1' },
      edges: [
        { name: 'Advanced Mobility (Overland)' },
        { name: 'Advanced Mobility: Sky' },
        { name: 'Capability Training (Power)' },
        { name: 'Capability Training: High Jump' },
      ],
    })
    const actorPlacement = placement('edge-user', actor.slug)
    const result = resolveEffectiveCapabilities({ map: mapFor([actorPlacement]), placement: actorPlacement, sheet: actor })
    expect(result.instances.find(instance => instance.canonicalId === 'Overland')?.value).toBe(5)
    expect(result.instances.find(instance => instance.canonicalId === 'Sky')?.value).toBe(4)
    expect(result.instances.find(instance => instance.canonicalId === 'Power')?.value).toBe(5)
    expect(result.instances.find(instance => instance.canonicalId === 'Jump')?.parameters).toEqual({
      kind: 'jump', long: 1, high: 2,
    })
  })

  it('projects reviewed equipped-item Capability grants with exact item provenance', () => {
    const trainer: TrainerSheet = {
      slug: 'equipped-trainer', name: 'Equipped Trainer', level: 20, revision: 1,
      equipmentSlots: { feet: 'Snow Boots', accessory: 'Dark Vision Goggles' },
    }
    const trainerPlacement: SheetPlacement = {
      id: 'equipped-trainer', sheetKind: 'trainer', sheetSlug: trainer.slug, position: { x: 0, y: 1, z: 0 },
    }
    const result = resolveEffectiveCapabilities({ map: mapFor([trainerPlacement]), placement: trainerPlacement, sheet: trainer })
    expect(result.instances.find(instance => instance.canonicalId === 'Darkvision')?.primarySource.kind).toBe('item-grant')
    expect(result.instances.find(instance => instance.canonicalId === 'Naturewalk')?.parameters).toEqual({
      kind: 'terrains', terrains: ['Tundra'],
    })
    expect(result.instances.find(instance => instance.canonicalId === 'Naturewalk')?.sources[0]?.sourceId)
      .toContain('snow-boots')
  })

  it('projects reviewed static Trainer Feature and Edge grants without parsing prose at runtime', () => {
    const trainer: TrainerSheet = {
      slug: 'trainer', name: 'Trainer', level: 20,
      features: [{ name: 'Mental Resistance' }, { name: 'Telekinetic' }],
      edges: [{ name: 'Art of Stealth' }, { name: 'Power Boost' }, { name: 'Acrobat' }],
    }
    const trainerPlacement: SheetPlacement = {
      id: 'trainer-token', sheetKind: 'trainer', sheetSlug: trainer.slug, position: { x: 0, y: 1, z: 0 },
    }
    const result = resolveEffectiveCapabilities({ map: mapFor([trainerPlacement]), placement: trainerPlacement, sheet: trainer })
    expect(result.instances.find(instance => instance.canonicalId === 'Mindlock')?.primarySource.kind).toBe('feature-grant')
    expect(result.instances.find(instance => instance.canonicalId === 'Telekinetic')?.primarySource.kind).toBe('feature-grant')
    expect(result.instances.find(instance => instance.canonicalId === 'Stealth')?.primarySource.kind).toBe('edge-grant')
    expect(result.instances.find(instance => instance.canonicalId === 'Power')?.value).toBe(6)
    expect(result.instances.find(instance => instance.canonicalId === 'High Jump')?.value).toBe(1)
    expect(result.instances.find(instance => instance.canonicalId === 'Long Jump')?.value).toBe(2)
  })

  it('removes modes, links, marker effects, and illusion authority when the exact source instance is lost', () => {
    const actor = pokemon('actor', 'Pikachu', { capabilities: { other: ['As One'] } })
    const actorPlacement = placement('actor-token', actor.slug)
    const partner = pokemon('partner', 'Ponyta')
    const partnerPlacement = placement('partner-token', partner.slug, 1)
    const encounter = createEmptyEncounterState()
    const map = mapFor([actorPlacement, partnerPlacement], {
      ...encounter,
      effects: [{
        id: 'mode-inflated', kind: 'numeric-modifier',
        source: { operationId: 'old-operation', moveId: 'capability.inflatable', placementId: actorPlacement.id },
        affected: { placementIds: [actorPlacement.id], sideIds: [], cells: [] },
        createdRound: 1, createdTurn: 0, duration: { kind: 'permanent', remaining: null },
        stacks: 1, charges: null, stackPolicy: { kind: 'replace', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null }, tags: ['capability-mode', 'capability-mode.inflated'],
        payload: { attribute: 'evasion', operation: 'add', value: -1, rounding: 'none' },
        dispel: { policy: 'none', tags: [] }, transferPolicy: 'expire', suppression: { sources: [] },
      }],
      capabilityRuntime: {
        ...encounter.capabilityRuntime!,
        modes: [{
          id: 'mode-inflated', actorPlacementId: actorPlacement.id,
          capabilityInstanceId: 'capability:actor-token:Inflatable:base', canonicalId: 'Inflatable',
          mode: 'inflated', description: null, configurationId: null, activatedAt: 100,
          expiresAt: null, sourceOperationId: 'old-operation',
        }, {
          id: 'mode-illusion', actorPlacementId: actorPlacement.id,
          capabilityInstanceId: 'capability:actor-token:Illusionist:base', canonicalId: 'Illusionist',
          mode: 'illusion', description: 'flame', configurationId: 'motion:minor', activatedAt: 100,
          expiresAt: null, sourceOperationId: 'old-illusion',
        }],
        links: [{
          id: 'stale-as-one', kind: 'as-one-mount', ownerPlacementId: actorPlacement.id,
          participantPlacementIds: [partnerPlacement.id],
          capabilityInstanceId: 'capability:actor-token:As_One:old-instance', canonicalId: 'As One',
          establishedAt: 100, configurationId: 'Run Away', sourceOperationId: 'old-link',
        }],
      },
    })
    map.metadata = { capabilityIllusions: [{ ownerPlacementId: actorPlacement.id, description: 'flame' }] }
    const reconciled = reconcileCapabilityRuntimeSourceLoss({
      map,
      sheets: { pokemon: new Map([[actor.slug, actor], [partner.slug, partner]]), trainer: new Map() },
    })
    expect(reconciled.encounterState?.capabilityRuntime?.modes).toEqual([])
    expect(reconciled.encounterState?.capabilityRuntime?.links).toEqual([])
    expect(reconciled.encounterState?.effects).toEqual([])
    expect(reconciled.metadata?.capabilityIllusions).toEqual([])
  })

  it('replaces movement and Naturewalk through a retained As One link while preserving source identities', () => {
    const rider = pokemon('calyrex', 'Calyrex')
    const mount = pokemon('glastrier', 'Glastrier')
    const riderPlacement = placement('rider', rider.slug)
    const mountPlacement = placement('mount', mount.slug, 1)
    const baseMap = mapFor([riderPlacement, mountPlacement])
    const base = resolveEffectiveCapabilities({ map: baseMap, placement: riderPlacement, sheet: rider })
    const asOne = base.instances.find(instance => instance.canonicalId === 'As One')!
    const linkedState = {
      ...createEmptyEncounterState(),
      capabilityRuntime: {
        ...createEmptyEncounterState().capabilityRuntime!,
        links: [{
          id: 'as-one-link', kind: 'as-one-mount' as const, ownerPlacementId: riderPlacement.id,
          participantPlacementIds: [mountPlacement.id], capabilityInstanceId: asOne.instanceId,
          canonicalId: 'As One', establishedAt: 100, configurationId: 'Chilling Neigh', sourceOperationId: 'operation-1',
        }],
      },
    }
    const linkedMap = mapFor([riderPlacement, mountPlacement], linkedState)
    const result = resolveEffectiveCapabilities({
      map: linkedMap, placement: riderPlacement, sheet: rider,
      sheets: { pokemon: new Map([[rider.slug, rider], [mount.slug, mount]]), trainer: new Map() },
    })
    expect(result.instances.find(instance => instance.canonicalId === 'Overland')).toMatchObject({
      value: 9, primarySource: { kind: 'form-projection' },
    })
    expect(result.instances.find(instance => instance.canonicalId === 'Naturewalk')?.parameters).toEqual({
      kind: 'terrains', terrains: ['Ocean', 'Taiga', 'Tundra'],
    })

    const suppressedMap = mapFor([riderPlacement, mountPlacement], {
      ...linkedState,
      effects: [{
        id: 'suppress-as-one', kind: 'capability',
        source: { operationId: 'suppression', moveId: 'test.suppression', placementId: mountPlacement.id },
        affected: { placementIds: [riderPlacement.id], sideIds: [], cells: [] },
        createdRound: 1, createdTurn: 0, duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
        stacks: 1, charges: null, stackPolicy: { kind: 'replace', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null }, tags: ['test'],
        payload: { capabilityId: 'as-one', action: 'suppress' },
        dispel: { policy: 'none', tags: [] }, transferPolicy: 'expire', suppression: { sources: [] },
      }],
    })
    const suppressed = resolveEffectiveCapabilities({
      map: suppressedMap, placement: riderPlacement, sheet: rider,
      sheets: { pokemon: new Map([[rider.slug, rider], [mount.slug, mount]]), trainer: new Map() },
    })
    expect(suppressed.instances.find(instance => instance.canonicalId === 'As One')?.effective).toBe(false)
    expect(suppressed.instances.find(instance => instance.canonicalId === 'Overland')?.value).not.toBe(9)
  })
})
