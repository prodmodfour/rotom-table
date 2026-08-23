import { describe, expect, it, vi } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseExecuteEquipmentActionCommand } from '#shared/itemAutomation/equipmentActions'
import {
  parseItemGuidedAdjudicationCommand,
  parseItemGuidedAdjudicationProjection,
} from '#shared/itemAutomation/guidedAdjudication'
import {
  addSnagBallConversion,
  initialSnagMachineState,
  parseSnagMachineState,
  resolveSnagBallForThrow,
} from '#shared/itemAutomation/snagMachine'
import { buildEncounterPresentationProjection } from '~~/server/domain/encounterPresentation/buildProjection'
import { executeDeferredEquipmentActionMechanic } from '~~/server/domain/itemAutomation/deferredEquipmentActions'
import { createEncounterEquipmentGrantQueries } from '~~/server/domain/moveAutomation/equipmentGrantQueries'
import {
  largeSnagMachineInventorySources,
  snagBallInventoryChoices,
} from '~~/server/domain/itemAutomation/snagMachine'
import { equipmentGrantDefinitionFor } from '~~/server/domain/itemAutomation/equipmentGrantRegistry'
import { executeEquipmentActionUseCase } from '~~/server/useCases/executeEquipmentAction'
import {
  loadItemGuidedAdjudicationUseCase,
  manageItemGuidedAdjudicationUseCase,
} from '~~/server/useCases/manageItemGuidedAdjudication'
import { openRotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteItemGuidedRequestRepository } from '~~/server/storage/itemGuidedRequestRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import type { TrainerSheet } from '~/types/trainerSheet'
import { parsePlayerProfileId, sanitizePlayerProfileDisplayName } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'
import { activeEquipmentState } from '../fixtures/equipment'

const actorSlug = 'snag-machine-trainer'

const fixture = (variant: 'portable' | 'large' = 'portable', trainerOverrides: Partial<TrainerSheet> = {}) => {
  const equipmentState = variant === 'portable' ? activeEquipmentState({
    ownerKind: 'trainer', ownerSlug: actorSlug, slotId: 'accessory', canonicalItemId: 'Snag Machine',
  }) : undefined
  const actor: TrainerSheet = {
    slug: actorSlug,
    name: 'Snag Operator',
    level: 12,
    revision: 3,
    inventory: {
      equipment: variant === 'large' ? [{ id: 'large-snag-machine', name: 'Snag Machine', qty: 1 }] : [],
      pokeBalls: [{ id: 'basic-ball-row', name: 'Basic Ball', qty: 6, mod: '0' }],
    },
    ...(equipmentState ? { equipmentState } : {}),
    ...trainerOverrides,
  }
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `snag-${variant}-map`,
    name: `Snag ${variant}`,
    revision: 7,
    dimensions: { x: 8, y: 3, z: 8 },
    playerVisible: true,
    voxels: [],
    placements: [{
      id: 'snag-actor', sheetKind: 'trainer', sheetSlug: actor.slug, position: { x: 0, y: 0, z: 0 },
    }],
    initiative: { activeId: 'snag-actor', round: 1 },
    encounterState: createEmptyEncounterState(),
  }
  const projection = buildEncounterPresentationProjection({
    role: 'gm', map, mapRevision: 7, pokemonSheets: [], trainerSheets: [actor], generatedAt: 100,
  })
  const offer = projection.offers.find(candidate => (
    candidate.intent.actionId === 'equipment.snag-machine.convert'
    && (variant === 'large' ? candidate.source.displayName === 'Large Snag Machine' : true)
  ))!
  const ball = snagBallInventoryChoices(actor)[0]!
  const source = variant === 'portable'
    ? createEncounterEquipmentGrantQueries({
        map, sheets: [{ kind: 'trainer', slug: actor.slug, sheet: actor }],
      }).resolve('snag-actor')!.active.find(entry => (
        entry.grant.kind === 'action' && entry.grant.actionId === 'equipment.snag-machine.convert'
      ))!
    : (() => {
        const machine = largeSnagMachineInventorySources(actor)[0]!
        const grant = equipmentGrantDefinitionFor('Snag Machine')!.grants.find(candidate => (
          candidate.kind === 'action' && candidate.actionId === 'equipment.snag-machine.convert'
        ))!
        return {
          grant,
          instanceId: machine.sourceInstanceId,
          instanceRevision: actor.revision!,
          canonicalItemId: 'Snag Machine',
        }
      })()
  const command = parseExecuteEquipmentActionCommand({
    schemaVersion: 1,
    operationId: `equipment-snag-${variant}-operation`,
    offerId: offer.offerId,
    mapSlug: map.slug,
    baseRevision: 7,
    actorPlacementId: 'snag-actor',
    actionId: 'equipment.snag-machine.convert',
    equipmentInstanceId: source.instanceId,
    equipmentInstanceRevision: source.instanceRevision,
    targetEquipmentInstanceId: null,
    targetEquipmentInstanceRevision: null,
    targetPlacementIds: [],
    cells: [],
    inventorySourceInstanceId: ball.option.sourceInstanceId,
    skillCheckId: null,
    gmAdjudication: null,
  })
  return { variant, actor, map, projection, offer, ball, source, command }
}

const pure = (input: ReturnType<typeof fixture>, campaignMinute = 0) => executeDeferredEquipmentActionMechanic({
  command: input.command,
  source: input.source,
  map: input.map,
  actorPlacement: input.map.placements[0]!,
  actorSheet: input.actor,
  pokemonSheets: new Map(),
  trainerSheets: new Map([[input.actor.slug, input.actor]]),
  rollD20: () => { throw new Error('Snag conversion declaration must not roll.') },
  equipmentGrantsForPlacement: placementId => createEncounterEquipmentGrantQueries({
    map: input.map,
    sheets: [{ kind: 'trainer', slug: input.actor.slug, sheet: input.actor }],
  }).resolve(placementId),
  campaignClock: { revision: 0, campaignMinute },
})

const seed = (input: ReturnType<typeof fixture>) => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  createSqliteMapRepository<TabletopMap>(database).save({
    slug: input.map.slug, document: input.map, revision: 7, updatedAt: 1,
  })
  createSqliteSheetRepository<Record<string, unknown>>(database).save({
    kind: 'trainer', slug: input.actor.slug,
    document: input.actor as unknown as Record<string, unknown>, revision: 3, updatedAt: 1,
  })
  return database
}

const resolution = (requestId: string, digit: string, decision: 'approve' | 'deny' = 'approve') => ({
  schemaVersion: 1,
  operationId: `item-guided-operation:v1:${digit.repeat(32)}`,
  action: 'resolve-snag-conversion',
  requestId,
  expectedRevision: 0,
  decision,
  gmNote: decision === 'approve' ? 'Private bounded legality approval' : 'Private denial evidence',
}) as const

describe('P11-040 Snag Machine conversion', () => {
  it('parses only the strict bounded private settlement and Snag state contracts', () => {
    const command = resolution(`item-guided:v1:${'a'.repeat(32)}`, '1')
    expect(parseItemGuidedAdjudicationCommand(command)).toEqual(command)
    expect(() => parseItemGuidedAdjudicationCommand({ ...command, decision: 'maybe' })).toThrow('must be approve or deny')
    expect(() => parseItemGuidedAdjudicationCommand({ ...command, leakedSourceId: 'private' })).toThrow('invalid shape')
    expect(() => parseItemGuidedAdjudicationCommand({ ...command, gmNote: 'x\nforged' })).toThrow('non-empty trimmed text')
    expect(() => parseSnagMachineState({
      schemaVersion: 1, revision: 0, conversions: [{
        conversionId: `snag-conversion:v1:${'b'.repeat(32)}`,
        variant: 'large',
        machineSourceInstanceId: 'item-inventory-instance:forged',
        ballSourceInstanceId: 'item-instance:trainer:actor:pokeBalls:row',
        ballCanonicalItemId: 'Basic Ball', campaignDayIndex: 0,
        declarationRound: null, readyRound: null, expiresAfterRound: null,
        approvedOperationId: 'item-guided-operation:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', gmLegalityNote: null,
      }], history: [],
    })).toThrow('private exact equipment or inventory source identity')
  })

  it.each(['portable', 'large'] as const)('projects and declares one role-safe %s conversion without rolling', (variant) => {
    const input = fixture(variant)
    expect(input.offer).toMatchObject({
      availability: { status: 'available' },
      intent: { actionId: 'equipment.snag-machine.convert' },
      targeting: [expect.objectContaining({ kind: 'item', minSelections: 1, maxSelections: 1 })],
      selectionOptions: [expect.objectContaining({ kind: 'object', label: 'Basic Ball' })],
    })
    const publicJson = JSON.stringify(input.projection)
    expect(publicJson).not.toContain(input.source.instanceId)
    expect(publicJson).not.toContain(input.ball.option.sourceInstanceId)
    const result = pure(input)
    expect(result).toMatchObject({ status: 'guided-pending', rolls: [] })
    expect(result.receipts.map(receipt => receipt.kind)).toEqual([
      'item-declaration', 'inventory-conversion', 'duration-effect', 'gm-legality', 'accepted-result',
    ])
    expect(result.snagDeclaration).toMatchObject({
      variant,
      ballCanonicalItemId: 'Basic Ball',
      declarationRound: variant === 'portable' ? 1 : null,
      campaignDayIndex: 0,
    })
  })

  it.each(['portable', 'large'] as const)('persists and approves a private exact %s conversion with exact retry', (variant) => {
    const input = fixture(variant)
    const database = seed(input)
    try {
      const randomInt = vi.fn(() => { throw new Error('Snag conversion rolled unexpectedly.') })
      const declared = executeEquipmentActionUseCase({ role: 'gm', command: input.command }, {
        database, randomInt, now: () => 200,
      })
      expect(declared).toMatchObject({ status: 'guided-pending', mapRevision: 8, exactReplay: false })
      const declarationEvents = createSqliteRealtimeEventRepository({ database })
        .readAfter({ afterSequence: 0, limit: 100 }).events
      expect(executeEquipmentActionUseCase({ role: 'gm', command: input.command }, {
        database, randomInt, now: () => 200,
      })).toMatchObject({ status: 'guided-pending', mapRevision: 8, exactReplay: true })
      expect(randomInt).not.toHaveBeenCalled()
      expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 100 }).events)
        .toEqual(declarationEvents)
      const requests = createSqliteItemGuidedRequestRepository({ database })
      const pending = requests.listPending()[0]!
      expect(pending).toMatchObject({
        requestKind: 'snag-conversion-adjudication',
        canonicalItemId: 'Snag Machine',
        authority: {
          sourceKind: 'snag-machine-conversion', variant,
          ballCanonicalItemId: 'Basic Ball', declarationRound: variant === 'portable' ? 1 : null,
        },
      })
      const pendingProjection = loadItemGuidedAdjudicationUseCase({ role: 'gm' }, { database })
      expect(pendingProjection.requests).toEqual([expect.objectContaining({
        requestKind: 'snag-conversion-adjudication', targetKindLabel: 'Poké Ball', choices: [],
        resolution: {
          kind: 'snag-conversion',
          decisions: [
            expect.objectContaining({ decision: 'deny', label: 'Deny conversion' }),
            expect.objectContaining({ decision: 'approve', label: 'Approve conversion' }),
          ],
        },
      })])
      const command = resolution(pending.requestId, variant === 'portable' ? '1' : '2')
      const accepted = manageItemGuidedAdjudicationUseCase({ role: 'gm', command }, {
        database, now: () => 201,
      })
      expect(accepted).toMatchObject({
        result: { exactReplay: false, request: { status: 'accepted', revision: 1 } },
      })
      expect(() => parseItemGuidedAdjudicationProjection({
        schemaVersion: 1,
        requests: [accepted.result.request],
        reBreatherOffers: [],
      })).not.toThrow()
      const realtimeEvents = createSqliteRealtimeEventRepository({ database })
        .readAfter({ afterSequence: 0, limit: 100 }).events
      const roleSafeJson = JSON.stringify([
        pendingProjection,
        ...realtimeEvents.filter(event => event.access.kind === 'map-access'),
      ])
      expect(roleSafeJson).not.toContain(input.source.instanceId)
      expect(roleSafeJson).not.toContain(input.ball.option.sourceInstanceId)
      const realtimeJson = JSON.stringify(realtimeEvents)
      expect(realtimeJson).not.toContain('Private bounded legality approval')
      expect(realtimeJson).not.toContain('snag-conversion:v1:')
      const stored = createSqliteSheetRepository<Record<string, unknown>>(database)
        .getByRef('trainer', input.actor.slug)!
      const state = parseSnagMachineState((stored.sheet as unknown as TrainerSheet).serverPrivate?.snagMachine)
      expect(state).toMatchObject({
        revision: 1,
        conversions: [{
          variant,
          ballCanonicalItemId: 'Basic Ball',
          readyRound: variant === 'portable' ? 2 : null,
          expiresAfterRound: variant === 'portable' ? 2 : null,
          gmLegalityNote: 'Private bounded legality approval',
        }],
        history: [{ kind: 'converted', variant }],
      })
      expect(manageItemGuidedAdjudicationUseCase({ role: 'gm', command }, {
        database, now: () => 202,
      })).toMatchObject({ result: { exactReplay: true, request: { status: 'accepted' } } })
      expect(parseSnagMachineState((createSqliteSheetRepository<Record<string, unknown>>(database)
        .getByRef('trainer', input.actor.slug)!.sheet as unknown as TrainerSheet).serverPrivate?.snagMachine).revision).toBe(1)
    }
    finally { database.close() }
  })

  it('denies without conversion and enforces the Portable one-round delay and one-round window', () => {
    const input = fixture('portable')
    const database = seed(input)
    try {
      executeEquipmentActionUseCase({ role: 'gm', command: input.command }, { database, now: () => 200 })
      const pending = createSqliteItemGuidedRequestRepository({ database }).listPending()[0]!
      expect(manageItemGuidedAdjudicationUseCase({
        role: 'gm', command: resolution(pending.requestId, '3', 'deny'),
      }, { database, now: () => 201 })).toMatchObject({
        result: { request: { status: 'accepted', acceptedSummary: expect.stringContaining('denied') } },
      })
      const trainer = createSqliteSheetRepository<Record<string, unknown>>(database)
        .getByRef('trainer', actorSlug)!.sheet as unknown as TrainerSheet
      expect(trainer.serverPrivate?.snagMachine).toBeUndefined()
    }
    finally { database.close() }

    const state = addSnagBallConversion({
      state: initialSnagMachineState(),
      conversion: {
        conversionId: `snag-conversion:v1:${'a'.repeat(32)}`,
        variant: 'portable',
        machineSourceInstanceId: `equipped-item:v1:${'b'.repeat(32)}`,
        ballSourceInstanceId: 'item-instance:trainer:snag-machine-trainer:pokeBalls:basic-ball-row',
        ballCanonicalItemId: 'Basic Ball',
        campaignDayIndex: 0,
        declarationRound: 1,
        readyRound: 2,
        expiresAfterRound: 2,
        approvedOperationId: 'item-guided-operation:v1:33333333333333333333333333333333',
        gmLegalityNote: null,
      },
      historyId: `snag-history:v1:${'c'.repeat(32)}`,
    })
    const resolve = (round: number) => resolveSnagBallForThrow({
      state,
      ballSourceInstanceId: state.conversions[0]!.ballSourceInstanceId,
      currentRound: round,
      operationId: 'op_snag_window_test',
      historyIdFor: () => `snag-history:v1:${'d'.repeat(32)}`,
    })
    expect(resolve(1).kind).toBe('blocked')
    expect(resolve(2).kind).toBe('snag-ball')
    expect(resolve(3)).toMatchObject({ kind: 'ordinary', state: { conversions: [] } })
  })

  it('requires GM settlement and rolls an injected post-sheet failure back for an exact retry', () => {
    const input = fixture('large')
    const database = seed(input)
    try {
      executeEquipmentActionUseCase({ role: 'gm', command: input.command }, { database, now: () => 200 })
      const repository = createSqliteItemGuidedRequestRepository({ database })
      const pending = repository.listPending()[0]!
      const command = resolution(pending.requestId, '4')
      const playerProfile = {
        schemaVersion: 1 as const,
        id: parsePlayerProfileId('profile_snag0000'),
        displayName: sanitizePlayerProfileDisplayName('Snag Player'),
        linkedCharacters: [{ sheetKind: 'trainer' as const, sheetSlug: actorSlug }],
      }
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'player', playerProfile, command }, { database }))
        .toThrow('GM authorization is required')
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command }, {
        database,
        failAfterWrite: stage => { if (stage === 'equipment-sheet') throw new Error('injected Snag rollback') },
      })).toThrow('injected Snag rollback')
      expect(repository.get(pending.requestId)).toMatchObject({ status: 'pending', revision: 0 })
      expect((createSqliteSheetRepository<Record<string, unknown>>(database)
        .getByRef('trainer', actorSlug)!.sheet as unknown as TrainerSheet).serverPrivate?.snagMachine).toBeUndefined()
      expect(manageItemGuidedAdjudicationUseCase({ role: 'gm', command }, { database }))
        .toMatchObject({ result: { exactReplay: false, request: { status: 'accepted' } } })
    }
    finally { database.close() }
  })

  it('fails closed when exact custody, declaration round, or campaign day changes', () => {
    const staleSheetInput = fixture('large')
    const staleSheetDb = seed(staleSheetInput)
    try {
      executeEquipmentActionUseCase({ role: 'gm', command: staleSheetInput.command }, { database: staleSheetDb, now: () => 200 })
      const pending = createSqliteItemGuidedRequestRepository({ database: staleSheetDb }).listPending()[0]!
      const sheets = createSqliteSheetRepository<Record<string, unknown>>(staleSheetDb)
      const stored = sheets.getByRef('trainer', actorSlug)!
      expect(sheets.applyLivePlayUpdate({
        kind: 'trainer', slug: actorSlug, expectedRevision: stored.revision,
        nextSheet: { ...stored.sheet, name: 'Changed after declaration' },
      })).toBe('applied')
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command: resolution(pending.requestId, '5') }, { database: staleSheetDb }))
        .toThrow('Trainer sheet changed after declaration')
    }
    finally { staleSheetDb.close() }

    const roundInput = fixture('portable')
    const roundDb = seed(roundInput)
    try {
      executeEquipmentActionUseCase({ role: 'gm', command: roundInput.command }, { database: roundDb, now: () => 200 })
      const pending = createSqliteItemGuidedRequestRepository({ database: roundDb }).listPending()[0]!
      const maps = createSqliteMapRepository<TabletopMap>(roundDb)
      const stored = maps.getBySlug(roundInput.map.slug)!
      expect(maps.applyLivePlayUpdate({
        slug: stored.slug,
        expectedRevision: stored.revision ?? 8,
        nextMap: { ...stored, revision: (stored.revision ?? 8) + 1, initiative: { activeId: 'snag-actor', round: 2 } },
      })).toBe('applied')
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command: resolution(pending.requestId, '6') }, { database: roundDb }))
        .toThrow('did not settle in its declaration round')
    }
    finally { roundDb.close() }

    const dayInput = fixture('large')
    const dayDb = seed(dayInput)
    try {
      executeEquipmentActionUseCase({ role: 'gm', command: dayInput.command }, { database: dayDb, now: () => 200 })
      const pending = createSqliteItemGuidedRequestRepository({ database: dayDb }).listPending()[0]!
      dayDb.connection.exec('PRAGMA foreign_keys = OFF')
      try {
        dayDb.connection.prepare(`
          UPDATE campaign_clock
          SET revision = 1, campaign_minute = 1440,
            last_operation_id = 'breeding-operation:v1:dddddddddddddddddddddddddddddddd'
          WHERE singleton = 1 AND revision = 0
        `).run()
      }
      finally { dayDb.connection.exec('PRAGMA foreign_keys = ON') }
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command: resolution(pending.requestId, '7') }, { database: dayDb }))
        .toThrow('crossed a campaign-day boundary')
    }
    finally { dayDb.close() }
  })

  it('enforces five permanent conversions per exact Large machine per campaign day', () => {
    const base = fixture('large')
    let state = initialSnagMachineState()
    for (let index = 0; index < 5; index += 1) {
      state = addSnagBallConversion({
        state,
        conversion: {
          conversionId: `snag-conversion:v1:${index.toString(16).padStart(32, '0')}`,
          variant: 'large',
          machineSourceInstanceId: base.source.instanceId,
          ballSourceInstanceId: base.ball.option.sourceInstanceId,
          ballCanonicalItemId: 'Basic Ball',
          campaignDayIndex: 0,
          declarationRound: null,
          readyRound: null,
          expiresAfterRound: null,
          approvedOperationId: `snag-large-approval-${index}`,
          gmLegalityNote: null,
        },
        historyId: `snag-history:v1:${(index + 20).toString(16).padStart(32, '0')}`,
      })
    }
    const saturated = fixture('large', {
      serverPrivate: { snagMachine: state },
      inventory: {
        equipment: [{ id: 'large-snag-machine', name: 'Snag Machine', qty: 1 }],
        pokeBalls: [{ id: 'basic-ball-row', name: 'Basic Ball', qty: 6, mod: '0' }],
      },
    })
    expect(() => pure(saturated)).toThrowError(expect.objectContaining({ code: 'snag-machine.large-daily-limit' }))
    expect(pure(saturated, 1_440).snagDeclaration).toMatchObject({ variant: 'large', campaignDayIndex: 1 })
  })
})
