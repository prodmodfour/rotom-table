import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/encounter-settlement-captures.v1.json'
import {
  ENCOUNTER_SETTLEMENT_CAPTURE_RECORD_SCHEMA_VERSION,
  ENCOUNTER_SETTLEMENT_CAPTURE_ROSTER_DESTINATIONS,
} from '../../server/domain/encounterSettlement/captureSettlement'
import { TRAINER_TEAM_LIMIT } from '../../src/utils/trainerPokemonLinks'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-077 encounter settlement capture contract', () => {
  it('is versioned and hash-bound to accepted capture, roster, Profile, and reward authorities', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-077',
      status: 'current-semantics',
      contract: 'encounter-settlement-captures-v1',
    })
    const sources = {
      rewardPackageContractSha256: 'data/complete-play-loop/encounter-settlement-reward-package.v1.json',
      captureSettlementModelSha256: 'server/domain/encounterSettlement/captureSettlement.ts',
      acceptedCaptureCommandSha256: 'server/useCases/applyThrowPokeballCommand.ts',
      captureMutationRulesSha256: 'src/utils/pokeballCapture.ts',
      trainerRosterRulesSha256: 'src/utils/trainerPokemonLinks.ts',
      playerProfileContractSha256: 'shared/playerProfiles.ts',
    } as const
    expect(Object.keys(contract.sourceEvidence)).toEqual(Object.keys(sources))
    for (const [key, path] of Object.entries(sources)) {
      expect(acceptedSuccessorHead(path, contract.sourceEvidence[key as keyof typeof sources]), path).toBe(sha256(path))
    }
  })

  it('requires accepted capture evidence and never duplicates a sheet', () => {
    expect(contract.acceptedCapture.schemaVersion).toBe(ENCOUNTER_SETTLEMENT_CAPTURE_RECORD_SCHEMA_VERSION)
    expect(contract.acceptedCapture.required).toEqual(expect.arrayContaining([
      'exact capture operation authority and accepted-result hash',
      'capture provenance hash',
      'existing captured Pokémon sheet and post-capture revision',
    ]))
    expect(contract.acceptedCapture.rules).toContain('settlement never creates or copies a captured Pokémon sheet')
  })

  it('enforces explicit team, box, overflow, and naming decisions', () => {
    expect(contract.assignment.destinations).toEqual([...ENCOUNTER_SETTLEMENT_CAPTURE_ROSTER_DESTINATIONS])
    expect(contract.assignment.teamLimit).toBe(TRAINER_TEAM_LIMIT)
    expect(contract.assignment.overflow).toContain('never silently redirected')
    expect(contract.assignment.naming).toContain('never invents a nickname')
  })

  it('keeps ownership, caught-ball provenance, and application fail-closed', () => {
    expect(contract.ownership.forbidden).toEqual(expect.arrayContaining([
      'silent owner-Trainer changes',
      'duplicate team and box custody',
      'changed caught-ball provenance',
    ]))
    expect(contract.writePlan.beforeAfterEvidence).toContain('SHA-256')
    expect(contract.writePlan.staleRule).toContain('complete authority hash')
    expect(contract.writePlan.atomicRule).toContain('no applicable writes')
  })

  it('keeps capture and Profile evidence private', () => {
    expect(contract.privacy.serverPrivate).toEqual(expect.arrayContaining([
      'capture operation and accepted-result identity',
      'provenance hashes',
      'Profile definition and linked-character evidence',
    ]))
  })
})
