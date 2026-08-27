#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { lstat, readFile, readlink, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const policyPath = path.join(repositoryRoot, 'data/release-readiness/tracked-tree-policy.v1.json')
const inventoryPath = path.join(repositoryRoot, 'data/release-readiness/tracked-tree-inventory.v1.json')
const inventoryRepositoryPath = 'data/release-readiness/tracked-tree-inventory.v1.json'
const manifestRepositoryPath = 'data/release-readiness/distribution-manifest.v1.json'
const contentDigestExclusions = new Set([inventoryRepositoryPath, manifestRepositoryPath])
const allowedCategories = new Set([
  'authored',
  'generated',
  'third-party',
  'documentary',
  'private-data-sensitive',
])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function matchesRule(repositoryPath, rule) {
  if ((rule.excludePrefixes ?? []).some((prefix) => repositoryPath.startsWith(prefix))) {
    return false
  }

  return (rule.exactPaths ?? []).includes(repositoryPath)
    || (rule.prefixes ?? []).some((prefix) => repositoryPath.startsWith(prefix))
}

function matchesAnomaly(repositoryPath, anomaly) {
  return anomaly.exactPath === repositoryPath
    || (typeof anomaly.pathPrefix === 'string' && repositoryPath.startsWith(anomaly.pathPrefix))
}

async function listDistributionPaths() {
  const raw = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repositoryRoot },
  ).toString('utf8')

  const candidates = [...new Set(raw.split('\0').filter(Boolean))].sort()
  const paths = []

  for (const repositoryPath of candidates) {
    try {
      const stats = await lstat(path.join(repositoryRoot, repositoryPath))
      if (stats.isFile() || stats.isSymbolicLink()) {
        paths.push(repositoryPath)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  return paths
}

async function contentHash(repositoryPath) {
  const absolutePath = path.join(repositoryRoot, repositoryPath)
  const stats = await lstat(absolutePath)
  if (stats.isSymbolicLink()) {
    return sha256(`symlink:${await readlink(absolutePath)}`)
  }
  return sha256(await readFile(absolutePath))
}

function sortObjectEntries(entries) {
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)))
}

async function buildInventory(policy, policySource) {
  if (
    policy.schemaVersion !== 1
    || !Array.isArray(policy.rules)
    || !Array.isArray(policy.anomalies)
    || !Array.isArray(policy.resolvedPrunedTrees)
  ) {
    throw new Error('Tracked-tree policy must use schemaVersion 1 and declare rules, anomalies, and resolved pruned trees.')
  }

  const unknownCategories = policy.rules
    .filter((rule) => !allowedCategories.has(rule.category))
    .map((rule) => `${rule.id}:${rule.category}`)
  if (unknownCategories.length > 0) {
    throw new Error(`Tracked-tree policy has unknown categories: ${unknownCategories.join(', ')}`)
  }

  const distributionPaths = await listDistributionPaths()
  const classifications = new Map()
  const unclassifiedPaths = []
  const ambiguousPaths = []

  for (const repositoryPath of distributionPaths) {
    const matchingRules = policy.rules.filter((rule) => matchesRule(repositoryPath, rule))
    if (matchingRules.length === 0) {
      unclassifiedPaths.push(repositoryPath)
      continue
    }
    if (matchingRules.length > 1) {
      ambiguousPaths.push({
        path: repositoryPath,
        ruleIds: matchingRules.map((rule) => rule.id),
      })
      continue
    }
    classifications.set(repositoryPath, matchingRules[0])
  }

  if (unclassifiedPaths.length > 0 || ambiguousPaths.length > 0) {
    const details = [
      ...unclassifiedPaths.slice(0, 20).map((repositoryPath) => `unclassified: ${repositoryPath}`),
      ...ambiguousPaths.slice(0, 20).map((entry) => `ambiguous (${entry.ruleIds.join(', ')}): ${entry.path}`),
    ]
    throw new Error(`Tracked-tree classification is incomplete:\n${details.join('\n')}`)
  }

  const topLevelEntries = [...new Set(distributionPaths.map((repositoryPath) => repositoryPath.split('/')[0]))].sort()
  const expectedTopLevelEntries = [...policy.expectedTopLevelEntries].sort()
  if (JSON.stringify(topLevelEntries) !== JSON.stringify(expectedTopLevelEntries)) {
    const unexpected = topLevelEntries.filter((entry) => !expectedTopLevelEntries.includes(entry))
    const missing = expectedTopLevelEntries.filter((entry) => !topLevelEntries.includes(entry))
    throw new Error(
      `Tracked top-level entries drifted. Unexpected: ${unexpected.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}.`,
    )
  }

  const categoryCounts = new Map([...allowedCategories].map((category) => [category, 0]))
  const ruleCounts = new Map(policy.rules.map((rule) => [rule.id, 0]))
  const treeCounts = new Map()

  for (const [repositoryPath, rule] of classifications) {
    categoryCounts.set(rule.category, categoryCounts.get(rule.category) + 1)
    ruleCounts.set(rule.id, ruleCounts.get(rule.id) + 1)

    const tree = repositoryPath.split('/')[0]
    if (!treeCounts.has(tree)) treeCounts.set(tree, new Map())
    const categories = treeCounts.get(tree)
    categories.set(rule.category, (categories.get(rule.category) ?? 0) + 1)
  }

  const contentHashes = new Map()
  const contentLines = []
  for (const repositoryPath of distributionPaths) {
    if (contentDigestExclusions.has(repositoryPath)) continue
    const digest = await contentHash(repositoryPath)
    contentHashes.set(repositoryPath, digest)
    contentLines.push(`${repositoryPath}\0${digest}`)
  }

  const anomalies = policy.anomalies.map((anomaly) => {
    const matchedPaths = distributionPaths.filter((repositoryPath) => matchesAnomaly(repositoryPath, anomaly))
    if (matchedPaths.length === 0) {
      throw new Error(`Declared anomaly ${anomaly.id} does not match a distribution path.`)
    }
    const matchedContent = matchedPaths.map((repositoryPath) => `${repositoryPath}\0${contentHashes.get(repositoryPath)}`)
    return {
      ...anomaly,
      matchedPathCount: matchedPaths.length,
      pathSetSha256: sha256(`${matchedPaths.join('\n')}\n`),
      contentSetSha256: sha256(`${matchedContent.join('\n')}\n`),
    }
  })

  for (const prunedTree of policy.resolvedPrunedTrees) {
    const prefix = prunedTree.path.endsWith('/') ? prunedTree.path : null
    const stillPresent = distributionPaths.some((repositoryPath) => (
      repositoryPath === prunedTree.path || (prefix !== null && repositoryPath.startsWith(prefix))
    ))
    if (stillPresent) {
      throw new Error(`Owner-pruned distribution path is present again: ${prunedTree.path}`)
    }
  }

  const unresolvedDistributionAnomalies = anomalies.filter((entry) => (
    entry.requiredTicket === 'P13-058' && entry.status !== 'OWNER_APPROVED_APPLIED'
  ))
  const unresolvedLicensingAnomalies = anomalies.filter((entry) => (
    entry.requiredTicket === 'P13-062' && entry.status !== 'OWNER_APPROVED_APPLIED'
  ))
  const status = unresolvedDistributionAnomalies.length > 0
    ? 'COMPLETE_WITH_DECLARED_OWNER_ANOMALIES'
    : unresolvedLicensingAnomalies.length > 0
      ? 'COMPLETE_WITH_DECLARED_LICENSING_ANOMALIES'
      : 'COMPLETE'

  return {
    schemaVersion: 1,
    inventoryId: 'p13-tracked-tree-inventory-v1',
    releaseVersion: policy.releaseVersion,
    status,
    policy: {
      id: policy.policyId,
      path: 'data/release-readiness/tracked-tree-policy.v1.json',
      sha256: sha256(policySource),
    },
    sourceCommand: 'git ls-files --cached --others --exclude-standard -z',
    trackedPathCount: distributionPaths.length,
    trackedPathSetSha256: sha256(`${distributionPaths.join('\n')}\n`),
    trackedContentSetSha256: sha256(`${contentLines.join('\n')}\n`),
    contentDigestExclusions: [...contentDigestExclusions].sort(),
    categoryPathCounts: sortObjectEntries(categoryCounts.entries()),
    rulePathCounts: sortObjectEntries(ruleCounts.entries()),
    topLevelTrees: topLevelEntries.map((tree) => ({
      path: tree,
      pathCount: [...classifications.keys()].filter((repositoryPath) => repositoryPath.split('/')[0] === tree).length,
      categories: sortObjectEntries((treeCounts.get(tree) ?? new Map()).entries()),
    })),
    anomalyInventory: anomalies,
    resolvedPrunedTrees: policy.resolvedPrunedTrees,
    ownerGates: {
      distributionDispositionTicket: 'P13-058',
      distributionDispositionStatus: unresolvedDistributionAnomalies.length === 0 ? 'RESOLVED' : 'AWAITING_OWNER',
      licensingDispositionTicket: 'P13-062',
      licensingDispositionStatus: unresolvedLicensingAnomalies.length === 0 ? 'RESOLVED' : 'AWAITING_OWNER',
      automationMayApprove: false,
    },
  }
}

async function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'check'
  const policySource = await readFile(policyPath)
  const policy = JSON.parse(policySource.toString('utf8'))
  const inventory = await buildInventory(policy, policySource)
  const rendered = `${JSON.stringify(inventory, null, 2)}\n`

  if (mode === 'write') {
    await writeFile(inventoryPath, rendered)
    console.log(`Wrote ${path.relative(repositoryRoot, inventoryPath)} (${inventory.trackedPathCount} paths).`)
    return
  }

  const current = await readFile(inventoryPath, 'utf8')
  if (current !== rendered) {
    throw new Error(
      'Tracked-tree inventory drifted. Review new paths/classifications, then run npm run generate:release-readiness:distribution.',
    )
  }

  console.log(
    `Tracked-tree inventory verified: ${inventory.trackedPathCount} paths, ${inventory.topLevelTrees.length} top-level entries, ${inventory.anomalyInventory.length} present anomalies, ${inventory.resolvedPrunedTrees.length} owner-pruned trees.`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
