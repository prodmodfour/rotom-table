#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const ARTIFACT_PATH = 'data/release-readiness/released-identity-verification.v1.json'
const BLOCKED_STATUS = 'BLOCKED_REPRODUCIBILITY_DIVERGENCE'
const VERIFIED_STATUS = 'VERIFIED'
const hashPattern = /^[a-f0-9]{64}$/u
const allowBlocked = process.argv.length === 3 && process.argv[2] === '--allow-blocked'

const fail = message => { throw new Error(message) }
const assert = (condition, message) => { if (!condition) fail(message) }
const bytes = path => readFileSync(resolve(ROOT, path))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

function verifySourceEvidence(rows) {
  assert(Array.isArray(rows) && rows.length >= 7, 'Released-identity verification has insufficient source evidence.')
  const seen = new Set()
  for (const row of rows) {
    assert(typeof row.path === 'string' && row.path.length > 0, 'Released-identity verification has an invalid source path.')
    assert(!seen.has(row.path), `Released-identity verification repeats ${row.path}.`)
    seen.add(row.path)
    assert(hashPattern.test(row.sha256), `Released-identity verification has an invalid SHA-256 for ${row.path}.`)
    assert(existsSync(resolve(ROOT, row.path)), `Released-identity source is absent: ${row.path}.`)
    assert(sha256(bytes(row.path)) === row.sha256, `Released-identity source drift: ${row.path}.`)
  }
}

function verifyOperatorEvidence(attempts) {
  assert(Array.isArray(attempts) && attempts.length >= 2, 'Released-identity verification requires at least two build attempts.')
  for (const attempt of attempts) {
    assert(attempt.admissible === true, `Build attempt ${attempt.id} is not admissible.`)
    assert(Number.isInteger(attempt.outputFiles) && attempt.outputFiles > 0, `Build attempt ${attempt.id} has an invalid file census.`)
    assert(hashPattern.test(attempt.checksumManifestSha256), `Build attempt ${attempt.id} has an invalid manifest hash.`)
    assert(attempt.evidenceFileSha256 === attempt.checksumManifestSha256, `Build attempt ${attempt.id} separates manifest and evidence hashes.`)
    const path = resolve(ROOT, attempt.evidencePath)
    if (existsSync(path)) {
      assert(sha256(readFileSync(path)) === attempt.evidenceFileSha256, `Operator evidence drift for ${attempt.id}.`)
    }
  }
}

function verifyImmutableRelease(release) {
  assert(release?.version === '1.0.0' && release.tag === 'v1.0.0', 'Blocked release identity drifted.')
  assert(release.tagMutationAllowed === false, 'Released-identity verification permits tag mutation.')
  assert(release.remotePublicationAuthorized === false && release.remotePublicationOccurred === false, 'Released-identity verification overclaims publication.')
  assert(git(['cat-file', '-t', release.tag]) === 'tag', `${release.tag} is not annotated.`)
  assert(git(['rev-parse', `${release.tag}^{commit}`]) === release.commit, `${release.tag} commit moved.`)
  assert(git(['rev-parse', `${release.tag}^{tree}`]) === release.tree, `${release.tag} tree moved.`)
  assert(git(['rev-parse', `${release.tag}^{tag}`]) === release.annotatedTagObject, `${release.tag} tag object moved.`)
}

function main() {
  if (process.argv.length > 3 || (process.argv.length === 3 && !allowBlocked)) {
    fail('Released-identity verification accepts only the diagnostic --allow-blocked argument.')
  }
  const artifact = JSON.parse(bytes(ARTIFACT_PATH).toString('utf8'))
  const packageMetadata = JSON.parse(bytes('package.json').toString('utf8'))
  const policy = JSON.parse(bytes('data/release-readiness/version-policy.v1.json').toString('utf8'))
  const qualityGate = bytes('scripts/quality-gate.sh').toString('utf8')
  assert(artifact.artifact === 'released-identity-verification' && artifact.schemaVersion === 1, 'Released-identity verification artifact identity drifted.')
  assert(artifact.ticket === 'P13-085', 'Released-identity verification ticket drifted.')
  assert([BLOCKED_STATUS, VERIFIED_STATUS].includes(artifact.status), `Unknown released-identity status: ${artifact.status}.`)
  verifyImmutableRelease(artifact.release)
  verifyOperatorEvidence(artifact.verificationAttempts)
  verifySourceEvidence(artifact.sourceEvidence)
  assert(packageMetadata.scripts?.['check:release-readiness:released-identity'] === 'node scripts/release-readiness/check-released-identity.mjs', 'Released-identity checker is not registered.')
  assert(packageMetadata.scripts?.['check:release-readiness']?.includes('check:release-readiness:released-identity'), 'Aggregate release-readiness gate omits released identity.')
  assert(qualityGate.includes('run_cmd node scripts/release-readiness/check-released-identity.mjs'), 'Full quality gate omits released identity.')
  assert(policy.rules?.finalTagDivergenceRequiresNextPatch === true && policy.rules?.checksumComparisonMayBeWeakened === false, 'Version policy weakens post-tag divergence handling.')

  if (artifact.status === BLOCKED_STATUS) {
    const hashes = artifact.verificationAttempts.map(row => row.checksumManifestSha256)
    assert(new Set(hashes).size === hashes.length, 'Blocked verification attempts do not demonstrate checksum divergence.')
    assert(artifact.comparison?.byteExact === false, 'Blocked verification falsely claims byte-exact output.')
    assert(artifact.rootCause?.confirmed === true && artifact.rootCause.runtimeMechanicsOrCanonicalDataAffected === false, 'Reproducibility root-cause disposition drifted.')
    assert(artifact.repairPreparation?.diagnosticBuilds?.byteExact === true, 'Prepared repair lacks byte-exact diagnostic rebuild proof.')
    assert(artifact.repairPreparation.diagnosticBuilds.admissibleAsReleaseAcceptance === false, 'Untagged repair diagnostics are falsely accepted as release evidence.')
    const gateSlice = artifact.boundedGateIsolation?.finalReadOnlySlice
    assert(artifact.boundedGateIsolation?.allStagesBeforeReleasedIdentityPassed === true && artifact.boundedGateIsolation?.otherUnresolvedTechnicalGates === 0, 'Pre-blocker release gates are not isolated as passing.')
    assert(gateSlice?.status === 1 && gateSlice.soleFailure === 'expected P13-085 owner patch authorization blocker', 'Released-identity blocker slice drifted.')
    assert(hashPattern.test(gateSlice.logSha256), 'Released-identity blocker log hash is invalid.')
    if (existsSync(resolve(ROOT, gateSlice.logPath))) assert(sha256(bytes(gateSlice.logPath)) === gateSlice.logSha256, 'Released-identity blocker log drifted.')
    assert(artifact.disposition?.v1_0_0MayBeRepresentedAsVerified === false, 'Blocked v1.0.0 is falsely represented as verified.')
    assert(artifact.disposition.nextPermittedVersion === '1.0.1', 'Blocked release does not require the next patch.')
    assert(artifact.disposition.ownerPatchReleaseAuthorizationRequired === true && artifact.disposition.ownerPatchReleaseAuthorizationRecorded === false, 'Patch authorization boundary drifted.')
    assert(artifact.disposition.releaseTransactionsAuthorizedRemaining === 0, 'Blocked release invents transaction authority.')
    if (!allowBlocked) fail(`P13-085 remains blocked: ${artifact.disposition.blocker}. Immutable v1.0.0 checksum manifests diverged.`)
    process.stdout.write(`Validated failed-closed P13-085 evidence: immutable v1.0.0 produced ${hashes.length} distinct checksum manifests; deterministic patch repair is prepared but untagged and unauthorized.\n`)
    return
  }

  assert(artifact.comparison?.byteExact === true, 'Verified released identity lacks byte-exact checksum reproduction.')
  assert(artifact.disposition?.ownerPatchReleaseAuthorizationRecorded === true, 'Verified successor lacks owner patch authorization.')
  process.stdout.write(`Released identity verified for ${artifact.release.tag}: exact tagged checksums reproduced.\n`)
}

try {
  main()
}
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
