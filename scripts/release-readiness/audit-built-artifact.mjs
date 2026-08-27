#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import process from 'node:process'
import packageMetadata from '../../package.json' with { type: 'json' }

const ROOT = resolve(import.meta.dirname, '../..')
const argValue = name => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}
const allowedArguments = new Set(['--output', '--evidence-dir', '--check'])
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index]
  if (!allowedArguments.has(argument)) throw new Error(`Unknown built-artifact audit argument: ${argument}`)
  if (argument !== '--check') index += 1
}

const outputRoot = resolve(ROOT, argValue('--output') ?? '.output')
const evidenceRoot = resolve(ROOT, argValue('--evidence-dir') ?? 'release-evidence')
const reportPath = resolve(evidenceRoot, 'artifact-audit.json')
const checkMode = process.argv.includes('--check')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const posix = value => value.split(sep).join('/')
const fail = message => { throw new Error(message) }

function assertInsideRoot(target, label) {
  const repositoryPath = posix(relative(ROOT, target))
  if (!repositoryPath || repositoryPath.startsWith('../')) fail(`${label} must remain inside the repository.`)
  return repositoryPath
}

function filesUnder(root) {
  const files = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = resolve(directory, entry.name)
      const repositoryPath = posix(relative(root, absolute))
      if (entry.isSymbolicLink()) fail(`Built artifact contains a symbolic link: ${repositoryPath}`)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push({ absolute, path: repositoryPath })
      else fail(`Built artifact contains an unsupported filesystem entry: ${repositoryPath}`)
    }
  }
  visit(root)
  return files
}

function parseChecksums(source) {
  const rows = source.trimEnd().split('\n').map(line => {
    const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u)
    if (!match) fail(`Malformed build checksum row: ${line}`)
    if (match[2].startsWith('/') || match[2].split('/').includes('..')) fail(`Unsafe build checksum path: ${match[2]}`)
    return { sha256: match[1], path: match[2] }
  })
  const paths = rows.map(row => row.path)
  if (new Set(paths).size !== paths.length) fail('Build checksum manifest contains duplicate paths.')
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort((a, b) => a.localeCompare(b)))) fail('Build checksum manifest paths are not deterministic.')
  return rows
}

function runtimeDependencies(files, dependencyReport) {
  const allowed = new Set(dependencyReport.npmPackages.map(row => `${row.name}@${row.version}`))
  const rows = []
  for (const file of files.filter(row => /^server\/node_modules\/.+\/package\.json$/u.test(row.path))) {
    const metadata = JSON.parse(readFileSync(file.absolute, 'utf8'))
    if (typeof metadata.name !== 'string' || typeof metadata.version !== 'string') continue
    rows.push({ name: metadata.name, version: metadata.version, path: file.path })
  }
  rows.sort((a, b) => a.path.localeCompare(b.path))
  const unknown = rows.filter(row => !allowed.has(`${row.name}@${row.version}`))
  if (unknown.length) fail(`Built artifact contains dependencies outside the reviewed lock inventory: ${unknown.map(row => `${row.name}@${row.version}`).join(', ')}`)
  return rows
}

function main() {
  assertInsideRoot(outputRoot, 'Build output')
  assertInsideRoot(evidenceRoot, 'Evidence directory')
  if (!existsSync(outputRoot) || !statSync(outputRoot).isDirectory()) fail(`Build output directory is absent: ${posix(relative(ROOT, outputRoot))}`)
  if (lstatSync(outputRoot).isSymbolicLink()) fail('Build output root may not be a symbolic link.')

  const checksumsPath = resolve(evidenceRoot, 'checksums.sha256')
  const provenancePath = resolve(evidenceRoot, 'provenance.json')
  if (!existsSync(checksumsPath) || !existsSync(provenancePath)) fail('Built-artifact audit requires generated checksums.sha256 and provenance.json.')
  const checksumSource = readFileSync(checksumsPath, 'utf8')
  const expectedRows = parseChecksums(checksumSource)
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'))
  const files = filesUnder(outputRoot)
  if (files.length !== expectedRows.length) fail(`Built output file count disagrees with checksums: ${files.length} versus ${expectedRows.length}.`)

  let totalBytes = 0
  const checksumByPath = new Map(expectedRows.map(row => [row.path, row.sha256]))
  for (const file of files) {
    const bytes = readFileSync(file.absolute)
    totalBytes += bytes.length
    if (sha256(bytes) !== checksumByPath.get(file.path)) fail(`Built output changed after checksum generation: ${file.path}`)
  }
  const checksumManifestSha256 = sha256(checksumSource)
  if (provenance.version !== packageMetadata.version) fail('Build provenance version disagrees with package.json.')
  if (provenance.source?.tag !== `v${packageMetadata.version}`) fail('Build provenance tag disagrees with package.json.')
  if (provenance.build?.outputFileCount !== files.length || provenance.build?.checksumManifestSha256 !== checksumManifestSha256) {
    fail('Build provenance output summary disagrees with the checksum manifest.')
  }

  const forbiddenPathRules = [
    ['campaign-database-or-sidecar', /(?:^|\/)[^/]*\.(?:sqlite3?|db3?|db|wal|shm)(?:$|[.-])/iu],
    ['environment-file', /(?:^|\/)\.env(?:\.|$)|(?:^|\/)[^/]+\.env$/iu],
    ['backup-or-archive', /(?:^|\/)backups?(?:\/|$)|\.(?:bak|backup|tar|tgz|zip)$/iu],
    ['private-browser-evidence', /(?:^|\/)(?:playwright-report|test-results)(?:\/|$)|(?:^|\/)trace\.zip$|\.(?:har|trace)$/iu],
    ['release-evidence-recursion', /(?:^|\/)release-evidence(?:\/|$)/u],
    ['documentary-tree-file', /^(?:books|ptu-data|encounter_tables|notepad)(?:\/|$)|^pokesheet\.pdf$/u],
  ]
  const pathFindings = []
  for (const file of files) {
    for (const [id, pattern] of forbiddenPathRules) if (pattern.test(file.path)) pathFindings.push({ id, path: file.path })
  }
  if (pathFindings.length) fail(`Built artifact contains forbidden paths: ${pathFindings.slice(0, 10).map(row => `${row.id}:${row.path}`).join(', ')}`)

  const allowedJson = /^(?:nitro\.json|server\/package\.json|server\/node_modules\/.+\/package\.json)$/u
  const unexpectedJson = files.filter(file => file.path.endsWith('.json') && !allowedJson.test(file.path)).map(file => file.path)
  if (unexpectedJson.length) fail(`Built artifact contains unreviewed JSON payloads: ${unexpectedJson.join(', ')}`)

  const textExtensions = new Set(['.mjs', '.js', '.map', '.css', '.json', '.txt', '.svg'])
  const secretPatterns = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
    ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/u],
    ['github-token', /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/u],
    ['npm-token', /\bnpm_[A-Za-z0-9]{36,}\b/u],
    ['private-home-path', /(?:^|[^\w])\/(?:home|Users)\/[A-Za-z0-9._-]+\//u],
  ]
  const contentFindings = []
  const documentaryLiteralFiles = []
  for (const file of files) {
    const extension = file.path.slice(file.path.lastIndexOf('.')).toLowerCase()
    if (!textExtensions.has(extension)) continue
    const source = readFileSync(file.absolute, 'utf8')
    for (const [id, pattern] of secretPatterns) if (pattern.test(source)) contentFindings.push({ id, path: file.path })
    if (/(?:books|ptu-data|encounter_tables|trainer_sizes)\//u.test(source)) documentaryLiteralFiles.push(file.path)
  }
  if (contentFindings.length) fail(`Built artifact contains high-confidence private/secret material: ${contentFindings.slice(0, 10).map(row => `${row.id}:${row.path}`).join(', ')}`)

  const sqliteHeaders = files.filter(file => readFileSync(file.absolute).subarray(0, 16).toString('binary') === 'SQLite format 3\u0000').map(file => file.path)
  if (sqliteHeaders.length) fail(`Built artifact contains SQLite authority: ${sqliteHeaders.join(', ')}`)

  const dependencyReportPath = resolve(ROOT, 'data/release-readiness/dependency-license-report.v1.json')
  const documentaryProofPath = resolve(ROOT, 'data/release-readiness/documentary-read-proof.v1.json')
  const distributionManifestPath = resolve(ROOT, 'data/release-readiness/distribution-manifest.v1.json')
  const dependencyReport = JSON.parse(readFileSync(dependencyReportPath, 'utf8'))
  const documentaryProof = JSON.parse(readFileSync(documentaryProofPath, 'utf8'))
  const distributionManifest = JSON.parse(readFileSync(distributionManifestPath, 'utf8'))
  if (documentaryProof.status !== 'Certified' || documentaryProof.staticViolations !== 0) fail('Production documentary-read proof is not clean.')
  if (distributionManifest.status !== 'Certified') fail('Source distribution manifest is not certified.')
  const dependencies = runtimeDependencies(files, dependencyReport)

  const noticePath = resolve(outputRoot, 'public/THIRD_PARTY_NOTICES.txt')
  if (!existsSync(noticePath)) fail('Built artifact omits public/THIRD_PARTY_NOTICES.txt.')
  const sourceNoticePath = resolve(ROOT, 'public/THIRD_PARTY_NOTICES.txt')
  if (sha256(readFileSync(noticePath)) !== sha256(readFileSync(sourceNoticePath))) fail('Built third-party notice disagrees with its reviewed source.')
  if (!existsSync(resolve(outputRoot, 'server/index.mjs'))) fail('Built artifact omits the Nitro server entry point.')

  const sourceEvidence = [
    'data/release-readiness/dependency-license-report.v1.json',
    'data/release-readiness/documentary-read-proof.v1.json',
    'data/release-readiness/distribution-manifest.v1.json',
    'public/THIRD_PARTY_NOTICES.txt',
  ].map(path => ({ path, sha256: sha256(readFileSync(resolve(ROOT, path))) }))
  const report = {
    artifact: 'rotom-table-built-artifact-audit',
    schemaVersion: 1,
    status: 'clean',
    identity: {
      version: provenance.version,
      tag: provenance.source.tag,
      commit: provenance.source.commit,
      storageSchemaVersion: provenance.storageSchemaVersion,
    },
    output: {
      fileCount: files.length,
      totalBytes,
      checksumManifestSha256,
      serverEntryPoint: 'server/index.mjs',
      thirdPartyNotice: 'public/THIRD_PARTY_NOTICES.txt',
    },
    scans: {
      forbiddenPathFindings: 0,
      secretOrPrivateContentFindings: 0,
      sqliteHeaderFindings: 0,
      unexpectedJsonPayloads: 0,
      symbolicOrSpecialFiles: 0,
      unknownRuntimeDependencies: 0,
      packagedDocumentaryTreeFiles: 0,
    },
    documentaryBoundary: {
      runtimeDependence: false,
      provenanceLiteralFiles: documentaryLiteralFiles.sort((a, b) => a.localeCompare(b)),
      explanation: 'Immutable source-path/hash labels may remain as provenance metadata; no documentary tree file is packaged and the certified production source graph has zero filesystem/process readers for documentary roots.',
      proof: 'data/release-readiness/documentary-read-proof.v1.json',
    },
    runtimeDependencies: {
      packageInstances: dependencies.length,
      reviewedLockInventory: 'data/release-readiness/dependency-license-report.v1.json',
      entries: dependencies,
    },
    sourceEvidence,
  }
  const rendered = `${JSON.stringify(report, null, 2)}\n`
  if (checkMode) {
    if (!existsSync(reportPath) || readFileSync(reportPath, 'utf8') !== rendered) fail('Built-artifact audit evidence drifted.')
  } else {
    mkdirSync(evidenceRoot, { recursive: true, mode: 0o750 })
    writeFileSync(reportPath, rendered, { mode: 0o640 })
  }
  process.stdout.write(`${checkMode ? 'Verified' : 'Recorded'} clean built artifact: ${files.length} files, ${dependencies.length} reviewed runtime packages, zero private/documentary authority.\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
