#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const PACKAGE_PATH = resolve(ROOT, 'package.json')
const LOCK_PATH = resolve(ROOT, 'package-lock.json')
const LOG_PATH = resolve(ROOT, 'data/release-readiness/version-mints.v1.json')
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

const fail = message => {
  throw new Error(message)
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, index, all) => {
  if (!arg.startsWith('--')) return pairs
  pairs.push([arg.slice(2), all[index + 1]])
  return pairs
}, []))

const from = args.from
const to = args.to
const ticket = args.ticket
const recordedAt = args['recorded-at']
if (!from || !to || !ticket || !recordedAt) {
  process.stderr.write('Usage: node scripts/release-readiness/mint-version.mjs --from <NONE|version> --to <version> --ticket <ticket> --recorded-at <YYYY-MM-DD>\n')
  process.exit(2)
}
if (!SEMVER.test(to)) fail(`Invalid semantic version: ${to}`)
if (!/^P\d{1,3}-\d{3}$/.test(ticket)) fail(`Invalid reviewed implementation ticket: ${ticket}`)
if (!/^\d{4}-\d{2}-\d{2}$/.test(recordedAt)) fail(`Invalid recorded date: ${recordedAt}`)

const pkg = readJson(PACKAGE_PATH)
const current = typeof pkg.version === 'string' ? pkg.version : 'NONE'
if (current !== from) fail(`Version mint expected ${from}, found ${current}`)

const allowed = (() => {
  if (from === 'NONE') return to === '1.0.0-rc.1'
  const rc = /^1\.0\.0-rc\.(\d+)$/.exec(from)
  const nextRc = /^1\.0\.0-rc\.(\d+)$/.exec(to)
  if (rc && nextRc) return Number(nextRc[1]) === Number(rc[1]) + 1
  if (rc && to === '1.0.0') return true
  const patch = /^1\.0\.(\d+)$/.exec(from)
  const nextPatch = /^1\.0\.(\d+)$/.exec(to)
  return Boolean(patch && nextPatch && Number(nextPatch[1]) === Number(patch[1]) + 1)
})()
if (!allowed) fail(`Version transition is not allowed by policy: ${from} -> ${to}`)

const nextPackage = Object.fromEntries([
  ['name', pkg.name],
  ['version', to],
  ...Object.entries(pkg).filter(([key]) => key !== 'name' && key !== 'version'),
])
const lock = readJson(LOCK_PATH)
const rootPackage = lock.packages?.['']
if (!rootPackage || rootPackage.name !== pkg.name) fail('package-lock root metadata is missing or disagrees with package.json')
const nextLock = Object.fromEntries([
  ['name', lock.name],
  ['version', to],
  ...Object.entries(lock).filter(([key]) => key !== 'name' && key !== 'version'),
])
nextLock.packages[''] = Object.fromEntries([
  ['name', rootPackage.name],
  ['version', to],
  ...Object.entries(rootPackage).filter(([key]) => key !== 'name' && key !== 'version'),
])

let log
try {
  log = readJson(LOG_PATH)
} catch {
  log = { artifact: 'release-version-mints', schemaVersion: 1, sourceOfTruth: 'package.json#/version', mints: [] }
}
if (!Array.isArray(log.mints)) fail('Version mint log is malformed')
if (log.mints.some(entry => entry.to === to)) fail(`Version ${to} has already been minted`)
log.mints.push({ sequence: log.mints.length + 1, from, to, ticket, recordedAt, tag: `v${to}` })

writeJson(PACKAGE_PATH, nextPackage)
writeJson(LOCK_PATH, nextLock)
writeJson(LOG_PATH, log)
process.stdout.write(`Minted Rotom Table ${to} through ${ticket}; package and lock metadata agree.\n`)
