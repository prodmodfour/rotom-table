import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import { planAuthoritativeAbilityItemProviders } from '../../server/domain/abilityAutomation/itemProviders'
import {
  AbilityItemProviderValidationError,
  parseAbilityItemProviders,
} from '#shared/abilityAutomation/itemProviders'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEmptySheetEquipmentState } from '#shared/itemAutomation/equipment'
import { activeEquipmentState } from '../fixtures/equipment'
import {
  resolveAuthoritativeMoveItemResources,
  type AuthoritativeMoveItemResourceRequirement,
  type AuthoritativeMoveItemResources,
} from '../../server/domain/moveAutomation/itemResources'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'

const actorId = 'item-actor'
const targetId = 'item-target'
const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'ability-item-map',
  name: 'Ability Item Map',
  revision: 4,
  dimensions: { x: 6, y: 2, z: 6 },
  voxels: [],
  placements: [{
    id: actorId, sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 1, y: 0, z: 1 }, sideId: 'red',
  }, {
    id: targetId, sheetKind: 'pokemon', sheetSlug: 'target-sheet', position: { x: 2, y: 0, z: 1 }, sideId: 'blue',
  }],
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      red: { id: 'red', label: 'Red', status: 'active' },
      blue: { id: 'blue', label: 'Blue', status: 'active' },
    },
  },
})
const sheet = (slug: string, held?: string, revision = 2): CharacterSheet => ({
  slug, nickname: slug, species: 'Pikachu', level: 10, revision,
  combat: { currentHp: 30 }, movelist: [{ name: 'Scratch' }],
  equipmentState: held
    ? activeEquipmentState({ ownerKind: 'pokemon', ownerSlug: slug, slotId: 'held', canonicalItemId: held })
    : createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: slug }),
  ...(held ? { items: { held } } : {}),
})
const requirements = {
  actor: { id: 'items.actor', source: { kind: 'actor-equipped' } },
  target: { id: 'items.target', source: { kind: 'selected-target-equipped' } },
  ground: { id: 'items.ground', source: { kind: 'map-ground-items' } },
} as const satisfies Record<string, AuthoritativeMoveItemResourceRequirement>
const resourcesFor = (input: {
  readonly map: TabletopMap
  readonly sheets: ReadonlyMap<string, CharacterSheet>
  readonly requirements: readonly AuthoritativeMoveItemResourceRequirement[]
}): AuthoritativeMoveItemResources => resolveAuthoritativeMoveItemResources({
  map: input.map,
  actorPlacementId: actorId,
  selectedTargetPlacementIds: [targetId],
  pokemonSheets: input.sheets,
  trainerSheets: new Map(),
  groupInventories: new Map(),
  requirements: input.requirements,
})
const contextFor = (input: {
  readonly map: TabletopMap
  readonly sheets: ReadonlyMap<string, CharacterSheet>
  readonly resources: AuthoritativeMoveItemResources
}): AuthoritativeAbilityContext => {
  const moveContext = buildAuthoritativeMoveRulesContext({
    map: input.map,
    pokemonSheets: input.sheets,
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: actorId, moveName: 'Scratch',
      selection: { kind: 'single-target', targetPlacementId: targetId },
    },
    selectedPlacementIds: [targetId],
    random: () => { throw new Error('item provider does not roll') },
    time: 500,
    itemResources: input.resources,
  })
  const actor = { ...moveContext.actor, effectiveAbilities: [] }
  const targetPlacement = moveContext.selectedPlacements[0]!
  const targetSheet = moveContext.resolvedSheets.find(value => (
    value.kind === targetPlacement.sheetKind && value.slug === targetPlacement.sheetSlug
  ))!
  const target = {
    placement: targetPlacement,
    token: moveContext.queries.tokens.get(targetPlacement.id)!,
    sheet: targetSheet,
    effectiveAbilities: [],
  }
  return {
    ...moveContext,
    actor,
    source: actor,
    targets: [target],
    resolvedSheets: [...input.sheets.values()].map(value => ({
      kind: 'pokemon' as const, slug: value.slug, revision: value.revision ?? 0, sheet: value,
    })),
    time: 500,
    queries: {
      ...moveContext.queries,
      effectiveAbilities: {
        activeForPlacement: (id: string) => id === actorId
          ? [{ instanceId: 'base:item-actor:0', canonicalId: 'Pickup', effective: true }]
          : [],
      },
      items: {
        requirements: () => input.resources.requirements,
        candidates: (requirementId?: string) => requirementId
          ? input.resources.candidates.filter(candidate => candidate.requirementId === requirementId)
          : input.resources.candidates,
        referencesForRequirement: (requirementId: string) => input.resources.candidates
          .filter(candidate => candidate.requirementId === requirementId).map(candidate => candidate.reference),
        consumedById: (consumptionId: string) => input.resources.consumedItems
          .find(item => item.consumptionId === consumptionId) ?? null,
        consumedItems: () => input.resources.consumedItems,
        groupInventory: (slug: string) => input.resources.groupInventories.get(slug) ?? null,
      },
    },
  } as unknown as AuthoritativeAbilityContext
}
const provider = (payload: Record<string, unknown>, id = 'item-provider') => ({
  schemaVersion: 1,
  providerId: id,
  abilityInstanceId: 'base:item-actor:0',
  canonicalId: 'Pickup',
  sourcePlacementId: actorId,
  ownerPlacementId: actorId,
  recipientPlacementIds: [],
  priority: 0,
  reasonCode: `ability.${id}`,
  payload,
})
const selection = (requirementId: string, cardinality: 'one' | 'all' = 'one') => ({
  kind: 'requirement', requirementId, cardinality,
})

describe('ability held-item, inventory, food, pickup, drop, steal, and consume providers', () => {
  it('strictly reuses every closed authoritative item action, including pickup', () => {
    const actions = [
      provider({ action: 'pickup', item: selection(requirements.ground.id), quantity: 1, onUnavailable: 'reject' }, 'pickup'),
      provider({ action: 'steal', item: selection(requirements.target.id), quantity: 1, onUnavailable: 'reject' }, 'steal'),
      provider({ action: 'knock-to-ground', item: selection(requirements.actor.id), quantity: 1, onUnavailable: 'reject' }, 'drop'),
      provider({ action: 'consume', item: selection(requirements.actor.id), quantity: 1, onUnavailable: 'reject', consumptionId: 'consume.berry' }, 'consume'),
      provider({ action: 'store-buff', item: selection(requirements.actor.id), quantity: 1, onUnavailable: 'reject', consumptionId: 'store.berry' }, 'store'),
      provider({ action: 'digest-buff', canonicalItemIds: null, onUnavailable: 'no-op' }, 'digest'),
    ]
    expect(parseAbilityItemProviders(actions).map(entry => entry.payload.action))
      .toEqual(['consume', 'digest-buff', 'knock-to-ground', 'pickup', 'steal', 'store-buff'])
    expect(() => parseAbilityItemProviders([{
      ...actions[0], inferredItemName: 'anything nearby',
    }])).toThrowError(AbilityItemProviderValidationError)
  })

  it('consumes an authoritative held item through one revisioned sheet plan', () => {
    const sheets = new Map([
      ['actor-sheet', sheet('actor-sheet', 'Oran Berry')],
      ['target-sheet', sheet('target-sheet')],
    ])
    const resources = resourcesFor({ map: mapFixture(), sheets, requirements: [requirements.actor] })
    const result = planAuthoritativeAbilityItemProviders({
      context: contextFor({ map: mapFixture(), sheets, resources }),
      parentOperationId: 'operation.consume-held',
      providers: [provider({
        action: 'consume', item: selection(requirements.actor.id), quantity: 1,
        onUnavailable: 'reject', consumptionId: 'consumption.oran',
      }, 'consume-held')],
    })
    expect(result.interpretation.results[0]).toMatchObject({ action: 'consume', outcome: 'applied' })
    expect(result.mutations.sheetWrites).toHaveLength(1)
    expect(result.mutations.sheetWrites[0]?.nextSheet).toMatchObject({ items: {} })
    expect(result.mutations.consumedItems).toContainEqual(expect.objectContaining({
      consumptionId: 'consumption.oran', canonicalItemId: 'oran-berry',
    }))
  })

  it('drops then picks up one map-ground item without client-authored item identity', () => {
    const initialSheets = new Map([
      ['actor-sheet', sheet('actor-sheet', 'Oran Berry')],
      ['target-sheet', sheet('target-sheet')],
    ])
    const initialMap = mapFixture()
    const dropResources = resourcesFor({ map: initialMap, sheets: initialSheets, requirements: [requirements.actor] })
    const dropped = planAuthoritativeAbilityItemProviders({
      context: contextFor({ map: initialMap, sheets: initialSheets, resources: dropResources }),
      parentOperationId: 'operation.drop-item',
      providers: [provider({
        action: 'knock-to-ground', item: selection(requirements.actor.id), quantity: 1,
        onUnavailable: 'reject',
      }, 'drop-item')],
    })
    expect(dropped.interpretation.results[0]).toMatchObject({ action: 'knock-to-ground', outcome: 'applied' })
    expect(dropped.mutations.nextMap.encounterState?.groundItems).toHaveLength(1)
    const actorWrite = dropped.mutations.sheetWrites.find(write => write.slug === 'actor-sheet')!
    const nextSheets = new Map(initialSheets)
    nextSheets.set('actor-sheet', actorWrite.nextSheet as CharacterSheet)
    const pickupResources = resourcesFor({
      map: dropped.mutations.nextMap,
      sheets: nextSheets,
      requirements: [requirements.ground],
    })
    const pickedUp = planAuthoritativeAbilityItemProviders({
      context: contextFor({ map: dropped.mutations.nextMap, sheets: nextSheets, resources: pickupResources }),
      parentOperationId: 'operation.pickup-item',
      providers: [provider({
        action: 'pickup', item: selection(requirements.ground.id), quantity: 1,
        onUnavailable: 'reject',
      }, 'pickup-item')],
    })
    expect(pickedUp.interpretation.results[0]).toMatchObject({ action: 'pickup', outcome: 'applied' })
    expect(pickedUp.mutations.nextMap.encounterState?.groundItems).toEqual([])
    expect(pickedUp.mutations.sheetWrites.find(write => write.slug === 'actor-sheet')?.nextSheet)
      .toMatchObject({ items: { held: 'Oran Berry' } })
  })

  it('steals only a server-loaded selected-target equipped reference', () => {
    const sheets = new Map([
      ['actor-sheet', sheet('actor-sheet')],
      ['target-sheet', sheet('target-sheet', 'Leftovers')],
    ])
    const map = mapFixture()
    const resources = resourcesFor({ map, sheets, requirements: [requirements.target] })
    const stealProvider = {
      ...provider({
        action: 'steal', item: selection(requirements.target.id), quantity: 1, onUnavailable: 'reject',
      }, 'steal-target'),
      recipientPlacementIds: [targetId],
    }
    const result = planAuthoritativeAbilityItemProviders({
      context: contextFor({ map, sheets, resources }),
      parentOperationId: 'operation.steal-item', providers: [stealProvider],
    })
    expect(result.interpretation.results[0]).toMatchObject({ action: 'steal', outcome: 'applied' })
    expect(result.mutations.sheetWrites.find(write => write.slug === 'actor-sheet')?.nextSheet)
      .toMatchObject({ items: { held: 'Leftovers' } })
    expect(result.mutations.sheetWrites.find(write => write.slug === 'target-sheet')?.nextSheet)
      .toMatchObject({ items: {} })
  })
})
