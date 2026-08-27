#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const fixtureRoot = resolve(ROOT, 'release-evidence/artifact-audit-fixture')
const outputRoot = resolve(fixtureRoot, 'output')
const evidenceRoot = resolve(fixtureRoot, 'evidence')
const packageMetadata = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const sourceDateEpoch = execFileSync('git', ['show', '-s', '--format=%ct', commit], { cwd: ROOT, encoding: 'utf8' }).trim()
const environment = {
  ...process.env,
  ROTOM_BUILD_COMMIT: commit,
  ROTOM_BUILD_TAG: `v${packageMetadata.version}`,
  SOURCE_DATE_EPOCH: sourceDateEpoch,
}

function fail(message) {
  throw new Error(message)
}

function prepareFixture(mutator) {
  rmSync(fixtureRoot, { recursive: true, force: true })
  mkdirSync(resolve(outputRoot, 'server/node_modules/vue'), { recursive: true })
  mkdirSync(resolve(outputRoot, 'public'), { recursive: true })
  writeFileSync(resolve(outputRoot, 'server/index.mjs'), 'export default {}\n')
  writeFileSync(resolve(outputRoot, 'server/package.json'), '{"type":"module"}\n')
  writeFileSync(resolve(outputRoot, 'server/node_modules/vue/package.json'), '{"name":"vue","version":"3.5.40"}\n')
  cpSync(resolve(ROOT, 'public/THIRD_PARTY_NOTICES.txt'), resolve(outputRoot, 'public/THIRD_PARTY_NOTICES.txt'))
  mutator?.()
  execFileSync('node', [
    'scripts/release-readiness/generate-build-evidence.mjs',
    '--release',
    '--output', 'release-evidence/artifact-audit-fixture/output',
    '--evidence-dir', 'release-evidence/artifact-audit-fixture/evidence',
  ], { cwd: ROOT, env: environment, stdio: 'pipe' })
}

function runAudit(expectedFailure) {
  const result = spawnSync('node', [
    'scripts/release-readiness/audit-built-artifact.mjs',
    '--output', 'release-evidence/artifact-audit-fixture/output',
    '--evidence-dir', 'release-evidence/artifact-audit-fixture/evidence',
  ], { cwd: ROOT, env: environment, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (expectedFailure) {
    if (result.status === 0 || !output.includes(expectedFailure)) fail(`Built-artifact fixture did not fail closed with ${expectedFailure}: ${output}`)
  } else {
    if (result.status !== 0) fail(`Clean built-artifact fixture failed: ${output}`)
    const report = JSON.parse(readFileSync(resolve(evidenceRoot, 'artifact-audit.json'), 'utf8'))
    if (report.status !== 'clean' || report.runtimeDependencies.packageInstances !== 1 || Object.values(report.scans).some(value => value !== 0)) {
      fail('Clean built-artifact fixture did not produce the expected zero-finding report.')
    }
  }
}

const cases = [
  {
    id: 'campaign-database',
    expected: 'Built artifact contains forbidden paths',
    mutate: () => {
      mkdirSync(resolve(outputRoot, 'private'), { recursive: true })
      writeFileSync(resolve(outputRoot, 'private/campaign.sqlite'), 'SQLite format 3\u0000private')
    },
  },
  {
    id: 'credential',
    expected: 'Built artifact contains high-confidence private/secret material',
    mutate: () => {
      const marker = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')
      writeFileSync(resolve(outputRoot, 'server/leak.mjs'), `const key = \`${marker}\`\n`)
    },
  },
  {
    id: 'documentary-file',
    expected: 'Built artifact contains forbidden paths',
    mutate: () => {
      mkdirSync(resolve(outputRoot, 'books'), { recursive: true })
      writeFileSync(resolve(outputRoot, 'books/core.md'), 'documentary input\n')
    },
  },
  {
    id: 'unknown-runtime-dependency',
    expected: 'Built artifact contains dependencies outside the reviewed lock inventory',
    mutate: () => {
      mkdirSync(resolve(outputRoot, 'server/node_modules/private-package'), { recursive: true })
      writeFileSync(resolve(outputRoot, 'server/node_modules/private-package/package.json'), '{"name":"private-package","version":"0.0.0"}\n')
    },
  },
  {
    id: 'unreviewed-json',
    expected: 'Built artifact contains unreviewed JSON payloads',
    mutate: () => writeFileSync(resolve(outputRoot, 'public/campaign.json'), '{"private":true}\n'),
  },
  {
    id: 'browser-trace',
    expected: 'Built artifact contains forbidden paths',
    mutate: () => {
      mkdirSync(resolve(outputRoot, 'test-results'), { recursive: true })
      writeFileSync(resolve(outputRoot, 'test-results/trace.zip'), 'private trace\n')
    },
  },
]

try {
  prepareFixture()
  runAudit(null)
  for (const fixture of cases) {
    prepareFixture(fixture.mutate)
    runAudit(fixture.expected)
  }
  const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
  const certification = JSON.parse(readFileSync(resolve(ROOT, 'data/release-readiness/built-artifact-audit-certification.v1.json'), 'utf8'))
  const rubric = JSON.parse(readFileSync(resolve(ROOT, 'data/release-readiness/release-gate-rubric.v1.json'), 'utf8'))
  const releaseCommand = readFileSync(resolve(ROOT, 'scripts/release-readiness/release-command.mjs'), 'utf8')
  const auditSource = readFileSync(resolve(ROOT, 'scripts/release-readiness/audit-built-artifact.mjs'), 'utf8')
  if (packageJson.scripts?.['release:audit-artifact'] !== 'node scripts/release-readiness/audit-built-artifact.mjs') fail('Dynamic built-artifact audit command is not registered.')
  if (!packageJson.scripts?.['check:release-readiness:artifact-audit']?.includes('check-built-artifact-audit.mjs')) fail('Built-artifact audit fixture gate is not registered.')
  if (!packageJson.scripts?.['check:release-readiness']?.includes('check:release-readiness:artifact-audit')) fail('Aggregate readiness gate omits the built-artifact audit source gate.')
  if (!releaseCommand.includes("run('npm', ['run', 'release:audit-artifact'], buildEnvironment)")) fail('Release command does not bind the dynamic built-artifact audit.')
  for (const rule of ['campaign-database-or-sidecar', 'environment-file', 'private-browser-evidence', 'documentary-tree-file', 'private-key', 'unknownRuntimeDependencies', 'unexpectedJsonPayloads']) {
    if (!auditSource.includes(rule)) fail(`Built-artifact audit source omits required scan family: ${rule}`)
  }
  if (certification.ticket !== 'P13-072' || certification.status !== 'Certified') fail('Built-artifact audit certification is not final.')
  if (certification.gateRows?.length !== 1 || certification.gateRows[0].id !== 'provenance-artifact-audit' || certification.gateRows[0].state !== 'Certified') fail('Built-artifact audit certification does not close its rubric row.')
  if (!rubric.rows.find(row => row.id === 'provenance-artifact-audit')?.allowedFinalStates?.includes('Certified')) fail('Built-artifact audit rubric row no longer permits Certified.')
  if (Object.values(certification.evidence?.cleanScans ?? {}).some(value => value !== 0) || certification.evidence?.documentaryRuntimeDependence !== false || certification.evidence?.runtimeDependencyInstances < 1) fail('Built-artifact production snapshot is not clean.')
  if (certification.evidence?.fixtureCorpus?.injectedFailures !== cases.length) fail('Built-artifact certification fixture count drifted.')
  console.log(`Built-artifact audit verified: one clean fixture, ${cases.length} injected failures, and a ${certification.evidence.productionBuildSnapshot.outputFileCount}-file production snapshot.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}
