import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  parseMoveEffectOperation,
  type MoveItemEffectOperation,
} from '#shared/moveAutomation/effects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  applyMoveItemEffectResultsToTrace,
  interpretMoveItemEffects,
  MoveItemEffectInterpretationError,
  type MoveResolvedItemEffectOperation,
} from '~~/server/domain/moveAutomation/itemEffectInterpreter'
import { enumerateAuthoritativeMoveItemChoices } from '~~/server/domain/moveAutomation/itemChoices'
import {
  createAuthoritativeMoveItemResourceQueries,
  emptyAuthoritativeMoveItemResources,
  resolveAuthoritativeMoveItemResources,
  type AuthoritativeMoveItemResourceRequirement,
  type AuthoritativeMoveItemResources,
} from '~~/server/domain/moveAutomation/itemResources'
import {
  MoveItemMutationError,
  type MoveConsumedItemRecord,
} from '~~/server/domain/moveAutomation/itemMutationTypes'
import { planMoveItemMutations } from '~~/server/domain/moveAutomation/planItemMutations'
import {
  createMoveResolutionTrace,
  reduceMoveResolutionTrace,
} from '~~/server/domain/moveAutomation/trace'
import type { MoveSpecResolvedItemChoice } from '~~/server/domain/moveAutomation/executeSpec'
import {
  capabilityEncounterEffectFixture,
  creatureRuleOverlayEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'
import { createDigestionBuffTradeEffect } from '../../server/domain/moveAutomation/digestionBuffTrade'
import { createEmptySheetEquipmentState } from '#shared/itemAutomation/equipment'
import { activeEquipmentState } from '../fixtures/equipment'
import {
  createDigestionBuffTradeOperations,
  ITEM_DIGESTION_TRADE_EFFECT_REASON,
  ITEM_DIGESTION_TRADE_HEAL_REASON,
  resolveReviewedDigestionBuffTrades,
} from '../../server/domain/itemAutomation/digestionBuffTrade'

const actorId = 'item-actor'
const firstTargetId = 'item-target-one'
const secondTargetId = 'item-target-two'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'item-effect-arena',
  name: 'Item Effect Arena',
  revision: 7,
  dimensions: { x: 8, y: 2, z: 8 },
  voxels: [],
  placements: [{
    id: actorId,
    sheetKind: 'pokemon',
    sheetSlug: 'item-actor-sheet',
    position: { x: 1, y: 0, z: 1 },
    sideId: 'heroes',
  }, {
    id: firstTargetId,
    sheetKind: 'pokemon',
    sheetSlug: 'item-target-one-sheet',
    position: { x: 2, y: 0, z: 1 },
    sideId: 'foes',
  }, {
    id: secondTargetId,
    sheetKind: 'pokemon',
    sheetSlug: 'item-target-two-sheet',
    position: { x: 3, y: 0, z: 1 },
    sideId: 'foes',
  }],
  lights: [],
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
      foes: { id: 'foes', label: 'Foes', status: 'active' },
    },
  },
})

const sheet = (
  slug: string,
  held?: string,
  revision = 3,
  abilities: readonly string[] = [],
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 20,
  revision,
  combat: { currentHp: 50 },
  movelist: [{ name: 'Scratch' }],
  abilities: abilities.map(canonicalId => ({
    name: canonicalId,
    automation: {
      schemaVersion: 1,
      instanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
      canonicalId,
      definitionVersion: null,
      selections: [],
    },
  })),
  equipmentState: held
    ? activeEquipmentState({
        ownerKind: 'pokemon',
        ownerSlug: slug,
        slotId: 'held',
        canonicalItemId: held.split(',').at(-1)!.trim(),
      })
    : createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: slug }),
  ...(held ? { items: { held } } : {}),
})

const sheetsFixture = (input: {
  readonly actorHeld?: string
  readonly firstHeld?: string
  readonly secondHeld?: string
  readonly actorAbilities?: readonly string[]
  readonly firstAbilities?: readonly string[]
  readonly secondAbilities?: readonly string[]
} = {}) => new Map<string, CharacterSheet>([
  ['item-actor-sheet', sheet('item-actor-sheet', input.actorHeld, 3, input.actorAbilities)],
  ['item-target-one-sheet', sheet(
    'item-target-one-sheet', input.firstHeld, 3, input.firstAbilities,
  )],
  ['item-target-two-sheet', sheet(
    'item-target-two-sheet', input.secondHeld, 3, input.secondAbilities,
  )],
])

const requirements = {
  actor: { id: 'items.actor-equipped', source: { kind: 'actor-equipped' } },
  targets: { id: 'items.target-equipped', source: { kind: 'selected-target-equipped' } },
} as const satisfies Record<string, AuthoritativeMoveItemResourceRequirement>

const resourcesFor = (input: {
  readonly map: TabletopMap
  readonly sheets: ReadonlyMap<string, CharacterSheet>
  readonly selectedTargetIds: readonly string[]
  readonly requirements: readonly AuthoritativeMoveItemResourceRequirement[]
  readonly consumedItems?: readonly MoveConsumedItemRecord[]
}): AuthoritativeMoveItemResources => resolveAuthoritativeMoveItemResources({
  map: input.map,
  actorPlacementId: actorId,
  selectedTargetPlacementIds: input.selectedTargetIds,
  pokemonSheets: input.sheets,
  trainerSheets: new Map(),
  groupInventories: new Map(),
  consumedItems: input.consumedItems,
  requirements: input.requirements,
})

const contextFor = (input: {
  readonly map: TabletopMap
  readonly sheets: ReadonlyMap<string, CharacterSheet>
  readonly selectedTargetIds?: readonly string[]
  readonly resources?: AuthoritativeMoveItemResources
}) => buildAuthoritativeMoveRulesContext({
  map: input.map,
  pokemonSheets: input.sheets,
  trainerSheets: new Map(),
  intent: {
    schemaVersion: 1,
    placementId: actorId,
    moveName: 'Scratch',
    selection: input.selectedTargetIds?.length === 2
      ? { kind: 'target-count', targetPlacementIds: [...input.selectedTargetIds] }
      : input.selectedTargetIds?.length === 1
        ? { kind: 'single-target', targetPlacementId: input.selectedTargetIds[0]! }
        : { kind: 'self' },
  },
  selectedPlacementIds: input.selectedTargetIds ?? [],
  random: () => { throw new Error('item effects do not use randomness') },
  time: 1_000,
  itemResources: input.resources ?? emptyAuthoritativeMoveItemResources(),
})

const operation = (input: {
  readonly id: string
  readonly recipients: 'actor' | 'hit-targets' | 'actor-and-attacked-targets'
  readonly payload: Record<string, unknown>
}): MoveItemEffectOperation => parseMoveEffectOperation({
  id: input.id,
  kind: 'item',
  source: { kind: 'move', id: 'move.scratch' },
  recipients: { kind: input.recipients },
  phase: 'after-damage',
  reasonCode: `move.scratch.${input.id}`,
  payload: input.payload,
}) as MoveItemEffectOperation

const emission = (
  itemOperation: MoveItemEffectOperation,
  recipientIds: readonly string[],
): MoveResolvedItemEffectOperation => ({
  operation: itemOperation,
  recipientIds,
})

const interpretAndPlan = (input: {
  readonly map: TabletopMap
  readonly sheets: ReadonlyMap<string, CharacterSheet>
  readonly resources: AuthoritativeMoveItemResources
  readonly operations: readonly MoveResolvedItemEffectOperation[]
  readonly resolvedItemChoices?: readonly MoveSpecResolvedItemChoice[]
}) => {
  const context = contextFor({
    map: input.map,
    sheets: input.sheets,
    selectedTargetIds: [firstTargetId, secondTargetId],
    resources: input.resources,
  })
  const interpretation = interpretMoveItemEffects({
    context,
    operations: input.operations,
    resolvedItemChoices: input.resolvedItemChoices ?? [],
  })
  const plan = planMoveItemMutations({
    map: input.map,
    pokemonSheets: input.sheets,
    trainerSheets: new Map(),
    groupInventories: input.resources.groupInventories,
    consumedItems: input.resources.consumedItems,
    operations: interpretation.mutations,
    originOperationId: 'op_itemeffectscenario1',
    plannedAt: 2_000,
  })
  return { interpretation, plan }
}

const requirementSelection = (requirementId: string, cardinality: 'one' | 'all' = 'one') => ({
  kind: 'requirement',
  requirementId,
  cardinality,
})

const selectedPayload = (
  action: 'give' | 'steal' | 'knock-to-ground' | 'throw' | 'destroy',
  requirementId: string,
  cardinality: 'one' | 'all' = 'one',
) => ({
  action,
  item: requirementSelection(requirementId, cardinality),
  quantity: 1,
  onUnavailable: 'reject',
})

const emittedItemTrace = (
  itemOperation: MoveItemEffectOperation,
  recipientIds: readonly string[],
) => {
  let trace = createMoveResolutionTrace({
    program: {
      canonicalId: 'Item Possession Primitive',
      runtimeKind: 'movespec-v2',
      runtimeVersion: 2,
      definitionHash: 'a'.repeat(64),
    },
    ruleset: {
      rulesetId: 'ruleset-v1',
      sourceDataSha256: 'b'.repeat(64),
    },
    ancestry: [],
  })
  trace = reduceMoveResolutionTrace(trace, {
    kind: 'phase-transition',
    from: null,
    to: 'after-damage',
    reasonCode: 'after-damage-phase',
  })
  return reduceMoveResolutionTrace(trace, {
    kind: 'operation',
    phase: 'after-damage',
    operationId: itemOperation.id,
    operationKind: 'item',
    recipientIds,
    outcome: 'applied',
    reasonCode: itemOperation.reasonCode,
    input: { action: itemOperation.payload.action },
    result: { status: 'emitted' },
  })
}

describe('shared authoritative item effect interpreter', () => {
  it('models Bestow and Covet/Thief with typed give, steal, and prevented outcomes', () => {
    const map = mapFixture()
    const giveSheets = sheetsFixture({ actorHeld: 'Leftovers' })
    const giveResources = resourcesFor({
      map,
      sheets: giveSheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.actor],
    })
    const give = interpretAndPlan({
      map,
      sheets: giveSheets,
      resources: giveResources,
      operations: [emission(operation({
        id: 'item.give',
        recipients: 'hit-targets',
        payload: selectedPayload('give', requirements.actor.id),
      }), [firstTargetId])],
    })
    expect(give.interpretation.results[0]).toMatchObject({ action: 'give', outcome: 'applied' })
    expect(give.plan.sheetWrites.find(write => write.slug === 'item-actor-sheet')?.nextSheet)
      .toMatchObject({ items: {} })
    expect(give.plan.sheetWrites.find(write => write.slug === 'item-target-one-sheet')?.nextSheet)
      .toMatchObject({ items: { held: 'Leftovers' } })

    const stealSheets = sheetsFixture({ firstHeld: 'Iron Ball' })
    const stealResources = resourcesFor({
      map,
      sheets: stealSheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.targets],
    })
    const steal = interpretAndPlan({
      map,
      sheets: stealSheets,
      resources: stealResources,
      operations: [emission(operation({
        id: 'item.steal',
        recipients: 'hit-targets',
        payload: selectedPayload('steal', requirements.targets.id),
      }), [firstTargetId])],
    })
    expect(steal.plan.sheetWrites.find(write => write.slug === 'item-actor-sheet')?.nextSheet)
      .toMatchObject({ items: { held: 'Iron Ball' } })

    const occupiedContext = contextFor({
      map,
      sheets: sheetsFixture({ actorHeld: 'Leftovers', firstHeld: 'Iron Ball' }),
      selectedTargetIds: [firstTargetId],
      resources: stealResources,
    })
    const occupiedOperation = operation({
      id: 'item.steal-no-op',
      recipients: 'hit-targets',
      payload: { ...selectedPayload('steal', requirements.targets.id), onUnavailable: 'no-op' },
    })
    const occupied = interpretMoveItemEffects({
      context: occupiedContext,
      operations: [emission(occupiedOperation, [firstTargetId])],
      resolvedItemChoices: [],
    })
    expect(occupied).toMatchObject({
      mutations: [],
      results: [{
        outcome: 'prevented',
        outcomeCode: 'destination-occupied',
      }],
    })
  })

  it('uses a durable server-owned choice when Bestow has multiple legal items and destinations', () => {
    const map = mapFixture()
    const sheets = sheetsFixture({ actorHeld: 'Leftovers, Iron Ball' })
    const resources = resourcesFor({
      map,
      sheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.actor],
    })
    const choices = enumerateAuthoritativeMoveItemChoices({
      declaration: {
        setId: 'bestow.items',
        requirementId: requirements.actor.id,
        owner: 'recipients',
        emptyPolicy: 'reject',
        filter: {
          referenceKinds: ['pokemon-held'],
          canonicalItemIds: null,
          trainerEquipmentSlots: null,
          minimumQuantity: 1,
        },
        destinations: [{
          id: 'bestow.target',
          kind: 'target-held',
          labelKey: 'move.bestow.target',
        }, {
          id: 'bestow.ground',
          kind: 'map-ground',
          labelKey: 'move.bestow.ground',
        }],
        noneOption: null,
      },
      items: createAuthoritativeMoveItemResourceQueries(resources),
    })
    const selected = choices.choices.find(choice => (
      choice.reference?.canonicalItemId === 'iron-ball'
      && choice.destination?.id === 'bestow.target'
    ))
    expect(selected).toBeDefined()
    const resolvedItemChoices: readonly MoveSpecResolvedItemChoice[] = [{
      operationId: 'bestow.choose-item',
      requestId: 'bestow.window',
      optionId: selected!.option.id,
      choice: selected!,
    }]
    const giveOperation = operation({
      id: 'bestow.give-item',
      recipients: 'hit-targets',
      payload: {
        action: 'give',
        item: {
          kind: 'choice',
          requestId: 'bestow.window',
          destinationId: 'bestow.target',
        },
        quantity: 1,
        onUnavailable: 'reject',
      },
    })

    const planned = interpretAndPlan({
      map,
      sheets,
      resources,
      operations: [emission(giveOperation, [firstTargetId])],
      resolvedItemChoices,
    })

    expect(planned.interpretation.results).toEqual([expect.objectContaining({
      operationId: 'bestow.give-item',
      outcome: 'applied',
      outcomeCode: null,
      itemCount: 1,
    })])
    expect(planned.plan.sheetWrites.find(write => write.slug === 'item-actor-sheet')?.nextSheet)
      .toMatchObject({ items: { held: 'Leftovers' } })
    expect(planned.plan.sheetWrites.find(write => write.slug === 'item-target-one-sheet')?.nextSheet)
      .toMatchObject({ items: { held: 'Iron Ball' } })
    expect(sheets.get('item-actor-sheet')?.items?.held).toBe('Leftovers, Iron Ball')
  })

  it('models Switcheroo/Trick as atomic occupied and empty-endpoint swaps', () => {
    const map = mapFixture()
    const bothSheets = sheetsFixture({ actorHeld: 'Leftovers', firstHeld: 'Iron Ball' })
    const bothResources = resourcesFor({
      map,
      sheets: bothSheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.actor, requirements.targets],
    })
    const swap = interpretAndPlan({
      map,
      sheets: bothSheets,
      resources: bothResources,
      operations: [emission(operation({
        id: 'item.swap',
        recipients: 'hit-targets',
        payload: {
          action: 'swap',
          participants: 'actor-and-first-recipient',
          leftItem: requirementSelection(requirements.actor.id),
          rightItem: requirementSelection(requirements.targets.id),
          onUnavailable: 'reject',
        },
      }), [firstTargetId])],
    })
    expect(swap.plan.operationResults[0]).toMatchObject({
      kind: 'swap',
      quantityPolicy: 'conserve',
    })
    expect(swap.plan.sheetWrites.find(write => write.slug === 'item-actor-sheet')?.nextSheet)
      .toMatchObject({ items: { held: 'Iron Ball' } })
    expect(swap.plan.sheetWrites.find(write => write.slug === 'item-target-one-sheet')?.nextSheet)
      .toMatchObject({ items: { held: 'Leftovers' } })

    const oneSheets = sheetsFixture({ actorHeld: 'Leftovers' })
    const oneResources = resourcesFor({
      map,
      sheets: oneSheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.actor],
    })
    const one = interpretAndPlan({
      map,
      sheets: oneSheets,
      resources: oneResources,
      operations: [emission(operation({
        id: 'item.swap-empty',
        recipients: 'hit-targets',
        payload: {
          action: 'swap',
          participants: 'actor-and-first-recipient',
          leftItem: requirementSelection(requirements.actor.id),
          rightItem: null,
          onUnavailable: 'reject',
        },
      }), [firstTargetId])],
    })
    expect(one.plan.operationResults[0]).toMatchObject({ kind: 'transfer', quantityPolicy: 'conserve' })
    expect(one.plan.sheetWrites.find(write => write.slug === 'item-target-one-sheet')?.nextSheet)
      .toMatchObject({ items: { held: 'Leftovers' } })
  })

  it('models Knock Off and Fling with deterministic authoritative ground cells', () => {
    const map = mapFixture()
    const knockSheets = sheetsFixture({ firstHeld: 'Iron Ball' })
    const knockResources = resourcesFor({
      map,
      sheets: knockSheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.targets],
    })
    const knocked = interpretAndPlan({
      map,
      sheets: knockSheets,
      resources: knockResources,
      operations: [emission(operation({
        id: 'item.knock',
        recipients: 'hit-targets',
        payload: selectedPayload('knock-to-ground', requirements.targets.id),
      }), [firstTargetId])],
    })
    expect(knocked.plan.nextMap.encounterState?.groundItems[0]).toMatchObject({
      canonicalItemId: 'iron-ball',
      position: { x: 2, y: 0, z: 1 },
      ownerPlacementId: firstTargetId,
    })

    const throwSheets = sheetsFixture({ actorHeld: 'Leftovers' })
    const throwResources = resourcesFor({
      map,
      sheets: throwSheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.actor],
    })
    const thrown = interpretAndPlan({
      map,
      sheets: throwSheets,
      resources: throwResources,
      operations: [emission(operation({
        id: 'item.throw',
        recipients: 'hit-targets',
        payload: selectedPayload('throw', requirements.actor.id),
      }), [firstTargetId])],
    })
    expect(thrown.plan.nextMap.encounterState?.groundItems[0]).toMatchObject({
      canonicalItemId: 'leftovers',
      position: { x: 2, y: 0, z: 1 },
      ownerPlacementId: actorId,
    })
  })

  it('uses Sticky Hold to prevent stealing, switching, destroying, and dropping an exact held item', () => {
    const map = mapFixture()
    const sheets = sheetsFixture({
      actorHeld: 'Leftovers', firstHeld: 'Iron Ball', firstAbilities: ['Sticky Hold'],
    })
    const resources = resourcesFor({
      map,
      sheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.actor, requirements.targets],
    })
    const blocked = interpretAndPlan({
      map,
      sheets,
      resources,
      operations: [
        emission(operation({
          id: 'item.sticky-hold-swap', recipients: 'hit-targets',
          payload: {
            action: 'swap', participants: 'actor-and-first-recipient',
            leftItem: requirementSelection(requirements.actor.id),
            rightItem: requirementSelection(requirements.targets.id),
            onUnavailable: 'no-op',
          },
        }), [firstTargetId]),
        emission(operation({
          id: 'item.sticky-hold-destroy', recipients: 'hit-targets',
          payload: {
            ...selectedPayload('destroy', requirements.targets.id), onUnavailable: 'no-op',
          },
        }), [firstTargetId]),
        emission(operation({
          id: 'item.sticky-hold-drop', recipients: 'hit-targets',
          payload: {
            ...selectedPayload('knock-to-ground', requirements.targets.id), onUnavailable: 'no-op',
          },
        }), [firstTargetId]),
      ],
    })
    expect(blocked.interpretation.mutations).toEqual([])
    expect(blocked.interpretation.results).toHaveLength(3)
    expect(blocked.interpretation.results.every(result => (
      result.outcome === 'no-op' && result.outcomeCode === 'selection-unavailable'
    ))).toBe(true)
    expect(blocked.plan.sheetWrites).toEqual([])
    expect(blocked.plan.nextMap.encounterState?.groundItems).toEqual([])
    expect(sheets.get('item-target-one-sheet')?.items?.held).toBe('Iron Ball')

    const stealSheets = sheetsFixture({
      firstHeld: 'Iron Ball', firstAbilities: ['Sticky Hold'],
    })
    const stealResources = resourcesFor({
      map, sheets: stealSheets, selectedTargetIds: [firstTargetId],
      requirements: [requirements.targets],
    })
    const stolen = interpretAndPlan({
      map, sheets: stealSheets, resources: stealResources,
      operations: [emission(operation({
        id: 'item.sticky-hold-steal', recipients: 'hit-targets',
        payload: {
          ...selectedPayload('steal', requirements.targets.id), onUnavailable: 'no-op',
        },
      }), [firstTargetId])],
    })
    expect(stolen.interpretation).toMatchObject({
      mutations: [],
      results: [{ outcome: 'no-op', outcomeCode: 'selection-unavailable' }],
    })
    expect(stealSheets.get('item-target-one-sheet')?.items?.held).toBe('Iron Ball')
  })

  it('rejects illegal possession and ground transitions without changing inputs or emitting partial writes', () => {
    const map = mapFixture()
    const ownerMismatchSheets = sheetsFixture({ firstHeld: 'Iron Ball' })
    const ownerMismatchResources = resourcesFor({
      map,
      sheets: ownerMismatchSheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.targets],
    })
    const badGive = operation({
      id: 'item.bad-give-owner',
      recipients: 'hit-targets',
      payload: {
        ...selectedPayload('give', requirements.targets.id),
        onUnavailable: 'no-op',
      },
    })
    const ownerMismatchSnapshot = {
      map: structuredClone(map),
      sheets: structuredClone(ownerMismatchSheets),
      resources: structuredClone(ownerMismatchResources),
    }

    expect(() => interpretMoveItemEffects({
      context: contextFor({
        map,
        sheets: ownerMismatchSheets,
        selectedTargetIds: [firstTargetId],
        resources: ownerMismatchResources,
      }),
      operations: [emission(badGive, [firstTargetId])],
      resolvedItemChoices: [],
    })).toThrowError(expect.objectContaining({
      name: MoveItemEffectInterpretationError.name,
      code: 'selection-owner-mismatch',
    }))
    expect(map).toEqual(ownerMismatchSnapshot.map)
    expect(ownerMismatchSheets).toEqual(ownerMismatchSnapshot.sheets)
    expect(ownerMismatchResources).toEqual(ownerMismatchSnapshot.resources)

    const emptySheets = sheetsFixture()
    const emptyResources = resourcesFor({
      map,
      sheets: emptySheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.targets],
    })
    const noItem = interpretMoveItemEffects({
      context: contextFor({
        map,
        sheets: emptySheets,
        selectedTargetIds: [firstTargetId],
        resources: emptyResources,
      }),
      operations: [emission(operation({
        id: 'item.knock-no-item',
        recipients: 'hit-targets',
        payload: {
          ...selectedPayload('knock-to-ground', requirements.targets.id),
          onUnavailable: 'no-op',
        },
      }), [firstTargetId])],
      resolvedItemChoices: [],
    })
    expect(noItem).toMatchObject({
      mutations: [],
      results: [{ outcome: 'no-op', outcomeCode: 'selection-unavailable' }],
    })

    const throwSheets = sheetsFixture({ actorHeld: 'Leftovers' })
    const throwResources = resourcesFor({
      map,
      sheets: throwSheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.actor],
    })
    const throwInterpretation = interpretMoveItemEffects({
      context: contextFor({
        map,
        sheets: throwSheets,
        selectedTargetIds: [firstTargetId],
        resources: throwResources,
      }),
      operations: [emission(operation({
        id: 'item.ground-collision',
        recipients: 'hit-targets',
        payload: selectedPayload('throw', requirements.actor.id),
      }), [firstTargetId])],
      resolvedItemChoices: [],
    })
    const initialThrowPlan = planMoveItemMutations({
      map,
      pokemonSheets: throwSheets,
      trainerSheets: new Map(),
      groupInventories: new Map(),
      operations: throwInterpretation.mutations,
      originOperationId: 'op_itemgroundcollision1',
      plannedAt: 2_000,
    })
    const collidingItem = initialThrowPlan.nextMap.encounterState?.groundItems[0]
    expect(collidingItem).toBeDefined()
    const collisionMap: TabletopMap = {
      ...map,
      encounterState: {
        ...map.encounterState!,
        groundItems: [structuredClone(collidingItem!)],
      },
    }
    const collisionSnapshot = structuredClone(collisionMap)
    const sheetSnapshot = structuredClone(throwSheets)

    expect(() => planMoveItemMutations({
      map: collisionMap,
      pokemonSheets: throwSheets,
      trainerSheets: new Map(),
      groupInventories: new Map(),
      operations: throwInterpretation.mutations,
      originOperationId: 'op_itemgroundcollision2',
      plannedAt: 2_001,
    })).toThrowError(expect.objectContaining({
      name: MoveItemMutationError.name,
      code: 'destination-occupied',
    }))
    expect(collisionMap).toEqual(collisionSnapshot)
    expect(throwSheets).toEqual(sheetSnapshot)
  })

  it('projects applied possession mutations and prevented outcomes into private item traces', () => {
    const map = mapFixture()
    const sheets = sheetsFixture({ actorHeld: 'Leftovers' })
    const resources = resourcesFor({
      map,
      sheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.actor],
    })
    const giveOperation = operation({
      id: 'item.traced-give',
      recipients: 'hit-targets',
      payload: selectedPayload('give', requirements.actor.id),
    })
    const interpretation = interpretMoveItemEffects({
      context: contextFor({
        map,
        sheets,
        selectedTargetIds: [firstTargetId],
        resources,
      }),
      operations: [emission(giveOperation, [firstTargetId])],
      resolvedItemChoices: [],
    })
    const plan = planMoveItemMutations({
      map,
      pokemonSheets: sheets,
      trainerSheets: new Map(),
      groupInventories: new Map(),
      operations: interpretation.mutations,
      originOperationId: 'op_itemtracedgive01',
      plannedAt: 2_000,
    })
    const audited = applyMoveItemEffectResultsToTrace({
      trace: emittedItemTrace(giveOperation, [firstTargetId]),
      interpretation,
      mutationResults: plan.operationResults,
    })

    expect(audited.events.find(event => event.kind === 'operation')).toMatchObject({
      kind: 'operation',
      operationId: 'item.traced-give',
      outcome: 'applied',
      result: {
        status: 'applied',
        action: 'give',
        outcomeCode: null,
        itemCount: 1,
        mutationCount: 1,
        quantityEffects: [{ canonicalItemId: 'leftovers', delta: 0 }],
        resourceScopeCount: 2,
      },
    })

    const occupiedSheets = sheetsFixture({ actorHeld: 'Leftovers', firstHeld: 'Iron Ball' })
    const occupiedResources = resourcesFor({
      map,
      sheets: occupiedSheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.actor],
    })
    const preventedOperation = operation({
      id: 'item.traced-prevented-give',
      recipients: 'hit-targets',
      payload: {
        ...selectedPayload('give', requirements.actor.id),
        onUnavailable: 'no-op',
      },
    })
    const preventedInterpretation = interpretMoveItemEffects({
      context: contextFor({
        map,
        sheets: occupiedSheets,
        selectedTargetIds: [firstTargetId],
        resources: occupiedResources,
      }),
      operations: [emission(preventedOperation, [firstTargetId])],
      resolvedItemChoices: [],
    })
    const preventedTrace = applyMoveItemEffectResultsToTrace({
      trace: emittedItemTrace(preventedOperation, [firstTargetId]),
      interpretation: preventedInterpretation,
      mutationResults: [],
    })
    expect(preventedTrace.events.find(event => event.kind === 'operation')).toMatchObject({
      outcome: 'prevented',
      result: {
        status: 'prevented',
        action: 'give',
        outcomeCode: 'destination-occupied',
        itemCount: 0,
        mutationCount: 0,
        quantityEffects: [],
        resourceScopeCount: 0,
      },
    })
  })

  it('records consumption provenance and replays only server-loaded Recycle evidence', () => {
    const map = mapFixture()
    const initialSheets = sheetsFixture({ actorHeld: 'Leftovers' })
    const initialResources = resourcesFor({
      map,
      sheets: initialSheets,
      selectedTargetIds: [],
      requirements: [requirements.actor],
    })
    const consumeOperation = operation({
      id: 'item.consume-leftovers',
      recipients: 'actor',
      payload: {
        action: 'consume',
        item: requirementSelection(requirements.actor.id),
        quantity: 1,
        consumptionId: 'consumption.leftovers',
        onUnavailable: 'reject',
      },
    })
    const consumed = interpretAndPlan({
      map,
      sheets: initialSheets,
      resources: initialResources,
      operations: [emission(consumeOperation, [actorId])],
    })
    const consumedRecord = consumed.plan.consumedItems[0]
    expect(consumedRecord).toEqual({
      consumptionId: 'consumption.leftovers',
      sourceOperationId: 'item.consume-leftovers.mutation-1',
      source: initialResources.candidates[0]?.reference,
      canonicalItemId: 'leftovers',
      quantity: 1,
    })

    const afterConsumeActor = consumed.plan.sheetWrites.find(
      write => write.slug === 'item-actor-sheet',
    )?.nextSheet as CharacterSheet
    const afterConsumeSheets = new Map(initialSheets)
    afterConsumeSheets.set('item-actor-sheet', afterConsumeActor)
    const recycleResources = resourcesFor({
      map,
      sheets: afterConsumeSheets,
      selectedTargetIds: [],
      requirements: [],
      consumedItems: [consumedRecord!],
    })
    const recycleOperation = operation({
      id: 'item.recycle-effect',
      recipients: 'actor',
      payload: {
        action: 'restore',
        consumptionId: 'consumption.leftovers',
        mode: 'effect',
        destination: null,
        onUnavailable: 'reject',
      },
    })
    const recycled = interpretAndPlan({
      map,
      sheets: afterConsumeSheets,
      resources: recycleResources,
      operations: [emission(recycleOperation, [actorId])],
    })

    expect(recycled.plan.operationResults[0]).toMatchObject({
      kind: 'reuse-consumed',
      quantityPolicy: 'conserve',
      quantityEffects: [{ canonicalItemId: 'leftovers', delta: 0 }],
      consumptionId: 'consumption.leftovers',
    })
    expect(recycled.plan.sheetWrites).toEqual([])
    expect(recycled.plan.availableConsumedItems).toEqual([consumedRecord])
    const auditTrace = applyMoveItemEffectResultsToTrace({
      trace: emittedItemTrace(recycleOperation, [actorId]),
      interpretation: recycled.interpretation,
      mutationResults: recycled.plan.operationResults,
    })
    expect(auditTrace.events.find(event => event.kind === 'operation')).toMatchObject({
      result: {
        action: 'restore',
        consumptionIds: ['consumption.leftovers'],
        quantityEffects: [{ canonicalItemId: 'leftovers', delta: 0 }],
      },
    })
  })

  it('fails closed when held-item restoration lacks serialized authority and makes destruction explicit', () => {
    const map = mapFixture()
    const historicalSheets = sheetsFixture({ actorHeld: 'Leftovers' })
    const historicalResources = resourcesFor({
      map,
      sheets: historicalSheets,
      selectedTargetIds: [],
      requirements: [requirements.actor],
    })
    const consumedRecord: MoveConsumedItemRecord = {
      consumptionId: 'consumption.physical-leftovers',
      sourceOperationId: 'item.prior-consume',
      source: historicalResources.candidates[0]!.reference,
      canonicalItemId: 'leftovers',
      quantity: 1,
    }
    const emptySheets = sheetsFixture()
    const restoreResources = resourcesFor({
      map,
      sheets: emptySheets,
      selectedTargetIds: [],
      requirements: [],
      consumedItems: [consumedRecord],
    })
    expect(() => interpretAndPlan({
      map,
      sheets: emptySheets,
      resources: restoreResources,
      operations: [emission(operation({
        id: 'item.restore-physical',
        recipients: 'actor',
        payload: {
          action: 'restore',
          consumptionId: consumedRecord.consumptionId,
          mode: 'item',
          destination: 'actor-held',
          onUnavailable: 'reject',
        },
      }), [actorId])],
    })).toThrowError(expect.objectContaining({
      name: MoveItemMutationError.name,
      code: 'unsupported-location',
    }))

    const destroySheets = sheetsFixture({ firstHeld: 'Iron Ball' })
    const destroyResources = resourcesFor({
      map,
      sheets: destroySheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.targets],
    })
    const destroyed = interpretAndPlan({
      map,
      sheets: destroySheets,
      resources: destroyResources,
      operations: [emission(operation({
        id: 'item.incinerate-destroy',
        recipients: 'hit-targets',
        payload: selectedPayload('destroy', requirements.targets.id),
      }), [firstTargetId])],
    })
    expect(destroyed.plan.sheetWrites[0]?.nextSheet).toMatchObject({ items: {} })
    expect(destroyed.plan.operationResults[0]).toMatchObject({
      kind: 'destroy',
      quantityPolicy: 'destroy',
      quantityEffects: [{ canonicalItemId: 'iron-ball', delta: -1 }],
      consumptionId: null,
    })
    expect(destroyed.plan.consumedItems).toEqual([])
    expect(destroySheets.get('item-target-one-sheet')?.items?.held).toBe('Iron Ball')
  })

  it('models Embargo and Corrosive Gas as suppression without unequipping', () => {
    const map = mapFixture()
    const sheets = sheetsFixture({ firstHeld: 'Iron Ball', secondHeld: 'Leftovers' })
    const allResources = resourcesFor({
      map,
      sheets,
      selectedTargetIds: [firstTargetId, secondTargetId],
      requirements: [requirements.targets],
    })
    const first = operation({
      id: 'item.embargo-first',
      recipients: 'hit-targets',
      payload: {
        action: 'suppress',
        item: null,
        scope: 'all-equipped',
        blocksUse: true,
        blocksBenefit: true,
        effectId: 'embargo.items',
        duration: { kind: 'scene', remaining: null },
        replacement: 'replace-by-source',
        onUnavailable: 'reject',
      },
    })
    const second = operation({
      id: 'item.embargo-second',
      recipients: 'hit-targets',
      payload: { ...first.payload, action: 'suppress' },
    })
    const replaced = interpretAndPlan({
      map,
      sheets,
      resources: allResources,
      operations: [
        emission(first, [firstTargetId]),
        emission(second, [secondTargetId]),
      ],
    })
    expect(replaced.interpretation.results.map(result => result.itemCount)).toEqual([1, 1])
    expect(replaced.plan.nextMap.encounterState?.effects).toHaveLength(1)
    expect(replaced.plan.nextMap.encounterState?.effects[0]).toMatchObject({
      kind: 'item-suppression',
      affected: { placementIds: [secondTargetId] },
      payload: {
        familyId: 'embargo.items',
        scope: 'all-equipped',
        blocksUse: true,
        blocksBenefit: true,
      },
    })
    expect(replaced.plan.sheetWrites).toEqual([])

    const bound = interpretAndPlan({
      map,
      sheets,
      resources: allResources,
      operations: [emission(operation({
        id: 'item.corrosive-gas',
        recipients: 'hit-targets',
        payload: {
          action: 'suppress',
          item: requirementSelection(requirements.targets.id, 'all'),
          scope: 'selected-items',
          blocksUse: true,
          blocksBenefit: false,
          effectId: 'corrosive-gas.items',
          duration: { kind: 'scene', remaining: null },
          replacement: 'independent',
          onUnavailable: 'no-op',
        },
      }), [firstTargetId, secondTargetId])],
    })
    const effects = bound.plan.nextMap.encounterState?.effects ?? []
    expect(effects).toHaveLength(2)
    expect(effects.every(effect => (
      effect.kind === 'item-suppression'
      && effect.payload.scope === 'item-bindings'
      && effect.payload.itemBindingIds.length === 1
    ))).toBe(true)
    expect(bound.plan.sheetWrites).toEqual([])
    expect(sheets.get('item-target-one-sheet')?.items?.held).toBe('Iron Ball')
    expect(sheets.get('item-target-two-sheet')?.items?.held).toBe('Leftovers')
    expect(JSON.stringify(effects)).not.toContain('item-target-one-sheet')
  })

  it('stores and consumes the bounded Stuff Cheeks digestion buff atomically', () => {
    const map = mapFixture()
    const initialSheets = sheetsFixture({ actorHeld: 'Candy Bar' })
    const resources = resourcesFor({
      map,
      sheets: initialSheets,
      selectedTargetIds: [],
      requirements: [requirements.actor],
    })
    const stored = interpretAndPlan({
      map,
      sheets: initialSheets,
      resources,
      operations: [emission(operation({
        id: 'item.store-food-buff',
        recipients: 'actor',
        payload: {
          action: 'store-buff',
          item: requirementSelection(requirements.actor.id),
          quantity: 1,
          consumptionId: 'consumption.candy-bar-buff',
          onUnavailable: 'reject',
        },
      }), [actorId])],
    })
    const storedActor = stored.plan.sheetWrites.find(
      write => write.slug === 'item-actor-sheet',
    )?.nextSheet as CharacterSheet
    expect(storedActor.items).toEqual({ digestionFood: 'Candy Bar' })
    expect(stored.plan.operationResults[0]).toMatchObject({
      kind: 'store-digestion-buff',
      quantityPolicy: 'consume',
      quantityEffects: [{ canonicalItemId: 'candy-bar', delta: -1 }],
      consumptionId: 'consumption.candy-bar-buff',
    })
    expect(stored.plan.consumedItems[0]).toMatchObject({
      sourceOperationId: 'item.store-food-buff.mutation-1',
      canonicalItemId: 'candy-bar',
      quantity: 1,
    })

    const digestSheets = new Map(initialSheets)
    digestSheets.set('item-actor-sheet', storedActor)
    const digestOperation = operation({
      id: 'item.stuff-cheeks-digest',
      recipients: 'actor',
      payload: {
        action: 'digest-buff',
        canonicalItemIds: ['candy-bar'],
        onUnavailable: 'reject',
      },
    })
    const digestInterpretation = interpretMoveItemEffects({
      context: contextFor({ map, sheets: digestSheets }),
      operations: [emission(digestOperation, [actorId])],
      resolvedItemChoices: [],
    })
    const digested = planMoveItemMutations({
      map,
      pokemonSheets: digestSheets,
      trainerSheets: new Map(),
      groupInventories: new Map(),
      operations: digestInterpretation.mutations,
      originOperationId: 'op_itemeffectdigest01',
      plannedAt: 3_000,
    })
    expect((digested.sheetWrites[0]?.nextSheet as CharacterSheet).items).toEqual({})
    expect(digested.operationResults[0]).toMatchObject({
      kind: 'digest-buff',
      digestedCanonicalItemId: 'candy-bar',
      quantityPolicy: 'conserve',
      quantityEffects: [{ canonicalItemId: 'candy-bar', delta: 0 }],
    })
    expect(digested.nextMap.encounterState?.effects).toMatchObject([{
      kind: 'capability',
      duration: { kind: 'scene', remaining: null },
      affected: { placementIds: [actorId] },
      payload: {
        capabilityId: 'digestion-buff-traded-this-scene',
        action: 'grant',
      },
      tags: expect.arrayContaining(['digestion-buff-trade']),
    }])
    expect(storedActor.items?.digestionFood).toBe('Candy Bar')
    expect(resolveReviewedDigestionBuffTrades(digestInterpretation)).toEqual([{
      operationId: 'item.stuff-cheeks-digest',
      canonicalItemId: 'Candy Bar',
      recipientIds: [actorId],
      sheetKind: 'pokemon',
      sheetSlug: 'item-actor-sheet',
    }])
    expect(createDigestionBuffTradeOperations({ interpretation: digestInterpretation })).toEqual([
      expect.objectContaining({
        recipientIds: [actorId],
        operation: expect.objectContaining({ kind: 'heal', reasonCode: ITEM_DIGESTION_TRADE_HEAL_REASON }),
      }),
    ])
  })

  it('materializes Leftovers as authoritative encounter-duration turn-start healing', () => {
    const map = mapFixture()
    const initialSheets = sheetsFixture()
    initialSheets.get('item-actor-sheet')!.items = { digestionFood: 'Leftovers' }
    const digestOperation = operation({
      id: 'item.leftovers-digest', recipients: 'actor', payload: {
        action: 'digest-buff', canonicalItemIds: null, onUnavailable: 'reject',
      },
    })
    const interpretation = interpretMoveItemEffects({
      context: contextFor({ map, sheets: initialSheets }),
      operations: [emission(digestOperation, [actorId])], resolvedItemChoices: [],
    })
    expect(resolveReviewedDigestionBuffTrades(interpretation)).toEqual([{
      operationId: 'item.leftovers-digest', canonicalItemId: 'Leftovers', recipientIds: [actorId],
      sheetKind: 'pokemon', sheetSlug: 'item-actor-sheet',
    }])
    expect(createDigestionBuffTradeOperations({ interpretation })).toEqual([
      expect.objectContaining({
        recipientIds: [actorId],
        operation: expect.objectContaining({
          kind: 'temporary-effect', reasonCode: ITEM_DIGESTION_TRADE_EFFECT_REASON,
          payload: expect.objectContaining({
            definition: expect.objectContaining({
              duration: { kind: 'encounter', remaining: null },
              payload: expect.objectContaining({ value: 1 }),
            }),
          }),
        }),
      }),
    ])
  })

  it('blocks digestion-buff trades only for an exact active Unnerve marker', () => {
    const initialSheets = sheetsFixture()
    initialSheets.get('item-actor-sheet')!.items = { digestionFood: 'Candy Bar' }
    const marker = {
      ...capabilityEncounterEffectFixture(),
      id: 'effect.aa097.unnerve.item-actor',
      source: {
        operationId: 'op_aa097_unnerve_01',
        moveId: 'ability.unnerve',
        placementId: firstTargetId,
      },
      affected: { placementIds: [actorId], sideIds: [], cells: [] },
      duration: { kind: 'turns' as const, subject: 'source' as const, boundary: 'start' as const, remaining: 1 },
      tags: ['ability', 'aa097-unnerve'],
      payload: {
        capabilityId: 'aa097.unnerve.block-stages-and-digestion',
        action: 'grant' as const,
      },
      suppression: { sources: [] },
    }
    const map = {
      ...mapFixture(),
      encounterState: {
        ...mapFixture().encounterState!,
        effects: [marker],
      },
    }
    const digestOperation = operation({
      id: 'item.unnerve-blocked-digest',
      recipients: 'actor',
      payload: {
        action: 'digest-buff',
        canonicalItemIds: ['candy-bar'],
        onUnavailable: 'reject',
      },
    })
    expect(() => interpretMoveItemEffects({
      context: contextFor({ map, sheets: initialSheets }),
      operations: [emission(digestOperation, [actorId])],
      resolvedItemChoices: [],
    })).toThrow(/no eligible stored digestion buff/i)

    const unrelatedTaggedMap = {
      ...map,
      encounterState: {
        ...map.encounterState!,
        effects: [{
          ...marker,
          payload: { ...marker.payload, capabilityId: 'test.unrelated-capability' },
        }],
      },
    }
    expect(interpretMoveItemEffects({
      context: contextFor({ map: unrelatedTaggedMap, sheets: initialSheets }),
      operations: [emission(digestOperation, [actorId])],
      resolvedItemChoices: [],
    }).mutations).toHaveLength(1)
  })

  it('stores three scene-traded Berry Storage buffs outside normal digestion limits', () => {
    const map = {
      ...mapFixture(),
      encounterState: {
        ...mapFixture().encounterState!,
        history: { ...mapFixture().encounterState!.history, sceneId: 'scene:berry-storage' },
      },
    }
    const initialSheets = sheetsFixture({ actorHeld: 'Oran Berry' })
    const actor = initialSheets.get('item-actor-sheet')!
    actor.abilities = [{
      name: 'Berry Storage', automation: {
        schemaVersion: 1, instanceId: 'base:berry-storage', canonicalId: 'Berry Storage',
        definitionVersion: null, selections: [],
      },
    }]
    const resources = resourcesFor({ map, sheets: initialSheets, selectedTargetIds: [], requirements: [requirements.actor] })
    const stored = interpretAndPlan({
      map, sheets: initialSheets, resources,
      operations: [emission(operation({
        id: 'item.berry-storage', recipients: 'actor', payload: {
          action: 'store-buff', item: requirementSelection(requirements.actor.id), quantity: 1,
          consumptionId: 'consumption.berry-storage', onUnavailable: 'reject',
        },
      }), [actorId])],
    })
    const storedActor = stored.plan.sheetWrites.find(write => write.slug === 'item-actor-sheet')?.nextSheet as CharacterSheet
    expect(storedActor.items?.digestionFood).toBeUndefined()
    expect(storedActor.berryStorage?.entries).toEqual([expect.objectContaining({
      canonicalItemId: 'oran-berry', quantity: 3, lastTradedSceneId: null,
    })])
    expect(storedActor.abilityUsage?.entries[0]).toMatchObject({ canonicalId: 'Berry Storage', spent: 1, limit: 1 })

    const digestSheets = new Map(initialSheets)
    digestSheets.set('item-actor-sheet', storedActor)
    const digestOperation = operation({
      id: 'item.berry-storage-digest', recipients: 'actor', payload: {
        action: 'digest-buff', canonicalItemIds: ['oran-berry'], onUnavailable: 'reject',
      },
    })
    const interpretation = interpretMoveItemEffects({
      context: contextFor({ map, sheets: digestSheets }),
      operations: [emission(digestOperation, [actorId])], resolvedItemChoices: [],
    })
    const digested = planMoveItemMutations({
      map, pokemonSheets: digestSheets, trainerSheets: new Map(), groupInventories: new Map(),
      operations: interpretation.mutations, originOperationId: 'op_berry_storage_digest', plannedAt: 3_000,
    })
    const digestedActor = digested.sheetWrites[0]?.nextSheet as CharacterSheet
    expect(digestedActor.berryStorage?.entries[0]).toMatchObject({ quantity: 2, lastTradedSceneId: 'scene:berry-storage' })
    const currentSheets = new Map(digestSheets).set('item-actor-sheet', digestedActor)
    expect(() => interpretMoveItemEffects({
      context: contextFor({ map: digested.nextMap, sheets: currentSheets }),
      operations: [emission(digestOperation, [actorId])], resolvedItemChoices: [],
    })).toThrow(/no eligible stored digestion buff/i)
  })

  it('stores at most three simultaneous Food Buffs for effective Gluttony', () => {
    const map = mapFixture()
    const initialSheets = sheetsFixture({ actorHeld: 'Candy Bar' })
    const actor = initialSheets.get('item-actor-sheet')!
    actor.abilities = [{
      name: 'Gluttony', automation: {
        schemaVersion: 1, instanceId: 'base:gluttony', canonicalId: 'Gluttony',
        definitionVersion: null, selections: [],
      },
    }]
    actor.items = {
      ...actor.items,
      digestionFoods: ['Oran Berry', 'Cheri Berry'],
    }
    const resources = resourcesFor({
      map, sheets: initialSheets, selectedTargetIds: [], requirements: [requirements.actor],
    })
    const stored = interpretAndPlan({
      map,
      sheets: initialSheets,
      resources,
      operations: [emission(operation({
        id: 'item.gluttony-store-third', recipients: 'actor', payload: {
          action: 'store-buff', item: requirementSelection(requirements.actor.id), quantity: 1,
          consumptionId: 'consumption.gluttony-third', onUnavailable: 'reject',
        },
      }), [actorId])],
    })
    const nextActor = stored.plan.sheetWrites.find(write => write.slug === 'item-actor-sheet')?.nextSheet as CharacterSheet
    expect(nextActor.items?.digestionFoods).toEqual(['Oran Berry', 'Cheri Berry', 'Candy Bar'])
    expect(nextActor.items?.digestionFood).toBeUndefined()
  })

  it('falls back to one Food Buff slot when Gluttony is authoritatively suppressed', () => {
    const baseMap = mapFixture()
    const map: TabletopMap = {
      ...baseMap,
      encounterState: {
        ...baseMap.encounterState!,
        effects: [{
          ...creatureRuleOverlayEncounterEffectFixture({
            domain: 'ability', action: 'suppress', values: [],
            referencePlacementId: null, suppressionScope: 'all',
          }),
          id: 'effect.aa072.suppress-gluttony',
          affected: { placementIds: [actorId], sideIds: [], cells: [] },
        }],
      },
    }
    const initialSheets = sheetsFixture({ actorHeld: 'Candy Bar' })
    const actor = initialSheets.get('item-actor-sheet')!
    actor.abilities = [{
      name: 'Gluttony', automation: {
        schemaVersion: 1, instanceId: 'base:gluttony', canonicalId: 'Gluttony',
        definitionVersion: null, selections: [],
      },
    }]
    actor.items = { ...actor.items, digestionFoods: ['Oran Berry'] }
    const resources = resourcesFor({
      map, sheets: initialSheets, selectedTargetIds: [], requirements: [requirements.actor],
    })
    const storeOperation = emission(operation({
      id: 'item.suppressed-gluttony-store', recipients: 'actor', payload: {
        action: 'store-buff', item: requirementSelection(requirements.actor.id), quantity: 1,
        consumptionId: 'consumption.suppressed-gluttony', onUnavailable: 'reject',
      },
    }), [actorId])
    expect(() => interpretAndPlan({
      map, sheets: initialSheets, resources, operations: [storeOperation],
    })).toThrow(/unavailable|eligible|capacity|already stores/i)

    const unsuppressedMap = mapFixture()
    const unsuppressedResources = resourcesFor({
      map: unsuppressedMap, sheets: initialSheets, selectedTargetIds: [],
      requirements: [requirements.actor],
    })
    const interpretation = interpretMoveItemEffects({
      context: contextFor({
        map: unsuppressedMap, sheets: initialSheets, resources: unsuppressedResources,
      }),
      operations: [storeOperation],
      resolvedItemChoices: [],
    })
    expect(() => planMoveItemMutations({
      map,
      pokemonSheets: initialSheets,
      trainerSheets: new Map(),
      groupInventories: new Map(),
      operations: interpretation.mutations,
      originOperationId: 'op_suppressed_gluttony_boundary',
      plannedAt: 2_000,
    })).toThrow(/capacity 1/i)
  })

  it('rejects malformed or oversized digestion arrays before expanding their entries', () => {
    const map = mapFixture()
    for (const [index, digestionFoods] of [
      ['Oran Berry', null],
      ['Oran Berry', 'Cheri Berry', 'Candy Bar', 'Sitrus Berry'],
    ].entries()) {
      const sheets = sheetsFixture()
      const actor = sheets.get('item-actor-sheet')!
      actor.items = { digestionFoods: digestionFoods as unknown as string[] }
      const digest = operation({
        id: `item.malformed-digestion-${index}`,
        recipients: 'actor',
        payload: { action: 'digest-buff', canonicalItemIds: null, onUnavailable: 'reject' },
      })
      expect(() => interpretMoveItemEffects({
        context: contextFor({ map, sheets }),
        operations: [emission(digest, [actorId])],
        resolvedItemChoices: [],
      })).toThrow(/malformed|bounded capacity/i)
    }
  })

  it('migrates the legacy one-use Scene marker when Gluttony trades another buff', () => {
    let map = mapFixture()
    const placement = map.placements.find(candidate => candidate.id === actorId)!
    const legacyMarker = {
      ...createDigestionBuffTradeEffect({
        map, placement, operationId: 'legacy.digest', moveId: 'bug-bite',
      }),
      stackPolicy: { kind: 'replace' as const, maxStacks: null },
    }
    map = { ...map, encounterState: { ...map.encounterState!, effects: [legacyMarker] } }
    let currentSheets = sheetsFixture()
    const actor = currentSheets.get('item-actor-sheet')!
    actor.abilities = [{
      name: 'Gluttony', automation: {
        schemaVersion: 1, instanceId: 'base:gluttony', canonicalId: 'Gluttony',
        definitionVersion: null, selections: [],
      },
    }]
    actor.items = { digestionFoods: ['Candy Bar', 'Oran Berry'] }
    const digestOperation = operation({
      id: 'item.gluttony-migrate-marker', recipients: 'actor', payload: {
        action: 'digest-buff', canonicalItemIds: ['candy-bar'], onUnavailable: 'reject',
      },
    })
    const interpretation = interpretMoveItemEffects({
      context: contextFor({ map, sheets: currentSheets }),
      operations: [emission(digestOperation, [actorId])],
      resolvedItemChoices: [],
    })
    const planned = planMoveItemMutations({
      map,
      pokemonSheets: currentSheets,
      trainerSheets: new Map(),
      groupInventories: new Map(),
      operations: interpretation.mutations,
      originOperationId: 'op_gluttony_migrate_marker',
      plannedAt: 3_000,
    })
    const marker = planned.nextMap.encounterState?.effects.find(effect => (
      effect.id === legacyMarker.id
    ))
    expect(marker?.stacks).toBe(2)
    expect(marker?.stackPolicy).toEqual({ kind: 'add-stack', maxStacks: 64 })
    const nextActor = planned.sheetWrites[0]!.nextSheet as CharacterSheet
    expect(nextActor.items?.digestionFoods).toEqual(['Oran Berry'])
  })

  it('lets effective Gluttony trade three stored Food Buffs per Scene and rejects a fourth', () => {
    let map = mapFixture()
    let currentSheets = sheetsFixture()
    const actor = currentSheets.get('item-actor-sheet')!
    actor.abilities = [{
      name: 'Gluttony', automation: {
        schemaVersion: 1, instanceId: 'base:gluttony', canonicalId: 'Gluttony',
        definitionVersion: null, selections: [],
      },
    }]
    actor.items = {
      digestionFoods: ['Candy Bar', 'Oran Berry', 'Cheri Berry'],
    }
    const ids = ['candy-bar', 'oran-berry', 'cheri-berry']
    for (const [index, canonicalItemId] of ids.entries()) {
      const digestOperation = operation({
        id: `item.gluttony-digest-${index + 1}`,
        recipients: 'actor',
        payload: { action: 'digest-buff', canonicalItemIds: [canonicalItemId], onUnavailable: 'reject' },
      })
      const interpretation = interpretMoveItemEffects({
        context: contextFor({ map, sheets: currentSheets }),
        operations: [emission(digestOperation, [actorId])],
        resolvedItemChoices: [],
      })
      const planned = planMoveItemMutations({
        map,
        pokemonSheets: currentSheets,
        trainerSheets: new Map(),
        groupInventories: new Map(),
        operations: interpretation.mutations,
        originOperationId: `op_gluttony_digest_${index + 1}`,
        plannedAt: 3_000 + index,
      })
      map = planned.nextMap
      currentSheets = new Map(currentSheets).set(
        'item-actor-sheet',
        planned.sheetWrites[0]!.nextSheet as CharacterSheet,
      )
    }
    const usage = map.encounterState?.effects.find(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId === 'digestion-buff-traded-this-scene'
    ))
    expect(usage?.stacks).toBe(3)
    expect(currentSheets.get('item-actor-sheet')?.items?.digestionFoods).toBeUndefined()
    const afterThree = structuredClone(currentSheets.get('item-actor-sheet')!)
    afterThree.items = { ...(afterThree.items ?? {}), digestionFoods: ['Sitrus Berry'] }
    currentSheets = new Map(currentSheets).set('item-actor-sheet', afterThree)

    const fourth = operation({
      id: 'item.gluttony-digest-4', recipients: 'actor', payload: {
        action: 'digest-buff', canonicalItemIds: ['sitrus-berry'], onUnavailable: 'reject',
      },
    })
    expect(() => interpretMoveItemEffects({
      context: contextFor({ map, sheets: currentSheets }),
      operations: [emission(fourth, [actorId])],
      resolvedItemChoices: [],
    })).toThrow(/no eligible stored digestion buff/i)
  })

  it('rejects illegal lifecycle transitions deterministically without a partial plan', () => {
    const map = mapFixture()
    const emptySheets = sheetsFixture()
    const missingRestore = operation({
      id: 'item.recycle-missing',
      recipients: 'actor',
      payload: {
        action: 'restore',
        consumptionId: 'consumption.missing',
        mode: 'effect',
        destination: null,
        onUnavailable: 'no-op',
      },
    })
    expect(interpretMoveItemEffects({
      context: contextFor({ map, sheets: emptySheets }),
      operations: [emission(missingRestore, [actorId])],
      resolvedItemChoices: [],
    })).toMatchObject({
      mutations: [],
      results: [{ outcome: 'no-op', outcomeCode: 'selection-unavailable' }],
    })

    const occupiedSheets = sheetsFixture({ actorHeld: 'Leftovers' })
    const occupiedResources = resourcesFor({
      map,
      sheets: occupiedSheets,
      selectedTargetIds: [],
      requirements: [requirements.actor],
    })
    const consumedRecord: MoveConsumedItemRecord = {
      consumptionId: 'consumption.recorded',
      sourceOperationId: 'item.prior-consume',
      source: occupiedResources.candidates[0]!.reference,
      canonicalItemId: 'leftovers',
      quantity: 1,
    }
    const recordedResources = resourcesFor({
      map,
      sheets: occupiedSheets,
      selectedTargetIds: [],
      requirements: [],
      consumedItems: [consumedRecord],
    })
    const occupiedRestore = interpretMoveItemEffects({
      context: contextFor({ map, sheets: occupiedSheets, resources: recordedResources }),
      operations: [emission(operation({
        id: 'item.restore-occupied',
        recipients: 'actor',
        payload: {
          action: 'restore',
          consumptionId: consumedRecord.consumptionId,
          mode: 'item',
          destination: 'actor-held',
          onUnavailable: 'no-op',
        },
      }), [actorId])],
      resolvedItemChoices: [],
    })
    expect(occupiedRestore).toMatchObject({
      mutations: [],
      results: [{ outcome: 'prevented', outcomeCode: 'destination-occupied' }],
    })

    const destroySheets = sheetsFixture({ firstHeld: 'Iron Ball' })
    const destroyResources = resourcesFor({
      map,
      sheets: destroySheets,
      selectedTargetIds: [firstTargetId],
      requirements: [requirements.targets],
    })
    const destroyOperation = operation({
      id: 'item.destroy-once',
      recipients: 'hit-targets',
      payload: selectedPayload('destroy', requirements.targets.id),
    })
    const duplicateDestroyOperation = operation({
      id: 'item.destroy-twice',
      recipients: 'hit-targets',
      payload: selectedPayload('destroy', requirements.targets.id),
    })
    const interpretation = interpretMoveItemEffects({
      context: contextFor({
        map,
        sheets: destroySheets,
        selectedTargetIds: [firstTargetId],
        resources: destroyResources,
      }),
      operations: [
        emission(destroyOperation, [firstTargetId]),
        emission(duplicateDestroyOperation, [firstTargetId]),
      ],
      resolvedItemChoices: [],
    })
    const mapSnapshot = structuredClone(map)
    const sheetSnapshot = structuredClone(destroySheets)
    const resourceSnapshot = structuredClone(destroyResources)
    expect(() => planMoveItemMutations({
      map,
      pokemonSheets: destroySheets,
      trainerSheets: new Map(),
      groupInventories: new Map(),
      operations: interpretation.mutations,
      originOperationId: 'op_itemlifecyclefail01',
      plannedAt: 4_000,
    })).toThrowError(expect.objectContaining({
      name: MoveItemMutationError.name,
      code: 'item-missing',
    }))
    expect(map).toEqual(mapSnapshot)
    expect(destroySheets).toEqual(sheetSnapshot)
    expect(destroyResources).toEqual(resourceSnapshot)
  })
})
