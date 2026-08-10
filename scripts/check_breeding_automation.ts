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
  'data/breeding-automation/project-contract.json',
  'data/breeding-automation/egg-contract.json',
  'data/breeding-automation/lineage-contract.json',
  'data/breeding-automation/operation-contract.json',
  'data/breeding-automation/ledger-contract.json',
  'data/breeding-automation/read-set-contract.json',
  'data/breeding-automation/authorization-contract.json',
  'data/breeding-automation/projection-contract.json',
  'data/breeding-automation/archive-contract.json',
  'data/breeding-automation/storage-schema-v22.json',
  'data/breeding-automation/repository-contract.json',
  'data/breeding-automation/initialized-pokemon-sheet-contract.json',
  'data/breeding-automation/species-acquisition-reward-contract.json',
  'data/breeding-automation/species-acquisition-integration-contract.json',
  'data/breeding-automation/workshop-presentation-contract.json',
  'data/breeding-automation/project-wizard-presentation-contract.json',
  'data/breeding-automation/project-guidance-presentation-contract.json',
  'data/breeding-automation/project-choices-presentation-contract.json',
  'data/breeding-automation/workshop-activity-presentation-contract.json',
  'data/breeding-automation/hatch-workflow-presentation-contract.json',
  'data/breeding-automation/hatch-destination-presentation-contract.json',
  'data/breeding-automation/consent-workflow-presentation-contract.json',
  'data/breeding-automation/workshop-interaction-acceptance.json',
  'data/breeding-automation/campaign-operation-ledger-contract.json',
  'data/breeding-automation/campaign-clock-contract.json',
  'data/breeding-automation/realtime-contract.json',
  'data/breeding-automation/transaction-coordinator-contract.json',
  'data/breeding-automation/archive-storage-schema-v23.json',
  'data/breeding-automation/archive-storage-runtime-contract.json',
  'data/breeding-automation/persistence-conformance-contract.json',
  'data/breeding-automation/project-setup-validation-contract.json',
  'data/breeding-automation/project-initial-progress-contract.json',
  'data/breeding-automation/project-check-contract.json',
  'data/breeding-automation/project-additional-progress-contract.json',
  'data/breeding-automation/production-snapshot-contract.json',
  'data/breeding-automation/offspring-production-contract.json',
  'data/breeding-automation/egg-production-contract.json',
  'data/breeding-automation/lifecycle-recovery-contract.json',
  'data/breeding-automation/incubation-contract.json',
  'data/breeding-automation/incubation-storage-schema-v24.json',
  'data/breeding-automation/readiness-correction-contract.json',
  'data/breeding-automation/campaign-clock-incubation-batch-contract.json',
  'data/breeding-automation/egg-lifecycle-policy-contract.json',
  'data/breeding-automation/hatch-offer-contract.json',
  'data/breeding-automation/hatch-special-contract.json',
  'data/breeding-automation/child-sheet-construction-contract.json',
  'data/breeding-automation/hatch-completion-contract.json',
  'data/breeding-automation/hatch-species-acquisition-contract.json',
  'data/breeding-automation/hatch-resilience-contract.json',
  'data/breeding-automation/breeder-edge-handoff-contract.json',
  'data/breeding-automation/feature-provider-handoff-contract.json',
  'data/breeding-automation/modifier-provider-handoff-contract.json',
  'data/breeding-automation/storage-schema-v25.json',
  'data/breeding-automation/parent-source-change-contract.json',
  'data/breeding-automation/storage-schema-v26.json',
  'data/breeding-automation/storage-schema-v27.json',
  'data/breeding-automation/storage-schema-v28.json',
  'data/breeding-automation/egg-transfer-contract.json',
  'data/breeding-automation/fossil-egg-contract.json',
  'data/breeding-automation/gm-egg-contract.json',
]) {
  const document = json<Record<string, any>>(path)
  assert(document.rulesetId === ruleset.rulesetId, `${path} ruleset ID drifted`)
  assert(document.rulesetDefinitionSha256 === ruleset.definitionSha256, `${path} ruleset definition link drifted`)
  assert(document.sourceManifestSha256 === sourceManifestSha256, `${path} source-manifest link drifted`)
  assert(document.definitionSha256 === sha256(stable(document.definition)), `${path} definition hash drifted`)
}
const hatchOfferContract = json<Record<string, any>>('data/breeding-automation/hatch-offer-contract.json')
assert(hatchOfferContract.contractId === 'rotom-pokemon-egg-hatch-offer-v1', 'hatch-offer contract identity drifted')
assert(JSON.stringify(hatchOfferContract.definition?.command?.destinationKinds) === JSON.stringify(['box', 'team']), 'hatch destination kinds drifted')
assert(hatchOfferContract.definition?.ownerDestinationFact?.teamCapacity === 6, 'hatch team capacity drifted')
assert(hatchOfferContract.definition?.offer?.validity === 'issued-at-current-campaign-minute-and-expires-exactly-one-minute-later', 'hatch offer expiry policy drifted')
assert(hatchOfferContract.definition?.offer?.settlement === 'none-BR-054-does-not-start-or-mutate-the-Egg', 'hatch offer projection must remain non-mutating')
assert(hatchOfferContract.definition?.blockers?.sourceContinuityLoss === 'not-a-hatch-blocker-after-Egg-acceptance', 'accepted source loss became a hatch blocker')
assert(hatchOfferContract.definition?.tests?.focusedCount === 10, 'hatch-offer focused test count drifted')
const hatchSpecialContract = json<Record<string, any>>('data/breeding-automation/hatch-special-contract.json')
assert(hatchSpecialContract.contractId === 'rotom-pokemon-egg-hatch-special-v1', 'hatch-special contract identity drifted')
assert(hatchSpecialContract.definition?.roll?.countPerEgg === 1 && hatchSpecialContract.definition?.roll?.purpose === 'hatch-special-d100', 'hatch-special single-roll policy drifted')
assert(JSON.stringify(hatchSpecialContract.definition?.reducer?.specialTotals) === JSON.stringify([1, 100]), 'hatch-special trigger totals drifted')
assert(hatchSpecialContract.definition?.reducer?.automaticShiny === false && hatchSpecialContract.definition?.boundedAdjudication?.shinyOption === 'absent', 'hatch-special workflow began implying Shiny')
assert(hatchSpecialContract.definition?.boundedAdjudication?.outcomeIds?.length === 3 && hatchSpecialContract.definition.boundedAdjudication.outcomeMechanics === 'no-automatic-mechanical-change', 'hatch-special bounded outcome inventory drifted')
assert(hatchSpecialContract.definition?.transactions?.exactRetry === 'no-Egg-revision-ledger-revision-roll-event-or-publication-duplication', 'hatch-special retry policy drifted')
assert(hatchSpecialContract.definition?.tests?.focusedCount === 7, 'hatch-special focused test count drifted')
const modifierProviderContract = json<Record<string, any>>('data/breeding-automation/modifier-provider-handoff-contract.json')
assert(modifierProviderContract.contractId === 'rotom-breeding-modifier-provider-handoff-v1', 'modifier-provider handoff contract identity drifted')
assert(modifierProviderContract.definition?.closedPolicies?.length === 9, 'modifier-provider policy inventory drifted')
assert(modifierProviderContract.definition?.authority?.clientAuthority === 'none', 'modifier-provider contract granted client authority')
assert(modifierProviderContract.definition?.activeIntegrations?.eggWarmerItem?.includes('continuous-2-to-1'), 'Egg Warmer item rate policy drifted')
assert(modifierProviderContract.definition?.activeIntegrations?.eggWarmerCapability?.includes('once-per-1440-campaign-minutes'), 'Egg Warmer Capability cooldown drifted')
assert(modifierProviderContract.definition?.activeIntegrations?.reanimationMachine?.includes('exact-current-distinct-Trainer-inventory-row')
  && modifierProviderContract.definition?.activeIntegrations?.playingGod?.includes('Chemistry-Set')
  && modifierProviderContract.definition?.activeIntegrations?.babyTemplate?.includes('Marsupial')
  && modifierProviderContract.definition?.reserved?.['BR-068']?.includes('post-hatch-learning'), 'downstream modifier ownership drifted')
const storageSchemaV25 = json<Record<string, any>>('data/breeding-automation/storage-schema-v25.json')
assert(storageSchemaV25.schemaId === 'rotom-breeding-storage-v25' && storageSchemaV25.definition?.fromVersion === 24 && storageSchemaV25.definition?.toVersion === 25, 'storage schema v25 identity drifted')
assert(storageSchemaV25.definition?.newCommandKind === 'apply-egg-warmer-capability' && storageSchemaV25.definition?.invariants?.operationRowsPreserved === true, 'storage schema v25 Egg Warmer preservation policy drifted')
const parentSourceChangeContract = json<Record<string, any>>('data/breeding-automation/parent-source-change-contract.json')
assert(parentSourceChangeContract.contractId === 'rotom-breeding-parent-source-change-v1', 'parent source-change contract identity drifted')
assert(parentSourceChangeContract.definition?.changeKinds?.length === 7
  && parentSourceChangeContract.definition?.authority?.clientAuthority === 'none', 'parent source-change inventory or authority drifted')
assert(parentSourceChangeContract.definition?.projectMatrix?.preCheckRevisionRefreshable?.disposition === 'explicit-interruption-refresh-and-full-revalidation'
  && parentSourceChangeContract.definition?.projectMatrix?.postCheck?.allChanges === 'block-until-cancel-or-reviewed-migration', 'parent Project checkpoint policy drifted')
assert(parentSourceChangeContract.definition?.acceptedEggMatrix?.allChanges === 'preserve-immutable-Egg'
  && parentSourceChangeContract.definition?.acceptedEggMatrix?.hatchEligibility === 'preserve-status-derived-eligibility', 'accepted Egg source-change policy drifted')
assert(parentSourceChangeContract.definition?.ownershipBoundaries?.['BR-064']?.includes('Egg-transfer-consent-and-custody-mutation'), 'parent source-change contract crossed BR-064 ownership')
const storageSchemaV26 = json<Record<string, any>>('data/breeding-automation/storage-schema-v26.json')
assert(storageSchemaV26.schemaId === 'rotom-breeding-storage-v26'
  && storageSchemaV26.definition?.fromVersion === 25
  && storageSchemaV26.definition?.toVersion === 26, 'storage schema v26 identity drifted')
assert(storageSchemaV26.definition?.newScopeKind === 'egg-transfer-consent'
  && storageSchemaV26.definition?.invariants?.offlineParity === true
  && storageSchemaV26.definition?.invariants?.noMapEncounterColumns === true, 'storage schema v26 transfer-consent policy drifted')
const storageSchemaV27 = json<Record<string, any>>('data/breeding-automation/storage-schema-v27.json')
assert(storageSchemaV27.schemaId === 'rotom-breeding-storage-v27'
  && storageSchemaV27.definition?.fromVersion === 26
  && storageSchemaV27.definition?.toVersion === 27, 'storage schema v27 identity drifted')
assert(storageSchemaV27.definition?.newTable === 'trainer_species_acquisition_source_operations'
  && storageSchemaV27.definition?.rebuiltTable === 'trainer_species_acquisitions'
  && storageSchemaV27.definition?.invariants?.existingHistoryRowsPreserved === true
  && storageSchemaV27.definition?.invariants?.externalSourcesDoNotForgeBreedingOperations === true
  && storageSchemaV27.definition?.invariants?.sourceSettlementRequiresHistory === true
  && storageSchemaV27.definition?.invariants?.offlineParity === true, 'storage schema v27 acquisition policy drifted')
const storageSchemaV28 = json<Record<string, any>>('data/breeding-automation/storage-schema-v28.json')
assert(storageSchemaV28.schemaId === 'rotom-breeding-storage-v28'
  && storageSchemaV28.definition?.fromVersion === 27
  && storageSchemaV28.definition?.toVersion === 28
  && storageSchemaV28.definition?.newCommandKind === 'settle-egg-transfer-consent'
  && storageSchemaV28.definition?.newOutcomeKind === 'egg-transfer-consent-settled', 'storage schema v28 identity drifted')
assert(storageSchemaV28.definition?.settlementPolicy?.gmConsentSubstitution === 'forbidden'
  && storageSchemaV28.definition?.settlementPolicy?.expiryEquality === 'expired'
  && storageSchemaV28.definition?.invariants?.existingOperationRowsPreserved === true
  && storageSchemaV28.definition?.invariants?.offlineParity === true
  && storageSchemaV28.definition?.invariants?.noEggOwnershipMutation === true, 'storage schema v28 transfer-consent policy drifted')
const acquisitionIntegrationContract = json<Record<string, any>>('data/breeding-automation/species-acquisition-integration-contract.json')
assert(acquisitionIntegrationContract.contractId === 'rotom-breeding-species-acquisition-integration-v1'
  && acquisitionIntegrationContract.definition?.ticket === 'BR-069'
  && acquisitionIntegrationContract.definition?.runtimePolicy?.clientAuthority === 'none', 'Species acquisition integration contract identity or authority drifted')
assert(acquisitionIntegrationContract.definition?.sourceMatrix?.release?.historyMutation === 'none'
  && acquisitionIntegrationContract.definition?.sourceMatrix?.migration?.legacyInference === 'forbidden'
  && acquisitionIntegrationContract.definition?.historyAndReward?.firstHistoricalAcquisitionDexExp === 1
  && acquisitionIntegrationContract.definition?.historyAndReward?.repeatAcquisitionDexExp === 0
  && acquisitionIntegrationContract.definition?.sourceSettlement?.storageSchemaDefinitionSha256 === storageSchemaV27.definitionSha256
  && acquisitionIntegrationContract.definition?.sourceSettlement?.externalBreedingOperationForgery === 'forbidden', 'Species acquisition integration history or settlement policy drifted')
const workshopPresentationContract = json<Record<string, any>>('data/breeding-automation/workshop-presentation-contract.json')
assert(workshopPresentationContract.contractId === 'rotom-breeding-workshop-presentation-v1'
  && workshopPresentationContract.definition?.ticket === 'BR-070', 'Workshop presentation contract identity drifted')
assert(workshopPresentationContract.definition?.scope?.route === '/breeding'
  && workshopPresentationContract.definition?.scope?.apiRoute === '/api/breeding/workshop'
  && workshopPresentationContract.definition?.scope?.mapDependency === 'none'
  && workshopPresentationContract.definition?.scope?.encounterDependency === 'none'
  && workshopPresentationContract.definition?.scope?.clientMechanicsAuthority === 'none', 'Workshop campaign boundary drifted')
assert(workshopPresentationContract.definition?.authorization?.playerContexts === 'only-selected-Profile-linked-Trainer-sheets'
  && workshopPresentationContract.definition?.authorization?.missingPlayerProfile === 'profile-required-state-with-zero-ownership-facts'
  && workshopPresentationContract.definition?.authorization?.foreignPlayerSelection === 'reject-403'
  && workshopPresentationContract.definition?.authorization?.cursorAuthority === 'none', 'Workshop ownership authority drifted')
assert(workshopPresentationContract.definition?.projection?.maximumOwnershipContextsPerPage === 100
  && workshopPresentationContract.definition?.projection?.activity === 'booleans-only-hasProjects-and-hasEggs'
  && workshopPresentationContract.definition?.projection?.unknownFields === 'reject'
  && workshopPresentationContract.definition?.projection?.accessorsSymbolsSparseOrEnrichedValues === 'reject', 'Workshop projection bounds drifted')
assert(workshopPresentationContract.definition?.privacy?.serverProjection === 'mandatory'
  && workshopPresentationContract.definition?.privacy?.localPersistence === 'none'
  && workshopPresentationContract.definition?.privacy?.forbiddenProjectionFacts?.includes('Egg-ids')
  && workshopPresentationContract.definition?.privacy?.forbiddenProjectionFacts?.includes('private-mechanics'), 'Workshop privacy boundary drifted')
assert(workshopPresentationContract.definition?.presentation?.keyboardOperable === true
  && workshopPresentationContract.definition?.presentation?.minimumControlHeightPx === 44
  && workshopPresentationContract.definition?.presentation?.statusAndErrorAnnouncements === true
  && workshopPresentationContract.definition?.presentation?.reducedMotion === 'honored', 'Workshop accessibility contract drifted')
const projectWizardContract = json<Record<string, any>>('data/breeding-automation/project-wizard-presentation-contract.json')
assert(projectWizardContract.contractId === 'rotom-breeding-project-wizard-presentation-v1'
  && projectWizardContract.definition?.ticket === 'BR-071', 'Project wizard presentation contract identity drifted')
assert(projectWizardContract.definition?.scope?.route === '/breeding'
  && projectWizardContract.definition?.scope?.apiRoute === '/api/breeding/projects/wizard'
  && projectWizardContract.definition?.scope?.apiMethod === 'POST'
  && projectWizardContract.definition?.scope?.projectMutation === 'none-preview-only'
  && projectWizardContract.definition?.scope?.clientMechanicsAuthority === 'none', 'Project wizard preview boundary drifted')
assert(projectWizardContract.definition?.request?.mechanicsClaims === 'forbidden'
  && projectWizardContract.definition?.request?.consentClaims === 'forbidden'
  && projectWizardContract.definition?.request?.campaignTimeClaims === 'forbidden'
  && projectWizardContract.definition?.request?.accessorsSymbolsSparseOrEnrichedValues === 'reject', 'Project wizard request closure drifted')
assert(projectWizardContract.definition?.authorization?.playerParentDirectory === 'destination-Trainer-only'
  && projectWizardContract.definition?.authorization?.foreignOrStaleSelection === 'reject-without-enumeration'
  && projectWizardContract.definition?.authorization?.requestedSlugsAuthority === 'none'
  && projectWizardContract.definition?.authorization?.actorAuthority === 'server-rebuilt-at-current-campaign-minute', 'Project wizard authorization drifted')
assert(projectWizardContract.definition?.projection?.parentDirectory === 'reuse-authorized-BR-020-parent-discovery-projection'
  && projectWizardContract.definition?.projection?.parentMaximum === 2
  && projectWizardContract.definition?.projection?.securityPolicyBinding === 'mandatory'
  && projectWizardContract.definition?.projection?.unknownFields === 'reject', 'Project wizard projection boundary drifted')
assert(projectWizardContract.definition?.consent?.sameOwner === 'not-required'
  && projectWizardContract.definition?.consent?.crossOwner === 'review-required'
  && projectWizardContract.definition?.consent?.projectedConsentEvidence === 'none'
  && projectWizardContract.definition?.consent?.browserConsentAuthority === 'none', 'Project wizard consent boundary drifted')
assert(projectWizardContract.definition?.timeline?.authority === 'campaign-clock-only'
  && projectWizardContract.definition?.timeline?.initialCampaignMinutes === 240
  && projectWizardContract.definition?.timeline?.breederCheckDifficultyClass === 12
  && projectWizardContract.definition?.timeline?.additionalCampaignMinutesAfterSuccess === 240
  && projectWizardContract.definition?.timeline?.minimumCampaignMinutesBeforeEgg === 480, 'Project wizard timeline drifted')
assert(projectWizardContract.definition?.privacy?.serverProjection === 'mandatory'
  && projectWizardContract.definition?.privacy?.localPersistence === 'none'
  && projectWizardContract.definition?.privacy?.forbiddenProjectionFacts?.includes('project-ids')
  && projectWizardContract.definition?.privacy?.forbiddenProjectionFacts?.includes('consent-evidence'), 'Project wizard privacy boundary drifted')
assert(projectWizardContract.definition?.presentation?.minimumControlHeightPx === 44
  && projectWizardContract.definition?.presentation?.keyboardOperable === true
  && projectWizardContract.definition?.presentation?.statusAndErrorAnnouncements === true
  && projectWizardContract.definition?.presentation?.reducedMotion === 'honored', 'Project wizard accessibility contract drifted')
const projectGuidanceContract = json<Record<string, any>>('data/breeding-automation/project-guidance-presentation-contract.json')
assert(projectGuidanceContract.contractId === 'rotom-breeding-project-guidance-presentation-v1'
  && projectGuidanceContract.definition?.ticket === 'BR-072', 'Project guidance presentation contract identity drifted')
assert(projectGuidanceContract.definition?.scope?.apiRoute === '/api/breeding/projects/wizard/guidance'
  && projectGuidanceContract.definition?.scope?.extends === 'BR-071-non-mutating-wizard'
  && projectGuidanceContract.definition?.scope?.projectMutation === 'none-preview-only'
  && projectGuidanceContract.definition?.scope?.clientMechanicsAuthority === 'none', 'Project guidance authority boundary drifted')
assert(projectGuidanceContract.definition?.reasonCatalog?.authority === 'closed-app-owned-presentation-catalog'
  && projectGuidanceContract.definition?.reasonCatalog?.runtimeProseInterpretation === 'forbidden'
  && projectGuidanceContract.definition?.reasonCatalog?.unknownReason === 'reject', 'Project guidance reason closure drifted')
assert(JSON.stringify(projectGuidanceContract.definition?.sourceContributions?.sources) === JSON.stringify(['Breeder-Trainer-Edge', 'Dilettante-Trainer-Feature'])
  && projectGuidanceContract.definition?.sourceContributions?.providerEvidence === 'never-projected'
  && projectGuidanceContract.definition?.sourceContributions?.facilityAuthority === 'empty-no-authority', 'Project guidance source boundary drifted')
assert(projectGuidanceContract.definition?.compatibility?.mechanicsAuthority === 'reuse-BR-020-discovery-and-compatibility-preview'
  && projectGuidanceContract.definition?.compatibility?.browserRecalculation === 'forbidden'
  && projectGuidanceContract.definition?.compatibility?.crossOwnerPrivateMechanicsBeforeConsent === 'not-evaluated-or-projected', 'Project guidance compatibility or consent privacy drifted')
assert(projectGuidanceContract.definition?.gmDiagnostics?.audience === 'gm-only'
  && projectGuidanceContract.definition?.gmDiagnostics?.identifiers === 'forbidden'
  && projectGuidanceContract.definition?.gmDiagnostics?.hashes === 'forbidden'
  && projectGuidanceContract.definition?.gmDiagnostics?.ownerProjection === 'null', 'Project guidance GM diagnostic privacy drifted')
assert(projectGuidanceContract.definition?.projection?.sourceMaximum === 2
  && projectGuidanceContract.definition?.projection?.securityPolicyBinding === 'mandatory'
  && projectGuidanceContract.definition?.projection?.unknownFields === 'reject'
  && projectGuidanceContract.definition?.projection?.accessorsSymbolsSparseOrEnrichedValues === 'reject', 'Project guidance projection closure drifted')
assert(projectGuidanceContract.definition?.presentation?.candidateDisclosure === 'native-details-with-title-summary-and-recovery'
  && projectGuidanceContract.definition?.presentation?.minimumControlHeightPx === 44
  && projectGuidanceContract.definition?.presentation?.keyboardOperable === true
  && projectGuidanceContract.definition?.presentation?.reducedMotion === 'honored', 'Project guidance accessibility contract drifted')
const projectChoicesContract = json<Record<string, any>>('data/breeding-automation/project-choices-presentation-contract.json')
assert(projectChoicesContract.contractId === 'rotom-breeding-project-choices-presentation-v1'
  && projectChoicesContract.definition?.ticket === 'BR-073'
  && projectChoicesContract.definition?.scope?.clientMechanicsAuthority === 'none', 'Project choices presentation identity or authority drifted')
assert(projectChoicesContract.definition?.creation?.explicitConfirmation === 'mandatory'
  && projectChoicesContract.definition?.creation?.minimumCampaignMinutesBeforeEgg === 480
  && projectChoicesContract.definition?.privacy?.crossOwnerBeforeConsent?.startsWith('blocked'), 'Project choices confirmation, timeline, or cross-owner boundary drifted')
const workshopActivityContract = json<Record<string, any>>('data/breeding-automation/workshop-activity-presentation-contract.json')
assert(workshopActivityContract.contractId === 'rotom-breeding-workshop-activity-presentation-v1'
  && workshopActivityContract.definition?.ticket === 'BR-074'
  && workshopActivityContract.definition?.scope?.apiRoute === '/api/breeding/workshop/activity'
  && workshopActivityContract.definition?.scope?.clientMechanicsAuthority === 'none', 'Workshop activity presentation identity or authority drifted')
assert(workshopActivityContract.definition?.authority?.projectsAndEggs === 'selected-owner-only-latest-50-each'
  && workshopActivityContract.definition?.authority?.progress === 'aggregate-campaign-minute-facts-only'
  && workshopActivityContract.definition?.authority?.recovery === 'current-pending-operation-scopes'
  && workshopActivityContract.definition?.authority?.transfer === 'current-Egg-status-revision-and-durable-consent-state', 'Workshop activity authority sources drifted')
assert(workshopActivityContract.definition?.cards?.historyMaximum === 12
  && workshopActivityContract.definition?.cards?.projectMaximum === 50
  && workshopActivityContract.definition?.cards?.EggMaximum === 50
  && workshopActivityContract.definition?.cards?.truncationVisible === true, 'Workshop activity card bounds drifted')
assert(workshopActivityContract.definition?.privacy?.ownerForeignParentIdentity === 'null'
  && workshopActivityContract.definition?.privacy?.ProfileIds === 'forbidden'
  && workshopActivityContract.definition?.privacy?.operationIdsAndHashes === 'forbidden'
  && workshopActivityContract.definition?.transferAndRecoveryPresentation?.optimisticOwnershipChange === 'forbidden', 'Workshop activity privacy or durable transfer boundary drifted')
assert(workshopActivityContract.definition?.presentation?.nativeProgress === true
  && workshopActivityContract.definition?.presentation?.minimumControlHeightPx === 44
  && workshopActivityContract.definition?.presentation?.keyboardOperable === true
  && workshopActivityContract.definition?.presentation?.reducedMotion === 'honored', 'Workshop activity accessibility contract drifted')
const hatchWorkflowContract = json<Record<string, any>>('data/breeding-automation/hatch-workflow-presentation-contract.json')
assert(hatchWorkflowContract.contractId === 'rotom-breeding-hatch-workflow-presentation-v1'
  && hatchWorkflowContract.definition?.ticket === 'BR-075'
  && hatchWorkflowContract.definition?.scope?.apiRoute === '/api/breeding/hatch'
  && hatchWorkflowContract.definition?.scope?.clientMechanicsAuthority === 'none', 'Hatch workflow presentation identity or authority drifted')
assert(hatchWorkflowContract.definition?.requestAuthority?.browserSuppliedMechanics === 'forbidden'
  && hatchWorkflowContract.definition?.requestAuthority?.mutationConfirmation === 'explicit-true'
  && hatchWorkflowContract.definition?.mechanicsReuse?.parallelMutationPath === 'forbidden'
  && hatchWorkflowContract.definition?.mechanicsReuse?.randomRetry === 'reuse-one-persisted-roll-never-redraw', 'Hatch workflow request or mechanics reuse boundary drifted')
assert(hatchWorkflowContract.definition?.specialPrivacy?.ownerPending === 'state-and-waiting-message-only'
  && hatchWorkflowContract.definition?.specialPrivacy?.automaticShiny === false
  && hatchWorkflowContract.definition?.specialPrivacy?.automaticNatureChange === false
  && hatchWorkflowContract.definition?.childReveal?.operationAndEvidenceIdentity === 'forbidden', 'Hatch workflow role privacy or reveal boundary drifted')
assert(hatchWorkflowContract.definition?.presentation?.modalSemantics === 'labelled-aria-modal-dialog'
  && hatchWorkflowContract.definition?.presentation?.minimumControlHeightPx === 44
  && hatchWorkflowContract.definition?.presentation?.nativeGmRadioGroup === true
  && hatchWorkflowContract.definition?.presentation?.separateConfirmation === true
  && hatchWorkflowContract.definition?.presentation?.reducedMotion === 'reveal-animation-disabled', 'Hatch workflow accessibility contract drifted')
const hatchDestinationContract = json<Record<string, any>>('data/breeding-automation/hatch-destination-presentation-contract.json')
assert(hatchDestinationContract.contractId === 'rotom-breeding-hatch-destination-presentation-v1'
  && hatchDestinationContract.definition?.ticket === 'BR-076'
  && hatchDestinationContract.definition?.scope?.apiRoute === '/api/breeding/hatch'
  && hatchDestinationContract.definition?.scope?.browserMechanicsAuthority === 'none', 'Hatch destination presentation identity or authority drifted')
assert(hatchDestinationContract.definition?.requestAuthority?.beginSelection === 'one-opaque-current-server-destination-option-ID'
  && hatchDestinationContract.definition?.requestAuthority?.browserDestinationKindOrCapacity === 'forbidden'
  && hatchDestinationContract.definition?.destinationProjection?.teamCapacity === 6
  && hatchDestinationContract.definition?.destinationProjection?.teamFullReasonId === 'breeding.hatch-offer.team-full'
  && hatchDestinationContract.definition?.destinationProjection?.rosterIdentities === 'forbidden', 'Hatch destination selection or privacy boundary drifted')
assert(hatchDestinationContract.definition?.linkage?.writer === 'existing-BR-057-atomic-hatch-completion-transaction'
  && hatchDestinationContract.definition?.linkage?.optimisticMutation === 'forbidden'
  && hatchDestinationContract.definition?.navigation?.preAcceptanceChildLink === 'forbidden'
  && hatchDestinationContract.definition?.presentation?.nativeDestinationRadioGroup === true
  && hatchDestinationContract.definition?.presentation?.minimumControlHeightPx === 44, 'Hatch destination linkage, navigation, or accessibility contract drifted')
const consentWorkflowContract = json<Record<string, any>>('data/breeding-automation/consent-workflow-presentation-contract.json')
assert(consentWorkflowContract.contractId === 'rotom-breeding-consent-workflow-presentation-v1'
  && consentWorkflowContract.definition?.ticket === 'BR-077'
  && consentWorkflowContract.definition?.scope?.apiRoute === '/api/breeding/consent'
  && consentWorkflowContract.definition?.scope?.clientMechanicsAuthority === 'none', 'Consent workflow presentation identity or authority drifted')
assert(consentWorkflowContract.definition?.projectConsent?.privateMechanicsBeforeConsent === 'not-parsed-resolved-or-projected'
  && consentWorkflowContract.definition?.eggTransferConsent?.requiredPositiveConsentCount === 2
  && consentWorkflowContract.definition?.eggTransferConsent?.gmPositiveConsentSubstitution === 'forbidden'
  && consentWorkflowContract.definition?.gmPolicy?.setupOverrideCreatesConsent === false, 'Consent workflow separation or GM policy drifted')
assert(consentWorkflowContract.definition?.privacy?.playerTransferCounterpartIdentity === 'structurally-absent'
  && consentWorkflowContract.definition?.privacy?.notifications === 'counts-only-no-counterpart-choice-or-private-mechanics'
  && consentWorkflowContract.definition?.recovery?.ordinaryActionsWhilePending === 'all-disabled'
  && consentWorkflowContract.definition?.recovery?.commandPayloadProjection === 'forbidden', 'Consent workflow privacy or recovery drifted')
assert(consentWorkflowContract.definition?.presentation?.transferSetupModal === 'labelled-aria-modal-dialog'
  && consentWorkflowContract.definition?.presentation?.minimumControlHeightPx === 44
  && consentWorkflowContract.definition?.presentation?.keyboardAndTouchOperable === true
  && consentWorkflowContract.definition?.presentation?.reducedMotion === 'honored', 'Consent workflow accessibility drifted')
const workshopInteractionAcceptance = json<Record<string, any>>('data/breeding-automation/workshop-interaction-acceptance.json')
assert(workshopInteractionAcceptance.acceptanceId === 'rotom-breeding-workshop-interaction-acceptance-v1'
  && workshopInteractionAcceptance.definition?.ticket === 'BR-078'
  && workshopInteractionAcceptance.definition?.context === 'Workshop'
  && workshopInteractionAcceptance.definition?.status === 'component-accepted'
  && workshopInteractionAcceptance.definition?.authority?.browserAcceptanceOwner === 'BR-079', 'Workshop interaction acceptance identity or ownership drifted')
assert(workshopInteractionAcceptance.definition?.viewports?.map((entry: any) => entry.cssWidth).join(',') === '320,390,768,1440'
  && workshopInteractionAcceptance.definition?.touch?.minimumEssentialTargetCssPx === 44
  && workshopInteractionAcceptance.definition?.zoomAndReflow?.requiredZoomPercent?.join(',') === '200,400'
  && workshopInteractionAcceptance.definition?.tableDistance?.primaryPageTitleMinimumCssPx === 32, 'Workshop viewport, touch, zoom, or table-distance acceptance drifted')
assert(workshopInteractionAcceptance.definition?.keyboard?.transferDialog?.includes('Tab-and-Shift-Tab-contained')
  && workshopInteractionAcceptance.definition?.keyboard?.hatchDialog?.includes('origin-restore')
  && workshopInteractionAcceptance.definition?.screenReader?.rawIdsAsNames === false
  && workshopInteractionAcceptance.definition?.reducedMotion?.continuousDecorativeAnimation === 'none', 'Workshop keyboard, screen-reader, or reduced-motion acceptance drifted')
assert(Array.isArray(workshopInteractionAcceptance.definition?.componentMatrix)
  && workshopInteractionAcceptance.definition.componentMatrix.length === 5
  && workshopInteractionAcceptance.definition.componentMatrix.every((row: any) => row.responsive === true && row.keyboard === true
    && row.screenReader === true && row.touch === true && row.zoom === true && row.reducedMotion === true && row.tableDistance === true), 'Workshop component acceptance matrix drifted')
const workshopBrowserAcceptance = json<Record<string, any>>('data/breeding-automation/workshop-browser-acceptance.json')
assert(workshopBrowserAcceptance.acceptanceId === 'rotom-breeding-workshop-browser-acceptance-v1'
  && workshopBrowserAcceptance.definition?.ticket === 'BR-079'
  && workshopBrowserAcceptance.definition?.context === 'Workshop'
  && workshopBrowserAcceptance.definition?.status === 'browser-accepted', 'Workshop browser acceptance identity drifted')
assert(workshopBrowserAcceptance.definition?.authority?.consumedInteractionAcceptanceDefinitionSha256 === workshopInteractionAcceptance.definitionSha256
  && workshopBrowserAcceptance.definition?.authority?.matrixRedefinedByBrowserSuite === false
  && workshopBrowserAcceptance.definition?.authority?.browserSelectorsConferAuthority === false
  && workshopBrowserAcceptance.definition?.runtime?.framework === 'Nuxt-4-production-Nitro', 'Workshop browser suite authority or runtime boundary drifted')
assert(workshopBrowserAcceptance.definition?.accessibility?.runner === '@axe-core/playwright'
  && workshopBrowserAcceptance.definition?.accessibility?.maximumSeriousOrCriticalViolations === 0
  && workshopBrowserAcceptance.definition?.accessibility?.minimumEssentialTargetCssPx === 44
  && workshopBrowserAcceptance.definition?.responsive?.cssWidths?.join(',') === '320,390,768,1440'
  && workshopBrowserAcceptance.definition?.responsive?.horizontalEssentialContentOverflow === 'none', 'Workshop browser accessibility or responsive acceptance drifted')
assert(workshopBrowserAcceptance.definition?.privacy?.simultaneousBrowserContexts === true
  && workshopBrowserAcceptance.definition?.privacy?.playerStructurallyOmits?.includes('counterpart-parent-identity')
  && workshopBrowserAcceptance.definition?.privacy?.playerStructurallyOmits?.includes('raw-egg-id')
  && workshopBrowserAcceptance.definition?.privacy?.gmCannotSubstituteConsent === true
  && workshopBrowserAcceptance.definition?.reconnect?.required?.includes('one-card-per-aggregate'), 'Workshop browser privacy or reconnect acceptance drifted')
const browserFixture = workshopBrowserAcceptance.definition?.playwright?.fixture
assert(typeof browserFixture?.path === 'string' && existsSync(resolve(ROOT, browserFixture.path))
  && sha256(readFileSync(resolve(ROOT, browserFixture.path))) === browserFixture.contentSha256
  && browserFixture.synthetic === true && browserFixture.containsCampaignData === false, 'Workshop browser fixture content drifted')
assert(workshopBrowserAcceptance.definition?.playwright?.requestPolicy?.explicitSelectedProfileSnapshot === true
  && ['command', 'readSet', 'receipt', 'roll', 'mechanics'].every(value => workshopBrowserAcceptance.definition.playwright.requestPolicy.forbidden.includes(value))
  && existsSync(resolve(ROOT, workshopBrowserAcceptance.definition?.nuxt?.suite ?? ''))
  && existsSync(resolve(ROOT, workshopBrowserAcceptance.definition?.playwright?.suite ?? '')), 'Workshop browser suites or selector-only request policy drifted')
const browserBaselines = workshopBrowserAcceptance.definition?.visualRegression?.baselines
assert(Array.isArray(browserBaselines) && browserBaselines.length === 4
  && browserBaselines.every((baseline: any) => typeof baseline.path === 'string'
    && existsSync(resolve(ROOT, baseline.path))
    && sha256(readFileSync(resolve(ROOT, baseline.path))) === baseline.contentSha256), 'Workshop browser visual baselines drifted')
assert(Object.values(workshopBrowserAcceptance.definition?.acceptance ?? {}).every(result => result === 'pass'), 'Workshop browser acceptance result drifted')
const eggTransferContract = json<Record<string, any>>('data/breeding-automation/egg-transfer-contract.json')
assert(eggTransferContract.contractId === 'rotom-pokemon-egg-transfer-v1'
  && eggTransferContract.definition?.clientAuthority === 'none', 'Egg transfer contract identity or authority drifted')
assert(eggTransferContract.definition?.workflow?.requiredConsentCount === 2
  && eggTransferContract.definition?.workflow?.expiry?.includes('equality-is-invalid')
  && eggTransferContract.definition?.workflow?.gmOverride === 'cannot-create-or-replace-positive-consent', 'Egg transfer consent policy drifted')
assert(eggTransferContract.definition?.atomicSettlement?.transaction === 'one-BR-037-top-level-synchronous-transaction'
  && eggTransferContract.definition?.storage?.schemaVersion === 26
  && eggTransferContract.definition?.privacy?.realtime?.includes('no-consent-or-Egg-payload'), 'Egg transfer atomicity, storage, or privacy policy drifted')
const fossilEggContract = json<Record<string, any>>('data/breeding-automation/fossil-egg-contract.json')
assert(fossilEggContract.contractId === 'rotom-breeding-fossil-egg-v1'
  && fossilEggContract.definition?.ticket === 'BR-065', 'fossil Egg contract identity drifted')
assert(fossilEggContract.definition?.source?.kind === 'fossil'
  && fossilEggContract.definition?.source?.consumption?.includes('exactly-one')
  && fossilEggContract.definition?.reanimationAuthority?.edge?.includes('current-effective-unsuppressed'), 'fossil source or Paleontologist authority drifted')
assert(fossilEggContract.definition?.egg?.aggregate === 'PokemonEggDocumentV1'
  && fossilEggContract.definition?.egg?.defaultStartingLevel === 10
  && fossilEggContract.definition?.egg?.parallelFossilHatchPath === 'forbidden'
  && fossilEggContract.definition?.extendedByTicket === 'BR-067'
  && fossilEggContract.definition?.boundedOffers?.slots?.includes('baby-template')
  && fossilEggContract.definition?.egg?.babyTemplate?.includes('per-Egg-GM-choice')
  && fossilEggContract.definition?.egg?.babyTemplate?.includes('forced-Marsupial'), 'fossil Egg shared-pipeline or BR-067 extension policy drifted')
assert(fossilEggContract.definition?.fossilRestoration?.tutorPointDelta === -2
  && fossilEggContract.definition?.prehistoricBond?.tiedMaximum?.includes('GM-bounded-offer')
  && fossilEggContract.definition?.prehistoricBond?.restriction?.includes('revived-from-Fossils'), 'fossil provider reducer policy drifted')
assert(fossilEggContract.definition?.transaction?.phase2 === 'one-BR-037-top-level-synchronous-SQLite-transaction'
  && fossilEggContract.definition?.randomness?.exactRetryRedraw === 'forbidden'
  && fossilEggContract.definition?.privacy?.EggRealtime === 'payload-free-refresh-only', 'fossil atomicity, replay, or privacy policy drifted')
const gmEggContract = json<Record<string, any>>('data/breeding-automation/gm-egg-contract.json')
assert(gmEggContract.contractId === 'rotom-breeding-gm-egg-v1'
  && gmEggContract.definition?.ticket === 'BR-066'
  && JSON.stringify(gmEggContract.definition?.source?.provenanceKinds) === JSON.stringify(['gm-authored','mysterious','campaign-gift','imported']), 'GM Egg contract identity or provenance inventory drifted')
assert(gmEggContract.definition?.source?.legacyThreeFieldGmSource === 'read-only-never-valid-for-new-creation'
  && gmEggContract.definition?.variants?.imported?.includes('server-owned-reviewed-source-record')
  && gmEggContract.definition?.variants?.['campaign-gift']?.includes('BR-064'), 'GM Egg legacy, import, or gift authority drifted')
assert(gmEggContract.definition?.egg?.aggregate === 'PokemonEggDocumentV1'
  && gmEggContract.definition?.egg?.defaultStartingLevel === 1
  && gmEggContract.definition?.egg?.parallelSourceHatchPath === 'forbidden', 'GM Egg shared-pipeline policy drifted')
assert(gmEggContract.definition?.transaction?.phase2 === 'one-BR-037-top-level-synchronous-SQLite-transaction'
  && gmEggContract.definition?.randomness?.exactRetryRedraw === 'forbidden'
  && gmEggContract.definition?.privacy?.EggRealtime === 'payload-free-refresh-only'
  && gmEggContract.definition?.boundedOffers?.slots?.includes('baby-template')
  && gmEggContract.definition?.egg?.babyTemplate?.includes('forced-Marsupial'), 'GM Egg atomicity, replay, privacy, or Baby Template policy drifted')
const babyTemplateContract = json<Record<string, any>>('data/breeding-automation/baby-template-contract.json')
assert(babyTemplateContract.contractId === 'rotom-breeding-baby-template-and-artificial-egg-v1'
  && babyTemplateContract.definition?.ticket === 'BR-067', 'Baby Template contract identity drifted')
assert(JSON.stringify(babyTemplateContract.definition?.babyTemplate?.campaignBaseStatPenaltyEach) === JSON.stringify([2, 3, 4])
  && babyTemplateContract.definition?.babyTemplate?.recovery?.intervalLevels === 5
  && babyTemplateContract.definition?.babyTemplate?.speciesReferenceMutation === 'forbidden'
  && babyTemplateContract.definition?.babyTemplate?.editableBabyTemplate?.includes('never-authority')
  && babyTemplateContract.definition?.babyTemplate?.ordinaryProjectOfferIssuance?.includes('frozen-campaign-option-bound')
  && babyTemplateContract.definition?.babyTemplate?.optionalValueHashClosure?.includes('exact-frozen-campaign-option-snapshot')
  && JSON.stringify(babyTemplateContract.definition?.babyTemplate?.eligibleEggSources) === JSON.stringify(['ordinary-breeding-project','fossil','gm','feature-artificial']), 'Baby Template recovery, issuance, source, or authority policy drifted')
assert(babyTemplateContract.definition?.marsupial?.forcedBaseStatPenaltyEach === 5
  && babyTemplateContract.definition?.marsupial?.pouch?.includes('atomic-exact-reciprocal')
  && babyTemplateContract.definition?.marsupial?.exit?.includes('Level-25')
  && babyTemplateContract.definition?.marsupial?.actionRestriction?.includes('without-active-Parental-Bond')
  && babyTemplateContract.definition?.marsupial?.parentalBond?.includes('10-metre-tether'), 'Marsupial Baby Template or Parental Bond policy drifted')
assert(babyTemplateContract.definition?.playingGod?.cost === 3500
  && babyTemplateContract.definition?.playingGod?.startingLevel === 5
  && babyTemplateContract.definition?.playingGod?.maximumHatchCampaignMinutes === 1440
  && babyTemplateContract.definition?.playingGod?.hatch?.includes('ordinary'), 'Playing God artificial Egg policy drifted')
assert(babyTemplateContract.definition?.security?.privateRestoreBeforeCalculation === true
  && babyTemplateContract.definition?.security?.randomness?.includes('persisted-command-target')
  && babyTemplateContract.definition?.security?.replay?.includes('no-redraw'), 'BR-067 security or replay policy drifted')
const childSheetContract = json<Record<string, any>>('data/breeding-automation/child-sheet-construction-contract.json')
assert(childSheetContract.contractId === 'rotom-breeding-child-sheet-construction-v1', 'child-sheet construction contract identity drifted')
assert(childSheetContract.definition?.construction?.shiny === false, 'child-sheet construction began deriving Shiny from special state')
assert(childSheetContract.definition?.construction?.appliedMoves?.length === 0 && childSheetContract.definition?.construction?.pokeEdges?.length === 0, 'newborn child construction may not grant applied Moves or Poké Edges')
assert(childSheetContract.definition?.storage?.insertRevision === 0
  && childSheetContract.definition?.storage?.placeholderOrFollowupSave?.includes('Marsupial-pouch-link'), 'child-sheet initialized storage policy drifted')
assert(childSheetContract.definition?.construction?.babyTemplate?.includes('server-private-authority')
  && childSheetContract.definition?.construction?.playingGod?.includes('BR-068')
  && childSheetContract.definition?.construction?.inheritanceCheckpoints?.includes('Levels-20-through-100')
  && childSheetContract.definition?.construction?.permanentMoveProvenance?.includes('typed breeding-inheritance')
  && childSheetContract.definition?.unsupported?.babyTemplateApplied === undefined
  && childSheetContract.definition?.unsupported?.startingLevelAtLeast20 === undefined, 'child-sheet BR-067/BR-068 ownership policy drifted')
const inheritanceLearningContract = json<Record<string, any>>('data/breeding-automation/inheritance-learning-contract.json')
assert(inheritanceLearningContract.contractId === 'rotom-breeding-inheritance-learning-v1', 'inheritance-learning contract identity drifted')
assert(JSON.stringify(inheritanceLearningContract.definition?.checkpoints?.levels) === JSON.stringify([20, 30, 40, 50, 60, 70, 80, 90, 100])
  && inheritanceLearningContract.definition?.checkpoints?.illegal?.includes('remains-unlearned'), 'inheritance-learning checkpoint policy drifted')
assert(inheritanceLearningContract.definition?.moveClassification?.naturalMoveSlots === 6
  && inheritanceLearningContract.definition?.moveClassification?.separateAppliedTmTutorLimit === 3
  && inheritanceLearningContract.definition?.input?.clientAuthority?.includes('no canonical Move'), 'inheritance-learning Move authority drifted')
assert(inheritanceLearningContract.definition?.transaction?.boundary?.includes('caller-owned')
  && inheritanceLearningContract.definition?.transaction?.retry?.includes('survives-later-child-revisions'), 'inheritance-learning transaction/retry policy drifted')
const hatchCompletionContract = json<Record<string, any>>('data/breeding-automation/hatch-completion-contract.json')
assert(hatchCompletionContract.contractId === 'rotom-breeding-hatch-completion-v1', 'hatch-completion contract identity drifted')
assert(hatchCompletionContract.definition?.transaction?.phase2 === 'one-BR-037-top-level-synchronous-SQLite-transaction', 'hatch-completion transaction boundary drifted')
assert(JSON.stringify(hatchCompletionContract.definition?.transaction?.orderedWrites) === JSON.stringify(['initialized-child-sheet', 'optional-mirrored-Marsupial-mother-and-baby-pouch-state', 'first-Species-history-and-conditional-reward', 'Trainer-roster-link', 'settled-Egg-revision', 'immutable-lineage-origin', 'restricted-realtime-rows', 'terminal-operation-result']), 'hatch-completion atomic participant order drifted')
assert(hatchCompletionContract.definition?.settlement?.teamCapacity === 6 && JSON.stringify(hatchCompletionContract.definition?.settlement?.destinationKinds) === JSON.stringify(['box', 'team']), 'hatch-completion destination policy drifted')
assert(hatchCompletionContract.definition?.replay?.publication === 'silent'
  && hatchCompletionContract.definition?.realtime?.rowsPerFreshSettlement === '6-or-8-with-Marsupial-mother-sheet-refresh', 'hatch-completion replay/realtime policy drifted')
assert(hatchCompletionContract.definition?.privacy?.forbidden?.includes('lineage') && hatchCompletionContract.definition?.privacy?.forbidden?.includes('reward-details'), 'hatch-completion privacy exclusions drifted')
const hatchAcquisitionContract = json<Record<string, any>>('data/breeding-automation/hatch-species-acquisition-contract.json')
assert(hatchAcquisitionContract.contractId === 'rotom-breeding-hatch-species-acquisition-v1', 'hatch Species-acquisition contract identity drifted')
assert(JSON.stringify(hatchAcquisitionContract.definition?.history?.identity) === JSON.stringify(['trainerSheetSlug', 'speciesId']), 'hatch Species-history identity drifted')
assert(hatchAcquisitionContract.definition?.freshHatchOutcomes?.missingHistory?.reward?.amount === 1 && hatchAcquisitionContract.definition?.freshHatchOutcomes?.existingHistory?.rewardAmount === 0, 'hatch first-Species reward policy drifted')
assert(hatchAcquisitionContract.definition?.replay?.terminalRetry === 'stored-result-no-service-execution', 'hatch Species reward retry policy drifted')
assert(hatchAcquisitionContract.definition?.privacy?.completionProjectionRewardDetails === 'forbidden', 'hatch Species reward leaked into completion projection')
const hatchResilienceContract = json<Record<string, any>>('data/breeding-automation/hatch-resilience-contract.json')
assert(hatchResilienceContract.contractId === 'rotom-breeding-hatch-resilience-v1', 'hatch resilience contract identity drifted')
assert(hatchResilienceContract.definition?.invariants?.maximumSuccessfulChildrenPerEgg === 1 && hatchResilienceContract.definition?.invariants?.freshRealtimeRows === 6 && hatchResilienceContract.definition?.invariants?.terminalRetryRealtimeRows === 0, 'hatch resilience cardinality drifted')
assert(hatchResilienceContract.definition?.hazards?.concurrent?.connections === 'two-independent-SQLite-connections', 'hatch concurrent-connection evidence drifted')
assert(hatchResilienceContract.definition?.hazards?.pendingLoser?.recovery === 'current-authorized-resume-settles-original-pending-operation-stale', 'hatch pending-loser recovery drifted')
assert(hatchResilienceContract.definition?.hazards?.replayGap?.mechanicsReplay === 'forbidden', 'hatch replay-gap mechanics policy drifted')
const breederEdgeHandoffContract = json<Record<string, any>>('data/breeding-automation/breeder-edge-handoff-contract.json')
assert(breederEdgeHandoffContract.contractId === 'rotom-breeding-breeder-edge-handoff-v1', 'Breeder Edge handoff contract identity drifted')
assert(breederEdgeHandoffContract.definition?.identity?.capabilityId === 'breeding.v1'
  && breederEdgeHandoffContract.definition?.identity?.requestContractId === 'edge.breeder.request.v1', 'Breeder Edge delegation identity drifted')
assert(JSON.stringify(breederEdgeHandoffContract.definition?.authorityBoundary?.sourceContributionIds) === JSON.stringify(['breeding-project-request', 'breeder-dc12-timeline']), 'Breeder Edge contribution inventory drifted')
assert(breederEdgeHandoffContract.definition?.canonicalAuthority?.recordSha256 === 'd303cbe8c377ec9bb2a305ee5626e3c80f9c1ebd77975623c985bce741a321f4'
  && breederEdgeHandoffContract.definition?.canonicalAuthority?.minimumPokemonEducationRank === 'Novice', 'Breeder canonical authority drifted')
assert(breederEdgeHandoffContract.definition?.handoff?.campaignSharedService === 'unavailable-until-BR-061'
  && breederEdgeHandoffContract.definition?.handoff?.featureGrantedBreeder === 'unavailable-until-BR-061', 'Breeder handoff crossed the BR-061 provider boundary')
assert(breederEdgeHandoffContract.definition?.delegation?.resourceMutation === 'none'
  && breederEdgeHandoffContract.definition?.privacy?.projection === 'none-server-private-authority-only', 'Breeder handoff acquired mutation or projection authority')
assert(breederEdgeHandoffContract.definition?.tests?.focusedCount === 10, 'Breeder Edge handoff focused test count drifted')
const featureProviderHandoffContract = json<Record<string, any>>('data/breeding-automation/feature-provider-handoff-contract.json')
const modifierInventoryContract = json<Record<string, any>>('data/breeding-automation/modifier-inventory.json')
assert(featureProviderHandoffContract.contractId === 'rotom-breeding-feature-provider-handoff-v1', 'Feature provider handoff contract identity drifted')
assert(featureProviderHandoffContract.definition?.canonicalAuthority?.modifierInventoryDefinitionSha256 === modifierInventoryContract.definitionSha256
  && featureProviderHandoffContract.definition?.canonicalAuthority?.effectiveProjection === 'current-server-resolved-effective-unsuppressed-ready-Feature-set', 'Feature provider canonical authority drifted')
assert(featureProviderHandoffContract.definition?.checkpoints?.length === 9
  && featureProviderHandoffContract.definition.checkpoints.some((entry: any) => entry.providerCanonicalId === 'Dilettante' && entry.disposition === 'active-upstream-effective-provider')
  && featureProviderHandoffContract.definition.checkpoints.some((entry: any) => entry.providerCanonicalId === 'This One’s Special, I Know It' && entry.disposition === 'reserved-br-062'), 'Feature provider checkpoint inventory drifted')
assert(JSON.stringify(featureProviderHandoffContract.definition?.dilettante?.mandatedSkillChoices) === JSON.stringify(['general-education', 'perception'])
  && featureProviderHandoffContract.definition?.dilettante?.skillPrerequisiteWaiver === true, 'Dilettante Breeder substitution policy drifted')
assert(featureProviderHandoffContract.definition?.facilities?.registryState === 'empty-no-authority'
  && featureProviderHandoffContract.definition?.authorityBoundary?.handoffMutation === 'none'
  && featureProviderHandoffContract.definition?.authorityBoundary?.realtimeRows === 0, 'Feature provider handoff acquired facility or mutation authority')
assert(featureProviderHandoffContract.definition?.tests?.focusedCount === 10, 'Feature provider handoff focused test count drifted')
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
  'shared/breeding/project.ts',
  'server/domain/breeding/projectLifecycle.ts',
  'tests/shared/breedingProjectContract.test.ts',
  'shared/breeding/egg.ts',
  'server/domain/breeding/eggLifecycle.ts',
  'tests/shared/pokemonEggContract.test.ts',
  'shared/breeding/lineage.ts',
  'server/domain/breeding/lineage.ts',
  'tests/shared/breedingLineageContract.test.ts',
  'shared/breeding/operations.ts',
  'server/domain/breeding/operations.ts',
  'tests/shared/breedingOperationContract.test.ts',
  'shared/breeding/ledgers.ts',
  'server/domain/breeding/ledgers.ts',
  'tests/shared/breedingLedgerContract.test.ts',
  'shared/breeding/readSets.ts',
  'server/domain/breeding/readSets.ts',
  'tests/shared/breedingReadSetContract.test.ts',
  'shared/breeding/authorization.ts',
  'server/domain/breeding/authorization.ts',
  'tests/shared/breedingAuthorizationContract.test.ts',
  'shared/breeding/projections.ts',
  'server/domain/breeding/projections.ts',
  'tests/shared/breedingProjectionContract.test.ts',
  'shared/breeding/archives.ts',
  'server/domain/breeding/archives.ts',
  'tests/shared/breedingArchiveContract.test.ts',
  'server/storage/migrations.ts',
  'scripts/migrate-campaign-to-sqlite.mjs',
  'tests/server/breedingStorageMigrations.test.ts',
  'server/storage/breedingRepositorySupport.ts',
  'server/storage/breedingProjectRepository.ts',
  'server/storage/pokemonEggRepository.ts',
  'server/storage/breedingConsentRepository.ts',
  'server/storage/trainerSpeciesAcquisitionRepository.ts',
  'tests/server/breedingRepositories.test.ts',
  'server/useCases/executeBreedingTransaction.ts',
  'tests/server/breedingTransactionCoordinator.test.ts',
  'shared/breeding/projectInitialProgress.ts',
  'server/domain/breeding/projectInitialProgress.ts',
  'server/storage/breedingOperationEvidenceRepository.ts',
  'server/useCases/manageBreedingProjectInitialTime.ts',
  'tests/server/breedingProjectInitialProgress.test.ts',
  'shared/breeding/projectCheck.ts',
  'server/domain/breeding/projectCheck.ts',
  'server/storage/breedingCheckLedgerRepository.ts',
  'server/useCases/resolveBreedingProjectCheck.ts',
  'tests/server/breedingProjectCheck.test.ts',
  'shared/breeding/projectAdditionalProgress.ts',
  'server/domain/breeding/projectAdditionalProgress.ts',
  'server/useCases/advanceBreedingProjectAdditionalTime.ts',
  'tests/server/breedingProjectAdditionalProgress.test.ts',
  'shared/breeding/productionSnapshots.ts',
  'server/domain/breeding/productionSnapshots.ts',
  'tests/server/breedingProductionSnapshots.test.ts',
  'shared/breeding/offspringProduction.ts',
  'server/domain/breeding/offspringProduction.ts',
  'server/storage/breedingRollRepository.ts',
  'server/storage/breedingOptionOfferRepository.ts',
  'tests/server/breedingOffspringProduction.test.ts',
  'data/breeding-automation/offspring-production-contract.json',
  'shared/breeding/eggProduction.ts',
  'server/domain/breeding/eggProduction.ts',
  'server/useCases/produceBreedingProjectEgg.ts',
  'tests/server/breedingEggProduction.test.ts',
  'data/breeding-automation/egg-production-contract.json',
  'shared/breeding/lifecycleRecovery.ts',
  'server/domain/breeding/lifecycleRecovery.ts',
  'server/useCases/manageBreedingLifecycleRecovery.ts',
  'server/useCases/recoverBreedingOperation.ts',
  'tests/server/breedingLifecycleRecovery.test.ts',
  'data/breeding-automation/lifecycle-recovery-contract.json',
  'shared/breeding/incubation.ts',
  'server/domain/breeding/incubation.ts',
  'server/storage/breedingIncubationSegmentRepository.ts',
  'server/useCases/managePokemonEggIncubation.ts',
  'data/breeding-automation/incubation-contract.json',
  'data/breeding-automation/incubation-storage-schema-v24.json',
  'shared/breeding/readinessCorrection.ts',
  'server/domain/breeding/readinessCorrection.ts',
  'server/useCases/markPokemonEggReady.ts',
  'data/breeding-automation/readiness-correction-contract.json',
  'shared/breeding/campaignClockBatch.ts',
  'server/domain/breeding/campaignClockBatch.ts',
  'server/useCases/advanceBreedingCampaignClockBatch.ts',
  'tests/server/breedingCampaignClockBatch.test.ts',
  'data/breeding-automation/campaign-clock-incubation-batch-contract.json',
  'shared/breeding/eggLifecycle.ts',
  'server/domain/breeding/eggLifecyclePolicy.ts',
  'server/useCases/queryPokemonEggLifecycle.ts',
  'tests/server/breedingEggLifecyclePolicy.test.ts',
  'data/breeding-automation/egg-lifecycle-policy-contract.json',
  'shared/breeding/hatchOffers.ts',
  'server/domain/breeding/hatchOffers.ts',
  'server/useCases/projectPokemonEggHatchOffer.ts',
  'tests/server/breedingHatchOffers.test.ts',
  'data/breeding-automation/hatch-offer-contract.json',
  'shared/breeding/hatchCompletion.ts',
  'server/domain/breeding/hatchCompletion.ts',
  'server/storage/breedingLineageRepository.ts',
  'server/useCases/completePokemonEggHatch.ts',
  'tests/server/breedingHatchCompletion.test.ts',
  'data/breeding-automation/hatch-completion-contract.json',
  'server/domain/breeding/hatchSpeciesAcquisition.ts',
  'tests/server/trainerSpeciesAcquisitionReward.test.ts',
  'data/breeding-automation/hatch-species-acquisition-contract.json',
  'data/breeding-automation/hatch-resilience-contract.json',
  'shared/breeding/breederEdgeHandoff.ts',
  'server/domain/breeding/breederEdgeHandoff.ts',
  'server/useCases/resolveBreedingBreederEdgeHandoff.ts',
  'tests/server/breedingBreederEdgeHandoff.test.ts',
  'data/breeding-automation/breeder-edge-handoff-contract.json',
  'shared/breeding/featureProviderHandoff.ts',
  'server/domain/breeding/featureProviderHandoff.ts',
  'server/useCases/resolveBreedingFeatureProviderHandoff.ts',
  'tests/server/breedingFeatureProviderHandoff.test.ts',
  'data/breeding-automation/feature-provider-handoff-contract.json',
  'shared/breeding/modifierProviderHandoff.ts',
  'server/domain/breeding/modifierProviderHandoff.ts',
  'server/domain/breeding/eggWarmerCapability.ts',
  'server/useCases/applyPokemonEggWarmerCapability.ts',
  'tests/server/breedingModifierProviderHandoff.test.ts',
  'data/breeding-automation/modifier-provider-handoff-contract.json',
  'data/breeding-automation/storage-schema-v25.json',
  'shared/breeding/parentSourceChange.ts',
  'server/domain/breeding/parentSourceChange.ts',
  'tests/server/breedingParentSourceChange.test.ts',
  'data/breeding-automation/parent-source-change-contract.json',
  'shared/breeding/eggTransfer.ts',
  'server/domain/breeding/eggTransfer.ts',
  'server/storage/pokemonEggTransferConsentRepository.ts',
  'server/useCases/managePokemonEggTransferConsent.ts',
  'server/useCases/transferPokemonEggOwnership.ts',
  'tests/server/breedingEggTransfer.test.ts',
  'data/breeding-automation/storage-schema-v26.json',
  'data/breeding-automation/egg-transfer-contract.json',
  'shared/speciesAcquisitionHistory.ts',
  'server/domain/breeding/speciesAcquisitionHistory.ts',
  'server/domain/breeding/speciesAcquisitionIntegration.ts',
  'server/storage/trainerSpeciesAcquisitionSourceOperationRepository.ts',
  'server/useCases/settleCaptureSpeciesAcquisitions.ts',
  'server/useCases/settleSetupSheetSpeciesAcquisitions.ts',
  'server/useCases/settleReviewedSpeciesAcquisition.ts',
  'tests/server/speciesAcquisitionIntegration.test.ts',
  'data/breeding-automation/storage-schema-v27.json',
  'data/breeding-automation/storage-schema-v28.json',
  'data/breeding-automation/species-acquisition-integration-contract.json',
  'shared/breeding/workshop.ts',
  'server/domain/breeding/workshop.ts',
  'server/useCases/loadBreedingWorkshop.ts',
  'server/api/breeding/workshop.get.ts',
  'src/composables/breeding/useBreedingWorkshop.ts',
  'src/components/breeding/BreedingWorkshopShell.vue',
  'src/pages/breeding/index.vue',
  'tests/shared/breedingWorkshopContract.test.ts',
  'tests/server/breedingWorkshop.test.ts',
  'tests/server/breedingWorkshopRoute.test.ts',
  'tests/components/breedingWorkshopShell.test.ts',
  'data/breeding-automation/workshop-presentation-contract.json',
  'shared/breeding/projectWizard.ts',
  'server/domain/breeding/projectWizard.ts',
  'server/useCases/loadBreedingProjectWizard.ts',
  'server/api/breeding/projects/wizard.post.ts',
  'src/composables/breeding/useBreedingProjectWizard.ts',
  'src/components/breeding/BreedingProjectWizard.vue',
  'tests/shared/breedingProjectWizardContract.test.ts',
  'tests/server/breedingProjectWizard.test.ts',
  'tests/server/breedingProjectWizardRoute.test.ts',
  'tests/composables/breeding/useBreedingProjectWizard.test.ts',
  'tests/components/breedingProjectWizard.test.ts',
  'data/breeding-automation/project-wizard-presentation-contract.json',
  'shared/breeding/projectGuidance.ts',
  'server/domain/breeding/projectGuidance.ts',
  'server/useCases/loadBreedingProjectGuidance.ts',
  'server/api/breeding/projects/wizard/guidance.post.ts',
  'tests/shared/breedingProjectGuidanceContract.test.ts',
  'tests/server/breedingProjectGuidance.test.ts',
  'tests/server/breedingProjectGuidanceRoute.test.ts',
  'data/breeding-automation/project-guidance-presentation-contract.json',
  'shared/breeding/projectChoices.ts',
  'server/domain/breeding/currentReferences.ts',
  'server/domain/breeding/projectChoices.ts',
  'server/useCases/loadBreedingProjectChoices.ts',
  'server/api/breeding/projects/wizard/choices.post.ts',
  'tests/shared/breedingProjectChoicesContract.test.ts',
  'tests/server/breedingCurrentReferences.test.ts',
  'tests/server/breedingProjectChoices.test.ts',
  'tests/server/breedingProjectChoicesRoute.test.ts',
  'data/breeding-automation/project-choices-presentation-contract.json',
  'shared/breeding/workshopActivity.ts',
  'server/domain/breeding/workshopActivity.ts',
  'server/useCases/loadBreedingWorkshopActivity.ts',
  'server/api/breeding/workshop/activity.get.ts',
  'src/composables/breeding/useBreedingWorkshopActivity.ts',
  'src/components/breeding/BreedingWorkshopActivityCards.vue',
  'tests/shared/breedingWorkshopActivityContract.test.ts',
  'tests/server/breedingWorkshopActivity.test.ts',
  'tests/server/breedingWorkshopActivityRoute.test.ts',
  'tests/composables/breeding/useBreedingWorkshopActivity.test.ts',
  'tests/components/breedingWorkshopActivityCards.test.ts',
  'data/breeding-automation/workshop-activity-presentation-contract.json',
  'shared/breeding/hatchWorkflow.ts',
  'server/domain/breeding/hatchWorkflow.ts',
  'server/useCases/manageBreedingHatchWorkflow.ts',
  'server/api/breeding/hatch.post.ts',
  'src/composables/breeding/useBreedingHatchWorkflow.ts',
  'src/components/breeding/BreedingHatchDecisionFlow.vue',
  'tests/shared/breedingHatchWorkflowContract.test.ts',
  'tests/server/breedingHatchWorkflow.test.ts',
  'tests/server/breedingHatchWorkflowRoute.test.ts',
  'tests/composables/breeding/useBreedingHatchWorkflow.test.ts',
  'tests/components/breedingHatchDecisionFlow.test.ts',
  'data/breeding-automation/hatch-workflow-presentation-contract.json',
  'data/breeding-automation/hatch-destination-presentation-contract.json',
  'shared/breeding/consentWorkflow.ts',
  'server/domain/breeding/consentWorkflow.ts',
  'server/useCases/manageBreedingConsentWorkflow.ts',
  'server/api/breeding/consent.post.ts',
  'src/composables/breeding/useBreedingConsentWorkflow.ts',
  'src/components/breeding/BreedingConsentCenter.vue',
  'tests/shared/breedingConsentWorkflowContract.test.ts',
  'tests/server/breedingConsentWorkflowRoute.test.ts',
  'tests/composables/breeding/useBreedingConsentWorkflow.test.ts',
  'tests/components/breedingConsentCenter.test.ts',
  'data/breeding-automation/consent-workflow-presentation-contract.json',
  'src/composables/breeding/useBreedingFocusBoundary.ts',
  'tests/components/breedingWorkshopAccessibilityAcceptance.test.ts',
  'data/breeding-automation/workshop-interaction-acceptance.json',
  'docs/breeding/accessibility-responsive-and-table-distance.md',
  'docs/breeding/workshop.md',
  'shared/breeding/fossilEgg.ts',
  'server/domain/breeding/fossilEgg.ts',
  'server/useCases/createBreedingFossilEgg.ts',
  'tests/server/breedingFossilEgg.test.ts',
  'data/breeding-automation/fossil-egg-contract.json',
  'shared/breeding/gmEgg.ts',
  'server/domain/breeding/gmEgg.ts',
  'server/useCases/createBreedingGmEgg.ts',
  'tests/server/breedingGmEgg.test.ts',
  'data/breeding-automation/gm-egg-contract.json',
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
