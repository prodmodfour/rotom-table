import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '~~/data/complete-play-loop/equipment-multi-client-certification.v1.json'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-050 multi-client equipment certification artifact', () => {
  it('is bound to every reviewed equipment authority used by the end-to-end fixture', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-050',
      status: 'certified',
      certificationTest: 'tests/integration/equipmentMultiClientLifecycle.test.ts',
    })
    expect(certification.runtimeEvidence).toEqual({
      equipmentDefinitionsSha256: sha256('data/complete-play-loop/equipment-definitions.v1.json'),
      equipmentContributionsSha256: sha256('data/complete-play-loop/equipment-contributions.v1.json'),
      equipmentGrantsSha256: sha256('data/complete-play-loop/equipment-grants.v1.json'),
      equipmentEventProvidersSha256: sha256('data/complete-play-loop/equipment-event-providers.v1.json'),
      equipmentLifecycleSha256: sha256('data/complete-play-loop/equipment-lifecycle.v1.json'),
    })
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
