#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const paths = {
  quality: 'data/release-readiness/full-repository-validation-certification.v1.json',
  desktop: 'data/release-readiness/desktop-liveplay-acceptance.v1.json',
  mobile: 'data/release-readiness/mobile-liveplay-acceptance.v1.json',
  restore: 'data/release-readiness/final-restore-drill-certification.v1.json',
}
const EXPECTED = {
  version: '1.0.0-rc.7',
  storageSchemaVersion: 56,
  commit: '95521c497ace395e7681aa20f4606926169aa6a3',
  tree: 'ed6592a3351544a61e4c2ce585d6fabbb635f9ed',
  tag: 'v1.0.0-rc.7',
  annotatedTagObject: 'fb12d418373d3dd9823b0257d7a6c0fd2d149435',
}

const fail = message => { throw new Error(message) }
const assert = (condition, message) => { if (!condition) fail(message) }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const json = path => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'))
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const taggedBytes = (tag, path) => execFileSync('git', ['show', `${tag}:${path}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
const hashPattern = /^[a-f0-9]{64}$/u

function assertIdentity(artifact, label) {
  for (const [key, expected] of Object.entries(EXPECTED)) {
    assert(artifact.identity?.[key] === expected, `${label} identity ${key} drifted.`)
  }
  assert(artifact.status === 'Certified', `${label} is not Certified.`)
}

function assertTaggedBindings(artifact, field, label) {
  const bindings = artifact[field]
  assert(Array.isArray(bindings) && bindings.length > 0, `${label} has no tagged source bindings.`)
  const paths = new Set()
  for (const binding of bindings) {
    assert(typeof binding.path === 'string' && binding.path.length > 0, `${label} has an invalid tagged path.`)
    assert(!paths.has(binding.path), `${label} repeats tagged path ${binding.path}.`)
    paths.add(binding.path)
    assert(hashPattern.test(binding.sha256), `${label} has an invalid hash for ${binding.path}.`)
    const actual = sha256(taggedBytes(artifact.identity.tag, binding.path))
    assert(actual === binding.sha256, `${label} tagged source drift: ${binding.path}.`)
  }
}

function assertGate(artifact, id) {
  assert(artifact.gateRows?.length === 1, `${artifact.ticket} must close exactly one acceptance rubric row.`)
  const row = artifact.gateRows[0]
  assert(row.id === id && row.state === 'Certified', `${artifact.ticket} does not certify ${id}.`)
}

function assertIgnoredEvidence(evidence, label) {
  assert(evidence?.tracked === false && evidence?.privacySafe === true, `${label} local evidence posture drifted.`)
  for (const [key, value] of Object.entries(evidence)) {
    if (key.endsWith('Sha256')) assert(hashPattern.test(value), `${label} has an invalid ${key}.`)
    if (key.endsWith('Path')) assert(value.startsWith('.pi/logs/release-acceptance/'), `${label} evidence escaped the ignored release-acceptance root.`)
  }
  assert(evidence.recordedExitStatus === 0, `${label} lacks an explicit zero exit status.`)
}

function verifyOptionalFile(path, expectedHash, label) {
  const absolute = resolve(ROOT, path)
  if (!existsSync(absolute)) return false
  assert(sha256(readFileSync(absolute)) === expectedHash, `${label} local evidence hash drifted.`)
  return true
}

function verifyOptionalBrowserEvidence(artifact, label) {
  const evidence = artifact.operatorLocalEvidence
  assertIgnoredEvidence(evidence, label)
  const present = [
    verifyOptionalFile(evidence.logPath, evidence.logSha256, `${label} log`),
    verifyOptionalFile(evidence.traceManifestPath, evidence.traceManifestSha256, `${label} trace manifest`),
    verifyOptionalFile(evidence.contactSheetPath, evidence.contactSheetSha256, `${label} contact sheet`),
    verifyOptionalFile(evidence.visualReviewPath, evidence.visualReviewSha256, `${label} visual review`),
  ]
  assert(present.every(Boolean) || present.every(value => !value), `${label} local evidence is partial.`)
  if (!present.every(Boolean)) return false

  const manifestPath = resolve(ROOT, evidence.traceManifestPath)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert(manifest.traceCount === artifact.journey.tracesRetained, `${label} trace count drifted.`)
  assert(manifest.traceBytes === artifact.journey.traceBytes, `${label} trace bytes drifted.`)
  assert(manifest.traceAggregateSha256 === artifact.journey.traceAggregateSha256, `${label} trace aggregate drifted.`)
  const evidenceRoot = dirname(manifestPath)
  const lines = []
  for (const entry of manifest.traces) {
    const tracePath = resolve(evidenceRoot, entry.path)
    assert(existsSync(tracePath), `${label} trace is missing: ${entry.path}.`)
    assert(statSync(tracePath).size === entry.bytes, `${label} trace size drifted: ${entry.path}.`)
    assert(sha256(readFileSync(tracePath)) === entry.sha256, `${label} trace hash drifted: ${entry.path}.`)
    lines.push(`${entry.path}\0${entry.bytes}\0${entry.sha256}`)
  }
  assert(sha256(`${lines.join('\n')}\n`) === manifest.traceAggregateSha256, `${label} recomputed trace aggregate drifted.`)
  const review = JSON.parse(readFileSync(resolve(ROOT, evidence.visualReviewPath), 'utf8'))
  assert(review.review?.result === 'passed' && review.review?.criticalUsabilityDefects === 0, `${label} visual review is not clean.`)
  assert(review.traceCount === manifest.traceCount, `${label} visual-review trace count drifted.`)
  return true
}

function verifyOptionalQualityEvidence(artifact) {
  const evidence = artifact.operatorLocalEvidence
  assertIgnoredEvidence(evidence, 'quality')
  const logPresent = verifyOptionalFile(evidence.logPath, evidence.logSha256, 'quality log')
  const statusPresent = verifyOptionalFile(evidence.statusPath, evidence.statusSha256, 'quality status')
  assert(logPresent === statusPresent, 'Quality local evidence is partial.')
  if (statusPresent) assert(readFileSync(resolve(ROOT, evidence.statusPath), 'utf8').trim() === '0', 'Quality local status is not zero.')
  return logPresent
}

function verifyOptionalRestoreEvidence(artifact) {
  const evidence = artifact.operatorLocalEvidence
  assertIgnoredEvidence(evidence, 'restore')
  const reportPresent = verifyOptionalFile(evidence.reportPath, evidence.reportSha256, 'restore report')
  const logPresent = verifyOptionalFile(evidence.logPath, evidence.logSha256, 'restore log')
  assert(reportPresent === logPresent, 'Restore local evidence is partial.')
  if (!reportPresent) return false
  const report = JSON.parse(readFileSync(resolve(ROOT, evidence.reportPath), 'utf8'))
  assert(report.result === 'passed' && report.syntheticCampaignOnly === true, 'Restore local report is not a passing synthetic drill.')
  assert(report.candidate?.commit === EXPECTED.commit, 'Restore local report candidate drifted.')
  assert(report.v55BackupRestoreUpgrade?.byteExactRestore === true, 'Restore local report lost byte-exact v55 restore.')
  assert(report.v55BackupRestoreUpgrade?.byteExactPreUpgradeBackup === true, 'Restore local report lost byte-exact upgrade backup.')
  assert(report.freshHostBackupRestoreRestart?.productionStarts === 2, 'Restore local report did not prove two starts.')
  assert(report.freshHostBackupRestoreRestart?.mapStableAcrossRestart === true, 'Restore local report lost restart convergence.')
  return true
}

function main() {
  const artifacts = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, json(path)]))
  assert(git('cat-file', '-t', EXPECTED.tag) === 'tag', 'Final candidate tag is not annotated.')
  assert(git('rev-parse', `${EXPECTED.tag}^{tag}`) === EXPECTED.annotatedTagObject, 'Final candidate tag object drifted.')
  assert(git('rev-parse', `${EXPECTED.tag}^{commit}`) === EXPECTED.commit, 'Final candidate tag commit drifted.')
  assert(git('rev-parse', `${EXPECTED.tag}^{tree}`) === EXPECTED.tree, 'Final candidate tag tree drifted.')
  const taggedPackage = JSON.parse(taggedBytes(EXPECTED.tag, 'package.json').toString('utf8'))
  assert(taggedPackage.version === EXPECTED.version, 'Final candidate tagged package version drifted.')

  assertIdentity(artifacts.quality, 'quality')
  assertIdentity(artifacts.desktop, 'desktop')
  assertIdentity(artifacts.mobile, 'mobile')
  assertIdentity(artifacts.restore, 'restore')
  assertTaggedBindings(artifacts.quality, 'taggedSourceBindings', 'quality')
  assertTaggedBindings(artifacts.desktop, 'journeySourceBindings', 'desktop')
  assertTaggedBindings(artifacts.mobile, 'journeySourceBindings', 'mobile')
  assertTaggedBindings(artifacts.restore, 'taggedSourceBindings', 'restore')
  assertGate(artifacts.quality, 'acceptance-quality')
  assertGate(artifacts.desktop, 'acceptance-desktop')
  assertGate(artifacts.mobile, 'acceptance-mobile')
  assertGate(artifacts.restore, 'acceptance-restore')

  const quality = artifacts.quality.results
  assert(quality.recordedExitStatus === 0 && quality.qualityGate === 'passed', 'Bounded quality gate did not pass with status zero.')
  assert(quality.vitestFilesPassed === 1673 && quality.vitestTestsPassed === 11737 && quality.vitestTestsFailed === 0, 'Full Vitest result drifted.')
  assert(quality.nuxtTestFilesPassed === 2 && quality.nuxtTestsPassed === 7, 'Nuxt test result drifted.')
  assert(quality.playwrightTestsScheduled === 98 && quality.playwrightTestsPassed === 97 && quality.playwrightTestsSkipped === 1 && quality.playwrightTestsFailed === 0, 'Full Playwright result drifted.')
  assert(quality.productionBuild === 'passed' && quality.trackedTreeCleanBeforeAndAfter === true, 'Quality build or source-tree result drifted.')

  assert(artifacts.desktop.journey.testsPassed === 16 && artifacts.desktop.journey.testsFailed === 0, 'Desktop journey result drifted.')
  assert(artifacts.desktop.journey.criticalUsabilityDefects === 0 && artifacts.desktop.journey.seriousOrCriticalAccessibilityDefects === 0, 'Desktop acceptance contains a critical defect.')
  assert(artifacts.mobile.journey.testsPassed === 15 && artifacts.mobile.journey.testsFailed === 0, 'Mobile journey result drifted.')
  assert(artifacts.mobile.journey.desktopOnlyTestsExcluded === 1, 'Mobile desktop-only exclusion drifted.')
  assert(artifacts.mobile.journey.criticalUsabilityDefects === 0 && artifacts.mobile.journey.seriousOrCriticalAccessibilityDefects === 0, 'Mobile acceptance contains a critical defect.')

  const restore = artifacts.restore
  assert(restore.v55RestoreThenUpgrade.byteExactRestore === true && restore.v55RestoreThenUpgrade.byteExactPreUpgradeBackup === true, 'Restore/upgrade exactness drifted.')
  assert(restore.v55RestoreThenUpgrade.sourceSha256 === restore.v55RestoreThenUpgrade.restoredSha256, 'v55 restore is not byte exact.')
  assert(restore.v55RestoreThenUpgrade.sourceSha256 === restore.v55RestoreThenUpgrade.preUpgradeBackupSha256, 'Pre-upgrade backup is not byte exact.')
  assert(restore.v55RestoreThenUpgrade.integrity === 'passed' && restore.v55RestoreThenUpgrade.manualRepairSteps === 0, 'Restore/upgrade requires repair or failed integrity.')
  assert(restore.freshHostRestoreRestart.productionStarts === 2 && restore.freshHostRestoreRestart.mapAuthorityStableAcrossRestart === true, 'Fresh-host restart proof drifted.')
  assert(restore.freshHostRestoreRestart.auditBeforeStart === 'passed' && restore.freshHostRestoreRestart.auditAfterSecondStart === 'passed', 'Fresh-host audit drifted.')
  assert(restore.freshHostRestoreRestart.manualRepairSteps === 0, 'Fresh-host restore recorded manual repair.')

  const local = {
    quality: verifyOptionalQualityEvidence(artifacts.quality),
    desktop: verifyOptionalBrowserEvidence(artifacts.desktop, 'desktop'),
    mobile: verifyOptionalBrowserEvidence(artifacts.mobile, 'mobile'),
    restore: verifyOptionalRestoreEvidence(artifacts.restore),
  }
  const localCount = Object.values(local).filter(Boolean).length
  process.stdout.write(`Final candidate evidence passed: ${EXPECTED.tag} (${EXPECTED.commit.slice(0, 12)}), quality 11737 tests, desktop 16/16 with 16 traces, mobile 15/15 with 15 traces, exact restore/restart; ${localCount}/4 operator-local evidence sets present.\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
