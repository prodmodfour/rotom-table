import { describe, expect, it, vi } from 'vitest'
import {
  attackOfOpportunityStruggleOptions,
  canMakeAttackOfOpportunity,
  movementAttackOfOpportunityAttackerIds,
  rangedAttackOfOpportunityAttackerIds,
  tokensAreAdjacent,
  useAttackOfOpportunityTriggers,
} from '~/utils/attackOfOpportunity'
import type { SpawnedPokemon } from '~/types/pokemon'
import { moveAutomationSemanticStatusForMenu } from '~/utils/moveAutomationSemanticStatus'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'

const token = (id: string, x: number, z: number, overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id,
  species: id,
  slug: id,
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x, y: 0, z },
  sheetKind: 'pokemon',
  sheetSlug: id,
  level: 5,
  currentHp: 20,
  maxHp: 20,
  atk: 8,
  satk: 8,
  def: 5,
  sdef: 5,
  defenderTypes: [],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
})

const moveOption = (name: string, overrides: Partial<TokenMoveMenuOption> = {}): TokenMoveMenuOption => ({
  name,
  type: 'Normal',
  damageClass: 'Physical',
  frequency: 'At-Will',
  ac: 4,
  range: 'Melee, 1 Target',
  effect: null,
  special: null,
  damageBase: 4,
  hasStab: false,
  damageAverage: 18.5,
  damageFormula: '1d8+6+8',
  attackStat: 8,
  baseAttackStat: 8,
  attackStage: 0,
  attackStatKey: 'atk',
  attackStatLabel: 'Attack',
  attackStatAbility: null,
  additionalAttackStat: null,
  additionalBaseAttackStat: null,
  additionalAttackStage: null,
  additionalAttackStatKey: null,
  additionalAttackStatLabel: null,
  automatic: true,
  moveList: {
    source: 'placement',
    effectId: null,
    copiedSpecHash: null,
    available: true,
    blockReason: null,
    blockingEffectIds: [],
  },
  disabledByMoveList: false,
  hasAutomationScript: true,
  automation: moveAutomationSemanticStatusForMenu(name),
  disabledByAutomation: false,
  conditionUseBlock: null,
  disabledByCondition: false,
  usage: null,
  disabledByUsage: false,
  ...overrides,
})

describe('attack of opportunity helpers', () => {
  it('uses PTU footprint adjacency, including diagonals and larger bases', () => {
    expect(tokensAreAdjacent(token('left', 0, 0), token('right', 1, 1))).toBe(true)
    expect(tokensAreAdjacent(token('left', 0, 0), token('far', 2, 0))).toBe(false)
    expect(tokensAreAdjacent(token('large', 0, 0, { base: 2 }), token('right', 2, 1))).toBe(true)
  })

  it('finds adjacent tokens when a provoker shifts out of an adjacent square', () => {
    const tokens = [
      token('provoker', 1, 1),
      token('adjacent', 0, 1),
      token('distant', 4, 1),
    ]

    expect(movementAttackOfOpportunityAttackerIds({
      provokerId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
      tokens,
    })).toEqual(['adjacent'])

    expect(movementAttackOfOpportunityAttackerIds({
      provokerId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 1, y: 0, z: 1 },
      tokens,
    })).toEqual([])
  })

  it('finds adjacent tokens for ranged attacks unless someone adjacent is targeted', () => {
    const tokens = [
      token('provoker', 1, 1),
      token('adjacent', 0, 1),
      token('distant-target', 5, 1),
    ]

    expect(rangedAttackOfOpportunityAttackerIds({
      provokerId: 'provoker',
      targetIds: ['distant-target'],
      tokens,
    })).toEqual(['adjacent'])

    expect(rangedAttackOfOpportunityAttackerIds({
      provokerId: 'provoker',
      targetIds: ['adjacent'],
      tokens,
    })).toEqual([])
  })

  it('blocks attackers with AoO-preventing conditions', () => {
    expect(canMakeAttackOfOpportunity(token('ready', 0, 0))).toBe(true)
    expect(canMakeAttackOfOpportunity(token('sleeping', 0, 0, { conditions: ['Sleeping'] }))).toBe(false)
    expect(canMakeAttackOfOpportunity(token('confused', 0, 0, { conditions: ['Confused'] }))).toBe(false)
    expect(canMakeAttackOfOpportunity(token('fainted', 0, 0, { currentHp: 0 }))).toBe(false)
  })

  it('lists only automated usable Struggle variants', () => {
    expect(attackOfOpportunityStruggleOptions([
      moveOption('Struggle'),
      moveOption('Struggle (Zapper Special)'),
      moveOption('Tackle'),
      moveOption('Struggle (Fountain Physical)', { disabledByCondition: true }),
      moveOption('Struggle (Materializer Physical)', { disabledByAutomation: true }),
      moveOption('Struggle (Guster Physical)', { disabledByMoveList: true }),
    ]).map((move) => move.name)).toEqual(['Struggle', 'Struggle (Zapper Special)'])
  })
})

describe('useAttackOfOpportunityTriggers', () => {
  it('sends trigger-only intent and never creates a browser-owned prompt ID', async () => {
    const dispatchTrigger = vi.fn(async () => true)
    const triggers = useAttackOfOpportunityTriggers({ dispatchTrigger })

    await triggers.provokeMovementAttackOfOpportunity({
      provokerId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
    })
    await triggers.provokeRangedAttackOfOpportunity({
      provokerId: 'provoker',
      targetIds: ['distant-target'],
    })

    expect(dispatchTrigger).toHaveBeenNthCalledWith(1, {
      action: 'provoke',
      reason: 'movement',
      provokerId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
    })
    expect(dispatchTrigger).toHaveBeenNthCalledWith(2, {
      action: 'provoke',
      reason: 'ranged-attack',
      provokerId: 'provoker',
      targetIds: ['distant-target'],
    })
  })
})
