#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = path => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'))
const runGit = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const fail = message => { throw new Error(message) }

try {
  const pkg = readJson('package.json')
  const lock = readJson('package-lock.json')
  const policy = readJson('data/release-readiness/version-policy.v1.json')
  const mints = readJson('data/release-readiness/version-mints.v1.json')
  const inventory = readJson('data/release-readiness/version-surface-inventory.v1.json')
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(pkg.version)) fail('package.json version is not SemVer')
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) fail('package-lock release identity disagrees with package.json')
  if (policy.sourceOfTruth !== 'package.json#/version') fail('Version policy source of truth drift')
  if (mints.mints?.at(-1)?.to !== pkg.version) fail('Package version was edited outside the mint authority')
  const seen = new Set()
  let previous = 'NONE'
  for (const [index, mint] of mints.mints.entries()) {
    if (mint.sequence !== index + 1 || mint.from !== previous || seen.has(mint.to) || mint.tag !== `v${mint.to}`) {
      fail('Version mint history is non-contiguous, duplicated, or malformed')
    }
    seen.add(mint.to)
    previous = mint.to
  }
  for (const surface of inventory.requiredSurfaces.filter(surface => ['package', 'shared-module'].includes(surface.id))) {
    try { readFileSync(resolve(ROOT, surface.path)) } catch { fail(`Required identity surface is absent: ${surface.id} (${surface.path})`) }
  }
  for (const path of ['server/api/health.get.ts', 'server/api/version.get.ts', 'src/components/settings/SettingsPanel.client.vue', 'nuxt.config.ts']) {
    const source = readFileSync(resolve(ROOT, path), 'utf8')
    if (source.includes(`'${pkg.version}'`) || source.includes(`"${pkg.version}"`)) fail(`Duplicated runtime version literal in ${path}`)
  }
  const finalAcceptancePath = 'data/release-readiness/final-acceptance.v1.json'
  const releasedIdentityPath = 'data/release-readiness/released-identity-verification.v1.json'
  if (pkg.version === '1.0.0') {
    const finalAcceptance = readJson(finalAcceptancePath)
    if (finalAcceptance.status !== 'accepted'
      || finalAcceptance.version !== pkg.version
      || finalAcceptance.tag !== `v${pkg.version}`
      || finalAcceptance.productPhase !== 'released') {
      fail('Final package identity disagrees with the machine-readable 1.0 acceptance record')
    }
  }
  if (pkg.version === '1.0.1') {
    const releasedIdentity = readJson(releasedIdentityPath)
    if (!['PATCH_TRANSACTION_ACCEPTED_VERIFICATION_PENDING', 'VERIFIED'].includes(releasedIdentity.status)
      || releasedIdentity.patchRelease?.version !== pkg.version
      || releasedIdentity.patchRelease?.tag !== `v${pkg.version}`
      || releasedIdentity.ownerPatchDecision?.decision !== 'GO') {
      fail('Patch package identity disagrees with the machine-readable released-identity transaction')
    }
  }
  if (process.argv.includes('--require-tag')) {
    const tag = `v${pkg.version}`
    const tagType = runGit(['cat-file', '-t', tag])
    if (tagType !== 'tag') fail(`${tag} must be an annotated tag`)
    if (runGit(['rev-list', '-n', '1', tag]) !== runGit(['rev-parse', 'HEAD'])) fail(`${tag} does not point at HEAD`)
    const subject = runGit(['for-each-ref', '--format=%(subject)', `refs/tags/${tag}`])
    if (!subject.includes(pkg.version)) fail(`${tag} annotation does not identify ${pkg.version}`)
    if (pkg.version === '1.0.0') {
      const taggedAcceptance = runGit(['show', `${tag}:${finalAcceptancePath}`])
      const currentAcceptance = readFileSync(resolve(ROOT, finalAcceptancePath), 'utf8').trim()
      if (taggedAcceptance !== currentAcceptance) fail(`${tag} does not bind the current final acceptance record`)
    }
    if (pkg.version === '1.0.1') {
      const taggedVerification = JSON.parse(runGit(['show', `${tag}:${releasedIdentityPath}`]))
      if (taggedVerification.status !== 'PATCH_TRANSACTION_ACCEPTED_VERIFICATION_PENDING'
        || taggedVerification.ownerPatchDecision?.decision !== 'GO') {
        fail(`${tag} does not bind the owner-approved patch transaction`)
      }
    }
  }
  process.stdout.write(`Release identity guard passed for ${pkg.version} across package, lock, mint history, server, UI, and build configuration.\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
