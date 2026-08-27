#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')

const expectedRows = new Map([
  ['distribution-landing', 'Certified'],
  ['distribution-screenshots', 'Certified'],
  ['distribution-metadata', 'Certified'],
  ['distribution-tree-classification', 'Certified'],
  ['distribution-tree-disposition', 'Approved'],
  ['distribution-private-exclusion', 'Certified'],
  ['distribution-deployment', 'Repaired'],
  ['licensing-dependencies', 'Certified'],
  ['licensing-assets', 'Certified'],
  ['licensing-disposition', 'Approved'],
])

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function read(repositoryPath) {
  return readFile(path.join(repositoryRoot, repositoryPath), 'utf8')
}

async function json(repositoryPath) {
  return JSON.parse(await read(repositoryPath))
}

async function main() {
  const [
    certification,
    rubric,
    distribution,
    manifest,
    treeInventory,
    documentaryDisposition,
    privateAudit,
    licensingInventory,
    licensingDisposition,
    dependencies,
    media,
    deployment,
    packageJson,
  ] = await Promise.all([
    json('data/release-readiness/distribution-notices-certification.v1.json'),
    json('data/release-readiness/release-gate-rubric.v1.json'),
    json('data/release-readiness/distribution-inventory.v1.json'),
    json('data/release-readiness/distribution-manifest.v1.json'),
    json('data/release-readiness/tracked-tree-inventory.v1.json'),
    json('data/release-readiness/documentary-tree-disposition.v1.json'),
    json('data/release-readiness/private-artifact-audit.v1.json'),
    json('data/release-readiness/licensing-attribution-inventory.v1.json'),
    json('data/release-readiness/licensing-notice-disposition.v1.json'),
    json('data/release-readiness/dependency-license-report.v1.json'),
    json('data/release-readiness/media-asset-inventory.v1.json'),
    json('data/release-readiness/deployment-instruction-certification.v1.json'),
    json('package.json'),
  ])

  assert(certification.ticket === 'P13-066', 'Distribution/notices acceptance ticket drifted.')
  assert(certification.status === 'Certified', 'Distribution/notices acceptance is not final.')
  assert(certification.gateRows?.length === expectedRows.size, 'Distribution/notices acceptance must contain exactly ten rubric rows.')
  const rowIds = new Set(certification.gateRows.map(row => row.id))
  assert(rowIds.size === expectedRows.size, 'Distribution/notices acceptance contains duplicate rubric rows.')

  const rubricRows = new Map(rubric.rows.map(row => [row.id, row]))
  for (const [id, state] of expectedRows) {
    const accepted = certification.gateRows.find(row => row.id === id)
    assert(accepted?.state === state, `${id} must close as ${state}.`)
    assert(rubricRows.get(id)?.allowedFinalStates?.includes(state), `${state} is not an allowed rubric state for ${id}.`)
  }

  assert(distribution.status === 'CERTIFIED', 'Release distribution inventory is not certified.')
  assert(distribution.trackedTreeAuthority.classificationStatus === 'COMPLETE', 'Distribution tree classification is not complete.')
  assert(distribution.disposition === 'PHASE_6_DISTRIBUTION_AND_NOTICES_CERTIFIED', 'Distribution disposition marker is not final.')
  assert(manifest.status === 'Certified', 'Distribution manifest is not certified.')
  assert(manifest.ownerDispositions.licensingAndNotices.unresolvedFamilies === 0, 'Distribution manifest contains unresolved licensing families.')
  assert(manifest.exclusionAudit.failedIgnoreProbes === 0, 'Distribution manifest contains failed ignore probes.')
  assert(Object.values(manifest.exclusionAudit.scans).every(value => value === 0), 'Distribution manifest contains private/exclusion findings.')
  assert(treeInventory.status === 'COMPLETE', 'Tracked-tree inventory is not complete.')
  assert(Object.values(treeInventory.ownerGates).filter(value => typeof value === 'string').every(value => !value.includes('AWAITING')), 'A tracked-tree owner gate is unresolved.')
  assert(treeInventory.anomalyInventory.every(row => row.status === 'OWNER_APPROVED_APPLIED'), 'A tracked-tree anomaly lacks owner disposition.')

  assert(documentaryDisposition.status === 'OWNER_APPROVED_APPLIED', 'Documentary-tree owner disposition is not final.')
  assert(privateAudit.status === 'Certified' && Object.values(privateAudit.scans).every(value => value === 0), 'Private-artifact exclusion audit is not clean.')
  assert(licensingInventory.status === 'OWNER_DISPOSITION_RECORDED', 'Licensing family inventory is not final.')
  assert(licensingInventory.families.length === 8 && licensingInventory.families.every(row => row.disposition !== 'UNRESOLVED'), 'Licensing inventory does not close all eight families.')
  assert(licensingDisposition.status === 'OWNER_APPROVED_AND_IMPLEMENTED', 'Owner licensing disposition is not implemented.')
  assert(licensingDisposition.recommendations.find(row => row.number === 5)?.decision === 'DECLINED_OWNER_ACCEPTED_RISK', 'The recommendation-5 risk exception was blurred or removed.')
  assert(licensingDisposition.legalClearanceClaimed === false, 'Distribution acceptance must not claim legal clearance.')
  assert(dependencies.status === 'OWNER_DISPOSITION_RECORDED', 'Dependency license inventory is not final.')
  assert(dependencies.summary.unknownEntries === 0 && dependencies.summary.potentiallyIncompatibleCopyleftEntries === 0, 'Dependency license inventory contains unresolved entries.')
  assert(media.status === 'OWNER_DISPOSITION_RECORDED', 'Media asset inventory is not final.')
  assert(media.summary.unclassifiedMediaFiles === 0 && media.summary.unknownProvenanceFiles === 0, 'Media asset inventory contains unresolved provenance rows.')
  assert(deployment.status === 'Repaired', 'Supported deployment path is not repaired and certified.')

  for (const notice of manifest.noticeLocations) {
    const noticeBytes = await readFile(path.join(repositoryRoot, notice.path))
    assert(sha256(noticeBytes) === notice.sha256, `Notice location drifted: ${notice.path}`)
  }
  assert(manifest.noticeLocations.some(row => row.path === 'public/THIRD_PARTY_NOTICES.txt'), 'Built third-party notice is absent from the distribution manifest.')

  assert(packageJson.scripts['check:release-readiness:distribution-acceptance']?.includes('check-distribution-acceptance.mjs'), 'Distribution acceptance command is not registered.')
  assert(packageJson.scripts['check:release-readiness']?.includes('check:release-readiness:distribution-acceptance'), 'Aggregate release-readiness command omits distribution acceptance.')

  console.log(`Distribution and notices acceptance verified: ${expectedRows.size}/10 rubric rows final, ${manifest.classification.trackedPathCount} paths, ${manifest.noticeLocations.length} notices, zero unresolved families or exclusion findings.`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
