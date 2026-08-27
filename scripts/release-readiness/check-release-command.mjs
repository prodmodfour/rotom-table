#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fail = message => { throw new Error(message) }
const assert = (condition, message) => { if (!condition) fail(message) }
const read = repositoryPath => readFile(path.join(ROOT, repositoryPath), 'utf8')
const json = async repositoryPath => JSON.parse(await read(repositoryPath))

function assertOrdered(source, markers) {
  let cursor = -1
  for (const marker of markers) {
    const index = source.indexOf(marker)
    assert(index > cursor, `Release command omits or misorders required step: ${marker}`)
    cursor = index
  }
}

async function main() {
  const [command, generator, evidenceCheck, docs, gitignore, packageJson, policy, platform, certification, rubric] = await Promise.all([
    read('scripts/release-readiness/release-command.mjs'),
    read('scripts/release-readiness/generate-build-evidence.mjs'),
    read('scripts/release-readiness/check-release-evidence.mjs'),
    read('docs/release/releasing.md'),
    read('.gitignore'),
    json('package.json'),
    json('data/release-readiness/version-policy.v1.json'),
    json('data/release-readiness/supported-platform-matrix.v1.json'),
    json('data/release-readiness/release-command-certification.v1.json'),
    json('data/release-readiness/release-gate-rubric.v1.json'),
  ])

  assert(packageJson.scripts['release:prepare'] === 'node scripts/release-readiness/release-command.mjs', 'release:prepare is not the single release command.')
  assert(packageJson.scripts['release:check-evidence'] === 'node scripts/release-readiness/check-release-evidence.mjs', 'Release evidence check is not registered.')
  assert(packageJson.scripts['release:audit-artifact'] === 'node scripts/release-readiness/audit-built-artifact.mjs', 'Built-artifact audit is not registered.')
  assert(packageJson.scripts['check:release-readiness:release-command']?.includes('check-release-command.mjs'), 'Release-command source gate is not registered.')
  assert(packageJson.scripts['check:release-readiness']?.includes('check:release-readiness:release-command'), 'Aggregate readiness gate omits the release-command source gate.')
  assert(!packageJson.scripts['check:release-readiness'].includes('release:prepare'), 'Aggregate readiness gate recursively invokes release preparation.')

  assert(command.includes("if (process.argv.length !== 2) fail('The release command accepts no bypass or path arguments.')"), 'Release command does not reject all bypass/path arguments.')
  for (const forbidden of ['--allow-dirty', '--skip-gates', '--skip-build', '--force-release']) assert(!command.includes(forbidden), `Release command contains a bypass surface: ${forbidden}`)
  assertOrdered(command, [
    "assertCleanTree('before gates')",
    '\n  assertAnnotatedHeadTag(commit)\n',
    "run('node', ['scripts/release-readiness/check-identity.mjs', '--require-tag'])",
    "run('npm', ['run', 'check:release-readiness'])",
    "assertCleanTree('after gates')",
    'rmSync(OUTPUT_ROOT',
    'rmSync(EVIDENCE_ROOT',
    "run('npm', ['run', 'build'], buildEnvironment)",
    "'scripts/release-readiness/generate-build-evidence.mjs'",
    "run('npm', ['run', 'release:audit-artifact'], buildEnvironment)",
    "writeJson('release-evidence/gate-summary.json'",
    "writeJson('release-evidence/release-bundle-manifest.json'",
    "run('node', ['scripts/release-readiness/check-release-evidence.mjs'])",
    "assertCleanTree('after evidence generation')",
  ])
  for (const binding of ['package.json', 'package-lock.json', 'CHANGELOG.md', 'docs/releases/1.0.0.md', 'data/release-readiness/distribution-manifest.v1.json', 'data/release-readiness/known-limitations.v1.json']) {
    assert(command.includes(`'${binding}'`), `Release gate summary omits source binding: ${binding}`)
  }
  for (const environment of ["NODE_ENV: 'production'", "ROTOM_RELEASE_BUILD: '1'", 'ROTOM_BUILD_COMMIT: commit', 'ROTOM_BUILD_TAG: TAG', 'SOURCE_DATE_EPOCH: sourceDateEpoch']) {
    assert(command.includes(environment), `Release production build omits deterministic environment: ${environment}`)
  }

  assert(generator.includes("if (releaseMode)"), 'Build evidence generator has no release mode.')
  assert(generator.includes('Release evidence requires a full Git commit SHA'), 'Build evidence does not require a full commit.')
  assert(generator.includes('Release tag must be v${packageMetadata.version}'), 'Build evidence does not require tag/version agreement.')
  for (const requirement of ['Release evidence check accepts no arguments.', 'annotated tag at HEAD', 'Release evidence hash drift', 'Release output checksum drift', 'source binding drift', 'Built-artifact audit contains a finding']) {
    assert(evidenceCheck.includes(requirement), `Release evidence verifier omits fail-closed rule: ${requirement}`)
  }

  for (const generated of ['.nuxt-build', '.output', 'release-evidence/']) assert(gitignore.split('\n').includes(generated), `Generated release path is not ignored: ${generated}`)
  assert(platform.runtime.node === '>=24 <25' && platform.operatingSystem.some(row => row.family === 'Linux' && row.architecture === 'x86-64'), 'Release command platform assumptions drifted.')
  assert(policy.rules.tagMutationForbidden === true && policy.releaseBuildRequirements.includes('clean tracked worktree'), 'Version policy no longer requires immutable tags and clean release builds.')

  for (const phrase of ['npm run release:prepare', 'accepts no bypass', 'annotated', 'SOURCE_DATE_EPOCH', 'release-evidence/checksums.sha256', 'Publication remains an owner action']) {
    assert(docs.includes(phrase), `Release command documentation omits: ${phrase}`)
  }

  assert(certification.ticket === 'P13-071' && certification.status === 'Certified', 'Release-command certification is not final.')
  assert(certification.releaseVersion === packageJson.version, 'Release-command certification identity disagrees with package.json.')
  assert(certification.gateRows?.length === 1 && certification.gateRows[0].id === 'provenance-release-command' && certification.gateRows[0].state === 'Certified', 'Release-command certification does not close its rubric row.')
  const rubricRow = rubric.rows.find(row => row.id === 'provenance-release-command')
  assert(rubricRow?.allowedFinalStates?.includes('Certified'), 'Release-command rubric row no longer permits Certified.')

  console.log(`Release command verified for ${packageJson.version}: clean/tag gates, bounded aggregate, deterministic build, artifact audit, five-file evidence bundle, and zero bypass arguments.`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
