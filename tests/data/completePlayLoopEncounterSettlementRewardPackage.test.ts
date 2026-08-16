import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/encounter-settlement-reward-package.v1.json'
import {
  ENCOUNTER_SETTLEMENT_REWARD_CAPACITY_METRICS,
  ENCOUNTER_SETTLEMENT_REWARD_DESTINATION_RULES,
  ENCOUNTER_SETTLEMENT_REWARD_KINDS,
  ENCOUNTER_SETTLEMENT_REWARD_METHOD_RULES,
  ENCOUNTER_SETTLEMENT_REWARD_VALIDATION_ISSUE_KINDS,
  ENCOUNTER_SETTLEMENT_REWARD_WRITE_FIELDS,
} from '../../server/domain/encounterSettlement/rewardPackage'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-074 encounter settlement reward package contract', () => {
  it('is versioned and hash-bound to current settlement-phase contracts and runtime', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-074',
      status: 'current-semantics',
      contract: 'encounter-settlement-reward-package-v1',
    })
    expect(contract.sourceEvidence).toEqual({
      settlementDocumentModelSha256: sha256('shared/encounterSettlement/document.ts'),
      settlementDocumentContractSha256: sha256('data/complete-play-loop/encounter-settlement-document.v1.json'),
      eligibilityContractSha256: sha256('data/complete-play-loop/encounter-settlement-eligibility.v1.json'),
      consequenceSnapshotContractSha256: sha256('data/complete-play-loop/encounter-settlement-consequence-snapshot.v1.json'),
      rewardPackageModelSha256: sha256('server/domain/encounterSettlement/rewardPackage.ts'),
    })
  })

  it('matches every reward destination and method policy', () => {
    expect(contract.rewardKinds).toEqual([...ENCOUNTER_SETTLEMENT_REWARD_KINDS])
    for (const kind of ENCOUNTER_SETTLEMENT_REWARD_KINDS) {
      expect(contract.destinationRules[kind]).toEqual([
        ...ENCOUNTER_SETTLEMENT_REWARD_DESTINATION_RULES[kind],
      ])
      expect(contract.methodRules[kind]).toEqual([
        ...ENCOUNTER_SETTLEMENT_REWARD_METHOD_RULES[kind],
      ])
    }
    expect(contract.allocationRules.serializedAndCapture).toContain('Exactly one whole allocation')
    expect(contract.allocationRules.pending).toContain('remain present and pending')
  })

  it('requires complete permission, aggregate capacity, and leaf-write preflight', () => {
    expect(contract.authoritySnapshot.completenessLiteral).toBe('authoritative-current')
    expect(contract.authoritySnapshot.capacityMetrics).toEqual([
      ...ENCOUNTER_SETTLEMENT_REWARD_CAPACITY_METRICS,
    ])
    expect(contract.writePreview.fields).toEqual([...ENCOUNTER_SETTLEMENT_REWARD_WRITE_FIELDS])
    expect(contract.writePreview.aggregateRule).toContain('Every active allocation')
    expect(contract.validationIssueKinds).toEqual([
      ...ENCOUNTER_SETTLEMENT_REWARD_VALIDATION_ISSUE_KINDS,
    ])
    expect(contract.readiness.eligible).toContain('capacity fits in aggregate')
  })

  it('models serialized equipment, group/side/profile destinations, narrative facts, and GM notes without claiming mechanics', () => {
    expect(contract.itemKinds.serializedEquipment).toContain('one whole item')
    expect(contract.destinationRules.experience).toEqual(expect.arrayContaining(['group', 'side']))
    expect(contract.destinationRules.capture).toContain('profile')
    expect(contract.narrative.gmNote).toContain('server-private')
    expect(contract.narrative.freeformMechanics).toBe('forbidden')
    expect(contract.ownership.plannerDoesNotOwn).toEqual(expect.arrayContaining([
      'experience or level mechanics',
      'money or inventory mutation',
      'serialized equipment creation',
      'capture team or box mutation',
      'atomic settlement persistence or publication',
    ]))
  })

  it('keeps raw write, capacity, permission, profile, and GM-note evidence private', () => {
    expect(contract.privacy.storedPlan).toBe('server-private')
    expect(contract.privacy.forbiddenPublicEvidence).toEqual(expect.arrayContaining([
      'destination revision',
      'capacity values',
      'source-write identity',
      'target authority identity or revision',
      'Profile identity',
      'GM note text outside GM projection',
    ]))
  })
})
