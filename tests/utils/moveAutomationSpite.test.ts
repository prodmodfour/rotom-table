import { describe, expect, it } from 'vitest'
import {
  buildSpiteReactionConditionUpdate,
  buildSpiteReactionPrompts,
  tokenHasUsableSpite,
} from '~/utils/moveAutomationSpite'
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

describe('move automation Spite reactions', () => {
  it('detects usable Spite from move entries unless Spite is Disabled', () => {
    expect(tokenHasUsableSpite(token({ id: 'd', species: 'Dusclops' }), [{ move: { name: 'Spite' }, automatic: false }])).toBe(true)
    expect(tokenHasUsableSpite(token({ id: 'd', species: 'Dusclops', conditions: ['Disabled: Spite'] }), [{ move: { name: 'Spite' }, automatic: false }])).toBe(false)
    expect(tokenHasUsableSpite(token({ id: 'd', species: 'Dusclops' }), [{ move: { name: 'Shadow Ball' }, automatic: false }])).toBe(false)
  })

  it('builds one prompt for each hit target with usable Spite', () => {
    const attacker = token({ id: 'a', species: 'Gengar' })
    const defender = token({ id: 'd', species: 'Dusclops' })
    const prompts = buildSpiteReactionPrompts({
      attacker,
      moveName: 'Ember',
      hitTargets: [defender],
      moveEntriesForTarget: () => [{ move: { name: 'Spite' }, automatic: false }],
      idFactory: () => 'spite-id',
    })

    expect(prompts).toEqual([{
      id: 'spite-id',
      defenderId: 'd',
      defenderName: 'Dusclops',
      attackerId: 'a',
      attackerName: 'Gengar',
      moveName: 'Ember',
    }])
  })

  it('does not prompt for Spite itself or moves already Disabled for the attacker', () => {
    const defender = token({ id: 'd', species: 'Dusclops' })
    const moveEntriesForTarget = () => [{ move: { name: 'Spite' }, automatic: false }]

    expect(buildSpiteReactionPrompts({
      attacker: token({ id: 'a', species: 'Gengar' }),
      moveName: 'Spite',
      hitTargets: [defender],
      moveEntriesForTarget,
    })).toEqual([])
    expect(buildSpiteReactionPrompts({
      attacker: token({ id: 'a', species: 'Gengar', conditions: ['Disabled: Ember'] }),
      moveName: 'Ember',
      hitTargets: [defender],
      moveEntriesForTarget,
    })).toEqual([])
  })

  it('creates a condition update that disables the triggering move', () => {
    expect(buildSpiteReactionConditionUpdate(token({ id: 'a', species: 'Gengar', conditions: ['Burned'] }), 'Ember')).toEqual({
      id: 'a',
      conditions: ['Burned', 'Disabled: Ember'],
    })
  })
})
