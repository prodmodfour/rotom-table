import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

interface MigrationRow {
  ticket: string
  capability: string
  workspaceOwners: string[]
  legacyOwners: string[]
  productionBoundary: string
  status: string
}
interface MigrationManifest {
  schemaVersion: number
  workspaceRoute: string
  workshopRoute: string
  tacticalBoundary: string
  rows: MigrationRow[]
  allowedTacticalDependencies: string[]
  forbiddenWorkspaceDependencies: string[]
}

const root = process.cwd()
const manifestPath = join(root, 'data/encounter-workspace/legacy-migration.v1.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as MigrationManifest
const failures: string[] = []
const requireCondition = (condition: boolean, message: string): void => {
  if (!condition) failures.push(message)
}
const filesUnder = (directory: string): string[] => readdirSync(directory).flatMap((entry) => {
  const path = join(directory, entry)
  return statSync(path).isDirectory() ? filesUnder(path) : [path]
})

requireCondition(manifest.schemaVersion === 1, 'legacy migration manifest schemaVersion must be 1')
requireCondition(manifest.rows.length === 4, 'legacy migration manifest must contain EUX-086 through EUX-089')
for (const ticket of ['EUX-086', 'EUX-087', 'EUX-088', 'EUX-089']) {
  const row = manifest.rows.find(value => value.ticket === ticket)
  requireCondition(Boolean(row), `${ticket} migration row is missing`)
  requireCondition(row?.status === 'migrated', `${ticket} must be migrated`)
  requireCondition(Boolean(row?.productionBoundary.trim()), `${ticket} production boundary is missing`)
}

const workspaceFiles = [
  join(root, manifest.workspaceRoute),
  ...filesUnder(join(root, 'src/components/encounter/workspace')),
]
for (const file of workspaceFiles) {
  const text = readFileSync(file, 'utf8')
  for (const dependency of manifest.forbiddenWorkspaceDependencies) {
    requireCondition(!text.includes(`from '~/components/map/${dependency}.vue'`)
      && !text.includes(`from '~/components/isometric/${dependency}.vue'`),
    `${relative(root, file)} imports forbidden map-first dependency ${dependency}`)
  }
}

const workshop = readFileSync(join(root, manifest.workshopRoute), 'utf8')
requireCondition(workshop.includes(':legacy-live-play-chrome="false"'), 'Battlefield Workshop must disable map-first live-play chrome')
requireCondition(workshop.includes(':context-menu-secondary-only="true"'), 'Battlefield context menu must remain secondary-only')
requireCondition(workshop.includes('Open encounter cockpit'), 'Battlefield Workshop must expose the primary cockpit route')
const tactical = readFileSync(join(root, manifest.tacticalBoundary), 'utf8')
requireCondition(tactical.includes('encounterLens'), 'Tactical lens must retain the bounded existing-renderer route')
requireCondition(tactical.includes('<iframe'), 'Tactical lens must retain the existing renderer iframe boundary')

if (failures.length > 0) {
  console.error(`Encounter legacy dependency check failed (${failures.length})`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
}
else console.log('Encounter legacy dependency check passed.')
