#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const policyPath = path.join(repositoryRoot, 'data/release-readiness/media-asset-policy.v1.json')
const reportPath = path.join(repositoryRoot, 'data/release-readiness/media-asset-inventory.v1.json')
const nuxtConfigPath = path.join(repositoryRoot, 'nuxt.config.ts')
const audioExtensions = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a'])
const fontExtensions = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot'])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function matchesFamily(repositoryPath, family) {
  return (family.exactPaths ?? []).includes(repositoryPath)
    || (family.prefixes ?? []).some((prefix) => repositoryPath.startsWith(prefix))
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

async function distributionCandidatePaths() {
  const raw = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repositoryRoot },
  ).toString('utf8')
  const candidates = [...new Set(raw.split('\0').filter(Boolean))].sort()
  const existing = []
  for (const repositoryPath of candidates) {
    try {
      const stats = await lstat(path.join(repositoryRoot, repositoryPath))
      if (stats.isFile()) existing.push(repositoryPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return existing
}

async function inventoryFonts(policy, nuxtConfigSource) {
  const imports = [...nuxtConfigSource.toString('utf8').matchAll(/['"](@fontsource\/[^'"]+\.css)['"]/g)]
    .map((match) => match[1])
  assert(imports.length > 0, 'No Fontsource CSS imports found in nuxt.config.ts.')

  const policyByPackage = new Map(policy.fontFamilies.map((entry) => [entry.package, entry]))
  const binaries = new Map()
  const importRows = []

  for (const importedCss of imports) {
    const packageName = importedCss.split('/').slice(0, 2).join('/')
    const familyPolicy = policyByPackage.get(packageName)
    assert(familyPolicy, `Font import has no provenance policy: ${importedCss}`)

    const cssPath = path.join(repositoryRoot, 'node_modules', importedCss)
    const cssSource = await readFile(cssPath)
    const urls = [...cssSource.toString('utf8').matchAll(/url\(([^)]+)\)/g)]
      .map((match) => match[1].replace(/["']/g, ''))
    assert(urls.length > 0, `Font CSS has no binary URLs: ${importedCss}`)

    const binaryPaths = []
    for (const url of urls) {
      const absoluteBinary = path.resolve(path.dirname(cssPath), url)
      const extension = path.extname(absoluteBinary).toLowerCase()
      assert(fontExtensions.has(extension), `Unexpected Fontsource binary extension: ${absoluteBinary}`)
      const relativeNodeModulesPath = path.relative(path.join(repositoryRoot, 'node_modules'), absoluteBinary)
      const source = await readFile(absoluteBinary)
      binaries.set(relativeNodeModulesPath, {
        pathAfterNpmCi: `node_modules/${relativeNodeModulesPath}`,
        package: packageName,
        sha256: sha256(source),
      })
      binaryPaths.push(`node_modules/${relativeNodeModulesPath}`)
    }

    importRows.push({
      cssImport: importedCss,
      package: packageName,
      family: familyPolicy.family,
      license: familyPolicy.license,
      sourceUrl: familyPolicy.sourceUrl,
      binaryPaths,
    })
  }

  const packagesUsed = [...new Set(importRows.map((row) => row.package))].sort()
  assert(packagesUsed.length === policy.fontFamilies.length, 'Font provenance policy contains an unused or missing family.')
  return {
    cssImports: importRows,
    binaries: [...binaries.values()].sort((left, right) => left.pathAfterNpmCi.localeCompare(right.pathAfterNpmCi)),
    packagesUsed,
  }
}

async function buildReport() {
  const [policySource, nuxtConfigSource, candidates] = await Promise.all([
    readFile(policyPath),
    readFile(nuxtConfigPath),
    distributionCandidatePaths(),
  ])
  const policy = JSON.parse(policySource.toString('utf8'))
  assert(policy.schemaVersion === 1, 'Media asset policy schema drifted.')
  const mediaExtensions = new Set(policy.mediaExtensions)
  const mediaPaths = candidates.filter((repositoryPath) => mediaExtensions.has(path.extname(repositoryPath).toLowerCase()))

  const familyPaths = new Map(policy.families.map((family) => [family.id, []]))
  const unclassified = []
  const ambiguous = []
  for (const repositoryPath of mediaPaths) {
    const matching = policy.families.filter((family) => matchesFamily(repositoryPath, family))
    if (matching.length === 0) unclassified.push(repositoryPath)
    else if (matching.length > 1) ambiguous.push({ path: repositoryPath, families: matching.map((family) => family.id) })
    else familyPaths.get(matching[0].id).push(repositoryPath)
  }
  assert(unclassified.length === 0, `Unclassified media assets: ${unclassified.slice(0, 20).join(', ')}`)
  assert(ambiguous.length === 0, `Ambiguous media assets: ${ambiguous.slice(0, 20).map((entry) => entry.path).join(', ')}`)

  const families = []
  for (const family of policy.families) {
    const paths = familyPaths.get(family.id)
    assert(paths.length > 0, `Media asset family is empty: ${family.id}`)
    const extensionCounts = new Map()
    const contentLines = []
    for (const repositoryPath of paths) {
      const extension = path.extname(repositoryPath).toLowerCase()
      extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1)
      contentLines.push(`${repositoryPath}\0${sha256(await readFile(path.join(repositoryRoot, repositoryPath)))}`)
    }
    families.push({
      ...family,
      pathCount: paths.length,
      extensionCounts: sortedObject(extensionCounts),
      pathSetSha256: sha256(`${paths.join('\n')}\n`),
      contentSetSha256: sha256(`${contentLines.join('\n')}\n`),
    })
  }

  const fontInventory = await inventoryFonts(policy, nuxtConfigSource)
  const unknownProvenanceFiles = families
    .filter((family) => family.rightsPosture.startsWith('unknown-provenance'))
    .reduce((total, family) => total + family.pathCount, 0)
  const unknownRedistributionFiles = families
    .filter((family) => family.rightsPosture.includes('redistribution-license-unknown'))
    .reduce((total, family) => total + family.pathCount, 0)
  const explicitRestrictionConflictFiles = families
    .filter((family) => family.rightsPosture.includes('conflicts-with-source-do-not-edit-warning'))
    .reduce((total, family) => total + family.pathCount, 0)
  const potentialBlockerFiles = families
    .filter((family) => family.potentialBlocker)
    .reduce((total, family) => total + family.pathCount, 0)

  return {
    artifact: 'release-media-asset-inventory',
    schemaVersion: 1,
    inventoryId: 'p13-media-asset-inventory-v1',
    releaseVersion: '1.0.0-rc.1',
    status: 'OWNER_DISPOSITION_RECORDED',
    sources: {
      policy: { path: 'data/release-readiness/media-asset-policy.v1.json', sha256: sha256(policySource) },
      nuxtConfig: { path: 'nuxt.config.ts', sha256: sha256(nuxtConfigSource) },
      trackedAndCandidateCommand: 'git ls-files --cached --others --exclude-standard -z',
    },
    summary: {
      sourceDistributionMediaFiles: mediaPaths.length,
      uniquelyClassifiedMediaFiles: mediaPaths.length,
      unclassifiedMediaFiles: 0,
      ambiguousMediaFiles: 0,
      mediaFamilies: families.length,
      runtimeFontPackages: fontInventory.packagesUsed.length,
      runtimeFontCssImports: fontInventory.cssImports.length,
      runtimeFontBinariesAfterNpmCi: fontInventory.binaries.length,
      audioFiles: mediaPaths.filter((repositoryPath) => audioExtensions.has(path.extname(repositoryPath).toLowerCase())).length,
      unknownProvenanceFiles,
      unknownRedistributionFiles,
      explicitRestrictionConflictFiles,
      potentialBlockerFiles,
    },
    families,
    fonts: {
      rightsPosture: 'OFL-1.1-attribution-required',
      ownerReview: 'P13-062',
      ...fontInventory,
    },
    flags: families
      .filter((family) => family.ownerReview)
      .map((family) => ({
        id: family.id,
        affectedFiles: family.pathCount,
        rightsPosture: family.rightsPosture,
        severity: family.ownerDisposition?.includes('ACCEPTED_RISK')
          ? 'owner-accepted-risk'
          : family.ownerDisposition
            ? 'owner-remediated'
            : 'owner-reviewed',
      })),
    ownerGate: policy.ownerGate,
  }
}

async function main() {
  const write = process.argv.includes('--write')
  const report = await buildReport()
  const rendered = `${JSON.stringify(report, null, 2)}\n`

  if (write) {
    await writeFile(reportPath, rendered)
    console.log(`Wrote ${path.relative(repositoryRoot, reportPath)} (${report.summary.sourceDistributionMediaFiles} media files, ${report.summary.runtimeFontBinariesAfterNpmCi} font binaries).`)
    return
  }

  const current = await readFile(reportPath, 'utf8')
  assert(current === rendered, 'Media asset inventory drifted; run npm run generate:release-readiness:media-assets.')
  console.log(`Media assets verified: ${report.summary.sourceDistributionMediaFiles} files in ${report.summary.mediaFamilies} families, ${report.summary.runtimeFontBinariesAfterNpmCi} fonts, ${report.summary.unclassifiedMediaFiles} unclassified.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
