#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { lstat, open, readFile, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const reportPath = path.join(repositoryRoot, 'data/release-readiness/private-artifact-audit.v1.json')

const retainedEncounterFixtures = new Set([
  'encounter_tables/README.md',
  'encounter_tables/spire-city/streets.json',
  'encounter_tables/thickerby_vale/cave.json',
  'encounter_tables/thickerby_vale/forest.json',
  'encounter_tables/thickerby_vale/riverbank.json',
])

const ignoredPathProbes = [
  '.env',
  '.env.local',
  '.env.production',
  '.playwright-release/trace.zip',
  '.pi/artifacts/mockup.png',
  '.pi/logs/session.jsonl',
  '.pi/refactor-loop.lock/state.json',
  'backups/campaign.tar.gz',
  'campaign/rotom-table.sqlite',
  'campaigns/table/rotom-table.sqlite-wal',
  'data/group-inventories/default.json',
  'data/live-play-ops/ops.json',
  'data/maps/private-map.json',
  'data/player-profiles/player.json',
  'data/reference-overrides/pokedex.json',
  'data/sessions/session.json',
  'data/sheets/private-sheet.json',
  'data/shops/private-shop.json',
  'data/trainers/private-trainer.json',
  'encounter_tables/private/current.json',
  'env/production.local',
  'id_ed25519',
  'logs/server.log',
  'playwright-report/index.html',
  'private.key',
  'private.pem',
  'release-evidence/dossier.json',
  'run/server.pid',
  'test-results/results.json',
]

const trackedExceptionProbes = [
  '.env.example',
  '.env.vps.example',
  '.pi/ui-mockup-style.md',
  'data/sheets/examples/abra.json',
  ...retainedEncounterFixtures,
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function gitPaths(...arguments_) {
  const raw = execFileSync('git', [...arguments_, '-z'], { cwd: repositoryRoot }).toString('utf8')
  return [...new Set(raw.split('\0').filter(Boolean))].sort()
}

async function existingDistributionCandidatePaths() {
  const candidates = gitPaths('ls-files', '--cached', '--others', '--exclude-standard')
  const existing = []
  for (const repositoryPath of candidates) {
    try {
      const stats = await lstat(path.join(repositoryRoot, repositoryPath))
      if (stats.isFile() || stats.isSymbolicLink()) existing.push(repositoryPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return existing
}

function isForbiddenPrivatePath(repositoryPath) {
  if (/^(?:campaign|campaigns|backups|logs|run|release-evidence|playwright-report|test-results)\//.test(repositoryPath)) return true
  if (/^\.playwright-[^/]+\//.test(repositoryPath)) return true
  if (/^\.pi\/(?:logs|artifacts|refactor-loop\.lock)\//.test(repositoryPath)) return true
  if (/^\.env(?:\.|$)/.test(repositoryPath) && !['.env.example', '.env.vps.example'].includes(repositoryPath)) return true
  if (/(?:^|\/)(?:id_rsa|id_ed25519)$/.test(repositoryPath)) return true
  if (/\.(?:sqlite|sqlite-wal|sqlite-shm|db|db-wal|db-shm|pem|key|p12|pfx)$/.test(repositoryPath)) return true
  if (/^data\/(?:maps|player-profiles|reference-overrides|sessions|live-play-ops|group-inventories|shops|trainers)\//.test(repositoryPath)) return true
  if (repositoryPath.startsWith('data/sheets/') && !repositoryPath.startsWith('data/sheets/examples/')) return true
  if (repositoryPath.startsWith('encounter_tables/') && !retainedEncounterFixtures.has(repositoryPath)) return true
  return false
}

function isIgnored(repositoryPath) {
  const result = spawnSync('git', ['check-ignore', '--quiet', '--no-index', '--', repositoryPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  if (result.status === 0) return true
  if (result.status === 1) return false
  throw new Error(`git check-ignore failed for ${repositoryPath}: ${result.stderr.trim()}`)
}

async function hasSqliteHeader(repositoryPath) {
  const absolutePath = path.join(repositoryRoot, repositoryPath)
  let handle
  try {
    handle = await open(absolutePath, 'r')
    const header = Buffer.alloc(16)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    return bytesRead === 16 && header.toString('ascii') === 'SQLite format 3\0'
  } catch (error) {
    if (error?.code === 'EISDIR') return false
    throw error
  } finally {
    if (handle) await handle.close()
  }
}

function runRegisteredShellCheck(script) {
  const result = spawnSync('bash', [script], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
  if (result.status !== 0) {
    throw new Error(`${script} failed:\n${result.stdout}\n${result.stderr}`)
  }
}

async function buildReport() {
  const candidates = await existingDistributionCandidatePaths()
  const forbiddenPaths = candidates.filter(isForbiddenPrivatePath)
  assert(forbiddenPaths.length === 0, `Private/generated distribution paths found: ${forbiddenPaths.join(', ')}`)

  const sqlitePayloads = []
  for (const repositoryPath of candidates) {
    if (await hasSqliteHeader(repositoryPath)) sqlitePayloads.push(repositoryPath)
  }
  assert(sqlitePayloads.length === 0, `SQLite payloads found under non-database names: ${sqlitePayloads.join(', ')}`)

  const failedIgnoredProbes = ignoredPathProbes.filter((repositoryPath) => !isIgnored(repositoryPath))
  assert(failedIgnoredProbes.length === 0, `Required private paths are not ignored: ${failedIgnoredProbes.join(', ')}`)

  const ignoredTrackedExceptions = trackedExceptionProbes.filter((repositoryPath) => isIgnored(repositoryPath))
  assert(ignoredTrackedExceptions.length === 0, `Reviewed tracked exceptions are ignored: ${ignoredTrackedExceptions.join(', ')}`)

  for (const prunedPath of ['pokesheet.pdf', 'notepad/first_batch_moves.md']) {
    assert(!candidates.includes(prunedPath), `Owner-pruned path returned: ${prunedPath}`)
  }

  runRegisteredShellCheck('scripts/check-no-generated-private-files.sh')
  runRegisteredShellCheck('scripts/check-no-secrets.sh')

  const hygieneDocument = await readFile(path.join(repositoryRoot, 'docs/release/source-tree-hygiene.md'), 'utf8')
  for (const requiredPhrase of ['ROTOM_CAMPAIGN_ROOT', 'scripts/check-no-secrets.sh', 'Git history as disclosed']) {
    assert(hygieneDocument.includes(requiredPhrase), `Clean-clone hygiene document omits: ${requiredPhrase}`)
  }

  const gitignore = await readFile(path.join(repositoryRoot, '.gitignore'))
  return {
    artifact: 'release-private-artifact-audit',
    schemaVersion: 1,
    auditId: 'p13-private-artifact-and-ignore-audit-v1',
    releaseVersion: '1.0.0-rc.1',
    status: 'Certified',
    distributionCandidatePaths: candidates.length,
    gitignore: {
      path: '.gitignore',
      sha256: sha256(gitignore),
      ignoredPrivatePathProbes: ignoredPathProbes.length,
      failedIgnoredPrivatePathProbes: 0,
      reviewedTrackedExceptionProbes: trackedExceptionProbes.length,
      accidentallyIgnoredTrackedExceptions: 0,
    },
    scans: {
      forbiddenPrivateOrGeneratedPaths: 0,
      disguisedSqlitePayloads: 0,
      obviousSecrets: 0,
      forbiddenSensitiveFilenames: 0,
      ownerPrunedPathsPresent: 0,
    },
    retainedExceptions: {
      environmentTemplates: ['.env.example', '.env.vps.example'],
      generatedSheetExamples: 'data/sheets/examples/',
      legacyEncounterFixtures: [...retainedEncounterFixtures].sort(),
      screenshots: 'docs/screenshots/ (synthetic and separately hash-bound)',
    },
    commands: [
      'bash scripts/check-no-generated-private-files.sh',
      'bash scripts/check-no-secrets.sh',
      'npm run check:release-readiness:private-artifacts',
    ],
    cleanCloneHygiene: 'docs/release/source-tree-hygiene.md',
  }
}

async function main() {
  const write = process.argv.includes('--write')
  const report = await buildReport()
  const rendered = `${JSON.stringify(report, null, 2)}\n`

  if (write) {
    await writeFile(reportPath, rendered)
    console.log(`Wrote ${path.relative(repositoryRoot, reportPath)} (${report.distributionCandidatePaths} candidate paths).`)
    return
  }

  const current = await readFile(reportPath, 'utf8')
  assert(current === rendered, 'Private-artifact audit drifted; run npm run generate:release-readiness:private-artifacts.')
  console.log(`Private-artifact audit passed: ${report.distributionCandidatePaths} candidate paths, ${report.gitignore.ignoredPrivatePathProbes} ignore probes, zero private/secret findings.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
