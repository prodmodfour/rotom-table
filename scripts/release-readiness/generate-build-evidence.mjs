#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import packageMetadata from '../../package.json' with { type: 'json' }

const ROOT = resolve(import.meta.dirname, '../..')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const run = (command, args) => execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim()
const argValue = name => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}
const releaseMode = process.argv.includes('--release')
const checkMode = process.argv.includes('--check')
const outputRoot = resolve(ROOT, argValue('--output') ?? '.output')
const evidenceRoot = resolve(ROOT, argValue('--evidence-dir') ?? 'release-evidence')

const fail = message => { throw new Error(message) }
const posix = value => value.split(sep).join('/')
const filesUnder = root => {
  const files = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) fail(`Release output may not contain symbolic links: ${posix(relative(root, path))}`)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(path)
      else fail(`Unsupported release output entry: ${posix(relative(root, path))}`)
    }
  }
  visit(root)
  return files
}
const npmVersion = () => {
  try { return run('npm', ['--version']) } catch { return null }
}
const gitCommit = process.env.ROTOM_BUILD_COMMIT?.trim() || run('git', ['rev-parse', 'HEAD'])
const gitTag = process.env.ROTOM_BUILD_TAG?.trim() || null
const schemaSource = readFileSync(resolve(ROOT, 'server/storage/migrations.ts'), 'utf8')
const schemaMatch = schemaSource.match(/export const LATEST_STORAGE_SCHEMA_VERSION = (\d+)/)
if (!schemaMatch) fail('Could not derive storage schema version')
if (!existsSync(outputRoot) || !statSync(outputRoot).isDirectory()) fail(`Build output directory does not exist: ${outputRoot}`)
if (releaseMode) {
  if (!/^[0-9a-f]{40}$/.test(gitCommit)) fail('Release evidence requires a full Git commit SHA')
  if (gitTag !== `v${packageMetadata.version}`) fail(`Release tag must be v${packageMetadata.version}`)
}

const entries = filesUnder(outputRoot)
  .map(path => {
    const bytes = readFileSync(path)
    return {
      path: posix(relative(outputRoot, path)),
      size: bytes.length,
      sha256: sha256(bytes),
    }
  })
  .sort((a, b) => a.path.localeCompare(b.path))
if (entries.length === 0) fail('Build output is empty')
const checksumText = `${entries.map(entry => `${entry.sha256}  ${entry.path}`).join('\n')}\n`
const checksumManifestSha256 = sha256(checksumText)
const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH?.trim() || run('git', ['show', '-s', '--format=%ct', gitCommit])
const provenance = {
  artifact: 'rotom-table-build-provenance',
  schemaVersion: 1,
  version: packageMetadata.version,
  storageSchemaVersion: Number(schemaMatch[1]),
  source: {
    commit: gitCommit,
    tag: gitTag,
    tree: run('git', ['rev-parse', `${gitCommit}^{tree}`]),
  },
  builder: {
    node: process.version,
    npm: npmVersion(),
    platform: process.platform,
    architecture: process.arch,
  },
  build: {
    command: 'npm ci --include=dev && npm run build',
    sourceDateEpoch,
    outputFileCount: entries.length,
    checksumManifestSha256,
  },
  environmentPosture: {
    campaignMaterialIncluded: false,
    secretsIncluded: false,
    documentaryRuntimeSourcesIncluded: false,
    hostedWritesValueRecorded: false,
    privatePathsRecorded: false,
  },
}
const provenanceText = `${JSON.stringify(provenance, null, 2)}\n`
const expected = new Map([
  [resolve(evidenceRoot, 'checksums.sha256'), checksumText],
  [resolve(evidenceRoot, 'provenance.json'), provenanceText],
])
for (const [path, value] of expected) {
  if (checkMode) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== value) fail(`Build evidence drift: ${posix(relative(ROOT, path))}`)
  } else {
    mkdirSync(evidenceRoot, { recursive: true, mode: 0o750 })
    writeFileSync(path, value, { mode: 0o640 })
  }
}
process.stdout.write(`${checkMode ? 'Verified' : 'Generated'} ${entries.length} release build checksums (${checksumManifestSha256}) and provenance for ${packageMetadata.version}.\n`)
