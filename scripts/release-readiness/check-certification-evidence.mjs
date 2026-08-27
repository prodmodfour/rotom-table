#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const artifactArg = (() => {
  const index = process.argv.indexOf('--artifact')
  return index >= 0 ? process.argv[index + 1] : null
})()
if (!artifactArg) {
  process.stderr.write('Usage: node scripts/release-readiness/check-certification-evidence.mjs --artifact <path>\n')
  process.exit(2)
}
const fail = message => { throw new Error(message) }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
try {
  const artifactPath = resolve(ROOT, artifactArg)
  if (!existsSync(artifactPath)) fail(`Missing certification artifact: ${artifactArg}`)
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
  if (!['Certified', 'Approved', 'Documented boundary', 'Repaired', 'accepted'].includes(artifact.status)) {
    fail(`Certification is not final: ${artifact.status}`)
  }
  if (Array.isArray(artifact.gateRows)) {
    const ids = new Set()
    for (const row of artifact.gateRows) {
      if (!row.id || ids.has(row.id)) fail('Certification gate row ids must be unique and non-empty')
      ids.add(row.id)
      if (!['Certified', 'Approved', 'Documented boundary', 'Repaired'].includes(row.state)) fail(`Non-final gate row ${row.id}: ${row.state}`)
    }
  }
  for (const evidence of artifact.sourceEvidence ?? []) {
    const path = resolve(ROOT, evidence.path)
    if (!existsSync(path)) fail(`Missing source evidence: ${evidence.path}`)
    const actual = sha256(readFileSync(path))
    if (actual !== evidence.sha256) fail(`Source evidence drift: ${evidence.path}; expected ${evidence.sha256}, got ${actual}`)
  }
  process.stdout.write(`Certification evidence check passed: ${artifactArg} (${artifact.sourceEvidence?.length ?? 0} bound source files).\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
