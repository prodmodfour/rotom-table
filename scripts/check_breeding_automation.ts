import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const failures: string[] = []
const assert = (condition: unknown, message: string): void => { if (!condition) failures.push(message) }
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left === right ? 0 : left < right ? -1 : 1)
      .map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
const json = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const hashObject = (path: string): string => execFileSync('git', ['hash-object', path], { cwd: ROOT, encoding: 'utf8' }).trim()

interface ArtifactRecord {
  id: string
  path: string
  ownerTicket: string
  kind: string
  binding: 'content-sha256' | 'definition-field' | 'live-validation'
  expectedSha256?: string
  definitionHashField?: string
  expectedDefinitionSha256?: string
}
interface GateRecord { id: string, targetTicket: string, prerequisiteTickets: string[] }
interface SemanticRegistry {
  schemaVersion: number
  registryId: string
  definitionSha256: string
  definition: {
    activePlanPath: string
    donePlanPath: string
    planTicketPrefix: string
    planTicketCount: number
    artifacts: ArtifactRecord[]
    vocabularies: Record<string, string[]>
    gates: GateRecord[]
    commands: Record<string, string>
    policies: Record<string, string>
  }
}
interface FrozenSource {
  path: string
  bytes: number
  sha256: string
  gitBlob: string
}
interface SourceManifest {
  schemaVersion: number
  rulesetId: string
  runtimeAuthority: string[]
  runtimeSources: FrozenSource[]
  reviewedAutomationContracts: FrozenSource[]
  productAuthority: FrozenSource[]
  documentarySources: FrozenSource[]
  parserBaselines: FrozenSource[]
  policies: Record<string, string>
}
interface Requirement {
  id: string
  ticketId: string
  phase: number
  title: string
  verificationKind: string
  requiredEvidenceKinds: string[]
  coverageStatus: string
  evidencePaths: string[]
  acceptanceFixtureIds: string[]
}
interface RequirementCatalog {
  schemaVersion: number
  catalogId: string
  planPath: string
  requirementCount: number
  coverageCounts: Record<string, number>
  requirements: Requirement[]
}
interface FixtureIndexEntry {
  id: string
  path: string
  scriptIds: string[]
  requirementIds: string[]
}
interface FixtureIndex {
  schemaVersion: number
  synthetic: boolean
  rulesetId: string
  containsCampaignData: boolean
  fixtureIndexId: string
  fixtureCount: number
  fixtures: FixtureIndexEntry[]
}
interface FixtureScript {
  id: string
  requirementIds: string[]
  actorAudience: string
  steps: string[]
  expected: string[]
}
interface AcceptanceFixture {
  schemaVersion: number
  synthetic: boolean
  rulesetId: string
  containsCampaignData: boolean
  sourceTicket: string
  fixtureId: string
  audiences: string[]
  scripts: FixtureScript[]
  [key: string]: unknown
}
interface PlanTicket { id: string, number: number, title: string, status: string, checked: boolean }

const registry = json<SemanticRegistry>('data/breeding-automation/semantic-registry.json')
assert(registry.schemaVersion === 1 && registry.registryId === 'breeding-semantic-registry-v1', 'semantic registry identity is invalid')
assert(sha256(stable(registry.definition)) === registry.definitionSha256, 'semantic registry definition hash drifted')
assert(registry.definition.planTicketPrefix === 'BR-' && registry.definition.planTicketCount === 90, 'semantic registry plan contract drifted')
assert(new Set(registry.definition.artifacts.map(artifact => artifact.id)).size === registry.definition.artifacts.length, 'semantic registry artifact IDs are duplicated')
const registeredArtifactKinds = new Set(registry.definition.vocabularies.artifactKinds)

for (const artifact of registry.definition.artifacts) {
  assert(registeredArtifactKinds.has(artifact.kind), `${artifact.id} has an unknown artifact kind`)
  assert(/^BR-\d{3}$/.test(artifact.ownerTicket), `${artifact.id} has an invalid owner ticket`)
  const absolutePath = resolve(ROOT, artifact.path)
  assert(existsSync(absolutePath), `${artifact.id} artifact is missing: ${artifact.path}`)
  if (!existsSync(absolutePath)) continue
  if (artifact.binding === 'content-sha256') {
    assert(artifact.expectedSha256 === sha256(readFileSync(absolutePath)), `${artifact.id} content SHA-256 drifted`)
  }
  else if (artifact.binding === 'definition-field') {
    const document = json<Record<string, unknown>>(artifact.path)
    const field = artifact.definitionHashField ?? 'definitionSha256'
    assert(document[field] === artifact.expectedDefinitionSha256, `${artifact.id} registered definition hash drifted`)
    assert(document.definition !== undefined && document[field] === sha256(stable(document.definition)), `${artifact.id} definition does not match its hash`)
  }
  else assert(artifact.binding === 'live-validation', `${artifact.id} has an unknown binding`)
}

const sourceManifestPath = 'data/breeding-automation/source-manifest.json'
const sourceManifest = json<SourceManifest>(sourceManifestPath)
const frozenSources = [
  ...sourceManifest.runtimeSources,
  ...sourceManifest.reviewedAutomationContracts,
  ...sourceManifest.productAuthority,
  ...sourceManifest.documentarySources,
  ...sourceManifest.parserBaselines,
]
assert(sourceManifest.schemaVersion === 1 && sourceManifest.rulesetId === 'ptu-1.05-breeding-v1', 'source manifest identity drifted')
assert(frozenSources.length === 30 && new Set(frozenSources.map(source => source.path)).size === 30, 'source manifest must freeze 30 unique records')
assert(JSON.stringify(sourceManifest.runtimeAuthority) === JSON.stringify(sourceManifest.runtimeSources.map(source => source.path)), 'runtime authority and runtime source order differ')
assert(sourceManifest.runtimeAuthority.every(path => path.startsWith('data/reference/')), 'breeding runtime authority contains a non-reference source')
assert(sourceManifest.policies.documentarySupplementation === 'forbidden-at-runtime', 'documentary runtime supplementation is not forbidden')
for (const source of frozenSources) {
  try {
    const bytes = readFileSync(resolve(ROOT, source.path))
    assert(bytes.byteLength === source.bytes, `${source.path} byte count drifted`)
    assert(sha256(bytes) === source.sha256, `${source.path} SHA-256 drifted`)
    assert(hashObject(source.path) === source.gitBlob, `${source.path} Git blob drifted`)
  }
  catch {
    failures.push(`frozen source is missing: ${source.path}`)
  }
}

const sourceManifestSha256 = sha256(readFileSync(resolve(ROOT, sourceManifestPath)))
const ruleset = json<Record<string, any>>('data/breeding-automation/ruleset.json')
assert(ruleset.schemaVersion === 1 && ruleset.rulesetId === sourceManifest.rulesetId && ruleset.status === 'reviewed', 'breeding ruleset identity or status drifted')
assert(ruleset.definitionSha256 === sha256(stable(ruleset.definition)), 'breeding ruleset definition hash drifted')
assert(ruleset.definition?.sourceManifestSha256 === sourceManifestSha256, 'breeding ruleset source-manifest hash drifted')
assert(ruleset.definition?.authority?.mechanics === 'server-only' && ruleset.definition?.authority?.documentaryRuntimeUse === 'forbidden', 'breeding ruleset weakens server or source authority')
assert(Array.isArray(ruleset.definition?.campaignOptions) && ruleset.definition.campaignOptions.length === 15, 'breeding ruleset must freeze 15 campaign options')

for (const path of [
  'data/breeding-automation/taxonomies.json',
  'data/breeding-automation/family-graph-policy.json',
  'data/breeding-automation/hatch-duration-policy.json',
  'data/breeding-automation/modifier-inventory.json',
  'data/breeding-automation/security-policy.json',
  'data/breeding-automation/ownership-map.json',
  'data/breeding-automation/canonical-ids.json',
  'data/breeding-automation/spec-schemas.json',
  'data/breeding-automation/compatibility-policy.json',
  'data/breeding-automation/offspring-resolution-policy.json',
  'data/breeding-automation/natures.json',
  'data/breeding-automation/trait-resolution-policy.json',
  'data/breeding-automation/inheritance-candidate-policy.json',
  'data/breeding-automation/egg-rule-helpers-policy.json',
  'data/breeding-automation/pure-rules-conformance.json',
]) {
  const document = json<Record<string, any>>(path)
  assert(document.rulesetId === ruleset.rulesetId, `${path} ruleset ID drifted`)
  assert(document.rulesetDefinitionSha256 === ruleset.definitionSha256, `${path} ruleset definition link drifted`)
  assert(document.sourceManifestSha256 === sourceManifestSha256, `${path} source-manifest link drifted`)
  assert(document.definitionSha256 === sha256(stable(document.definition)), `${path} definition hash drifted`)
}
const adjudications = json<Record<string, any>>('data/breeding-automation/source-adjudications.json')
assert(adjudications.status === 'reviewed-no-open-runtime-conflicts', 'breeding source adjudications are open')
assert(adjudications.rulesetDefinitionSha256 === ruleset.definitionSha256 && adjudications.sourceManifestSha256 === sourceManifestSha256, 'breeding adjudication links drifted')
assert(Array.isArray(adjudications.entries) && adjudications.entries.length === 20 && adjudications.entries.every((entry: any) => entry.status === 'accepted'), 'breeding adjudications must contain 20 accepted conflicts')

const compilerDefinition = json<Record<string, any>>('data/breeding-automation/compiler-definition.json')
assert(compilerDefinition.compilerId === 'ptu-1.05-breeding-spec-compiler-v1', 'breeding compiler identity drifted')
assert(compilerDefinition.definitionSha256 === sha256(stable(compilerDefinition.definition)), 'breeding compiler definition hash drifted')
assert(compilerDefinition.definition?.source?.sha256 === sourceManifest.runtimeSources.find(source => source.path === 'data/reference/pokedex.json')?.sha256, 'breeding compiler Pokédex source hash drifted')
const targetAdjudications = json<Record<string, any>>('data/breeding-automation/evolution-target-adjudications.json')
const formAdjudications = json<Record<string, any>>('data/breeding-automation/form-adjudications.json')
const familyResolutionDefinition = json<Record<string, any>>('data/breeding-automation/family-resolution-definition.json')
const familyResolutionInventory = json<Record<string, any>>('data/breeding-automation/family-resolution-inventory.json')
for (const [label, document] of [
  ['evolution-target adjudications', targetAdjudications],
  ['form adjudications', formAdjudications],
  ['Family resolution definition', familyResolutionDefinition],
  ['Family resolution inventory', familyResolutionInventory],
] as const) assert(document.definitionSha256 === sha256(stable(document.definition)), `${label} definition hash drifted`)
assert(targetAdjudications.definition?.entries?.length === 127, 'evolution-target adjudication closure drifted')
assert(formAdjudications.definition?.rows?.length === 1_149, 'form adjudication closure drifted')
assert(compilerDefinition.definition?.bindings?.evolutionTargetAdjudicationsDefinitionSha256 === targetAdjudications.definitionSha256, 'compiler evolution-target link drifted')
assert(compilerDefinition.definition?.bindings?.formAdjudicationsDefinitionSha256 === formAdjudications.definitionSha256, 'compiler form-adjudication link drifted')
const familyResolutions = json<Record<string, any>>('data/breeding-automation/family-resolutions.json')
assert(familyResolutions.compilerDefinitionSha256 === compilerDefinition.definitionSha256, 'family resolutions compiler link drifted')
assert(familyResolutions.resolutionDefinitionSha256 === familyResolutionDefinition.definitionSha256, 'family resolutions definition link drifted')
assert(familyResolutions.definitionSha256 === sha256(stable(familyResolutions.definition)), 'family resolutions definition hash drifted')
assert(familyResolutionInventory.resolutionSetDefinitionSha256 === familyResolutions.definitionSha256, 'Family inventory resolution-set link drifted')
assert(familyResolutionInventory.definition?.summary?.speciesCount === 1_149, 'Family inventory Species closure drifted')
assert(familyResolutionInventory.definition?.summary?.resolvedSpeciesCount + familyResolutionInventory.definition?.summary?.excludedSpeciesCount === 1_149, 'Family inventory disposition closure drifted')
const compiledRegistry = json<Record<string, any>>('data/breeding-automation/compiled-registry.json')
const { definitionSha256: compiledRegistryHash, ...compiledRegistryDefinition } = compiledRegistry
assert(compiledRegistryHash === sha256(stable(compiledRegistryDefinition)), 'compiled breeding registry definition hash drifted')
assert(compiledRegistry.compilerDefinitionSha256 === compilerDefinition.definitionSha256, 'compiled breeding registry compiler link drifted')
assert(compiledRegistry.familyResolutionDefinitionSha256 === familyResolutions.definitionSha256, 'compiled breeding registry family-resolution link drifted')
assert(Array.isArray(compiledRegistry.familySpecs) && Array.isArray(compiledRegistry.speciesSpecs), 'compiled breeding registry rows are invalid')
const compilerReport = json<Record<string, any>>('data/breeding-automation/compiler-validation-report.json')
const { definitionSha256: compilerReportHash, ...compilerReportDefinition } = compilerReport
assert(compilerReportHash === sha256(stable(compilerReportDefinition)), 'breeding compiler report definition hash drifted')
assert(compilerReport.registryDefinitionSha256 === compiledRegistry.definitionSha256, 'breeding compiler report registry link drifted')
assert(compilerReport.summary?.sourceRecordCount === 1_149, 'breeding compiler report source count drifted')
assert(compilerReport.summary?.compiledFamilyCount === compiledRegistry.familySpecs?.length, 'breeding compiler Family count drifted')
assert(compilerReport.summary?.compiledSpeciesCount === compiledRegistry.speciesSpecs?.length, 'breeding compiler Species count drifted')
assert(compilerReport.summary?.compiledSpeciesCount + compilerReport.summary?.excludedSpeciesCount === 1_149, 'breeding compiler inclusion closure drifted')
assert(Array.isArray(compilerReport.diagnostics) && compilerReport.summary?.errorCount + compilerReport.summary?.warningCount === compilerReport.diagnostics.length, 'breeding compiler diagnostic counts drifted')
assert(compilerReport.diagnostics.every((diagnostic: Record<string, unknown>) => !Object.hasOwn(diagnostic, 'rawValue')), 'breeding compiler diagnostics expose raw values')

const planPath = existsSync(resolve(ROOT, registry.definition.activePlanPath))
  ? registry.definition.activePlanPath
  : registry.definition.donePlanPath
assert(existsSync(resolve(ROOT, planPath)), 'breeding implementation plan is missing from active and done locations')
const plan = existsSync(resolve(ROOT, planPath)) ? readFileSync(resolve(ROOT, planPath), 'utf8') : ''
const planStatus = /`PLAN_STATUS: ([A-Z_]+)`/.exec(plan)?.[1] ?? ''
const currentTicket = /`CURRENT_TICKET: ([A-Z0-9-]+)`/.exec(plan)?.[1] ?? ''
const ticketPattern = /^- \[([ x])\] \*\*(BR-(\d{3})) — (.+?)\*\* — `([A-Z_]+)`/gm
const tickets: PlanTicket[] = []
for (const match of plan.matchAll(ticketPattern)) {
  tickets.push({ id: match[2]!, number: Number(match[3]), title: match[4]!, status: match[5]!, checked: match[1] === 'x' })
}
const ticketStatuses = new Set(registry.definition.vocabularies.ticketStatuses)
assert(tickets.length === registry.definition.planTicketCount, `breeding plan must contain ${registry.definition.planTicketCount} tickets`)
assert(tickets.every((ticket, index) => ticket.number === index + 1 && ticket.id === `BR-${String(index + 1).padStart(3, '0')}`), 'breeding tickets are missing or out of order')
assert(tickets.every(ticket => ticketStatuses.has(ticket.status)), 'breeding plan contains an unknown ticket status')
assert(tickets.every(ticket => ticket.checked === (ticket.status === 'DONE')), 'breeding plan checkbox and status disagree')
const inProgress = tickets.filter(ticket => ticket.status === 'IN_PROGRESS')
const unfinished = tickets.find(ticket => ticket.status !== 'DONE')
if (planStatus === 'DONE') {
  assert(inProgress.length === 0 && !unfinished, 'DONE breeding plan contains unfinished tickets')
  assert(currentTicket === 'NONE', 'DONE breeding plan CURRENT_TICKET must be NONE')
}
else {
  assert(planStatus === 'IN_PROGRESS' || planStatus === 'BLOCKED', 'active breeding plan has an invalid PLAN_STATUS')
  assert(inProgress.length === (planStatus === 'IN_PROGRESS' ? 1 : 0), 'active breeding plan must have the expected in-progress ticket count')
  if (planStatus === 'IN_PROGRESS') assert(currentTicket === unfinished?.id && inProgress[0]?.id === currentTicket, 'CURRENT_TICKET is not the lowest unfinished in-progress ticket')
}
const progressDone = Number(/Plan tickets: \*\*(\d+) DONE \/ 90 total\*\*/.exec(plan)?.[1] ?? -1)
assert(progressDone === tickets.filter(ticket => ticket.status === 'DONE').length, 'breeding progress snapshot DONE count drifted')

const requirements = json<RequirementCatalog>('data/breeding-automation/scenario-requirements.json')
assert(requirements.schemaVersion === 1 && requirements.catalogId === 'breeding-scenario-requirements-v1', 'breeding scenario catalog identity drifted')
assert(requirements.requirementCount === 90 && requirements.requirements.length === 90, 'breeding scenario catalog must cover 90 tickets')
const coverageStatuses = new Set(registry.definition.vocabularies.coverageStatuses)
const verificationKinds = new Set(registry.definition.vocabularies.verificationKinds)
const evidenceKinds = new Set(registry.definition.vocabularies.evidenceKinds)
const expectedCoverage: Record<string, string> = { TODO: 'planned', IN_PROGRESS: 'in-progress', DONE: 'covered', BLOCKED: 'blocked' }
for (const [index, requirement] of requirements.requirements.entries()) {
  const ticket = tickets[index]
  assert(requirement.id === `breeding:${ticket?.id}` && requirement.ticketId === ticket?.id, `${requirement.id} is not aligned with plan order`)
  assert(requirement.title === ticket?.title, `${requirement.id} title drifted from the plan`)
  assert(coverageStatuses.has(requirement.coverageStatus), `${requirement.id} has unknown coverage status`)
  assert(requirement.coverageStatus === expectedCoverage[ticket?.status ?? ''], `${requirement.id} coverage does not mirror ticket status`)
  assert(verificationKinds.has(requirement.verificationKind), `${requirement.id} has unknown verification kind`)
  assert(requirement.requiredEvidenceKinds.length > 0 && requirement.requiredEvidenceKinds.every(kind => evidenceKinds.has(kind)), `${requirement.id} has invalid evidence kinds`)
  if (requirement.coverageStatus === 'covered') {
    assert(requirement.evidencePaths.length > 0, `${requirement.id} has no evidence paths`)
  }
  if (requirement.coverageStatus === 'covered' || requirement.coverageStatus === 'in-progress') {
    for (const path of requirement.evidencePaths) assert(existsSync(resolve(ROOT, path)), `${requirement.id} evidence is missing: ${path}`)
  }
  else assert(requirement.evidencePaths.length === 0, `${requirement.id} has premature evidence paths`)
}
for (const status of coverageStatuses) {
  assert(requirements.coverageCounts[status] === requirements.requirements.filter(requirement => requirement.coverageStatus === status).length, `coverage count for ${status} drifted`)
}

for (const gate of registry.definition.gates) {
  const target = tickets.find(ticket => ticket.id === gate.targetTicket)
  assert(Boolean(target), `${gate.id} target ticket is missing`)
  if (target && (target.status === 'IN_PROGRESS' || target.status === 'DONE')) {
    for (const prerequisite of gate.prerequisiteTickets) {
      assert(tickets.find(ticket => ticket.id === prerequisite)?.status === 'DONE', `${gate.id} advanced before ${prerequisite} was DONE`)
    }
  }
}

const security = json<Record<string, any>>('data/breeding-automation/security-policy.json')
const audienceIds = new Set((security.definition?.audiences ?? []).map((audience: any) => audience.id))
const fixtureIndex = json<FixtureIndex>('data/breeding-automation/fixtures/index.json')
assert(fixtureIndex.schemaVersion === 1 && fixtureIndex.synthetic === true && fixtureIndex.containsCampaignData === false, 'fixture index must be synthetic and contain no campaign data')
assert(fixtureIndex.rulesetId === ruleset.rulesetId && fixtureIndex.fixtureCount === fixtureIndex.fixtures.length && fixtureIndex.fixtureCount === 6, 'fixture index identity or count drifted')
assert(new Set(fixtureIndex.fixtures.map(fixture => fixture.id)).size === fixtureIndex.fixtures.length, 'fixture index IDs are duplicated')
const fixtureIds = new Set(fixtureIndex.fixtures.map(fixture => fixture.id))
const requirementIds = new Set(requirements.requirements.map(requirement => requirement.id))
const pokedexSpecies = new Set((json<Array<{ species: string }>>('data/reference/pokedex.json')).map(row => row.species))
const privateKeyPattern = /^(password|authorization|cookie|session|accessToken|refreshToken|privateKey)$/i
const inspectFixtureValue = (value: unknown, path: string): void => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectFixtureValue(entry, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    assert(!privateKeyPattern.test(key), `${path}.${key} is forbidden private fixture data`)
    if (key === 'sourceSpeciesName') assert(typeof entry === 'string' && pokedexSpecies.has(entry), `${path}.${key} is not an app-owned species identity`)
    if (key === 'sourceSpeciesNames') assert(Array.isArray(entry) && entry.every(name => typeof name === 'string' && pokedexSpecies.has(name)), `${path}.${key} contains a non-canonical species identity`)
    inspectFixtureValue(entry, `${path}.${key}`)
  }
}
for (const indexed of fixtureIndex.fixtures) {
  assert(existsSync(resolve(ROOT, indexed.path)), `${indexed.id} fixture file is missing`)
  if (!existsSync(resolve(ROOT, indexed.path))) continue
  const fixture = json<AcceptanceFixture>(indexed.path)
  assert(fixture.schemaVersion === 1 && fixture.synthetic === true && fixture.containsCampaignData === false && fixture.sourceTicket === 'BR-008', `${indexed.id} is not a synthetic BR-008 fixture`)
  assert(fixture.fixtureId === indexed.id && fixture.rulesetId === ruleset.rulesetId, `${indexed.id} identity or ruleset drifted`)
  assert(fixture.audiences.length > 0 && fixture.audiences.every(audience => audienceIds.has(audience)), `${indexed.id} names an invalid audience`)
  assert(new Set(fixture.scripts.map(script => script.id)).size === fixture.scripts.length, `${indexed.id} has duplicate scripts`)
  assert(JSON.stringify(fixture.scripts.map(script => script.id)) === JSON.stringify(indexed.scriptIds), `${indexed.id} script index drifted`)
  const fixtureRequirements = [...new Set(fixture.scripts.flatMap(script => script.requirementIds))].sort()
  assert(JSON.stringify(fixtureRequirements) === JSON.stringify(indexed.requirementIds), `${indexed.id} requirement index drifted`)
  for (const script of fixture.scripts) {
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(script.id), `${indexed.id}/${script.id} is not a stable script ID`)
    assert(audienceIds.has(script.actorAudience), `${indexed.id}/${script.id} has an invalid actor audience`)
    assert(script.requirementIds.length > 0 && script.requirementIds.every(id => requirementIds.has(id)), `${indexed.id}/${script.id} has invalid requirements`)
    assert(script.steps.length > 0 && script.expected.length > 0, `${indexed.id}/${script.id} is incomplete`)
  }
  inspectFixtureValue(fixture, indexed.id)
}
for (const requirement of requirements.requirements) {
  assert(requirement.acceptanceFixtureIds.every(id => fixtureIds.has(id)), `${requirement.id} names an unknown acceptance fixture`)
}

for (const path of [
  'scripts/check_breeding_automation.ts',
  'tests/scripts/breedingAutomationChecker.test.ts',
  'tests/data/breedingSourceManifest.test.ts',
  'tests/data/breedingRulesetAdjudications.test.ts',
  'tests/data/breedingTaxonomies.test.ts',
  'tests/data/breedingFamilyGraphPolicy.test.ts',
  'tests/data/breedingHatchDurationPolicy.test.ts',
  'tests/data/breedingModifierInventory.test.ts',
  'tests/data/breedingSecurityPolicy.test.ts',
  'tests/data/breedingRuntimeOwnership.test.ts',
  'shared/breeding/ids.ts',
  'server/domain/breeding/canonicalIds.ts',
  'tests/server/breedingCanonicalIds.test.ts',
  'shared/breeding/specs.ts',
  'server/domain/breeding/specSchemaContext.ts',
  'tests/server/breedingSpecSchemas.test.ts',
  'server/domain/breeding/compiler.ts',
  'scripts/compile_breeding_registry.ts',
  'tests/server/breedingCompiler.test.ts',
  'server/domain/breeding/familyResolutionBuilder.ts',
  'server/domain/breeding/registry.ts',
  'scripts/build_breeding_family_resolutions.ts',
  'tests/server/breedingFamilyResolution.test.ts',
  'server/domain/breeding/campaignOptions.ts',
  'server/domain/breeding/compatibility.ts',
  'tests/server/breedingCompatibility.test.ts',
  'server/domain/breeding/offspringResolution.ts',
  'tests/server/breedingOffspringResolution.test.ts',
  'server/domain/breeding/natures.ts',
  'server/domain/breeding/traitResolution.ts',
  'tests/server/breedingTraitResolution.test.ts',
  'server/domain/breeding/inheritanceCandidates.ts',
  'tests/server/breedingInheritanceCandidates.test.ts',
  'server/domain/breeding/eggRuleHelpers.ts',
  'tests/server/breedingEggRuleHelpers.test.ts',
  'tests/server/breedingPureRulesConformance.test.ts',
  'docs/adrs/018-authoritative-breeding-and-egg-runtime.md',
  'docs/breeding/architecture-and-ownership.md',
  'docs/breeding/contributor-guide.md',
  'docs/breeding/operator-guide.md',
  'docs/breeding/baseline-audit.md',
]) assert(existsSync(resolve(ROOT, path)), `required breeding checker artifact is missing: ${path}`)

if (process.argv.includes('--require-complete')) {
  assert(planPath === registry.definition.donePlanPath, 'complete breeding plan must be archived')
  assert(planStatus === 'DONE', 'complete breeding plan must have PLAN_STATUS: DONE')
  assert(tickets.every(ticket => ticket.status === 'DONE'), 'complete breeding plan has unfinished tickets')
  assert(requirements.requirements.every(requirement => requirement.coverageStatus === 'covered'), 'complete breeding coverage has unfinished requirements')
}

if (failures.length > 0) {
  console.error(`Breeding automation check failed (${failures.length}):`)
  failures.forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}
console.log(`Breeding automation check passed: ${tickets.filter(ticket => ticket.status === 'DONE').length}/90 tickets, ${frozenSources.length} frozen sources, ${adjudications.entries.length} adjudications, ${fixtureIndex.fixtureCount} fixtures, ${fixtureIndex.fixtures.reduce((sum, fixture) => sum + fixture.scriptIds.length, 0)} scripts.`)
