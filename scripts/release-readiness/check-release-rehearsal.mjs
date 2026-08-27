#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const ARTIFACT_PATH = resolve(ROOT, 'data/release-readiness/release-rehearsal-certification.v1.json')
const SCHEMA_PATH = resolve(ROOT, 'data/release-readiness/schemas/rehearsal.schema.v1.json')
const RUBRIC_PATH = resolve(ROOT, 'data/release-readiness/release-gate-rubric.v1.json')
const EVIDENCE_ROOT = resolve(ROOT, 'release-evidence')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const gitBytes = (commit, path) => execFileSync('git', ['show', `${commit}:${path}`], { cwd: ROOT })
const fail = message => { throw new Error(message) }
const assert = (condition, message) => { if (!condition) fail(message) }

function verifySourceEvidence(rows) {
  assert(Array.isArray(rows) && rows.length >= 4, 'Rehearsal certification has insufficient drift-bound source evidence.')
  const paths = rows.map(row => row.path)
  assert(new Set(paths).size === paths.length, 'Rehearsal source evidence contains duplicate paths.')
  for (const row of rows) {
    const path = resolve(ROOT, row.path)
    assert(existsSync(path), `Rehearsal source evidence is absent: ${row.path}`)
    assert(sha256(readFileSync(path)) === row.sha256, `Rehearsal source evidence drift: ${row.path}`)
  }
}

function verifyOperatorLocalEvidence(artifact) {
  if (!existsSync(EVIDENCE_ROOT)) return false
  const expectedRows = artifact.evidence.releaseCommand.files
  const actualNames = readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))
  const expectedNames = expectedRows.map(row => row.path.replace('release-evidence/', '')).sort((a, b) => a.localeCompare(b))
  assert(JSON.stringify(actualNames) === JSON.stringify(expectedNames), 'Operator-local release evidence file set disagrees with the certification.')
  assert((statSync(EVIDENCE_ROOT).mode & 0o777) === 0o750, 'Operator-local release evidence directory is not exact mode 0750.')
  for (const row of expectedRows) {
    const path = resolve(ROOT, row.path)
    const bytes = readFileSync(path)
    assert(bytes.length === row.size && sha256(bytes) === row.sha256, `Operator-local rehearsal evidence drift: ${row.path}`)
    assert((statSync(path).mode & 0o777) === 0o640, `Operator-local rehearsal evidence mode drift: ${row.path}`)
  }
  const manifest = readJson(resolve(EVIDENCE_ROOT, 'release-bundle-manifest.json'))
  const provenance = readJson(resolve(EVIDENCE_ROOT, 'provenance.json'))
  const audit = readJson(resolve(EVIDENCE_ROOT, 'artifact-audit.json'))
  const summary = readJson(resolve(EVIDENCE_ROOT, 'gate-summary.json'))
  assert(manifest.status === 'complete' && audit.status === 'clean' && summary.status === 'passed', 'Operator-local release evidence is not wholly passed.')
  assert([manifest.version, provenance.version, audit.identity?.version, summary.identity?.version].every(value => value === artifact.identity.version), 'Operator-local evidence version disagrees with the rehearsal certification.')
  assert([manifest.commit, provenance.source?.commit, audit.identity?.commit, summary.identity?.commit].every(value => value === artifact.identity.commit), 'Operator-local evidence commit disagrees with the rehearsal certification.')
  assert(provenance.build?.checksumManifestSha256 === artifact.evidence.releaseCommand.checksumManifestSha256, 'Operator-local provenance checksum identity drifted.')
  return true
}

function main() {
  assert(existsSync(ARTIFACT_PATH), 'Release-rehearsal certification artifact is absent.')
  const artifact = readJson(ARTIFACT_PATH)
  const schema = readJson(SCHEMA_PATH)
  const rubric = readJson(RUBRIC_PATH)
  const packageMetadata = readJson(resolve(ROOT, 'package.json'))
  const mintLedger = readJson(resolve(ROOT, 'data/release-readiness/version-mints.v1.json'))

  assert(schema.required?.every(key => Object.hasOwn(artifact, key)), 'Release-rehearsal certification violates its required schema fields.')
  assert(artifact.artifact === 'release-rehearsal-certification' && artifact.schemaVersion === 1, 'Unexpected release-rehearsal artifact identity.')
  assert(artifact.rehearsalId === 'p13-074-v1.0.0-rc.5' && artifact.ticket === 'P13-075' && artifact.status === 'Certified', 'Release-rehearsal certification is not final.')
  assert(/^1\.0\.0-rc\.\d+$/u.test(artifact.identity.version), 'Rehearsal identity is not a valid 1.0 release candidate.')
  const rehearsalMintIndex = mintLedger.mints?.findIndex(row => row.to === artifact.identity.version) ?? -1
  const currentMintIndex = mintLedger.mints?.findIndex(row => row.to === packageMetadata.version) ?? -1
  assert(rehearsalMintIndex >= 0 && currentMintIndex >= rehearsalMintIndex, 'Current package identity is not the rehearsed candidate or an append-only minted successor.')
  assert(artifact.identity.storageSchemaVersion === 56 && artifact.identity.tag === `v${artifact.identity.version}`, 'Rehearsal tag or storage identity drifted.')
  assert(git(['cat-file', '-t', artifact.identity.tag]) === 'tag', 'Rehearsal tag is not annotated.')
  assert(git(['rev-list', '-n', '1', artifact.identity.tag]) === artifact.identity.commit, 'Rehearsal tag does not identify the certified commit.')
  assert(git(['rev-parse', `${artifact.identity.tag}^{tag}`]) === artifact.identity.annotatedTagObject, 'Rehearsal annotated-tag object drifted.')
  assert(git(['rev-parse', `${artifact.identity.commit}^{tree}`]) === artifact.identity.tree, 'Rehearsal source tree drifted.')
  assert(git(['show', '-s', '--format=%ct', artifact.identity.commit]) === artifact.identity.sourceDateEpoch, 'Rehearsal source-date authority drifted.')
  const taggedPackage = JSON.parse(gitBytes(artifact.identity.commit, 'package.json'))
  assert(taggedPackage.version === artifact.identity.version, 'Tagged package version disagrees with rehearsal identity.')

  const taggedBindings = artifact.evidence.releaseCommand.taggedSourceBindings
  assert(Array.isArray(taggedBindings) && taggedBindings.length === 6, 'Rehearsal must bind the six release-command source authorities.')
  for (const row of taggedBindings) assert(sha256(gitBytes(artifact.identity.commit, row.path)) === row.sha256, `Tagged rehearsal source drift: ${row.path}`)

  const release = artifact.evidence.releaseCommand
  assert(release.command === 'npm run release:prepare' && release.status === 'passed' && release.cleanTreeBeforeAndAfter === true, 'Full release command is not certified as clean and passed.')
  assert(release.outputFileCount === 13_629 && release.outputTotalBytes > 300_000_000, 'Rehearsal build output census is incomplete.')
  assert(release.files.length === 5 && release.files.some(row => row.path === 'release-evidence/release-bundle-manifest.json'), 'Rehearsal does not bind the exact five-file evidence bundle.')
  assert(release.files.find(row => row.path === 'release-evidence/checksums.sha256')?.sha256 === release.checksumManifestSha256, 'Checksum manifest evidence disagrees with the release record.')
  assert(release.files.find(row => row.path === 'release-evidence/release-bundle-manifest.json')?.sha256 === release.bundleManifestSha256, 'Bundle-manifest evidence disagrees with the release record.')
  assert(release.commands.length === 5 && release.commands.every(row => row.status === 'passed' && row.bounded === true), 'Rehearsal command summary is not wholly passed and bounded.')
  assert(Object.values(release.artifactAuditFindings).every(value => value === 0) && release.runtimePackageInstances === 24, 'Rehearsal artifact audit is incomplete or has a finding.')
  assert(release.fileMode === '0640' && release.directoryMode === '0750', 'Rehearsal evidence permission contract drifted.')

  const drill = artifact.evidence.upgradeRestoreDrill
  assert(drill.syntheticAuthority === true && drill.fromVersion === 55 && drill.toVersion === 56, 'Upgrade/restore drill input boundary drifted.')
  assert(JSON.stringify(drill.appliedVersions) === '[56]' && drill.beforeSha256 === drill.backupSha256 && drill.beforeSha256 === drill.restoredSha256, 'Upgrade/restore drill did not prove a byte-exact backup and restore.')
  assert(drill.afterSha256 === drill.reupgradedSha256 && drill.backupReused === true && drill.reupgradeConverged === true, 'Restore-then-upgrade did not converge.')
  assert(drill.integrity === 'passed' && drill.foreignKeyViolations === 0 && drill.auditedTables === 82 && drill.auditedJsonColumns === 126, 'Upgrade/restore integrity audit is incomplete.')

  const smoke = artifact.evidence.productionLiveplaySmoke
  assert(smoke.server.version === artifact.identity.version && smoke.server.storageSchemaVersion === 56 && smoke.server.commit === artifact.identity.commit && smoke.server.provenanceComplete === true, 'Production smoke server identity drifted.')
  for (const [name, expected] of [['desktop', [1440, 960]], ['mobile', [412, 915]]]) {
    const row = smoke[name]
    assert(row.viewport.width === expected[0] && row.viewport.height === expected[1], `${name} rehearsal viewport drifted.`)
    assert(row.browser === 'Chromium' && row.role === 'GM' && row.trustedRoleBoundaryVisible === true, `${name} trusted-table role smoke is incomplete.`)
    assert(row.settingsVersion === artifact.identity.version && row.settingsStorageSchemaVersion === 56 && row.settingsCommitPrefix === artifact.identity.commit.slice(0, 12), `${name} Settings identity drifted.`)
    assert(row.horizontalOverflowPx === 0 && row.consoleErrors === 0 && row.consoleWarnings === 0, `${name} production smoke has a presentation or console finding.`)
  }

  const expectedRows = [
    'notes-changelog', 'notes-operator', 'notes-gm-player', 'notes-limitations',
    'provenance-release-command', 'provenance-artifact-audit', 'provenance-clean-host', 'provenance-full-rehearsal',
  ]
  assert(JSON.stringify(artifact.gateRows.map(row => row.id)) === JSON.stringify(expectedRows), 'Phase 7 rehearsal gate rows are incomplete or out of order.')
  for (const row of artifact.gateRows) {
    assert(row.state === 'Certified', `Phase 7 rehearsal row is not Certified: ${row.id}`)
    assert(rubric.rows.find(candidate => candidate.id === row.id)?.allowedFinalStates?.includes(row.state), `Rubric rejects rehearsal state for ${row.id}`)
  }
  assert(artifact.privacy.campaignValuesRecorded === false && artifact.privacy.credentialsRecorded === false && artifact.privacy.privateHostsRecorded === false && artifact.privacy.screenshotsTracked === false, 'Rehearsal certification contains or claims private evidence.')
  assert(artifact.publication.tagPublished === false && artifact.publication.notesPublished === false && artifact.publication.ownerControlled === true, 'Rehearsal certification blurred the owner publication boundary.')

  verifySourceEvidence(artifact.sourceEvidence)
  const localEvidenceVerified = verifyOperatorLocalEvidence(artifact)
  console.log(`Release rehearsal certified for ${artifact.identity.tag}: ${release.outputFileCount} output files, byte-exact v55 restore/re-upgrade, desktop/mobile smokes, 8/8 Phase 7 rows; operator-local evidence ${localEvidenceVerified ? 'verified' : 'not present (hash record verified)'}.`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
