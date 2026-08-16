import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerProfile } from '#shared/playerProfiles'
import { createEmptySheetEquipmentState, parseSheetEquipmentStateForOwner } from '#shared/itemAutomation/equipment'
import { parseEquipmentOperationCommand } from '#shared/itemAutomation/equipmentOperations'
import { itemInventoryInstanceId, type ItemInventorySection } from '#shared/itemAutomation/inventory'
import type { CharacterSheet } from '~/types/characterSheet'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import type { TrainerInventory, TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { transferGroupInventoryToTrainerUseCase } from '~~/server/useCases/transferGroupInventoryToTrainer'
import {
  executeEquipmentOperation,
  ExecuteEquipmentOperationUseCaseError,
} from '~~/server/useCases/executeEquipmentOperation'
import { loadSheetUseCase } from '~~/server/useCases/loadSheet'
import { buildEncounterPresentationProjection } from '~~/server/domain/encounterPresentation/buildProjection'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { resolveEquipmentEventProviders } from '~~/server/domain/itemAutomation/equipmentEventProviders'
import { equipmentContributionOwnerContext } from '~~/server/domain/itemAutomation/equipmentContributions'
import { redactRealtimeEventForPrincipal } from '~~/server/realtime/realtimeEventRedaction'
import {
  createItemChoiceMap,
  createItemChoiceTargetSheet,
  ITEM_CHOICE_ACTOR_ID,
  ITEM_CHOICE_TARGET_ID,
} from '../fixtures/moveAutomation/itemChoices'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()?.close() })

const emptyInventory = (): TrainerInventory => ({
  keyItems: [], pokemonItems: [], medicalKit: [], pokeBalls: [], foodStuff: [], equipment: [],
})
const profile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_equipment_multiclient',
  displayName: 'Equipment Player',
  linkedCharacters: [
    { sheetKind: 'trainer', sheetSlug: 'item-choice-trainer' },
    { sheetKind: 'pokemon', sheetSlug: 'item-choice-target-sheet' },
  ],
})
const operationId = (value: number): string =>
  `equipment-operation:v1:${value.toString(16).padStart(32, '0')}`

const trainerFixture = (): TrainerSheet => ({
  slug: 'item-choice-trainer', name: 'Equipment Trainer', level: 20, revision: 3, updatedAt: 10,
  currentTeam: ['item-choice-target-sheet'],
  skillBackground: { name: 'Combatant', adept: 'combat' },
  inventory: emptyInventory(),
  equipmentState: createEmptySheetEquipmentState({
    ownerKind: 'trainer', ownerSlug: 'item-choice-trainer',
  }),
})
const pokemonFixture = (): CharacterSheet => ({
  ...createItemChoiceTargetSheet(),
  revision: 2,
  updatedAt: 10,
  skills: { combat: '4d6' },
  capabilities: { other: ['Wielder'] },
  equipmentState: createEmptySheetEquipmentState({
    ownerKind: 'pokemon', ownerSlug: 'item-choice-target-sheet',
  }),
})

const sourceRow = (
  trainer: TrainerSheet,
  section: ItemInventorySection,
  canonicalItemId: string,
) => {
  const row = trainer.inventory?.[section]?.find(entry => entry.name === canonicalItemId)
  if (!row?.id) throw new Error(`Missing ${canonicalItemId} transfer row.`)
  return row
}

const expectUseCaseStatus = (callback: () => unknown, status: number): void => {
  expect(callback).toThrow(ExecuteEquipmentOperationUseCaseError)
  try { callback() }
  catch (error) { expect((error as ExecuteEquipmentOperationUseCaseError).statusCode).toBe(status) }
}

describe('P8-050 multi-client equipment certification', () => {
  it('converges Trainer and Pokémon transfer/equip/reconnect/remove paths without stale mechanics or private leakage', () => {
    const database = openRotomDatabase({ path: ':memory:', enableWal: false })
    databases.push(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const groups = createSqliteGroupInventoryRepository(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: (() => {
      let now = 1_000
      return () => ++now
    })() })
    const player = profile()

    sheets.save({
      kind: 'trainer', slug: 'item-choice-trainer', revision: 3, updatedAt: 10,
      document: trainerFixture() as unknown as Record<string, unknown>,
    })
    sheets.save({
      kind: 'pokemon', slug: 'item-choice-target-sheet', revision: 2, updatedAt: 10,
      document: pokemonFixture() as unknown as Record<string, unknown>,
    })
    const baseGroup = createDefaultGroupInventoryDocument({ slug: 'main', now: 10 })
    groups.save({
      slug: 'main', revision: 1, updatedAt: 10,
      document: {
        ...baseGroup,
        revision: 1,
        updatedAt: 10,
        inventory: {
          ...baseGroup.inventory,
          equipment: [
            { id: 'group-light-armor', name: 'Light Armor' },
            { id: 'group-survival-knife', name: 'Survival Knife' },
          ],
          pokemonItems: [
            { id: 'group-quick-claw', name: 'Quick Claw', qty: 1 },
            { id: 'group-safety-goggles', name: 'Safety Goggles', qty: 1 },
          ],
        },
      },
    })

    const transfer = (section: 'equipment' | 'pokemonItems', itemId: string, clientId: string) => {
      const group = groups.get('main')!.document
      const trainer = sheets.getByRef('trainer', 'item-choice-trainer')!
      const result = transferGroupInventoryToTrainerUseCase({
        role: 'player', playerProfile: player,
        groupSlug: 'main', groupRevision: group.revision,
        trainerSlug: 'item-choice-trainer', trainerRevision: trainer.revision,
        section, itemId, quantity: 1, clientId,
      }, { database, realtimeEventRepository: realtime, now: () => 20 + group.revision })
      expect(JSON.stringify(result)).not.toContain('sourceInstanceId')
      return result
    }
    transfer('equipment', 'group-light-armor', 'client-a')
    transfer('equipment', 'group-survival-knife', 'client-b')
    transfer('pokemonItems', 'group-quick-claw', 'client-a')
    transfer('pokemonItems', 'group-safety-goggles', 'client-b')
    expect(groups.get('main')!.document.inventory.equipment).toEqual([])
    expect(groups.get('main')!.document.inventory.pokemonItems).toEqual([])

    const currentTrainer = () => sheets.getByRef('trainer', 'item-choice-trainer')!.sheet as unknown as TrainerSheet
    const currentPokemon = () => sheets.getByRef('pokemon', 'item-choice-target-sheet')!.sheet as unknown as CharacterSheet
    const equipFromTrainer = (input: {
      id: number
      item: string
      section: 'equipment' | 'pokemonItems'
      ownerKind: 'trainer' | 'pokemon'
      ownerSlug: string
      slots: readonly ('body' | 'mainHand' | 'held')[]
      commandKind: 'equip' | 'give'
    }) => {
      const trainer = currentTrainer()
      const owner = input.ownerKind === 'trainer' ? trainer : currentPokemon()
      const authority = owner.equipmentState!
      const row = sourceRow(trainer, input.section, input.item)
      return parseEquipmentOperationCommand({
        schemaVersion: 1,
        operationId: operationId(input.id),
        commandKind: input.commandKind,
        actorProfileId: player.id,
        source: {
          kind: 'inventory', containerKind: 'trainer', containerSlug: trainer.slug,
          section: input.section, rowId: row.id,
          sourceInstanceId: itemInventoryInstanceId({
            containerKind: 'trainer', containerSlug: trainer.slug, section: input.section, rowId: row.id,
          }),
          expectedRevision: trainer.revision,
        },
        destination: {
          kind: 'equipment', ownerKind: input.ownerKind, ownerSlug: input.ownerSlug,
          slotIds: input.slots,
          expectedSheetRevision: owner.revision,
          expectedEquipmentRevision: authority.revision,
        },
        replacedInstanceId: null,
        swapReturnDestination: null,
        configuration: null,
      })
    }

    // Client A and B both cache revision 7 and the same Light Armor row.
    const armorA = equipFromTrainer({
      id: 1, item: 'Light Armor', section: 'equipment', ownerKind: 'trainer',
      ownerSlug: 'item-choice-trainer', slots: ['body'], commandKind: 'equip',
    })
    const armorB = parseEquipmentOperationCommand({ ...armorA, operationId: operationId(2) })
    const armorAccepted = executeEquipmentOperation({
      role: 'player', playerProfile: player, command: armorA, clientId: 'client-a',
    }, { database, realtimeEventRepository: realtime, now: () => 30 })
    const armorEventCount = realtime.readAfter({ afterSequence: 0, limit: 500 }).events.length
    expect(executeEquipmentOperation({
      role: 'player', playerProfile: player, command: armorA, clientId: 'client-a-reconnect',
    }, { database, realtimeEventRepository: realtime, now: () => 31 }).result.exactReplay).toBe(true)
    expect(realtime.readAfter({ afterSequence: 0, limit: 500 }).events).toHaveLength(armorEventCount)
    expectUseCaseStatus(() => executeEquipmentOperation({
      role: 'player', playerProfile: player, command: armorB, clientId: 'client-b',
    }, { database, realtimeEventRepository: realtime, now: () => 32 }), 409)

    const trainerReconnectWithArmor = loadSheetUseCase({
      role: 'player', playerProfile: player, kind: 'trainer', slug: 'item-choice-trainer',
    }, { sheetRepository: sheets }).sheet as TrainerSheet
    expect(trainerReconnectWithArmor.equipmentProjection?.instances).toEqual([
      expect.objectContaining({ canonicalItemId: 'Light Armor', activity: { status: 'active', reasonCodes: [] } }),
    ])
    expect(trainerReconnectWithArmor.equipmentContributionProjection?.values).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Damage reduction', final: 5 })]),
    )
    expect(JSON.stringify(trainerReconnectWithArmor)).not.toContain(armorAccepted.result.equippedInstanceId)

    const armorInstance = parseSheetEquipmentStateForOwner(currentTrainer().equipmentState, {
      kind: 'trainer', slug: 'item-choice-trainer',
    }).instances[0]!
    const armorUnequip = parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: operationId(3), commandKind: 'unequip', actorProfileId: player.id,
      source: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'item-choice-trainer',
        instanceId: armorInstance.instanceId,
        expectedSheetRevision: currentTrainer().revision,
        expectedEquipmentRevision: currentTrainer().equipmentState!.revision,
        expectedInstanceRevision: armorInstance.revision,
      },
      destination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'item-choice-trainer',
        section: 'equipment', expectedRevision: currentTrainer().revision,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    })
    executeEquipmentOperation({ role: 'player', playerProfile: player, command: armorUnequip, clientId: 'client-b' }, {
      database, realtimeEventRepository: realtime, now: () => 33,
    })
    const trainerAfterArmorLoss = loadSheetUseCase({
      role: 'player', playerProfile: player, kind: 'trainer', slug: 'item-choice-trainer',
    }, { sheetRepository: sheets }).sheet as TrainerSheet
    expect(trainerAfterArmorLoss.equipmentContributionProjection?.values
      .some(value => value.label === 'Damage reduction')).toBe(false)

    const knifeCommand = equipFromTrainer({
      id: 4, item: 'Survival Knife', section: 'equipment', ownerKind: 'trainer',
      ownerSlug: 'item-choice-trainer', slots: ['mainHand'], commandKind: 'equip',
    })
    const knifeAccepted = executeEquipmentOperation({
      role: 'player', playerProfile: player, command: knifeCommand, clientId: 'client-a',
    }, { database, realtimeEventRepository: realtime, now: () => 34 })
    const map = createItemChoiceMap()
    const encounterProjection = buildEncounterPresentationProjection({
      role: 'player', playerProfile: player, map, mapRevision: map.revision,
      trainerSheets: [currentTrainer()], pokemonSheets: [currentPokemon()], generatedAt: 35,
    })
    const cheapShot = encounterProjection.offers.find(offer => offer.source.canonicalId === 'Cheap Shot')
    expect(cheapShot).toMatchObject({
      availability: { status: 'available' },
      source: { displayName: 'Cheap Shot (Survival Knife)' },
    })
    expect(cheapShot?.source.instanceId).toMatch(/^attack-source\.v1\.[a-f0-9]{64}$/)
    expect(JSON.stringify(encounterProjection)).not.toContain(knifeAccepted.result.equippedInstanceId)

    const knifeInstance = currentTrainer().equipmentState!.instances[0]!
    const knifeUnequip = parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: operationId(5), commandKind: 'unequip', actorProfileId: player.id,
      source: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'item-choice-trainer',
        instanceId: knifeInstance.instanceId,
        expectedSheetRevision: currentTrainer().revision,
        expectedEquipmentRevision: currentTrainer().equipmentState!.revision,
        expectedInstanceRevision: knifeInstance.revision,
      },
      destination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'item-choice-trainer',
        section: 'equipment', expectedRevision: currentTrainer().revision,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    })
    executeEquipmentOperation({ role: 'player', playerProfile: player, command: knifeUnequip, clientId: 'client-b' }, {
      database, realtimeEventRepository: realtime, now: () => 36,
    })
    const afterKnifeLoss = buildEncounterPresentationProjection({
      role: 'player', playerProfile: player, map, mapRevision: map.revision,
      trainerSheets: [currentTrainer()], pokemonSheets: [currentPokemon()], generatedAt: 37,
    })
    expect(afterKnifeLoss.offers.some(offer => offer.source.canonicalId === 'Cheap Shot')).toBe(false)
    expect(afterKnifeLoss.passives.some(passive => passive.source.canonicalId === 'Survival Knife')).toBe(false)
    expect(buildAuthoritativeMoveRulesContext({
      map,
      trainerSheets: new Map([[currentTrainer().slug, currentTrainer()]]),
      pokemonSheets: new Map([[currentPokemon().slug, currentPokemon()]]),
      intent: {
        schemaVersion: 1,
        placementId: ITEM_CHOICE_ACTOR_ID,
        moveName: 'Cheap Shot',
        attackSourceId: cheapShot!.source.instanceId as `attack-source.v1.${string}`,
        selection: { kind: 'single-target', targetPlacementId: ITEM_CHOICE_TARGET_ID },
      },
      candidatePlacementIds: [ITEM_CHOICE_TARGET_ID],
      selectedPlacementIds: [ITEM_CHOICE_TARGET_ID],
      random: () => 0,
      time: 37,
    }).queries.resolveActorMoveEntry('Cheap Shot')).toMatchObject({ ok: false })

    // Pokémon path: two clients cache the same Trainer/Pokémon revisions before give.
    const quickA = equipFromTrainer({
      id: 6, item: 'Quick Claw', section: 'pokemonItems', ownerKind: 'pokemon',
      ownerSlug: 'item-choice-target-sheet', slots: ['held'], commandKind: 'give',
    })
    const quickB = parseEquipmentOperationCommand({ ...quickA, operationId: operationId(7) })
    executeEquipmentOperation({ role: 'player', playerProfile: player, command: quickA, clientId: 'client-a' }, {
      database, realtimeEventRepository: realtime, now: () => 38,
    })
    expectUseCaseStatus(() => executeEquipmentOperation({
      role: 'player', playerProfile: player, command: quickB, clientId: 'client-b',
    }, { database, realtimeEventRepository: realtime, now: () => 39 }), 409)
    const pokemonReconnectWithClaw = loadSheetUseCase({
      role: 'player', playerProfile: player, kind: 'pokemon', slug: 'item-choice-target-sheet',
    }, { sheetRepository: sheets }).sheet as CharacterSheet
    expect(pokemonReconnectWithClaw.equipmentContributionProjection?.values).toEqual(
      expect.arrayContaining([expect.objectContaining({
        label: 'Initiative',
        sources: [expect.objectContaining({ sourceLabel: 'Quick Claw', applied: 10 })],
      })]),
    )
    expect(JSON.stringify(pokemonReconnectWithClaw)).not.toContain(currentPokemon().equipmentState!.instances[0]!.instanceId)

    const trainerBeforeSwap = currentTrainer()
    const pokemonBeforeSwap = currentPokemon()
    const gogglesRow = sourceRow(trainerBeforeSwap, 'pokemonItems', 'Safety Goggles')
    const quickInstance = pokemonBeforeSwap.equipmentState!.instances[0]!
    const gogglesSwap = parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: operationId(8), commandKind: 'swap', actorProfileId: player.id,
      source: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: trainerBeforeSwap.slug,
        section: 'pokemonItems', rowId: gogglesRow.id,
        sourceInstanceId: itemInventoryInstanceId({
          containerKind: 'trainer', containerSlug: trainerBeforeSwap.slug,
          section: 'pokemonItems', rowId: gogglesRow.id,
        }),
        expectedRevision: trainerBeforeSwap.revision,
      },
      destination: {
        kind: 'equipment', ownerKind: 'pokemon', ownerSlug: pokemonBeforeSwap.slug, slotIds: ['held'],
        expectedSheetRevision: pokemonBeforeSwap.revision,
        expectedEquipmentRevision: pokemonBeforeSwap.equipmentState!.revision,
      },
      replacedInstanceId: quickInstance.instanceId,
      swapReturnDestination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: trainerBeforeSwap.slug,
        section: 'pokemonItems', expectedRevision: trainerBeforeSwap.revision,
      },
      configuration: null,
    })
    executeEquipmentOperation({ role: 'player', playerProfile: player, command: gogglesSwap, clientId: 'client-b' }, {
      database, realtimeEventRepository: realtime, now: () => 40,
    })
    const gogglesState = currentPokemon().equipmentState!
    expect(resolveEquipmentEventProviders({
      equipmentState: gogglesState,
      owner: equipmentContributionOwnerContext({
        kind: 'pokemon', slug: currentPokemon().slug, sheet: currentPokemon(),
      }),
    }).active.map(source => source.provider.providerId)).toContain('equipment.safety-goggles.powder-immunity')
    const pokemonReconnectWithGoggles = loadSheetUseCase({
      role: 'player', playerProfile: player, kind: 'pokemon', slug: 'item-choice-target-sheet',
    }, { sheetRepository: sheets }).sheet as CharacterSheet
    expect(pokemonReconnectWithGoggles.equipmentContributionProjection?.values
      .some(value => value.label === 'Initiative')).toBe(false)
    expect(JSON.stringify(pokemonReconnectWithGoggles)).not.toContain('sourceBindingSha256')

    const gogglesInstance = currentPokemon().equipmentState!.instances[0]!
    const trainerBeforeTake = currentTrainer()
    const pokemonBeforeTake = currentPokemon()
    const take = parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: operationId(9), commandKind: 'take', actorProfileId: player.id,
      source: {
        kind: 'equipment', ownerKind: 'pokemon', ownerSlug: pokemonBeforeTake.slug,
        instanceId: gogglesInstance.instanceId,
        expectedSheetRevision: pokemonBeforeTake.revision,
        expectedEquipmentRevision: pokemonBeforeTake.equipmentState!.revision,
        expectedInstanceRevision: gogglesInstance.revision,
      },
      destination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: trainerBeforeTake.slug,
        section: 'pokemonItems', expectedRevision: trainerBeforeTake.revision,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    })
    executeEquipmentOperation({ role: 'player', playerProfile: player, command: take, clientId: 'client-a' }, {
      database, realtimeEventRepository: realtime, now: () => 41,
    })
    expect(currentPokemon().equipmentState!.instances).toEqual([])
    expect(resolveEquipmentEventProviders({
      equipmentState: currentPokemon().equipmentState,
      owner: equipmentContributionOwnerContext({
        kind: 'pokemon', slug: currentPokemon().slug, sheet: currentPokemon(),
      }),
    }).active).toEqual([])

    const finalTrainer = loadSheetUseCase({
      role: 'player', playerProfile: player, kind: 'trainer', slug: 'item-choice-trainer',
    }, { sheetRepository: sheets }).sheet as TrainerSheet
    const finalPokemon = loadSheetUseCase({
      role: 'player', playerProfile: player, kind: 'pokemon', slug: 'item-choice-target-sheet',
    }, { sheetRepository: sheets }).sheet as CharacterSheet
    expect(finalPokemon.equipmentProjection?.instances).toEqual([])
    expect(finalPokemon.equipmentContributionProjection?.values ?? []).toEqual([])
    expect((finalTrainer.inventory?.pokemonItems ?? []).map(row => row.name)).toEqual(
      expect.arrayContaining(['Quick Claw', 'Safety Goggles']),
    )

    const events = realtime.readAfter({ afterSequence: 0, limit: 500 }).events
    expect(events.length).toBeGreaterThan(20)
    expect(events.every((entry, index) => index === 0 || entry.sequence > events[index - 1]!.sequence)).toBe(true)
    for (const entry of events) {
      const delivered = redactRealtimeEventForPrincipal(entry.event, { role: 'player' })
      const json = JSON.stringify(delivered)
      expect(json).not.toContain('equipped-item:v1:')
      expect(json).not.toContain('canonicalRecordSha256')
      expect(json).not.toContain('equipmentDefinitionSha256')
      expect(json).not.toContain('sourceInstanceId')
      expect(json).not.toContain('serializedEquipment')
    }
  })
})
