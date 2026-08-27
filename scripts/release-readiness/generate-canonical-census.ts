#!/usr/bin/env -S npx vite-node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { PTU_NATURE_CHART } from '../../shared/ruleset/natures'

const ROOT = resolve(import.meta.dirname, '../..')
const OUTPUT = resolve(ROOT, 'data/release-readiness/canonical-census.v1.json')
const FILES = [
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
  'data/reference/contests.json',
] as const
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const count = (path: string, parsed: unknown): { rowCount: number; rowCountAuthority: string; sections?: Record<string, number> } => {
  if (Array.isArray(parsed)) return { rowCount: parsed.length, rowCountAuthority: 'root-array-length' }
  if (!parsed || typeof parsed !== 'object') throw new Error(`${path} must have an object or array root`)
  const object = parsed as Record<string, unknown>
  if (path.endsWith('/stat-rankings.json')) {
    if (!Array.isArray(object.pokemon)) throw new Error('stat-rankings.json pokemon must be an array')
    return { rowCount: object.pokemon.length, rowCountAuthority: 'pokemon-array-length' }
  }
  if (path.endsWith('/contests.json')) {
    const sectionNames = ['contestStats', 'contestEffects', 'variants', 'integrationRows', 'reviewedSuccessors'] as const
    const sections = Object.fromEntries(sectionNames.map(name => {
      if (!Array.isArray(object[name])) throw new Error(`contests.json ${name} must be an array`)
      return [name, object[name].length]
    }))
    return { rowCount: Object.values(sections).reduce((sum, value) => sum + value, 0), rowCountAuthority: 'reviewed-catalog-section-sum', sections }
  }
  return { rowCount: Object.keys(object).length, rowCountAuthority: 'root-record-key-count' }
}

const generated = {
  artifact: 'release-canonical-runtime-census',
  schemaVersion: 1,
  status: 'Reviewed',
  changePolicy: 'A hash or row-count change requires a reviewed successor artifact; never silently regenerate.',
  sources: FILES.map(path => {
    const bytes = readFileSync(resolve(ROOT, path))
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown
    return { path, bytes: bytes.length, sha256: sha256(bytes), ...count(path, parsed) }
  }),
  natureChart: {
    path: 'shared/ruleset/natures.ts#PTU_NATURE_CHART',
    sourcePath: 'shared/ruleset/natures.ts',
    bytes: readFileSync(resolve(ROOT, 'shared/ruleset/natures.ts')).length,
    sha256: sha256(readFileSync(resolve(ROOT, 'shared/ruleset/natures.ts'))),
    rowCount: PTU_NATURE_CHART.length,
    rowCountAuthority: 'PTU_NATURE_CHART.length',
  },
  totals: {
    canonicalJsonFiles: FILES.length,
    runtimeAuthorities: FILES.length + 1,
    rows: 0,
  },
}
generated.totals.rows = generated.sources.reduce((sum, source) => sum + source.rowCount, 0) + generated.natureChart.rowCount
const serialized = `${JSON.stringify(generated, null, 2)}\n`
if (process.argv.includes('--check')) {
  const current = readFileSync(OUTPUT, 'utf8')
  if (current !== serialized) {
    process.stderr.write('Canonical runtime census drifted. Review the authority change and generate a successor deliberately.\n')
    process.exitCode = 1
  } else {
    process.stdout.write(`Canonical census verified: ${generated.totals.runtimeAuthorities} authorities, ${generated.totals.rows} rows.\n`)
  }
} else {
  writeFileSync(OUTPUT, serialized)
  process.stdout.write(`Wrote ${OUTPUT}\n`)
}
