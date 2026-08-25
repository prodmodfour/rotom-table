import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-pokemon-voltage-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { contestVariantIsNative } from '../../shared/contests/catalog'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verifyBound = (row: { path: string, sha256: string }): void => expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))

describe('P11-071 Battle Contest per-Pokémon Voltage certification', () => {
  it('continues from certified Effect semantics and binds every ledger/projection surface', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P11-071', status: 'certified', runtimeProseParsing: false })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    verifyBound(certification.canonicalVariantAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
  })

  it('certifies exact roster ledgers, active-only contribution, and role-safe projections', () => {
    expect(contests.variants.find(row => row.id === 'battle')?.voltagePolicy).toMatchObject({ scope: 'per-pokemon', appealUses: 'active-pokemon-only' })
    expect(certification.acceptance).toMatchObject({
      minimumPokemonLedgersPerTeam: 3,
      maximumPokemonLedgersPerTeam: 6,
      minimumVoltage: 0,
      maximumVoltage: 5,
      sharedTeamVoltage: 0,
      appealVoltageContributors: 'active-pokemon-only',
      reserveVoltageContributors: 0,
      publicSheetSlugFields: 0,
      publicPerformerIdFields: 0,
      publicProviderIdFields: 0,
      publicTeamPoolFields: 0,
      ownerOpponentExactLedgerFields: 0,
      variantCompletionState: 'structured',
      nextTicket: 'P11-072',
    })
    expect(contestVariantIsNative('battle')).toBe(true)
  })
})
