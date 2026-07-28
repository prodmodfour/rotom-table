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

  it('uses the revised physical stat profiles for Onix and Steelix', () => {
    const bySpecies = new Map(loadPokedex().map((entry) => [entry.species, entry]))
    const onix = bySpecies.get('Onix')
    const steelix = bySpecies.get('Steelix')

    expect(onix?.base_stats).toEqual({ hp: 8, atk: 10, def: 15, spatk: 3, spdef: 5, spd: 7 })
    expect(onix?.capabilities?.other).not.toContain('Underdog')
    expect(steelix?.base_stats).toEqual({ hp: 10, atk: 13, def: 19, spatk: 4, spdef: 8, spd: 3 })
  })

  it('uses energy-focused stat progression for the Roggenrola line', () => {
    const bySpecies = new Map(loadPokedex().map((entry) => [entry.species, entry]))

    expect(bySpecies.get('Roggenrola')?.base_stats)
      .toEqual({ hp: 6, atk: 5, def: 9, spatk: 6, spdef: 3, spd: 2 })
    expect(bySpecies.get('Boldore')?.base_stats)
      .toEqual({ hp: 7, atk: 8, def: 11, spatk: 10, spdef: 5, spd: 2 })
    expect(bySpecies.get('Gigalith')?.base_stats)
      .toEqual({ hp: 9, atk: 11, def: 13, spatk: 13, spdef: 8, spd: 3 })
  })

  it('uses mobile, energy-focused stat progression for the Vikavolt line', () => {
    const bySpecies = new Map(loadPokedex().map((entry) => [entry.species, entry]))
    const vikavolt = bySpecies.get('Vikavolt')

    expect(bySpecies.get('Grubbin')?.base_stats)
      .toEqual({ hp: 5, atk: 6, def: 5, spatk: 6, spdef: 5, spd: 6 })
    expect(bySpecies.get('Charjabug')?.base_stats)
      .toEqual({ hp: 6, atk: 6, def: 10, spatk: 9, spdef: 8, spd: 4 })
    expect(vikavolt?.base_stats)
      .toEqual({ hp: 8, atk: 7, def: 9, spatk: 15, spdef: 8, spd: 10 })
    expect(vikavolt).toMatchObject({ evolution_stage: 3, evolutions_remaining: 0 })
  })

  it('uses fast, physical stat progression for the Treecko line', () => {
    const bySpecies = new Map(loadPokedex().map((entry) => [entry.species, entry]))

    expect(bySpecies.get('Treecko')?.base_stats)
      .toEqual({ hp: 4, atk: 7, def: 4, spatk: 5, spdef: 6, spd: 8 })
    expect(bySpecies.get('Grovyle')?.base_stats)
      .toEqual({ hp: 5, atk: 9, def: 5, spatk: 7, spdef: 6, spd: 10 })
    expect(bySpecies.get('Sceptile')?.base_stats)
      .toEqual({ hp: 7, atk: 11, def: 7, spatk: 9, spdef: 9, spd: 12 })
  })

  it('contains machine moves parsed from shorthand TM sections and all-machine notes', () => {
    const pokedex = loadPokedex()
    const bySpecies = new Map(pokedex.map((entry) => [entry.species, entry]))

    expect(bySpecies.get('Mew')?.tm_hm_moves).toContainEqual({ kind: 'HM', number: '01', name: 'Cut' })
    expect(bySpecies.get('Mew')?.tm_hm_moves).toContainEqual({ kind: 'TM', number: '100', name: 'Confide' })
    expect(bySpecies.get('Grookey')?.tm_hm_moves).toContainEqual({ kind: 'TM', number: '01', name: 'Work Up' })
    expect(bySpecies.get('Grookey')?.tm_hm_moves).toContainEqual({ kind: 'TM', number: '100', name: 'Confide' })
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
