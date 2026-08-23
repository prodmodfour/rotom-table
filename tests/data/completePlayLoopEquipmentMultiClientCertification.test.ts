import { describe, expect, it } from 'vitest'
import certification from '~~/data/complete-play-loop/equipment-multi-client-certification.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

describe('P8-050 multi-client equipment certification artifact', () => {
  it('is bound to every reviewed equipment authority used by the end-to-end fixture', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-050',
      status: 'certified',
      certificationTest: 'tests/integration/equipmentMultiClientLifecycle.test.ts',
    })
    const authorities = {
      equipmentDefinitionsSha256: 'data/complete-play-loop/equipment-definitions.v1.json',
      equipmentContributionsSha256: 'data/complete-play-loop/equipment-contributions.v1.json',
      equipmentGrantsSha256: 'data/complete-play-loop/equipment-grants.v1.json',
      equipmentEventProvidersSha256: 'data/complete-play-loop/equipment-event-providers.v1.json',
      equipmentLifecycleSha256: 'data/complete-play-loop/equipment-lifecycle.v1.json',
    } as const
    for (const [field, path] of Object.entries(authorities)) {
      const recorded = certification.runtimeEvidence[field as keyof typeof authorities]
      expect(acceptedSuccessorHead(path, recorded), path).toBe(repositoryFileSha256(path))
    }
  })

  it('certifies both owner kinds, stale-client rejection, reconnect convergence, cleanup, and privacy', () => {
    expect(certification.trainerScenario.items).toEqual(['Light Armor', 'Survival Knife'])
    expect(certification.pokemonScenario.items).toEqual(['Quick Claw', 'Safety Goggles'])
    expect(certification.concurrencyAssertions).toMatchObject({
      staleCommandsRejected: true,
      exactReplayNoDuplicateMutation: true,
      exactReplayNoDuplicateRealtime: true,
      realtimeSequencesMonotonic: true,
      freshReconnectConverges: true,
    })
    expect(certification.privacyAssertions).toMatchObject({
      playerSheetUsesProjection: true,
      equippedInstanceIdentityOmitted: true,
      canonicalAndDefinitionHashesOmitted: true,
      serializedEquipmentOmitted: true,
      providerBindingOmitted: true,
      playerRealtimeRedacted: true,
    })
    expect(certification.trainerScenario.sourceCleanup).toContain('neither contribution')
    expect(certification.pokemonScenario.sourceCleanup).toContain('no equipped instance')
  })
})
