#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const ARTIFACT_PATH = 'data/release-readiness/released-identity-verification.v1.json'
const PATCH_VERSION = '1.0.1'
const PATCH_TAG = `v${PATCH_VERSION}`
const PENDING_STATUS = 'PATCH_TRANSACTION_ACCEPTED_VERIFICATION_PENDING'
const VERIFIED_STATUS = 'VERIFIED'
const FAILED_RELEASE = {
  version: '1.0.0',
  tag: 'v1.0.0',
  commit: '5ef7c8741ab19c5a2b58db28d8f90fca8c61ce6a',
  tree: '1bbe48789ba2e5340510b8fa884523392b08411b',
  annotatedTagObject: '435599ad457c6e40a7491dbab618b94828e5a81d',
}
const hashPattern = /^[a-f0-9]{64}$/u
const allowPretag = process.env.ROTOM_RELEASE_TRANSACTION_PRETAG === '1'
const allowReferenceBuild = process.env.ROTOM_RELEASE_REFERENCE_BUILD === '1'

const fail = message => { throw new Error(message) }
const assert = (condition, message) => { if (!condition) fail(message) }
const bytes = path => readFileSync(resolve(ROOT, path))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

function tagExists(tag) {
  try {
    return execFileSync('git', ['cat-file', '-t', tag], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() === 'tag'
  }
  catch {
    return false
  }
}

function taggedBytes(tag, path) {
  return execFileSync('git', ['show', `${tag}:${path}`], {
    cwd: ROOT,
    maxBuffer: 128 * 1024 * 1024,
  })
}

function verifyImmutableTag(release, expected) {
  for (const [key, value] of Object.entries(expected)) assert(release?.[key] === value, `Immutable ${expected.tag} ${key} drifted.`)
  assert(release.tagMutationAllowed === false, `${expected.tag} permits tag mutation.`)
  assert(release.remotePublicationOccurred === false, `${expected.tag} falsely claims remote publication.`)
  assert(git(['cat-file', '-t', expected.tag]) === 'tag', `${expected.tag} is not annotated.`)
  assert(git(['rev-parse', `${expected.tag}^{commit}`]) === expected.commit, `${expected.tag} commit moved.`)
  assert(git(['rev-parse', `${expected.tag}^{tree}`]) === expected.tree, `${expected.tag} tree moved.`)
  assert(git(['rev-parse', `${expected.tag}^{tag}`]) === expected.annotatedTagObject, `${expected.tag} tag object moved.`)
}

function verifyFailedPredecessor(failedRelease) {
  verifyImmutableTag(failedRelease?.release, FAILED_RELEASE)
  const attempts = failedRelease?.verificationAttempts
  assert(Array.isArray(attempts) && attempts.length === 3, 'Failed v1.0.0 attempt census drifted.')
  const hashes = []
  for (const attempt of attempts) {
    assert(attempt.admissible === true && Number.isInteger(attempt.outputFiles) && attempt.outputFiles === 13629, `Failed attempt ${attempt.id} is malformed.`)
    assert(hashPattern.test(attempt.checksumManifestSha256), `Failed attempt ${attempt.id} has an invalid checksum hash.`)
    assert(attempt.evidenceFileSha256 === attempt.checksumManifestSha256, `Failed attempt ${attempt.id} separates manifest and evidence hashes.`)
    hashes.push(attempt.checksumManifestSha256)
    const path = resolve(ROOT, attempt.evidencePath)
    if (existsSync(path)) assert(sha256(readFileSync(path)) === attempt.evidenceFileSha256, `Failed-release operator evidence drift: ${attempt.id}.`)
  }
  assert(new Set(hashes).size === 3 && failedRelease.comparison?.byteExact === false, 'Immutable v1.0.0 checksum divergence is no longer preserved.')
  assert(failedRelease.rootCause?.confirmed === true && failedRelease.rootCause.runtimeMechanicsOrCanonicalDataAffected === false, 'Failed-release root-cause boundary drifted.')
}

function verifySourceEvidence(rows, patchTagPresent) {
  assert(Array.isArray(rows) && rows.length >= 15, 'Patch verification has insufficient source evidence.')
  const seen = new Set()
  for (const row of rows) {
    assert(row.ref === PATCH_TAG, `Patch source evidence lacks ${PATCH_TAG} authority: ${row.path}.`)
    assert(typeof row.path === 'string' && row.path.length > 0 && !seen.has(row.path), `Patch source evidence path is invalid or repeated: ${row.path}.`)
    seen.add(row.path)
    assert(hashPattern.test(row.sha256), `Patch source evidence has an invalid SHA-256 for ${row.path}.`)
    if (!patchTagPresent) assert(existsSync(resolve(ROOT, row.path)), `Patch pretag source path is absent: ${row.path}.`)
    const source = patchTagPresent ? taggedBytes(PATCH_TAG, row.path) : bytes(row.path)
    assert(sha256(source) === row.sha256, `Patch tagged source evidence drift: ${row.path}.`)
  }
}

function verifyPatchMint(packageMetadata, lock, mints) {
  assert(packageMetadata.version === PATCH_VERSION, `Current package is not ${PATCH_VERSION}.`)
  assert(lock.version === PATCH_VERSION && lock.packages?.['']?.version === PATCH_VERSION, 'Patch package-lock identity drifted.')
  assert(mints.mints?.length === 9, 'Patch mint history must contain nine append-only transitions.')
  const mint = mints.mints.at(-1)
  assert(mint?.sequence === 9 && mint.from === '1.0.0' && mint.to === PATCH_VERSION, 'Patch mint transition drifted.')
  assert(mint.ticket === 'P13-085' && mint.recordedAt === '2026-08-28' && mint.tag === PATCH_TAG, 'Patch mint authority metadata drifted.')
  assert(mints.mints.filter(row => row.to === PATCH_VERSION).length === 1, `${PATCH_VERSION} was not minted exactly once.`)
}

function verifyPatchTag(artifact) {
  const present = tagExists(PATCH_TAG)
  if (!present) {
    assert(allowPretag && artifact.status === PENDING_STATUS, `${PATCH_TAG} must exist as an annotated tag.`)
    return false
  }
  const commit = git(['rev-parse', `${PATCH_TAG}^{commit}`])
  const tree = git(['rev-parse', `${PATCH_TAG}^{tree}`])
  const tagObject = git(['rev-parse', `${PATCH_TAG}^{tag}`])
  assert(git(['for-each-ref', '--format=%(subject)', `refs/tags/${PATCH_TAG}`]).includes(PATCH_VERSION), `${PATCH_TAG} annotation omits ${PATCH_VERSION}.`)
  const taggedPackage = JSON.parse(taggedBytes(PATCH_TAG, 'package.json').toString('utf8'))
  assert(taggedPackage.version === PATCH_VERSION, `Tagged package does not report ${PATCH_VERSION}.`)
  const taggedArtifact = JSON.parse(taggedBytes(PATCH_TAG, ARTIFACT_PATH).toString('utf8'))
  assert(taggedArtifact.status === PENDING_STATUS && taggedArtifact.ownerPatchDecision?.decision === 'GO', `${PATCH_TAG} does not bind the owner-approved pending verification transaction.`)
  if (artifact.status === PENDING_STATUS) {
    assert(git(['rev-parse', 'HEAD']) === commit, `Pending ${PATCH_TAG} reference generation requires the tag at HEAD.`)
    if (allowReferenceBuild) assert(git(['status', '--porcelain=v1', '--untracked-files=all']) === '', 'Tagged reference generation requires a clean source tree.')
  }
  else {
    assert(artifact.patchRelease?.commit === commit && artifact.patchRelease?.tree === tree && artifact.patchRelease?.annotatedTagObject === tagObject, 'Verified patch release binding disagrees with its tag.')
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: ROOT })
  }
  return true
}

function verifyPatchAttempts(artifact) {
  const attempts = artifact.verificationAttempts
  assert(Array.isArray(attempts) && attempts.length === 2, 'Verified patch requires exactly a reference and one clean rebuild.')
  const manifestHashes = new Set()
  for (const attempt of attempts) {
    assert(attempt.admissible === true && Number.isInteger(attempt.outputFiles) && attempt.outputFiles > 0, `Patch verification attempt ${attempt.id} is malformed.`)
    assert(hashPattern.test(attempt.checksumManifestSha256) && attempt.evidenceFileSha256 === attempt.checksumManifestSha256, `Patch verification attempt ${attempt.id} has invalid checksum evidence.`)
    manifestHashes.add(attempt.checksumManifestSha256)
    const path = resolve(ROOT, attempt.evidencePath)
    if (existsSync(path)) assert(sha256(readFileSync(path)) === attempt.evidenceFileSha256, `Patch operator evidence drift: ${attempt.id}.`)
  }
  assert(manifestHashes.size === 1, 'Patch reference and clean rebuild checksum manifests diverged.')
  assert(artifact.comparison?.byteExact === true && artifact.comparison?.differentPaths === 0 && artifact.comparison?.changedCommonPaths === 0, 'Patch comparison is not byte-exact.')
  assert(artifact.patchRelease?.verification?.status === 'VERIFIED_EXACT_REPRODUCTION', 'Patch release verification status is not final.')
}

function main() {
  if (process.argv.length !== 2) fail('Released-identity verification accepts no arguments.')
  const artifact = JSON.parse(bytes(ARTIFACT_PATH).toString('utf8'))
  const packageMetadata = JSON.parse(bytes('package.json').toString('utf8'))
  const lock = JSON.parse(bytes('package-lock.json').toString('utf8'))
  const mints = JSON.parse(bytes('data/release-readiness/version-mints.v1.json').toString('utf8'))
  const policy = JSON.parse(bytes('data/release-readiness/version-policy.v1.json').toString('utf8'))
  const qualityGate = bytes('scripts/quality-gate.sh').toString('utf8')

  assert(artifact.artifact === 'released-identity-verification' && artifact.schemaVersion === 1 && artifact.ticket === 'P13-085', 'Released-identity verification artifact identity drifted.')
  assert([PENDING_STATUS, VERIFIED_STATUS].includes(artifact.status), `Unknown released-identity status: ${artifact.status}.`)
  verifyFailedPredecessor(artifact.failedRelease)
  verifyPatchMint(packageMetadata, lock, mints)

  const owner = artifact.ownerPatchDecision
  assert(owner?.decision === 'GO' && owner.automationMayDecide === false, 'Patch verification omits explicit owner GO.')
  assert(owner.releaseTransactionsAuthorized === 1 && owner.releaseTransactionsConsumed === 1, 'Patch GO must authorize and consume exactly one transaction.')
  assert(owner.remotePublicationAuthorized === false && owner.legalClearanceClaimed === false, 'Patch GO overclaims publication or legal clearance.')
  assert(owner.recommendation5ResidualRiskAccepted === true, 'Patch GO loses the accepted recommendation-5 boundary.')

  const patchTagPresent = verifyPatchTag(artifact)
  verifySourceEvidence(artifact.sourceEvidence, patchTagPresent)
  assert(artifact.patchRelease?.version === PATCH_VERSION && artifact.patchRelease?.tag === PATCH_TAG && artifact.patchRelease?.storageSchemaVersion === 56, 'Patch release identity drifted.')
  assert(artifact.patchRelease?.productPhase === 'released-unchanged' && artifact.patchRelease?.publication?.remoteTagPublished === false, 'Patch release phase or publication boundary drifted.')

  assert(packageMetadata.scripts?.['check:release-readiness:released-identity'] === 'node scripts/release-readiness/check-released-identity.mjs', 'Released-identity checker is not registered.')
  assert(packageMetadata.scripts?.['check:release-readiness']?.includes('check:release-readiness:released-identity'), 'Aggregate release-readiness gate omits released identity.')
  assert(qualityGate.includes('run_cmd node scripts/release-readiness/check-released-identity.mjs'), 'Full quality gate omits released identity.')
  assert(policy.rules?.finalTagDivergenceRequiresNextPatch === true && policy.rules?.checksumComparisonMayBeWeakened === false, 'Version policy weakens post-tag divergence handling.')

  if (artifact.status === PENDING_STATUS) {
    assert(artifact.patchRelease.verification?.status === 'PENDING_TAGGED_REPRODUCTION' && artifact.verificationAttempts?.length === 0, 'Pending patch transaction falsely claims verification evidence.')
    assert(artifact.disposition?.ownerPatchReleaseAuthorizationRecorded === true && artifact.disposition?.releaseTransactionsAuthorizedRemaining === 0, 'Pending patch authorization accounting drifted.')
    if (!allowPretag && !allowReferenceBuild) fail(`P13-085 verification is pending: generate the tagged ${PATCH_TAG} reference, then reproduce it from a second clean build.`)
    process.stdout.write(`${patchTagPresent ? 'Tagged' : 'Pretag'} ${PATCH_VERSION} transaction accepted for reference generation; exact independent checksum reproduction remains pending and remote publication is unauthorized.\n`)
    return
  }

  verifyPatchAttempts(artifact)
  assert(artifact.disposition?.v1_0_0MayBeRepresentedAsVerified === false && artifact.disposition?.v1_0_1MayBeRepresentedAsVerified === true, 'Released-identity final disposition drifted.')
  assert(artifact.disposition?.remotePublicationRemainsUnauthorized === true && artifact.disposition?.releaseTransactionsAuthorizedRemaining === 0, 'Verified patch overclaims publication or transaction authority.')
  process.stdout.write(`Released identity verified for ${PATCH_TAG}: two clean tagged builds reproduced every output checksum exactly; immutable v1.0.0 remains failed and unpublished; remote publication unauthorized.\n`)
}

try {
  main()
}
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
