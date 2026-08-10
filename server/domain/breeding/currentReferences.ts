import authorizationContractJson from '../../../data/breeding-automation/authorization-contract.json'
import canonicalIdsJson from '../../../data/breeding-automation/canonical-ids.json'
import compiledRegistryJson from '../../../data/breeding-automation/compiled-registry.json'
import eggContractJson from '../../../data/breeding-automation/egg-contract.json'
import ledgerContractJson from '../../../data/breeding-automation/ledger-contract.json'
import lineageContractJson from '../../../data/breeding-automation/lineage-contract.json'
import operationContractJson from '../../../data/breeding-automation/operation-contract.json'
import projectChoicesContractJson from '../../../data/breeding-automation/project-choices-presentation-contract.json'
import projectContractJson from '../../../data/breeding-automation/project-contract.json'
import readSetContractJson from '../../../data/breeding-automation/read-set-contract.json'
import rulesetJson from '../../../data/breeding-automation/ruleset.json'
import securityPolicyJson from '../../../data/breeding-automation/security-policy.json'
import semanticRegistryJson from '../../../data/breeding-automation/semantic-registry.json'
import sourceManifestJson from '../../../data/breeding-automation/source-manifest.json'
import type { BreedingCampaignOptionSnapshotV1 } from './campaignOptions'
import { parseBreedingCampaignOptionSnapshotV1 } from './campaignOptions'
import { createBreedingReferenceVersionSnapshotV1 } from './readSets'
import type {
  BreedingReferenceSourceId,
  BreedingReferenceVersionSnapshotV1,
} from '#shared/breeding/readSets'

const SOURCE_ID_BY_PATH = Object.freeze({
  'data/reference/abilities.json': 'abilities',
  'data/reference/capabilities.json': 'capabilities',
  'data/reference/conditions.json': 'conditions',
  'data/reference/edges.json': 'edges',
  'data/reference/features.json': 'features',
  'data/reference/items.json': 'items',
  'data/reference/maneuvers.json': 'maneuvers',
  'data/reference/moves.json': 'moves',
  'data/reference/poke-edges.json': 'poke-edges',
  'data/reference/pokedex.json': 'pokedex',
  'data/reference/pokemonExperienceChart.json': 'pokemon-experience-chart',
  'data/reference/rules.json': 'rules',
  'data/reference/stat-rankings.json': 'stat-rankings',
} satisfies Readonly<Record<string, BreedingReferenceSourceId>>)

const runtimeSources = (sourceManifestJson.runtimeSources as readonly {
  readonly path: string
  readonly sha256: string
}[]).map((source) => {
  const sourceId = SOURCE_ID_BY_PATH[source.path as keyof typeof SOURCE_ID_BY_PATH]
  if (!sourceId) throw new Error('Breeding source manifest contains an unknown runtime authority path.')
  return Object.freeze({ sourceId, contentSha256: source.sha256 })
})

const contractDefinitionHashes = Object.freeze([
  { contractId: 'breeding-authorization-contract', definitionSha256: authorizationContractJson.definitionSha256 },
  { contractId: 'breeding-ledger-contract', definitionSha256: ledgerContractJson.definitionSha256 },
  { contractId: 'breeding-lineage-contract', definitionSha256: lineageContractJson.definitionSha256 },
  { contractId: 'breeding-operation-contract', definitionSha256: operationContractJson.definitionSha256 },
  { contractId: 'breeding-project-choices-presentation-contract', definitionSha256: projectChoicesContractJson.definitionSha256 },
  { contractId: 'breeding-project-contract', definitionSha256: projectContractJson.definitionSha256 },
  { contractId: 'breeding-read-set-contract', definitionSha256: readSetContractJson.definitionSha256 },
  { contractId: 'breeding-security-policy', definitionSha256: securityPolicyJson.definitionSha256 },
  { contractId: 'pokemon-egg-contract', definitionSha256: eggContractJson.definitionSha256 },
])

/**
 * Builds the exact current app-owned reference checkpoint used by Breeding
 * operations. No documentary source or parser output participates here.
 */
export const createCurrentBreedingReferenceVersionSnapshotV1 = (
  campaignOptionsValue: BreedingCampaignOptionSnapshotV1 | unknown,
): BreedingReferenceVersionSnapshotV1 => {
  const campaignOptions = parseBreedingCampaignOptionSnapshotV1(campaignOptionsValue)
  return createBreedingReferenceVersionSnapshotV1({
    schemaVersion: 1,
    rulesetId: rulesetJson.rulesetId,
    rulesetDefinitionSha256: rulesetJson.definitionSha256,
    sourceManifestSha256: rulesetJson.definition.sourceManifestSha256,
    semanticRegistryDefinitionSha256: semanticRegistryJson.definitionSha256,
    compiledRegistryDefinitionSha256: compiledRegistryJson.definitionSha256,
    canonicalIdsDefinitionSha256: canonicalIdsJson.definitionSha256,
    campaignOptionSnapshotDefinitionSha256: campaignOptions.definitionSha256,
    referenceSources: runtimeSources,
    contractDefinitionHashes,
  })
}
