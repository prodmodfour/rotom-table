#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const certificationPath = 'data/release-readiness/deployment-instruction-certification.v1.json'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function read(repositoryPath) {
  return readFile(path.join(repositoryRoot, repositoryPath), 'utf8')
}

async function shellScripts(directory) {
  const absoluteDirectory = path.join(repositoryRoot, directory)
  const entries = await readdir(absoluteDirectory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const repositoryPath = path.posix.join(directory, entry.name)
    if (entry.isDirectory()) return shellScripts(repositoryPath)
    return entry.isFile() && entry.name.endsWith('.sh') ? [repositoryPath] : []
  }))
  return nested.flat()
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  })
  if (result.error) throw new Error(`${command} is required for deployment validation: ${result.error.message}`)
  assert(
    result.status === 0,
    `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`,
  )
}

function activeEnvironment(environmentSource) {
  return Object.fromEntries(environmentSource
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const separator = line.indexOf('=')
      assert(separator > 0, `Invalid active environment line: ${line}`)
      return [line.slice(0, separator), line.slice(separator + 1)]
    }))
}

async function main() {
  const [
    packageSource,
    matrixSource,
    environmentSource,
    unit,
    hosting,
    checklist,
    readiness,
    localCaddy,
    localReadme,
    setupScript,
    validateScript,
  ] = await Promise.all([
    read('package.json'),
    read('data/release-readiness/supported-platform-matrix.v1.json'),
    read('.env.vps.example'),
    read('deploy/systemd/rotom-table.service'),
    read('docs/private-vps-hosting.md'),
    read('docs/private-vps-deployment-smoke-checklist.md'),
    read('docs/private-vps-readiness-summary.md'),
    read('deploy/local-prodlike/caddy/Caddyfile.local.example'),
    read('deploy/local-prodlike/README.md'),
    read('deploy/local-prodlike/bin/setup.sh'),
    read('deploy/local-prodlike/bin/validate.sh'),
  ])

  const packageJson = JSON.parse(packageSource)
  const matrix = JSON.parse(matrixSource)
  assert(packageJson.engines?.node === '>=24 <25', 'package.json must require exactly Node >=24 <25.')
  assert(matrix.runtime?.node === packageJson.engines.node, 'Supported platform and package Node ranges disagree.')
  assert(matrix.runtime?.install === 'npm ci --include=dev', 'Source deployment must install development build tooling explicitly.')
  assert(packageJson.scripts?.test === 'NODE_ENV=test vitest run', 'The test command must not inherit production write policy from the deployment shell.')
  assert(packageJson.scripts?.start === 'node .output/server/index.mjs', 'The supported start command drifted.')

  const environment = activeEnvironment(environmentSource)
  assert(environment.NODE_ENV === 'production', '.env.vps.example must set NODE_ENV=production.')
  assert(environment.NITRO_HOST === '127.0.0.1', '.env.vps.example must bind Nitro to loopback.')
  assert(environment.NITRO_PORT === '3000', '.env.vps.example must use the documented origin port.')
  assert(environment.ROTOM_CAMPAIGN_ROOT === '/srv/rotom-table/campaign', '.env.vps.example campaign root drifted.')
  assert(!Object.hasOwn(environment, 'ROTOM_ENABLE_HOSTED_WRITES'), 'Hosted writes must remain a commented, explicit opt-in.')
  assert(!Object.hasOwn(environment, 'ROTOM_DB_PATH'), 'The standard deployment must use the campaign-root database default.')

  for (const directive of [
    'User=rotom-table',
    'Group=rotom-table',
    'WorkingDirectory=/srv/rotom-table/app',
    'EnvironmentFile=/etc/rotom-table/rotom-table.env',
    'ExecStart=/usr/bin/env npm run start',
    'NoNewPrivileges=true',
    'CapabilityBoundingSet=',
    'PrivateTmp=true',
    'PrivateDevices=true',
    'ProtectSystem=strict',
    'ProtectHome=true',
    'ReadWritePaths=/srv/rotom-table/campaign',
    'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
    'UMask=0077',
  ]) {
    assert(unit.includes(directive), `systemd template omits required directive: ${directive}`)
  }
  assert(!unit.includes('0.0.0.0'), 'The systemd template must not advertise a public origin bind.')
  run('systemd-analyze', ['verify', 'deploy/systemd/rotom-table.service'])

  const deploymentScripts = await shellScripts('deploy/local-prodlike')
  for (const repositoryPath of deploymentScripts) run('bash', ['-n', repositoryPath])
  assert(setupScript.includes('npm ci --include=dev'), 'Local prodlike setup can omit source-build dependencies under NODE_ENV=production.')
  assert(validateScript.includes('npm run check:release-readiness:deployment'), 'Local prodlike validation omits the deployment gate.')
  assert(validateScript.includes('ROTOM_RUN_FULL_TESTS:-0'), 'The complete source suite must be an explicit local-prodlike opt-in.')

  for (const [repositoryPath, source] of [
    ['docs/private-vps-hosting.md', hosting],
    ['docs/private-vps-deployment-smoke-checklist.md', checklist],
    ['docs/private-vps-readiness-summary.md', readiness],
  ]) {
    for (const phrase of [
      'npm ci --include=dev',
      '127.0.0.1',
      'ROTOM_CAMPAIGN_ROOT',
      'ROTOM_ENABLE_HOSTED_WRITES=1',
      'outer access gate',
      'systemd',
    ]) {
      assert(source.toLowerCase().includes(phrase.toLowerCase()), `${repositoryPath} omits required deployment guidance: ${phrase}`)
    }
  }
  assert(hosting.includes('An operator-only `nvm` installation is not sufficient'), 'The runbook does not explain systemd runtime visibility.')
  assert(hosting.includes('git status --short # must be empty for a release build'), 'The runbook permits an unbound dirty source build.')
  assert(hosting.includes('Do not overwrite `.output/` while a session or the old Node process is active.'), 'The runbook permits in-place rebuilds under a live process.')
  assert(checklist.includes('ReadWritePaths'), 'The smoke checklist omits nonstandard systemd storage-path review.')
  assert(checklist.includes('npm run check:release-readiness:deployment'), 'The smoke checklist omits its reproducible deployment gate.')
  assert(localReadme.includes('ROTOM_RUN_FULL_TESTS=1'), 'Local prodlike documentation omits the full-suite opt-in.')

  assert(localCaddy.includes('http://127.0.0.1:8080 {'), 'The local Caddy mimic must remain explicit loopback HTTP, not automatic local TLS.')
  assert(localCaddy.includes('\tbasicauth {'), 'The local Caddy mimic must validate on distribution Caddy 2.6 and newer compatibility aliases.')
  assert(localCaddy.includes('reverse_proxy 127.0.0.1:3000'), 'The local Caddy mimic origin drifted.')
  assert(!localCaddy.includes('basic_auth {'), 'The Caddy 2.8-only spelling breaks the supported clean-host rehearsal.')

  const certification = JSON.parse(await read(certificationPath))
  assert(certification.status === 'Repaired', 'Deployment instruction certification is not final.')
  assert(certification.ticket === 'P13-064', 'Deployment certification ticket drifted.')
  assert(certification.cleanHost?.architecture === 'x86_64', 'Deployment certification lacks the supported architecture.')
  assert(certification.cleanHost?.serviceManager === 'systemd 252', 'Deployment certification lacks the exercised systemd host.')
  assert(certification.results?.every(result => result.status === 'passed'), 'Deployment certification contains a non-passing result.')
  assert(certification.deviationsRepaired?.length === 4, 'Every clean-host deployment deviation must remain recorded.')

  console.log(`Private-VPS deployment instructions verified: ${deploymentScripts.length} shell templates, hardened systemd unit, fail-closed env, compatible Caddy proxy, and ${certification.results.length} clean-host results.`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
