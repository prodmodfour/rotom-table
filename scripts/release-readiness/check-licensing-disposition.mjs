#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const dispositionPath = path.join(repositoryRoot, 'data/release-readiness/licensing-notice-disposition.v1.json')

const sha256 = value => createHash('sha256').update(value).digest('hex')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function exists(repositoryPath) {
  try {
    await lstat(path.join(repositoryRoot, repositoryPath))
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function filesBelow(repositoryPath) {
  const absoluteRoot = path.join(repositoryRoot, repositoryPath)
  if (!await exists(repositoryPath)) return []
  const result = []
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolutePath)
      else if (entry.isFile()) result.push(path.relative(repositoryRoot, absolutePath))
    }
  }
  await visit(absoluteRoot)
  return result.sort()
}

async function main() {
  const dispositionSource = await readFile(dispositionPath)
  const disposition = JSON.parse(dispositionSource.toString('utf8'))
  assert(disposition.ticket === 'P13-062', 'Licensing disposition ticket drifted.')
  assert(disposition.status === 'OWNER_APPROVED_AND_IMPLEMENTED', 'P13-062 owner disposition is not final.')
  assert(disposition.automationMayApprove === false, 'Licensing automation may not claim owner approval.')
  assert(disposition.legalClearanceClaimed === false, 'The disposition must not claim legal clearance.')

  assert(disposition.recommendations.length === 8, 'P13-062 must record all eight recommendations.')
  assert(disposition.recommendations.map(row => row.number).join(',') === '1,2,3,4,5,6,7,8', 'Recommendation numbering drifted.')
  for (const row of disposition.recommendations) {
    if (row.number === 5) {
      assert(row.decision === 'DECLINED_OWNER_ACCEPTED_RISK', 'Recommendation 5 must remain the explicit owner-accepted exception.')
      assert(row.riskNotCuredByNotice === true, 'Recommendation 5 disclosure must not be represented as a cure.')
    } else {
      assert(row.decision === 'ACCEPTED_IMPLEMENTED', `Accepted recommendation ${row.number} is not implemented.`)
    }
  }

  const expectedFamilies = [
    'license-scope',
    'fan-content-posture',
    'ptu-derived-data-and-text',
    'sprites-and-media',
    'fonts',
    'npm-dependencies',
    'python-dependencies',
    'existing-notices',
  ]
  assert(disposition.familyDispositions.map(row => row.id).join(',') === expectedFamilies.join(','), 'Licensing family disposition set drifted.')
  assert(disposition.familyDispositions.every(row => row.disposition.startsWith('APPROVED_')), 'A licensing family lacks explicit owner approval.')

  for (const source of disposition.sources) {
    const bytes = await readFile(path.join(repositoryRoot, source.path))
    assert(sha256(bytes) === source.sha256, `P13-062 source hash drifted: ${source.path}`)
  }

  const [inventory, media, dependencies, packageJson, notice, fanNotice, attribution, thirdParty, requirements, typeBadge, categoryBadge, scenePanel, blockTextures, favicon] = await Promise.all([
    readFile(path.join(repositoryRoot, 'data/release-readiness/licensing-attribution-inventory.v1.json'), 'utf8').then(JSON.parse),
    readFile(path.join(repositoryRoot, 'data/release-readiness/media-asset-inventory.v1.json'), 'utf8').then(JSON.parse),
    readFile(path.join(repositoryRoot, 'data/release-readiness/dependency-license-report.v1.json'), 'utf8').then(JSON.parse),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(repositoryRoot, 'NOTICE.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs/fan-project-notice.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs/media-attribution.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'public/THIRD_PARTY_NOTICES.txt'), 'utf8'),
    readFile(path.join(repositoryRoot, 'requirements.txt'), 'utf8'),
    readFile(path.join(repositoryRoot, 'src/components/TypeBadge.vue'), 'utf8'),
    readFile(path.join(repositoryRoot, 'src/components/DamageClassBadge.vue'), 'utf8'),
    readFile(path.join(repositoryRoot, 'src/components/map/MapScenePanel.vue'), 'utf8'),
    readFile(path.join(repositoryRoot, 'src/utils/isometric/blockTextures.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'public/favicon.svg'), 'utf8'),
  ])

  assert(inventory.status === 'OWNER_DISPOSITION_RECORDED', 'Licensing inventory is still unresolved.')
  assert(inventory.families.length === 8 && inventory.families.every(row => row.disposition !== 'UNRESOLVED'), 'Licensing inventory contains unresolved families.')
  assert(inventory.inventorySummary.unknownProvenanceMediaFiles === 0, 'Unknown-provenance media remain after recommendation 4.')
  assert(inventory.inventorySummary.explicitSourceRestrictionConflictFiles === 1460, 'Accepted Trainer-profile risk count drifted.')

  assert(media.status === 'OWNER_DISPOSITION_RECORDED', 'Media inventory is still unresolved.')
  assert(media.summary.unknownProvenanceFiles === 0, 'Media inventory still contains unknown-provenance files.')
  assert(media.summary.unclassifiedMediaFiles === 0 && media.summary.ambiguousMediaFiles === 0, 'Media inventory classification has gaps.')
  assert(media.summary.explicitRestrictionConflictFiles === 1460, 'Media accepted-risk count drifted.')
  const trainerProfiles = media.families.find(row => row.id === 'public-trainer-profile-sprites')
  assert(trainerProfiles?.ownerDisposition === 'RETAIN_OWNER_ACCEPTED_RISK_RECOMMENDATION_5', 'Trainer-profile risk is not explicitly dispositioned.')
  assert(trainerProfiles.pathSetSha256 === disposition.acceptedRisk.pathSetSha256, 'Trainer-profile accepted-risk path set drifted.')
  assert(trainerProfiles.contentSetSha256 === disposition.acceptedRisk.contentSetSha256, 'Trainer-profile accepted-risk content set drifted.')

  assert(dependencies.status === 'OWNER_DISPOSITION_RECORDED', 'Dependency report is still unresolved.')
  assert(dependencies.summary.pythonResolutionLockBound === true, 'Python dependency graph is not exact-version lock-bound.')
  assert(dependencies.summary.unknownEntries === 0, 'Dependency report contains unknown licenses.')
  assert(dependencies.summary.potentiallyIncompatibleCopyleftEntries === 0, 'Dependency report contains mandatory incompatible copyleft.')
  assert(dependencies.ownerGate.disposition === 'OWNER_APPROVED_WITH_REMEDIATION', 'Dependency owner gate is not resolved.')
  assert(dependencies.pythonPackages.every(row => row.resolution === 'exact-version-lock-bound'), 'A Python dependency is not exactly pinned.')

  const requirementLines = requirements.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  assert(requirementLines.length === 6, 'Python lock must contain exactly six helper packages.')
  assert(requirementLines.every(line => /^[A-Za-z0-9._-]+==[^=<>!~\s]+$/.test(line)), 'Python helper graph contains a non-exact requirement.')
  assert(requirementLines.join('\n') === dependencies.pythonPackages.map(row => row.requirement).join('\n'), 'Python lock and dependency report disagree.')

  const retiredFiles = [
    ...(await filesBelow('public/badges')),
    ...(await filesBelow('public/textures/clear-water-4.0')),
  ]
  assert(retiredFiles.length === 0, `Retired unknown-source assets remain: ${retiredFiles.join(', ')}`)
  assert(!await exists('public/favicon.png'), 'Unknown-source PNG favicon remains.')
  assert(!await exists('public/map/live-play-saving-icon.png'), 'Unknown-source saving icon remains.')
  assert(await exists('public/favicon.svg'), 'Original SVG favicon is missing.')
  assert(!favicon.includes('<image') && !favicon.includes('<text') && !/(?:href|src)=["']https?:\/\//.test(favicon), 'Original favicon must not embed external images, fonts, or URLs.')
  assert(!typeBadge.includes('<img') && !typeBadge.includes('/badges/'), 'Type badges still depend on retired images.')
  assert(!categoryBadge.includes('<img') && !categoryBadge.includes('/badges/'), 'Damage-class badges still depend on retired images.')
  assert(!scenePanel.includes('live-play-saving-icon.png'), 'Live-play saving state still depends on the retired image.')
  assert(!blockTextures.includes('TextureLoader') && !blockTextures.includes('/textures/'), 'Voxel water still loads the retired texture pack.')

  for (const requiredText of [
    'not permission or legal clearance',
    'recommendation 5',
    'PokéSprite',
    'Pokémon Database',
    'Pokémon Showdown',
    'SIL Open Font License 1.1',
    'THIRD_PARTY_NOTICES.txt',
  ]) {
    assert(`${notice}\n${fanNotice}\n${attribution}`.toLowerCase().includes(requiredText.toLowerCase()), `Required notice disclosure is missing: ${requiredText}`)
  }
  for (const artist of ['Beliot419', 'Brumirage', 'Fifty Shades of Rez', 'kyledove', 'ZacWeavile']) {
    assert(attribution.includes(artist), `Trainer artist credit is missing: ${artist}`)
  }
  for (const packageId of [
    '@fontsource/atkinson-hyperlegible@5.2.8',
    '@fontsource/eb-garamond@5.2.7',
    '@fontsource/jetbrains-mono@5.2.8',
    'lightningcss@1.33.0',
    'node-forge@1.4.0',
  ]) {
    assert(thirdParty.includes(packageId), `Third-party notice bundle omits ${packageId}.`)
  }
  for (const row of dependencies.pythonPackages) {
    assert(thirdParty.includes(`${row.name}@${row.version} | license=${row.license}`), `Third-party notice bundle omits Python package ${row.name}.`)
  }

  assert(packageJson.license === 'SEE LICENSE IN LICENSE', 'Package metadata no longer preserves the scope-limited repository license boundary.')
  assert(packageJson.scripts['check:release-readiness:licensing'] === 'node scripts/release-readiness/check-licensing-disposition.mjs', 'Licensing gate is not registered.')
  assert(packageJson.scripts['check:release-readiness:licensing-inventories'].includes('check:release-readiness:licensing'), 'Aggregate licensing gate omits the owner disposition check.')

  console.log(`Licensing disposition verified: ${inventory.families.length}/8 families approved, ${media.summary.unknownProvenanceFiles} unknown-provenance media, one recorded ${media.summary.explicitRestrictionConflictFiles}-file owner-accepted exception.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
