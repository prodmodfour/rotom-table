import { describe, expect, it } from 'vitest'
import {
  buildPokedexSearchTexts,
  buildSearchText,
  formatNationalDexNumber,
  normalizeText,
  toPokedexSlug,
} from '~/utils/pokedex/searchText'
import type { PokedexRecord } from '~/types/pokemon'

describe('pokedex search text helpers', () => {
  it('normalizes display text for case-insensitive searching', () => {
    expect(normalizeText("Farfetch’d #083!")).toBe('farfetchd #083')
    expect(toPokedexSlug("Mr. Mime's Form")).toBe('mr-mimes-form')
    expect(formatNationalDexNumber(25)).toBe('#025')
  })

  it('indexes compact aliases for spaced source values', () => {
    expect(buildSearchText(['Thunder Punch', 'TM 35'])).toBe('thunder punch thunderpunch tm 35 tm35')
  })

  it('builds field-specific search buckets for a pokedex entry', () => {
    const entry: PokedexRecord & { slug: string; nationalDexNumber: number | null } = {
      species: 'Pikachu',
      slug: 'pikachu',
      nationalDexNumber: 25,
      source_gen: '1',
      types: ['Electric'],
      abilities: { basic: ['Static'], high: ['Lightning Rod'] },
      capabilities: { overland: 6, jump: '2/3', other: ['Glow', 'Threaded 4'] },
      level_up_moves: [{ level: 10, name: 'Thunder Shock', type: 'Electric' }],
      tm_hm_moves: [{ kind: 'TM', number: '24', name: 'Thunderbolt' }],
      egg_moves: ['Fake Out'],
      tutor_moves: [{ name: 'Iron Tail', heart_scale: true }],
      egg_groups: ['Field', 'Fairy'],
      diet: ['Herbivore'],
      habitat: ['Forest'],
      skills: { Acrobatics: '4d6+2' },
      base_stats: { hp: 4, atk: 5, def: 4, spatk: 5, spdef: 5, spd: 9 },
      size: 'Small',
      height: 0.4,
      weight: 1,
    }

    const texts = buildPokedexSearchTexts(entry)

    expect(texts.identity).toContain('#025')
    expect(texts.type).toContain('electric type')
    expect(texts.ability).toContain('lightning rod')
    expect(texts.capability).toContain('cap overland 6')
    expect(texts.capability).toContain('threaded 4')
    expect(texts.move).toContain('tm24 thunderbolt')
    expect(texts.move).toContain('heart scale move iron tail')
    expect(texts.skill).toContain('acrobatics 4d6 2')
    expect(texts.skill).toContain('skill acrobatics 3d6')
    expect(texts.stat).toContain('base speed 9')
    expect(texts.size).toContain('weight class 1')
    expect(texts.any).toContain('pikachu')
    expect(texts.any).toContain('thunderbolt')
  })
})
