import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { CANONICAL_CAPABILITY_IDS, CANONICAL_CAPABILITY_REFERENCE } from '../shared/capabilityAutomation/catalog'
import { CAPABILITY_AUTOMATION_MANIFEST } from '../shared/capabilityAutomation/manifest'
import { CAPABILITY_AUTOMATION_RULESET } from '../shared/capabilityAutomation/ruleset'
import { CAPABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../server/domain/capabilityAutomation/registry'

const ROOT = resolve(import.meta.dirname, '..')
const failures: string[] = []
const assert = (condition: unknown, message: string): void => { if (!condition) failures.push(message) }
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
  return JSON.stringify(value)
}
const json = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T

const canonicalBytes = readFileSync(resolve(ROOT, 'data/reference/capabilities.json'))
assert(sha256(canonicalBytes) === CAPABILITY_AUTOMATION_RULESET.canonicalSource.sha256, 'canonical source SHA-256 drifted')
assert(canonicalBytes.length === CAPABILITY_AUTOMATION_RULESET.canonicalSource.bytes, 'canonical source byte count drifted')
assert(execFileSync('git', ['hash-object', 'data/reference/capabilities.json'], { cwd: ROOT, encoding: 'utf8' }).trim()
  === CAPABILITY_AUTOMATION_RULESET.canonicalSource.gitBlob, 'canonical source Git blob drifted')

const parserBytes = readFileSync(resolve(ROOT, CAPABILITY_AUTOMATION_RULESET.parser.path))
assert(sha256(parserBytes) === CAPABILITY_AUTOMATION_RULESET.parser.sha256, 'parser SHA-256 drifted')
assert(execFileSync('git', ['hash-object', CAPABILITY_AUTOMATION_RULESET.parser.path], { cwd: ROOT, encoding: 'utf8' }).trim()
  === CAPABILITY_AUTOMATION_RULESET.parser.gitBlob, 'parser Git blob drifted')
for (const source of CAPABILITY_AUTOMATION_RULESET.sourcePriority) {
  const bytes = readFileSync(resolve(ROOT, source.path))
  assert(bytes.length === source.bytes, `${source.path} byte count drifted`)
  assert(sha256(bytes) === source.sha256, `${source.path} SHA-256 drifted`)
  assert(basename(source.path) === source.basename, `${source.path} basename is inconsistent`)
  assert(execFileSync('git', ['hash-object', source.path], { cwd: ROOT, encoding: 'utf8' }).trim() === source.gitBlob,
    `${source.path} Git blob drifted`)
}

interface Inventory {
  entryCount: number
  canonicalIds: string[]
  records: Array<{ canonicalId: string; source: string; sourcePath: string; sourceSha256: string; effectSha256: string; recordSha256: string }>
  parserAudit: { status: string; canonicalDifferencesFromParserOutput: Array<{ canonicalId: string; adjudicationId: string }> }
}
const inventory = json<Inventory>('data/capability-automation/inventory.json')
assert(inventory.entryCount === 83, 'inventory must freeze 83 rows')
assert(JSON.stringify(inventory.canonicalIds) === JSON.stringify(CANONICAL_CAPABILITY_IDS), 'inventory canonical order drifted')
assert(inventory.parserAudit.status === 'reviewed', 'parser audit is not reviewed')
for (const [index, id] of CANONICAL_CAPABILITY_IDS.entries()) {
  const row = inventory.records[index]
  const reference = CANONICAL_CAPABILITY_REFERENCE[id]!
  assert(row?.canonicalId === id, `${id} inventory row is missing or out of order`)
  assert(row?.source === reference.source, `${id} source basename drifted`)
  assert(row?.effectSha256 === sha256(reference.effect), `${id} effect hash drifted`)
  assert(row?.sourceSha256 === sha256(readFileSync(resolve(ROOT, row.sourcePath))), `${id} source-byte hash drifted`)
  assert(row?.recordSha256 === sha256(stableJson(reference)), `${id} record hash drifted`)
}

interface Adjudications { status: string; entries: Array<{ id: string; canonicalId: string; status: string; evidence: string[] }> }
const adjudications = json<Adjudications>('data/capability-automation/source-adjudications.json')
assert(adjudications.status === 'reviewed-no-open-source-gaps', 'source adjudications contain an open gap')
for (const entry of adjudications.entries) {
  assert(entry.status === 'accepted', `${entry.id} is not accepted`)
  assert(CANONICAL_CAPABILITY_IDS.includes(entry.canonicalId), `${entry.id} names an unknown capability`)
  assert(entry.evidence.length > 0 && entry.evidence.every(path => {
    try { readFileSync(resolve(ROOT, path)); return true } catch { return false }
  }), `${entry.id} has missing evidence`)
}

assert(CAPABILITY_AUTOMATION_MANIFEST.entries.length === 83, 'manifest must contain 83 rows')
assert(CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.definitions.length === 83, 'runtime registry must contain 83 definitions')
const hashes = new Set<string>()
for (const entry of CAPABILITY_AUTOMATION_MANIFEST.entries) {
  const runtime = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(entry.canonicalId)
  assert(Boolean(runtime), `${entry.canonicalId} has no runtime`)
  if (!runtime) continue
  assert(runtime.spec.sourceEffectSha256 === entry.sourceEffectSha256, `${entry.canonicalId} runtime source hash drifted`)
  assert(runtime.spec.semanticTags.length > 0, `${entry.canonicalId} has no reviewed semantic clauses`)
  assert(runtime.spec.registeredHandlerId === 'capability.native.v1', `${entry.canonicalId} is not on the native handler`)
  assert(/^[0-9a-f]{64}$/.test(runtime.definitionHash), `${entry.canonicalId} definition hash is malformed`)
  assert(!hashes.has(runtime.definitionHash), `${entry.canonicalId} definition hash collides`)
  hashes.add(runtime.definitionHash)
  assert(entry.automationStatus === 'native' && entry.serverAuthoritative && !entry.legacyExecutionAllowed,
    `${entry.canonicalId} weakens native/server-only execution`)
  assert(runtime.spec.actions.length === entry.actions.length, `${entry.canonicalId} action registration count drifted`)
  for (const action of runtime.spec.actions) {
    assert(action.mechanic !== undefined, `${entry.canonicalId}/${action.actionId} has no mechanic`)
    assert(action.contextPredicateId.startsWith(`capability.${entry.canonicalId}.`), `${entry.canonicalId}/${action.actionId} has an unbound context`)
  }
}

interface Requirements { requirementCount: number; requirements: Array<{ id: string; canonicalId: string; actionId?: string }> }
const scenarios = json<Requirements>('data/capability-automation/scenario-requirements.json')
const expectedRequirementIds = new Set(CAPABILITY_AUTOMATION_MANIFEST.entries.flatMap(entry => [
  `capability:${entry.canonicalId}:passive`,
  ...entry.actions.map(action => `capability:${entry.canonicalId}:action:${action.id}`),
]))
assert(scenarios.requirementCount === scenarios.requirements.length, 'scenario requirement count is stale')
assert(scenarios.requirements.length === expectedRequirementIds.size, 'scenario catalog does not match manifest branches')
for (const requirement of scenarios.requirements) {
  assert(expectedRequirementIds.delete(requirement.id), `unexpected or duplicate scenario ${requirement.id}`)
  assert(CANONICAL_CAPABILITY_IDS.includes(requirement.canonicalId), `${requirement.id} names an unknown capability`)
}
assert(expectedRequirementIds.size === 0, `missing scenarios: ${[...expectedRequirementIds].join(', ')}`)

const mechanicSource = readFileSync(resolve(ROOT, 'server/domain/capabilityAutomation/executeMechanic.ts'), 'utf8')
assert(!/GM resolves narrative|manual(?:ly)? resolve|legacy fallback/i.test(mechanicSource), 'native mechanic contains a manual/legacy execution fallback')
for (const path of [
  'server/api/maps/capabilities/execute.post.ts',
  'server/api/maps/capabilities/adjudications/resolve.post.ts',
  'server/storage/capabilityResolutionOperationRepository.ts',
  'server/storage/capabilityAdjudicationRepository.ts',
  'docs/capability-automation.md',
  'docs/adrs/012-authoritative-capability-automation-runtime.md',
]) {
  try { readFileSync(resolve(ROOT, path)) } catch { failures.push(`required artifact is missing: ${path}`) }
}

if (process.argv.includes('--check-plan')) {
  const plan = readFileSync(resolve(ROOT, 'implementation-plans/done/CAPABILITY_AUTOMATION_PLAN.md'), 'utf8')
  assert(plan.includes('PLAN_STATUS: DONE'), 'capability plan is not marked DONE')
  assert(!/- \[ \] \*\*CA-/.test(plan), 'capability plan still contains unfinished tickets')
}

if (failures.length > 0) {
  console.error(`Capability automation check failed (${failures.length}):`)
  failures.forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}
console.log(`Capability automation check passed: 83/83 native rows, ${scenarios.requirements.length} reviewed scenarios, zero manual/legacy execution paths.`)
