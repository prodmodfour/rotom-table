#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function section(source, heading, nextLevel = 2) {
  const marker = `${'#'.repeat(nextLevel)} ${heading}`
  const start = source.indexOf(marker)
  assert(start >= 0, `Release notes omit required section: ${marker}`)
  const rest = source.slice(start + marker.length)
  const next = rest.search(new RegExp(`\\n#{1,${nextLevel}} `, 'u'))
  return next < 0 ? rest : rest.slice(0, next)
}

async function verifyLocalLinks(repositoryPath, source) {
  const sourceDirectory = path.dirname(path.join(repositoryRoot, repositoryPath))
  const links = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)].map(match => match[1].split('#')[0])
  for (const link of links) {
    if (!link || /^(?:https?:|mailto:|\/)/u.test(link)) continue
    const resolved = path.resolve(sourceDirectory, decodeURIComponent(link))
    assert(resolved.startsWith(`${repositoryRoot}${path.sep}`), `Release-note link escapes the repository: ${link}`)
    try {
      await access(resolved)
    } catch {
      throw new Error(`Broken local release-note link in ${repositoryPath}: ${link}`)
    }
  }
}

async function main() {
  const packageJson = await readFile(path.join(repositoryRoot, 'package.json'), 'utf8').then(JSON.parse)
  const notesPath = `docs/releases/${packageJson.version}.md`
  const [notes, knownLimitations] = await Promise.all([
    readFile(path.join(repositoryRoot, notesPath), 'utf8'),
    readFile(path.join(repositoryRoot, 'data/release-readiness/known-limitations.v1.json'), 'utf8').then(JSON.parse),
  ])

  if (packageJson.version === '1.0.1') {
    assert(notes.startsWith('# Rotom Table 1.0.1 release notes\n'), 'Patch release notes title drifted.')
    for (const heading of ['Why this patch exists', 'Deterministic build repair', 'Release identity', 'Deployment and campaign data', 'Verification and publication boundary']) {
      section(notes, heading, 3)
    }
    for (const requirement of [
      '> **Released locally:** Rotom Table 1.0.1',
      'immutable, unpublished `v1.0.0`',
      'released-identity-verification.v1.json',
      'version `1.0.1` and storage schema v56',
      'npm ci --include=dev',
      'SOURCE_DATE_EPOCH',
      'second clean exact-lock build',
      'reproduces every output checksum',
      'No database migration is introduced',
      'Database downgrade remains unsupported',
      'remote publication, deployment, artifact upload, and evidence upload remain unauthorized',
      '1,460-file recommendation-5 Trainer-profile residual risk',
      '`legalClearanceClaimed: false`',
    ]) {
      assert(notes.toLowerCase().includes(requirement.toLowerCase()), `Patch release notes omit: ${requirement}`)
    }
    assert(!/(?:password|token|secret)\s*[=:]\s*[^\s<]+/iu.test(notes), 'Patch release notes appear to contain a credential value.')
    assert(!/\b(?:\d{1,3}\.){3}\d{1,3}\b/u.test(notes.replaceAll('127.0.0.1', '')), 'Patch release notes contain an unapproved host address.')
    await verifyLocalLinks(notesPath, notes)
    assert(packageJson.scripts?.['check:release-readiness:release-notes'] === 'node scripts/release-readiness/check-release-notes.mjs', 'Release-notes drift command is not registered.')
    console.log('Patch release notes verified: deterministic repair, unchanged schema/mechanics, exact checksum gate, immutable predecessor, and owner-controlled publication.')
    return
  }

  const finalRelease = packageJson.version === '1.0.0'
  assert(notes.startsWith('# Rotom Table 1.0 release notes\n'), 'Release notes title drifted.')
  if (finalRelease) {
    const releasedMarker = '> **Released:** Rotom Table 1.0.0 was released on 2026-08-28'
    const verificationHoldMarker = '> **Released locally, verification hold:** Rotom Table 1.0.0 was minted on 2026-08-28'
    assert(notes.includes(releasedMarker) || notes.includes(verificationHoldMarker), 'Release notes omit the final transaction marker and date.')
    if (notes.includes(verificationHoldMarker)) {
      for (const boundary of ['failed exact checksum reproduction', 'was never published', 'Do not publish or deploy it as a verified release', 'released-identity-verification.v1.json', 'separately authorized `1.0.1` successor']) {
        assert(notes.includes(boundary), `Release-note verification hold omits: ${boundary}`)
      }
    }
    assert(notes.includes('These surfaces report `1.0.0` and storage schema v56.'), 'Release-note final identity disagrees with package.json.')
    assert(!notes.includes('> **Release-candidate document:**'), 'Release notes retain the candidate marker after release.')
  } else {
    assert(notes.includes('> **Release-candidate document:**'), 'Release notes must fail closed as release-candidate material before P13-084.')
    assert(notes.includes(`currently \`${packageJson.version}\``), 'Release-note candidate identity disagrees with package.json.')
    assert(!/^## 1\.0\.0 - \d{4}-\d{2}-\d{2}$/mu.test(notes), 'Release notes claim a final dated 1.0.0 before the atomic transaction.')
  }

  const operator = section(notes, 'Operator release notes')
  const operatorHeadings = [
    'Supported production shape',
    'Release identity and health',
    'Source install and service update',
    'Campaign storage authority',
    'Upgrade guarantee',
    'Backup, restore, and recovery',
    'Retired seams and changed operator behavior',
    'Notices and redistribution boundary',
    'Post-deploy acceptance',
  ]
  for (const heading of operatorHeadings) {
    const body = section(operator, heading, 3)
    assert(body.includes('Evidence:'), `Operator release-note section lacks a certification trace: ${heading}`)
  }

  const requiredEvidence = [
    'supported-platform-matrix.v1.json',
    'deployment-instruction-certification.v1.json',
    'version-identity-certification.v1.json',
    'distribution-manifest.v1.json',
    'private-artifact-audit.v1.json',
    'canonical-census.v1.json',
    'catalog-regression-certification.v1.json',
    'supported-upgrade-inputs.v1.json',
    'upgrade-certification.v1.json',
    'backup-restore-certification.v1.json',
    'canonical-audit-reachability.v1.json',
    'documentary-tree-disposition.v1.json',
    'distribution-notices-certification.v1.json',
    'licensing-notice-disposition.v1.json',
    'release-golden-journey.v1.json',
  ]
  for (const artifact of requiredEvidence) assert(operator.includes(artifact), `Operator release notes omit certified evidence: ${artifact}`)

  const gm = section(notes, 'GM release notes')
  const gmHeadings = [
    'A complete preparation-to-continuation loop',
    'Field Guide and Workshop',
    'Live Encounter direction',
    'Private generation and session preparation',
    'GM role expectations',
  ]
  for (const heading of gmHeadings) assert(section(gm, heading, 3).includes('Evidence:'), `GM release-note section lacks a certification trace: ${heading}`)

  const player = section(notes, 'Player release notes')
  const playerHeadings = [
    'One connected campaign experience',
    'Role-safe live encounters',
    'Character and long-term workflows',
    'Player role expectations',
    'Player-safe example',
  ]
  for (const heading of playerHeadings) assert(section(player, heading, 3).includes('Evidence:'), `Player release-note section lacks a certification trace: ${heading}`)

  for (const artifact of [
    'mechanics-registry-finality.v1.json',
    'release-golden-replay-report.v1.json',
    'final-acceptance.v1.json',
    'role-projections.v1.json',
    'release-privacy-report.v1.json',
  ]) {
    assert(gm.includes(artifact), `GM release notes omit certified capability evidence: ${artifact}`)
  }
  for (const artifact of ['release-golden-journey.v1.json', 'role-projections.v1.json', 'release-privacy-report.v1.json']) {
    assert(player.includes(artifact), `Player release notes omit role-safe evidence: ${artifact}`)
  }

  assert(player.includes('This example intentionally names no hidden target, unrevealed stat block, generation seed, GM note, or private reward.'), 'Player example does not state its no-private-data boundary.')
  for (const forbidden of ['candidate-pools', 'random-journals', 'source-hashes', 'diagnostics', 'unresolved-private-decisions', 'archetype-policy-internals']) {
    assert(!player.includes(forbidden), `Player release notes leak a GM-private projection field: ${forbidden}`)
  }

  for (const requirement of [
    'Node `>=24 <25`',
    'npm ci --include=dev',
    'NITRO_HOST=127.0.0.1',
    'ROTOM_ENABLE_HOSTED_WRITES=1',
    'npm run upgrade:campaign',
    'npm run migrate:sqlite',
    'npm run backup:campaign',
    'npm run restore:campaign',
    'Database downgrade is unsupported; rollback means restoring the exact pre-upgrade backup.',
    'not public authentication',
    'Local hosting is deprecated',
    'documentary material are never production fallback sources',
    'Publication of release tags, checksums, provenance, or hosted URLs remains owner-controlled.',
  ]) {
    assert(operator.includes(requirement), `Operator release notes omit required guarantee or boundary: ${requirement}`)
  }

  const limitations = section(notes, 'Known limitations (frozen)')
  const renderedLimitations = [...limitations.matchAll(/^- (.+)$/gmu)].map(match => match[1])
  assert(knownLimitations.status === 'OWNER_ACCEPTED_FROZEN', 'Known-limitations register is not owner-accepted and frozen.')
  assert(knownLimitations.ownerAcceptance?.renderedAt === `${notesPath}#known-limitations-frozen`, 'Known-limitations render target drifted.')
  assert(renderedLimitations.length === knownLimitations.rows.length, 'Known-limitations section must contain exactly the registered rows.')
  for (const [index, row] of knownLimitations.rows.entries()) {
    assert(renderedLimitations[index] === row.statement, `Known limitation is not rendered verbatim or in register order: ${row.id}`)
  }
  assert(limitations.includes('These are the only release-gate outcomes allowed to close as **Documented boundary**.'), 'Known-limitations section blurs the documented-boundary allowlist.')
  assert(limitations.includes('release-note wording cannot convert it into a limitation.'), 'Known-limitations section does not preserve blocker precedence.')

  assert(!/(?:password|token|secret)\s*[=:]\s*[^\s<]+/iu.test(notes), 'Release notes appear to contain a credential value.')
  assert(!/\b(?:\d{1,3}\.){3}\d{1,3}\b/u.test(notes.replaceAll('127.0.0.1', '')), 'Release notes contain an unapproved host address.')
  await verifyLocalLinks(notesPath, notes)

  assert(packageJson.scripts?.['check:release-readiness:release-notes'] === 'node scripts/release-readiness/check-release-notes.mjs', 'Release-notes drift command is not registered.')
  console.log(`Release notes verified: ${operatorHeadings.length} operator, ${gmHeadings.length} GM, ${playerHeadings.length} player, and ${renderedLimitations.length} verbatim frozen-limitations rows; all links resolve.`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
