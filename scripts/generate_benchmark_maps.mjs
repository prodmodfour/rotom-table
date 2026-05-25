#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')

export const BENCHMARK_FIXTURE_FOLDER = 'track-1-benchmarks'
export const DEFAULT_OUTPUT_DIR = `data/maps/${BENCHMARK_FIXTURE_FOLDER}`
export const BENCHMARK_FIXTURE_VERSION = 1
export const BENCHMARK_FIXTURE_TIMESTAMP = Date.UTC(2026, 0, 1, 0, 0, 0)

const FACING_DIRECTIONS = ['south-east', 'south-west', 'north-west', 'north-east']
const STRESS_SHEET_SLUGS = [
  'examples-pikachu',
  'examples-eevee',
  'examples-bulbasaur',
  'examples-charmander',
  'examples-squirtle',
  'examples-abra',
  'examples-gengar',
  'examples-machamp',
  'examples-geodude',
  'examples-zubat',
  'examples-onix',
  'examples-lapras',
  'examples-snorlax',
  'examples-aerodactyl',
  'examples-venusaur',
  'examples-blastoise',
  'examples-raichu',
  'examples-alakazam',
  'examples-dragonite',
  'examples-ditto',
  'examples-muk',
  'examples-aggron',
  'examples-skarmory',
  'examples-crobat',
]
const HAZARD_KINDS = ['spikes', 'toxic-spikes', 'sticky-web', 'stealth-rock', 'fire']

const sortByGrid = (left, right) =>
  left.y - right.y || left.z - right.z || left.x - right.x

const addVoxel = (voxels, voxel) => {
  voxels.set(`${voxel.x},${voxel.y},${voxel.z}`, voxel)
}

const fillRect = (voxels, { x0, x1, z0, z1, y, materialId, extra = {} }) => {
  for (let x = x0; x < x1; x += 1) {
    for (let z = z0; z < z1; z += 1) {
      addVoxel(voxels, { x, y, z, materialId, ...extra })
    }
  }
}

const toVoxelArray = (voxels) => Array.from(voxels.values()).sort(sortByGrid)

const fieldEffectCount = (fieldEffects) =>
  (fieldEffects.weather?.length ?? 0)
  + (fieldEffects.terrains?.length ?? 0)
  + (fieldEffects.rooms?.length ?? 0)

const placement = (prefix, index, sheetSlug, x, y, z, initiative = 10 + index) => ({
  id: `${prefix}-${String(index + 1).padStart(2, '0')}`,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y, z },
  initiative,
  facing: FACING_DIRECTIONS[index % FACING_DIRECTIONS.length],
})

const hazard = (kind, x, y, z, index) => ({
  kind,
  x,
  y,
  z,
  ...(kind === 'toxic-spikes' ? { layer: (index % 2) + 1 } : {}),
})

const baseMap = ({ slug, name, dimensions, voxels, hazards, fieldEffects, placements }) => ({
  schemaVersion: 2,
  slug,
  name,
  folder: BENCHMARK_FIXTURE_FOLDER,
  dimensions,
  groundLevelY: 0,
  playerVisible: false,
  voxels,
  hazards,
  fieldEffects,
  placements,
  lights: [],
  initiative: { activeId: placements[0]?.id ?? null, round: 1 },
  metadata: {
    benchmarkFixture: 'track-1-render-performance',
    fixtureVersion: BENCHMARK_FIXTURE_VERSION,
    privacy: 'synthetic public example data only',
    reproducibility: 'generated deterministically by scripts/generate_benchmark_maps.mjs',
  },
  createdAt: BENCHMARK_FIXTURE_TIMESTAMP,
  updatedAt: BENCHMARK_FIXTURE_TIMESTAMP,
})

const buildEmptyBenchmarkMap = () => {
  const voxels = new Map()
  fillRect(voxels, { x0: 0, x1: 8, z0: 0, z1: 8, y: 0, materialId: 'airship_floor_metal' })

  return baseMap({
    slug: 'benchmark-empty-map',
    name: 'Track 1 Benchmark - Empty Map',
    dimensions: { x: 8, y: 3, z: 8 },
    voxels: toVoxelArray(voxels),
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [],
  })
}

const buildTypicalBenchmarkMap = () => {
  const voxels = new Map()
  fillRect(voxels, { x0: 0, x1: 18, z0: 0, z1: 14, y: 0, materialId: 'meadow_grass' })
  fillRect(voxels, { x0: 0, x1: 18, z0: 6, z1: 8, y: 0, materialId: 'river_gravel' })
  fillRect(voxels, { x0: 4, x1: 7, z0: 0, z1: 14, y: 0, materialId: 'shallow_water' })
  fillRect(voxels, { x0: 10, x1: 14, z0: 3, z1: 7, y: 1, materialId: 'cave_stone' })
  fillRect(voxels, { x0: 14, x1: 16, z0: 4, z1: 10, y: 1, materialId: 'airship_wall_bulkhead' })
  for (const [x, z] of [[2, 10], [3, 10], [8, 2], [8, 3], [16, 11]]) {
    addVoxel(voxels, { x, y: 1, z, materialId: 'cave_shadow_stone' })
  }

  const placements = [
    placement('typical-token', 0, 'examples-pikachu', 2, 1, 2, 18),
    placement('typical-token', 1, 'examples-eevee', 8, 1, 4, 14),
    placement('typical-token', 2, 'examples-bulbasaur', 3, 1, 11, 12),
    placement('typical-token', 3, 'examples-charmander', 9, 1, 10, 16),
    placement('typical-token', 4, 'examples-squirtle', 12, 2, 5, 13),
    placement('typical-token', 5, 'examples-gengar', 16, 1, 2, 20),
    placement('typical-token', 6, 'examples-aerodactyl', 12, 2, 8, 8),
    placement('typical-token', 7, 'examples-snorlax', 15, 1, 12, 6),
  ]
  const hazards = [
    hazard('spikes', 1, 1, 6, 0),
    hazard('toxic-spikes', 7, 1, 7, 1),
    hazard('sticky-web', 9, 1, 3, 2),
    hazard('stealth-rock', 11, 2, 4, 3),
    hazard('fire', 15, 1, 8, 4),
    hazard('spikes', 3, 1, 12, 5),
  ]

  return baseMap({
    slug: 'benchmark-typical-map',
    name: 'Track 1 Benchmark - Typical Map',
    dimensions: { x: 18, y: 5, z: 14 },
    voxels: toVoxelArray(voxels),
    hazards,
    fieldEffects: {
      weather: [{ kind: 'rainy', rounds: null, source: 'benchmark-fixture' }],
      terrains: [{ kind: 'grassy', scope: 'field', rounds: null, source: 'benchmark-fixture' }],
      rooms: [{ kind: 'trick', rounds: 5, startsNextRound: true, source: 'benchmark-fixture' }],
    },
    placements,
  })
}

const stressSurfaceY = (x, z) => {
  if (x >= 13 && x < 19 && z >= 8 && z < 11) return 3
  if (x >= 11 && x < 21 && z >= 6 && z < 13) return 2
  if (x >= 22 && x < 30 && z >= 2 && z < 8) return 2
  return 1
}

const buildStressPlacements = () => {
  const xs = [1, 5, 9, 13, 17, 21, 25, 28]
  const zs = [1, 5, 9, 13, 17, 21]
  const placements = []
  for (const z of zs) {
    for (const x of xs) {
      const index = placements.length
      placements.push(placement(
        'stress-token',
        index,
        STRESS_SHEET_SLUGS[index % STRESS_SHEET_SLUGS.length],
        x,
        stressSurfaceY(x, z),
        z,
        5 + (index % 30),
      ))
    }
  }
  return placements
}

const buildStressHazards = () => {
  const xs = [2, 6, 10, 14, 18, 22, 26, 30]
  const zs = [3, 7, 11, 15, 19]
  const hazards = []
  for (const z of zs) {
    for (const x of xs) {
      const index = hazards.length
      hazards.push(hazard(
        HAZARD_KINDS[index % HAZARD_KINDS.length],
        x,
        stressSurfaceY(x, z),
        z,
        index,
      ))
    }
  }
  return hazards
}

const buildStressBenchmarkMap = () => {
  const voxels = new Map()
  fillRect(voxels, { x0: 0, x1: 32, z0: 0, z1: 28, y: 0, materialId: 'meadow_grass' })
  fillRect(voxels, { x0: 0, x1: 32, z0: 13, z1: 16, y: 0, materialId: 'shallow_water' })
  fillRect(voxels, { x0: 4, x1: 10, z0: 18, z1: 26, y: 0, materialId: 'mud' })
  fillRect(voxels, { x0: 11, x1: 21, z0: 6, z1: 13, y: 1, materialId: 'cave_stone' })
  fillRect(voxels, { x0: 13, x1: 19, z0: 8, z1: 11, y: 2, materialId: 'cave_shadow_stone' })
  fillRect(voxels, { x0: 22, x1: 30, z0: 2, z1: 8, y: 1, materialId: 'airship_floor_plating' })
  fillRect(voxels, { x0: 24, x1: 28, z0: 4, z1: 6, y: 2, materialId: 'reinforced_glass' })

  for (let x = 2; x < 32; x += 5) {
    for (let z = 2; z < 28; z += 6) {
      addVoxel(voxels, { x, y: 1, z, materialId: 'airship_wall_bulkhead' })
      if ((x + z) % 2 === 0) addVoxel(voxels, { x, y: 2, z, materialId: 'airship_hull_dark' })
    }
  }

  return baseMap({
    slug: 'benchmark-stress-map',
    name: 'Track 1 Benchmark - Stress Map',
    dimensions: { x: 32, y: 8, z: 28 },
    voxels: toVoxelArray(voxels),
    hazards: buildStressHazards(),
    fieldEffects: {
      weather: [
        { kind: 'sunny', rounds: null, source: 'benchmark-fixture' },
        { kind: 'sandstorm', rounds: null, source: 'benchmark-fixture' },
      ],
      terrains: [
        { kind: 'electric', scope: 'field', rounds: null, source: 'benchmark-fixture' },
        { kind: 'grassy', scope: 'field', rounds: null, source: 'benchmark-fixture' },
        { kind: 'misty', scope: 'field', rounds: null, source: 'benchmark-fixture' },
        { kind: 'psychic', scope: 'field', rounds: null, source: 'benchmark-fixture' },
      ],
      rooms: [
        { kind: 'magic', rounds: null, source: 'benchmark-fixture' },
        { kind: 'trick', rounds: 5, startsNextRound: true, source: 'benchmark-fixture' },
        { kind: 'wonder', rounds: null, source: 'benchmark-fixture' },
      ],
    },
    placements: buildStressPlacements(),
  })
}

export const buildBenchmarkMapFixtures = () => [
  buildEmptyBenchmarkMap(),
  buildTypicalBenchmarkMap(),
  buildStressBenchmarkMap(),
]

export const summarizeBenchmarkFixtures = (fixtures = buildBenchmarkMapFixtures(), outputDir = DEFAULT_OUTPUT_DIR) =>
  fixtures.map((fixture) => ({
    slug: fixture.slug,
    name: fixture.name,
    file: `${outputDir}/${fixture.slug}.json`,
    dimensions: `${fixture.dimensions.x}×${fixture.dimensions.y}×${fixture.dimensions.z}`,
    voxels: fixture.voxels.length,
    placements: fixture.placements.length,
    hazards: fixture.hazards.length,
    fieldEffects: fieldEffectCount(fixture.fieldEffects),
  }))

export const writeBenchmarkMapFixtures = ({
  rootDir = PROJECT_ROOT,
  outputDir = DEFAULT_OUTPUT_DIR,
  overwrite = false,
} = {}) => {
  const fixtures = buildBenchmarkMapFixtures()
  const outputPath = resolve(rootDir, outputDir)
  const plannedWrites = fixtures.map((fixture) => ({
    fixture,
    filePath: resolve(outputPath, `${fixture.slug}.json`),
  }))

  const existing = plannedWrites.filter(({ filePath }) => existsSync(filePath))
  if (existing.length && !overwrite) {
    const files = existing.map(({ filePath }) => filePath).join(', ')
    throw new Error(`Benchmark fixture files already exist: ${files}. Re-run with --overwrite to replace them.`)
  }

  mkdirSync(outputPath, { recursive: true })
  for (const { fixture, filePath } of plannedWrites) {
    writeFileSync(filePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  }
  return plannedWrites.map(({ fixture, filePath }) => ({ slug: fixture.slug, filePath }))
}

export const parseBenchmarkFixtureArgs = (argv) => {
  const options = { outputDir: DEFAULT_OUTPUT_DIR, overwrite: false, dryRun: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--overwrite') options.overwrite = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--output') {
      const value = argv[index + 1]
      if (!value) throw new Error('--output requires a directory')
      options.outputDir = value
      index += 1
    } else if (arg.startsWith('--output=')) {
      options.outputDir = arg.slice('--output='.length)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return options
}

const HELP = `Usage: node scripts/generate_benchmark_maps.mjs [options]\n\nGenerates deterministic Track 1 benchmark maps under the ignored local maps folder.\n\nOptions:\n  --dry-run          Print fixture summaries without writing files.\n  --overwrite        Replace existing generated fixture files.\n  --output <dir>     Output directory relative to the repo root.\n  -h, --help         Show this help.\n`

const printSummary = (summaries) => {
  console.log('Track 1 benchmark map fixtures:')
  for (const summary of summaries) {
    console.log(`- ${summary.file}: ${summary.dimensions}, ${summary.voxels} voxels, ${summary.placements} tokens, ${summary.hazards} hazards, ${summary.fieldEffects} field effects`)
  }
}

const runCli = () => {
  try {
    const options = parseBenchmarkFixtureArgs(process.argv.slice(2))
    if (options.help) {
      console.log(HELP)
      return
    }

    printSummary(summarizeBenchmarkFixtures(buildBenchmarkMapFixtures(), options.outputDir))
    if (options.dryRun) {
      console.log('Dry run only; no files were written.')
      return
    }

    const writes = writeBenchmarkMapFixtures(options)
    console.log(`Wrote ${writes.length} benchmark maps to ${options.outputDir}.`)
    console.log('Generated map files live under data/maps/, which is ignored by git for local campaign/data safety.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) runCli()
