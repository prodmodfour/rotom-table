#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const DOSSIER_PATH = 'data/release-readiness/acceptance-dossier.v1.json'
const CANDIDATE_TAG = 'v1.0.0-rc.7'
const CANDIDATE = {
  version: '1.0.0-rc.7',
  storageSchemaVersion: 56,
  commit: '95521c497ace395e7681aa20f4606926169aa6a3',
  tree: 'ed6592a3351544a61e4c2ce585d6fabbb635f9ed',
  tag: CANDIDATE_TAG,
  annotatedTagObject: 'fb12d418373d3dd9823b0257d7a6c0fd2d149435',
}
const expectedCertifications = new Map([
  ['data/release-readiness/phase-1-acceptance.v1.json', 'Certified'],
  ['data/release-readiness/version-identity-certification.v1.json', 'Certified'],
  ['data/release-readiness/upgrade-certification.v1.json', 'Certified'],
  ['data/release-readiness/backup-restore-certification.v1.json', 'Certified'],
  ['data/release-readiness/catalog-regression-certification.v1.json', 'Certified'],
  ['data/release-readiness/repository-presentation-certification.v1.json', 'Certified'],
  ['data/release-readiness/deployment-instruction-certification.v1.json', 'Repaired'],
  ['data/release-readiness/distribution-notices-certification.v1.json', 'Certified'],
  ['data/release-readiness/release-command-certification.v1.json', 'Certified'],
  ['data/release-readiness/built-artifact-audit-certification.v1.json', 'Certified'],
  ['data/release-readiness/clean-host-install-certification.v1.json', 'Repaired'],
  ['data/release-readiness/release-rehearsal-certification.v1.json', 'Certified'],
  ['data/release-readiness/full-repository-validation-certification.v1.json', 'Certified'],
  ['data/release-readiness/desktop-liveplay-acceptance.v1.json', 'Certified'],
  ['data/release-readiness/mobile-liveplay-acceptance.v1.json', 'Certified'],
  ['data/release-readiness/final-restore-drill-certification.v1.json', 'Certified'],
  ['data/release-readiness/zero-unresolved-certification.v1.json', 'Certified'],
])
const postTagCertifications = new Set([
  'data/release-readiness/full-repository-validation-certification.v1.json',
  'data/release-readiness/desktop-liveplay-acceptance.v1.json',
  'data/release-readiness/mobile-liveplay-acceptance.v1.json',
  'data/release-readiness/final-restore-drill-certification.v1.json',
  'data/release-readiness/zero-unresolved-certification.v1.json',
])
const expectedEvidence = new Set([
  'data/release-readiness/canonical-census.v1.json',
  'data/release-readiness/mechanics-registry-finality.v1.json',
  'data/release-readiness/release-golden-replay-report.v1.json',
  'data/release-readiness/release-privacy-report.v1.json',
  'data/release-readiness/release-performance-report.v1.json',
  'data/release-readiness/distribution-manifest.v1.json',
  'data/release-readiness/dependency-license-report.v1.json',
  'data/release-readiness/media-asset-inventory.v1.json',
  'data/release-readiness/tracked-tree-inventory.v1.json',
  'data/release-readiness/version-mints.v1.json',
  'CHANGELOG.md',
  'docs/releases/1.0.0.md',
  'docs/release/releasing.md',
])

const fail = message => { throw new Error(message) }
const assert = (condition, message) => { if (!condition) fail(message) }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const currentBytes = path => readFileSync(resolve(ROOT, path))
const candidateBytes = path => execFileSync('git', ['show', `${CANDIDATE_TAG}:${path}`], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 })
const sourceBytes = source => source.ref === CANDIDATE_TAG ? candidateBytes(source.path) : source.ref === 'post-tag-acceptance' ? currentBytes(source.path) : fail(`Unsupported dossier source ref: ${source.ref}.`)
const sourceJson = source => JSON.parse(sourceBytes(source).toString('utf8'))

function verifyBoundRows(rows, expectedPaths, label) {
  assert(Array.isArray(rows) && rows.length === expectedPaths.size, `${label} must contain exactly ${expectedPaths.size} rows.`)
  const seen = new Set()
  for (const row of rows) {
    assert(expectedPaths.has(row.path), `${label} contains unexpected path ${row.path}.`)
    assert(!seen.has(row.path), `${label} repeats ${row.path}.`)
    seen.add(row.path)
    assert(sha256(sourceBytes(row)) === row.sha256, `${label} hash drift: ${row.ref}:${row.path}.`)
  }
}

function main() {
  const schema = JSON.parse(currentBytes('data/release-readiness/schemas/dossier.schema.v1.json').toString('utf8'))
  const dossier = JSON.parse(currentBytes(DOSSIER_PATH).toString('utf8'))
  for (const required of schema.required) assert(Object.hasOwn(dossier, required), `Acceptance dossier lacks required field ${required}.`)
  assert(dossier.schemaVersion === 1 && dossier.status === 'READY_FOR_OWNER_REVIEW', 'Acceptance dossier is not ready for owner review.')
  for (const [key, expected] of Object.entries(CANDIDATE)) assert(dossier.candidate?.[key] === expected, `Acceptance dossier candidate ${key} drifted.`)
  assert(dossier.candidate.tagPublished === false, 'Acceptance dossier falsely claims candidate tag publication.')
  assert(execFileSync('git', ['rev-parse', `${CANDIDATE_TAG}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).trim() === CANDIDATE.commit, 'Dossier candidate tag moved.')

  verifyBoundRows(dossier.certifications, new Set(expectedCertifications.keys()), 'Dossier certifications')
  for (const row of dossier.certifications) {
    const expectedStatus = expectedCertifications.get(row.path)
    assert(row.status === expectedStatus, `Dossier status drift for ${row.path}.`)
    assert(row.ref === (postTagCertifications.has(row.path) ? 'post-tag-acceptance' : CANDIDATE_TAG), `Dossier source ref drift for ${row.path}.`)
    const certification = sourceJson(row)
    assert(certification.status === expectedStatus, `Bound certification status drift for ${row.path}.`)
  }
  verifyBoundRows(dossier.evidence, expectedEvidence, 'Dossier evidence')
  assert(dossier.evidence.every(row => row.ref === CANDIDATE_TAG), 'Baseline dossier evidence must be bound to the immutable candidate tag.')

  const dispositions = new Map(dossier.dispositions.map(row => [row.id, row]))
  assert(dispositions.size === 5 && dossier.dispositions.length === 5, 'Dossier must contain exactly five reviewed disposition rows.')
  const expectedDispositions = new Map([
    ['documentary-trees', 'OWNER_APPROVED_APPLIED'],
    ['licensing-and-notices', 'OWNER_APPROVED_AND_IMPLEMENTED'],
    ['known-limitations', 'OWNER_ACCEPTED_FROZEN'],
    ['repository-metadata', 'APPLIED'],
    ['recommendation-5-retained-trainer-profiles', 'DECLINED_OWNER_ACCEPTED_RISK'],
  ])
  for (const [id, status] of expectedDispositions) {
    const row = dispositions.get(id)
    assert(row?.status === status, `Dossier disposition ${id} drifted.`)
    assert(row.ref === CANDIDATE_TAG && sha256(sourceBytes(row)) === row.sha256, `Dossier disposition evidence drift: ${id}.`)
  }
  const licensing = sourceJson(dispositions.get('licensing-and-notices'))
  assert(licensing.legalClearanceClaimed === false, 'Dossier licensing disposition overclaims legal clearance.')
  assert(licensing.recommendations.find(row => row.number === 5)?.decision === 'DECLINED_OWNER_ACCEPTED_RISK', 'Dossier obscures recommendation-5 risk acceptance.')
  const risk = dispositions.get('recommendation-5-retained-trainer-profiles')
  assert(risk.affectedFiles === 1460 && risk.noticeCuresRisk === false, 'Dossier accepted-risk facts drifted.')
  const limitations = sourceJson(dispositions.get('known-limitations'))
  assert(limitations.rows.length === 6 && limitations.status === 'OWNER_ACCEPTED_FROZEN', 'Dossier known-limitations disposition drifted.')

  const gate = dossier.gateOutcome
  assert(gate.releaseRubricRows === 67 && gate.rowsFinalBeforeOwnerReview === 63, 'Dossier rubric totals drifted.')
  assert(gate.certified === 54 && gate.approved === 2 && gate.repaired === 1 && gate.documentedBoundary === 6 && gate.blocked === 0, 'Dossier final-state census drifted.')
  assert(gate.futureOwnerAndTransitionRows === 4, 'Dossier future row count drifted.')
  assert(JSON.stringify(gate.futureRows) === JSON.stringify(['acceptance-owner-go', 'transition-atomic', 'transition-released-identity', 'transition-archive']), 'Dossier future sequence drifted.')
  assert(dossier.gateRows?.length === 1 && dossier.gateRows[0]?.id === 'acceptance-dossier' && dossier.gateRows[0]?.state === 'Certified', 'Dossier rubric row is not Certified.')

  assert(dossier.ownerReview?.decision === 'PENDING_OWNER_GO_NO_GO' && dossier.ownerReview?.automationMayDecide === false, 'Dossier does not preserve the owner go/no-go gate.')
  assert(dossier.ownerReview?.releaseTransactionsAuthorized === 0, 'Dossier authorizes a release transaction before owner go.')
  assert(dossier.releaseTransactionPlan?.authorized === false && dossier.releaseTransactionPlan?.tagMutationAllowed === false, 'Dossier release transaction is prematurely authorized or permits tag mutation.')
  assert(dossier.releaseTransactionPlan?.steps?.length === 8, 'Dossier atomic release transaction plan is incomplete.')
  assert(dossier.validation?.finalCandidateEvidence === 'passed' && dossier.validation?.zeroUnresolved === 'passed', 'Dossier dependency validation drifted.')
  assert(dossier.validation?.focusedCheckerTests?.filesPassed === 2 && dossier.validation?.focusedCheckerTests?.testsPassed === 6 && dossier.validation?.focusedCheckerTests?.testsFailed === 0, 'Dossier focused-checker test result drifted.')
  assert(dossier.validation?.targetedLintErrors === 0, 'Dossier targeted lint result drifted.')
  const aggregate = dossier.validation?.aggregateReleaseReadiness
  assert(aggregate?.command === 'npm run check:release-readiness' && aggregate?.recordedExitStatus === 0 && aggregate?.tracked === false, 'Dossier aggregate release-readiness result drifted.')
  assert(aggregate?.operatorLocalLogPath?.startsWith('.pi/logs/release-acceptance/') && /^[a-f0-9]{64}$/u.test(aggregate?.operatorLocalLogSha256), 'Dossier aggregate log binding is invalid.')
  const aggregateLog = resolve(ROOT, aggregate.operatorLocalLogPath)
  if (existsSync(aggregateLog)) assert(sha256(readFileSync(aggregateLog)) === aggregate.operatorLocalLogSha256, 'Dossier aggregate operator-local log drifted.')
  assert(dossier.finalAssertions?.zeroUnresolvedRule7Findings === true, 'Dossier lacks the zero-unresolved assertion.')
  assert(dossier.finalAssertions?.finalReleaseNotClaimed === true && dossier.finalAssertions?.ownerDecisionPending === true && dossier.finalAssertions?.atomicTransactionUnauthorized === true, 'Dossier blurs candidate review into final release.')

  const zeroOutput = execFileSync(process.execPath, ['scripts/release-readiness/check-zero-unresolved.mjs'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const candidateOutput = execFileSync(process.execPath, ['scripts/release-readiness/check-final-candidate-evidence.mjs'], { cwd: ROOT, encoding: 'utf8' }).trim()
  assert(zeroOutput.startsWith('Zero-unresolved gate passed:'), 'Dossier zero-unresolved dependency did not pass.')
  assert(candidateOutput.startsWith('Final candidate evidence passed:'), 'Dossier candidate-evidence dependency did not pass.')

  process.stdout.write(`Acceptance dossier passed: ${dossier.certifications.length} certifications, ${dossier.evidence.length} direct evidence bindings, ${dossier.dispositions.length} dispositions, 63/63 due rubric rows final, zero Blocked; owner go/no-go remains pending and authorizes 0 transactions.\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
