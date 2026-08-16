import { describe, expect, it } from 'vitest'
import { ENCOUNTER_EVENT_SCHEMA_VERSION, parseEncounterEvent } from '#shared/moveAutomation/events'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveState,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import {
  isAuthoritativePendingMoveResolution,
} from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import {
  planEncounterLifecycle,
  planInitiativeLifecycle,
} from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import { planSceneLifecycle } from '../../server/domain/moveAutomation/planSceneLifecycle'
import { activeEquipmentState } from '../fixtures/equipment'
import {
  FURY_CUTTER_ACTOR_ID,
  FURY_CUTTER_TARGET_ID,
  furyCutterIntent,
  furyCutterV2Fixture,
} from '../fixtures/moveAutomation/furyCutterV2'

const withEquipment = (
  sheet: CharacterSheet,
  canonicalItemId: string,
): CharacterSheet => ({
  ...sheet,
  equipmentState: activeEquipmentState({
    ownerKind: 'pokemon', ownerSlug: sheet.slug, slotId: 'held', canonicalItemId,
  }),
})
const plannedMove = (input: {
  readonly moveName?: string
  readonly actorItem?: string
  readonly targetItem?: string
  readonly actorHp?: number
  readonly targetHp?: number
  readonly targetTypes?: CharacterSheet['types']
  readonly targetAbilities?: CharacterSheet['abilities']
  readonly targetLevel?: number
  readonly targetHpStatAdded?: number
  readonly random?: () => number
  readonly foes?: boolean
  readonly operationSuffix: string
}) => {
  const fixture = furyCutterV2Fixture({ targetCurrentHp: input.targetHp ?? 5_000 })
  const actor = fixture.pokemonSheets.get('fury-cutter-actor-sheet')!
  const target = fixture.pokemonSheets.get('fury-cutter-target-sheet')!
  const moveName = input.moveName ?? 'Fury Cutter'
  const pokemonSheets = new Map(fixture.pokemonSheets)
  const actorSheet: CharacterSheet = {
    ...actor,
    movelist: actor.movelist?.some(move => move.name === moveName)
      ? actor.movelist
      : [...(actor.movelist ?? []), { name: moveName }],
    ...(input.actorHp === undefined ? {} : { combat: { ...actor.combat, currentHp: input.actorHp } }),
  }
  pokemonSheets.set(actor.slug, input.actorItem ? withEquipment(actorSheet, input.actorItem) : actorSheet)
  const targetSheet: CharacterSheet = {
    ...target,
    ...(input.targetTypes ? { types: [...input.targetTypes] } : {}),
    ...(input.targetAbilities ? { abilities: [...input.targetAbilities] } : {}),
    ...(input.targetLevel === undefined ? {} : { level: input.targetLevel }),
    ...(input.targetHpStatAdded === undefined ? {} : {
      stats: { ...target.stats, hp: { ...target.stats?.hp, added: input.targetHpStatAdded } },
    }),
  }
  pokemonSheets.set(target.slug, input.targetItem ? withEquipment(targetSheet, input.targetItem) : targetSheet)
  const intent = moveName === 'Fury Cutter'
    ? furyCutterIntent()
    : {
        schemaVersion: 1 as const,
        placementId: FURY_CUTTER_ACTOR_ID,
        moveName,
        selection: { kind: 'single-target' as const, targetPlacementId: FURY_CUTTER_TARGET_ID },
      }
  const map = input.foes ? {
    ...fixture.map,
    placements: fixture.map.placements.map(placement => ({
      ...placement,
      sideId: placement.id === FURY_CUTTER_ACTOR_ID ? 'allies' : 'foes',
    })),
    encounterState: {
      ...fixture.map.encounterState!,
      sides: {
        allies: { id: 'allies', label: 'Allies', status: 'active' as const },
        foes: { id: 'foes', label: 'Foes', status: 'active' as const },
      },
    },
  } : fixture.map
  return planAuthoritativeMoveState({
    ...fixture,
    map,
    pokemonSheets,
    intent,
    candidatePlacementIds: [FURY_CUTTER_TARGET_ID],
    selectedPlacementIds: [FURY_CUTTER_TARGET_ID],
    random: input.random ?? (() => 0.99),
    now: () => 10,
    operationId: `op_equipment_provider_${input.operationSuffix}`,
    pendingResolutionId: `resolution.equipment-provider.${input.operationSuffix}`,
  })
}
const currentHp = (plan: ReturnType<typeof plannedMove>, slug: string): number | null => (
  (plan.sheetWrites.find(write => write.slug === slug)?.nextSheet as CharacterSheet | undefined)
    ?.combat?.currentHp ?? null
)

describe('P8-048 passive equipment mechanics integration', () => {
  it('applies Focus Band once, persists opaque scene frequency, and leaves the holder at one HP', () => {
    const plan = plannedMove({ targetItem: 'Focus Band', targetHp: 1, operationSuffix: 'focus-band' })
    expect(currentHp(plan, 'fury-cutter-target-sheet')).toBe(1)
    expect(JSON.stringify(plan.resolution)).toContain('equipment.focus-band.prevent-faint')
    const marker = plan.nextMap.encounterState?.effects.find(effect => (
      effect.tags.includes('equipment-provider-frequency')
    ))
    expect(marker).toBeDefined()
    expect(marker?.duration.kind).toBe('scene')
    expect(JSON.stringify(marker)).not.toContain('Focus Band')
    expect(JSON.stringify(marker)).not.toContain('equipped-item:v1:')
  })

  it('applies Focus Sash only to lethal Move damage received from full HP', () => {
    const full = plannedMove({
      moveName: 'Double-Edge', targetItem: 'Focus Sash', targetHp: 59,
      targetLevel: 1, targetHpStatAdded: 0, operationSuffix: 'focus-sash-full',
    })
    const wounded = plannedMove({
      moveName: 'Double-Edge', targetItem: 'Focus Sash', targetHp: 58,
      targetLevel: 1, targetHpStatAdded: 0, operationSuffix: 'focus-sash-wounded',
    })
    expect(currentHp(full, 'fury-cutter-target-sheet')).toBe(1)
    expect(currentHp(wounded, 'fury-cutter-target-sheet')).toBeLessThanOrEqual(0)
    expect(JSON.stringify(full.resolution)).toContain('equipment.focus-sash.prevent-faint')
    expect((full.resolution as any).rollLedger.filter((roll: any) => (
      String(roll.rollId).startsWith('equipment-provider-roll:v1:')
    ))).toHaveLength(0)
  })

  it('intercepts lethal post-damage recoil after MoveSpec has projected its target damage', () => {
    const plan = plannedMove({
      moveName: 'Wild Charge', actorItem: 'Focus Band', actorHp: 1,
      random: () => 0.99, operationSuffix: 'focus-band-recoil',
    })
    expect(currentHp(plan, 'fury-cutter-actor-sheet')).toBe(1)
    expect((plan.resolution as any).rollLedger.filter((roll: any) => (
      String(roll.rollId).startsWith('equipment-provider-roll:v1:')
    ))).toHaveLength(1)
    expect(plan.nextMap.encounterState?.effects.filter(effect => (
      effect.tags.includes('equipment-provider-frequency')
    ))).toHaveLength(1)
    const recoil = (plan.resolution as any).auditTrace.events.find((event: any) => (
      event.operationId === 'wild-charge.recoil'
    ))
    expect(recoil.result.recipients[0].details.faintProtection.reasonCode)
      .toBe('equipment.focus-band.prevent-faint')
  })

  it('intercepts lethal lifecycle residual damage through the generic HP checkpoint', () => {
    const fixture = furyCutterV2Fixture({ targetCurrentHp: 1 })
    const holder = fixture.pokemonSheets.get('fury-cutter-target-sheet')!
    const pokemonSheets = new Map(fixture.pokemonSheets)
    pokemonSheets.set(holder.slug, withEquipment(holder, 'Focus Band'))
    const map = {
      ...fixture.map,
      fieldEffects: {
        weather: [{ kind: 'hail' as const, rounds: 1 }], terrains: [], rooms: [],
      },
      initiative: { activeId: FURY_CUTTER_TARGET_ID, round: 1 },
    }
    const plan = planInitiativeLifecycle({
      map,
      previous: { activeId: FURY_CUTTER_TARGET_ID, round: 1 },
      current: { activeId: FURY_CUTTER_TARGET_ID, round: 2 },
      orderIds: [FURY_CUTTER_TARGET_ID], operationId: 'op_equipment_focus_weather', time: 10,
      loadSheets: () => ({ pokemonSheets, trainerSheets: fixture.trainerSheets }),
      random: () => 0.99,
    })
    expect((plan.sheetWrites.find(write => write.slug === holder.slug)?.nextSheet as CharacterSheet)
      .combat?.currentHp).toBe(1)
    expect(plan.rollLedger.filter(roll => roll.rollId.startsWith('equipment-provider-roll:v1:')))
      .toHaveLength(1)
    expect(plan.currentEncounterState.effects.filter(effect => (
      effect.tags.includes('equipment-provider-frequency')
    ))).toHaveLength(1)
  })

  it('doubles exact damage-dealt drain healing through Big Root', () => {
    const ordinary = plannedMove({ moveName: 'Absorb', actorHp: 500, operationSuffix: 'absorb-base' })
    const boosted = plannedMove({ moveName: 'Absorb', actorHp: 500, actorItem: 'Big Root', operationSuffix: 'absorb-root' })
    expect(currentHp(ordinary, 'fury-cutter-actor-sheet')).toBe(505)
    expect(currentHp(boosted, 'fury-cutter-actor-sheet')).toBe(510)
  })

  it('preserves multi-hit strike order, applies Focus Band once, and does not reroll the accepted scene use', () => {
    const plan = plannedMove({
      moveName: 'Double Kick', targetItem: 'Focus Band', targetHp: 1,
      random: () => 0.99, operationSuffix: 'multi-focus-band',
    })
    const multiHit = (plan.resolution as any).auditTrace.events.find((event: any) => (
      event.kind === 'operation' && event.operationKind === 'multi-hit'
    ))?.result
    expect(multiHit.targets[0].strikes).toHaveLength(2)
    expect(multiHit.targets[0].strikes[0]).toMatchObject({
      knockout: false, damage: { targetHpAfter: 1 },
    })
    expect(multiHit.targets[0].strikes[1].knockout).toBe(true)
    expect(plan.nextMap.encounterState?.effects.filter(effect => (
      effect.tags.includes('equipment-provider-frequency')
    ))).toHaveLength(1)
    expect((plan.resolution as any).rollLedger.filter((roll: any) => (
      String(roll.rollId).startsWith('equipment-provider-roll:v1:')
    ))).toHaveLength(1)
  })

  it('executes reviewed Life Orb, King’s Rock, and Razor Fang aftermath from active sources', () => {
    const lifeOrb = plannedMove({ actorItem: 'Life Orb', operationSuffix: 'life-orb' })
    expect(currentHp(lifeOrb, 'fury-cutter-actor-sheet')).toBeLessThan(1_000)
    expect(JSON.stringify(lifeOrb.resolution)).toContain('equipment.life-orb.recoil')

    const kingsRock = plannedMove({ actorItem: 'King’s Rock', operationSuffix: 'kings-rock' })
    expect((kingsRock.sheetWrites.find(write => write.slug === 'fury-cutter-target-sheet')
      ?.nextSheet as CharacterSheet).combat?.conditions).toContain('Flinch')

    const razorFang = plannedMove({ actorItem: 'Razor Fang', operationSuffix: 'razor-fang' })
    expect((razorFang.sheetWrites.find(write => write.slug === 'fury-cutter-target-sheet')
      ?.nextSheet as CharacterSheet).combat?.injuries).toBe(1)
  })

  it('grants Shell Bell temporary HP only for authoritative foe damage', () => {
    const neutral = plannedMove({ actorItem: 'Shell Bell', operationSuffix: 'shell-neutral' })
    const foe = plannedMove({ actorItem: 'Shell Bell', foes: true, operationSuffix: 'shell-foe' })
    expect(neutral.nextMap.temporaryHitPoints?.byPlacementId?.[FURY_CUTTER_ACTOR_ID] ?? 0).toBe(0)
    expect(foe.nextMap.temporaryHitPoints?.byPlacementId?.[FURY_CUTTER_ACTOR_ID]).toBeGreaterThan(0)
    expect(JSON.stringify(foe.resolution)).toContain('equipment.shell-bell.temporary-hp')
  })

  it('applies strike aftermath independently for every authoritative multi-hit strike', () => {
    const lifeOrb = plannedMove({
      moveName: 'Double Kick', actorItem: 'Life Orb', random: () => 0.99,
      operationSuffix: 'multi-life-orb',
    })
    const recoilEvents = (lifeOrb.resolution as any).auditTrace?.events?.filter((event: any) => (
      event.reasonCode === 'equipment.life-orb.recoil' && event.kind === 'operation'
    )) ?? []
    expect(recoilEvents).toHaveLength(2)
    expect(currentHp(lifeOrb, 'fury-cutter-actor-sheet')).toBe(808)
  })

  it('offers, receipts, empowers, and atomically consumes one matching Type Gem', () => {
    const setup = (operationSuffix: string) => {
      const fixture = furyCutterV2Fixture({ targetCurrentHp: 5_000 })
      const actor = fixture.pokemonSheets.get('fury-cutter-actor-sheet')!
      const pokemonSheets = new Map(fixture.pokemonSheets)
      pokemonSheets.set(actor.slug, {
        ...actor,
        equipmentState: activeEquipmentState({
          ownerKind: 'pokemon', ownerSlug: actor.slug, slotId: 'held', canonicalItemId: 'Type Gem',
          configuration: { configurationId: 'equipment.type-gem.v1', values: { typeId: 'Bug' } },
        }),
      })
      const declaration = planAuthoritativeMoveStateExecution({
        ...fixture,
        pokemonSheets,
        intent: furyCutterIntent(),
        candidatePlacementIds: [FURY_CUTTER_TARGET_ID],
        selectedPlacementIds: [FURY_CUTTER_TARGET_ID],
        random: () => 0.5,
        now: () => 10,
        operationId: `op_equipment_type_gem_${operationSuffix}`,
        pendingResolutionId: `resolution.equipment-type-gem.${operationSuffix}`,
      })
      expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
      if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected Type Gem choice.')
      return { fixture, pokemonSheets, declaration }
    }
    const complete = (optionId: string | null, suffix: string) => {
      const declared = setup(suffix)
      const pending = declared.declaration.suspension.pendingResolution
      const window = pending.outstandingWindows[0]!
      expect(window).toMatchObject({
        kind: 'reaction', options: [{ id: 'activate' }], allowPass: true,
        reasonCode: 'equipment.type-gem.empower-choice',
      })
      expect(JSON.stringify(window)).not.toContain('Type Gem')
      expect(JSON.stringify(window)).not.toContain('equipped-item:v1:')
      const execution = resumeMoveSpec({
        pendingResolution: structuredClone(pending),
        map: structuredClone(declared.declaration.nextMap),
        pokemonSheets: declared.pokemonSheets,
        trainerSheets: declared.fixture.trainerSheets,
        response: { requestId: window.windowId, optionId },
        now: 20,
        random: () => 0.5,
      })
      expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
      if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed Type Gem choice.')
      const plan = planResumedMoveState({
        pendingResolution: pending,
        declarationPlan: declared.declaration.suspension.preWindowPlan,
        responseOpId: `op_equipment_type_gem_response_${suffix}`,
        responseWindowId: window.windowId,
        responseOptionId: optionId,
        chosenBy: { kind: 'actor', id: FURY_CUTTER_ACTOR_ID },
        map: declared.declaration.nextMap,
        pokemonSheets: declared.pokemonSheets,
        trainerSheets: declared.fixture.trainerSheets,
        execution,
        plannedAt: 20,
      })
      return plan
    }
    const activated = complete('activate', 'activate')
    const passed = complete(null, 'pass')
    const activatedActor = activated.sheetWrites.find(write => write.slug === 'fury-cutter-actor-sheet')
      ?.nextSheet as CharacterSheet
    expect(activatedActor.equipmentState?.instances).toEqual([])
    expect(activatedActor.equipmentState?.slots.every(slot => slot.instanceId === null)).toBe(true)
    expect((activated.sheetWrites.find(write => write.slug === 'fury-cutter-target-sheet')
      ?.nextSheet as CharacterSheet).combat?.currentHp).toBeLessThan(
      (passed.sheetWrites.find(write => write.slug === 'fury-cutter-target-sheet')
        ?.nextSheet as CharacterSheet).combat!.currentHp!,
    )
    expect((passed.sheetWrites.find(write => write.slug === 'fury-cutter-actor-sheet')
      ?.nextSheet as CharacterSheet | undefined)?.equipmentState?.instances).toBeUndefined()
    expect(JSON.stringify(activated.resolution)).toContain('equipment.type-gem.empower')
  })

  it('routes both Helmet resistance and Headbutt flinch prevention from a Trainer source', () => {
    const plan = (equipped: boolean) => {
      const fixture = furyCutterV2Fixture({ targetCurrentHp: 5_000 })
      const actor = fixture.pokemonSheets.get('fury-cutter-actor-sheet')!
      const target = fixture.pokemonSheets.get('fury-cutter-target-sheet')!
      const pokemonSheets = new Map(fixture.pokemonSheets)
      pokemonSheets.delete(target.slug)
      pokemonSheets.set(actor.slug, {
        ...actor,
        movelist: [...(actor.movelist ?? []), { name: 'Headbutt' }],
      })
      const targetTrainer = {
        ...target,
        name: 'Helmet Target',
        ...(equipped ? {
          equipmentState: activeEquipmentState({
            ownerKind: 'trainer', ownerSlug: target.slug, slotId: 'head', canonicalItemId: 'Helmet',
          }),
        } : {}),
      } as unknown as TrainerSheet
      return planAuthoritativeMoveState({
        ...fixture,
        map: {
          ...fixture.map,
          placements: fixture.map.placements.map(placement => placement.id === FURY_CUTTER_TARGET_ID
            ? { ...placement, sheetKind: 'trainer' as const }
            : placement),
        },
        pokemonSheets,
        trainerSheets: new Map([[target.slug, targetTrainer]]),
        intent: {
          schemaVersion: 1,
          placementId: FURY_CUTTER_ACTOR_ID,
          moveName: 'Headbutt',
          selection: { kind: 'single-target', targetPlacementId: FURY_CUTTER_TARGET_ID },
        },
        candidatePlacementIds: [FURY_CUTTER_TARGET_ID],
        selectedPlacementIds: [FURY_CUTTER_TARGET_ID],
        random: () => 0.99,
        now: () => 10,
        operationId: `op_equipment_helmet_${equipped ? 'yes' : 'no'}`,
        pendingResolutionId: `resolution.equipment-helmet.${equipped ? 'yes' : 'no'}`,
      })
    }
    const ordinary = plan(false)
    const helmet = plan(true)
    const effectiveLoss = (candidate: typeof helmet): number => (
      (candidate.resolution as any).auditTrace.events.find((event: any) => (
        event.operationId === 'headbutt.damage'
      )).result.recipients[0].details.effectiveHpLost
    )
    expect(effectiveLoss(helmet)).toBeLessThan(effectiveLoss(ordinary))
    expect(JSON.stringify(ordinary.resolution)).not.toContain('equipment.helmet.flinch-immunity')
    expect(JSON.stringify(helmet.resolution)).toContain('equipment.helmet.move-resistance')
    expect(JSON.stringify(helmet.resolution)).toContain('equipment.helmet.flinch-immunity')
  })

  it('prevents Powder Moves with Safety Goggles and removes Ground immunity with Iron Ball', () => {
    const powder = plannedMove({ moveName: 'Spore', targetItem: 'Safety Goggles', operationSuffix: 'safety-goggles' })
    expect(powder.sheetWrites).toEqual([])
    expect(JSON.stringify(powder.resolution)).toContain('equipment.safety-goggles.powder-immunity')

    const immune = plannedMove({
      moveName: 'Mud Shot', targetAbilities: [{ name: 'Levitate' }], operationSuffix: 'iron-without',
    })
    expect(currentHp(immune, 'fury-cutter-target-sheet')).toBe(5_000)
    const grounded = plannedMove({
      moveName: 'Mud Shot', targetAbilities: [{ name: 'Levitate' }],
      targetItem: 'Iron Ball', operationSuffix: 'iron-with',
    })
    expect(currentHp(grounded, 'fury-cutter-target-sheet')).toBeLessThan(5_000)
  })

  it('prevents reviewed weather residuals through the same authoritative lifecycle reducer', () => {
    const fixture = furyCutterV2Fixture()
    const holder = fixture.pokemonSheets.get('fury-cutter-target-sheet')!
    const pokemonSheets = new Map(fixture.pokemonSheets)
    pokemonSheets.set(holder.slug, withEquipment(holder, 'Winter Cloak'))
    const map = {
      ...fixture.map,
      fieldEffects: {
        weather: [{ kind: 'hail' as const, rounds: 1 }], terrains: [], rooms: [],
      },
      initiative: { activeId: FURY_CUTTER_TARGET_ID, round: 1 },
    }
    const plan = planInitiativeLifecycle({
      map,
      previous: { activeId: FURY_CUTTER_TARGET_ID, round: 1 },
      current: { activeId: FURY_CUTTER_TARGET_ID, round: 2 },
      orderIds: [FURY_CUTTER_TARGET_ID], operationId: 'op_equipment_weather_lifecycle', time: 10,
      loadSheets: () => ({ pokemonSheets, trainerSheets: fixture.trainerSheets }), random: () => 0.5,
    })
    expect(plan.sheetWrites.some(write => write.slug === holder.slug)).toBe(false)
    expect(plan.reduction.operations.some(operation => (
      operation.reasonCode === 'weather.hail.round-end-residual'
    ))).toBe(true)
    expect(plan.currentFieldEffects.weather).toEqual([])
  })

  it('subscribes Choice Item at scene start and immediately enforces Suppressed Move frequency', () => {
    const fixture = furyCutterV2Fixture()
    const holder = fixture.pokemonSheets.get('fury-cutter-actor-sheet')!
    const pokemonSheets = new Map(fixture.pokemonSheets)
    pokemonSheets.set(holder.slug, {
      ...holder,
      movelist: [...(holder.movelist ?? []), { name: 'Double-Edge' }],
      equipmentState: activeEquipmentState({
        ownerKind: 'pokemon', ownerSlug: holder.slug, slotId: 'held', canonicalItemId: 'Choice Item',
        configuration: { configurationId: 'equipment.choice-item.v1', values: { statId: 'atk' } },
      }),
    })
    const plan = planSceneLifecycle({
      map: { ...fixture.map, activeScene: undefined },
      previous: null,
      current: fixture.map.activeScene!,
      operationId: 'op_equipment_choice_scene_start',
      time: 10,
      loadSheets: () => ({ pokemonSheets, trainerSheets: fixture.trainerSheets }),
    })
    expect(plan.currentEncounterState.effects.filter(effect => (
      effect.tags.includes('equipment-choice-item-suppression')
    ))).toHaveLength(1)
    expect(plan.reductions.flatMap(reduction => reduction.trace).some(entry => (
      entry.kind === 'operation-enqueued'
      && entry.handlerId === 'handler.equipment-event-providers'
    ))).toBe(true)
    expect(plan.currentEncounterState.effects[0]?.affected.placementIds)
      .toContain(FURY_CUTTER_ACTOR_ID)
    expect(() => planAuthoritativeMoveState({
      ...fixture,
      map: plan.nextMap,
      pokemonSheets,
      intent: {
        ...furyCutterIntent(),
        moveName: 'Double-Edge',
      },
      candidatePlacementIds: [FURY_CUTTER_TARGET_ID],
      selectedPlacementIds: [FURY_CUTTER_TARGET_ID],
      random: () => 0.5,
      now: () => 11,
      operationId: 'op_equipment_choice_suppressed_move',
      pendingResolutionId: 'resolution.equipment-choice.suppressed-move',
    })).toThrow(/Suppressed/)
  })

  it('materializes Choice Item suppression as one encounter-bound accepted effect', () => {
    const fixture = furyCutterV2Fixture()
    const holder = fixture.pokemonSheets.get('fury-cutter-target-sheet')!
    const pokemonSheets = new Map(fixture.pokemonSheets)
    pokemonSheets.set(holder.slug, {
      ...holder,
      equipmentState: activeEquipmentState({
        ownerKind: 'pokemon', ownerSlug: holder.slug, slotId: 'held', canonicalItemId: 'Choice Item',
        configuration: { configurationId: 'equipment.choice-item.v1', values: { statId: 'atk' } },
      }),
    })
    const event = parseEncounterEvent({
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId: 'event.equipment.choice-turn', kind: 'turn-start',
      sourceOperationId: 'op.equipment.lifecycle', causalParentEventId: null,
      reasonCode: 'equipment.turn-start', round: 2, turn: 1,
      placementId: FURY_CUTTER_TARGET_ID, sideId: null,
    })
    const plan = planEncounterLifecycle({
      map: fixture.map, events: [event], time: 10,
      loadSheets: () => ({ pokemonSheets, trainerSheets: fixture.trainerSheets }), random: () => 0.5,
    })
    const effects = plan.currentEncounterState.effects.filter(effect => (
      effect.tags.includes('equipment-choice-item-suppression')
    ))
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({
      kind: 'condition', duration: { kind: 'encounter' },
      payload: { conditionId: 'suppressed', action: 'apply' },
      affected: { placementIds: [FURY_CUTTER_TARGET_ID] },
    })
    expect(plan.sheetWrites).toEqual([])
  })

  it.each([
    ['Flame Orb', 'Burned'],
    ['Toxic Orb', 'Poisoned'],
  ] as const)('routes %s from turn-start lifecycle authority without a client poll', (item, condition) => {
    const fixture = furyCutterV2Fixture()
    const holder = fixture.pokemonSheets.get('fury-cutter-target-sheet')!
    const pokemonSheets = new Map(fixture.pokemonSheets)
    pokemonSheets.set(holder.slug, withEquipment(holder, item))
    const event = parseEncounterEvent({
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId: `event.equipment.${item === 'Flame Orb' ? 'flame' : 'toxic'}`,
      kind: 'turn-start', sourceOperationId: 'op.equipment.lifecycle', causalParentEventId: null,
      reasonCode: 'equipment.turn-start', round: 2, turn: 1,
      placementId: FURY_CUTTER_TARGET_ID, sideId: null,
    })
    const plan = planEncounterLifecycle({
      map: fixture.map, events: [event], time: 10,
      loadSheets: () => ({ pokemonSheets, trainerSheets: fixture.trainerSheets }),
      random: () => 0.5,
    })
    expect((plan.sheetWrites[0]?.nextSheet as CharacterSheet | undefined)?.combat?.conditions)
      .toContain(condition)
    expect(plan.reduction.trace.some(entry => entry.kind === 'operation-enqueued'
      && entry.handlerId === 'handler.equipment-event-providers')).toBe(true)
  })
})
