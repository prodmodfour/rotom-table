import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import {
  KNOCK_OFF_ACTOR_PLACEMENT_ID,
  KNOCK_OFF_TARGET_PLACEMENT_ID,
  KNOCK_OFF_V2_SEMANTIC_SCENARIOS,
  knockOffV2Fixture,
} from '../fixtures/moveAutomation/knockOffV2'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import {
  KNOCK_OFF_DAMAGE_INTERACTION,
  KNOCK_OFF_ITEM_CHOICE_OPERATION,
  KNOCK_OFF_ITEM_EFFECT_OPERATION,
  KnockOffItemOutcomeError,
  planKnockOffItemOutcome,
  type KnockOffPlannedItemOutcome,
  type KnockOffResolvedCombatOutcome,
} from '~~/server/domain/moveAutomation/knockOff'
import {
  resolveAuthoritativeMoveItemResources,
  reviewedMoveItemResourceRequirementsFor,
  type AuthoritativeMoveItemResources,
} from '~~/server/domain/moveAutomation/itemResources'
import { planMoveItemMutations } from '~~/server/domain/moveAutomation/planItemMutations'
import {
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
  registeredMoveAutomationRuntimeFor,
} from '~~/server/domain/moveAutomation/registry'
import { KNOCK_OFF_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/knockOff'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'

interface KnockOffFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ReturnType<typeof knockOffV2Fixture>['intent']
}

const itemResources = (fixture: KnockOffFixture): AuthoritativeMoveItemResources => (
  resolveAuthoritativeMoveItemResources({
    map: fixture.map,
    actorPlacementId: KNOCK_OFF_ACTOR_PLACEMENT_ID,
    selectedTargetPlacementIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
    pokemonSheets: fixture.pokemonSheets,
    trainerSheets: fixture.trainerSheets,
    groupInventories: new Map(),
    requirements: reviewedMoveItemResourceRequirementsFor('Knock Off'),
  })
)

const buildContext = (fixture: KnockOffFixture) => {
  const resources = itemResources(fixture)
  const context = buildAuthoritativeMoveRulesContext({
    map: fixture.map,
    pokemonSheets: fixture.pokemonSheets,
    trainerSheets: fixture.trainerSheets,
    intent: fixture.intent,
    candidatePlacementIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
    selectedPlacementIds: [KNOCK_OFF_TARGET_PLACEMENT_ID],
    random: () => {
      throw new Error('The pure Knock Off item outcome must not draw randomness.')
    },
    time: 5_000,
    resolutionId: 'resolution-knock-off-foundation',
    itemResources: resources,
  })
  return { context, resources }
}

const combat = (
  kind: KnockOffResolvedCombatOutcome['kind'],
  options: { readonly damageDealt?: number; readonly criticalHit?: boolean } = {},
): KnockOffResolvedCombatOutcome => kind === 'hit'
  ? {
      kind,
      targetPlacementId: KNOCK_OFF_TARGET_PLACEMENT_ID,
      damageDealt: options.damageDealt ?? 1,
      criticalHit: options.criticalHit ?? false,
    }
  : { kind, targetPlacementId: KNOCK_OFF_TARGET_PLACEMENT_ID }

const pokemonFixture = (heldItems: string | null): KnockOffFixture => (
  knockOffV2Fixture({ heldItems })
)

const trainerTargetFixture = (equipmentSlots: TrainerSheet['equipmentSlots']): KnockOffFixture => {
  const source = knockOffV2Fixture({ heldItems: null })
  const map = deepCloneJson(source.map)
  const target = map.placements.find(({ id }) => id === KNOCK_OFF_TARGET_PLACEMENT_ID)
  if (!target) throw new Error('Knock Off fixture target is missing.')
  const trainerSlug = 'knock-off-target-trainer'
  Object.assign(target, {
    sheetKind: 'trainer',
    sheetSlug: trainerSlug,
  } satisfies Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>)
  const pokemonSheets = new Map(source.pokemonSheets)
  pokemonSheets.delete('knock-off-target-sheet')
  const trainerSheets = new Map<string, TrainerSheet>([[trainerSlug, {
    slug: trainerSlug,
    name: 'Knock Off Target Trainer',
    level: 20,
    revision: 4,
    equipmentSlots: deepCloneJson(equipmentSlots ?? {}),
  }]])
  return {
    map,
    pokemonSheets,
    trainerSheets,
    intent: source.intent,
  }
}

const planTypedWrites = (
  fixture: KnockOffFixture,
  outcome: KnockOffPlannedItemOutcome,
) => planMoveItemMutations({
  map: fixture.map,
  pokemonSheets: fixture.pokemonSheets,
  trainerSheets: fixture.trainerSheets,
  groupInventories: new Map(),
  operations: outcome.itemEffects.mutations,
  consumedItems: [],
  originOperationId: 'op_knock_off_foundation',
  plannedAt: 5_000,
})

const knockOffManifestRow = manifestJson.moves.find(row => row.canonicalId === 'Knock Off')

describe('Knock Off authoritative item outcome foundation', () => {
  it('selects the complete reviewed v2 runtime and semantic evidence', () => {
    expect(knockOffManifestRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '69fb960c479dd2fc639e47c01151ff381301f02d6a26fd5df6b55af9b5eda7ad',
        sourceModule: 'server/domain/moveAutomation/specs/knockOff.ts',
      },
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(knockOffManifestRow?.scenarioIds).toEqual(
      KNOCK_OFF_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(registeredMoveAutomationRuntimeFor('Knock Off')).toMatchObject({
      kind: 'movespec-v2',
      definitionHash: knockOffManifestRow?.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS.some(({ canonicalId }) => (
      canonicalId === 'Knock Off'
    ))).toBe(true)

    const definition = validateMoveSpec(KNOCK_OFF_MOVE_SPEC)
    const operations = definition.spec.phases.flatMap(block => block.operations)
    expect(operations.map(operation => operation.id)).toEqual([
      'knock-off.accuracy',
      'knock-off.damage',
      KNOCK_OFF_ITEM_CHOICE_OPERATION.id,
      KNOCK_OFF_ITEM_EFFECT_OPERATION.id,
      'knock-off.usage',
      'knock-off.log-completed',
    ])
    expect(operations.find(operation => operation.id === 'knock-off.damage')).toMatchObject({
      kind: 'damage',
      phase: 'damage',
      payload: {
        damageClass: KNOCK_OFF_DAMAGE_INTERACTION.damageClass,
        damageBase: KNOCK_OFF_DAMAGE_INTERACTION.damageBase,
        moveType: KNOCK_OFF_DAMAGE_INTERACTION.moveType,
      },
    })
    expect(KNOCK_OFF_ITEM_CHOICE_OPERATION).toMatchObject({
      recipients: { kind: 'damaged-targets' },
      phase: KNOCK_OFF_DAMAGE_INTERACTION.itemEffectTiming,
      payload: {
        allowPass: false,
        itemChoice: {
          owner: 'actor',
          emptyPolicy: 'no-op',
          filter: {
            referenceKinds: ['pokemon-held', 'trainer-equipment-slot'],
            trainerEquipmentSlots: ['accessory'],
          },
        },
      },
    })
  })

  it('returns explicit traced no-item outcomes for miss, immunity, zero damage, and itemless hits', () => {
    const fixture = pokemonFixture('Leftovers, Bright Powder')
    const { context } = buildContext(fixture)

    const cases = [
      [combat('miss'), 'knock-off.missed', null],
      [combat('immune'), 'knock-off.immune', null],
      [combat('hit', { damageDealt: 0 }), 'knock-off.no-qualifying-damage', null],
    ] as const
    for (const [resolvedCombat, reasonCode, legalItemCount] of cases) {
      const outcome = planKnockOffItemOutcome({ context, combat: resolvedCombat })
      expect(outcome).toMatchObject({
        kind: 'no-item',
        reasonCode,
        legalItemCount,
        damageInteraction: KNOCK_OFF_DAMAGE_INTERACTION,
        traceEntries: [{
          operationId: KNOCK_OFF_ITEM_CHOICE_OPERATION.id,
          outcome: 'no-op',
          result: expect.objectContaining({ reasonCode }),
        }],
      })
      expect(outcome).not.toHaveProperty('itemEffects')
      expect(outcome).not.toHaveProperty('request')
    }

    const itemlessFixture = pokemonFixture(null)
    const itemless = planKnockOffItemOutcome({
      context: buildContext(itemlessFixture).context,
      combat: combat('hit'),
    })
    expect(itemless).toMatchObject({
      kind: 'no-item',
      reasonCode: 'knock-off.no-legal-item',
      legalItemCount: 0,
      traceEntries: [{ outcome: 'no-op' }],
    })
  })

  it('automatically plans the sole Pokémon Held Item with exact provenance and no mutation', () => {
    const fixture = pokemonFixture('Leftovers')
    const fixtureBefore = deepCloneJson({
      map: fixture.map,
      pokemonSheets: [...fixture.pokemonSheets],
      trainerSheets: [...fixture.trainerSheets],
    })
    const { context, resources } = buildContext(fixture)
    const resourcesBefore = deepCloneJson({
      requirements: resources.requirements,
      candidates: resources.candidates,
      sheetReads: resources.sheetReads,
      groupInventoryReads: resources.groupInventoryReads,
      groupInventories: [...resources.groupInventories],
      consumedItems: resources.consumedItems,
    })
    const readsBefore = context.reads.snapshot()

    const outcome = planKnockOffItemOutcome({
      context,
      combat: combat('hit', { damageDealt: 12 }),
    })
    expect(outcome.kind).toBe('item-plan')
    if (outcome.kind !== 'item-plan') return
    expect(outcome).toMatchObject({
      selectionMode: 'automatic',
      damageInteraction: {
        damageBase: 7,
        itemPresenceModifier: 'none',
        itemEffectTiming: 'after-damage',
      },
      itemEffects: {
        results: [{ outcome: 'applied', action: 'knock-to-ground' }],
        mutations: [{
          kind: 'ground-item-add',
          source: {
            kind: 'pokemon-held',
            canonicalItemId: 'leftovers',
            owner: {
              kind: 'sheet',
              sheetKind: 'pokemon',
              slug: 'knock-off-target-sheet',
              revision: 2,
            },
            quantity: 1,
          },
          destination: {
            kind: 'map-ground-item',
            owner: { kind: 'map', slug: fixture.map.slug, revision: 0 },
            position: { x: 2, y: 0, z: 1 },
            ownerPlacementId: KNOCK_OFF_TARGET_PLACEMENT_ID,
          },
          quantity: 1,
        }],
      },
      traceEntries: [
        expect.objectContaining({ outcome: 'applied' }),
        expect.objectContaining({ operationId: KNOCK_OFF_ITEM_EFFECT_OPERATION.id }),
      ],
    })

    const typedPlan = planTypedWrites(fixture, outcome)
    expect(typedPlan.sheetWrites).toHaveLength(1)
    expect(typedPlan.sheetWrites[0]).toMatchObject({
      kind: 'pokemon',
      slug: 'knock-off-target-sheet',
      expectedRevision: 2,
      nextSheet: { items: {} },
    })
    expect(typedPlan.nextMap.encounterState?.groundItems).toEqual([
      expect.objectContaining({
        canonicalItemId: 'leftovers',
        quantity: 1,
        position: { x: 2, y: 0, z: 1 },
        sourceResource: {
          kind: 'sheet',
          sheetKind: 'pokemon',
          slug: 'knock-off-target-sheet',
          revision: 2,
        },
        sourceOperationId: 'op_knock_off_foundation',
      }),
    ])

    expect({
      map: fixture.map,
      pokemonSheets: [...fixture.pokemonSheets],
      trainerSheets: [...fixture.trainerSheets],
    }).toEqual(fixtureBefore)
    expect({
      requirements: resources.requirements,
      candidates: resources.candidates,
      sheetReads: resources.sheetReads,
      groupInventoryReads: resources.groupInventoryReads,
      groupInventories: [...resources.groupInventories],
      consumedItems: resources.consumedItems,
    }).toEqual(resourcesBefore)
    expect(context.reads.snapshot()).toEqual(readsBefore)
    expect(Object.isFrozen(outcome)).toBe(true)
    expect(Object.isFrozen(outcome.itemEffects.mutations[0])).toBe(true)
  })

  it('offers stable private actor-owned options only when multiple legal candidates exist', () => {
    const fixture = pokemonFixture('Leftovers, Bright Powder')
    const firstContext = buildContext(fixture).context
    const first = planKnockOffItemOutcome({
      context: firstContext,
      combat: combat('hit', { damageDealt: 8 }),
    })
    expect(first.kind).toBe('pending-choice')
    if (first.kind !== 'pending-choice') return

    expect(first.request).toMatchObject({
      kind: 'item-choice',
      recipientIds: [KNOCK_OFF_ACTOR_PLACEMENT_ID],
      allowPass: false,
    })
    expect(first.request.options.map(option => ({
      id: option.id,
      canonicalItemId: option.itemChoice?.canonicalItemId,
      destinationKind: option.itemChoice?.destinationKind,
    }))).toEqual([
      {
        id: expect.stringMatching(/^item\.choice\.[a-f0-9]{16}$/),
        canonicalItemId: 'leftovers',
        destinationKind: 'map-ground',
      },
      {
        id: expect.stringMatching(/^item\.choice\.[a-f0-9]{16}$/),
        canonicalItemId: 'bright-powder',
        destinationKind: 'map-ground',
      },
    ])
    expect(first.request.options[0]?.itemSelection).toMatchObject({
      kind: 'move-item',
      reference: { canonicalItemId: 'leftovers' },
    })
    expect(first.traceEntries).toEqual([
      expect.objectContaining({
        outcome: 'pending',
        result: expect.objectContaining({ optionCount: 2, owner: 'actor' }),
      }),
    ])

    const repeated = planKnockOffItemOutcome({
      context: buildContext(fixture).context,
      combat: combat('hit', { damageDealt: 8, criticalHit: true }),
    })
    expect(repeated.kind).toBe('pending-choice')
    if (repeated.kind !== 'pending-choice') return
    expect(repeated.request.options.map(({ id }) => id)).toEqual(
      first.request.options.map(({ id }) => id),
    )
    expect(repeated.damageInteraction).toEqual(first.damageInteraction)
    expect(repeated.damageInteraction.itemPresenceModifier).toBe('none')
  })

  it('revalidates only an opaque option ID and converts it into the shared typed plan', () => {
    const fixture = pokemonFixture('Leftovers, Bright Powder')
    const { context } = buildContext(fixture)
    const pending = planKnockOffItemOutcome({ context, combat: combat('hit') })
    if (pending.kind !== 'pending-choice') throw new Error('Expected a Knock Off item choice.')
    const brightPowder = pending.request.options.find(option => (
      option.itemChoice?.canonicalItemId === 'bright-powder'
    ))
    if (!brightPowder) throw new Error('Expected the Bright Powder choice.')

    const resolved = planKnockOffItemOutcome({
      context,
      combat: combat('hit', { damageDealt: 20, criticalHit: true }),
      selectedOptionId: brightPowder.id,
    })
    expect(resolved.kind).toBe('item-plan')
    if (resolved.kind !== 'item-plan') return
    expect(resolved).toMatchObject({
      selectionMode: 'durable-response',
      optionId: brightPowder.id,
      itemEffects: {
        mutations: [{
          kind: 'ground-item-add',
          source: { canonicalItemId: 'bright-powder' },
        }],
      },
    })
    expect(planTypedWrites(fixture, resolved).sheetWrites[0]?.nextSheet).toMatchObject({
      items: { held: 'Leftovers' },
    })

    expect(() => planKnockOffItemOutcome({
      context,
      combat: combat('hit'),
      selectedOptionId: 'item.choice.clientforged',
    })).toThrowError(expect.objectContaining({
      name: KnockOffItemOutcomeError.name,
      code: 'item-option-unavailable',
    }))
  })

  it('accepts only a target Trainer Accessory and excludes every other equipment slot', () => {
    const accessoryFixture = trainerTargetFixture({
      accessory: 'Bright Powder',
      mainHand: 'Iron Ball',
      offHand: 'Leftovers',
    })
    const accessory = planKnockOffItemOutcome({
      context: buildContext(accessoryFixture).context,
      combat: combat('hit'),
    })
    expect(accessory.kind).toBe('item-plan')
    if (accessory.kind !== 'item-plan') return
    expect(accessory.itemEffects.mutations).toEqual([
      expect.objectContaining({
        kind: 'ground-item-add',
        source: expect.objectContaining({
          kind: 'trainer-equipment-slot',
          canonicalItemId: 'bright-powder',
          slot: 'accessory',
        }),
      }),
    ])
    const planned = planTypedWrites(accessoryFixture, accessory)
    expect(planned.sheetWrites[0]).toMatchObject({
      kind: 'trainer',
      slug: 'knock-off-target-trainer',
      nextSheet: {
        equipmentSlots: {
          mainHand: 'Iron Ball',
          offHand: 'Leftovers',
        },
      },
    })

    const ineligibleFixture = trainerTargetFixture({
      mainHand: 'Iron Ball',
      offHand: 'Leftovers',
    })
    expect(planKnockOffItemOutcome({
      context: buildContext(ineligibleFixture).context,
      combat: combat('hit'),
    })).toMatchObject({
      kind: 'no-item',
      reasonCode: 'knock-off.no-legal-item',
    })
  })

  it('rejects stale selections and malformed combat facts without a partial item plan', () => {
    const original = pokemonFixture('Leftovers, Bright Powder')
    const pending = planKnockOffItemOutcome({
      context: buildContext(original).context,
      combat: combat('hit'),
    })
    if (pending.kind !== 'pending-choice') throw new Error('Expected a Knock Off item choice.')
    const removedOption = pending.request.options.find(option => (
      option.itemChoice?.canonicalItemId === 'leftovers'
    ))
    if (!removedOption) throw new Error('Expected the Leftovers choice.')

    const changed = pokemonFixture('Bright Powder')
    expect(() => planKnockOffItemOutcome({
      context: buildContext(changed).context,
      combat: combat('hit'),
      selectedOptionId: removedOption.id,
    })).toThrowError(expect.objectContaining({
      code: 'item-option-unavailable',
    }))

    expect(() => planKnockOffItemOutcome({
      context: buildContext(original).context,
      combat: {
        kind: 'hit',
        targetPlacementId: KNOCK_OFF_TARGET_PLACEMENT_ID,
        damageDealt: -1,
        criticalHit: false,
      },
    })).toThrowError(expect.objectContaining({
      code: 'invalid-combat-outcome',
    }))
  })
})
