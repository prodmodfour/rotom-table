import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  parseEquipmentActionPublicResult,
  parseExecuteEquipmentActionCommand,
} from '#shared/itemAutomation/equipmentActions'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { StoredEquipmentActionOperation } from '~~/server/storage/equipmentActionOperationRepository'
import type { StoredItemGuidedRequestRecord } from '~~/server/storage/itemGuidedRequestRepository'
import { projectEquipmentActionPresentations } from '~~/server/domain/itemAutomation/equipmentActionPresentation'

const map: TabletopMap = {
  schemaVersion: 2,
  slug: 'item-presentation-arena',
  name: 'Item presentation arena',
  revision: 8,
  dimensions: { x: 8, y: 4, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  placements: [{
    id: 'trainer-placement',
    sheetKind: 'trainer',
    sheetSlug: 'mira',
    position: { x: 1, y: 0, z: 1 },
  }],
  encounterState: createEmptyEncounterState(),
}
const trainer: TrainerSheet = {
  slug: 'mira', name: 'Mira', revision: 4, updatedAt: 10,
  level: 20, currentHp: 50, skillBackground: { adept: 'combat' },
}
const equipmentRecord = (): StoredEquipmentActionOperation => ({
  commandSha256: 'a'.repeat(64),
  principalKey: 'private-principal',
  command: parseExecuteEquipmentActionCommand({
    schemaVersion: 1,
    operationId: 'equipment-action:v1:11111111111111111111111111111111',
    offerId: 'private-offer',
    mapSlug: map.slug,
    baseRevision: 7,
    actorPlacementId: 'trainer-placement',
    actionId: 'equipment.glue-cannon.attack',
    equipmentInstanceId: 'private-exact-glue-cannon',
    equipmentInstanceRevision: 3,
    targetEquipmentInstanceId: null,
    targetEquipmentInstanceRevision: null,
    targetPlacementIds: ['trainer-placement'],
    cells: [],
    inventorySourceInstanceId: null,
    skillCheckId: null,
    gmAdjudication: null,
  }),
  result: parseEquipmentActionPublicResult({
    schemaVersion: 1,
    operationId: 'equipment-action:v1:11111111111111111111111111111111',
    mapSlug: map.slug,
    mapRevision: 8,
    actorPlacementId: 'trainer-placement',
    actionId: 'equipment.glue-cannon.attack',
    status: 'accepted',
    exactReplay: false,
    targetPlacementIds: ['trainer-placement'],
    rolls: [{ rollId: 'roll-safe', expression: '1d20', naturalResult: 14, modifier: 2, total: 16 }],
    receipts: [{
      receiptId: 'receipt-safe', kind: 'charge-consumption', reasonCode: 'equipment.glue-cannon.hit',
      safeDetail: 'private remaining charge count',
    }],
  }),
  evidence: { exactSource: 'private evidence' },
  createdAt: 100,
})

const guidedRecord = (status: 'pending' | 'accepted'): StoredItemGuidedRequestRecord => ({
  schemaVersion: 1,
  requestId: `item-guided:v1:${(status === 'pending' ? '2' : '3').repeat(32)}`,
  requestKind: 'fishing-adjudication',
  status,
  revision: status === 'pending' ? 0 : 1,
  canonicalItemId: 'Old Rod',
  canonicalDefinitionSha256: 'b'.repeat(64),
  declarationPrincipalKey: 'private-owner-principal',
  actorKind: 'trainer', actorSlug: 'mira', targetKind: 'trainer', targetSlug: 'mira',
  itemOperationId: null,
  declarationOperationId: `item-guided-operation:v1:${'4'.repeat(32)}`,
  declarationCommandSha256: 'c'.repeat(64),
  declarationCommand: { secret: 'private declaration' },
  authority: {
    schemaVersion: 1,
    sourceKind: 'equipped-fishing-rod',
    actorLabel: 'Mira', targetLabel: 'Water', timingLabel: '15-minute Extended Action',
    prompt: 'Resolve fishing.', canonicalFacts: [], settlementFacts: [],
    reservationLabel: 'Private exact rod', boundaryLabel: 'Wait for adjudication.',
    mapSlug: map.slug, declarationMapRevision: 8, actorPlacementId: 'trainer-placement',
    ownerKind: 'trainer', ownerSlug: 'mira', sheetRevision: 4, equipmentRevision: 2,
    instanceId: 'private-exact-rod', instanceRevision: 1,
    actionId: 'equipment.fishing.old-rod', waterCell: { x: 2, y: 0, z: 1 },
    campaignClockRevision: 9, startedAtCampaignMinute: 100, readyAtCampaignMinute: 115,
    skillCheckIntegrationId: 'private-skill-check-integration',
  },
  terminalPrincipalKey: status === 'accepted' ? 'private-gm' : null,
  terminalOperationId: status === 'accepted' ? `item-guided-operation:v1:${'5'.repeat(32)}` : null,
  terminalCommandSha256: status === 'accepted' ? 'd'.repeat(64) : null,
  terminalCommand: status === 'accepted' ? {
    schemaVersion: 1,
    operationId: `item-guided-operation:v1:${'5'.repeat(32)}`,
    action: 'resolve-fishing',
    requestId: `item-guided:v1:${'3'.repeat(32)}`,
    expectedRevision: 0,
    skillId: 'survival',
    skillCheckIntegrationId: 'private-skill-check-integration',
    hookSpeciesId: 'Bulbasaur',
    hookLevel: 8,
    gmNote: 'private GM note',
  } : null,
  outcomeOptionId: status === 'accepted' ? 'fishing-hook-recorded' : null,
  result: status === 'accepted' ? {
    schemaVersion: 1, status: 'accepted',
    acceptedSummary: 'Old Rod fishing attempt resolved with one bounded hook outcome.',
  } : null,
  createdAt: 110,
  updatedAt: status === 'accepted' ? 120 : 110,
})

describe('equipment action encounter presentation', () => {
  it('projects available public outcome and history facts without exact custody or evidence', () => {
    const projection = projectEquipmentActionPresentations({
      equipmentRecords: [equipmentRecord()], guidedRecords: [], map,
      pokemonSheets: [], trainerSheets: [trainer],
    })
    expect(projection.accepted).toHaveLength(1)
    expect(projection.accepted[0]).toMatchObject({
      headline: { label: 'Fire Glue Cannon resolved' },
      outcomes: [{ kind: 'hit', label: 'Attack hit' }],
      history: [{ headline: 'Fire Glue Cannon resolved' }],
      correction: null,
    })
    expect(projection.accepted[0]?.headline.description).toContain('1d20 + 2 = 16')
    expect(projection.accepted[0]?.headline.description).toContain('Spend one charge')
    const wire = JSON.stringify(projection)
    expect(wire).not.toContain('private-exact-glue-cannon')
    expect(wire).not.toContain('private remaining charge count')
    expect(wire).not.toContain('private evidence')
    expect(wire).not.toContain('private-principal')
  })

  it('projects reconnectable guided pending and terminal states without request, hook, check, or GM-note authority', () => {
    const projection = projectEquipmentActionPresentations({
      equipmentRecords: [], guidedRecords: [guidedRecord('pending'), guidedRecord('accepted')], map,
      pokemonSheets: [], trainerSheets: [trainer],
    })
    expect(projection.pending).toHaveLength(1)
    expect(projection.pending[0]).toMatchObject({
      projection: 'public', prompt: 'Old Rod is waiting for authorised adjudication.',
      allowCancel: false, outstandingChoiceCount: 1,
    })
    expect(projection.accepted).toHaveLength(1)
    expect(projection.accepted[0]?.headline.label).toBe('Old Rod fishing attempt resolved with one bounded hook outcome.')
    const wire = JSON.stringify(projection)
    expect(wire).not.toContain('private-exact-rod')
    expect(wire).not.toContain('private-skill-check-integration')
    expect(wire).not.toContain('Bulbasaur')
    expect(wire).not.toContain('private GM note')
    expect(wire).not.toContain('item-guided:v1:')
  })
})
