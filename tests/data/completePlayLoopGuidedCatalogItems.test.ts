import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/guided-catalog-items.v1.json'
import items from '../../data/reference/items.json'
import policy from '../../scripts/reviewed-data/item-catalog-cohort-policy.v1.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

const reviewedIds = Object.values(policy.interpretiveCampaignToolGroups)
  .flat()
  .sort((left, right) => left.localeCompare(right, 'en-US'))

describe('P8-093 reviewed guided catalog items', () => {
  it('covers every interpretive cohort identity once through hash-bound structured data', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-093',
      status: 'reviewed',
      runtimeProseParsing: false,
      catalogSha256: sha256(readFileSync('data/reference/items.json')),
      sourceSha256: sha256(readFileSync('scripts/reviewed-data/guided-catalog-items.v1.json')),
      cohortPolicySha256: sha256(readFileSync('scripts/reviewed-data/item-catalog-cohort-policy.v1.json')),
      itemCount: 34,
      decision: {
        choiceId: 'gm-campaign-tool-outcome',
        optionId: 'accept-reviewed-use',
        decisionRole: 'gm',
        freeformMechanics: false,
      },
    })
    expect(contract.items.map(row => row.canonicalId).sort((left, right) => left.localeCompare(right, 'en-US')))
      .toEqual(reviewedIds)
    expect(new Set(contract.items.map(row => row.canonicalId)).size).toBe(34)
    expect(contract.registrySha256).toBe(sha256(stableJsonStringify(contract.items)))
    for (const row of contract.items) {
      const canonical = items[row.canonicalId as keyof typeof items]
      expect(row.canonicalRecordSha256, row.canonicalId).toBe(sha256(stableJsonStringify(canonical)))
      expect(row.canonicalEffectSha256, row.canonicalId).toBe(sha256(canonical.effects.join('\n')))
    }
  })

  it('registers one bounded GM outcome with exact reusable or consumable disposition for all 34 items', () => {
    const reusable = contract.items.filter(row => row.consumption.reusable)
    const consumable = contract.items.filter(row => !row.consumption.reusable)
    expect(reusable.length + consumable.length).toBe(34)
    expect(reusable.length).toBeGreaterThan(0)
    expect(consumable.length).toBeGreaterThan(0)

    for (const row of reusable) {
      expect(row.consumption).toEqual({
        phase: 'never', quantity: 0, reserveWhilePending: false,
        refundableOnCancel: false, reusable: true,
      })
    }
    for (const row of consumable) {
      expect(row.consumption).toEqual({
        phase: 'gm-adjudication', quantity: 1, reserveWhilePending: true,
        refundableOnCancel: true, reusable: false,
      })
    }
    for (const row of contract.items) {
      const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require(row.canonicalId)
      expect(definition.spec).toMatchObject({
        implementationState: 'guided',
        registeredHandlerId: 'item.guided.v1',
        consumption: row.consumption,
        choices: [{
          choiceId: 'gm-campaign-tool-outcome', minimum: 1, maximum: 1,
          options: [{ optionId: 'accept-reviewed-use' }],
        }],
        effects: [{ operation: 'guided', outcomeKinds: ['campaign-fact'] }],
      })
    }
  })
})
