#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import process from 'node:process'
import packageMetadata from '../../package.json' with { type: 'json' }

const ROOT = resolve(import.meta.dirname, '../..')
const OUTPUT_ROOT = resolve(ROOT, '.output')
const EVIDENCE_ROOT = resolve(ROOT, 'release-evidence')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const posix = value => value.split(sep).join('/')
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const fail = message => { throw new Error(message) }

function readJson(name) {
  const path = resolve(EVIDENCE_ROOT, name)
  if (!existsSync(path)) fail(`Release evidence file is absent: release-evidence/${name}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function outputFiles(directory) {
  const files = []
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = resolve(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push({ path: posix(relative(directory, absolute)), absolute })
      else fail(`Unsupported output entry while checking release evidence: ${posix(relative(directory, absolute))}`)
    }
  }
  visit(directory)
  return files
}

function parseChecksums(source) {
  const rows = source.trimEnd().split('\n').map(line => {
    const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u)
    if (!match) fail(`Malformed release checksum row: ${line}`)
    return { sha256: match[1], path: match[2] }
  })
  const paths = rows.map(row => row.path)
  if (new Set(paths).size !== paths.length) fail('Release checksums contain duplicate output paths.')
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort((a, b) => a.localeCompare(b)))) fail('Release checksum rows are not sorted.')
  return rows
}

function main() {
  if (process.argv.length !== 2) fail('Release evidence check accepts no arguments.')
  if (!existsSync(OUTPUT_ROOT)) fail('Release build output is absent.')
  const expectedTag = `v${packageMetadata.version}`
  const expectedFiles = ['artifact-audit.json', 'checksums.sha256', 'gate-summary.json', 'provenance.json']
  const rootFiles = readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name !== 'release-bundle-manifest.json')
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))
  if (JSON.stringify(rootFiles) !== JSON.stringify(expectedFiles)) fail(`Release evidence bundle has unexpected or missing files: ${rootFiles.join(', ')}`)

  const manifest = readJson('release-bundle-manifest.json')
  const provenance = readJson('provenance.json')
  const gateSummary = readJson('gate-summary.json')
  const audit = readJson('artifact-audit.json')
  const checksumsPath = resolve(EVIDENCE_ROOT, 'checksums.sha256')
  const checksumSource = readFileSync(checksumsPath, 'utf8')
  const checksumRows = parseChecksums(checksumSource)

  if (manifest.status !== 'complete' || manifest.version !== packageMetadata.version || manifest.tag !== expectedTag) fail('Release bundle identity is incomplete or disagrees with package.json.')
  if (JSON.stringify(manifest.evidence.map(row => row.path)) !== JSON.stringify(expectedFiles.map(name => `release-evidence/${name}`))) {
    fail('Release bundle manifest does not bind the exact deterministic evidence set.')
  }
  for (const row of manifest.evidence) {
    const path = resolve(ROOT, row.path)
    const bytes = readFileSync(path)
    if (bytes.length !== row.size || sha256(bytes) !== row.sha256) fail(`Release evidence hash drift: ${row.path}`)
    if ((statSync(path).mode & 0o777) !== 0o640) fail(`Release evidence permissions are too broad: ${row.path}`)
  }
  if ((statSync(resolve(EVIDENCE_ROOT, 'release-bundle-manifest.json')).mode & 0o777) !== 0o640) fail('Release bundle manifest permissions are too broad.')

  const head = git(['rev-parse', 'HEAD'])
  if (manifest.commit !== head || provenance.source?.commit !== head || gateSummary.identity?.commit !== head || audit.identity?.commit !== head) {
    fail('Release evidence commit identity disagrees with HEAD.')
  }
  if (git(['cat-file', '-t', expectedTag]) !== 'tag' || git(['rev-list', '-n', '1', expectedTag]) !== head) fail(`${expectedTag} is not an annotated tag at HEAD.`)
  if ([provenance.source?.tag, gateSummary.identity?.tag, audit.identity?.tag].some(tag => tag !== expectedTag)) fail('Release evidence tag identity disagrees.')
  if ([provenance.version, gateSummary.identity?.version, audit.identity?.version].some(version => version !== packageMetadata.version)) fail('Release evidence version identity disagrees.')

  const output = outputFiles(OUTPUT_ROOT)
  if (output.length !== checksumRows.length) fail('Release checksum count disagrees with the built output.')
  const checksums = new Map(checksumRows.map(row => [row.path, row.sha256]))
  for (const file of output) if (sha256(readFileSync(file.absolute)) !== checksums.get(file.path)) fail(`Release output checksum drift: ${file.path}`)
  const checksumManifestSha256 = sha256(checksumSource)
  if (provenance.build?.checksumManifestSha256 !== checksumManifestSha256 || audit.output?.checksumManifestSha256 !== checksumManifestSha256) {
    fail('Provenance or artifact audit disagrees with the checksum manifest.')
  }
  if (provenance.build?.outputFileCount !== output.length || audit.output?.fileCount !== output.length) fail('Release output file-count evidence disagrees.')

  if (gateSummary.status !== 'passed' || !gateSummary.commands?.length || gateSummary.commands.some(row => row.status !== 'passed' || row.bounded !== true)) {
    fail('Release bounded-gate summary is not wholly passed.')
  }
  for (const binding of gateSummary.sourceBindings ?? []) {
    const bytes = readFileSync(resolve(ROOT, binding.path))
    if (sha256(bytes) !== binding.sha256) fail(`Release gate source binding drift: ${binding.path}`)
  }
  if (!gateSummary.sourceBindings?.some(row => row.path === 'docs/releases/1.0.0.md')) fail('Release gate summary omits release notes.')
  if (!gateSummary.sourceBindings?.some(row => row.path === 'CHANGELOG.md')) fail('Release gate summary omits the changelog.')

  if (audit.status !== 'clean' || Object.values(audit.scans ?? {}).some(value => value !== 0)) fail('Built-artifact audit contains a finding.')
  if (audit.documentaryBoundary?.runtimeDependence !== false || audit.runtimeDependencies?.packageInstances < 1) fail('Built-artifact documentary/dependency audit is incomplete.')
  if (provenance.environmentPosture?.campaignMaterialIncluded !== false || provenance.environmentPosture?.secretsIncluded !== false || provenance.environmentPosture?.documentaryRuntimeSourcesIncluded !== false) {
    fail('Build provenance privacy posture is not fail-closed.')
  }
  if (manifest.deterministicInputs?.noWallClockFields !== true || /(?:generatedAt|completedAt|timestamp)/u.test(JSON.stringify(manifest))) {
    fail('Release bundle manifest introduced a wall-clock field.')
  }

  process.stdout.write(`Release evidence verified for ${expectedTag}: ${output.length} output files, ${manifest.evidence.length} deterministic evidence files, zero artifact-audit findings.\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
