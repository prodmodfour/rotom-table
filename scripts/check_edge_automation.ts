import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  CANONICAL_POKE_EDGE_IDS,
  CANONICAL_TRAINER_EDGE_IDS,
  canonicalEdgeKey,
  canonicalEdgeReference,
} from '../shared/edgeAutomation/catalog'
import { EDGE_AUTOMATION_MANIFEST } from '../shared/edgeAutomation/manifest'
import { EDGE_AUTOMATION_RULESET } from '../shared/edgeAutomation/ruleset'
import { EDGE_AUTOMATION_RUNTIME_REGISTRY } from '../server/domain/edgeAutomation/registry'
import { EDGE_PREREQUISITE_CATALOG } from '../shared/edgeAutomation/prerequisites'

const ROOT = resolve(import.meta.dirname, '..')
const failures: string[] = []
const assert = (condition: unknown, message: string): void => { if (!condition) failures.push(message) }
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
  return JSON.stringify(value)
}
const json = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T

for (const catalog of [EDGE_AUTOMATION_RULESET.catalogs.trainer, EDGE_AUTOMATION_RULESET.catalogs.poke]) {
  const bytes = readFileSync(resolve(ROOT, catalog.path))
  assert(bytes.length === catalog.bytes, `${catalog.path} byte count drifted`)
  assert(sha256(bytes) === catalog.sha256, `${catalog.path} SHA-256 drifted`)
  assert(execFileSync('git', ['hash-object', catalog.path], { cwd: ROOT, encoding: 'utf8' }).trim() === catalog.gitBlob,
    `${catalog.path} Git blob drifted`)
}
assert(EDGE_AUTOMATION_RULESET.runtimeAuthority.join('|') === 'data/reference/edges.json|data/reference/poke-edges.json',
  'runtime authority must contain only the two app-owned Edge catalogs')

interface InventoryRecord {
  family: 'trainer' | 'poke'
  canonicalId: string
  effectSha256: string
  recordSha256: string
}
interface Inventory {
  recordCount: number
  catalogs: {
    trainer: { entryCount: number; canonicalIds: string[] }
    poke: { entryCount: number; canonicalIds: string[] }
  }
  records: InventoryRecord[]
}
const inventory = json<Inventory>('data/edge-automation/inventory.json')
assert(inventory.recordCount === 81, 'inventory must freeze 81 Edge rows')
assert(inventory.catalogs.trainer.entryCount === 61, 'inventory must freeze 61 Trainer Edges')
assert(inventory.catalogs.poke.entryCount === 20, 'inventory must freeze 20 Poké Edges')
assert(JSON.stringify(inventory.catalogs.trainer.canonicalIds) === JSON.stringify(CANONICAL_TRAINER_EDGE_IDS), 'Trainer inventory identity order drifted')
assert(JSON.stringify(inventory.catalogs.poke.canonicalIds) === JSON.stringify(CANONICAL_POKE_EDGE_IDS), 'Poké inventory identity order drifted')
const expectedKeys = [
  ...CANONICAL_TRAINER_EDGE_IDS.map(id => canonicalEdgeKey('trainer', id)),
  ...CANONICAL_POKE_EDGE_IDS.map(id => canonicalEdgeKey('poke', id)),
]
for (const [index, key] of expectedKeys.entries()) {
  const row = inventory.records[index]
  const family = key.startsWith('trainer:') ? 'trainer' : 'poke'
  const canonicalId = key.slice(key.indexOf(':') + 1)
  const reference = canonicalEdgeReference(family, canonicalId)
  assert(Boolean(reference), `${key} has no app-owned reference row`)
  assert(row?.family === family && row?.canonicalId === canonicalId, `${key} inventory row is missing or out of order`)
  assert(row?.effectSha256 === sha256(reference?.effect ?? ''), `${key} effect hash drifted`)
  assert(row?.recordSha256 === sha256(stableJson(reference)), `${key} record hash drifted`)
}

interface Adjudications { status: string; entries: Array<{ id: string; family: 'trainer' | 'poke'; canonicalIds: string[]; decision: string; status: string; maintenanceEvidence?: string[] }> }
const adjudications = json<Adjudications>('data/edge-automation/source-adjudications.json')
assert(adjudications.status === 'reviewed-no-open-source-gaps', 'source adjudications contain an open gap')
for (const entry of adjudications.entries) {
  assert(entry.status === 'accepted', `${entry.id} is not accepted`)
  assert(entry.decision.trim().length > 0, `${entry.id} has no reviewed decision`)
  assert(entry.canonicalIds.every(id => expectedKeys.includes(canonicalEdgeKey(entry.family, id))), `${entry.id} names an unknown family-qualified Edge`)
  for (const path of entry.maintenanceEvidence ?? []) {
    try { readFileSync(resolve(ROOT, path)) } catch { failures.push(`${entry.id} has missing maintenance evidence ${path}`) }
  }
}

assert(EDGE_AUTOMATION_MANIFEST.entries.length === 81, 'manifest must contain 81 rows')
assert(EDGE_AUTOMATION_RUNTIME_REGISTRY.definitions.length === 81, 'runtime registry must contain 81 definitions')
assert(EDGE_PREREQUISITE_CATALOG.length === 81, 'prerequisite catalog must contain 81 rows')
const hashes = new Set<string>()
for (const entry of EDGE_AUTOMATION_MANIFEST.entries) {
  const runtime = EDGE_AUTOMATION_RUNTIME_REGISTRY.resolve(entry.family, entry.canonicalId)
  assert(Boolean(runtime), `${canonicalEdgeKey(entry.family, entry.canonicalId)} has no runtime`)
  if (!runtime) continue
  assert(runtime.spec.sourceEffectSha256 === entry.sourceEffectSha256, `${entry.canonicalId} runtime source hash drifted`)
  assert(runtime.spec.mechanics.length > 0, `${entry.canonicalId} has no reviewed mechanic`)
  assert(runtime.spec.registeredHandlerId === 'edge.native.v1', `${entry.canonicalId} is not native`)
  assert(/^[0-9a-f]{64}$/.test(runtime.definitionHash), `${entry.canonicalId} definition hash is malformed`)
  assert(!hashes.has(runtime.definitionHash), `${entry.canonicalId} definition hash collides`)
  hashes.add(runtime.definitionHash)
  assert(entry.serverAuthoritative && !entry.legacyExecutionAllowed, `${entry.canonicalId} weakens server authority`)
  assert(runtime.spec.actions.length === entry.actions.length, `${entry.canonicalId} action count drifted`)
  if (entry.status === 'delegated-complete') {
    assert(entry.family === 'trainer' && entry.canonicalId === 'Breeder' && entry.delegation?.capabilityId === 'breeding.v1',
      'only Breeder may use the closed delegation status')
  }
  else assert(entry.delegation === null, `${entry.canonicalId} has an unapproved delegation`)
}
assert(EDGE_AUTOMATION_MANIFEST.entries.filter(entry => entry.status === 'complete').length === 80, 'manifest must certify 80 native-complete rows')
assert(EDGE_AUTOMATION_MANIFEST.entries.filter(entry => entry.status === 'delegated-complete').length === 1, 'manifest must certify exactly one delegation')

interface Requirements { requirementCount: number; requirements: Array<{ id: string; family: 'trainer' | 'poke'; canonicalId: string; actionId?: string }> }
const scenarios = json<Requirements>('data/edge-automation/scenario-requirements.json')
const expectedRequirements = new Set(EDGE_AUTOMATION_MANIFEST.entries.flatMap(entry => [
  `edge:${entry.family}:${entry.canonicalId}:projection`,
  ...entry.actions.map(action => `edge:${entry.family}:${entry.canonicalId}:action:${action.id}`),
]))
assert(scenarios.requirementCount === scenarios.requirements.length, 'scenario requirement count is stale')
assert(scenarios.requirements.length === expectedRequirements.size, 'scenario catalog does not match manifest branches')
for (const requirement of scenarios.requirements) {
  assert(expectedRequirements.delete(requirement.id), `unexpected or duplicate scenario ${requirement.id}`)
  assert(expectedKeys.includes(canonicalEdgeKey(requirement.family, requirement.canonicalId)), `${requirement.id} names an unknown Edge`)
}
assert(expectedRequirements.size === 0, `missing scenarios: ${[...expectedRequirements].join(', ')}`)

for (const path of [
  'server/domain/edgeAutomation/acquisition.ts',
  'server/domain/edgeAutomation/campaignOperations.ts',
  'server/domain/edgeAutomation/pokemonLifecycle.ts',
  'server/domain/edgeAutomation/passiveProviders.ts',
  'server/domain/edgeAutomation/permanentGrants.ts',
  'docs/edge-automation.md',
  'docs/adrs/013-authoritative-edge-automation-runtime.md',
  'tests/server/edgeAutomation.test.ts',
]) {
  try { readFileSync(resolve(ROOT, path)) } catch { failures.push(`required artifact is missing: ${path}`) }
}

if (process.argv.includes('--check-plan')) {
  const donePath = resolve(ROOT, 'implementation-plans/done/EDGE_AUTOMATION_PLAN.md')
  let plan = ''
  try { plan = readFileSync(donePath, 'utf8') } catch { failures.push('done Edge plan is missing') }
  assert(plan.includes('PLAN_STATUS: DONE'), 'Edge plan is not marked DONE')
  assert(!/- \[ \] \*\*EA-/.test(plan), 'Edge plan still contains unfinished tickets')
}

if (failures.length > 0) {
  console.error(`Edge automation check failed (${failures.length}):`)
  failures.forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}
console.log(`Edge automation check passed: 61 Trainer + 20 Poké rows, 80 native-complete + 1 closed delegation, ${scenarios.requirements.length} reviewed scenarios.`)
