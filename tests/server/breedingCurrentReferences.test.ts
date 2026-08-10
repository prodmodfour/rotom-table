import { describe, expect, it } from 'vitest'
import projectChoicesContractJson from '../../data/breeding-automation/project-choices-presentation-contract.json'
import sourceManifestJson from '../../data/breeding-automation/source-manifest.json'
import {
  DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
} from '../../server/domain/breeding/campaignOptions'
import { createCurrentBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/currentReferences'
import { parseAuthoritativeBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/readSets'
import { BREEDING_REFERENCE_SOURCE_IDS } from '../../shared/breeding/readSets'

describe('BR-073 current Breeding reference snapshot', () => {
  it('binds every and only app-owned runtime source plus the Project choice contract', () => {
    const snapshot = createCurrentBreedingReferenceVersionSnapshotV1(
      DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
    )
    expect(parseAuthoritativeBreedingReferenceVersionSnapshotV1(snapshot)).toStrictEqual(snapshot)
    expect(snapshot.referenceSources.map(source => source.sourceId)).toEqual(BREEDING_REFERENCE_SOURCE_IDS)
    expect(snapshot.referenceSources).toEqual((sourceManifestJson.runtimeSources as readonly {
      path: string
      sha256: string
    }[]).map(source => ({
      sourceId: ({
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
      } as const)[source.path as 'data/reference/abilities.json'],
      contentSha256: source.sha256,
    })).sort((left, right) => left.sourceId.localeCompare(right.sourceId)))
    expect(snapshot.contractDefinitionHashes).toContainEqual({
      contractId: 'breeding-project-choices-presentation-contract',
      definitionSha256: projectChoicesContractJson.definitionSha256,
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/ptu-data|books\/|markdown|https?:/u)
  })

  it('rejects malformed or hash-tampered campaign option authority', () => {
    expect(() => createCurrentBreedingReferenceVersionSnapshotV1({
      ...DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
      definitionSha256: '0'.repeat(64),
    })).toThrow()
    expect(() => createCurrentBreedingReferenceVersionSnapshotV1(Promise.resolve({}))).toThrow()
  })
})
