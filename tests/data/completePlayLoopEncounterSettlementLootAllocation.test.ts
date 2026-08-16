import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/encounter-settlement-loot-allocation.v1.json'
import { INVENTORY_STACK_MAX_ROWS_PER_SECTION } from '../../server/domain/itemAutomation/inventoryStackOperations'
import { ENCOUNTER_SETTLEMENT_LOOT_REWARD_KINDS } from '../../server/domain/encounterSettlement/lootAllocation'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-076 encounter settlement money and item loot contract', () => {
  it('is versioned and hash-bound to reward, inventory, equipment, and canonical item authority', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-076',
      status: 'current-semantics',
      contract: 'encounter-settlement-loot-allocation-v1',
    })
    expect(contract.sourceEvidence).toEqual({
      rewardPackageContractSha256: sha256('data/complete-play-loop/encounter-settlement-reward-package.v1.json'),
      lootAllocationModelSha256: sha256('server/domain/encounterSettlement/lootAllocation.ts'),
      inventoryStackRulesSha256: sha256('server/domain/itemAutomation/inventoryStackOperations.ts'),
      inventoryMergeRulesSha256: sha256('src/utils/groupInventoryTransfers.ts'),
      serializedEquipmentContractSha256: sha256('shared/itemAutomation/equipment.ts'),
      canonicalItemsSha256: sha256('data/reference/items.json'),
    })
  })

  it('limits this provider to money and item rewards with exact destinations', () => {
    expect(contract.money.destinations).toEqual(['trainer-inventory', 'group-inventory'])
    expect(contract.items.destinations).toEqual(['trainer-inventory', 'group-inventory'])
    expect(ENCOUNTER_SETTLEMENT_LOOT_REWARD_KINDS).toEqual(['money', 'item'])
    expect(contract.authority.completenessLiteral).toBe('authoritative-current')
    expect(contract.authority.forbidden).toEqual(expect.arrayContaining([
      'name or prose based item identity inference',
      'stale destination revisions',
      'unsafe integer amounts or balances',
    ]))
  })

  it('reuses exact stack merge rules and deterministic whole-item identities', () => {
    expect(contract.items.stackMerge).toContain('authoritative inventory merge predicate')
    expect(contract.items.definitionRule).toContain('exact canonical item identity')
    expect(contract.items.serializedRule).toContain('revision zero')
    expect(contract.items.duplicateRule).toContain('whole-item identities')
    expect(contract.items.sectionCapacity).toBe(INVENTORY_STACK_MAX_ROWS_PER_SECTION)
  })

  it('keeps unallocated loot pending and makes revision application all-or-nothing', () => {
    expect(contract.completion.pending).toContain('visibly pending')
    expect(contract.completion.denied).toContain('produces no mutation')
    expect(contract.revisionPlan.beforeAfterEvidence).toContain('SHA-256')
    expect(contract.revisionPlan.staleRule).toContain('before hash')
    expect(contract.revisionPlan.atomicRule).toContain('no applicable writes')
  })

  it('keeps container, row, equipment, and permission evidence private', () => {
    expect(contract.privacy.serverPrivate).toEqual(expect.arrayContaining([
      'container documents and hashes',
      'inventory row and whole-item identities',
      'permission and definition authority',
      'Profile ownership evidence',
    ]))
  })
})
