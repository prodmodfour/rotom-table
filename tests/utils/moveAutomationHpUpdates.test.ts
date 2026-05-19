import { describe, expect, it } from 'vitest'
import {
  clampMoveAutomationHp,
  createMoveAutomationHpUpdateAccumulator,
} from '~/utils/moveAutomationHpUpdates'
import type { SpawnedPokemon } from '~/types/pokemon'

const token = (id: string, currentHp: number, maxHp: number): SpawnedPokemon => ({
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
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: id,
  level: 1,
  currentHp,
  maxHp,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: [],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
})

describe('move automation HP update helpers', () => {
  it('caps HP updates at Max HP while preserving integer overkill damage', () => {
    expect(clampMoveAutomationHp(12.9, 20)).toBe(12)
    expect(clampMoveAutomationHp(-3, 20)).toBe(-3)
    expect(clampMoveAutomationHp(99, 20)).toBe(20)
  })

  it('tracks latest token HP and emits only changed updates', () => {
    const pikachu = token('pikachu', 12, 20)
    const bulbasaur = token('bulbasaur', 8, 15)
    const accumulator = createMoveAutomationHpUpdateAccumulator()

    expect(accumulator.get(pikachu)).toBe(12)

    accumulator.set(pikachu, 17)
    accumulator.set(bulbasaur, 8)

    expect(accumulator.get(pikachu)).toBe(17)
    expect(accumulator.get(bulbasaur)).toBe(8)
    expect(accumulator.toUpdates()).toEqual([{ id: 'pikachu', currentHp: 17 }])
  })

  it('uses the latest write for a token and caps before emitting', () => {
    const eevee = token('eevee', 7, 12)
    const accumulator = createMoveAutomationHpUpdateAccumulator()

    accumulator.set(eevee, -10)
    expect(accumulator.get(eevee)).toBe(-10)

    accumulator.set(eevee, 30)
    expect(accumulator.toUpdates()).toEqual([{ id: 'eevee', currentHp: 12 }])
  })

  it('adds injury updates when damage crosses PTU injury thresholds', () => {
    const oddish = token('oddish', 53, 53)
    oddish.fullMaxHp = 53
    oddish.injuries = 0
    const accumulator = createMoveAutomationHpUpdateAccumulator()

    const result = accumulator.setWithInjuryAutomation(oddish, 25, 'damage')

    expect(result.injuryDelta).toBe(2)
    expect(accumulator.getInjuries(oddish)).toBe(2)
    expect(accumulator.getMaxHp(oddish)).toBe(42)
    expect(accumulator.toUpdates()).toEqual([{ id: 'oddish', currentHp: 25, injuries: 2 }])
  })
})
