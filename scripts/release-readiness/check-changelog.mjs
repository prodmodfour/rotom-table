#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const [changelog, packageSource, planOrder] = await Promise.all([
    readFile(path.join(repositoryRoot, 'CHANGELOG.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(repositoryRoot, 'implementation-plans/plan-order.md'), 'utf8'),
  ])

  for (const heading of [
    '# Changelog',
    '## Changelog convention',
    '## [Unreleased]',
    `## [${packageSource.version}] - 2026-08-27`,
    '## Pre-1.0 development history',
  ]) {
    assert(changelog.includes(heading), `CHANGELOG.md omits required heading: ${heading}`)
  }

  const planNames = [...planOrder.matchAll(/^\| \d+ \| \[([^\]]+)\]/gm)].map(match => match[1])
  assert(planNames.length === 13, `Expected 13 registered plan names, found ${planNames.length}.`)
  for (const planName of planNames) assert(changelog.includes(`**${planName}**`), `CHANGELOG.md omits plan-level history for ${planName}.`)

  for (const phrase of [
    'Semantic Versioning',
    'immutable release commit and annotated tag',
    'Never move a released tag',
    'Database rollback means restoring the exact pre-upgrade backup',
    'GM/Player picker is a trusted-table role choice, not public authentication',
    'Local hosting is deprecated',
    'recommendation-5 residual risk',
    'Final `1.0.0` remains pending the explicit owner go/no-go',
  ]) {
    assert(changelog.toLowerCase().includes(phrase.toLowerCase()), `CHANGELOG.md omits release guarantee or boundary: ${phrase}`)
  }

  assert(!/\bP\d{1,2}-\d{3}\b/u.test(changelog), 'CHANGELOG.md contains internal ticket noise.')
  assert(!/^## \[1\.0\.0\] - /m.test(changelog), 'CHANGELOG.md must not claim final 1.0.0 before the atomic release transaction.')
  assert(packageSource.scripts?.['check:release-readiness:changelog'] === 'node scripts/release-readiness/check-changelog.mjs', 'Changelog drift check is not registered.')

  console.log(`Changelog spine verified: ${planNames.length} plan-level milestones, ${packageSource.version} candidate history, future SemVer convention, and no ticket noise.`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
