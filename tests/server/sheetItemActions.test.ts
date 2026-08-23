import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { loadSheetItemActionsUseCase } from '../../server/useCases/loadSheetItemActions'
import { declareSheetItemActionUseCase } from '../../server/useCases/declareSheetItemAction'
import { executeItemOperationUseCase } from '../../server/useCases/executeItemOperation'
import { itemCommandFromAuthorizedSheetAction, sheetItemTargetId } from '#shared/itemAutomation/sheetActions'
import { createEmptySheetEquipmentState } from '#shared/itemAutomation/equipment'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { PlayerProfile } from '#shared/playerProfiles'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length) databases.pop()!.close()
})

const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3, currentTeam: ['pikachu'],
  inventory: {
    medicalKit: [
      { id: 'potion-row', name: 'Potion', qty: 2 },
      { id: 'antidote-row', name: 'Antidote', qty: 1 },
      { id: 'x-attack-row', name: 'X Attack', qty: 1 },
    ],
  },
})
const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', level: 5, revision: 2,
  stats: { hp: { added: 0 } }, combat: { currentHp: 7 },
  ...overrides,
})
const playerProfile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_fixture01',
  displayName: 'Player',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
})

const seed = (database: RotomDatabase, trainerDocument: TrainerSheet = trainer()): void => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({
    kind: 'trainer', slug: 'ash', revision: 3, updatedAt: 10,
    document: trainerDocument as unknown as Record<string, unknown>,
  })
  sheets.save({
    kind: 'pokemon', slug: 'pikachu', revision: 2, updatedAt: 10,
    document: pokemon() as unknown as Record<string, unknown>,
  })
}

const declarePotion = (database: RotomDatabase) => {
  const projection = loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })
  const potionOffer = projection.offers.find(offer => offer.source.canonicalId === 'Potion')!
  const declared = declareSheetItemActionUseCase({
    role: 'gm',
    intent: {
      schemaVersion: 1, trainerSlug: 'ash', trainerRevision: projection.trainerRevision,
      offerId: potionOffer.offerId, action: 'use',
    },
  }, { database, now: () => 100 })
  return { projection, potionOffer, declared }
}

describe('Trainer sheet item actions', () => {
  it('projects common use and inspect actions with exact source, legal targets, previews, and unavailable reasons', () => {
    const database = open()
    seed(database)
    const projection = loadSheetItemActionsUseCase({
      role: 'player', playerProfile: playerProfile(), trainerSlug: 'ash',
    }, { database, now: () => 100 })

    expect(projection).toMatchObject({ schemaVersion: 1, trainerSlug: 'ash', trainerRevision: 3, generatedAt: 100 })
    const potion = projection.offers.find(offer => offer.source.canonicalId === 'Potion')!
    expect(potion).toMatchObject({
      actor: { label: 'Ash', sheetSlug: 'ash', revision: 3 },
      source: {
        containerKind: 'trainer', containerLabel: 'Trainer inventory', displayName: 'Potion',
        sectionLabel: 'Medical Kit', rowIndex: 0, rowLabel: 'Row 1', quantity: 2,
        sourceSelectionId: expect.any(String),
      },
      timingLabel: 'Outside encounter', acceptanceNotice: 'Consumes 1 when accepted.',
      availability: { enabled: true, unavailableReason: null },
      actions: [
        { kind: 'use', enabled: true },
        { kind: 'inspect', enabled: true, href: '/items/Potion' },
      ],
    })
    expect(potion).not.toHaveProperty('source.rowId')
    expect(potion).not.toHaveProperty('source.instanceId')
    expect(JSON.stringify(projection)).not.toContain('potion-row')
    expect(potion.targeting?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: sheetItemTargetId('pokemon', 'pikachu'), label: 'Pikachu', enabled: true,
        summary: expect.stringMatching(/^HP 7 \/ /),
        previewFacts: expect.arrayContaining([
          expect.objectContaining({ label: 'HP after use', value: expect.stringMatching(/^7 → /), tone: 'positive' }),
          expect.objectContaining({ label: 'Restores', value: '+20 HP', tone: 'positive' }),
        ]),
      }),
      expect.objectContaining({ sheetKind: 'trainer', sheetSlug: 'ash', enabled: false }),
    ]))

    const antidote = projection.offers.find(offer => offer.source.canonicalId === 'Antidote')!
    expect(antidote.availability).toMatchObject({
      enabled: false,
      unavailableReason: { code: 'target.invalid', label: expect.stringContaining('No legal target') },
    })
    const xAttack = projection.offers.find(offer => offer.source.canonicalId === 'X Attack')!
    expect(xAttack.actions.find(action => action.kind === 'use')).toMatchObject({
      enabled: false,
      unavailableReason: { code: 'action.unsupported', label: 'No reviewed common sheet action is available for this item.' },
    })
    expect(xAttack.actions.find(action => action.kind === 'inspect')).toMatchObject({ enabled: true })
  })

  it('routes reviewed native equipment mechanics to the live encounter instead of calling them unsupported', () => {
    const database = open()
    const base = trainer()
    seed(database, {
      ...base,
      inventory: {
        ...base.inventory,
        equipment: [{ id: 'glue-cannon-row', name: 'Glue Cannon' }],
      },
      equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' }),
    })
    const projection = loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })
    const glue = projection.offers.find(offer => offer.source.canonicalId === 'Glue Cannon')!
    expect(glue).toMatchObject({
      timingLabel: 'Live encounter',
      description: 'Reviewed live encounter actions: Fire Glue Cannon.',
      acceptanceNotice: expect.stringContaining('use Fire Glue Cannon from the live encounter Action Dock'),
      availability: {
        enabled: false,
        unavailableReason: { code: 'action.encounter-only', label: expect.stringContaining('live encounter Action Dock') },
      },
    })
    expect(glue.actions.find(action => action.kind === 'inspect')).toMatchObject({ enabled: true })
    expect(glue.actions.find(action => action.kind === 'use')).toMatchObject({
      enabled: false,
      unavailableReason: { code: 'action.encounter-only' },
    })
    expect(JSON.stringify(projection)).not.toContain('glue-cannon-row')
  })

  it('projects duplicate copies as exact safe rows and declares only the selected private source', () => {
    const database = open()
    const base = trainer()
    seed(database, {
      ...base,
      inventory: {
        ...base.inventory,
        medicalKit: [
          { id: 'potion-row', name: 'Potion', qty: 2 },
          { id: 'antidote-row', name: 'Antidote', qty: 1 },
          { id: 'x-attack-row', name: 'X Attack', qty: 1 },
          { id: 'potion-row-second', name: 'Potion', qty: 1 },
        ],
      },
    })
    const projection = loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })
    const potionOffers = projection.offers.filter(offer => offer.source.canonicalId === 'Potion')
    expect(potionOffers.map(offer => ({
      sourceSelectionId: offer.source.sourceSelectionId,
      rowLabel: offer.source.rowLabel,
      quantity: offer.source.quantity,
    }))).toEqual([
      { sourceSelectionId: expect.any(String), rowLabel: 'Row 1', quantity: 2 },
      { sourceSelectionId: expect.any(String), rowLabel: 'Row 4', quantity: 1 },
    ])
    expect(new Set(potionOffers.map(offer => offer.source.sourceSelectionId)).size).toBe(2)
    expect(JSON.stringify(projection)).not.toContain('potion-row-second')

    const selected = potionOffers[1]!
    const declared = declareSheetItemActionUseCase({
      role: 'gm',
      intent: {
        schemaVersion: 1, trainerSlug: 'ash', trainerRevision: 3,
        offerId: selected.offerId, action: 'use',
      },
    }, { database, now: () => 100 })
    expect(declared.offerId).toBe(selected.offerId)
    expect(declared.source).toMatchObject({ rowIndex: 3, rowLabel: 'Row 4', quantity: 1 })
    expect(declared.itemCommand.source.rowId).toBe('potion-row-second')
  })

  it('shows current exact equipment compatibility reasons and enables legal whole-item rows', () => {
    const database = open()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({
      kind: 'trainer', slug: 'ash', revision: 3, updatedAt: 10,
      document: {
        ...trainer(),
        inventory: { equipment: [
          { id: 'armor-row', name: 'Light Armor' },
          { id: 'focus-row', name: 'Focus' },
        ] },
        equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' }),
      } as unknown as Record<string, unknown>,
    })
    const projection = loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })
    const armor = projection.offers.find(offer => offer.source.canonicalId === 'Light Armor')!
    expect(armor.actions.find(action => action.kind === 'equip')).toEqual({
      kind: 'equip', label: 'Equip', enabled: true, unavailableReason: null, href: null,
    })
    const focus = projection.offers.find(offer => offer.source.canonicalId === 'Focus')!
    expect(focus.actions.find(action => action.kind === 'equip')).toEqual({
      kind: 'equip', label: 'Equip', enabled: true, unavailableReason: null, href: null,
    })
    expect(JSON.stringify(projection)).not.toContain('armor-row')
    expect(JSON.stringify(projection)).not.toContain('focus-row')
  })

  it('authorizes only a controlled Trainer source and issues a fresh complete private read set', () => {
    const database = open()
    seed(database)
    expect(() => loadSheetItemActionsUseCase({ role: 'player', playerProfile: null, trainerSlug: 'ash' }, { database }))
      .toThrow('does not control this Trainer inventory')

    const { projection, declared } = declarePotion(database)
    expect(declared.itemCommand).toMatchObject({
      context: 'sheet', actorParticipantId: null, offerId: declared.offerId,
      actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
      source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
      targetIds: [], choices: [],
      readSet: [
        { kind: 'campaign-clock', id: 'campaign', revision: 0 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
      ],
    })
    expect(projection.offers.every(offer => !Object.hasOwn(offer, 'itemCommand'))).toBe(true)
    const unauthorizedCommand = itemCommandFromAuthorizedSheetAction({
      offer: declared,
      operationId: 'sheet-item:v1:00000000000000000000000000000001',
      targetIds: [sheetItemTargetId('pokemon', 'pikachu')],
    })
    expect(() => executeItemOperationUseCase({ role: 'player', playerProfile: null, command: unauthorizedCommand }, { database }))
      .toThrow('does not control the item actor')
    expect(createSqliteItemOperationRepository({ database }).get(unauthorizedCommand.operationId)).toBeNull()
  })

  it('atomically consumes and heals from a sheet action, publishes both sheets, and exact-replays without map economy', () => {
    const database = open()
    seed(database)
    const { declared } = declarePotion(database)
    const command = itemCommandFromAuthorizedSheetAction({
      offer: declared,
      operationId: 'sheet-item:v1:11111111111111111111111111111111',
      targetIds: [sheetItemTargetId('pokemon', 'pikachu')],
    })
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 100 })
    const first = executeItemOperationUseCase({
      role: 'player', playerProfile: playerProfile(), command, clientId: 'sheet-client',
    }, {
      database, realtimeEventRepository: realtime, now: () => 100,
    })
    expect(first.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Potion', exactReplay: false })
    expect(first.map).toBeUndefined()
    expect(first.sheets.map(sheet => `${sheet.kind}:${sheet.slug}`).sort()).toEqual(['pokemon:pikachu', 'trainer:ash'])
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const acceptedTrainer = sheets.getByRef('trainer', 'ash')!
    const acceptedPokemon = sheets.getByRef('pokemon', 'pikachu')!
    expect((acceptedTrainer.sheet as unknown as TrainerSheet).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect((acceptedPokemon.sheet as unknown as CharacterSheet).combat?.currentHp).toBe(27)
    expect(acceptedTrainer.revision).toBe(4)
    expect(acceptedPokemon.revision).toBe(3)
    const stored = createSqliteItemOperationRepository({ database }).get(command.operationId)!
    expect(stored.plan?.operations.some(operation => operation.aggregate.kind === 'map'
      || operation.aggregate.kind === 'encounter')).toBe(false)
    expect(stored.plan?.operations.some(operation => operation.kind === 'resource')).toBe(false)
    expect(stored.plan?.nonEncounterContext).toMatchObject({
      context: 'sheet',
      campaignTime: { clockRevision: 0, campaignMinute: 0 },
      actor: { sheetKind: 'trainer', sheetSlug: 'ash', sheetRevision: 3 },
      targetAuthorities: expect.arrayContaining([expect.objectContaining({
        targetId: sheetItemTargetId('pokemon', 'pikachu'),
        ownerTrainerSlug: 'ash', authority: 'actor-roster',
      })]),
      extendedAction: { mode: 'immediate', phase: 'completion' },
    })
    expect(stored.plan?.receiptFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ factId: 'non-encounter-context', audience: 'gm' }),
    ]))
    expect(realtime.readAfter({ afterSequence: 0, limit: 10 }).events.map(event => event.event.channel)).toEqual([
      'sheet:pokemon:pikachu', 'sheets', 'sheet:trainer:ash', 'sheets',
    ])

    const replay = executeItemOperationUseCase({
      role: 'player', playerProfile: playerProfile(), command,
    }, { database, now: () => 200 })
    expect(replay.result).toMatchObject({ status: 'accepted', exactReplay: true })
    expect(replay.sheets).toEqual([])
    expect((sheets.getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect((sheets.getByRef('pokemon', 'pikachu')!.sheet as unknown as CharacterSheet).combat?.currentHp).toBe(27)
  })

  it('rejects stale or manufactured sheet target authority before consuming the source', () => {
    const database = open()
    seed(database)
    const { declared } = declarePotion(database)
    const command = itemCommandFromAuthorizedSheetAction({
      offer: declared,
      operationId: 'sheet-item:v1:22222222222222222222222222222222',
      targetIds: [sheetItemTargetId('pokemon', 'pikachu')],
    })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({
      kind: 'pokemon', slug: 'pikachu', revision: 3, updatedAt: 101,
      document: { ...pokemon(), revision: 3, combat: { currentHp: 6 } } as unknown as Record<string, unknown>,
    })
    expect(() => executeItemOperationUseCase({ role: 'gm', command }, { database, now: () => 102 }))
      .toThrow('command authority changed')
    expect((sheets.getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet).inventory?.medicalKit?.[0]?.qty).toBe(2)
    expect(createSqliteItemOperationRepository({ database }).get(command.operationId)).toBeNull()

    sheets.save({
      kind: 'pokemon', slug: 'eevee', revision: 1, updatedAt: 103,
      document: pokemon({ slug: 'eevee', nickname: 'Eevee', species: 'Eevee', revision: 1 }) as unknown as Record<string, unknown>,
    })
    const forged = {
      ...command,
      operationId: 'sheet-item:v1:33333333333333333333333333333333',
      targetIds: [sheetItemTargetId('pokemon', 'eevee')],
      choices: [{ choiceId: 'target', optionIds: [sheetItemTargetId('pokemon', 'eevee')] }],
      readSet: [
        ...command.readSet.filter(ref => ref.kind !== 'sheet' || ref.sheetKind !== 'pokemon'),
        { kind: 'sheet' as const, sheetKind: 'pokemon' as const, id: 'eevee', revision: 1 },
      ],
    }
    expect(() => executeItemOperationUseCase({ role: 'gm', command: forged }, { database, now: () => 104 }))
      .toThrow('command authority changed')
    expect((sheets.getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet).inventory?.medicalKit?.[0]?.qty).toBe(2)
  })

  it('rejects stale declaration revisions without issuing private command authority', () => {
    const database = open()
    seed(database)
    const projection = loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })
    const potion = projection.offers.find(offer => offer.source.canonicalId === 'Potion')!
    expect(() => declareSheetItemActionUseCase({
      role: 'gm', intent: {
        schemaVersion: 1, trainerSlug: 'ash', trainerRevision: 2, offerId: potion.offerId, action: 'use',
      },
    }, { database, now: () => 101 })).toThrow('Trainer inventory changed')
  })
})
