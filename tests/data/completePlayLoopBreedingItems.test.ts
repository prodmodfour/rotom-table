import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/breeding-items.v1.json'
import items from '../../data/reference/items.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_ITEM_WORKFLOW_CAPACITY,
  BREEDING_ITEM_WORKFLOW_CONTRACT,
  BREEDING_ITEM_WORKFLOW_MONEY_COST,
} from '../../server/domain/breeding/itemWorkflows'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const valueSha256 = (value: unknown): string => sha256(stableJsonStringify(value))

describe('P8-058 reviewed breeding-item integration authority', () => {
  it('locks exactly three canonical reusable tools to the existing Egg lifecycle', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-058', status: 'reviewed-native', itemCount: 3 })
    expect(contract.items.map(row => row.canonicalId)).toEqual(['Egg Warmer','Reanimation Machine','Chemistry Set'])
    expect(BREEDING_ITEM_WORKFLOW_CONTRACT).toEqual(contract)
    expect(BREEDING_ITEM_WORKFLOW_CAPACITY).toBe(4)
    expect(BREEDING_ITEM_WORKFLOW_MONEY_COST).toBe(3500)
    for (const row of contract.items) {
      expect(valueSha256(items[row.canonicalId as keyof typeof items])).toBe(row.recordSha256)
      expect(row.consumption).toMatchObject({ phase: 'never', quantity: 0, reusable: true })
    }
    expect(contract.items[0]?.mechanics).toMatchObject({ capacity: 4, campaignProgressRateNumerator: 2, campaignProgressRateDenominator: 1 })
    expect(contract.items[1]?.mechanics).toMatchObject({ fossilSourceConsumption: 1, offspringPipeline: 'shared-pokemon-egg-document-v1' })
    expect(contract.items[2]?.mechanics).toMatchObject({ moneyCost: 3500, requiredFeatureId: 'Playing God', offspringPipeline: 'shared-pokemon-egg-document-v1' })
  })

  it('hash-locks every app-owned structured authority and forbids documentary runtime parsing', () => {
    expect(contract.canonicalAuthority.runtimeDocumentaryParsingForbidden).toBe(true)
    expect(sha256(readFileSync(contract.canonicalAuthority.items.path))).toBe(contract.canonicalAuthority.items.fileSha256)
    for (const authority of Object.values(contract.canonicalAuthority.breedingArtifacts)) {
      expect(sha256(readFileSync(authority.path))).toBe(authority.fileSha256)
    }
    expect(sha256(readFileSync(contract.reviewedIntegration.path))).toBe(contract.reviewedIntegration.fileSha256)
    expect(contract.reviewedIntegration).toMatchObject({ runtimeAuthority: false, reviewStatus: 'accepted-existing-structured-authority' })
    expect(contract.runtimePolicies).toMatchObject({
      assignment: 'one-exact-warmer-unit-up-to-four-current-owned-incubating-eggs',
      consumption: 'fossil-source-only-at-accepted-restoration',
      reusableTools: 'warmer-machine-and-chemistry-set-remain-in-inventory',
      parallelOffspringPath: 'forbidden',
    })
  })
})
