import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CANONICAL_FEATURE_IDS, canonicalFeatureReference } from '../shared/featureAutomation/catalog'
import { FEATURE_AUTOMATION_MANIFEST } from '../shared/featureAutomation/manifest'
import { FEATURE_AUTOMATION_RULESET } from '../shared/featureAutomation/ruleset'
import { FEATURE_PREREQUISITES } from '../shared/featureAutomation/prerequisites'
import { FEATURE_AUTOMATION_RUNTIME_REGISTRY } from '../server/domain/featureAutomation/registry'

const ROOT = resolve(import.meta.dirname, '..')
const failures: string[] = []
const assert = (condition: unknown, message: string): void => { if (!condition) failures.push(message) }
const sha = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}` : JSON.stringify(value)
const json = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T

const catalogBytes = readFileSync(resolve(ROOT, FEATURE_AUTOMATION_RULESET.catalog.path))
assert(catalogBytes.length === FEATURE_AUTOMATION_RULESET.catalog.bytes, 'Feature catalog byte count drifted')
assert(sha(catalogBytes) === FEATURE_AUTOMATION_RULESET.catalog.sha256, 'Feature catalog SHA-256 drifted')
assert(execFileSync('git', ['hash-object', FEATURE_AUTOMATION_RULESET.catalog.path], { cwd: ROOT, encoding: 'utf8' }).trim() === FEATURE_AUTOMATION_RULESET.catalog.gitBlob, 'Feature catalog Git blob drifted')
for (const input of (FEATURE_AUTOMATION_RULESET as unknown as { maintenanceInputs: { path: string, sha256: string, gitBlob: string }[] }).maintenanceInputs) {
  const bytes = readFileSync(resolve(ROOT, input.path))
  assert(sha(bytes) === input.sha256, `${input.path} maintenance hash drifted`)
  assert(execFileSync('git', ['hash-object', input.path], { cwd: ROOT, encoding: 'utf8' }).trim() === input.gitBlob, `${input.path} maintenance blob drifted`)
}
assert(FEATURE_AUTOMATION_RULESET.runtimeAuthority.join('|') === 'data/reference/features.json', 'Feature runtime authority must contain only app-owned JSON')

interface Inventory { entryCount: number, canonicalIds: string[], records: { canonicalId: string, recordSha256: string, effectSha256: string }[] }
const inventory = json<Inventory>('data/feature-automation/inventory.json')
assert(inventory.entryCount === 444 && inventory.records.length === 444, 'Feature inventory must freeze 444 rows')
assert(JSON.stringify(inventory.canonicalIds) === JSON.stringify(CANONICAL_FEATURE_IDS), 'Feature identity order drifted')
for (const [index, canonicalId] of CANONICAL_FEATURE_IDS.entries()) {
  const row = inventory.records[index]; const reference = canonicalFeatureReference(canonicalId)
  assert(row?.canonicalId === canonicalId, `${canonicalId} inventory row is absent or out of order`)
  assert(row?.recordSha256 === sha(stable(reference)), `${canonicalId} record hash drifted`)
  assert(row?.effectSha256 === sha(reference?.effect ?? ''), `${canonicalId} effect hash drifted`)
}

const directory = json<{ classCount: number, classAnchorCount: number, classes: { className: string, anchorCanonicalId: string | null, canonicalIds: string[] }[], unownedCanonicalIds: string[] }>('data/feature-automation/class-directory.json')
assert(directory.classCount === directory.classes.length && directory.classCount === 40, 'Feature class directory must freeze 40 class families')
assert(directory.classAnchorCount === 40, 'Feature class directory must freeze 40 class anchors')
const directoryIds = [...directory.classes.flatMap(entry => entry.canonicalIds), ...directory.unownedCanonicalIds]
assert(directoryIds.length === 444 && new Set(directoryIds).size === 444 && directoryIds.every(id => CANONICAL_FEATURE_IDS.includes(id)), 'Feature class directory must partition all identities exactly once')
for (const entry of directory.classes) assert(entry.anchorCanonicalId === null || entry.canonicalIds.includes(entry.anchorCanonicalId), `${entry.className} has an invalid class anchor`)

assert(FEATURE_AUTOMATION_MANIFEST.entries.length === 444, 'Feature manifest is incomplete')
assert(FEATURE_AUTOMATION_RUNTIME_REGISTRY.definitions.length === 444, 'Feature runtime registry is incomplete')
assert(FEATURE_PREREQUISITES.entries.length === 444, 'Feature prerequisite catalog is incomplete')
const definitionHashes = new Set<string>()
for (const entry of FEATURE_AUTOMATION_MANIFEST.entries) {
  const runtime = FEATURE_AUTOMATION_RUNTIME_REGISTRY.resolve(entry.canonicalId)
  assert(entry.status === 'complete' && entry.serverAuthoritative && !entry.legacyExecutionAllowed, `${entry.canonicalId} is not strict-complete`)
  assert(Boolean(runtime), `${entry.canonicalId} has no runtime definition`)
  if (!runtime) continue
  assert(runtime.spec.sourceEffectSha256 === entry.sourceEffectSha256, `${entry.canonicalId} source hash drifted`)
  assert(runtime.spec.mechanics.length > 0 && runtime.spec.registeredHandlerId === 'feature.native.v1', `${entry.canonicalId} has no native mechanic`)
  assert(!definitionHashes.has(runtime.definitionHash), `${entry.canonicalId} definition hash collides`)
  definitionHashes.add(runtime.definitionHash)
}

interface Scenarios { requirementCount: number, requirements: { id: string, canonicalId: string }[] }
const scenarios = json<Scenarios>('data/feature-automation/scenario-requirements.json')
const expected = new Set(FEATURE_AUTOMATION_MANIFEST.entries.flatMap(entry => [`feature:${entry.canonicalId}:projection`, ...entry.actions.map(action => `feature:${entry.canonicalId}:action:${action.id}`)]))
assert(scenarios.requirementCount === scenarios.requirements.length && scenarios.requirements.length === expected.size, 'Feature scenario count drifted')
for (const scenario of scenarios.requirements) assert(expected.delete(scenario.id), `Unexpected or duplicate Feature scenario ${scenario.id}`)
assert(expected.size === 0, `Missing Feature scenarios: ${[...expected].join(', ')}`)

const orders = json<{ entryCount: number, orderCount: number, entries: { sourceCanonicalId: string, sourceEffectSha256: string, orders: { name: string }[] }[] }>('data/feature-automation/orders.json')
assert(orders.entryCount === 5 && orders.orderCount === 10 && orders.entries.every(entry => entry.orders.length === 2 && FEATURE_AUTOMATION_MANIFEST.entries.some(manifest => manifest.canonicalId === entry.sourceCanonicalId && manifest.sourceEffectSha256 === entry.sourceEffectSha256)), 'Feature granted Order catalog is incomplete or stale')

const dependencies = json<{ entryCount: number, entries: { canonicalId: string, requiredFeatureIds: string[], requiredEdgeIds: string[], grantedIds: Record<string, string[]>, selectedGrantChoiceIds: string[] }[] }>('data/feature-automation/dependencies.json')
const interactions = json<{ entryCount: number, entries: { canonicalId: string, domains: string[], sourceEffectSha256: string, status: string }[] }>('data/feature-automation/interactions.json')
const evidence = json<{ entryCount: number, entries: { canonicalId: string, sourceEffectSha256: string, requirementIds: string[], status: string }[] }>('data/feature-automation/evidence.json')
for (const [label, artifact] of [['dependencies', dependencies], ['interactions', interactions], ['evidence', evidence]] as const) {
  assert(artifact.entryCount === 444 && artifact.entries.length === 444, `Feature ${label} catalog must cover 444 rows`)
  assert(new Set(artifact.entries.map(entry => entry.canonicalId)).size === 444 && artifact.entries.every(entry => CANONICAL_FEATURE_IDS.includes(entry.canonicalId)), `Feature ${label} identities are invalid`)
}
for (const row of interactions.entries) {
  const manifest = FEATURE_AUTOMATION_MANIFEST.entries.find(entry => entry.canonicalId === row.canonicalId)
  assert(row.status === 'certified' && row.domains.length > 0 && row.sourceEffectSha256 === manifest?.sourceEffectSha256, `${row.canonicalId} interaction evidence is incomplete`)
}
for (const row of evidence.entries) {
  const manifest = FEATURE_AUTOMATION_MANIFEST.entries.find(entry => entry.canonicalId === row.canonicalId)
  assert(row.status === 'reviewed-complete' && row.requirementIds.length > 0 && row.sourceEffectSha256 === manifest?.sourceEffectSha256, `${row.canonicalId} completion evidence is incomplete`)
}

const cohorts = json<{ cohortCount: number, cohorts: { id: string, canonicalIds: string[] }[] }>('data/feature-automation/cohorts.json')
assert(cohorts.cohortCount === 30 && cohorts.cohorts.length === 30 && cohorts.cohorts.every(cohort => cohort.canonicalIds.length >= 1 && cohort.canonicalIds.length <= 16), 'Feature cohorts must be 30 nonempty groups of at most 16')
assert(new Set(cohorts.cohorts.flatMap(cohort => cohort.canonicalIds)).size === 444, 'Feature cohorts do not cover exactly 444 identities')
const adjudications = json<{ status: string, entries: { id: string, status: string, canonicalIds: string[] }[] }>('data/feature-automation/source-adjudications.json')
assert(adjudications.status === 'reviewed-no-open-source-gaps' && adjudications.entries.every(entry => entry.status === 'accepted' && entry.canonicalIds.every(id => CANONICAL_FEATURE_IDS.includes(id))), 'Feature source adjudications are open or invalid')

for (const path of ['server/domain/featureAutomation/acquisition.ts', 'server/domain/featureAutomation/effectiveFeatures.ts', 'server/domain/featureAutomation/executeFeature.ts', 'server/domain/featureAutomation/resources.ts', 'server/domain/featureAutomation/campaignOperations.ts', 'server/domain/featureAutomation/eventSubscriptions.ts', 'server/domain/featureAutomation/context.ts', 'server/domain/featureAutomation/statePlanning.ts', 'server/domain/featureAutomation/passiveProviders.ts', 'server/domain/featureAutomation/teamOperations.ts', 'server/domain/featureAutomation/targetPokemonGrants.ts', 'server/domain/featureAutomation/campaignStatePlanning.ts', 'server/domain/featureAutomation/workflows.ts', 'server/domain/featureAutomation/recovery.ts', 'server/domain/featureAutomation/random.ts', 'shared/featureAutomation/classDirectory.ts', 'shared/featureAutomation/orders.ts', 'docs/feature-automation.md', 'docs/adrs/014-authoritative-feature-automation-runtime.md', 'tests/server/featureAutomation.test.ts']) {
  try { readFileSync(resolve(ROOT, path)) } catch { failures.push(`required Feature artifact is missing: ${path}`) }
}
if (process.argv.includes('--check-plan')) {
  let plan = ''
  try { plan = readFileSync(resolve(ROOT, 'implementation-plans/done/FEATURE_AUTOMATION_PLAN.md'), 'utf8') } catch { failures.push('done Feature plan is missing') }
  assert(plan.includes('PLAN_STATUS: DONE'), 'Feature plan is not marked DONE')
  assert(!/- \[ \] \*\*FA-/.test(plan), 'Feature plan has unfinished tickets')
}
if (failures.length) {
  console.error(`Feature automation check failed (${failures.length}):`)
  failures.forEach(failure => console.error(`- ${failure}`)); process.exit(1)
}
console.log(`Feature automation check passed: 444 native-complete rows, 30 cohorts, ${scenarios.requirements.length} reviewed scenarios.`)
