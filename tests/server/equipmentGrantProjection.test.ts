import { describe, expect, it } from 'vitest'
import type { PlayerProfile } from '#shared/playerProfiles'
import { buildEncounterPresentationProjection } from '~~/server/domain/encounterPresentation/buildProjection'
import { resolveEffectiveCapabilities } from '~~/server/domain/capabilityAutomation/effectiveCapabilities'
import { createMoveEquipmentGrantQueries } from '~~/server/domain/moveAutomation/equipmentGrantQueries'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { effectiveRuntimeAbilityIds } from '~~/server/domain/abilityAutomation/effectiveRuntimeAbilities'
import { createEncounterGlobalFieldZone } from '~~/server/domain/moveAutomation/fieldLifecycle'
import { activeEquipmentState } from '../fixtures/equipment'
import {
  createItemChoiceMap,
  createItemChoiceTargetSheet,
  createItemChoiceTrainerSheet,
  ITEM_CHOICE_TARGET_ID,
} from '../fixtures/moveAutomation/itemChoices'

const wielderSheet = (item = 'Survival Knife') => ({
  ...createItemChoiceTargetSheet(),
  nickname: 'Equipment Wielder',
  species: 'Pikachu',
  skills: { combat: '4d6' },
  capabilities: { other: ['Wielder'] },
  // Legacy display text deliberately disagrees and has no authority.
  items: { held: 'Meteor Masher' },
  equipmentState: activeEquipmentState({
    ownerKind: 'pokemon', ownerSlug: 'item-choice-target-sheet', slotId: 'held',
    canonicalItemId: item,
  }),
})

describe('P8-047 authoritative equipment grant projection', () => {
  it('resolves only active hash-current grants and withdraws them under suppression', () => {
    const map = createItemChoiceMap()
    const sheet = wielderSheet()
    const allowed = createMoveEquipmentGrantQueries({
      placements: map.placements,
      sheets: [{ kind: 'pokemon', slug: sheet.slug, sheet }],
      itemEffects: { resolve: () => ({ suppressed: false }) as never },
    }).resolve(ITEM_CHOICE_TARGET_ID)
    expect(allowed?.active.map(entry => entry.grant.kind)).toEqual(['move', 'weapon-profile'])
    expect(allowed?.active.find(entry => entry.grant.kind === 'move')?.grant)
      .toMatchObject({ canonicalId: 'Cheap Shot', executionStatus: 'native' })

    const staleSheet = {
      ...sheet,
      equipmentState: {
        ...sheet.equipmentState!,
        instances: sheet.equipmentState!.instances.map(instance => ({
          ...instance, canonicalRecordSha256: '0'.repeat(64),
        })),
      },
    }
    const stale = createMoveEquipmentGrantQueries({
      placements: map.placements,
      sheets: [{ kind: 'pokemon', slug: staleSheet.slug, sheet: staleSheet }],
      itemEffects: { resolve: () => ({ suppressed: false }) as never },
    }).resolve(ITEM_CHOICE_TARGET_ID)
    expect(stale?.active).toEqual([])
    expect(stale?.inactive[0]).toMatchObject({ reasonCode: 'equipment-grant.definition-stale' })

    const suppressed = createMoveEquipmentGrantQueries({
      placements: map.placements,
      sheets: [{ kind: 'pokemon', slug: sheet.slug, sheet }],
      itemEffects: { resolve: () => ({ suppressed: true }) as never },
    }).resolve(ITEM_CHOICE_TARGET_ID)
    expect(suppressed?.active).toEqual([])
    expect(suppressed?.inactive).toEqual([
      expect.objectContaining({ canonicalItemId: 'Survival Knife', reasonCode: 'equipment-grant.suppressed' }),
    ])
  })

  it('projects native weapon Moves and sourced Struggle offers without leaking serialized identity', () => {
    const map = createItemChoiceMap()
    const pokemon = wielderSheet()
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4,
      pokemonSheets: [pokemon], trainerSheets: [createItemChoiceTrainerSheet()], generatedAt: 100,
    })
    const cheapShot = projection.offers.find(offer => offer.source.canonicalId === 'Cheap Shot')
    expect(cheapShot).toMatchObject({
      availability: { status: 'available' },
      source: { displayName: 'Cheap Shot (Survival Knife)' },
    })
    expect(cheapShot?.source.instanceId).toMatch(/^attack-source\.v1\.[a-f0-9]{64}$/)
    expect(projection.offers.some(offer => (
      offer.source.canonicalId === 'Struggle'
      && offer.source.displayName.includes('Survival Knife')
    ))).toBe(true)
    const serializedIdentity = pokemon.equipmentState!.instances[0]!.instanceId
    expect(JSON.stringify(projection)).not.toContain(serializedIdentity)
    expect(JSON.stringify(projection)).not.toContain('canonicalRecordSha256')
    expect(JSON.stringify(projection)).not.toContain('equipmentDefinitionSha256')
    expect(projection.passives.find(passive => passive.source.canonicalId === 'Survival Knife'))
      .toMatchObject({ active: true, source: { instanceId: 'equipment-source:item-choice-target:1' } })
  })

  it('projects trainer weapon attacks from exact equipped custody rather than descriptive slot text', () => {
    const map = createItemChoiceMap()
    const trainer = {
      ...createItemChoiceTrainerSheet(),
      skillBackground: { name: 'Combatant', adept: 'combat' as const },
      equipmentSlots: { mainHand: 'Meteor Masher' },
      equipmentState: activeEquipmentState({
        ownerKind: 'trainer', ownerSlug: 'item-choice-trainer', slotId: 'mainHand',
        canonicalItemId: 'Survival Knife',
      }),
    }
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4,
      pokemonSheets: [createItemChoiceTargetSheet()], trainerSheets: [trainer], generatedAt: 100,
    })
    expect(projection.offers.find(offer => offer.source.canonicalId === 'Cheap Shot'))
      .toMatchObject({ source: { displayName: 'Cheap Shot (Survival Knife)' }, availability: { status: 'available' } })
    expect(projection.offers.some(offer => offer.source.displayName.includes('Meteor Masher'))).toBe(false)
    const player = buildEncounterPresentationProjection({
      role: 'player',
      playerProfile: {
        schemaVersion: 1, id: 'profile_equipment_grants', displayName: 'Equipment Player',
        linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainer.slug }],
      } as PlayerProfile,
      map, mapRevision: 4,
      pokemonSheets: [createItemChoiceTargetSheet()], trainerSheets: [trainer], generatedAt: 100,
    })
    expect(JSON.stringify(player)).not.toContain(trainer.equipmentState!.instances[0]!.instanceId)
    expect(player.offers.find(offer => offer.source.canonicalId === 'Cheap Shot')?.source.instanceId)
      .toMatch(/^attack-source\.v1\.[a-f0-9]{64}$/)
  })

  it('keeps ranged weapon classes fail-closed until exact attack-range semantics are reviewed', () => {
    const map = createItemChoiceMap()
    const trainer = {
      ...createItemChoiceTrainerSheet(),
      skillBackground: { name: 'Combatant', adept: 'combat' as const },
      equipmentState: activeEquipmentState({
        ownerKind: 'trainer', ownerSlug: 'item-choice-trainer', slotId: 'mainHand',
        canonicalItemId: 'Weighted Rope',
      }),
    }
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4,
      pokemonSheets: [createItemChoiceTargetSheet()], trainerSheets: [trainer], generatedAt: 100,
    })
    expect(projection.offers.find(offer => offer.presentation.label === 'Use Weighted Rope as a weapon'))
      .toMatchObject({ availability: { status: 'unavailable', reasons: [{ code: 'action.unsupported' }] } })
    expect(projection.offers.some(offer => (
      offer.source.canonicalId === 'Struggle' && offer.source.displayName.includes('Weighted Rope')
    ))).toBe(false)
  })

  it('keeps reviewed missing Move definitions unavailable while native contextual actions stay on their dedicated workflow', () => {
    const map = createItemChoiceMap()
    const pokemon = {
      ...wielderSheet('Honed Claws'),
      skills: { combat: '6d6' },
    }
    const trainer = {
      ...createItemChoiceTrainerSheet(),
      equipmentState: activeEquipmentState({
        ownerKind: 'trainer', ownerSlug: 'item-choice-trainer', slotId: 'accessory', canonicalItemId: 'Mega Ring',
      }),
    }
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4,
      pokemonSheets: [pokemon], trainerSheets: [trainer], generatedAt: 100,
    })
    expect(projection.offers.find(offer => offer.presentation.label === 'Gouge')).toMatchObject({
      availability: { status: 'unavailable', reasons: [{ code: 'action.unsupported' }] },
      source: { canonicalId: 'Honed Claws' },
    })
    expect(projection.offers.find(offer => offer.presentation.label === 'Mega Evolve')).toBeUndefined()
    expect(projection.affordances.find(entry => entry.presentation.label === 'Mega Evolve')).toBeUndefined()
    expect(JSON.stringify(projection)).not.toContain('P8-057')
  })

  it('withdraws item sources immediately under Magic Room or source loss and never revives descriptive text', () => {
    const map = createItemChoiceMap()
    const equipped = wielderSheet()
    const availableBeforeSuppression = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4,
      pokemonSheets: [equipped], trainerSheets: [createItemChoiceTrainerSheet()], generatedAt: 100,
    })
    const staleAttackSourceId = availableBeforeSuppression.offers.find(offer => (
      offer.source.canonicalId === 'Cheap Shot'
    ))?.source.instanceId
    expect(staleAttackSourceId).toMatch(/^attack-source\.v1\./)
    map.encounterState = {
      ...map.encounterState!,
      zones: [createEncounterGlobalFieldZone({
        kind: 'room', fieldId: 'magic', sideId: 'heroes',
        source: { kind: 'operation', operationId: 'operation.magic', moveId: 'move.magic', placementId: 'item-choice-actor' },
        duration: { kind: 'rounds', boundary: 'end', remaining: 3 },
        replacementGroup: 'field.room.magic',
      })],
    }
    const suppressed = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 5,
      pokemonSheets: [equipped], trainerSheets: [createItemChoiceTrainerSheet()], generatedAt: 101,
    })
    expect(suppressed.offers.some(offer => offer.source.canonicalId === 'Cheap Shot')).toBe(false)
    expect(suppressed.passives.some(passive => passive.source.canonicalId === 'Survival Knife')).toBe(false)
    const staleExecution = buildAuthoritativeMoveRulesContext({
      map,
      pokemonSheets: new Map([[equipped.slug, equipped]]),
      trainerSheets: new Map([[createItemChoiceTrainerSheet().slug, createItemChoiceTrainerSheet()]]),
      intent: {
        schemaVersion: 1, placementId: ITEM_CHOICE_TARGET_ID, moveName: 'Cheap Shot',
        attackSourceId: staleAttackSourceId as `attack-source.v1.${string}`,
        selection: { kind: 'single-target', targetPlacementId: 'item-choice-actor' },
      },
      candidatePlacementIds: ['item-choice-actor'], selectedPlacementIds: ['item-choice-actor'],
      random: () => 0, time: 101,
    }).queries.resolveActorMoveEntry('Cheap Shot')
    expect(staleExecution).toMatchObject({ ok: false })
    map.encounterState = { ...map.encounterState, zones: [] }
    const withoutSource = { ...equipped, equipmentState: undefined }
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 5,
      pokemonSheets: [withoutSource], trainerSheets: [createItemChoiceTrainerSheet()], generatedAt: 101,
    })
    expect(projection.offers.some(offer => offer.source.displayName.includes('Meteor Masher'))).toBe(false)
    expect(projection.offers.some(offer => offer.source.canonicalId === 'Cheap Shot')).toBe(false)
    expect(projection.passives.some(passive => passive.source.canonicalId === 'Survival Knife')).toBe(false)
  })

  it('keeps Re-Breather activation explicit and does not falsely grant durable Gilled', () => {
    const map = createItemChoiceMap()
    const trainer = {
      ...createItemChoiceTrainerSheet(),
      equipmentState: activeEquipmentState({
        ownerKind: 'trainer', ownerSlug: 'item-choice-trainer', slotId: 'head',
        canonicalItemId: 'Re-Breather',
      }),
    }
    const placement = map.placements.find(entry => entry.id === 'item-choice-actor')!
    expect(resolveEffectiveCapabilities({ map, placement, sheet: trainer }).instances
      .some(instance => instance.canonicalId === 'Gilled')).toBe(false)
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4,
      pokemonSheets: [createItemChoiceTargetSheet()], trainerSheets: [trainer], generatedAt: 100,
    })
    expect(projection.offers.find(offer => offer.presentation.label === 'Activate Re-Breather')).toBeUndefined()
    expect(projection.affordances.find(entry => entry.presentation.label === 'Activate Re-Breather')).toBeUndefined()
  })

  it('projects explicit while-equipped Ability grants through presentation and execution authority', () => {
    const map = createItemChoiceMap()
    const pokemon = {
      ...createItemChoiceTargetSheet(),
      equipmentState: activeEquipmentState({
        ownerKind: 'pokemon', ownerSlug: 'item-choice-target-sheet', slotId: 'held',
        canonicalItemId: 'Full Incense',
      }),
    }
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4,
      pokemonSheets: [pokemon], trainerSheets: [createItemChoiceTrainerSheet()], generatedAt: 100,
    })
    expect(projection.passives).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: expect.objectContaining({ sourceKind: 'ability', canonicalId: 'Stall' }) }),
      expect.objectContaining({ source: expect.objectContaining({ sourceKind: 'item', canonicalId: 'Full Incense' }) }),
    ]))
    const pokemonPlacement = map.placements.find(entry => entry.id === ITEM_CHOICE_TARGET_ID)!
    expect(effectiveRuntimeAbilityIds({ map, placement: pokemonPlacement, sheet: pokemon })).toContain('Stall')
    const context = buildAuthoritativeMoveRulesContext({
      map,
      pokemonSheets: new Map([[pokemon.slug, pokemon]]),
      trainerSheets: new Map([[createItemChoiceTrainerSheet().slug, createItemChoiceTrainerSheet()]]),
      intent: {
        schemaVersion: 1, placementId: ITEM_CHOICE_TARGET_ID, moveName: 'Struggle',
        selection: { kind: 'single-target', targetPlacementId: 'item-choice-actor' },
      },
      candidatePlacementIds: ['item-choice-actor'], selectedPlacementIds: ['item-choice-actor'],
      random: () => 0, time: 100,
    })
    expect(context.queries.abilities.has(ITEM_CHOICE_TARGET_ID, 'Stall')).toBe(true)
    const descriptiveOnly = { ...pokemon, equipmentState: undefined, items: { held: 'Full Incense' } }
    const withoutAuthority = buildAuthoritativeMoveRulesContext({
      map,
      pokemonSheets: new Map([[descriptiveOnly.slug, descriptiveOnly]]),
      trainerSheets: new Map([[createItemChoiceTrainerSheet().slug, createItemChoiceTrainerSheet()]]),
      intent: {
        schemaVersion: 1, placementId: ITEM_CHOICE_TARGET_ID, moveName: 'Struggle',
        selection: { kind: 'single-target', targetPlacementId: 'item-choice-actor' },
      },
      candidatePlacementIds: ['item-choice-actor'], selectedPlacementIds: ['item-choice-actor'],
      random: () => 0, time: 100,
    })
    expect(withoutAuthority.queries.abilities.has(ITEM_CHOICE_TARGET_ID, 'Stall')).toBe(false)
    const magicMap = {
      ...map,
      encounterState: {
        ...map.encounterState!,
        zones: [createEncounterGlobalFieldZone({
          kind: 'room', fieldId: 'magic', sideId: 'heroes',
          source: { kind: 'operation', operationId: 'operation.magic-ability', moveId: 'move.magic', placementId: 'item-choice-actor' },
          duration: { kind: 'rounds', boundary: 'end', remaining: 3 },
          replacementGroup: 'field.room.magic',
        })],
      },
    }
    expect(effectiveRuntimeAbilityIds({ map: magicMap, placement: pokemonPlacement, sheet: pokemon }))
      .not.toContain('Stall')
  })

  it('projects explicit Capability grants through effective Capability authority', () => {
    const map = createItemChoiceMap()
    const trainer = {
      ...createItemChoiceTrainerSheet(),
      equipmentState: activeEquipmentState({
        ownerKind: 'trainer', ownerSlug: 'item-choice-trainer', slotId: 'head',
        canonicalItemId: 'Dark Vision Goggles',
      }),
    }
    const placement = map.placements.find(entry => entry.id === 'item-choice-actor')!
    const effective = resolveEffectiveCapabilities({ map, placement, sheet: trainer })
    expect(effective.instances).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalId: 'Darkvision', effective: true }),
    ]))
  })
})
