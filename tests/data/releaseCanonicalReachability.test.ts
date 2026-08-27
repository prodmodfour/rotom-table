import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import census from '../../data/release-readiness/canonical-census.v1.json'
import reachability from '../../data/release-readiness/canonical-audit-reachability.v1.json'
import { PTU_NATURE_CHART } from '../../shared/ruleset/natures'

const root = resolve(import.meta.dirname, '../..')
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

describe('Plan 13 canonical runtime row reachability', () => {
  it('hashes, counts, and structurally visits every one of the 4,810 canonical rows', () => {
    expect(reachability.sources).toHaveLength(15)
    let visited = 0
    for (const source of census.sources) {
      const binding = reachability.sources.find(row => row.path === source.path)
      expect(binding?.rows, source.path).toBe(source.rowCount)
      expect(binding?.owningAudits.length, source.path).toBeGreaterThan(0)
      const bytes = readFileSync(resolve(root, source.path))
      expect(sha(bytes), source.path).toBe(source.sha256)
      const value = JSON.parse(bytes.toString('utf8')) as unknown
      let rows: unknown[]
      if (Array.isArray(value)) rows = value
      else if (source.path.endsWith('/stat-rankings.json')) rows = (value as { pokemon: unknown[] }).pokemon
      else if (source.path.endsWith('/contests.json')) {
        const catalog = value as Record<string, unknown[]>
        rows = ['contestStats', 'contestEffects', 'variants', 'integrationRows', 'reviewedSuccessors'].flatMap(key => catalog[key] ?? [])
      } else rows = Object.entries(value as Record<string, unknown>)
      expect(rows).toHaveLength(source.rowCount)
      for (const row of rows) {
        expect(row, source.path).not.toBeNull()
        expect(JSON.stringify(row).length, source.path).toBeGreaterThan(1)
        visited += 1
      }
    }
    const natureBinding = reachability.sources.find(row => row.path === census.natureChart.path)
    expect(natureBinding?.rows).toBe(PTU_NATURE_CHART.length)
    expect(natureBinding?.owningAudits.length).toBeGreaterThan(0)
    expect(sha(readFileSync(resolve(root, census.natureChart.sourcePath)))).toBe(census.natureChart.sha256)
    visited += PTU_NATURE_CHART.length
    expect(visited).toBe(reachability.totals.rows)
    expect(reachability.totals).toMatchObject({ sources: 15, rows: 4810, unreachableSources: 0, unreachableRows: 0 })
  })

  it('keeps identity-bearing whole-catalog authorities unique and contiguous', () => {
    const pokedex = JSON.parse(readFileSync(resolve(root, 'data/reference/pokedex.json'), 'utf8')) as Array<{ species: string }>
    const rankings = JSON.parse(readFileSync(resolve(root, 'data/reference/stat-rankings.json'), 'utf8')) as { pokemon: Array<{ species: string }> }
    const experience = JSON.parse(readFileSync(resolve(root, 'data/reference/pokemonExperienceChart.json'), 'utf8')) as Array<{ level: number }>
    expect(new Set(pokedex.map(row => row.species)).size).toBe(pokedex.length)
    expect(new Set(rankings.pokemon.map(row => row.species)).size).toBe(rankings.pokemon.length)
    expect(rankings.pokemon.map(row => row.species).sort()).toEqual(pokedex.map(row => row.species).sort())
    expect(experience.map(row => row.level)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1))
    expect(PTU_NATURE_CHART.map(row => row.value)).toEqual(Array.from({ length: 36 }, (_, index) => index + 1))
    expect(new Set(PTU_NATURE_CHART.map(row => row.name)).size).toBe(36)
  })
})
