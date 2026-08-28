#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const CANDIDATE_TAG = 'v1.0.0-rc.7'
const CANDIDATE_COMMIT = '95521c497ace395e7681aa20f4606926169aa6a3'
const ZERO_PATH = 'data/release-readiness/zero-unresolved-certification.v1.json'
const baselineCertificationPaths = [
  'data/release-readiness/version-identity-certification.v1.json',
  'data/release-readiness/upgrade-certification.v1.json',
  'data/release-readiness/backup-restore-certification.v1.json',
  'data/release-readiness/catalog-regression-certification.v1.json',
  'data/release-readiness/distribution-notices-certification.v1.json',
  'data/release-readiness/release-rehearsal-certification.v1.json',
]
const finalCandidatePaths = [
  'data/release-readiness/full-repository-validation-certification.v1.json',
  'data/release-readiness/desktop-liveplay-acceptance.v1.json',
  'data/release-readiness/mobile-liveplay-acceptance.v1.json',
  'data/release-readiness/final-restore-drill-certification.v1.json',
]
const futureRows = new Set([
  'acceptance-dossier',
  'acceptance-owner-go',
  'transition-atomic',
  'transition-released-identity',
  'transition-archive',
])
const boundaryByLimitation = new Map([
  ['trusted-role-picker', 'boundary-trusted-role-picker'],
  ['single-private-vps', 'boundary-single-vps'],
  ['chromium-only', 'boundary-chromium'],
  ['supplements-post-1.0', 'boundary-supplements'],
  ['local-hosting-deprecated', 'boundary-local-hosting'],
  ['downgrade-by-restore', 'boundary-no-downgrade'],
])

const fail = message => { throw new Error(message) }
const assert = (condition, message) => { if (!condition) fail(message) }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const currentBytes = path => readFileSync(resolve(ROOT, path))
const currentJson = path => JSON.parse(currentBytes(path).toString('utf8'))
const taggedBytes = path => execFileSync('git', ['show', `${CANDIDATE_TAG}:${path}`], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 })
const taggedJson = path => JSON.parse(taggedBytes(path).toString('utf8'))
const taggedCommit = () => execFileSync('git', ['rev-parse', `${CANDIDATE_TAG}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).trim()

function collectGateRows(target, artifact, authority) {
  assert(Array.isArray(artifact.gateRows), `${authority} has no gate rows.`)
  for (const row of artifact.gateRows) {
    assert(typeof row.id === 'string' && typeof row.state === 'string', `${authority} has an invalid gate row.`)
    const previous = target.get(row.id)
    if (previous) assert(previous.state === row.state, `${row.id} has conflicting states ${previous.state} and ${row.state}.`)
    else target.set(row.id, { state: row.state, authority })
  }
}

function verifySourceEvidence(zero) {
  assert(Array.isArray(zero.sourceEvidence) && zero.sourceEvidence.length >= 10, 'Zero-unresolved source evidence is incomplete.')
  const seen = new Set()
  for (const source of zero.sourceEvidence) {
    assert(!seen.has(`${source.ref}:${source.path}`), `Duplicate zero-unresolved source evidence: ${source.path}.`)
    seen.add(`${source.ref}:${source.path}`)
    const bytes = source.ref === CANDIDATE_TAG ? taggedBytes(source.path) : source.ref === 'post-tag-acceptance' ? currentBytes(source.path) : null
    assert(bytes, `Unsupported zero-unresolved source ref: ${source.ref}.`)
    assert(sha256(bytes) === source.sha256, `Zero-unresolved source drift: ${source.ref}:${source.path}.`)
  }
}

function main() {
  assert(taggedCommit() === CANDIDATE_COMMIT, 'Zero-unresolved candidate tag commit drifted.')
  const rubric = taggedJson('data/release-readiness/release-gate-rubric.v1.json')
  const limitations = taggedJson('data/release-readiness/known-limitations.v1.json')
  const zero = currentJson(ZERO_PATH)
  assert(zero.ticket === 'P13-081' && zero.status === 'Certified', 'Zero-unresolved certification is not final.')
  assert(zero.identity?.tag === CANDIDATE_TAG && zero.identity?.commit === CANDIDATE_COMMIT, 'Zero-unresolved candidate identity drifted.')
  verifySourceEvidence(zero)

  const observed = new Map()
  for (const path of baselineCertificationPaths) collectGateRows(observed, taggedJson(path), `${CANDIDATE_TAG}:${path}`)
  for (const path of finalCandidatePaths) collectGateRows(observed, currentJson(path), path)
  assert(limitations.status === 'OWNER_ACCEPTED_FROZEN' && limitations.rows.length === 6, 'Known-limitations register is not the frozen six-row owner-accepted set.')
  for (const limitation of limitations.rows) {
    const rubricId = boundaryByLimitation.get(limitation.id)
    assert(rubricId, `Unmapped known limitation: ${limitation.id}.`)
    observed.set(rubricId, { state: 'Documented boundary', authority: `${CANDIDATE_TAG}:data/release-readiness/known-limitations.v1.json` })
  }
  collectGateRows(observed, zero, ZERO_PATH)

  const rubricRows = new Map(rubric.rows.map(row => [row.id, row]))
  assert(rubricRows.size === 67, `Expected 67 release rubric rows, found ${rubricRows.size}.`)
  const expectedSwept = [...rubricRows.keys()].filter(id => !futureRows.has(id))
  assert(expectedSwept.length === 62, `Expected 62 pre-dossier rubric rows, found ${expectedSwept.length}.`)
  for (const id of expectedSwept) {
    const row = observed.get(id)
    assert(row, `Release rubric row is unresolved: ${id}.`)
    const rubricRow = rubricRows.get(id)
    assert(row.state !== 'Blocked', `Release rubric row is Blocked: ${id}.`)
    assert(rubricRow.allowedFinalStates.includes(row.state), `${id} closed as disallowed state ${row.state}.`)
    if (row.state === 'Documented boundary') assert([...boundaryByLimitation.values()].includes(id), `Unregistered documented boundary: ${id}.`)
  }
  const unexpected = [...observed.keys()].filter(id => !rubricRows.has(id))
  assert(unexpected.length === 0, `Unknown release rubric rows: ${unexpected.join(', ')}.`)
  assert(futureRows.size === 5 && [...futureRows].every(id => rubricRows.has(id) && !observed.has(id)), 'Future owner/transition rows are blurred into the pre-dossier sweep.')

  const mechanics = taggedJson('data/release-readiness/mechanics-registry-finality.v1.json')
  assert(mechanics.status === 'Certified', 'Mechanics finality is not certified.')
  assert(mechanics.totals.registeredRows === 2457 && mechanics.totals.finalRows === 2457, 'Mechanics finality is not 2457/2457.')
  for (const key of ['blockedRows', 'deferredRows', 'definitionMissingRows', 'visibleWithReasonCoreRows']) {
    assert(mechanics.totals[key] === 0, `Mechanics finality has nonzero ${key}.`)
  }

  const deferred = taggedJson('data/deferred-closure/closure-inventory.v1.json')
  assert(deferred.status === 'final-acceptance' && deferred.counts.finalRows === 29, 'Deferred Mechanics Closure finality drifted.')
  assert(deferred.counts.nonFinalRows === 0 && deferred.counts.blockedRows === 0 && deferred.counts.unregisteredRows === 0, 'Deferred Mechanics Closure contains unresolved rows.')
  const toolkit = taggedJson('data/gm-campaign-toolkit/footprint-finality.v1.json')
  assert(toolkit.status === 'accepted-final' && toolkit.rows.length === 40, 'GM Campaign Toolkit footprint finality drifted.')
  assert(toolkit.rows.every(row => toolkit.completionStates.includes(row.implementationState)), 'GM Campaign Toolkit contains a Pending or Blocked footprint row.')
  assert(toolkit.rows.every(row => row.implementationState === row.targetState), 'GM Campaign Toolkit footprint has target-state drift.')

  const distribution = taggedJson('data/release-readiness/distribution-notices-certification.v1.json')
  const licensing = taggedJson('data/release-readiness/licensing-notice-disposition.v1.json')
  const dependencies = taggedJson('data/release-readiness/dependency-license-report.v1.json')
  const media = taggedJson('data/release-readiness/media-asset-inventory.v1.json')
  assert(distribution.evidence.unresolvedFamilies === 0 && distribution.evidence.privateOrSecretFindings === 0 && distribution.evidence.unknownProvenanceMedia === 0, 'Distribution/licensing certification contains unresolved findings.')
  assert(licensing.status === 'OWNER_APPROVED_AND_IMPLEMENTED' && licensing.legalClearanceClaimed === false, 'Licensing disposition is missing or overclaims legal clearance.')
  assert(licensing.recommendations.find(row => row.number === 5)?.decision === 'DECLINED_OWNER_ACCEPTED_RISK', 'Recommendation 5 is not explicitly owner-accepted risk.')
  assert(licensing.acceptedRisk?.affectedFiles === 1460 && licensing.acceptedRisk?.noticeCuresRisk === false, 'Recommendation-5 risk record drifted.')
  assert(dependencies.summary.unknownEntries === 0 && dependencies.summary.potentiallyIncompatibleCopyleftEntries === 0, 'Dependency inventory contains unresolved entries.')
  assert(media.summary.unclassifiedMediaFiles === 0 && media.summary.ambiguousMediaFiles === 0 && media.summary.unknownProvenanceFiles === 0, 'Media inventory contains unresolved classification/provenance entries.')
  assert(media.summary.potentialBlockerFiles === 1460 && media.families.some(row => row.ownerDisposition === 'RETAIN_OWNER_ACCEPTED_RISK_RECOMMENDATION_5'), 'Accepted media risk was omitted rather than dispositioned.')

  const upgrade = taggedJson('data/release-readiness/upgrade-certification.v1.json')
  assert(upgrade.status === 'Certified' && upgrade.matrix.historicalHeadsPassed === 55 && upgrade.matrix.historicalHeads === 55, 'Historical migration matrix is unresolved.')
  assert(upgrade.matrix.integrityFailures === 0 && upgrade.matrix.foreignKeyViolations === 0, 'Migration matrix contains integrity failures.')
  assert(Object.values(upgrade.rejectionCorpus).every(value => value === 'passed'), 'Migration rejection corpus is unresolved.')
  assert(upgrade.jsonEraImport.minimalAndRepresentativePassed === true && upgrade.jsonEraImport.documentarySourceReads === false, 'JSON-era migration certification is unresolved.')

  const quality = currentJson(finalCandidatePaths[0])
  const desktop = currentJson(finalCandidatePaths[1])
  const mobile = currentJson(finalCandidatePaths[2])
  const restore = currentJson(finalCandidatePaths[3])
  assert(quality.results.vitestTestsFailed === 0 && quality.results.playwrightTestsFailed === 0 && quality.results.productionBuild === 'passed', 'Final candidate validation contains failures.')
  assert(desktop.journey.criticalUsabilityDefects === 0 && desktop.journey.seriousOrCriticalAccessibilityDefects === 0, 'Desktop acceptance contains critical usability/accessibility findings.')
  assert(mobile.journey.criticalUsabilityDefects === 0 && mobile.journey.seriousOrCriticalAccessibilityDefects === 0, 'Mobile acceptance contains critical usability/accessibility findings.')
  assert(restore.v55RestoreThenUpgrade.manualRepairSteps === 0 && restore.freshHostRestoreRestart.manualRepairSteps === 0, 'Final restore drill contains manual repair.')

  const expectedSummary = {
    releaseRubricRows: 67,
    sweptRubricRows: 62,
    sequencedFutureRows: 5,
    blockedRubricRows: 0,
    mechanicsRows: 2457,
    mechanicsFinalRows: 2457,
    blockedMechanicsRows: 0,
    deferredMechanicsRows: 0,
    definitionMissingRows: 0,
    visibleWithReasonCoreRows: 0,
    licensingUnresolvedFamilies: 0,
    migrationUnresolvedRows: 0,
    criticalUsabilityDefects: 0,
    ownerAcceptedRiskRows: 1,
  }
  for (const [key, value] of Object.entries(expectedSummary)) assert(zero.summary?.[key] === value, `Zero-unresolved summary ${key} drifted.`)
  assert(zero.gateRows?.length === 1 && zero.gateRows[0]?.id === 'acceptance-zero-unresolved' && zero.gateRows[0]?.state === 'Certified', 'Zero-unresolved acceptance row drifted.')
  assert(zero.finalAssertions?.zeroRule7Findings === true && zero.finalAssertions?.ownerGoNoGoNotAutomated === true, 'Zero-unresolved final assertions drifted.')

  process.stdout.write('Zero-unresolved gate passed: 62/62 due rubric rows final, 2457/2457 mechanics rows final, 0 blocked/deferred/definition-missing/visible-core/licensing/migration/critical-usability findings; 1 owner-accepted risk remains explicit; 5 future rows remain sequence-gated.\n')
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
