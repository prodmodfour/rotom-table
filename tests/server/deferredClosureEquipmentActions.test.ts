import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseExecuteEquipmentActionCommand } from '#shared/itemAutomation/equipmentActions'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { resolveEquipmentGrants, equipmentGrantOwnerContext } from '~~/server/domain/itemAutomation/equipmentGrants'
import { resolveEquipmentContributions, equipmentContributionOwnerContext } from '~~/server/domain/itemAutomation/equipmentContributions'
import { executeDeferredEquipmentActionMechanic } from '~~/server/domain/itemAutomation/deferredEquipmentActions'
import { buildEncounterPresentationProjection } from '~~/server/domain/encounterPresentation/buildProjection'
import { attachEncounterEquipmentActionCommandTemplate } from '~~/server/domain/itemAutomation/equipmentActionCommandTemplate'
import { parseAuthorizedItemActionOffer } from '#shared/itemAutomation/projection'
import { reconcileCapabilityRuntimeSourceLoss } from '~~/server/domain/capabilityAutomation/sourceLoss'
import { applyEncounterEffectLifecycleEvent } from '~~/server/domain/moveAutomation/effectLifecycle'
import { activeEquipmentState } from '../fixtures/equipment'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'deferred-equipment-actions',
  name: 'Deferred Equipment Actions',
  revision: 4,
  dimensions: { x: 12, y: 4, z: 12 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  placements: [{
    id: 'shield-actor', sheetKind: 'trainer', sheetSlug: 'shield-trainer',
    position: { x: 1, y: 0, z: 1 }, sideId: 'red',
  }],
  encounterState: createEmptyEncounterState(),
})

const shieldTrainer = (
  canonicalItemId: 'Light Shield' | 'Heavy Shield',
  twoHanded = false,
): TrainerSheet => ({
  slug: 'shield-trainer',
  name: 'Shield Trainer',
  level: 20,
  currentHp: 50,
  skillBackground: { adept: 'combat' },
  equipmentState: activeEquipmentState({
    ownerKind: 'trainer', ownerSlug: 'shield-trainer', slotId: twoHanded ? 'mainHand' : 'offHand',
    ...(twoHanded ? { additionalSlotIds: ['offHand'] } : {}),
    canonicalItemId,
  }),
})

const executeShield = (canonicalItemId: 'Light Shield' | 'Heavy Shield') => {
  const map = mapFixture()
  const trainer = shieldTrainer(canonicalItemId)
  const actionId = canonicalItemId === 'Light Shield'
    ? 'equipment.light-shield.ready' as const : 'equipment.heavy-shield.ready' as const
  const resolved = resolveEquipmentGrants({
    equipmentState: trainer.equipmentState,
    owner: equipmentGrantOwnerContext({ kind: 'trainer', slug: trainer.slug, sheet: trainer, transformed: false }),
  })
  const source = resolved.active.find(entry => entry.grant.kind === 'action' && entry.grant.actionId === actionId)!
  const command = parseExecuteEquipmentActionCommand({
    schemaVersion: 1,
    operationId: `equipment-operation-${canonicalItemId.toLowerCase().replaceAll(' ', '-')}`,
    offerId: `equipment-offer-${canonicalItemId.toLowerCase().replaceAll(' ', '-')}`,
    mapSlug: map.slug,
    baseRevision: 4,
    actorPlacementId: 'shield-actor',
    actionId,
    equipmentInstanceId: source.instanceId,
    equipmentInstanceRevision: source.instanceRevision,
    targetEquipmentInstanceId: null,
    targetEquipmentInstanceRevision: null,
    targetPlacementIds: [],
    cells: [],
    inventorySourceInstanceId: null,
    skillCheckId: null,
    gmAdjudication: null,
  })
  const execution = executeDeferredEquipmentActionMechanic({
    command,
    source,
    map,
    actorPlacement: map.placements[0]!,
    actorSheet: trainer,
    pokemonSheets: new Map(),
    trainerSheets: new Map([[trainer.slug, trainer]]),
    rollD20: () => { throw new Error('Shield readying does not roll.') },
    equipmentGrantsForPlacement: placementId => placementId === 'shield-actor' ? resolved : null,
  })
  return { command, execution, map, trainer, source }
}

describe('P11-032 native shield ready actions', () => {
  it.each([
    ['Light Shield', 2, 10],
    ['Heavy Shield', 4, 15],
  ] as const)('readies %s with typed Evasion, DR, and Slowed effects through next turn', (item, evasion, dr) => {
    const { command, execution, trainer } = executeShield(item)
    expect(resolveEquipmentContributions({
      equipmentState: trainer.equipmentState,
      owner: equipmentContributionOwnerContext({ kind: 'trainer', slug: trainer.slug, sheet: trainer }),
    }).active).toContainEqual(expect.objectContaining({
      metric: 'evasion', operation: 'add', value: 2,
    }))
    expect(execution.status).toBe('accepted')
    expect(execution.rolls).toEqual([])
    expect(execution.receipts.map(entry => entry.kind)).toEqual([
      'item-declaration', 'duration-effect', 'accepted-result',
    ])
    expect(execution.map.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'numeric-modifier',
        affected: expect.objectContaining({ placementIds: [command.actorPlacementId] }),
        duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 2 },
        payload: { attribute: 'evasion', operation: 'add', value: evasion, rounding: 'none' },
      }),
      expect.objectContaining({
        kind: 'numeric-modifier',
        payload: { attribute: 'damage-reduction', operation: 'add', value: dr, rounding: 'none' },
      }),
      expect.objectContaining({
        kind: 'condition', payload: expect.objectContaining({ conditionId: 'slowed' }),
      }),
    ]))
  })

  it('re-ready replaces its own durable effects instead of stacking', () => {
    const first = executeShield('Light Shield')
    const second = executeDeferredEquipmentActionMechanic({
      command: { ...first.command, operationId: 'equipment-operation-light-shield-repeat' },
      source: first.source,
      map: first.execution.map,
      actorPlacement: first.map.placements[0]!,
      actorSheet: first.trainer,
      pokemonSheets: new Map(),
      trainerSheets: new Map([[first.trainer.slug, first.trainer]]),
      rollD20: () => { throw new Error('Shield readying does not roll.') },
      equipmentGrantsForPlacement: () => ({ active: [first.source], inactive: [] }),
    })
    expect(second.map.encounterState?.effects.filter(effect => effect.tags.includes('equipment.shield.ready')))
      .toHaveLength(3)
  })

  it('projects native ready offers and retains the two-handed Small Melee variant', () => {
    const map = mapFixture()
    const oneHanded = shieldTrainer('Light Shield')
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4, pokemonSheets: [], trainerSheets: [oneHanded], generatedAt: 100,
    })
    expect(projection.offers.find(offer => offer.intent.actionId === 'equipment.light-shield.ready'))
      .toMatchObject({ availability: { status: 'available' }, timing: { kind: 'standard' } })

    const twoHanded = shieldTrainer('Light Shield', true)
    const armed = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4, pokemonSheets: [], trainerSheets: [twoHanded], generatedAt: 100,
    })
    expect(armed.offers.some(offer => (
      offer.source.canonicalId === 'Struggle' && offer.source.displayName.includes('Light Shield')
    ))).toBe(true)
  })

  it('expires every readied effect at the end of the actor next turn', () => {
    const fixture = executeShield('Light Shield')
    const firstEnd = applyEncounterEffectLifecycleEvent({
      effects: fixture.execution.map.encounterState?.effects ?? [],
    }, { kind: 'turn-end', placementId: 'shield-actor' })
    expect(firstEnd.effects.filter(effect => effect.tags.includes('equipment.shield.ready')))
      .toHaveLength(3)
    expect(firstEnd.effects.find(effect => effect.tags.includes('equipment.shield.ready'))?.duration)
      .toMatchObject({ remaining: 1 })
    const nextEnd = applyEncounterEffectLifecycleEvent({ effects: firstEnd.effects }, {
      kind: 'turn-end', placementId: 'shield-actor',
    })
    expect(nextEnd.effects.filter(effect => effect.tags.includes('equipment.shield.ready')))
      .toEqual([])
  })

  it('withdraws readied effects after exact shield source loss', () => {
    const fixture = executeShield('Heavy Shield')
    const state = fixture.trainer.equipmentState!
    const withoutShield: TrainerSheet = {
      ...fixture.trainer,
      equipmentState: {
        ...state,
        revision: state.revision + 1,
        slots: state.slots.map(slot => ({ ...slot, instanceId: null })),
        instances: [],
      },
    }
    const reconciled = reconcileCapabilityRuntimeSourceLoss({
      map: fixture.execution.map,
      sheets: { pokemon: new Map(), trainer: new Map([[withoutShield.slug, withoutShield]]) },
    })
    expect(reconciled.encounterState?.effects.filter(effect => effect.tags.includes('equipment.shield.ready')))
      .toEqual([])
  })

  it('reveals exact whole-item authority only in the private declaration receipt', () => {
    const map = mapFixture()
    const trainer = shieldTrainer('Light Shield')
    const offer = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4, pokemonSheets: [], trainerSheets: [trainer], generatedAt: 100,
    }).offers.find(candidate => candidate.intent.actionId === 'equipment.light-shield.ready')!
    const exactInstanceId = trainer.equipmentState!.instances[0]!.instanceId
    expect(JSON.stringify(offer)).not.toContain(exactInstanceId)
    const authorized = parseAuthorizedItemActionOffer(attachEncounterEquipmentActionCommandTemplate({
      offer,
      intent: {
        schemaVersion: 1,
        intentId: 'shield-declaration-intent',
        offerId: offer.offerId,
        mapSlug: map.slug,
        baseRevision: 4,
        actorParticipantId: 'shield-actor',
        actionId: 'equipment.light-shield.ready',
        selections: [],
      },
      map,
      mapRevision: 4,
      pokemonSheets: [],
      trainerSheets: [trainer],
    }))
    expect(authorized.equipmentActionCommand).toMatchObject({
      equipmentInstanceId: exactInstanceId,
      actionId: 'equipment.light-shield.ready',
    })
  })

  it('rejects stale exact source identity before creating effects', () => {
    const fixture = executeShield('Heavy Shield')
    expect(() => executeDeferredEquipmentActionMechanic({
      command: { ...fixture.command, equipmentInstanceRevision: fixture.command.equipmentInstanceRevision + 1 },
      source: fixture.source,
      map: fixture.map,
      actorPlacement: fixture.map.placements[0]!,
      actorSheet: fixture.trainer,
      pokemonSheets: new Map(),
      trainerSheets: new Map([[fixture.trainer.slug, fixture.trainer]]),
      rollD20: () => { throw new Error('Shield readying does not roll.') },
      equipmentGrantsForPlacement: () => ({ active: [fixture.source], inactive: [] }),
    })).toThrowError(expect.objectContaining({ code: 'equipment-action.source-stale' }))
  })
})
