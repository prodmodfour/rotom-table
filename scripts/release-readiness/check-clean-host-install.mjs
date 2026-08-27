#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = repositoryPath => readFile(path.join(ROOT, repositoryPath), 'utf8')
const json = async repositoryPath => JSON.parse(await read(repositoryPath))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

async function main() {
  const [certification, rubric, platform, packageJson, hosting, checklist, deployment] = await Promise.all([
    json('data/release-readiness/clean-host-install-certification.v1.json'),
    json('data/release-readiness/release-gate-rubric.v1.json'),
    json('data/release-readiness/supported-platform-matrix.v1.json'),
    json('package.json'),
    read('docs/private-vps-hosting.md'),
    read('docs/private-vps-deployment-smoke-checklist.md'),
    json('data/release-readiness/deployment-instruction-certification.v1.json'),
  ])

  assert(certification.ticket === 'P13-073' && certification.status === 'Repaired', 'Clean-host install certification is not final.')
  assert(certification.gateRows?.length === 1 && certification.gateRows[0].id === 'provenance-clean-host' && certification.gateRows[0].state === 'Repaired', 'Clean-host certification does not close its rubric row as Repaired.')
  assert(rubric.rows.find(row => row.id === 'provenance-clean-host')?.allowedFinalStates?.includes('Repaired'), 'Clean-host rubric row no longer permits a repaired result.')
  assert(/^1\.0\.0-rc\.\d+$/u.test(certification.releaseVersion), 'Clean-host certification is not bound to a release-candidate identity.')
  assert(certification.cleanHost?.operatingSystem === 'Debian GNU/Linux 12 (bookworm)' && certification.cleanHost?.architecture === 'x86_64', 'Clean-host OS/architecture drifted.')
  assert(certification.cleanHost?.serviceManager === 'systemd 252 as PID 1', 'Clean-host rehearsal did not exercise real systemd supervision.')
  assert(certification.cleanHost?.sourceClone?.fresh === true && certification.cleanHost.sourceClone.privateInputs === false, 'Clean-host source clone was not fresh and source-only.')
  assert(/^[0-9a-f]{40}$/u.test(certification.cleanHost.sourceClone.commit), 'Clean-host source commit is not full length.')
  execFileSync('git', ['cat-file', '-e', `${certification.cleanHost.sourceClone.commit}^{commit}`], { cwd: ROOT })
  execFileSync('git', ['merge-base', '--is-ancestor', certification.cleanHost.sourceClone.commit, 'HEAD'], { cwd: ROOT })

  const expectedResults = [
    'fresh-clone',
    'source-prerequisites',
    'runtime',
    'lock-install',
    'dependency-audit',
    'deployment-gate',
    'typecheck',
    'production-build',
    'service-account',
    'systemd-verify-start-restart',
    'loopback-health-identity',
    'hosted-write-fail-closed',
    'sse-streaming',
    'external-sqlite-sidecars',
    'built-notice',
    'outer-gate',
    'source-cleanliness',
  ]
  assert(JSON.stringify(certification.results?.map(row => row.id)) === JSON.stringify(expectedResults), 'Clean-host result set/order drifted.')
  assert(certification.results.every(row => row.status === 'passed'), 'Clean-host certification contains a non-passing result.')
  assert(certification.deviationsRepaired?.length === 1 && certification.deviationsRepaired[0].id === 'fresh-clone-git-prerequisite', 'Fresh-clone friction was not recorded and repaired.')
  assert(certification.results.find(row => row.id === 'production-build')?.outputFiles === 13629, 'Clean-host production output count drifted.')
  assert(certification.results.find(row => row.id === 'dependency-audit')?.highOrGreaterFindings === 0, 'Clean-host dependency audit is not clean.')
  assert(certification.results.find(row => row.id === 'loopback-health-identity')?.storageSchemaVersion === 56, 'Clean-host health schema drifted.')
  assert(certification.results.find(row => row.id === 'hosted-write-fail-closed')?.statusCode === 403, 'Clean-host hosted writes did not fail closed.')
  assert(certification.results.find(row => row.id === 'outer-gate')?.unauthenticatedStatus === 401, 'Clean-host outer gate did not deny unauthenticated access.')
  assert(certification.results.find(row => row.id === 'built-notice')?.sha256 === 'a0bc8368f748f524bd99fef03ca7677eff83575bd46c75f43a43cc03d41e863e', 'Clean-host built notice hash drifted.')

  const prerequisite = 'sudo apt-get install --no-install-recommends git ca-certificates curl'
  assert(hosting.includes(prerequisite) && checklist.includes(prerequisite), 'Published clean-clone instructions omit repaired Git/CA/curl prerequisites.')
  for (const phrase of ['npm ci --include=dev', 'npm run check:release-readiness:deployment', 'npm run typecheck', 'npm run build', 'systemctl enable --now rotom-table.service']) {
    assert(hosting.includes(phrase) || checklist.includes(phrase), `Published clean-host instructions omit exercised step: ${phrase}`)
  }
  assert(deployment.status === 'Repaired' && deployment.results.every(row => row.status === 'passed'), 'Underlying deployment instruction certification is not final.')
  assert(platform.runtime.node === '>=24 <25' && platform.deployment.serviceManager === 'systemd' && platform.deployment.originBinding === 'loopback', 'Supported platform matrix disagrees with the rehearsal.')
  assert(packageJson.scripts['check:release-readiness:clean-host']?.includes('check-clean-host-install.mjs'), 'Clean-host drift command is not registered.')
  assert(packageJson.scripts['check:release-readiness']?.includes('check:release-readiness:clean-host'), 'Aggregate release readiness omits clean-host certification.')

  console.log(`Clean-host install verified: ${certification.results.length} passed results on Debian 12/Node 24/systemd, one documented friction repaired, zero private inputs.`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
