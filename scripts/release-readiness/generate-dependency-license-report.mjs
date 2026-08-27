#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const lockPath = path.join(repositoryRoot, 'package-lock.json')
const requirementsPath = path.join(repositoryRoot, 'requirements.txt')
const policyPath = path.join(repositoryRoot, 'data/release-readiness/dependency-license-policy.v1.json')
const reportPath = path.join(repositoryRoot, 'data/release-readiness/dependency-license-report.v1.json')

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function packageNameFromLockPath(lockPackagePath) {
  const marker = 'node_modules/'
  const index = lockPackagePath.lastIndexOf(marker)
  return lockPackagePath.slice(index + marker.length)
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1
}

function classifyLicense(license, policy) {
  if (!license) return 'unknown'
  if (policy.classification.weakCopyleftExpressions.includes(license)) return 'weak-copyleft'
  if (policy.classification.attributionExpressions.includes(license)) return 'attribution'
  if (policy.classification.permissiveExpressions.includes(license)) return 'permissive'

  const hasCopyleft = policy.classification.copyleftTokens.some((token) => license.includes(token))
  if (hasCopyleft && license.includes(' OR ')) return 'dual-license-review'
  if (hasCopyleft) return 'copyleft-review'
  return 'unknown'
}

async function buildReport() {
  const [lockSource, requirementsSource, policySource] = await Promise.all([
    readFile(lockPath),
    readFile(requirementsPath),
    readFile(policyPath),
  ])
  const lock = JSON.parse(lockSource.toString('utf8'))
  const policy = JSON.parse(policySource.toString('utf8'))
  assert(lock.lockfileVersion === 3, 'Dependency license generator expects package-lock v3.')
  assert(policy.schemaVersion === 1, 'Dependency license policy schema drifted.')

  const overrideMap = new Map(policy.npmMissingMetadataOverrides.map((override) => [
    `${override.name}@${override.version}`,
    override,
  ]))
  const npmRows = []
  for (const [lockPackagePath, metadata] of Object.entries(lock.packages)) {
    if (lockPackagePath === '') continue
    const name = metadata.name ?? packageNameFromLockPath(lockPackagePath)
    const version = metadata.version
    assert(typeof version === 'string' && version.length > 0, `Lock package lacks a version: ${lockPackagePath}`)

    const override = overrideMap.get(`${name}@${version}`)
    let license = metadata.license ?? null
    let metadataSource = 'package-lock.json'
    if (!license && override) {
      const installedLicense = await readFile(path.join(repositoryRoot, override.evidencePathAfterNpmCi))
      assert(sha256(installedLicense) === override.evidenceSha256, `Reviewed license override evidence drifted: ${name}@${version}`)
      license = override.license
      metadataSource = `${override.evidencePathAfterNpmCi}#sha256=${override.evidenceSha256}`
    }

    npmRows.push({
      name,
      version,
      lockPath: lockPackagePath,
      scope: metadata.dev ? 'development' : metadata.optional ? 'optional' : 'runtime-or-build',
      license,
      licenseClass: classifyLicense(license, policy),
      metadataSource,
    })
  }
  npmRows.sort((left, right) => left.lockPath.localeCompare(right.lockPath))

  const requirements = requirementsSource.toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  const declaredPython = policy.pythonDeclaredDependencies.map((entry) => entry.requirement)
  assert(JSON.stringify(requirements) === JSON.stringify(declaredPython), 'requirements.txt and reviewed exact Python dependency graph disagree.')
  assert(
    policy.pythonDeclaredDependencies.every((entry) => entry.requirement === `${entry.name}==${entry.version}`),
    'Every reviewed Python helper dependency must use one exact version.',
  )

  const pythonRows = policy.pythonDeclaredDependencies.map((entry) => ({
    ...entry,
    resolution: 'exact-version-lock-bound',
    licenseClass: classifyLicense(entry.license, policy),
  }))

  const npmLicenseExpressionCounts = {}
  const npmClassCounts = {}
  for (const row of npmRows) {
    increment(npmLicenseExpressionCounts, row.license ?? 'UNKNOWN')
    increment(npmClassCounts, row.licenseClass)
  }
  const pythonClassCounts = {}
  for (const row of pythonRows) increment(pythonClassCounts, row.licenseClass)

  const flaggedNpm = npmRows.filter((row) => row.licenseClass !== 'permissive')
  const flaggedPython = pythonRows.filter((row) => row.licenseClass !== 'permissive')
  const incompatible = [...npmRows, ...pythonRows].filter((row) => row.licenseClass === 'copyleft-review')
  const unknown = [...npmRows, ...pythonRows].filter((row) => row.licenseClass === 'unknown')

  return {
    artifact: 'release-dependency-license-report',
    schemaVersion: 1,
    reportId: 'p13-dependency-license-report-v1',
    releaseVersion: '1.0.0-rc.1',
    status: 'OWNER_DISPOSITION_RECORDED',
    sources: {
      npmLock: { path: 'package-lock.json', sha256: sha256(lockSource), lockfileVersion: lock.lockfileVersion },
      pythonRequirements: {
        path: 'requirements.txt',
        sha256: sha256(requirementsSource),
        resolutionLockBound: true,
        lockKind: 'complete-exact-version-graph',
      },
      policy: { path: 'data/release-readiness/dependency-license-policy.v1.json', sha256: sha256(policySource) },
    },
    summary: {
      npmPackageInstances: npmRows.length,
      npmLicenseExpressionCounts,
      npmLicenseClassCounts: npmClassCounts,
      npmUnknownLicenses: npmRows.filter((row) => row.licenseClass === 'unknown').length,
      npmReviewedMetadataOverrides: policy.npmMissingMetadataOverrides.length,
      pythonDeclaredDirectDependencies: pythonRows.filter((row) => row.direct).length,
      pythonKnownDependencyFamilies: pythonRows.filter((row) => !row.direct).length,
      pythonLicenseClassCounts: pythonClassCounts,
      pythonResolutionLockBound: true,
      potentiallyIncompatibleCopyleftEntries: incompatible.length,
      unknownEntries: unknown.length,
      ownerReviewFlags: flaggedNpm.length + flaggedPython.length,
    },
    flags: [
      ...flaggedNpm.map((row) => ({
        id: `NPM:${row.name}@${row.version}`,
        severity: row.licenseClass === 'copyleft-review' || row.licenseClass === 'unknown' ? 'potential-blocker' : 'owner-review',
        license: row.license,
        licenseClass: row.licenseClass,
        scope: row.scope,
      })),
      ...flaggedPython.map((row) => ({
        id: `PYTHON:${row.name}`,
        severity: row.licenseClass === 'copyleft-review' || row.licenseClass === 'unknown' ? 'potential-blocker' : 'owner-review',
        license: row.license,
        licenseClass: row.licenseClass,
        scope: row.direct ? 'lock-bound-direct' : 'lock-bound-transitive',
      })),
    ],
    npmPackages: npmRows,
    pythonPackages: pythonRows,
    ownerGate: {
      ticket: 'P13-062',
      automationMayApprove: false,
      disposition: 'OWNER_APPROVED_WITH_REMEDIATION',
      dispositionArtifact: 'data/release-readiness/licensing-notice-disposition.v1.json',
    },
  }
}

async function main() {
  const write = process.argv.includes('--write')
  const report = await buildReport()
  const rendered = `${JSON.stringify(report, null, 2)}\n`

  if (write) {
    await writeFile(reportPath, rendered)
    console.log(`Wrote ${path.relative(repositoryRoot, reportPath)} (${report.summary.npmPackageInstances} npm instances, ${report.pythonPackages.length} Python rows).`)
    return
  }

  const current = await readFile(reportPath, 'utf8')
  assert(current === rendered, 'Dependency license report drifted; run npm run generate:release-readiness:dependency-licenses.')
  console.log(`Dependency licenses verified: ${report.summary.npmPackageInstances} npm instances, ${report.pythonPackages.length} Python rows, ${report.summary.unknownEntries} unknown, ${report.summary.potentiallyIncompatibleCopyleftEntries} incompatible copyleft.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
