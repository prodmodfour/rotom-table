import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TabletopMap } from '../../src/types/map'
import { normalizeMapDocument } from '../../server/utils/mapNormalization'
import { placementToSpawned } from '../../src/utils/placement'
import {
  BENCHMARK_FIXTURE_FOLDER,
  DEFAULT_OUTPUT_DIR,
  buildBenchmarkMapFixtures,
  summarizeBenchmarkFixtures,
  writeBenchmarkMapFixtures,
} from '../../scripts/generate_benchmark_maps.mjs'

type BenchmarkMap = TabletopMap & {
  hazards: NonNullable<TabletopMap['hazards']>
  fieldEffects: Required<NonNullable<TabletopMap['fieldEffects']>>
}

describe('map rendering performance benchmark map fixture generator', () => {
  it('builds deterministic valid map documents from public example sheets', () => {
    const fixtures = buildBenchmarkMapFixtures() as BenchmarkMap[]

    expect(fixtures).toHaveLength(3)
    expect(buildBenchmarkMapFixtures()).toEqual(fixtures)
    expect(fixtures.map((fixture) => fixture.slug)).toEqual([
      'benchmark-empty-map',
      'benchmark-typical-map',
      'benchmark-stress-map',
    ])

    for (const fixture of fixtures) {
      expect(fixture.folder).toBe(BENCHMARK_FIXTURE_FOLDER)
      expect(fixture.playerVisible).toBe(false)
      expect(fixture.metadata).toMatchObject({
        benchmarkFixture: 'map-render-performance',
        privacy: 'synthetic public example data only',
      })
      expect(fixture.placements.every((placement) => placement.sheetSlug.startsWith('examples-'))).toBe(true)
      for (const placement of fixture.placements) {
        const fileName = `${placement.sheetSlug.replace(/^examples-/, '')}.json`
        const sheetPath = join(process.cwd(), 'data/sheets/examples', fileName)
        expect(existsSync(sheetPath)).toBe(true)
        const sheet = JSON.parse(readFileSync(sheetPath, 'utf8')) as CharacterSheet
        expect(sheet.slug).toBe(placement.sheetSlug)
        const spawned = placementToSpawned(placement, {
          pokemon: new Map([[sheet.slug, sheet]]),
          trainer: new Map(),
        })
        expect(spawned).not.toBeNull()
        expect((spawned?.position.x ?? 0) + (spawned?.base ?? 0)).toBeLessThanOrEqual(fixture.dimensions.x)
        expect((spawned?.position.y ?? 0) + (spawned?.clearance ?? 0)).toBeLessThanOrEqual(fixture.dimensions.y)
        expect((spawned?.position.z ?? 0) + (spawned?.base ?? 0)).toBeLessThanOrEqual(fixture.dimensions.z)
      }
      expect(new Set(fixture.placements.map((placement) => placement.id)).size).toBe(fixture.placements.length)

      expect(() => normalizeMapDocument(fixture, {
        sourceLabel: fixture.slug,
        folder: fixture.folder,
      })).not.toThrow()
    }
  })

  it('matches the empty, typical, and stress scenario sizes', () => {
    const [empty, typical, stress] = buildBenchmarkMapFixtures() as BenchmarkMap[]

    expect(empty).toMatchObject({
      dimensions: { x: 8, y: 3, z: 8 },
      placements: [],
      hazards: [],
      fieldEffects: { weather: [], terrains: [], rooms: [] },
    })

    expect(typical.dimensions).toEqual({ x: 18, y: 5, z: 14 })
    expect(typical.placements).toHaveLength(8)
    expect(typical.hazards.length).toBeGreaterThanOrEqual(5)
    expect(typical.fieldEffects.weather).toHaveLength(1)
    expect(typical.fieldEffects.terrains).toHaveLength(1)
    expect(typical.fieldEffects.rooms).toHaveLength(1)

    expect(stress.dimensions).toEqual({ x: 32, y: 8, z: 28 })
    expect(stress.voxels.length).toBeGreaterThan(typical.voxels.length)
    expect(stress.placements).toHaveLength(48)
    expect(stress.hazards.length).toBeGreaterThanOrEqual(30)
    expect(stress.fieldEffects.weather.length).toBeGreaterThanOrEqual(2)
    expect(stress.fieldEffects.terrains.length).toBeGreaterThanOrEqual(4)
    expect(stress.fieldEffects.rooms.length).toBeGreaterThanOrEqual(3)
  })

  it('summarizes and writes ignored local fixture files without overwriting by default', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'rotom-benchmark-fixtures-'))
    try {
      const summaries = summarizeBenchmarkFixtures()
      expect(summaries.map((summary) => summary.file)).toEqual([
        `${DEFAULT_OUTPUT_DIR}/benchmark-empty-map.json`,
        `${DEFAULT_OUTPUT_DIR}/benchmark-typical-map.json`,
        `${DEFAULT_OUTPUT_DIR}/benchmark-stress-map.json`,
      ])

      const writes = writeBenchmarkMapFixtures({ rootDir })
      expect(writes).toHaveLength(3)
      const first = JSON.parse(readFileSync(writes[0].filePath, 'utf8'))
      expect(first.slug).toBe('benchmark-empty-map')

      expect(() => writeBenchmarkMapFixtures({ rootDir })).toThrow(/already exist/)
      expect(writeBenchmarkMapFixtures({ rootDir, overwrite: true })).toHaveLength(3)
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
