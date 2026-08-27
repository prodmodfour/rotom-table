#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const manifestRepositoryPath = 'data/release-readiness/distribution-manifest.v1.json'
const manifestPath = path.join(repositoryRoot, manifestRepositoryPath)

const sourceEvidencePaths = [
  '.gitignore',
  'LICENSE',
  'NOTICE.md',
  'data/release-readiness/dependency-license-report.v1.json',
  'data/release-readiness/deployment-instruction-certification.v1.json',
  'data/release-readiness/documentary-tree-disposition.v1.json',
  'data/release-readiness/licensing-attribution-inventory.v1.json',
  'data/release-readiness/licensing-notice-disposition.v1.json',
  'data/release-readiness/media-asset-inventory.v1.json',
  'data/release-readiness/private-artifact-audit.v1.json',
  'data/release-readiness/tracked-tree-policy.v1.json',
  'deploy/systemd/rotom-table.service',
  'docs/fan-project-notice.md',
  'docs/media-attribution.md',
  'docs/release/source-tree-hygiene.md',
  'package-lock.json',
  'package.json',
  'public/THIRD_PARTY_NOTICES.txt',
  'requirements.txt',
  'scripts/release-readiness/generate-distribution-manifest.mjs',
]

const noticePaths = [
  { path: 'LICENSE', purpose: 'scope-limited Rotom-authored work license' },
  { path: 'NOTICE.md', purpose: 'repository fan-project, third-party, and accepted-risk notice' },
  { path: 'docs/fan-project-notice.md', purpose: 'fan-project and redistribution boundary' },
  { path: 'docs/media-attribution.md', purpose: 'sprite, media, font, derivative, and provenance attribution' },
  { path: 'public/THIRD_PARTY_NOTICES.txt', purpose: 'generated npm, Python, and OFL notice bundle' },
  { path: 'books/README.md', purpose: 'retained documentary PTU boundary label' },
  { path: 'ptu-data/README.md', purpose: 'retained parser/provenance boundary label' },
  { path: 'encounter_tables/README.md', purpose: 'retained legacy-fixture and private-data boundary label' },
  { path: 'trainer_sizes/README.md', purpose: 'retained Trainer media provenance and accepted-risk label' },
]

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const stableJsonHash = value => sha256(`${JSON.stringify(value)}\n`)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function bytes(repositoryPath) {
  return readFile(path.join(repositoryRoot, repositoryPath))
}

async function json(repositoryPath) {
  return JSON.parse((await bytes(repositoryPath)).toString('utf8'))
}

async function hashedPath(repositoryPath) {
  return { path: repositoryPath, sha256: sha256(await bytes(repositoryPath)) }
}

async function buildManifest() {
  const [
    packageJson,
    distribution,
    treePolicy,
    treeInventory,
    documentaryDisposition,
    privateAudit,
    licensingInventory,
    licensingDisposition,
    dependencyReport,
    mediaInventory,
    deploymentCertification,
  ] = await Promise.all([
    json('package.json'),
    json('data/release-readiness/distribution-inventory.v1.json'),
    json('data/release-readiness/tracked-tree-policy.v1.json'),
    json('data/release-readiness/tracked-tree-inventory.v1.json'),
    json('data/release-readiness/documentary-tree-disposition.v1.json'),
    json('data/release-readiness/private-artifact-audit.v1.json'),
    json('data/release-readiness/licensing-attribution-inventory.v1.json'),
    json('data/release-readiness/licensing-notice-disposition.v1.json'),
    json('data/release-readiness/dependency-license-report.v1.json'),
    json('data/release-readiness/media-asset-inventory.v1.json'),
    json('data/release-readiness/deployment-instruction-certification.v1.json'),
  ])

  assert(treeInventory.status === 'COMPLETE', `Tracked-tree inventory is not final: ${treeInventory.status}`)
  assert(treeInventory.ownerGates?.distributionDispositionStatus === 'RESOLVED', 'Documentary-tree disposition gate is unresolved.')
  assert(treeInventory.ownerGates?.licensingDispositionStatus === 'RESOLVED', 'Licensing disposition gate is unresolved.')
  assert(treeInventory.contentDigestExclusions?.includes(manifestRepositoryPath), 'Tracked-tree inventory must exclude the self-referential manifest content digest.')
  assert(documentaryDisposition.status === 'OWNER_APPROVED_APPLIED', 'Documentary-tree disposition is not final.')
  assert(documentaryDisposition.families?.length === 6, 'Documentary-tree disposition must cover all six reviewed families.')
  assert(documentaryDisposition.families.every(row => ['retain-and-label', 'prune'].includes(row.disposition)), 'A documentary-tree decision is unresolved.')
  assert(privateAudit.status === 'Certified', 'Private-artifact audit is not certified.')
  assert(privateAudit.distributionCandidatePaths === treeInventory.trackedPathCount, 'Private-artifact audit and classified source path counts disagree.')
  assert(Object.values(privateAudit.scans).every(value => value === 0), 'Private-artifact exclusion audit contains findings.')
  assert(privateAudit.gitignore.failedIgnoredPrivatePathProbes === 0, 'A required private path is no longer ignored.')
  assert(privateAudit.gitignore.accidentallyIgnoredTrackedExceptions === 0, 'A source-distribution exception is accidentally ignored.')
  assert(licensingInventory.status === 'OWNER_DISPOSITION_RECORDED', 'Licensing inventory is not final.')
  assert(licensingInventory.families?.every(row => row.disposition !== 'UNRESOLVED'), 'Licensing inventory contains an unresolved family.')
  assert(licensingDisposition.status === 'OWNER_APPROVED_AND_IMPLEMENTED', 'Owner licensing disposition is not final.')
  assert(dependencyReport.status === 'OWNER_DISPOSITION_RECORDED', 'Dependency license report is not final.')
  assert(dependencyReport.summary.unknownEntries === 0, 'Dependency inventory contains unknown license entries.')
  assert(dependencyReport.summary.potentiallyIncompatibleCopyleftEntries === 0, 'Dependency inventory contains mandatory incompatible copyleft.')
  assert(mediaInventory.status === 'OWNER_DISPOSITION_RECORDED', 'Media inventory is not final.')
  assert(mediaInventory.summary.unclassifiedMediaFiles === 0, 'Media inventory contains unclassified files.')
  assert(mediaInventory.summary.unknownProvenanceFiles === 0, 'Media inventory contains unknown-provenance files.')
  assert(deploymentCertification.status === 'Repaired', 'Supported deployment instructions are not certified.')
  assert(packageJson.scripts?.['check:release-readiness:distribution']?.includes('generate-distribution-manifest.mjs'), 'Distribution manifest is not registered in the drift gate.')
  assert(distribution.ownerPrunedPathsForbidden?.every(forbidden => treePolicy.resolvedPrunedTrees.some(row => row.path === forbidden)), 'Distribution and tracked-tree owner-pruned sets disagree.')

  const classificationBinding = {
    inventory: 'data/release-readiness/tracked-tree-inventory.v1.json',
    policy: treeInventory.policy,
    status: treeInventory.status,
    trackedPathCount: treeInventory.trackedPathCount,
    trackedPathSetSha256: treeInventory.trackedPathSetSha256,
    categoryPathCounts: treeInventory.categoryPathCounts,
    rulePathCounts: treeInventory.rulePathCounts,
    topLevelTrees: treeInventory.topLevelTrees,
    anomalyInventory: treeInventory.anomalyInventory.map(row => ({
      id: row.id,
      requiredTicket: row.requiredTicket,
      status: row.status,
      matchedPathCount: row.matchedPathCount,
      pathSetSha256: row.pathSetSha256,
      contentSetSha256: row.contentSetSha256,
      dispositionEvidence: row.dispositionEvidence ?? null,
    })),
    resolvedPrunedTrees: treeInventory.resolvedPrunedTrees,
    contentDigestExclusions: treeInventory.contentDigestExclusions,
  }

  const [sourceEvidence, notices] = await Promise.all([
    Promise.all(sourceEvidencePaths.map(hashedPath)),
    Promise.all(noticePaths.map(async row => ({ ...row, sha256: sha256(await bytes(row.path)) }))),
  ])

  const activeAnomalies = classificationBinding.anomalyInventory.filter(row => row.status !== 'OWNER_APPROVED_APPLIED')
  assert(activeAnomalies.length === 0, `Tracked-tree anomalies remain unresolved: ${activeAnomalies.map(row => row.id).join(', ')}`)

  return {
    artifact: 'release-source-distribution-manifest',
    schemaVersion: 1,
    manifestId: 'p13-065-source-distribution-v1',
    releaseVersion: packageJson.version,
    ticket: 'P13-065',
    status: 'Certified',
    distributionForms: [
      {
        id: 'tagged-source-repository',
        authority: classificationBinding.inventory,
        pathCount: classificationBinding.trackedPathCount,
        pathSetSha256: classificationBinding.trackedPathSetSha256,
      },
      {
        id: 'generated-production-build',
        command: distribution.productionBuild.command,
        path: distribution.productionBuild.generatedOutput,
        sourceTreeMembership: false,
        requiredBundledNotice: 'public/THIRD_PARTY_NOTICES.txt',
        finalArtifactAuditTicket: 'P13-072',
      },
    ],
    classification: {
      ...classificationBinding,
      stableBindingSha256: stableJsonHash(classificationBinding),
      note: 'The manifest path is classified but excluded from the aggregate content digest to avoid self-reference; its own bytes are checked by this generator.',
    },
    ownerDispositions: {
      documentaryTrees: {
        artifact: 'data/release-readiness/documentary-tree-disposition.v1.json',
        ticket: documentaryDisposition.ticket,
        status: documentaryDisposition.status,
        decisions: documentaryDisposition.families.map(row => ({ path: row.path, disposition: row.disposition, status: documentaryDisposition.status })),
      },
      licensingAndNotices: {
        artifact: 'data/release-readiness/licensing-notice-disposition.v1.json',
        ticket: licensingDisposition.ticket,
        status: licensingDisposition.status,
        approvedFamilies: licensingDisposition.familyDispositions.length,
        unresolvedFamilies: licensingInventory.families.filter(row => row.disposition === 'UNRESOLVED').length,
        acceptedRisk: licensingDisposition.acceptedRisk,
        legalClearanceClaimed: licensingDisposition.legalClearanceClaimed,
      },
    },
    exclusionAudit: {
      artifact: 'data/release-readiness/private-artifact-audit.v1.json',
      status: privateAudit.status,
      distributionCandidatePaths: privateAudit.distributionCandidatePaths,
      ignoreProbes: privateAudit.gitignore.ignoredPrivatePathProbes,
      failedIgnoreProbes: privateAudit.gitignore.failedIgnoredPrivatePathProbes,
      scans: privateAudit.scans,
      generatedOrPrivatePathsNeverCommitted: distribution.generatedOrPrivatePathsNeverCommittedToTheSourceDistribution,
      ownerPrunedPathsForbidden: distribution.ownerPrunedPathsForbidden,
    },
    inventories: {
      dependencies: {
        path: 'data/release-readiness/dependency-license-report.v1.json',
        status: dependencyReport.status,
        npmPackageInstances: dependencyReport.summary.npmPackageInstances,
        pythonPackages: dependencyReport.pythonPackages.length,
        unknownEntries: dependencyReport.summary.unknownEntries,
        mandatoryIncompatibleCopyleft: dependencyReport.summary.potentiallyIncompatibleCopyleftEntries,
      },
      media: {
        path: 'data/release-readiness/media-asset-inventory.v1.json',
        status: mediaInventory.status,
        mediaFiles: mediaInventory.summary.sourceDistributionMediaFiles,
        unclassifiedFiles: mediaInventory.summary.unclassifiedMediaFiles,
        unknownProvenanceFiles: mediaInventory.summary.unknownProvenanceFiles,
        acceptedRiskFiles: mediaInventory.summary.explicitRestrictionConflictFiles,
      },
    },
    noticeLocations: notices,
    productionBuildNotice: {
      source: 'public/THIRD_PARTY_NOTICES.txt',
      builtPath: '.output/public/THIRD_PARTY_NOTICES.txt',
      buildValidatedAt: 'P13-064',
      artifactAuditAt: 'P13-072',
    },
    deployment: {
      certification: 'data/release-readiness/deployment-instruction-certification.v1.json',
      status: deploymentCertification.status,
      supportedShape: distribution.productionBuild.supportedDeployment,
      runbook: distribution.productionBuild.operatorRunbook,
    },
    sourceEvidence,
  }
}

async function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'check'
  const manifest = await buildManifest()
  const rendered = `${JSON.stringify(manifest, null, 2)}\n`

  if (mode === 'write') {
    await writeFile(manifestPath, rendered)
    console.log(`Wrote ${manifestRepositoryPath} (${manifest.classification.trackedPathCount} source paths, ${manifest.noticeLocations.length} notice locations).`)
    return
  }

  const current = await readFile(manifestPath, 'utf8')
  assert(current === rendered, 'Distribution manifest drifted. Review classifications, exclusions, dispositions, and notices, then regenerate it.')
  console.log(`Distribution manifest verified: ${manifest.classification.trackedPathCount} source paths, zero exclusion findings, ${manifest.noticeLocations.length} notice locations, zero unresolved families.`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
