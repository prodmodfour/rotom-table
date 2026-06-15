import { describe, expect, it } from 'vitest'
import {
  WILD_POKEMON_SKILL_LABELS,
  rollWildPokemonSkillBackground,
  wildPokemonSkillBackgroundName,
} from '~/utils/sheets/wildPokemonSkillBackground'

const sequenceRandom = (...values: number[]) => {
  let index = 0
  return () => values[index++] ?? values[values.length - 1] ?? 0
}

describe('wild Pokémon skill backgrounds', () => {
  it('rolls deterministic raised and lowered skills from the injected random source', () => {
    const background = rollWildPokemonSkillBackground(sequenceRandom(0, 0, 0))

    expect(background).toEqual({
      description: 'Wary Canopy Trail-Bounder',
      raised: ['Acrobatics', 'Athletics'],
      lowered: ['Charm'],
    })
  })

  it('rolls exactly two raised skills and one lowered skill without overlap', () => {
    const background = rollWildPokemonSkillBackground(sequenceRandom(0.99, 0.99, 0.99))

    expect(background.raised).toHaveLength(2)
    expect(new Set(background.raised).size).toBe(2)
    expect(background.lowered).toHaveLength(1)
    expect(background.raised).not.toContain(background.lowered?.[0])
  })

  it('has a non-empty wild preset name for every valid raised-pair and lowered-skill combination', () => {
    for (let first = 0; first < WILD_POKEMON_SKILL_LABELS.length; first += 1) {
      for (let second = first + 1; second < WILD_POKEMON_SKILL_LABELS.length; second += 1) {
        const raised = [WILD_POKEMON_SKILL_LABELS[first]!, WILD_POKEMON_SKILL_LABELS[second]!]
        for (const lowered of WILD_POKEMON_SKILL_LABELS) {
          if (raised.includes(lowered)) continue

          const name = wildPokemonSkillBackgroundName(raised, lowered)

          expect(name.trim()).toBe(name)
          expect(name.length).toBeGreaterThan(0)
          expect(name).not.toContain('/')
          expect(name).not.toMatch(/\bBackground\b/i)
          for (const skill of WILD_POKEMON_SKILL_LABELS) {
            expect(name).not.toContain(skill)
          }
        }
      }
    }
  })

  it('uses the same preset name regardless of raised skill order', () => {
    expect(wildPokemonSkillBackgroundName(['Survival', 'Athletics'], 'Charm'))
      .toBe(wildPokemonSkillBackgroundName(['Athletics', 'Survival'], 'Charm'))
  })
})
