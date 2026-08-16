import { describe, expect, it } from 'vitest'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementDocument,
} from '../../shared/encounterSettlement/document'
import {
  applyEncounterSettlementLootAllocationPlan,
  encounterSettlementSerializedRewardInstanceId,
  EncounterSettlementLootAllocationError,
  planEncounterSettlementLootAllocation,
  type EncounterSettlementItemLootDeclaration,
  type EncounterSettlementLootAuthoritySnapshot,
  type EncounterSettlementLootContainerAuthority,
  type EncounterSettlementLootDeclaration,
} from '../../server/domain/encounterSettlement/lootAllocation'
import { planEncounterSettlementRewardPackage } from '../../server/domain/encounterSettlement/rewardPackage'
import { createDefaultGroupInventoryDocument } from '../../src/types/groupInventory'
import type { TrainerSheet } from '../../src/types/trainerSheet'

const settlementId = 'encounter-settlement:v1:00000000000000000000000000000076'
const encounter = {
  encounterId: 'encounter-loot-a',
  encounterRevision: 12,
  linkedMapSlug: 'arena-loot-a',
  linkedMapRevision: 20,
  campaignMinute: 480,
} as const

const ref = (
  kind: EncounterSettlementAuthorityRef['kind'],
  id: string,
  revision: number,
): EncounterSettlementAuthorityRef => ({ kind, id, revision })

const itemDefinition = ref('item-operation', 'item-definition-potion', 1)
const equipmentDefinition = ref('equipment-operation', 'equipment-definition-light-armor', 3)

const settlement = (overrides: Partial<EncounterSettlementDocument> = {}): EncounterSettlementDocument => {
  const created = createEncounterSettlementDocument({
    settlementId,
    rewardPackageId: 'reward-package-loot-a',
    encounter,
  })
  return parseEncounterSettlementDocument({
    ...created,
    participants: [{
      participantId: 'trainer-placement-a',
      sourceAuthority: ref('map', 'arena-loot-a', 20),
      sheetKind: 'trainer',
      sheetSlug: 'trainer-a',
      sheetRevision: 7,
      sideId: 'heroes',
      ownerParticipantId: null,
      settlementRole: 'combatant',
      disposition: 'active',
    }],
    rewardPackage: {
      rewardPackageId: 'reward-package-loot-a',
      status: 'ready',
      lines: [{
        rewardId: 'reward-money-a',
        visibility: 'public',
        sourceAuthority: ref('encounter-document', 'encounter-loot-a', 12),
        disposition: 'pending',
        payload: { kind: 'money', amount: 500 },
      }, {
        rewardId: 'reward-potions-a',
        visibility: 'destination-owner',
        sourceAuthority: ref('encounter-document', 'encounter-loot-a', 12),
        disposition: 'pending',
        payload: {
          kind: 'item',
          canonicalItemId: 'Potion',
          quantity: 3,
          serialized: false,
          definitionAuthority: itemDefinition,
        },
      }, {
        rewardId: 'reward-armor-a',
        visibility: 'destination-owner',
        sourceAuthority: ref('encounter-document', 'encounter-loot-a', 12),
        disposition: 'pending',
        payload: {
          kind: 'item',
          canonicalItemId: 'Light Armor',
          quantity: 1,
          serialized: true,
          definitionAuthority: equipmentDefinition,
        },
      }],
    },
    ...overrides,
  })
}

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'trainer-a',
  revision: 7,
  updatedAt: 1,
  name: 'Trainer A',
  level: 5,
  money: 100,
  inventory: {
    medicalKit: [{ id: 'trainer-potion-row', name: 'Potion', qty: 2, cost: 200 }],
  },
  ...overrides,
})

const group = () => ({
  ...createDefaultGroupInventoryDocument({ slug: 'main', now: 1 }),
  revision: 5,
  money: 50,
})

const containers = (): EncounterSettlementLootContainerAuthority[] => [{
  kind: 'trainer',
  slug: 'trainer-a',
  revision: 7,
  document: trainer(),
}, {
  kind: 'group',
  slug: 'main',
  revision: 5,
  document: group(),
}]

const permission = (authority: EncounterSettlementAuthorityRef, denied = false) => ({
  status: denied ? 'denied' as const : 'allowed' as const,
  authority,
  reasonId: denied ? 'destination-not-controlled' : null,
})

const serializedArmor = () => ({
  schemaVersion: 1 as const,
  instanceId: encounterSettlementSerializedRewardInstanceId(settlementId, 'reward-armor-a'),
  revision: 0,
  canonicalItemId: 'Light Armor',
  canonicalRecordSha256: 'a'.repeat(64),
  equipmentDefinitionSha256: 'b'.repeat(64),
  configuration: null,
  activity: { status: 'active' as const, reasons: [] },
  state: {},
})

const declarations = (): EncounterSettlementLootDeclaration[] => [{
  kind: 'money',
  rewardId: 'reward-money-a',
  destination: { kind: 'trainer-inventory', id: 'trainer-a', revision: 7 },
  amount: 200,
  permission: permission(ref('sheet', 'trainer-a', 7)),
}, {
  kind: 'money',
  rewardId: 'reward-money-a',
  destination: { kind: 'group-inventory', id: 'main', revision: 5 },
  amount: 300,
  permission: permission(ref('group-inventory', 'main', 5)),
}, {
  kind: 'item',
  rewardId: 'reward-potions-a',
  destination: { kind: 'trainer-inventory', id: 'trainer-a', revision: 7 },
  amount: 3,
  section: 'medicalKit',
  definitionAuthority: itemDefinition,
  entry: { name: 'Potion', cost: 200 },
  permission: permission(ref('sheet', 'trainer-a', 7)),
}, {
  kind: 'item',
  rewardId: 'reward-armor-a',
  destination: { kind: 'group-inventory', id: 'main', revision: 5 },
  amount: 1,
  section: 'equipment',
  definitionAuthority: equipmentDefinition,
  entry: { name: 'Light Armor', serializedEquipment: serializedArmor() },
  permission: permission(ref('group-inventory', 'main', 5)),
}]

const authority = (
  declarationRows: readonly EncounterSettlementLootDeclaration[] = declarations(),
  overrides: Partial<EncounterSettlementLootAuthoritySnapshot> = {},
): EncounterSettlementLootAuthoritySnapshot => ({
  completeness: 'authoritative-current',
  declarations: declarationRows,
  containers: containers(),
  ...overrides,
})

describe('encounter settlement money and item loot allocation', () => {
  it('splits money, merges stack rewards, creates deterministic whole equipment, and preflights P8-074', () => {
    const currentContainers = containers()
    const plan = planEncounterSettlementLootAllocation({
      settlement: settlement(),
      authority: authority(declarations(), { containers: currentContainers }),
    })

    expect(plan.complete).toBe(true)
    expect(plan.pendingRewardIds).toEqual([])
    expect(plan.deniedRewardIds).toEqual([])
    expect(plan.allocations).toHaveLength(4)
    expect(plan.previews).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'money', amount: 200, balanceBefore: 100, balanceAfter: 300 }),
      expect.objectContaining({ kind: 'money', amount: 300, balanceBefore: 50, balanceAfter: 350 }),
      expect.objectContaining({
        kind: 'item', canonicalItemId: 'Potion', rowDisposition: 'merged',
        quantityBefore: 2, quantityAfter: 5,
      }),
      expect.objectContaining({
        kind: 'item', canonicalItemId: 'Light Armor', rowDisposition: 'created',
        serialized: true, quantityAfter: 1,
      }),
    ]))
    expect(plan.containerWrites).toHaveLength(2)
    const trainerWrite = plan.containerWrites.find(write => write.kind === 'trainer')!
    expect(trainerWrite).toMatchObject({ expectedRevision: 7, revision: 8 })
    expect((trainerWrite.nextDocument as TrainerSheet).money).toBe(300)
    expect((trainerWrite.nextDocument as TrainerSheet).inventory?.medicalKit).toEqual([
      expect.objectContaining({ id: 'trainer-potion-row', name: 'Potion', qty: 5 }),
    ])
    const groupWrite = plan.containerWrites.find(write => write.kind === 'group')!
    expect(groupWrite.nextDocument.money).toBe(350)
    expect(groupWrite.nextDocument.inventory?.equipment?.[0]?.serializedEquipment).toMatchObject({
      instanceId: encounterSettlementSerializedRewardInstanceId(settlementId, 'reward-armor-a'),
      canonicalItemId: 'Light Armor',
      revision: 0,
    })

    const rewardPlan = planEncounterSettlementRewardPackage({
      settlement: plan.document,
      authority: { completeness: 'authoritative-current', destinations: plan.destinationAuthorities },
    })
    expect(rewardPlan).toMatchObject({ eligible: true, issues: [] })
    expect(rewardPlan.writePreviews.map(write => write.field)).toEqual(expect.arrayContaining([
      'money', 'inventory-stack', 'serialized-equipment',
    ]))

    expect(applyEncounterSettlementLootAllocationPlan({
      plan,
      currentContainers,
    })).toEqual(plan.containerWrites)
  })

  it('retains unallocated or denied loot as non-applicable pending work', () => {
    const partial = planEncounterSettlementLootAllocation({
      settlement: settlement(),
      authority: authority(declarations().filter(row => row.rewardId !== 'reward-armor-a')),
    })
    expect(partial).toMatchObject({
      complete: false,
      pendingRewardIds: ['reward-armor-a'],
    })
    expect(() => applyEncounterSettlementLootAllocationPlan({
      plan: partial,
      currentContainers: containers(),
    })).toThrow(/all money and item rewards must be allocated or explicitly excluded/)

    const deniedRows = declarations()
      .filter(row => row.rewardId === 'reward-potions-a')
      .map(row => ({ ...row, permission: permission(ref('sheet', 'trainer-a', 7), true) })) as EncounterSettlementLootDeclaration[]
    const potionSettlement = settlement({
      rewardPackage: {
        rewardPackageId: 'reward-package-loot-a',
        status: 'ready',
        lines: settlement().rewardPackage.lines.filter(line => line.rewardId === 'reward-potions-a'),
      },
    })
    const denied = planEncounterSettlementLootAllocation({
      settlement: potionSettlement,
      authority: authority(deniedRows, {
        containers: containers().filter(container => container.kind === 'trainer'),
      }),
    })
    expect(denied).toMatchObject({ complete: false, deniedRewardIds: ['reward-potions-a'] })
    expect(denied.destinationAuthorities[0]?.writes).toEqual([])
  })

  it('rejects stale destinations, duplicate declarations, foreign definitions, and forged canonical rows', () => {
    const stale = declarations()
    stale[0] = { ...stale[0]!, destination: { ...stale[0]!.destination, revision: 6 } }
    expect(() => planEncounterSettlementLootAllocation({
      settlement: settlement(), authority: authority(stale),
    })).toThrow(/does not match the exact current loot container revision/)

    expect(() => planEncounterSettlementLootAllocation({
      settlement: settlement(), authority: authority([...declarations(), declarations()[0]!]),
    })).toThrow(/same reward and destination more than once/)

    const foreignDefinition = declarations()
    foreignDefinition[2] = {
      ...foreignDefinition[2] as EncounterSettlementItemLootDeclaration,
      definitionAuthority: ref('item-operation', 'different-definition', 1),
    }
    expect(() => planEncounterSettlementLootAllocation({
      settlement: settlement(), authority: authority(foreignDefinition),
    })).toThrow(/must match the reward package exact reviewed item definition authority/)

    const forged = declarations()
    forged[2] = {
      ...forged[2] as EncounterSettlementItemLootDeclaration,
      entry: { name: 'Super Potion', cost: 200 },
    }
    expect(() => planEncounterSettlementLootAllocation({
      settlement: settlement(), authority: authority(forged),
    })).toThrow(/exact canonical item identity/)
  })

  it('requires deterministic whole-item identity, destination capacity, and unchanged apply authority', () => {
    const badEquipment = declarations()
    badEquipment[3] = {
      ...badEquipment[3] as EncounterSettlementItemLootDeclaration,
      entry: {
        name: 'Light Armor',
        serializedEquipment: { ...serializedArmor(), instanceId: 'equipped-item:v1:cccccccccccccccccccccccccccccccc' },
      },
    }
    expect(() => planEncounterSettlementLootAllocation({
      settlement: settlement(), authority: authority(badEquipment),
    })).toThrow(/deterministic new whole-item identity/)

    const full = trainer({
      inventory: {
        medicalKit: Array.from({ length: 256 }, (_, index) => ({
          id: `medical-row-${index}`,
          name: `Different Item ${index}`,
          qty: 1,
        })),
      },
    })
    const trainerOnlyPotion = declarations().filter(row => row.rewardId === 'reward-potions-a')
    const oneReward = settlement({
      rewardPackage: {
        rewardPackageId: 'reward-package-loot-a',
        status: 'ready',
        lines: settlement().rewardPackage.lines.filter(line => line.rewardId === 'reward-potions-a'),
      },
    })
    expect(() => planEncounterSettlementLootAllocation({
      settlement: oneReward,
      authority: authority(trainerOnlyPotion, {
        containers: [{ kind: 'trainer', slug: 'trainer-a', revision: 7, document: full }],
      }),
    })).toThrow(/at most 256 rows/)

    const currentContainers = containers()
    const plan = planEncounterSettlementLootAllocation({
      settlement: settlement(),
      authority: authority(declarations(), { containers: currentContainers }),
    })
    const staleContainers = currentContainers.map(container => container.kind === 'trainer'
      ? { ...container, document: { ...container.document, money: 101 } }
      : container) as EncounterSettlementLootContainerAuthority[]
    expect(() => applyEncounterSettlementLootAllocationPlan({
      plan,
      currentContainers: staleContainers,
    })).toThrow(/no longer matches the complete allocation preview/)
  })

  it('fails closed for incomplete snapshots, undeclared containers, and terminal loot state', () => {
    expect(() => planEncounterSettlementLootAllocation({
      settlement: settlement(),
      authority: { ...authority(), completeness: 'partial' } as any,
    })).toThrowError(EncounterSettlementLootAllocationError)

    expect(() => planEncounterSettlementLootAllocation({
      settlement: settlement(),
      authority: authority(declarations().filter(row => row.destination.id === 'trainer-a')),
    })).toThrow(/undeclared loot destination container/)

    expect(() => planEncounterSettlementLootAllocation({
      settlement: settlement({ status: 'committing' }),
      authority: authority(),
    })).toThrow(/cannot re-plan money or item loot/)
  })
})
