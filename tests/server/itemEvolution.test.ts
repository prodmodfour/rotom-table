import { describe, expect, it } from 'vitest'
import { parseItemEvolutionState } from '#shared/itemAutomation/evolution'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'
import { pokemonAddedStatPointBudget } from '~/utils/sheets/pokemonDerived'
import { randomizePokemonAddedStats } from '~/utils/sheets/pokemonAddedStatRandomizer'
import {
  ITEM_EVOLUTION_CONFIRMATION_CHOICE_ID,
  ITEM_EVOLUTION_DESTINATION_CHOICE_ID,
  previewItemEvolution,
  reconcilePokemonItemEvolutionForSetupSave,
  resolveItemEvolution,
} from '../../server/domain/itemAutomation/evolution'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { activeEquipmentState } from '../fixtures/equipment'

const statKeys: readonly StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const definition = (canonicalId: string) => ITEM_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId)
const sourceInstanceId = 'item-instance:trainer:ash:pokemonItems:thunder-stone-row'

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'volt',
  nickname: 'Volt',
  species: 'Pikachu',
  level: 25,
  gender: 'Male',
  nature: 'Hardy',
  revision: 4,
  stats: Object.fromEntries(statKeys.map(key => [key, { added: key === 'spd' ? 35 : 0 }])),
  abilities: [{ name: 'Static' }, { name: 'Cute Charm' }],
  movelist: [{ name: 'Quick Attack' }, { name: 'Thunder Wave' }],
  appliedMoves: [],
  combat: { currentHp: 80 },
  ...overrides,
})

const choicesFor = (
  preview: ReturnType<typeof previewItemEvolution>,
  destinationLabel?: string,
): ReadonlyMap<string, readonly string[]> => {
  const destinations = preview.choices.find(choice => choice.choiceId === ITEM_EVOLUTION_DESTINATION_CHOICE_ID)!
  const destination = destinationLabel
    ? destinations.options.find(option => option.label === destinationLabel)!
    : destinations.options[0]!
  return new Map([
    [ITEM_EVOLUTION_DESTINATION_CHOICE_ID, [destination.optionId]],
    [ITEM_EVOLUTION_CONFIRMATION_CHOICE_ID, ['confirmed']],
  ])
}

const evolve = (sheet: CharacterSheet = pokemon()) => {
  const item = definition('Thunder Stone')
  const preview = previewItemEvolution({
    definition: item,
    sheetKind: 'pokemon',
    sheet,
    actorKind: 'trainer',
    sourceInstanceId,
  })
  const choices = choicesFor(preview)
  return resolveItemEvolution({
    definition: item,
    sheetKind: 'pokemon',
    sheet,
    actorKind: 'trainer',
    sourceInstanceId,
    selectedChoices: choices,
    operationId: 'evolution-operation-0001',
    appliedAt: 20_000,
  })
}

describe('authoritative Evolutionary Item mechanics', () => {
  it('registers exactly 24 items and all 62 reviewed transitions', () => {
    const definitions = ITEM_AUTOMATION_RUNTIME_REGISTRY.definitions.filter(value => (
      value.spec.effects.some(effect => effect.operation === 'evolve-pokemon')
    ))
    expect(definitions).toHaveLength(24)
    expect(definitions.every(value => value.spec.timing === 'standard')).toBe(true)
    expect(definitions.every(value => value.spec.consumption.phase === 'accepted-use'
      && value.spec.consumption.quantity === 1 && !value.spec.consumption.reusable)).toBe(true)
  })

  it('previews and atomically applies Pikachu to Raichu while retaining identity and exposing exact follow-up work', () => {
    const source = pokemon()
    const initial = previewItemEvolution({
      definition: definition('Thunder Stone'),
      sheetKind: 'pokemon',
      sheet: source,
      actorKind: 'trainer',
      sourceInstanceId,
    })
    expect(initial.selectionComplete).toBe(false)
    expect(initial.choices.map(choice => [choice.choiceId, choice.presentation])).toEqual([
      [ITEM_EVOLUTION_DESTINATION_CHOICE_ID, 'radio'],
      [ITEM_EVOLUTION_CONFIRMATION_CHOICE_ID, 'confirmation'],
    ])
    const selectedChoices = choicesFor(initial)
    const selected = previewItemEvolution({
      definition: definition('Thunder Stone'),
      sheetKind: 'pokemon',
      sheet: source,
      actorKind: 'trainer',
      sourceInstanceId,
      selectedChoices,
    })
    expect(selected.selectionComplete).toBe(true)
    expect(selected.previewFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Evolution', value: 'Pikachu → Raichu', tone: 'positive' }),
      expect.objectContaining({ label: 'Before', value: 'Electric · Base 4 / 6 / 4 / 5 / 5 / 9' }),
      expect.objectContaining({ label: 'After', value: 'Electric · Base 6 / 9 / 6 / 9 / 8 / 11' }),
      expect.objectContaining({ label: 'Abilities', value: 'Static → Static, Cute Charm → Motor Drive' }),
      expect.objectContaining({ label: 'Equipment', value: 'No equipped items to reconcile' }),
      expect.objectContaining({ label: 'Stat allocation', value: '35 Stat Points need allocation after evolution' }),
      expect.objectContaining({ label: 'Move decisions', value: 'No new Move decision' }),
    ]))

    const result = evolve(source)
    expect(result.sheet).toMatchObject({
      slug: 'volt', nickname: 'Volt', species: 'Raichu', level: 25,
      gender: 'Male', nature: source.nature, itemEvolutionLocked: true,
    })
    expect(result.sheet.movelist).toEqual(source.movelist)
    expect(result.sheet.abilities).toEqual([
      { name: 'Static', itemEvolutionLocked: true },
      { name: 'Motor Drive', itemEvolutionLocked: true },
    ])
    expect(statKeys.map(key => result.sheet.stats?.[key]?.added)).toEqual([0, 0, 0, 0, 0, 0])
    expect(result.sheet.itemEvolutionAttention).toMatchObject({
      fromSpecies: 'Pikachu', toSpecies: 'Raichu', canonicalItemName: 'Thunder Stone',
      statAllocation: { status: 'open', required: 35, allocated: 0 },
      moveOpportunities: [],
      abilityChanges: [{ from: 'Static', to: 'Static' }, { from: 'Cute Charm', to: 'Motor Drive' }],
    })
    expect(parseItemEvolutionState(result.sheet.serverPrivate?.itemEvolution).applications).toEqual([
      expect.objectContaining({
        sourceOperationId: 'evolution-operation-0001',
        sourceInstanceId,
        canonicalItemId: 'Thunder Stone',
        fromSpeciesId: 'Pikachu',
        toSpeciesId: 'Raichu',
        requiredStatPoints: 35,
        moveOpportunityIds: [],
      }),
    ])
    expect(result.payload).toMatchObject({
      action: 'evolve-pokemon', resultingSpecies: 'Raichu', requiredStatPoints: 35,
      moveOpportunityIds: [], appliedAt: 20_000,
    })
  })

  it('reconciles species-dependent equipment and exposes only safe follow-up labels', () => {
    const result = evolve(pokemon({
      equipmentState: activeEquipmentState({
        ownerKind: 'pokemon', ownerSlug: 'volt', slotId: 'held', canonicalItemId: 'Eviolite',
        configuration: {
          configurationId: 'equipment.eviolite.v1',
          values: { familyAnchorSpeciesId: 'Pichu', boostedStatIds: ['atk', 'spd'] },
        },
      }),
    }))
    expect(result.preview.previewFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Equipment', value: 'Eviolite will become inactive', tone: 'warning' }),
    ]))
    expect(result.sheet.equipmentState?.instances[0]?.activity).toMatchObject({
      status: 'inactive',
      reasons: [expect.objectContaining({ code: 'equipment.evolution-stage-incompatible' })],
    })
    expect(result.sheet.itemEvolutionAttention?.inactiveEquipmentItems).toEqual(['Eviolite'])
    expect(parseItemEvolutionState(result.sheet.serverPrivate?.itemEvolution).applications[0]?.inactiveEquipmentItemIds)
      .toEqual(['Eviolite'])
  })

  it('fails closed for missing confirmation, stale opaque destinations, level, gender, and incompatible species', () => {
    const item = definition('Thunder Stone')
    const source = pokemon()
    const preview = previewItemEvolution({
      definition: item, sheetKind: 'pokemon', sheet: source,
      actorKind: 'trainer', sourceInstanceId,
    })
    const destination = preview.choices[0]!.options[0]!.optionId
    expect(() => resolveItemEvolution({
      definition: item, sheetKind: 'pokemon', sheet: source,
      actorKind: 'trainer', sourceInstanceId,
      selectedChoices: new Map([[ITEM_EVOLUTION_DESTINATION_CHOICE_ID, [destination]]]),
      operationId: 'evolution-operation-0002', appliedAt: 20_001,
    })).toThrow('choices are incomplete')
    expect(() => resolveItemEvolution({
      definition: item, sheetKind: 'pokemon', sheet: { ...source, revision: 5 },
      actorKind: 'trainer', sourceInstanceId,
      selectedChoices: choicesFor(preview),
      operationId: 'evolution-operation-0003', appliedAt: 20_002,
    })).toThrow('selected evolution destination is stale')
    expect(() => previewItemEvolution({
      definition: definition('Fire Stone'), sheetKind: 'pokemon',
      sheet: pokemon({ species: 'Vulpix', level: 19 }), actorKind: 'trainer', sourceInstanceId,
    })).toThrow('requires Level 20')
    expect(() => previewItemEvolution({
      definition: definition('Dawn Stone'), sheetKind: 'pokemon',
      sheet: pokemon({ species: 'Kirlia', level: 30, gender: 'Female' }), actorKind: 'trainer', sourceInstanceId,
    })).toThrow('requires a Male')
    expect(() => previewItemEvolution({
      definition: item, sheetKind: 'pokemon', sheet: pokemon({ species: 'Diglett' }),
      actorKind: 'trainer', sourceInstanceId,
    })).toThrow('no reviewed evolution')
  })

  it('projects the exact bounded branch choices for Clamperl', () => {
    const preview = previewItemEvolution({
      definition: definition('Deepseascale/Deepseatooth'),
      sheetKind: 'pokemon',
      sheet: pokemon({ species: 'Clamperl', level: 30 }),
      actorKind: 'trainer',
      sourceInstanceId,
    })
    expect(preview.choices[0]!.options.map(option => option.label)).toEqual([
      'Evolve to Huntail', 'Evolve to Gorebyss',
    ])
    expect(new Set(preview.choices[0]!.options.map(option => option.optionId)).size).toBe(2)
  })

  it('keeps partial restat work visible, certifies an exact legal allocation, and prevents locked-state tampering', () => {
    const accepted = evolve().sheet
    const partial = structuredClone(accepted)
    partial.stats!.hp!.added = 1
    const partialSaved = reconcilePokemonItemEvolutionForSetupSave({
      current: accepted, candidate: partial, resolvedAt: 21_000,
    })
    expect(partialSaved.itemEvolutionAttention?.statAllocation).toEqual({ status: 'open', required: 35, allocated: 0 })

    const completed = structuredClone(partialSaved)
    randomizePokemonAddedStats(completed, { random: () => 0.5 })
    expect(statKeys.reduce((total, key) => total + (completed.stats?.[key]?.added ?? 0), 0))
      .toBe(pokemonAddedStatPointBudget(completed))
    const resolved = reconcilePokemonItemEvolutionForSetupSave({
      current: partialSaved, candidate: completed, resolvedAt: 22_000,
    })
    expect(resolved.itemEvolutionAttention?.statAllocation).toEqual({ status: 'resolved', required: 35, allocated: 35 })
    expect(parseItemEvolutionState(resolved.serverPrivate?.itemEvolution).statResolutions).toEqual([
      expect.objectContaining({ sourceOperationId: 'evolution-operation-0001', allocatedStatPoints: 35, resolvedAt: 22_000 }),
    ])

    expect(() => reconcilePokemonItemEvolutionForSetupSave({
      current: accepted, candidate: { ...accepted, species: 'Pikachu' }, resolvedAt: 23_000,
    })).toThrow('item-controlled species')
    const abilityTamper = structuredClone(accepted)
    abilityTamper.abilities![0]!.name = 'Lightning Rod'
    expect(() => reconcilePokemonItemEvolutionForSetupSave({
      current: accepted, candidate: abilityTamper, resolvedAt: 23_000,
    })).toThrow('Item-controlled Ability rows')
    const overBudget = structuredClone(accepted)
    overBudget.stats!.hp!.added = 36
    expect(() => reconcilePokemonItemEvolutionForSetupSave({
      current: accepted, candidate: overBudget, resolvedAt: 23_000,
    })).toThrow('exceeds the exact 35-point budget')
  })
})
