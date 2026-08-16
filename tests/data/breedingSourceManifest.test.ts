import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const MANIFEST_PATH = resolve(ROOT, 'data/breeding-automation/source-manifest.json')
const SHA256 = /^[0-9a-f]{64}$/
const GIT_BLOB = /^[0-9a-f]{40}$/
const REVIEWED_RUNTIME_SUCCESSORS = Object.freeze({
  'data/reference/moves.json': {
    bytes: 286379,
    sha256: '418d20378d61383295da0c6d4a8a3752e6ed001300c604df9fe7e3f04276089e',
    gitBlob: 'bde873c9122ab05c920a34cd7aafd78a4cb05d9f',
    entryCount: 777,
  },
  'data/reference/items.json': {
    bytes: 162053,
    sha256: '62b29a499c791d689f6efc99e04ed515a71336421352626749cf6cc7407982c8',
    gitBlob: 'f6abf6cba3e5e2cdf58d4432dae88ba6886908b9',
  },
  'data/reference/rules.json': {
    bytes: 196347,
    sha256: '94e0ec0f9a7416d807db892f501215666487357d20ab945b294a21742da6e142',
    gitBlob: 'b6db0c515133519860b79a80dac3a6e409a4a921',
    entryCount: 38,
  },
} as const)

interface FrozenSource {
  path: string
  purpose: string
  authority: string
  bytes: number
  sha256: string
  gitBlob: string
  entryCount?: number
}

interface BreedingSourceManifest {
  schemaVersion: number
  rulesetId: string
  sourceBaselineGitCommit: string
  runtimeAuthority: string[]
  runtimeSources: FrozenSource[]
  reviewedAutomationContracts: FrozenSource[]
  productAuthority: FrozenSource[]
  documentarySources: FrozenSource[]
  parserBaselines: FrozenSource[]
  excludedSourceClasses: Array<{ pattern: string, reason: string }>
  policies: Record<string, string>
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as BreedingSourceManifest

const APP_OWNED_RUNTIME_AUTHORITY = [
  'data/reference/moves.json',
  'data/reference/abilities.json',
  'data/reference/edges.json',
  'data/reference/poke-edges.json',
  'data/reference/capabilities.json',
  'data/reference/features.json',
  'data/reference/conditions.json',
  'data/reference/items.json',
  'data/reference/maneuvers.json',
  'data/reference/pokedex.json',
  'data/reference/stat-rankings.json',
  'data/reference/pokemonExperienceChart.json',
  'data/reference/rules.json',
] as const

const REQUIRED_DOCUMENTARY_SOURCES = [
  'books/markdown/core/05-pokemon.md',
  'books/markdown/pokedexes/how-to-read.md',
  'books/markdown/core/03-skills-edges-and-features.md',
  'books/markdown/errata-2.md',
  'books/markdown/errata-3.md',
] as const

const actualEntryCount = (source: FrozenSource): number => {
  const parsed = JSON.parse(readFileSync(resolve(ROOT, source.path), 'utf8')) as unknown
  if (Array.isArray(parsed)) return parsed.length
  if (!parsed || typeof parsed !== 'object') throw new Error(`${source.path} is not a JSON collection`)
  if (source.path === 'data/reference/stat-rankings.json') {
    const rows = (parsed as { pokemon?: unknown }).pokemon
    if (!Array.isArray(rows)) throw new Error(`${source.path} has no pokemon rows`)
    return rows.length
  }
  return Object.keys(parsed).length
}

describe('breeding source inventory', () => {
  it('freezes every app-owned runtime reference and excludes documentary runtime authority', () => {
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      rulesetId: 'ptu-1.05-breeding-v1',
      policies: {
        sourceDrift: 'fail-closed-until-reviewed-source-hash-bound-migration',
        unknownIdentity: 'fail-closed',
        documentarySupplementation: 'forbidden-at-runtime',
        clientAuthority: 'none',
        rollAuthority: 'server-only',
      },
    })
    expect(manifest.sourceBaselineGitCommit).toMatch(GIT_BLOB)
    expect(manifest.runtimeAuthority).toEqual(APP_OWNED_RUNTIME_AUTHORITY)
    expect(manifest.runtimeSources.map(source => source.path)).toEqual(APP_OWNED_RUNTIME_AUTHORITY)
    expect(manifest.runtimeSources.every(source => source.authority === 'app-owned-json-runtime-authority')).toBe(true)
    expect(manifest.runtimeAuthority.every(path => path.startsWith('data/reference/'))).toBe(true)
    expect(manifest.runtimeAuthority.some(path => path.startsWith('books/') || path.startsWith('ptu-data/'))).toBe(false)

    for (const requiredPath of REQUIRED_DOCUMENTARY_SOURCES) {
      expect(manifest.documentarySources.map(source => source.path)).toContain(requiredPath)
    }
    expect(manifest.documentarySources.every(source => source.authority === 'documentary-provenance-only')).toBe(true)
    expect(manifest.parserBaselines.every(source => source.authority === 'maintenance-provenance-only')).toBe(true)
    expect(manifest.excludedSourceClasses.map(source => source.pattern)).toContain('ptu-data/data/**')
    expect(manifest.excludedSourceClasses.map(source => source.pattern)).toContain('books/markdown/pokedexes/{species}.md')
  })

  it('binds every inventoried source to exact bytes, SHA-256, and Git blob values', () => {
    const sources = [
      ...manifest.runtimeSources,
      ...manifest.reviewedAutomationContracts,
      ...manifest.productAuthority,
      ...manifest.documentarySources,
      ...manifest.parserBaselines,
    ]
    expect(sources).toHaveLength(30)
    expect(new Set(sources.map(source => source.path)).size).toBe(sources.length)

    for (const source of sources) {
      const bytes = readFileSync(resolve(ROOT, source.path))
      expect(source.purpose.trim(), source.path).not.toBe('')
      expect(source.sha256, source.path).toMatch(SHA256)
      expect(source.gitBlob, source.path).toMatch(GIT_BLOB)
      const successor = REVIEWED_RUNTIME_SUCCESSORS[source.path as keyof typeof REVIEWED_RUNTIME_SUCCESSORS]
      const expected = successor ?? source
      expect(bytes.byteLength, `${source.path} byte count`).toBe(expected.bytes)
      expect(createHash('sha256').update(bytes).digest('hex'), `${source.path} SHA-256`).toBe(expected.sha256)
      expect(
        execFileSync('git', ['hash-object', source.path], { cwd: ROOT, encoding: 'utf8' }).trim(),
        `${source.path} Git blob`,
      ).toBe(expected.gitBlob)
      if (source.entryCount !== undefined) {
        expect(actualEntryCount(source), `${source.path} entry count`).toBe(
          'entryCount' in expected ? expected.entryCount : source.entryCount,
        )
      }
    }
  })
})
