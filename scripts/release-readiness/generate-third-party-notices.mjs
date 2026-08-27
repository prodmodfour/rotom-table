#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const lockPath = path.join(repositoryRoot, 'package-lock.json')
const reportPath = path.join(repositoryRoot, 'data/release-readiness/dependency-license-report.v1.json')
const outputPath = path.join(repositoryRoot, 'public/THIRD_PARTY_NOTICES.txt')
const noticeName = /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i

const sha256 = value => createHash('sha256').update(value).digest('hex')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function rootNoticeFiles(packageDirectory) {
  let names
  try {
    names = await readdir(packageDirectory)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const files = []
  for (const name of names.sort()) {
    if (!noticeName.test(name)) continue
    const absolutePath = path.join(packageDirectory, name)
    const metadata = await stat(absolutePath)
    if (!metadata.isFile()) continue
    assert(metadata.size <= 2_000_000, `Unexpectedly large dependency notice: ${absolutePath}`)
    const source = await readFile(absolutePath)
    assert(!source.includes(0), `Dependency notice is not text: ${absolutePath}`)
    files.push({ name, source })
  }
  return files
}

async function buildNotices() {
  const [lockSource, reportSource] = await Promise.all([
    readFile(lockPath),
    readFile(reportPath),
  ])
  const lock = JSON.parse(lockSource.toString('utf8'))
  const report = JSON.parse(reportSource.toString('utf8'))
  assert(lock.lockfileVersion === 3, 'Third-party notices require package-lock v3.')
  assert(report.sources.npmLock.sha256 === sha256(lockSource), 'Dependency report is stale against package-lock.json.')
  assert(report.summary.npmPackageInstances === report.npmPackages.length, 'Dependency report package count drifted.')
  assert(report.summary.pythonResolutionLockBound === true, 'Python helper graph must be lock-bound before notices are generated.')

  const identities = new Map()
  for (const row of report.npmPackages) {
    const id = `${row.name}@${row.version}`
    const identity = identities.get(id) ?? {
      id,
      name: row.name,
      version: row.version,
      license: row.license ?? 'UNKNOWN',
      scopes: new Set(),
      lockPaths: [],
      textHashes: new Set(),
    }
    assert(identity.license === (row.license ?? 'UNKNOWN'), `License expression disagrees across ${id}.`)
    identity.scopes.add(row.scope)
    identity.lockPaths.push(row.lockPath)
    identities.set(id, identity)
  }

  const texts = new Map()
  for (const identity of identities.values()) {
    for (const lockPackagePath of identity.lockPaths) {
      for (const notice of await rootNoticeFiles(path.join(repositoryRoot, lockPackagePath))) {
        const hash = sha256(notice.source)
        identity.textHashes.add(hash)
        const text = texts.get(hash) ?? {
          hash,
          source: notice.source.toString('utf8').replace(/\s+$/u, ''),
          packages: new Set(),
          filenames: new Set(),
        }
        text.packages.add(identity.id)
        text.filenames.add(notice.name)
        texts.set(hash, text)
      }
    }
  }

  const sortedIdentities = [...identities.values()].sort((left, right) => left.id.localeCompare(right.id))
  const sortedTexts = [...texts.values()].sort((left, right) => left.hash.localeCompare(right.hash))
  const identitiesWithText = sortedIdentities.filter(identity => identity.textHashes.size > 0).length
  const lines = [
    'ROTOM TABLE THIRD-PARTY SOFTWARE NOTICES',
    '=========================================',
    '',
    'This generated file preserves notices found at the roots of the exact npm packages installed by package-lock.json and records the complete exact-version Python helper graph.',
    'It applies only to the identified third-party dependencies. It does not change the scope of Rotom Table\'s LICENSE or grant rights to Pokémon/PTU material.',
    '',
    `package-lock.json SHA-256: ${sha256(lockSource)}`,
    `dependency report SHA-256: ${sha256(reportSource)}`,
    `npm package instances: ${report.npmPackages.length}`,
    `unique npm name/version identities: ${sortedIdentities.length}`,
    `npm identities with embedded root notice text: ${identitiesWithText}`,
    `npm identities represented by license metadata only: ${sortedIdentities.length - identitiesWithText}`,
    `unique embedded notice texts: ${sortedTexts.length}`,
    '',
    'NPM PACKAGE INDEX',
    '-----------------',
    '',
  ]

  for (const identity of sortedIdentities) {
    const hashes = [...identity.textHashes].sort()
    lines.push(
      `${identity.id} | license=${identity.license} | instances=${identity.lockPaths.length} | scopes=${[...identity.scopes].sort().join(',')} | notice-sha256=${hashes.length ? hashes.join(',') : 'metadata-only'}`,
    )
  }

  lines.push('', 'PYTHON HELPER LOCK', '------------------', '')
  for (const row of report.pythonPackages) {
    lines.push(`${row.name}@${row.version} | license=${row.license} | ${row.direct ? 'direct' : 'transitive'} | source=${row.sourceUrl}`)
  }

  lines.push(
    '',
    'EMBEDDED NPM NOTICE TEXTS',
    '-------------------------',
    '',
    'Identical texts are stored once and mapped back to every package identity that supplied them.',
    '',
  )
  for (const text of sortedTexts) {
    lines.push(
      '===============================================================================',
      `SHA-256: ${text.hash}`,
      `Supplied as: ${[...text.filenames].sort().join(', ')}`,
      `Packages: ${[...text.packages].sort().join(', ')}`,
      '-------------------------------------------------------------------------------',
      text.source,
      '',
    )
  }

  return `${lines.join('\n')}\n`
}

async function main() {
  const write = process.argv.includes('--write')
  const rendered = await buildNotices()
  if (write) {
    await writeFile(outputPath, rendered)
    console.log(`Wrote ${path.relative(repositoryRoot, outputPath)} (${Buffer.byteLength(rendered)} bytes).`)
    return
  }

  const current = await readFile(outputPath, 'utf8')
  assert(current === rendered, 'Third-party software notices drifted; run npm run generate:release-readiness:third-party-notices.')
  console.log(`Third-party software notices verified (${Buffer.byteLength(rendered)} bytes).`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
