import { describe, expect, it } from 'vitest'
import {
  createMoveAutomationCombatStageUpdateAccumulator,
  createMoveAutomationConditionUpdateAccumulator,
} from '~/utils/moveAutomationStatusUpdates'
import type { CombatStageMap } from '~/types/combatStages'
import type { SpawnedPokemon } from '~/types/pokemon'

const stages: CombatStageMap = { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 }

const token = (overrides: Partial<SpawnedPokemon> & Pick<SpawnedPokemon, 'id' | 'species'>): SpawnedPokemon => {
  const { id, species, ...rest } = overrides
  return {
    id,
    species,
    slug: species.toLowerCase(),
    size: 'Small',
    width: 1,
    height: 1,
    base: 1,
    clearance: 1,
    spriteUrl: '/sprite.png',
    entityKind: 'pokemon',
    position: { x: 0, y: 0, z: 0 },
    sheetKind: 'pokemon',
    sheetSlug: species.toLowerCase(),
    level: 10,
    currentHp: 20,
    maxHp: 40,
    atk: 8,
    satk: 7,
    def: 5,
    sdef: 4,
    defenderTypes: ['Normal'],
    combatStages: stages,
    conditions: [],
    tokenItems: [],
    ...rest,
  }
}

describe('move automation status update accumulators', () => {
  it('merges, normalizes, removes, and clears condition updates per token', () => {
    const target = token({ id: 'target', species: 'Target', conditions: ['Burned', 'Confused'] })
    const user = token({ id: 'user', species: 'User', conditions: ['Poisoned'] })
    const accumulator = createMoveAutomationConditionUpdateAccumulator()

    accumulator.applySuggestion(target, { recipient: 'target', condition: 'Burned', action: 'remove', label: 'Remove burn' })
    accumulator.merge(target, ['PSN', 'Slowed', 'Unknown Condition'])
    accumulator.applySuggestion(user, { recipient: 'user', condition: '*', action: 'clear', label: 'Clear user' })

    expect(accumulator.toUpdates()).toEqual([
      { id: 'target', conditions: ['Poisoned', 'Confused', 'Slowed'] },
      { id: 'user', conditions: [] },
    ])
  })

  it('does not create condition updates for empty or unknown manual conditions', () => {
    const accumulator = createMoveAutomationConditionUpdateAccumulator()

    accumulator.merge(token({ id: 'target', species: 'Target' }), ['', 'Unknown Condition'])

    expect(accumulator.toUpdates()).toEqual([])
  })

  it('stacks Flinch and applies Vulnerable with every new Flinch stack', () => {
    const target = token({ id: 'target', species: 'Target', conditions: ['Flinch'] })
    const accumulator = createMoveAutomationConditionUpdateAccumulator()

    accumulator.applySuggestion(target, { recipient: 'target', condition: 'Flinch', label: 'Flinch' })
    accumulator.merge(target, ['Flinched'])

    expect(accumulator.toUpdates()).toEqual([
      { id: 'target', conditions: ['Flinch', 'Flinch', 'Flinch', 'Vulnerable'] },
    ])
  })

  it('gets detached state and sets absolute condition state', () => {
    const target = token({ id: 'target', species: 'Target', conditions: ['Burned'] })
    const accumulator = createMoveAutomationConditionUpdateAccumulator()
    const current = accumulator.get(target) as string[]
    current.push('Poisoned')

    expect(accumulator.get(target)).toEqual(['Burned'])
    accumulator.set(target, ['PSN'])
    expect(accumulator.toUpdates()).toEqual([{ id: 'target', conditions: ['Poisoned'] }])
  })

  it('accumulates combat-stage deltas from normalized token stages', () => {
    const target = token({
      id: 'target',
      species: 'Target',
      combatStages: { ...stages, atk: 5, def: -5, spd: 1 },
    })
    const accumulator = createMoveAutomationCombatStageUpdateAccumulator()

    accumulator.addDeltas(target, { atk: 2, def: -3 })
    accumulator.addDeltas(target, { spd: 2, acc: -1 })

    expect(accumulator.toUpdates()).toEqual([
      { id: 'target', stages: { ...stages, atk: 6, def: -6, spd: 3, acc: -1 } },
    ])
  })

  it('gets detached stages and normalizes absolute stage state', () => {
    const target = token({ id: 'target', species: 'Target' })
    const accumulator = createMoveAutomationCombatStageUpdateAccumulator()
    const current = accumulator.get(target)
    current.atk = 4

    expect(accumulator.get(target).atk).toBe(0)
    accumulator.set(target, { ...stages, atk: 99, def: -99 })
    expect(accumulator.toUpdates()).toEqual([{
      id: 'target',
      stages: { ...stages, atk: 6, def: -6 },
    }])
  })
})
