import { describe, expect, it } from 'vitest'
import {
  createEmptyEncounterHistory,
  type EncounterHistory,
} from '#shared/moveAutomation/encounterHistory'
import { createMoveAutomationHistoryResolver } from '~~/server/domain/moveAutomation/history'
import {
  MoveAutomationTargetStateQueryError,
  createMoveAutomationTargetStateResolver,
  type CreateMoveAutomationTargetStateResolverInput,
} from '~~/server/domain/moveAutomation/targetState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const stages = {
  atk: 0,
  def: 0,
  satk: 0,
  sdef: 0,
  spd: 0,
  acc: 0,
}

const placement = (
  id: string,
  sheetKind: SheetPlacement['sheetKind'] = 'pokemon',
): SheetPlacement => ({
  id,
  sheetKind,
  sheetSlug: id,
  position: { x: 0, y: 0, z: 0 },
})

const token = (
  id: string,
  overrides: Partial<SpawnedPokemon> = {},
): SpawnedPokemon => ({
  id,
  species: id,
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  slug: id,
  spriteUrl: `/sprites/${id}.png`,
  entityKind: 'pokemon',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: id,
  level: 20,
  currentHp: 50,
  maxHp: 50,
  atk: 10,
  satk: 10,
  def: 10,
  sdef: 10,
  defenderTypes: [],
  combatStages: stages,
  conditions: [],
  tokenItems: [],
  ...overrides,
})

const pokemonSheet = (
  slug: string,
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 20,
  revision: 3,
  ...overrides,
})

const trainerSheet = (slug: string): TrainerSheet => ({
  slug,
  name: slug,
  level: 20,
  revision: 4,
})

const historyFixture = (): EncounterHistory => ({
  ...createEmptyEncounterHistory(),
  sceneId: 'scene-1',
  currentRound: 2,
  currentTurn: { round: 2, turn: 3, placementId: 'actor' },
  actedThisTurnPlacementIds: ['target'],
  actedThisRoundPlacementIds: ['target', 'grounded'],
  switchedPlacementIds: ['target'],
  damageBySourceThisTurn: [{
    resolutionId: 'resolution-1',
    canonicalId: 'Tackle',
    sourcePlacementId: 'actor',
    targetPlacementId: 'target',
    hitPointLoss: 4,
    temporaryHitPointLoss: 1,
  }],
  damageBySourceThisRound: [
    {
      resolutionId: 'resolution-1',
      canonicalId: 'Tackle',
      sourcePlacementId: 'actor',
      targetPlacementId: 'target',
      hitPointLoss: 4,
      temporaryHitPointLoss: 1,
    },
    {
      resolutionId: 'resolution-2',
      canonicalId: 'Scratch',
      sourcePlacementId: 'actor',
      targetPlacementId: 'grounded',
      hitPointLoss: 2,
      temporaryHitPointLoss: 0,
    },
  ],
})

const resolverInput = (): CreateMoveAutomationTargetStateResolverInput => {
  const placements = [
    placement('target'),
    placement('grounded'),
    placement('fainted'),
    placement('zero-hp'),
    placement('trainer', 'trainer'),
  ]
  const tokens = [
    token('target', {
      defenderTypes: ['Grass', 'Flying'],
      defenderCapabilities: { sky: 6 },
      abilityNames: ['Soundproof'],
      conditions: ['Burned'],
      tokenItems: ['Luck Incense', 'Potion'],
    }),
    token('grounded', {
      defenderCapabilities: { levitate: 4 },
      conditions: ['Smack Down Grounded'],
    }),
    token('fainted', { currentHp: 10, conditions: ['Fainted'] }),
    token('zero-hp', { currentHp: 0 }),
    token('trainer', {
      entityKind: 'trainer',
      size: 'Trainer',
      sheetKind: 'trainer',
      defenderTypes: [],
      tokenItems: ['Potion'],
    }),
  ]
  return {
    placements,
    tokens,
    sheets: [
      {
        kind: 'pokemon',
        slug: 'target',
        sheet: pokemonSheet('target', {
          capabilities: { size: 'Huge', weight: 5, sky: 6 },
        }),
      },
      { kind: 'pokemon', slug: 'grounded', sheet: pokemonSheet('grounded') },
      { kind: 'pokemon', slug: 'fainted', sheet: pokemonSheet('fainted') },
      { kind: 'pokemon', slug: 'zero-hp', sheet: pokemonSheet('zero-hp') },
      { kind: 'trainer', slug: 'trainer', sheet: trainerSheet('trainer') },
    ],
    history: createMoveAutomationHistoryResolver(historyFixture()),
  }
}

describe('authoritative target state queries', () => {
  it('derives vitality, movement state, history, conditions, types, tags, size, weight, kind, and items', () => {
    const consulted: string[] = []
    const input = resolverInput()
    const resolver = createMoveAutomationTargetStateResolver({
      ...input,
      recordSheetRead: sheet => consulted.push(`${sheet.sheetKind}:${sheet.sheetSlug}`),
    })

    expect(resolver.resolve('target')).toEqual({
      targetPlacementId: 'target',
      vitality: 'conscious',
      grounding: 'airborne',
      switchedThisScene: true,
      actedThisTurn: true,
      actedThisRound: true,
      damagedThisTurn: true,
      damagedThisRound: true,
      conditionIds: ['burned'],
      typeIds: ['grass', 'flying'],
      immunityTagIds: ['groundsource', 'powder', 'sonic'],
      size: 'huge',
      weightClass: 5,
      sheetKind: 'pokemon',
      itemIds: ['luck-incense', 'potion'],
    })
    expect(resolver.resolve('grounded')).toMatchObject({
      grounding: 'grounded',
      actedThisTurn: false,
      actedThisRound: true,
      damagedThisTurn: false,
      damagedThisRound: true,
      conditionIds: ['smack-down-grounded'],
      immunityTagIds: [],
    })
    expect(resolver.resolve('fainted')).toMatchObject({ vitality: 'fainted' })
    expect(resolver.resolve('zero-hp')).toMatchObject({ vitality: 'fainted' })
    expect(resolver.resolve('trainer')).toMatchObject({
      sheetKind: 'trainer',
      typeIds: [],
      size: null,
      weightClass: null,
      itemIds: ['potion'],
    })
    expect(resolver.resolve('missing')).toBeNull()
    expect(consulted).toEqual([
      'pokemon:target',
      'pokemon:grounded',
      'pokemon:fainted',
      'pokemon:zero-hp',
      'trainer:trainer',
    ])
  })

  it('snapshots and freezes target facts before rule evaluation', () => {
    const input = resolverInput()
    const mutableTarget = input.tokens[0]!
    const consulted: string[] = []
    const resolver = createMoveAutomationTargetStateResolver({
      ...input,
      recordSheetRead: sheet => consulted.push(`${sheet.sheetKind}:${sheet.sheetSlug}`),
    })
    input.placements[0]!.sheetSlug = 'mutated-source'
    const first = resolver.resolve('target')!

    mutableTarget.currentHp = 0
    mutableTarget.conditions.push('Poisoned')
    mutableTarget.defenderTypes.push('Fire')
    mutableTarget.tokenItems.push('Antidote')

    expect(resolver.resolve('target')).toBe(first)
    expect(first).toMatchObject({
      vitality: 'conscious',
      conditionIds: ['burned'],
      typeIds: ['grass', 'flying'],
      itemIds: ['luck-incense', 'potion'],
    })
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.conditionIds)).toBe(true)
    expect(Object.isFrozen(first.typeIds)).toBe(true)
    expect(Object.isFrozen(first.immunityTagIds)).toBe(true)
    expect(Object.isFrozen(first.itemIds)).toBe(true)
    expect(consulted).toEqual(['pokemon:target', 'pokemon:target'])
  })

  it('fails closed for unresolved references and rejects duplicate authoritative identities', () => {
    const input = resolverInput()
    const mismatched = createMoveAutomationTargetStateResolver({
      ...input,
      tokens: input.tokens.map(entry => entry.id === 'target'
        ? { ...entry, sheetSlug: 'other' }
        : entry),
    })
    expect(mismatched.resolve('target')).toBeNull()

    expect(() => createMoveAutomationTargetStateResolver({
      ...input,
      placements: [...input.placements, { ...input.placements[0]! }],
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationTargetStateQueryError.name,
      code: 'duplicate-placement-id',
    }))
    expect(() => createMoveAutomationTargetStateResolver({
      ...input,
      tokens: [...input.tokens, { ...input.tokens[0]! }],
    })).toThrowError(expect.objectContaining({ code: 'duplicate-token-id' }))
    expect(() => createMoveAutomationTargetStateResolver({
      ...input,
      sheets: [...input.sheets, { ...input.sheets[0]! }],
    })).toThrowError(expect.objectContaining({ code: 'duplicate-sheet-reference' }))
  })
})
