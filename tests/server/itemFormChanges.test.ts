import { describe, expect, it } from 'vitest'
import { createFiniteAuthoritativeMoveRandomStream } from '../../server/domain/moveAutomation/random'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import {
  activeReviewedItemFormChange,
  applyItemFormChangeCandidate,
  itemFormChangeAbilityOptionId,
  resolveItemFormChangeCandidate,
} from '../../server/domain/itemAutomation/formChanges'
import { planSceneLifecycle } from '../../server/domain/moveAutomation/planSceneLifecycle'
import { projectCapabilityAutomationMapForPlayer } from '../../server/domain/capabilityAutomation/clientStateProjection'
import { createEncounterGlobalFieldZone } from '../../server/domain/moveAutomation/fieldLifecycle'
import {
  resolveAuthoritativeMoveItemResources,
  reviewedMoveItemResourceRequirementsFor,
} from '../../server/domain/moveAutomation/itemResources'
import { planMoveItemMutations } from '../../server/domain/moveAutomation/planItemMutations'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  FORM_CHANGE_POKEMON_PLACEMENT_ID,
  FORM_CHANGE_POKEMON_SLUG,
  FORM_CHANGE_SCENE_STARTED_AT,
  FORM_CHANGE_TRAINER_PLACEMENT_ID,
  createFormChangeMap,
  createFormChangePokemon,
  createFormChangeProfile,
  createFormChangeTrainer,
} from '../fixtures/itemFormChanges'

const directory = (pokemon: CharacterSheet, trainer: TrainerSheet) => ({
  pokemon: new Map([[pokemon.slug, pokemon]]),
  trainer: new Map([[trainer.slug, trainer]]),
})

const pokemonTurnMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => createFormChangeMap({
  initiative: { activeId: FORM_CHANGE_POKEMON_PLACEMENT_ID, round: 2 },
  ...overrides,
})

const resolve = (input: {
  map?: TabletopMap
  pokemon?: CharacterSheet
  trainer?: TrainerSheet
  actorPlacementId?: string
  abilityOptionId?: string | null
} = {}) => {
  const map = input.map ?? createFormChangeMap()
  const pokemon = input.pokemon ?? createFormChangePokemon()
  const trainer = input.trainer ?? createFormChangeTrainer()
  return resolveItemFormChangeCandidate({
    map,
    actorPlacementId: input.actorPlacementId ?? FORM_CHANGE_TRAINER_PLACEMENT_ID,
    targetPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
    sheets: directory(pokemon, trainer),
    ...(input.abilityOptionId === undefined ? {} : { abilityOptionId: input.abilityOptionId }),
  })
}

const moveContext = (
  map: TabletopMap,
  pokemon: CharacterSheet,
  trainer: TrainerSheet,
  additionalPokemon: readonly CharacterSheet[] = [],
) => (
  buildAuthoritativeMoveRulesContext({
    map,
    pokemonSheets: new Map([pokemon, ...additionalPokemon].map(sheet => [sheet.slug, sheet])),
    trainerSheets: new Map([[trainer.slug, trainer]]),
    intent: {
      schemaVersion: 1,
      placementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
      moveName: 'Ember',
      selection: { kind: 'single-target', targetPlacementId: FORM_CHANGE_TRAINER_PLACEMENT_ID },
    },
    candidatePlacementIds: [FORM_CHANGE_TRAINER_PLACEMENT_ID],
    selectedPlacementIds: [FORM_CHANGE_TRAINER_PLACEMENT_ID],
    random: createFiniteAuthoritativeMoveRandomStream([]),
    time: 5_200,
  })
)

describe('P8-056 authoritative item-driven form changes', () => {
  it('resolves only the exact active Ring and configured Stone and projects a bounded accepted preview', () => {
    const map = createFormChangeMap()
    const pokemon = createFormChangePokemon('mega-charizard-x')
    const trainer = createFormChangeTrainer()
    const candidate = resolve({ map, pokemon, trainer })
    expect(candidate).toMatchObject({
      form: {
        formId: 'mega-charizard-x', displayName: 'Mega Charizard X',
        types: ['Fire', 'Dragon'], abilityId: 'Tough Claws',
        statDeltas: { atk: 5, def: 3, satk: 2, sdef: 0, spd: 0 },
      },
      selectedAbilityId: 'Tough Claws',
    })
    expect(candidate.ringSource.grant).toMatchObject({ actionId: 'equipment.mega-ring.evolve', executionStatus: 'native' })
    expect(candidate.stoneSource?.grant).toMatchObject({ actionId: 'equipment.mega-stone.evolve', executionStatus: 'native' })

    const projection = buildEncounterPresentationProjection({
      role: 'player', playerProfile: createFormChangeProfile(), map, mapRevision: 7,
      pokemonSheets: [pokemon], trainerSheets: [trainer], generatedAt: 5_200,
    })
    const offer = projection.offers.find(row => row.intent.actionId === 'item.form-change.mega-evolve')
    expect(offer).toMatchObject({
      actor: { participantId: FORM_CHANGE_TRAINER_PLACEMENT_ID },
      availability: { status: 'available' },
      timing: { kind: 'swift', label: 'Swift Action' },
      costs: [{ kind: 'swift-action', resourceId: 'swift', amount: 1 }],
      presentation: { label: 'Mega Evolve' },
      formChangePreview: {
        fromFormLabel: 'Charizard', toFormLabel: 'Mega Charizard X',
        fromTypes: ['Fire', 'Flying'], toTypes: ['Fire', 'Dragon'],
        abilityLabel: 'Tough Claws', durationLabel: 'Scene',
        reversalLabel: 'Reverts automatically when the Scene ends.',
        acceptanceBoundaryLabel: 'No change until accepted.',
      },
    })
    expect(JSON.stringify(projection)).not.toContain(candidate.ringSource.instanceId)
    expect(JSON.stringify(projection)).not.toContain(candidate.stoneSource!.instanceId)
    expect(JSON.stringify(projection)).not.toContain(candidate.form.recordSha256)

    const pokemonOnlyProjection = buildEncounterPresentationProjection({
      role: 'player',
      playerProfile: {
        schemaVersion: 1, id: 'profile_pokemon_without_ring_owner', displayName: 'Pokémon only',
        linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: pokemon.slug }],
      },
      map: pokemonTurnMap(), mapRevision: 7,
      pokemonSheets: [pokemon], trainerSheets: [trainer], generatedAt: 5_200,
    })
    expect(pokemonOnlyProjection.offers.some(row => row.intent.actionId === 'item.form-change.mega-evolve'))
      .toBe(false)
  })

  it('applies immutable Scene state while retaining sheet identity and overlays Stats, Types, form, and Ability', () => {
    const map = pokemonTurnMap()
    const pokemon = createFormChangePokemon()
    const trainer = createFormChangeTrainer()
    const before = moveContext(map, pokemon, trainer)
    const candidate = resolve({ map, pokemon, trainer, actorPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID })
    const changed = applyItemFormChangeCandidate({ map, candidate, operationId: 'operation-mega-charizard', acceptedAt: 5_200 })
    const active = activeReviewedItemFormChange({
      map: changed, placementId: FORM_CHANGE_POKEMON_PLACEMENT_ID, pokemonSheet: pokemon,
    })
    expect(active).toMatchObject({
      entry: {
        pokemonSheetSlug: FORM_CHANGE_POKEMON_SLUG,
        trainerSheetSlug: trainer.slug,
        formId: 'mega-charizard-x',
        duration: { kind: 'scene', sceneStartedAt: FORM_CHANGE_SCENE_STARTED_AT },
        sourceKind: 'mega-ring-and-stone',
        sourceOperationId: 'operation-mega-charizard',
      },
      form: { displayName: 'Mega Charizard X' },
    })
    expect(changed.encounterState?.itemFormChanges?.entries).toHaveLength(1)
    expect(pokemon.species).toBe('Charizard')
    expect(pokemon.combat?.currentHp).toBe(72)

    const after = moveContext(changed, pokemon, trainer)
    expect(after.actor.token.atk - before.actor.token.atk).toBe(5)
    expect(after.actor.token.def - before.actor.token.def).toBe(3)
    expect(after.actor.token.satk - before.actor.token.satk).toBe(2)
    expect(after.actor.token.sdef - before.actor.token.sdef).toBe(0)
    expect(after.actor.token.spd - before.actor.token.spd).toBe(0)
    expect(after.actor.token.defenderTypes).toEqual(['Fire', 'Dragon'])
    expect(after.queries.creatureRules.resolve(FORM_CHANGE_POKEMON_PLACEMENT_ID)?.formId).toBe('mega-charizard-x')
    expect(after.queries.creatureRules.resolve(FORM_CHANGE_POKEMON_PLACEMENT_ID)?.typeIds).toEqual(['fire', 'dragon'])
    expect(after.queries.abilities.has(FORM_CHANGE_POKEMON_PLACEMENT_ID, 'Tough Claws')).toBe(true)
  })

  it('rejects suppressed sources before acceptance but preserves the accepted Scene form through Magic Room and Fainting', () => {
    const pokemon = createFormChangePokemon()
    const trainer = createFormChangeTrainer()
    const base = pokemonTurnMap()
    const magicRoom = createEncounterGlobalFieldZone({
      kind: 'room', fieldId: 'magic', sideId: 'heroes',
      source: {
        kind: 'operation', operationId: 'operation-magic-room',
        moveId: 'move-magic-room', placementId: FORM_CHANGE_TRAINER_PLACEMENT_ID,
      },
      duration: { kind: 'rounds', boundary: 'end', remaining: 3 },
      replacementGroup: 'field.room.magic',
    })
    const suppressedBefore = {
      ...base,
      encounterState: { ...base.encounterState!, zones: [magicRoom] },
    }
    expect(() => resolve({
      map: suppressedBefore, pokemon, trainer,
      actorPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
    })).toThrow(/Mega Ring|not active/i)

    const candidate = resolve({
      map: base, pokemon, trainer, actorPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
    })
    const accepted = applyItemFormChangeCandidate({
      map: base, candidate, operationId: 'operation-mega-before-magic-room', acceptedAt: 5_200,
    })
    const suppressedAfter = {
      ...accepted,
      encounterState: { ...accepted.encounterState!, zones: [magicRoom] },
    }
    expect(activeReviewedItemFormChange({
      map: suppressedAfter, placementId: FORM_CHANGE_POKEMON_PLACEMENT_ID, pokemonSheet: pokemon,
    })?.form.formId).toBe('mega-charizard-x')
    expect(moveContext(suppressedAfter, pokemon, trainer).queries.abilities
      .has(FORM_CHANGE_POKEMON_PLACEMENT_ID, 'Tough Claws')).toBe(true)

    const fainted = { ...pokemon, combat: { ...pokemon.combat, currentHp: 0 } }
    const faintedContext = moveContext(suppressedAfter, fainted, trainer)
    expect(faintedContext.queries.creatureRules.resolve(FORM_CHANGE_POKEMON_PLACEMENT_ID)?.formId)
      .toBe('mega-charizard-x')
    expect(faintedContext.queries.abilities.has(FORM_CHANGE_POKEMON_PLACEMENT_ID, 'Tough Claws')).toBe(false)

    const gasProvider = createFormChangePokemon('mega-charizard-x', {
      slug: 'neutralizing-gas-provider', nickname: 'Gas Provider', species: 'Koffing',
      abilities: [{ name: 'Neutralizing Gas' }], equipmentState: undefined,
    })
    const gasMap: TabletopMap = {
      ...accepted,
      placements: [...accepted.placements, {
        id: 'neutralizing-gas-token', sheetKind: 'pokemon', sheetSlug: gasProvider.slug,
        position: { x: 4, y: 0, z: 2 }, sideId: 'foes', initiative: 10,
      }],
    }
    const gasContext = moveContext(gasMap, pokemon, trainer, [gasProvider])
    expect(gasContext.queries.creatureRules.resolve(FORM_CHANGE_POKEMON_PLACEMENT_ID)?.formId)
      .toBe('mega-charizard-x')
    // Neutralizing Gas in this ruleset suppresses reviewed Defensive abilities,
    // not unrelated offensive statics such as Tough Claws.
    expect(gasContext.queries.abilities.has(FORM_CHANGE_POKEMON_PLACEMENT_ID, 'Tough Claws')).toBe(true)

    const venusaur = createFormChangePokemon('mega-venusaur', {
      species: 'Venusaur', types: ['Grass', 'Poison'], abilities: [{ name: 'Overgrow' }],
      equipmentState: createFormChangePokemon('mega-venusaur', { species: 'Venusaur' }).equipmentState,
    })
    const venusaurBase = pokemonTurnMap()
    const venusaurCandidate = resolve({
      map: venusaurBase, pokemon: venusaur, trainer,
      actorPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
    })
    const venusaurAccepted = applyItemFormChangeCandidate({
      map: venusaurBase, candidate: venusaurCandidate,
      operationId: 'operation-mega-venusaur-gas', acceptedAt: 5_200,
    })
    const venusaurGasMap: TabletopMap = {
      ...venusaurAccepted,
      placements: [...venusaurAccepted.placements, {
        id: 'neutralizing-gas-token', sheetKind: 'pokemon', sheetSlug: gasProvider.slug,
        position: { x: 4, y: 0, z: 2 }, sideId: 'foes', initiative: 10,
      }],
    }
    const venusaurGasContext = moveContext(venusaurGasMap, venusaur, trainer, [gasProvider])
    expect(venusaurGasContext.queries.creatureRules.resolve(FORM_CHANGE_POKEMON_PLACEMENT_ID)?.formId)
      .toBe('mega-venusaur')
    expect(venusaurGasContext.queries.abilities.has(FORM_CHANGE_POKEMON_PLACEMENT_ID, 'Thick Fat')).toBe(false)
  })

  it('requires one opaque distinct natural Ability choice when the reviewed Mega Ability is already effective', () => {
    const pokemon = createFormChangePokemon('mega-charizard-x', {
      abilities: [{ name: 'Blaze' }, { name: 'Tough Claws' }],
    })
    const preview = resolve({ pokemon })
    expect(preview.selectedAbilityId).toBeNull()
    expect(preview.abilityOptions.map(row => row.abilityId)).toEqual([
      'Intimidate', 'Solar Power', 'Prime Fury', 'White Flame',
    ])
    expect(preview.abilityOptions.every(row => row.optionId.startsWith('mega-ability:v1:'))).toBe(true)
    expect(() => resolve({ pokemon, abilityOptionId: 'Blaze' })).toThrow(/stale or unavailable/i)
    const chosen = preview.abilityOptions.find(row => row.abilityId === 'Intimidate')!
    expect(chosen.optionId).toBe(itemFormChangeAbilityOptionId({
      mapSlug: 'mega-evolution-arena', sceneStartedAt: FORM_CHANGE_SCENE_STARTED_AT,
      actorPlacementId: FORM_CHANGE_TRAINER_PLACEMENT_ID,
      targetPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
      formRecordSha256: preview.form.recordSha256,
      abilityId: 'Intimidate',
    }))
    expect(resolve({ pokemon, abilityOptionId: chosen.optionId }).selectedAbilityId).toBe('Intimidate')
  })

  it('keeps X/Y form choice bound to Stone configuration and fails closed for source, turn, ownership, use, or provenance drift', () => {
    expect(resolve({ pokemon: createFormChangePokemon('mega-charizard-y') }).form.formId).toBe('mega-charizard-y')
    expect(() => resolve({ pokemon: createFormChangePokemon('mega-mewtwo-y') })).toThrow(/configured for this Pokémon/i)
    expect(() => resolve({ map: createFormChangeMap({ initiative: { activeId: FORM_CHANGE_POKEMON_PLACEMENT_ID } }) }))
      .toThrow(/acting Trainer or Pokémon’s turn/i)
    expect(() => resolve({ trainer: createFormChangeTrainer({ currentTeam: [] }) })).toThrow(/owning Trainer/i)
    expect(() => resolve({ trainer: createFormChangeTrainer({ equipmentState: undefined }) })).toThrow(/Mega Ring/i)
    expect(() => resolve({ pokemon: createFormChangePokemon('mega-charizard-x', { equipmentState: undefined }) }))
      .toThrow(/Mega Stone/i)

    const map = createFormChangeMap()
    const pokemon = createFormChangePokemon()
    const trainer = createFormChangeTrainer()
    const candidate = resolve({ map, pokemon, trainer })
    const knockOffRequirements = reviewedMoveItemResourceRequirementsFor('Knock Off')
    const beforeKnockOff = resolveAuthoritativeMoveItemResources({
      map, actorPlacementId: FORM_CHANGE_TRAINER_PLACEMENT_ID,
      selectedTargetPlacementIds: [FORM_CHANGE_POKEMON_PLACEMENT_ID],
      pokemonSheets: new Map([[pokemon.slug, pokemon]]),
      trainerSheets: new Map([[trainer.slug, trainer]]), groupInventories: new Map(),
      requirements: knockOffRequirements,
    })
    expect(beforeKnockOff.candidates.map(row => row.reference.canonicalItemId)).toEqual(['mega-stone'])
    const used = applyItemFormChangeCandidate({ map, candidate, operationId: 'operation-use-spent', acceptedAt: 5_200 })
    expect(() => resolve({ map: used, pokemon, trainer })).toThrow(/already Mega Evolved|already supports/i)
    const afterKnockOff = resolveAuthoritativeMoveItemResources({
      map: used, actorPlacementId: FORM_CHANGE_TRAINER_PLACEMENT_ID,
      selectedTargetPlacementIds: [FORM_CHANGE_POKEMON_PLACEMENT_ID],
      pokemonSheets: new Map([[pokemon.slug, pokemon]]),
      trainerSheets: new Map([[trainer.slug, trainer]]), groupInventories: new Map(),
      requirements: knockOffRequirements,
    })
    expect(afterKnockOff.candidates).toEqual([])
    expect(afterKnockOff.sheetReads).toEqual([
      { kind: 'pokemon', slug: pokemon.slug, revision: pokemon.revision },
    ])
    expect(() => planMoveItemMutations({
      map: used,
      pokemonSheets: new Map([[pokemon.slug, pokemon]]),
      trainerSheets: new Map([[trainer.slug, trainer]]),
      groupInventories: new Map(),
      operations: [{
        id: 'item.knock-active-mega-stone',
        kind: 'ground-item-add',
        reasonCode: 'move.knock-off.active-mega-stone',
        source: beforeKnockOff.candidates[0]!.reference,
        destination: {
          kind: 'map-ground-item',
          owner: { kind: 'map', slug: used.slug, revision: used.revision },
          itemId: 'ground-active-mega-stone',
          position: { x: 2, y: 0, z: 2 },
          sideId: null,
          ownerPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
        },
        quantity: 1,
      }],
      originOperationId: 'op_active_megastone_knockoff',
      plannedAt: 5_250,
    })).toThrow('cannot remove equipment backing an active Mega Evolution')
    const ringKnockOff = resolveAuthoritativeMoveItemResources({
      map: used, actorPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
      selectedTargetPlacementIds: [FORM_CHANGE_TRAINER_PLACEMENT_ID],
      pokemonSheets: new Map([[pokemon.slug, pokemon]]),
      trainerSheets: new Map([[trainer.slug, trainer]]), groupInventories: new Map(),
      requirements: knockOffRequirements,
    })
    expect(ringKnockOff.candidates).toEqual([])
    const tampered = {
      ...used,
      encounterState: {
        ...used.encounterState!,
        itemFormChanges: {
          ...used.encounterState!.itemFormChanges!,
          entries: used.encounterState!.itemFormChanges!.entries.map(entry => ({
            ...entry, formRecordSha256: '0'.repeat(64),
          })),
        },
      },
    }
    expect(() => activeReviewedItemFormChange({
      map: tampered, placementId: FORM_CHANGE_POKEMON_PLACEMENT_ID, pokemonSheet: pokemon,
    })).toThrow(/stale against current canonical authority/i)
  })

  it('supports reviewed Delta Evolution without a Stone and shares the one-Trainer Scene limit', () => {
    const rayquaza = createFormChangePokemon('mega-charizard-x', {
      species: 'Rayquaza', types: ['Dragon', 'Flying'],
      abilities: [{ name: 'Air Lock' }], movelist: [{ name: 'Dragon Ascent' }],
      equipmentState: undefined,
    })
    const map = pokemonTurnMap()
    const candidate = resolve({
      map, pokemon: rayquaza, actorPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
    })
    expect(candidate).toMatchObject({
      form: { formId: 'mega-rayquaza', abilityId: 'Run Away' },
      stoneSource: null,
      selectedAbilityId: 'Run Away',
    })
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 7,
      pokemonSheets: [rayquaza], trainerSheets: [createFormChangeTrainer()], generatedAt: 5_200,
    })
    expect(projection.offers.filter(offer => offer.intent.actionId === 'item.form-change.mega-evolve'))
      .toEqual([expect.objectContaining({
        actor: expect.objectContaining({ participantId: FORM_CHANGE_POKEMON_PLACEMENT_ID }),
        source: expect.objectContaining({ canonicalId: 'Mega Ring' }),
      })])
    expect(projection.offers.some(offer => offer.intent.actionId === 'mega-evolve'
      && offer.source.sourceKind === 'capability')).toBe(false)
    const changed = applyItemFormChangeCandidate({ map, candidate, operationId: 'operation-delta-item', acceptedAt: 5_200 })
    expect(changed.encounterState?.itemFormChanges?.entries[0]).toMatchObject({
      sourceKind: 'mega-ring-delta-evolution', stoneInstanceId: null,
    })
    expect(() => resolve({
      map: changed,
      pokemon: rayquaza,
      actorPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
    })).toThrow(/already supports|already Mega Evolved/i)
  })

  it('reverses initiative and Scene form state exactly once at the Scene boundary and redacts private provenance', () => {
    const pokemon = createFormChangePokemon('mega-mewtwo-y', {
      species: 'Mewtwo', types: ['Psychic'], abilities: [{ name: 'Pressure' }],
      equipmentState: createFormChangePokemon('mega-mewtwo-y', { species: 'Mewtwo' }).equipmentState,
    })
    const trainer = createFormChangeTrainer()
    const map = pokemonTurnMap()
    const candidate = resolve({ map, pokemon, trainer, actorPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID })
    const changed = applyItemFormChangeCandidate({ map, candidate, operationId: 'operation-mega-mewtwo', acceptedAt: 5_200 })
    expect(changed.placements.find(row => row.id === FORM_CHANGE_POKEMON_PLACEMENT_ID)?.initiative).toBe(14)

    const publicMap = projectCapabilityAutomationMapForPlayer(changed)
    expect(publicMap.encounterState?.itemFormChanges).toBeUndefined()
    expect(JSON.stringify(publicMap)).not.toContain(candidate.ringSource.instanceId)
    expect(JSON.stringify(publicMap)).not.toContain(candidate.stoneSource!.instanceId)
    expect(JSON.stringify(publicMap)).not.toContain('operation-mega-mewtwo')

    const plan = planSceneLifecycle({
      map: changed,
      previous: changed.activeScene!,
      current: null,
      operationId: 'operation-end-scene',
      time: 6_000,
      loadSheets: () => ({
        pokemonSheets: new Map([[pokemon.slug, pokemon]]),
        trainerSheets: new Map([[trainer.slug, trainer]]),
      }),
      handlers: [],
    })
    expect(plan.nextMap.encounterState?.itemFormChanges?.entries).toEqual([])
    expect(plan.nextMap.placements.find(row => row.id === FORM_CHANGE_POKEMON_PLACEMENT_ID)?.initiative).toBe(13)
    expect(plan.nextMap.activeScene).toBeUndefined()
  })
})
