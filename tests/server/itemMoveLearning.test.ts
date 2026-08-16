import { describe, expect, it } from 'vitest'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import {
  applyItemMachineDailyUsage,
  previewMachineMoveLearning,
  resolveMachineMoveLearning,
} from '../../server/domain/itemAutomation/moveLearning'
import type { CharacterSheet, CharacterSheetMove } from '../../src/types/characterSheet'
import type { TrainerSheet } from '../../src/types/trainerSheet'

const sourceInstanceId = 'item-instance:trainer:ash:pokemonItems:tm-row'

const move = (name: string): CharacterSheetMove => ({ name })

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'spark',
  species: 'Pikachu',
  nickname: 'Spark',
  level: 10,
  revision: 4,
  movelist: [move('Quick Attack'), move('Tail Whip')],
  appliedMoves: [],
  tutorPoints: { spent: 0 },
  ...overrides,
})

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 10,
  revision: 7,
  currentTeam: ['spark'],
  ...overrides,
})

const definition = (canonicalId = 'TM 24 - Thunderbolt') => ITEM_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId)

const selectionsFor = (preview: ReturnType<typeof previewMachineMoveLearning>, optionId?: string) => {
  const replacement = preview.choices.find(choice => choice.choiceId === 'machine-replacement')!
  return new Map<string, readonly string[]>([
    ['machine-replacement', [optionId ?? replacement.options[0]!.optionId]],
    ['machine-confirmation', ['confirmed']],
  ])
}

describe('authoritative machine Move learning', () => {
  it('registers the exact 100 TM and six HM canonical rows', () => {
    const machines = ITEM_AUTOMATION_RUNTIME_REGISTRY.definitions.filter(value => (
      value.spec.effects.some(effect => effect.operation === 'learn-machine-move')
    ))
    expect(machines).toHaveLength(106)
    expect(machines.filter(value => value.spec.effects.some(effect => (
      effect.operation === 'learn-machine-move' && effect.machineKind === 'TM'
    )))).toHaveLength(100)
    expect(machines.filter(value => value.spec.effects.some(effect => (
      effect.operation === 'learn-machine-move' && effect.machineKind === 'HM'
    )))).toHaveLength(6)
    expect(definition('TM 42 - Facade').spec.effects[0]).toMatchObject({ moveId: 'Facade' })
    expect(definition('TM 22 - Solarbeam').spec.effects[0]).toMatchObject({ moveId: 'Solar Beam' })
  })

  it('projects a compatible open slot and commits Move, Tutor Point, and immutable provenance together', () => {
    const target = pokemon()
    const actor = trainer()
    const preview = previewMachineMoveLearning({
      definition: definition(),
      sheetKind: 'pokemon',
      sheet: target,
      actorKind: 'trainer',
      actorSheet: actor,
      sourceInstanceId,
      campaignMinute: 1_500,
    })
    const add = preview.choices[0]!.options.find(option => option.label === 'Keep current Moves')!
    expect(add.description).toContain('spend 1 Tutor Point')

    const resolved = resolveMachineMoveLearning({
      definition: definition(),
      sheetKind: 'pokemon',
      sheet: target,
      actorKind: 'trainer',
      actorSheet: actor,
      sourceInstanceId,
      campaignMinute: 1_500,
      selectedChoices: selectionsFor(preview, add.optionId),
      operationId: 'machine-learning-operation-0001',
      appliedAt: 20_000,
    })

    expect(resolved.sheet.movelist?.map(row => row.name)).toEqual(['Quick Attack', 'Tail Whip', 'Thunderbolt'])
    expect(resolved.sheet.movelist?.[2]?.itemMoveLearningLocked).toBe(true)
    expect(resolved.sheet.appliedMoves).toEqual([expect.objectContaining({
      name: 'Thunderbolt', source: 'tm', itemMoveLearningLocked: true,
    })])
    expect(resolved.sheet.tutorPoints).toMatchObject({ earned: 3, spent: 1 })
    expect(resolved.sheet.serverPrivate?.itemMoveLearning?.applications).toEqual([
      expect.objectContaining({
        sourceOperationId: 'machine-learning-operation-0001',
        machineKind: 'TM',
        moveId: 'Thunderbolt',
        tutorPointCost: 1,
        replacementKind: 'add',
      }),
    ])
    expect(resolved.dailyUse).toBeNull()
    expect(resolved.targetPayload).toMatchObject({ action: 'learn-machine-move', dailyUse: null })

    const tampered = structuredClone(resolved.sheet)
    tampered.movelist![2]!.effect = 'client-authored drift'
    expect(() => previewMachineMoveLearning({
      definition: definition('TM 25 - Thunder'), sheetKind: 'pokemon', sheet: tampered,
      actorKind: 'trainer', actorSheet: actor, sourceInstanceId, campaignMinute: 1_500,
    })).toThrow('Item-controlled Move rows no longer match immutable accepted Move-learning provenance.')
  })

  it('replaces an already counted TM slot for no additional Tutor Point', () => {
    const target = pokemon({
      movelist: [move('Quick Attack'), move('Toxic')],
      appliedMoves: [{ name: 'Toxic', source: 'tm' }],
      tutorPoints: { spent: 1 },
    })
    const preview = previewMachineMoveLearning({
      definition: definition(), sheetKind: 'pokemon', sheet: target,
      actorKind: 'trainer', actorSheet: trainer(), sourceInstanceId, campaignMinute: 0,
    })
    const toxic = preview.choices[0]!.options.find(option => option.label === 'Toxic')!
    expect(toxic.description).toContain('0 additional Tutor Points')
    const resolved = resolveMachineMoveLearning({
      definition: definition(), sheetKind: 'pokemon', sheet: target,
      actorKind: 'trainer', actorSheet: trainer(), sourceInstanceId, campaignMinute: 0,
      selectedChoices: selectionsFor(preview, toxic.optionId),
      operationId: 'machine-learning-operation-0002', appliedAt: 20_001,
    })
    expect(resolved.sheet.movelist?.map(row => row.name)).toEqual(['Quick Attack', 'Thunderbolt'])
    expect(resolved.sheet.appliedMoves?.map(row => row.name)).toEqual(['Thunderbolt'])
    expect(resolved.sheet.tutorPoints?.spent).toBe(1)
    expect(resolved.sheet.serverPrivate?.itemMoveLearning?.applications[0]).toMatchObject({
      replacedMoveId: 'Toxic', tutorPointCost: 0,
      previousMachineTutorCount: 1, resultingMachineTutorCount: 1,
    })
  })

  it('counts applied and active Moves for duplicates and rejects incompatible species', () => {
    expect(() => previewMachineMoveLearning({
      definition: definition(), sheetKind: 'pokemon',
      sheet: pokemon({ appliedMoves: [{ name: 'Thunderbolt', source: 'tm' }] }),
      actorKind: 'trainer', actorSheet: trainer(), sourceInstanceId, campaignMinute: 0,
    })).toThrow('already knows')

    expect(() => previewMachineMoveLearning({
      definition: definition(), sheetKind: 'pokemon',
      sheet: pokemon({ species: 'Diglett' }),
      actorKind: 'trainer', actorSheet: trainer(), sourceInstanceId, campaignMinute: 0,
    })).toThrow('not canonically compatible')
  })

  it('counts the movelist/appliedMoves union conservatively, including applied-only and unproven active rows', () => {
    expect(() => previewMachineMoveLearning({
      definition: definition(), sheetKind: 'pokemon',
      sheet: pokemon({
        movelist: [move('Quick Attack')],
        appliedMoves: [
          { name: 'Toxic', source: 'tm' },
          { name: 'Protect', source: 'tm' },
          { name: 'Dig', source: 'tutor' },
        ],
        tutorPoints: { spent: 3 },
      }),
      actorKind: 'trainer', actorSheet: trainer(), sourceInstanceId, campaignMinute: 0,
    })).toThrow('No legal Move change')

    const activeWithoutSource = previewMachineMoveLearning({
      definition: definition(), sheetKind: 'pokemon',
      sheet: pokemon({ movelist: [move('Quick Attack'), move('Thunder')], tutorPoints: { spent: 1 } }),
      actorKind: 'trainer', actorSheet: trainer(), sourceInstanceId, campaignMinute: 0,
    })
    expect(activeWithoutSource.choices[0]!.options.find(option => option.label === 'Thunder')?.description)
      .toContain('0 additional Tutor Points')
  })

  it('enforces three counted TM/Tutor Moves while allowing a zero-cost counted-slot replacement', () => {
    const target = pokemon({
      movelist: [move('Quick Attack'), move('Toxic'), move('Protect'), move('Dig')],
      appliedMoves: [
        { name: 'Toxic', source: 'tm' },
        { name: 'Protect', source: 'tm' },
        { name: 'Dig', source: 'tutor' },
      ],
      tutorPoints: { spent: 3 },
    })
    const preview = previewMachineMoveLearning({
      definition: definition(), sheetKind: 'pokemon', sheet: target,
      actorKind: 'trainer', actorSheet: trainer(), sourceInstanceId, campaignMinute: 0,
    })
    const replacements = preview.choices[0]!.options
    expect(replacements.map(option => option.label)).toEqual(['Toxic', 'Protect', 'Dig'])
    expect(replacements.every(option => option.description?.includes('0 additional'))).toBe(true)
  })

  it('honors Cluster Mind active slots and invalidates target-revision-bound choices', () => {
    const target = pokemon({
      level: 41,
      movelist: ['Quick Attack', 'Tail Whip', 'Play Nice', 'Electro Ball', 'Feint', 'Slam'].map(move),
      abilities: [{ name: 'Cluster Mind' }],
    })
    const preview = previewMachineMoveLearning({
      definition: definition(), sheetKind: 'pokemon', sheet: target,
      actorKind: 'trainer', actorSheet: trainer(), sourceInstanceId, campaignMinute: 0,
    })
    expect(preview.choices[0]!.options.some(option => option.label === 'Keep current Moves')).toBe(true)
    expect(() => resolveMachineMoveLearning({
      definition: definition(), sheetKind: 'pokemon', sheet: { ...target, revision: 5 },
      actorKind: 'trainer', actorSheet: trainer(), sourceInstanceId, campaignMinute: 0,
      selectedChoices: selectionsFor(preview),
      operationId: 'machine-learning-operation-0003', appliedAt: 20_002,
    })).toThrow('incomplete')
  })

  it('records reusable HM source use once per campaign day without consuming it', () => {
    const hm = definition('HM A3 - Surf')
    const target = pokemon({ species: 'Squirtle', movelist: [move('Tackle')] })
    const actor = trainer()
    const preview = previewMachineMoveLearning({
      definition: hm, sheetKind: 'pokemon', sheet: target,
      actorKind: 'trainer', actorSheet: actor, sourceInstanceId, campaignMinute: 1_500,
    })
    const resolved = resolveMachineMoveLearning({
      definition: hm, sheetKind: 'pokemon', sheet: target,
      actorKind: 'trainer', actorSheet: actor, sourceInstanceId, campaignMinute: 1_500,
      selectedChoices: selectionsFor(preview),
      operationId: 'machine-learning-operation-0004', appliedAt: 20_003,
    })
    expect(resolved.dailyUse).toMatchObject({ campaignDayIndex: 1, campaignMinute: 1_500 })
    const usedActor = applyItemMachineDailyUsage({ sheet: actor, use: resolved.dailyUse! })
    expect(() => previewMachineMoveLearning({
      definition: hm, sheetKind: 'pokemon',
      sheet: pokemon({ slug: 'second', species: 'Squirtle', movelist: [move('Tackle')] }),
      actorKind: 'trainer', actorSheet: usedActor, sourceInstanceId, campaignMinute: 2_000,
    })).toThrow('already used')
    expect(previewMachineMoveLearning({
      definition: hm, sheetKind: 'pokemon',
      sheet: pokemon({ slug: 'second', species: 'Squirtle', movelist: [move('Tackle')] }),
      actorKind: 'trainer', actorSheet: usedActor, sourceInstanceId, campaignMinute: 2_940,
    }).description).toContain('Surf')
  })
})
