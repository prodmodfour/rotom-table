#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const ACCEPTANCE_PATH = 'data/release-readiness/final-acceptance.v1.json'
const FINAL_VERSION = '1.0.0'
const FINAL_TAG = 'v1.0.0'
const CANDIDATE = {
  version: '1.0.0-rc.7',
  commit: '95521c497ace395e7681aa20f4606926169aa6a3',
  tree: 'ed6592a3351544a61e4c2ce585d6fabbb635f9ed',
  tag: 'v1.0.0-rc.7',
  annotatedTagObject: 'fb12d418373d3dd9823b0257d7a6c0fd2d149435',
}
const hashPattern = /^[a-f0-9]{64}$/u
const allowPendingTag = process.env.ROTOM_RELEASE_TRANSACTION_PRETAG === '1'

const fail = message => { throw new Error(message) }
const assert = (condition, message) => { if (!condition) fail(message) }
const bytes = path => readFileSync(resolve(ROOT, path))
const json = path => JSON.parse(bytes(path).toString('utf8'))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const taggedBytes = path => execFileSync('git', ['show', `${FINAL_TAG}:${path}`], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 })

function tagExists(tag) {
  try {
    return execFileSync('git', ['cat-file', '-t', tag], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() === 'tag'
  } catch {
    return false
  }
}

function implementationPlanSources(directory) {
  const rows = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) rows.push(...implementationPlanSources(path))
    else if (entry.isFile() && entry.name.endsWith('_PLAN.md')) rows.push(path)
  }
  return rows
}

function verifySourceEvidence(rows) {
  assert(Array.isArray(rows) && rows.length >= 12, 'Final acceptance has insufficient source evidence.')
  const seen = new Set()
  for (const row of rows) {
    assert(typeof row.path === 'string' && row.path.length > 0, 'Final acceptance contains an invalid evidence path.')
    assert(!seen.has(row.path), `Final acceptance repeats source evidence ${row.path}.`)
    seen.add(row.path)
    assert(hashPattern.test(row.sha256), `Final acceptance has an invalid SHA-256 for ${row.path}.`)
    assert(existsSync(resolve(ROOT, row.path)), `Final acceptance source evidence is absent: ${row.path}.`)
    assert(sha256(bytes(row.path)) === row.sha256, `Final acceptance source evidence drift: ${row.path}.`)
  }
}

function verifyProductPhase() {
  const planSources = implementationPlanSources(resolve(ROOT, 'implementation-plans'))
  const phaseRows = []
  for (const path of planSources) {
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(/^`PRODUCT_PHASE: ([A-Z]+)`$/gmu)) {
      phaseRows.push({ path, phase: match[1] })
    }
  }
  const released = phaseRows.filter(row => row.phase === 'RELEASED')
  assert(released.length === 1, `PRODUCT_PHASE must transition to RELEASED exactly once; found ${released.length}.`)
  assert(released[0].path.endsWith('RELEASE_READINESS_PLAN.md'), 'The RELEASED product phase is not owned by Plan 13.')
  assert(phaseRows.every(row => ['ALPHA', 'RELEASED'].includes(row.phase)), 'An unreviewed product phase is present in a plan ledger.')
}

function verifyTag(acceptance) {
  const exists = tagExists(FINAL_TAG)
  if (!exists) {
    assert(allowPendingTag, `${FINAL_TAG} must exist as an annotated tag.`)
    return false
  }
  assert(git(['cat-file', '-t', FINAL_TAG]) === 'tag', `${FINAL_TAG} is not annotated.`)
  const releaseCommit = git(['rev-parse', `${FINAL_TAG}^{commit}`])
  execFileSync('git', ['merge-base', '--is-ancestor', releaseCommit, 'HEAD'], { cwd: ROOT })
  assert(git(['for-each-ref', '--format=%(subject)', `refs/tags/${FINAL_TAG}`]).includes(FINAL_VERSION), `${FINAL_TAG} annotation omits ${FINAL_VERSION}.`)
  const taggedPackage = JSON.parse(taggedBytes('package.json').toString('utf8'))
  assert(taggedPackage.version === FINAL_VERSION, 'Tagged package does not report 1.0.0.')
  assert(sha256(taggedBytes(ACCEPTANCE_PATH)) === sha256(bytes(ACCEPTANCE_PATH)), 'The final tag does not bind the current final acceptance record.')
  assert(taggedBytes('CHANGELOG.md').toString('utf8').includes('## [1.0.0] - 2026-08-28'), 'Tagged changelog omits the final release entry.')
  assert(taggedBytes('docs/releases/1.0.0.md').toString('utf8').includes('> **Released:** Rotom Table 1.0.0'), 'Tagged release notes retain a non-final identity.')
  assert(acceptance.releaseCommitBinding?.tagResolution === 'refs/tags/v1.0.0^{commit}', 'Final acceptance tag-resolution binding drifted.')
  return true
}

function main() {
  const acceptance = json(ACCEPTANCE_PATH)
  const schema = json('data/release-readiness/schemas/final-acceptance.schema.v1.json')
  const pkg = json('package.json')
  const lock = json('package-lock.json')
  const mints = json('data/release-readiness/version-mints.v1.json')
  const rubric = json('data/release-readiness/release-gate-rubric.v1.json')
  const dossier = json('data/release-readiness/acceptance-dossier.v1.json')
  const changelog = bytes('CHANGELOG.md').toString('utf8')
  const notes = bytes('docs/releases/1.0.0.md').toString('utf8')
  const qualityGate = bytes('scripts/quality-gate.sh').toString('utf8')

  for (const field of schema.required) assert(Object.hasOwn(acceptance, field), `Final acceptance lacks required field ${field}.`)
  assert(acceptance.schemaVersion === 1 && acceptance.acceptanceId === 'rotom-table-1.0-final-v1', 'Final acceptance identity drifted.')
  assert(acceptance.ticket === 'P13-084' && acceptance.status === 'accepted', 'Final acceptance is not accepted through P13-084.')
  assert(acceptance.version === FINAL_VERSION && acceptance.tag === FINAL_TAG && acceptance.storageSchemaVersion === 56, 'Final acceptance release identity drifted.')
  assert(acceptance.productPhase === 'released', 'Final acceptance product phase is not released.')
  assert(pkg.version === FINAL_VERSION && lock.version === FINAL_VERSION && lock.packages?.['']?.version === FINAL_VERSION, 'Package and lock do not agree on 1.0.0.')

  const finalMint = mints.mints?.at(-1)
  assert(mints.mints?.length === 8, 'Final mint history must contain exactly eight append-only transitions.')
  assert(finalMint?.sequence === 8 && finalMint.from === CANDIDATE.version && finalMint.to === FINAL_VERSION, 'The final mint transition drifted.')
  assert(finalMint.ticket === 'P13-084' && finalMint.recordedAt === '2026-08-28' && finalMint.tag === FINAL_TAG, 'The final mint authority metadata drifted.')
  assert(mints.mints.filter(row => row.to === FINAL_VERSION).length === 1, '1.0.0 was not minted exactly once.')

  for (const [key, expected] of Object.entries(CANDIDATE)) assert(acceptance.candidate?.[key] === expected, `Final acceptance candidate ${key} drifted.`)
  assert(git(['rev-parse', `${CANDIDATE.tag}^{commit}`]) === CANDIDATE.commit, 'Accepted rc.7 candidate tag moved.')
  assert(git(['rev-parse', `${CANDIDATE.tag}^{tree}`]) === CANDIDATE.tree, 'Accepted rc.7 candidate tree moved.')
  assert(git(['rev-parse', `${CANDIDATE.tag}^{tag}`]) === CANDIDATE.annotatedTagObject, 'Accepted rc.7 candidate tag object moved.')

  const owner = acceptance.ownerDecision
  assert(owner?.decision === 'GO' && owner?.automationMayDecide === false, 'Final acceptance does not record the explicit owner GO.')
  assert(owner.releaseTransactionsAuthorized === 1 && owner.releaseTransactionsConsumed === 1, 'Owner GO must authorize and consume exactly one release transaction.')
  assert(owner.remotePublicationAuthorized === false, 'Final acceptance overclaims remote publication authority.')
  assert(owner.recommendation5ResidualRiskAccepted === true && owner.legalClearanceClaimed === false, 'Final acceptance blurs the accepted licensing risk or legal-clearance boundary.')

  assert(dossier.status === 'READY_FOR_OWNER_REVIEW' && dossier.ownerReview?.releaseTransactionsAuthorized === 0, 'The immutable pre-decision dossier was rewritten as authorization.')
  assert(acceptance.dossier?.path === 'data/release-readiness/acceptance-dossier.v1.json', 'Final acceptance dossier path drifted.')
  assert(sha256(bytes(acceptance.dossier.path)) === acceptance.dossier.sha256, 'Final acceptance dossier binding drifted.')

  assert(rubric.rows.length === 67, 'Release rubric no longer contains 67 rows.')
  const expectedTransactionRows = [
    ['acceptance-owner-go', 'Approved'],
    ['transition-atomic', 'Certified'],
  ]
  assert(JSON.stringify(acceptance.gateRows?.map(row => [row.id, row.state])) === JSON.stringify(expectedTransactionRows), 'Final transaction gate rows drifted.')
  for (const row of acceptance.gateRows) {
    assert(rubric.rows.find(candidate => candidate.id === row.id)?.allowedFinalStates?.includes(row.state), `Rubric rejects final transaction state for ${row.id}.`)
  }
  assert(acceptance.gateOutcome?.rowsFinalAtReleaseTransaction === 65 && acceptance.gateOutcome?.releaseRubricRows === 67, 'Final transaction rubric census drifted.')
  assert(JSON.stringify(acceptance.gateOutcome?.sequencePendingRows) === JSON.stringify(['transition-released-identity', 'transition-archive']), 'Final transaction sequence boundary drifted.')

  assert(changelog.includes('## [1.0.0] - 2026-08-28') && !changelog.includes('Final `1.0.0` remains pending'), 'Final changelog state drifted.')
  assert(notes.includes('> **Released:** Rotom Table 1.0.0 was released on 2026-08-28') && !notes.includes('> **Release-candidate document:**'), 'Final release-note state drifted.')
  verifyProductPhase()
  verifySourceEvidence(acceptance.sourceEvidence)

  assert(pkg.scripts?.['check:release-readiness:final-acceptance'] === 'node scripts/release-readiness/check-final-acceptance.mjs', 'Final-acceptance command is not registered.')
  assert(pkg.scripts?.['check:release-readiness']?.includes('check:release-readiness:final-acceptance'), 'Aggregate release-readiness gate omits final acceptance.')
  assert(qualityGate.includes('run_cmd node scripts/release-readiness/check-final-acceptance.mjs'), 'Full quality gate omits final acceptance.')
  assert(acceptance.publication?.localTagCreated === true && acceptance.publication?.remoteTagPublished === false, 'Final acceptance blurs local release and publication.')
  assert(acceptance.releaseEvidence?.tracked === false && acceptance.releaseEvidence?.command === 'npm run release:prepare', 'Final acceptance release-evidence posture drifted.')

  const tagVerified = verifyTag(acceptance)
  process.stdout.write(`Final acceptance passed: 1.0.0 minted once, owner GO consumed once, PRODUCT_PHASE released once, 65/67 rows final at the atomic transaction; ${tagVerified ? 'immutable v1.0.0 verified' : 'annotated v1.0.0 pending preflight'}; remote publication unauthorized.\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
