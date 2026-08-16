import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect, type EncounterEffectDuration } from '#shared/moveAutomation/encounterEffects'
import { parseEncounterZone } from '#shared/moveAutomation/encounterZones'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
  type EncounterSettlementCleanupEntry,
  type EncounterSettlementDocument,
} from '#shared/encounterSettlement/document'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { applyCombatStagesToSheet } from '~/utils/sheetMutations'
import {
  applyEncounterSettlementTemporaryCleanupPlan,
  ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS,
  EncounterSettlementCleanupError,
  planEncounterSettlementTemporaryCleanup,
  type EncounterSettlementCleanupAuthoritySnapshot,
} from '../../server/domain/encounterSettlement/temporaryCleanup'

const mapAuthority = { kind: 'map' as const, id: 'cleanup-arena', revision: 20 }

const effect = (id: string, duration: EncounterEffectDuration) => parseEncounterEffect({
  id,
  kind: 'condition',
  source: { operationId: `operation.${id}`, moveId: 'cleanup-fixture', placementId: 'token-a' },
  affected: { placementIds: ['token-a'], sideIds: [], cells: [] },
  createdRound: 2,
  createdTurn: 3,
  duration,
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['temporary', 'cleanup-fixture'],
  payload: { conditionId: 'sleep', action: 'apply', saveTiming: 'end-turn' },
  dispel: { policy: 'matching-tags', tags: ['cleanup-fixture'] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
})

const zone = (id: string, duration: EncounterEffectDuration) => parseEncounterZone({
  id,
  kind: 'smoke',
  source: { kind: 'operation', operationId: `operation.${id}`, moveId: 'cleanup-zone', placementId: 'token-a' },
  sideId: null,
  geometry: { kind: 'cells', cells: [{ x: 2, y: 0, z: 2 }] },
  layer: 1,
  duration,
  stacking: { kind: 'independent', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['cleanup-fixture'],
  payload: { smokeId: 'cleanup-smoke' },
})

const pokemonSheet = (): CharacterSheet => {
  const base = {
    slug: 'mon-a',
    species: 'Pikachu',
    nickname: 'Sparky',
    level: 20,
    revision: 4,
    updatedAt: 800,
    combat: { currentHp: 17, injuries: 2, conditions: ['Poisoned'] },
    stats: {
      atk: { stage: 0 }, def: { stage: 0 }, satk: { stage: 0 },
      sdef: { stage: 0 }, spd: { stage: 0 },
    },
    combatStages: { acc: 0 },
    movelist: [],
  }
  return applyCombatStagesToSheet('pokemon', base as never, {
    atk: 3, def: -2, satk: 1, sdef: 0, spd: -1, acc: 2,
  }) as unknown as CharacterSheet
}

const map = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'cleanup-arena',
  name: 'Cleanup Arena',
  revision: 20,
  updatedAt: 900,
  dimensions: { x: 8, y: 3, z: 8 },
  voxels: [],
  placements: [{
    id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'mon-a',
    position: { x: 1, y: 0, z: 1 }, initiative: 12,
  }],
  initiative: { activeId: 'token-a', round: 4, manualOrderIds: ['token-a'] },
  encounterState: {
    ...createEmptyEncounterState(),
    effects: [
      effect('effect.encounter-a', { kind: 'encounter', remaining: null }),
      effect('effect.scene-a', { kind: 'scene', remaining: null }),
    ],
    zones: [
      zone('zone.round-a', { kind: 'rounds', boundary: 'end', remaining: 2 }),
      zone('zone.scene-a', { kind: 'scene', remaining: null }),
    ],
    groundItems: [{
      id: 'ground-potion-a',
      canonicalItemId: 'potion',
      canonicalItemName: 'Potion',
      quantity: 2,
      position: { x: 3, y: 0, z: 3 },
      sourceResource: { kind: 'group-inventory', slug: 'main', revision: 3 },
      sourceOperationId: 'op_ground_cleanup_01',
      sideId: null,
      ownerPlacementId: null,
    }],
  },
})

const entry = (
  cleanupId: string,
  kind: EncounterSettlementCleanupEntry['kind'],
  sourceIds: readonly string[],
  behavior: EncounterSettlementCleanupEntry['behavior'],
): EncounterSettlementCleanupEntry => ({
  cleanupId,
  kind,
  authority: mapAuthority,
  participantIds: [],
  sourceIds,
  behavior,
  state: 'ready',
  decisionId: null,
  receiptId: null,
})

const cleanupEntries = (): EncounterSettlementCleanupEntry[] => [
  entry('cleanup-stages', 'combat-stages', ['sheet:pokemon:mon-a'], 'reset'),
  entry('cleanup-effect-encounter', 'temporary-effects', ['effect.encounter-a'], 'expire'),
  entry('cleanup-effect-scene', 'duration-effects', ['effect.scene-a'], 'preserve'),
  entry('cleanup-resources', 'encounter-resources', [ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.encounterResources], 'reset'),
  entry('cleanup-zone-round', 'zones', ['zone.round-a'], 'expire'),
  entry('cleanup-zone-scene', 'zones', ['zone.scene-a'], 'preserve'),
  entry('cleanup-ground', 'ground-items', ['ground-potion-a'], 'preserve'),
  entry('cleanup-initiative', 'initiative', [ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.initiative], 'reset'),
]

const settlement = (
  entries: readonly EncounterSettlementCleanupEntry[] = cleanupEntries(),
  overrides: Partial<EncounterSettlementDocument> = {},
): EncounterSettlementDocument => parseEncounterSettlementDocument({
  ...createEncounterSettlementDocument({
    settlementId: 'encounter-settlement:v1:00000000000000000000000000000079',
    rewardPackageId: 'cleanup-rewards-a',
    encounter: {
      encounterId: 'encounter-cleanup-a', encounterRevision: 12,
      linkedMapSlug: 'cleanup-arena', linkedMapRevision: 20, campaignMinute: 480,
    },
  }),
  temporaryCleanup: entries,
  ...overrides,
})

const authority = (
  overrides: Partial<EncounterSettlementCleanupAuthoritySnapshot> = {},
): EncounterSettlementCleanupAuthoritySnapshot => ({
  completeness: 'authoritative-current',
  map: map(),
  sheetsComplete: true,
  sheets: [{ kind: 'pokemon', slug: 'mon-a', revision: 4, document: pokemonSheet() }],
  activeReservationOperationIds: [],
  transformationsComplete: true,
  transformations: [],
  authorization: { status: 'allowed', authority: mapAuthority, reasonId: null },
  writeTimestamp: 1_000,
  ...overrides,
})

describe('encounter settlement temporary cleanup', () => {
  it('reuses encounter lifecycle authority, resets stages/resources/initiative, and preserves durable state', () => {
    const currentAuthority = authority()
    const plan = planEncounterSettlementTemporaryCleanup({ settlement: settlement(), authority: currentAuthority })

    expect(plan.complete).toBe(true)
    expect(plan.blockers).toEqual([])
    expect(plan.lifecycle?.events).toEqual([
      expect.objectContaining({ kind: 'encounter-end', reasonCode: 'encounter.end.completed' }),
    ])
    expect(plan.previews).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'effect.encounter-a', action: 'expire', changed: true }),
      expect.objectContaining({ sourceId: 'effect.scene-a', action: 'preserve', changed: false }),
      expect.objectContaining({ sourceId: 'zone.round-a', action: 'expire', changed: true }),
      expect.objectContaining({ sourceId: 'ground-potion-a', action: 'preserve', changed: false }),
      expect.objectContaining({ sourceId: 'sheet:pokemon:mon-a', action: 'reset', changed: true }),
    ]))
    expect(plan.mapWrite).toMatchObject({ mapSlug: 'cleanup-arena', expectedRevision: 20, revision: 21 })
    expect(plan.mapWrite?.nextMap.initiative).toEqual({ activeId: null, round: 1 })
    expect(plan.mapWrite?.nextMap.placements[0]?.initiative).toBeUndefined()
    expect(plan.mapWrite?.nextMap.encounterState?.effects.map(row => row.id)).toEqual(['effect.scene-a'])
    expect(plan.mapWrite?.nextMap.encounterState?.zones.map(row => row.id)).toEqual(['zone.scene-a'])
    expect(plan.mapWrite?.nextMap.encounterState?.groundItems.map(row => row.id)).toEqual(['ground-potion-a'])
    expect(plan.mapWrite?.nextMap.encounterState?.turnResources).toEqual({})
    expect(plan.sheetWrites).toHaveLength(1)
    expect(plan.sheetWrites[0]).toMatchObject({
      kind: 'pokemon', slug: 'mon-a', expectedRevision: 4, revision: 5,
      changedFields: ['combatStages'],
    })
    expect((plan.sheetWrites[0]!.nextSheet as any).combat.currentHp).toBe(17)
    expect((plan.sheetWrites[0]!.nextSheet as any).combat.injuries).toBe(2)
    expect((plan.sheetWrites[0]!.nextSheet as any).combat.conditions).toEqual(['Poisoned'])
    expect((plan.sheetWrites[0]!.nextSheet as any).stats.atk.stage).toBe(0)
    expect((plan.sheetWrites[0]!.nextSheet as any).combatStages.acc).toBe(0)

    expect(applyEncounterSettlementTemporaryCleanupPlan({ plan, currentAuthority })).toEqual({
      mapWrite: plan.mapWrite,
      sheetWrites: plan.sheetWrites,
    })
    const replay = planEncounterSettlementTemporaryCleanup({ settlement: settlement(), authority: currentAuthority })
    expect(replay.authorityDefinitionSha256).toBe(plan.authorityDefinitionSha256)
    expect(replay.mapWrite).toEqual(plan.mapWrite)
    expect(replay.sheetWrites).toEqual(plan.sheetWrites)
  })

  it('supports exact provider-bound zone transforms and explicit ground-item expiry', () => {
    const entries = cleanupEntries().map(row => {
      if (row.cleanupId === 'cleanup-zone-scene') return { ...row, behavior: 'transform' as const }
      if (row.cleanupId === 'cleanup-ground') return { ...row, behavior: 'expire' as const }
      return row
    })
    const transformedZone = zone('zone.scene-a', { kind: 'permanent', remaining: null })
    const currentAuthority = authority({
      transformations: [{
        cleanupId: 'cleanup-zone-scene',
        sourceId: 'zone.scene-a',
        kind: 'zone',
        authority: { kind: 'effect', id: 'zone-transform-provider-a', revision: 20 },
        nextZone: transformedZone,
      }],
    })
    const plan = planEncounterSettlementTemporaryCleanup({ settlement: settlement(entries), authority: currentAuthority })

    expect(plan.complete).toBe(true)
    expect(plan.mapWrite?.nextMap.encounterState?.zones).toEqual([transformedZone])
    expect(plan.mapWrite?.nextMap.encounterState?.groundItems).toEqual([])
    expect(plan.previews).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'zone.scene-a', action: 'transform', changed: true }),
      expect.objectContaining({ sourceId: 'ground-potion-a', action: 'expire', changed: true }),
    ]))
  })

  it('keeps active reservations and open decisions visible and exposes no applicable writes', () => {
    const reservationId = 'item-operation:pending-cleanup-a'
    const reservationEntry = entry('cleanup-reservation', 'reservations', [reservationId], 'expire')
    const openEntry: EncounterSettlementCleanupEntry = {
      ...cleanupEntries().find(row => row.cleanupId === 'cleanup-ground')!,
      behavior: 'require-decision',
      state: 'proposed',
      decisionId: 'cleanup-ground-decision',
    }
    const entries = [
      ...cleanupEntries().filter(row => row.cleanupId !== 'cleanup-ground'),
      openEntry,
      reservationEntry,
    ]
    const base = settlement()
    const withDecision = parseEncounterSettlementDocument({
      ...base,
      temporaryCleanup: entries,
      decisions: [{
        decisionId: 'cleanup-ground-decision',
        kind: 'cleanup', audience: 'gm', status: 'open',
        subjects: [{ kind: 'cleanup', id: 'cleanup-ground' }],
        options: [{
          optionId: 'cleanup-ground-preserve', effect: 'accept', valueId: 'preserve', authority: null,
        }],
        selectedOptionId: null, decidedBy: null, decidedAtCampaignMinute: null,
      }],
    })
    const plan = planEncounterSettlementTemporaryCleanup({
      settlement: withDecision,
      authority: authority({ activeReservationOperationIds: [reservationId] }),
    })

    expect(plan.complete).toBe(false)
    expect(plan.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'active-reservation', sourceId: reservationId }),
      expect.objectContaining({ kind: 'open-decision', cleanupId: 'cleanup-ground' }),
    ]))
    expect(plan.mapWrite).toBeNull()
    expect(plan.sheetWrites).toEqual([])
    expect(plan.lifecycle).toBeNull()
    expect(() => applyEncounterSettlementTemporaryCleanupPlan({
      plan,
      currentAuthority: authority({ activeReservationOperationIds: [reservationId] }),
    })).toThrow(/complete cleanup authority changed before application/)
  })

  it('fails closed for missing coverage, duplicate sources, duration conflicts, stale authority, and terminal state', () => {
    expect(() => planEncounterSettlementTemporaryCleanup({
      settlement: settlement(cleanupEntries().filter(row => row.cleanupId !== 'cleanup-zone-round')),
      authority: authority(),
    })).toThrow(/must appear exactly once/)

    expect(() => planEncounterSettlementTemporaryCleanup({
      settlement: settlement([...cleanupEntries(), entry('duplicate-ground', 'ground-items', ['ground-potion-a'], 'preserve')]),
      authority: authority(),
    })).toThrow(/owned by exactly one cleanup entry/)

    const invalidPreserve = cleanupEntries().map(row => row.cleanupId === 'cleanup-effect-encounter'
      ? { ...row, behavior: 'preserve' as const } : row)
    expect(() => planEncounterSettlementTemporaryCleanup({
      settlement: settlement(invalidPreserve), authority: authority(),
    })).toThrow(/cannot be preserved after encounter end/)

    const currentAuthority = authority()
    const plan = planEncounterSettlementTemporaryCleanup({ settlement: settlement(), authority: currentAuthority })
    expect(() => applyEncounterSettlementTemporaryCleanupPlan({
      plan,
      currentAuthority: authority({ map: { ...map(), revision: 21 } }),
    })).toThrowError(EncounterSettlementCleanupError)

    expect(() => planEncounterSettlementTemporaryCleanup({
      settlement: settlement(cleanupEntries(), { status: 'committing' }), authority: authority(),
    })).toThrow(/cannot re-plan temporary cleanup/)
  })
})
