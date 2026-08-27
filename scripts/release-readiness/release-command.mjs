#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import process from 'node:process'
import packageMetadata from '../../package.json' with { type: 'json' }

const ROOT = resolve(import.meta.dirname, '../..')
const OUTPUT_ROOT = resolve(ROOT, '.output')
const BUILD_ROOT = resolve(ROOT, '.nuxt-build')
const EVIDENCE_ROOT = resolve(ROOT, 'release-evidence')
const TAG = `v${packageMetadata.version}`
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const posix = value => value.split(sep).join('/')
const fail = message => { throw new Error(message) }
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const npmVersion = () => execFileSync('npm', ['--version'], { cwd: ROOT, encoding: 'utf8' }).trim()

function run(command, args, environment = process.env) {
  const printable = [command, ...args].join(' ')
  process.stdout.write(`\n==> ${printable}\n`)
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: environment,
    stdio: 'inherit',
  })
  if (result.error) fail(`${printable} could not start: ${result.error.message}`)
  if (result.signal) fail(`${printable} terminated by signal ${result.signal}`)
  if (result.status !== 0) fail(`${printable} failed with exit code ${result.status}`)
}

function assertSafeGeneratedDirectory(directory, label) {
  const repositoryPath = posix(relative(ROOT, directory))
  if (!repositoryPath || repositoryPath.startsWith('../')) fail(`${label} must remain inside the repository.`)
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) fail(`${label} may not be a symbolic link: ${repositoryPath}`)
  try {
    execFileSync('git', ['check-ignore', '-q', repositoryPath], { cwd: ROOT })
  } catch {
    fail(`${label} must be git-ignored before release preparation: ${repositoryPath}`)
  }
}

function assertCleanTree(stage) {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'])
  if (status) fail(`Release preparation requires a clean source tree ${stage}:\n${status}`)
}

function assertAnnotatedHeadTag(commit) {
  if (git(['cat-file', '-t', TAG]) !== 'tag') fail(`${TAG} must exist as an annotated tag.`)
  if (git(['rev-list', '-n', '1', TAG]) !== commit) fail(`${TAG} must point at HEAD ${commit}.`)
  const subject = git(['for-each-ref', '--format=%(subject)', `refs/tags/${TAG}`])
  if (!subject.includes(packageMetadata.version)) fail(`${TAG} annotation must identify ${packageMetadata.version}.`)
}

function writeJson(repositoryPath, value) {
  const absolute = resolve(ROOT, repositoryPath)
  mkdirSync(resolve(absolute, '..'), { recursive: true, mode: 0o750 })
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 })
}

function regularEvidenceFiles() {
  return readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name !== 'release-bundle-manifest.json')
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

function main() {
  if (process.argv.length !== 2) fail('The release command accepts no bypass or path arguments.')
  if (process.platform !== 'linux' || process.arch !== 'x64') fail('Release preparation requires the supported Linux x86-64 platform.')
  if (Number(process.versions.node.split('.')[0]) !== 24) fail(`Release preparation requires Node 24; got ${process.version}.`)

  assertSafeGeneratedDirectory(OUTPUT_ROOT, 'Build output')
  assertSafeGeneratedDirectory(BUILD_ROOT, 'Nuxt build worktree')
  assertSafeGeneratedDirectory(EVIDENCE_ROOT, 'Release evidence directory')
  assertCleanTree('before gates')

  const commit = git(['rev-parse', 'HEAD'])
  if (!/^[0-9a-f]{40}$/u.test(commit)) fail('HEAD did not resolve to a full Git commit SHA.')
  assertAnnotatedHeadTag(commit)
  const sourceDateEpoch = git(['show', '-s', '--format=%ct', commit])
  if (!/^\d+$/u.test(sourceDateEpoch)) fail('Could not derive SOURCE_DATE_EPOCH from the release commit.')

  run('npm', ['run', 'check:release-readiness:identity', '--', '--require-tag'])
  run('npm', ['run', 'check:release-readiness'])
  assertCleanTree('after gates')

  rmSync(OUTPUT_ROOT, { recursive: true, force: true })
  rmSync(BUILD_ROOT, { recursive: true, force: true })
  rmSync(EVIDENCE_ROOT, { recursive: true, force: true })

  const buildEnvironment = {
    ...process.env,
    NODE_ENV: 'production',
    ROTOM_RELEASE_BUILD: '1',
    ROTOM_BUILD_COMMIT: commit,
    ROTOM_BUILD_TAG: TAG,
    SOURCE_DATE_EPOCH: sourceDateEpoch,
  }
  run('npm', ['run', 'build'], buildEnvironment)
  run('node', [
    'scripts/release-readiness/generate-build-evidence.mjs',
    '--release',
    '--output', '.output',
    '--evidence-dir', 'release-evidence',
  ], buildEnvironment)
  run('npm', ['run', 'release:audit-artifact'], buildEnvironment)

  const sourceBindings = [
    'package.json',
    'package-lock.json',
    'CHANGELOG.md',
    'docs/releases/1.0.0.md',
    'data/release-readiness/distribution-manifest.v1.json',
    'data/release-readiness/known-limitations.v1.json',
  ].map(path => ({ path, sha256: sha256(readFileSync(resolve(ROOT, path))) }))
  const gateSummary = {
    artifact: 'rotom-table-release-gate-summary',
    schemaVersion: 1,
    status: 'passed',
    identity: {
      version: packageMetadata.version,
      tag: TAG,
      commit,
      tree: git(['rev-parse', `${commit}^{tree}`]),
    },
    supportedBuilder: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      npm: npmVersion(),
      sourceDateEpoch,
    },
    commands: [
      { command: 'npm run check:release-readiness:identity -- --require-tag', status: 'passed', bounded: true },
      { command: 'npm run check:release-readiness', status: 'passed', bounded: true },
      { command: 'npm run build', status: 'passed', bounded: true },
      { command: 'node scripts/release-readiness/generate-build-evidence.mjs --release --output .output --evidence-dir release-evidence', status: 'passed', bounded: true },
      { command: 'npm run release:audit-artifact', status: 'passed', bounded: true },
    ],
    sourceBindings,
    privacy: {
      releaseEvidenceIgnored: true,
      campaignOrCredentialValuesRecorded: false,
      privateHostValuesRecorded: false,
    },
  }
  writeJson('release-evidence/gate-summary.json', gateSummary)

  const evidence = regularEvidenceFiles().map(name => {
    const bytes = readFileSync(resolve(EVIDENCE_ROOT, name))
    return { path: `release-evidence/${name}`, size: bytes.length, sha256: sha256(bytes) }
  })
  const bundleManifest = {
    artifact: 'rotom-table-release-evidence-bundle',
    schemaVersion: 1,
    status: 'complete',
    version: packageMetadata.version,
    tag: TAG,
    commit,
    evidence,
    deterministicInputs: {
      sourceDateEpoch,
      outputChecksums: 'release-evidence/checksums.sha256',
      noWallClockFields: true,
    },
  }
  writeJson('release-evidence/release-bundle-manifest.json', bundleManifest)
  run('node', ['scripts/release-readiness/check-release-evidence.mjs'])
  assertCleanTree('after evidence generation')

  process.stdout.write(`\nRelease evidence bundle complete for ${TAG} at ${commit}: ${evidence.length} bound files under release-evidence/.\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
