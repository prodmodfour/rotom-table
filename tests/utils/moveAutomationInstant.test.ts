import { describe, expect, it } from 'vitest'
import { explicitScriptForMove } from '~/utils/moveAutomation'
import { resolveInstantMoveAutomation } from '~/utils/moveAutomationInstant'
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
    currentHp: 40,
    maxHp: 40,
    atk: 5,
    satk: 10,
    def: 5,
    sdef: 5,
    spd: 5,
    evasion: { physical: 0, special: 0, speed: 0 },
    defenderTypes: ['Normal'],
    combatStages: stages,
    conditions: [],
    tokenItems: [],
    ...rest,
  }
}

const sequenceRandom = (values: number[]) => {
  let index = 0
  return () => values[index++] ?? 0
}

describe('instant move automation', () => {
  it('resolves Ember hit, threshold burn, and damage transaction without review state', () => {
    const script = explicitScriptForMove('Ember')
    expect(script).not.toBeNull()
    const result = resolveInstantMoveAutomation({
      script: script!,
      user: token({ id: 'u', species: 'Caster' }),
      target: token({ id: 't', species: 'Bulba', defenderTypes: ['Grass'] }),
      damageFormula: '1d8+6',
      random: sequenceRandom([0.85, 0.375]),
      idFactory: () => 'fixed-feedback',
    })

    expect(result.feedback).toMatchObject({
      id: 'fixed-feedback',
      naturalRoll: 18,
      hit: true,
      damageLoss: 22,
      conditions: [{ condition: 'Burned', applied: true }],
    })
    expect(result.transaction.hpUpdates).toEqual([{ id: 't', currentHp: 18 }])
    expect(result.transaction.conditionUpdates).toEqual([{ id: 't', conditions: ['Burned'] }])
  })

  it('adds the damage dice a second time on critical hits', () => {
    const script = explicitScriptForMove('Ember')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Caster' }),
      target: token({ id: 't', species: 'Target' }),
      damageFormula: '1d8+6',
      random: sequenceRandom([0.999, 0.375]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 20, hit: true, crit: true, damageLoss: 19 })
    expect(result.transaction.hpUpdates).toEqual([{ id: 't', currentHp: 21 }])
  })

  it('does not apply Ember burn below its natural-roll threshold', () => {
    const script = explicitScriptForMove('Ember')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Caster' }),
      target: token({ id: 't', species: 'Bulba', defenderTypes: ['Grass'] }),
      damageFormula: '1d8+6',
      random: sequenceRandom([0.8, 0.375]),
    })

    expect(result.feedback).toMatchObject({ naturalRoll: 17, hit: true, conditions: [] })
    expect(result.transaction.conditionUpdates).toEqual([])
  })

  it('does not apply Ember burn to burn-immune targets', () => {
    const script = explicitScriptForMove('Ember')!
    const result = resolveInstantMoveAutomation({
      script,
      user: token({ id: 'u', species: 'Caster' }),
      target: token({ id: 't', species: 'Flare', defenderTypes: ['Fire'] }),
      damageFormula: '1d8+6',
      random: sequenceRandom([0.85, 0.375]),
    })

    expect(result.feedback.conditions).toEqual([{ condition: 'Burned', applied: false, blockedBy: 'Fire type' }])
    expect(result.transaction.conditionUpdates).toEqual([])
    expect(result.transaction.logLines).toContain('Manual note: Burned did not apply to Flare: immune (Fire type).')
  })
})
