#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')

const presentationDocuments = [
  'README.md',
  'docs/README.md',
  'docs/screenshots.md',
]

const screenshots = {
  'docs/screenshots/field-guide-pikachu.png': 'a943d2688b4746c19f7d95fb1c4878ecefd7a8754faef8bb303c5041e274ceaf',
  'docs/screenshots/release-settings.png': 'c6ac7ba34e9923d07565d49d7d7d02853b6a66a25ac87d2c26bc5c6797469516',
  'docs/screenshots/role-picker.png': '3440b686f43b9bf3e4cb09ba71fef1bc30cc798e94fee303b322f828db839d3e',
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function assertLocalLinksResolve(repositoryPath, source) {
  const linkPattern = /\]\(([^)]+)\)/g
  const missing = []
  let match

  while ((match = linkPattern.exec(source)) !== null) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '').split(/\s+["']/)[0]
    if (!rawTarget || /^(?:[a-z]+:|#)/i.test(rawTarget)) continue

    const targetWithoutFragment = rawTarget.split('#')[0].split('?')[0]
    if (!targetWithoutFragment) continue

    const absoluteTarget = path.resolve(
      path.dirname(path.join(repositoryRoot, repositoryPath)),
      decodeURIComponent(targetWithoutFragment),
    )
    try {
      await access(absoluteTarget)
    } catch {
      missing.push(rawTarget)
    }
  }

  assert(missing.length === 0, `${repositoryPath} has missing local links: ${missing.join(', ')}`)
}

async function main() {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'))
  const packageLock = JSON.parse(await readFile(path.join(repositoryRoot, 'package-lock.json'), 'utf8'))
  const readme = await readFile(path.join(repositoryRoot, 'README.md'), 'utf8')
  const docsIndex = await readFile(path.join(repositoryRoot, 'docs/README.md'), 'utf8')
  const screenshotGuide = await readFile(path.join(repositoryRoot, 'docs/screenshots.md'), 'utf8')
  const migrations = await readFile(path.join(repositoryRoot, 'server/storage/migrations.ts'), 'utf8')
  const repositoryMetadata = JSON.parse(await readFile(
    path.join(repositoryRoot, 'data/release-readiness/repository-metadata-disposition.v1.json'),
    'utf8',
  ))

  assert(packageJson.name === 'rotom-table', 'package.json name must remain rotom-table.')
  assert(/^1\.0\.0(?:-rc\.\d+)?$/u.test(packageJson.version), 'Presentation check expects the current 1.0 release identity.')
  assert(packageJson.private === true, 'Rotom Table must remain a private npm package.')
  assert(packageJson.license === 'SEE LICENSE IN LICENSE', 'package.json must point to the repository-scoped license.')
  assert(packageJson.repository?.url === 'git+https://github.com/prodmodfour/rotom-table.git', 'Repository metadata drifted.')
  assert(packageJson.engines?.node === '>=24 <25', 'Supported Node engine must remain >=24 <25.')
  assert(/^\^4\./.test(packageJson.dependencies?.nuxt ?? ''), 'The package must use Nuxt 4.')
  assert(packageLock.packages?.['']?.license === packageJson.license, 'Package lock license metadata disagrees.')
  assert(repositoryMetadata.status === 'APPLIED', 'Remote repository metadata disposition is not applied.')
  assert(repositoryMetadata.after?.description.includes('Nuxt 4'), 'Remote repository description is stale.')
  assert(repositoryMetadata.after?.description.includes('SQLite-authoritative'), 'Remote repository persistence claim is stale.')
  assert(repositoryMetadata.after?.topics.includes('nuxt4'), 'Remote repository topics omit nuxt4.')
  assert(!repositoryMetadata.after?.topics.includes('nuxt3'), 'Remote repository topics retain nuxt3.')
  assert(!repositoryMetadata.after?.topics.includes('local-first'), 'Remote repository topics retain local-first.')

  assert(readme.includes(`The current candidate is **${packageJson.version}**`), 'README candidate identity disagrees with package.json.')
  assert(readme.includes('Nuxt 4'), 'README must identify Nuxt 4.')
  assert(!/Nuxt\s*3/i.test(readme), 'README contains stale Nuxt 3 presentation.')
  assert(readme.includes('private Linux x86-64 VPS'), 'README must state the supported deployment shape.')
  assert(readme.includes('not public authentication'), 'README must state the trusted-table role boundary.')
  assert(readme.includes('Database downgrade is unsupported'), 'README must state the rollback boundary.')
  assert(readme.includes('NOTICE.md') && readme.includes('LICENSE'), 'README must link notices and license scope.')
  assert(migrations.includes('LATEST_STORAGE_SCHEMA_VERSION = 56'), 'README schema claim no longer matches storage authority.')

  for (const routeSource of [
    'src/pages/login.vue',
    'src/pages/maps/index.vue',
    'src/pages/breeding/index.vue',
    'src/pages/contests/index.vue',
    'src/pages/session-prep.vue',
    'src/pages/settings.vue',
  ]) {
    await access(path.join(repositoryRoot, routeSource))
  }

  assert(docsIndex.includes('## Operators'), 'Documentation index must provide an operator path.')
  assert(docsIndex.includes('## GMs'), 'Documentation index must provide a GM path.')
  assert(docsIndex.includes('## Players'), 'Documentation index must provide a player path.')
  assert(docsIndex.includes('## Contributors'), 'Documentation index must provide a contributor path.')
  assert(docsIndex.includes('## Historical material'), 'Documentation index must label historical material.')

  for (const repositoryPath of presentationDocuments) {
    const source = await readFile(path.join(repositoryRoot, repositoryPath), 'utf8')
    await assertLocalLinksResolve(repositoryPath, source)
  }

  for (const [repositoryPath, expectedHash] of Object.entries(screenshots)) {
    const image = await readFile(path.join(repositoryRoot, repositoryPath))
    assert(sha256(image) === expectedHash, `${repositoryPath} hash drifted.`)
    assert(image.subarray(1, 4).toString('ascii') === 'PNG', `${repositoryPath} is not PNG.`)
    assert(image.readUInt32BE(16) === 1440 && image.readUInt32BE(20) === 960, `${repositoryPath} must remain 1440x960.`)
    assert(screenshotGuide.includes(expectedHash), `${repositoryPath} hash is absent from docs/screenshots.md.`)
  }

  assert(screenshotGuide.includes('no private table data present'), 'Screenshot privacy disposition is missing.')
  console.log('Release presentation verified: metadata, technical claims, audience paths, links, and 3 privacy-reviewed screenshots.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
