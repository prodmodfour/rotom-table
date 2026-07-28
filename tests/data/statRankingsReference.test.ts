import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PokedexBaseStats, PokedexRecord } from '~/types/pokemon'

interface StatRankingRecord {
  species: string
  rankings: Record<RankingKey, number | null>
}

interface StatRankingsReference {
  metadata: {
    source: string
    ranking_method: string
    ranking_order: string
    rank_one_is_highest: boolean
    pokemon_count: number
    ranked_pokemon_count: number
    unranked_pokemon_count: number
  }
  pokemon: StatRankingRecord[]
}

const STAT_KEYS = [
  ['hp', 'hp'],
  ['attack', 'atk'],
  ['defense', 'def'],
  ['special_attack', 'spatk'],
  ['special_defense', 'spdef'],
  ['speed', 'spd'],
] as const

type RankingKey = typeof STAT_KEYS[number][0]

const loadJson = <T>(path: string): T => JSON.parse(
  readFileSync(resolve(process.cwd(), path), 'utf-8'),
) as T

describe('stat rankings reference data', () => {
  it('matches every available canonical Pokédex base stat', () => {
    const pokedex = loadJson<PokedexRecord[]>('data/reference/pokedex.json')
    const reference = loadJson<StatRankingsReference>('data/reference/stat-rankings.json')
    const rankedPokedex = pokedex.filter(
      (entry): entry is PokedexRecord & { base_stats: PokedexBaseStats } => Boolean(entry.base_stats),
    )
    const rankingsBySpecies = new Map(reference.pokemon.map(entry => [entry.species, entry.rankings]))

    expect(reference.metadata).toMatchObject({
      source: 'data/reference/pokedex.json',
      ranking_method: 'standard_competition',
      ranking_order: 'descending',
      rank_one_is_highest: true,
      pokemon_count: pokedex.length,
      ranked_pokemon_count: rankedPokedex.length,
      unranked_pokemon_count: pokedex.length - rankedPokedex.length,
    })
    expect(reference.pokemon).toHaveLength(pokedex.length)
    expect(rankingsBySpecies.size).toBe(pokedex.length)

    const expectedRanks = new Map<RankingKey, Map<number, number>>()
    for (const [rankingKey, baseStatKey] of STAT_KEYS) {
      const values = rankedPokedex.map(entry => entry.base_stats[baseStatKey])
      expectedRanks.set(rankingKey, new Map(
        [...new Set(values)].map(value => [
          value,
          1 + values.filter(candidate => candidate > value).length,
        ]),
      ))
    }

    const failures: string[] = []
    for (const entry of pokedex) {
      const rankings = rankingsBySpecies.get(entry.species)
      if (!rankings) {
        failures.push(`${entry.species}: missing ranking record`)
        continue
      }
      for (const [rankingKey, baseStatKey] of STAT_KEYS) {
        const expected = entry.base_stats
          ? expectedRanks.get(rankingKey)?.get(entry.base_stats[baseStatKey])
          : null
        if (rankings[rankingKey] !== expected) {
          failures.push(`${entry.species}.${rankingKey}: ${rankings[rankingKey]} !== ${expected}`)
        }
      }
    }

    expect(failures).toEqual([])
    expect(rankingsBySpecies.get('Onix')).toEqual({
      hp: 251,
      attack: 207,
      defense: 11,
      special_attack: 937,
      special_defense: 727,
      speed: 401,
    })
    expect(rankingsBySpecies.get('Steelix')).toEqual({
      hp: 81,
      attack: 38,
      defense: 4,
      special_attack: 812,
      special_defense: 297,
      speed: 893,
    })
  })
})
