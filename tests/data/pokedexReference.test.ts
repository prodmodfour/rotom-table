import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PokedexRecord } from '~/types/pokemon'

const loadPokedex = (): PokedexRecord[] => JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/reference/pokedex.json'), 'utf-8'),
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
})
