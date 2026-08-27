#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const documentPaths = [
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'docs/README.md',
  'docs/support.md',
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function assertLocalLinks(repositoryPath, source) {
  const links = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map(match => match[1].split('#')[0])
    .filter(target => target && !/^(?:https?:|mailto:)/.test(target))

  for (const target of links) {
    const resolved = path.resolve(repositoryRoot, path.dirname(repositoryPath), target)
    assert(resolved.startsWith(`${repositoryRoot}${path.sep}`) || resolved === repositoryRoot, `Support document link escapes repository: ${repositoryPath} -> ${target}`)
    await access(resolved).catch(() => {
      throw new Error(`Broken support document link: ${repositoryPath} -> ${target}`)
    })
  }
}

async function main() {
  const entries = await Promise.all(documentPaths.map(async repositoryPath => {
    const source = await readFile(path.join(repositoryRoot, repositoryPath), 'utf8')
    await assertLocalLinks(repositoryPath, source)
    return [repositoryPath, source]
  }))
  const documents = new Map(entries)
  const read = repositoryPath => documents.get(repositoryPath) ?? ''
  const security = read('SECURITY.md')
  const contributing = read('CONTRIBUTING.md')
  const support = read('docs/support.md')
  const landing = read('README.md')

  for (const [repositoryPath, source] of entries) {
    for (const required of ['private', 'support']) {
      assert(source.toLowerCase().includes(required), `${repositoryPath} omits the ${required} boundary.`)
    }
  }

  for (const phrase of [
    'not public authentication',
    'outer access gate',
    'SQLite',
    'ROTOM_CAMPAIGN_ROOT',
    'ROTOM_ENABLE_HOSTED_WRITES=1',
    'Do not expose',
    'no paid support contract',
    'no security compatibility promise',
    'privately',
  ]) {
    assert(security.toLowerCase().includes(phrase.toLowerCase()), `SECURITY.md omits required boundary: ${phrase}`)
  }

  for (const phrase of [
    'npm ci',
    'development only',
    'synthetic campaign root',
    'one private Linux x86-64 VPS',
    'Public authentication',
    'data/reference/',
    'documentary/provenance',
    'no SLA',
    'legal clearance',
  ]) {
    assert(contributing.toLowerCase().includes(phrase.toLowerCase()), `CONTRIBUTING.md omits required boundary: ${phrase}`)
  }
  for (const stale of [
    'npm install',
    'intentionally remains red',
    'permits honest `assisted` and `blocked` rows',
    'filesystem-backed campaign data',
  ]) {
    assert(!contributing.toLowerCase().includes(stale.toLowerCase()), `CONTRIBUTING.md retains stale guidance: ${stale}`)
  }

  for (const phrase of [
    'best effort',
    'one private Linux x86-64 VPS',
    'latest `1.0.0-rc.N`',
    'no response-time SLA',
    'no uptime guarantee',
    'no hosted service',
    'no paid support',
    'no data-recovery service',
    'public internet exposure',
    'local development as a live campaign host',
    'operator\'s responsibility',
    'legal advice',
  ]) {
    assert(support.toLowerCase().includes(phrase.toLowerCase()), `docs/support.md omits required expectation: ${phrase}`)
  }
  assert(landing.includes('[support expectations](docs/support.md)'), 'Repository landing does not link support expectations.')

  const matrix = JSON.parse(await readFile(path.join(repositoryRoot, 'data/release-readiness/supported-platform-matrix.v1.json'), 'utf8'))
  const matrixText = JSON.stringify(matrix).toLowerCase()
  for (const expected of ['linux', 'x86-64', 'node', 'chrom']) {
    assert(matrixText.includes(expected), `Supported platform matrix lacks ${expected}.`)
  }

  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'))
  assert(packageJson.scripts['check:release-readiness:support'] === 'node scripts/release-readiness/check-support-boundaries.mjs', 'Support-boundary check is not registered.')
  assert(packageJson.scripts['check:release-readiness'].includes('check:release-readiness:support'), 'Aggregate release-readiness check omits support boundaries.')

  console.log(`Support boundaries verified across ${documentPaths.length} documents: private trusted-table scope, best-effort maintenance, zero public/commercial promises.`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
