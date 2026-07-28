import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const fail = (message) => {
  console.error(`[encounter-presentation-contract] ${message}`)
  process.exitCode = 1
}

const commandSource = read('shared/livePlayCommands.ts')
const commandBlock = commandSource.match(/export const LIVE_PLAY_COMMAND_TYPES = \{([\s\S]*?)\n\} as const/)
if (!commandBlock) throw new Error('LIVE_PLAY_COMMAND_TYPES could not be parsed.')
const commandTypes = [...commandBlock[1].matchAll(/^\s*[A-Z_]+:\s*'([^']+)'/gm)].map(match => match[1])
const inventory = JSON.parse(read('data/encounter-presentation/action-source-inventory.json'))
const scenarios = JSON.parse(read('data/encounter-presentation/acceptance-scenarios.json'))
const catalogSource = read('shared/encounterPresentation/catalog.ts')
const catalogValues = (constant) => {
  const block = catalogSource.match(new RegExp(`export const ${constant} = \\[([\\s\\S]*?)\\] as const`))
  if (!block) throw new Error(`${constant} could not be parsed.`)
  return [...block[1].matchAll(/'([^']+)'/g)].map(match => match[1])
}
const sourceKinds = catalogValues('ENCOUNTER_RULE_SOURCE_KINDS')
const roles = catalogValues('ENCOUNTER_INTERACTION_ROLES')
const audiences = catalogValues('ENCOUNTER_PROJECTION_AUDIENCES')
const inventoryTypes = inventory.commands.map(entry => entry.wireType)
for (const type of commandTypes) {
  if (!inventoryTypes.includes(type)) fail(`missing live-play command inventory row for ${type}`)
}
for (const type of inventoryTypes) {
  if (!commandTypes.includes(type)) fail(`stale live-play command inventory row for ${type}`)
}
if (new Set(inventoryTypes).size !== inventoryTypes.length) fail('command inventory contains duplicate wire types')
for (const scenarioId of [
  'duel-single-target-hit',
  'crowd-area-mixed-outcome',
  'ability-applied',
  'passive-stacking-explanation',
  'movement-interrupted',
  'boss-phase-nested-reactions',
  'reconnect-duplicate-replay',
  'private-prevention-redaction',
  'gm-move-correction',
]) {
  if (!scenarios.scenarios.some(scenario => scenario.scenarioId === scenarioId)) {
    fail(`canonical acceptance scenario ${scenarioId} is missing`)
  }
}
const scenarioIds = scenarios.scenarios.map(scenario => scenario.scenarioId)
if (new Set(scenarioIds).size !== scenarioIds.length) fail('canonical acceptance scenarios repeat scenarioId')
if (!scenarios.evidence || typeof scenarios.evidence !== 'object' || Array.isArray(scenarios.evidence)) {
  fail('canonical acceptance scenarios require an evidence index')
}
else {
  for (const scenarioId of scenarioIds) {
    const paths = scenarios.evidence[scenarioId]
    if (!Array.isArray(paths) || paths.length === 0) {
      fail(`scenario ${scenarioId} has no executable evidence links`)
      continue
    }
    for (const path of paths) {
      if (typeof path !== 'string' || !existsSync(resolve(root, path))) {
        fail(`scenario ${scenarioId} has missing evidence ${String(path)}`)
      }
    }
  }
  for (const scenarioId of Object.keys(scenarios.evidence)) {
    if (!scenarioIds.includes(scenarioId)) fail(`stale scenario evidence row ${scenarioId}`)
  }
}
for (const scenario of scenarios.scenarios) {
  if (typeof scenario.scenarioId !== 'string' || !/^[a-z][a-z0-9-]{2,63}$/.test(scenario.scenarioId)) {
    fail(`acceptance scenario has invalid stable identity ${String(scenario.scenarioId)}`)
  }
  if (!Array.isArray(scenario.sourceKinds) || scenario.sourceKinds.length === 0
    || !Array.isArray(scenario.interactionRoles) || scenario.interactionRoles.length === 0
    || !Array.isArray(scenario.expects) || scenario.expects.length === 0
    || !Number.isSafeInteger(scenario.actorCount) || scenario.actorCount < 0 || scenario.actorCount > 64
    || !Number.isSafeInteger(scenario.targetCount) || scenario.targetCount < 0 || scenario.targetCount > 64) {
    fail(`acceptance scenario ${scenario.scenarioId} is not machine-actionable`)
    continue
  }
  for (const [name, values] of [['sourceKinds', scenario.sourceKinds], ['interactionRoles', scenario.interactionRoles], ['expects', scenario.expects]]) {
    if (new Set(values).size !== values.length) fail(`scenario ${scenario.scenarioId} repeats ${name}`)
  }
  if (!audiences.includes(scenario.audience)) fail(`scenario ${scenario.scenarioId} has unknown audience ${scenario.audience}`)
  for (const kind of scenario.sourceKinds) {
    if (!sourceKinds.includes(kind)) fail(`scenario ${scenario.scenarioId} has unknown source kind ${kind}`)
  }
  for (const role of scenario.interactionRoles ?? []) {
    if (!roles.includes(role)) fail(`scenario ${scenario.scenarioId} has unknown interaction role ${role}`)
  }
}
const inventorySourceKinds = new Set([
  ...inventory.commands.map(entry => entry.sourceKind),
  ...inventory.nonCommandSources.flatMap(entry => String(entry.sourceKind).split('|')),
])
for (const kind of sourceKinds) {
  if (!inventorySourceKinds.has(kind)) fail(`source kind ${kind} has no inventory ownership row`)
}

for (const entry of inventory.nonCommandSources) {
  const entryKinds = String(entry.sourceKind).split('|')
  if (entryKinds.some(kind => !sourceKinds.includes(kind))
    || !Array.isArray(entry.interactionRoles) || entry.interactionRoles.length === 0
    || entry.interactionRoles.some(role => !roles.includes(role))) {
    fail(`non-command inventory row ${entry.inventoryId} has an invalid source/role classification`)
  }
  if (entry.migrationStatus !== 'generic-contract') {
    fail(`non-command inventory row ${entry.inventoryId} is not migrated to the generic contract`)
  }
}
for (const inventoryId of ['native:pending-move-response', 'native:pending-ability-response']) {
  if (!inventory.nonCommandSources.some(entry => entry.inventoryId === inventoryId)) {
    fail(`pending interaction inventory row ${inventoryId} is missing`)
  }
}
const requiredPresentationSurfaces = [
  'snapshot:encounter-presentation', 'client:legacy-context-menu-adapter',
  'client:generic-interaction-panel', 'client:generic-vfx-overlay',
  'client:announcement-history-runtime', 'durable:accepted-realtime',
  'durable:accepted-replay', 'recovery:pending-interactions',
]
for (const inventoryId of requiredPresentationSurfaces) {
  const surface = inventory.presentationSurfaces?.find(entry => entry.inventoryId === inventoryId)
  if (!surface) {
    fail(`presentation surface inventory row ${inventoryId} is missing`)
  }
  else if (!existsSync(resolve(root, surface.implementationPath))) {
    fail(`presentation surface ${inventoryId} has missing implementation ${surface.implementationPath}`)
  }
}

for (const entry of inventory.commands) {
  if (!entry.sourceKind || !Array.isArray(entry.interactionRoles) || entry.interactionRoles.length === 0) {
    fail(`inventory row ${entry.inventoryId} lacks source/role classification`)
  }
  if (!['generic-contract', 'retired', 'out-of-encounter'].includes(entry.migrationStatus)) {
    fail(`inventory row ${entry.inventoryId} has an unsupported migration classification`)
  }
  if (entry.migrationStatus === 'generic-contract' && !entry.acceptedAdapter) {
    fail(`inventory row ${entry.inventoryId} lacks an accepted adapter`)
  }
}

const snapshot = read('shared/liveTableSnapshot.ts')
if (!snapshot.includes('encounterPresentation: EncounterPresentationProjection')) {
  fail('LiveTableSnapshot does not require the generic encounter bundle')
}
if (snapshot.includes('abilityCapabilities')) {
  fail('LiveTableSnapshot still exposes a source-specific ability capability bundle')
}
const snapshotSync = read('src/composables/map-editor/useLiveTableSnapshotSync.ts')
if (snapshotSync.includes('snapshot.abilityCapabilities')) {
  fail('snapshot synchronization still consumes source-specific ability wire data')
}
const genericPanel = read('src/components/map/EncounterPresentationPanel.vue')
for (const forbidden of ['moveAutomation', 'abilityAutomation', 'livePlayMovePresentation']) {
  if (genericPanel.includes(forbidden)) fail(`generic panel imports or names source-specific contract ${forbidden}`)
}
const acceptedRealtime = read('server/livePlay/acceptedCommandRealtime.ts')
if (!acceptedRealtime.includes('acceptedEncounterPresentationFromLivePlayCommand')) {
  fail('durable accepted command realtime does not enforce the generic accepted adapter')
}
const abilityRealtime = read('server/domain/abilityAutomation/realtime.ts')
if (!abilityRealtime.includes('presentation: result.encounterPresentation')) {
  fail('Ability accepted realtime omits the generic accepted presentation')
}
const abilityResponseViews = read('server/domain/abilityAutomation/responseViews.ts')
if (!abilityResponseViews.includes('pendingEncounterInteractionFromAbilityView')) {
  fail('Ability pending response projections omit the generic pending interaction')
}
const mapPage = read('src/pages/maps/[slug].vue')
if (!mapPage.includes('MAP_API_PATHS.declareEncounterAction')) {
  fail('generic action activation does not submit the exact offer identity to the server')
}
const declarationUseCase = read('server/useCases/declareEncounterAction.ts')
for (const identity of ['offerId', 'baseRevision', 'actorParticipantId', 'actionId']) {
  if (!declarationUseCase.includes(identity)) fail(`generic declaration authorization omits ${identity}`)
}
const generated = spawnSync(process.execPath, [
  resolve(root, 'scripts/generate-encounter-presentation-inventory.mjs'),
  '--check',
], { encoding: 'utf8' })
if (generated.status !== 0) fail(generated.stderr.trim() || generated.stdout.trim() || 'generated inventory check failed')

const packageJson = JSON.parse(read('package.json'))
const nuxtVersion = String(packageJson.dependencies?.nuxt ?? packageJson.devDependencies?.nuxt ?? '')
if (!/\b4(?:\.|$)/.test(nuxtVersion)) fail(`Nuxt 4 is required by the contract initiative (found ${nuxtVersion || 'none'})`)
for (const path of [
  'docs/automation-presentation-contract/nuxt-3-baseline.md',
  'docs/automation-presentation-contract/nuxt-4-migration-audit.md',
  'data/encounter-presentation/action-source-inventory.json',
  'data/encounter-presentation/acceptance-scenarios.json',
  'docs/adrs/012-server-authoritative-encounter-presentation-contract.md',
  'docs/encounter-presentation-contract.md',
  'docs/encounter-presentation-api.md',
  'docs/encounter-presentation-manual-qa.md',
  'docs/automation-presentation-contract/release-acceptance.md',
]) {
  if (!existsSync(resolve(root, path))) fail(`required artifact ${path} is missing`)
}

const plan = read('implementation-plans/done/AUTOMATION_PRESENTATION_CONTRACT_PLAN.md')
if (/^`PLAN_STATUS: DONE`$/m.test(plan)) {
  const unfinished = [...plan.matchAll(/^- \[ \] \*\*(APC-\d{3})/gm)].map(match => match[1])
  if (unfinished.length > 0) fail(`plan is DONE but tickets remain unchecked: ${unfinished.join(', ')}`)
}

if (process.exitCode) process.exit(process.exitCode)
console.log(`[encounter-presentation-contract] ${inventoryTypes.length} command sources are inventoried and generic wire seams are enforced.`)
