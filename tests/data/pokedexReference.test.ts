import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PokedexRecord } from '~/types/pokemon'

const loadPokedex = (): PokedexRecord[] => JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/reference/pokedex.json'), 'utf-8'),
)

const loadAbilities = (): Record<string, { name: string; frequency?: string; effect?: string }> => JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/reference/abilities.json'), 'utf-8'),
)

describe('Pokédex reference data', () => {
  it('does not expose parser fall-through entries', () => {
    const pokedex = loadPokedex()

    expect(pokedex.some((entry) => entry.species === 'Hp:')).toBe(false)
  })

  it('contains searchable Nidoran female and male records', () => {
    const pokedex = loadPokedex()
    const nidoranF = pokedex.filter((entry) => entry.species === 'Nidoran (F)')
    const nidoranM = pokedex.filter((entry) => entry.species === 'Nidoran (M)')

    expect(nidoranF).toHaveLength(1)
    expect(nidoranM).toHaveLength(1)
    expect(nidoranF[0]).toMatchObject({ types: ['Poison'], base_stats: { hp: 6, atk: 5 } })
    expect(nidoranM[0]).toMatchObject({ types: ['Poison'], base_stats: { hp: 5, atk: 6 } })
  })

  it('contains complete Tauros breed records', () => {
    const pokedex = loadPokedex()
    const bySpecies = new Map(pokedex.map((entry) => [entry.species, entry]))
    const combat = bySpecies.get('Tauros Combat Breed')
    const blaze = bySpecies.get('Tauros Blaze Breed')
    const aqua = bySpecies.get('Tauros Aqua Breed')

    expect(combat).toMatchObject({
      types: ['Fighting'],
      base_stats: { hp: 8, atk: 11, def: 11, spatk: 3, spdef: 7, spd: 10 },
      abilities: {
        basic: ['Intimidate', 'Anger Point'],
        advanced: ['Bully', 'Cud Chew'],
        high: ['Gore'],
      },
      capabilities: { overland: 8, swim: 4, power: 9, other: ['Mountable 1', 'Pack Mon'] },
      source_gen: 'gen9',
    })
    expect(blaze).toMatchObject({
      types: ['Fighting', 'Fire'],
      abilities: { advanced: ['Fiery Crash', 'Cud Chew'] },
      capabilities: { other: ['Mountable 1', 'Firestarter', 'Heater', 'Pack Mon'] },
    })
    expect(aqua).toMatchObject({
      types: ['Fighting', 'Water'],
      abilities: { advanced: ['Aqua Bullet', 'Cud Chew'] },
      capabilities: { swim: 6, jump: '1/3', other: ['Mountable 1', 'Fountain', 'Pack Mon'] },
    })

    expect(combat?.level_up_moves?.map((move) => move.name)).toContain('Raging Bull')
    expect(blaze?.level_up_moves?.map((move) => move.name)).toContain('Flare Blitz')
    expect(aqua?.level_up_moves?.map((move) => move.name)).toContain('Wave Crash')
    expect(loadAbilities()['Cud Chew']).toMatchObject({ frequency: 'Scene – Swift Action' })
  })
})
