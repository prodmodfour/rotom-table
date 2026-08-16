import { afterEach, describe, expect, it } from 'vitest'
import { createEmptySheetEquipmentState } from '#shared/itemAutomation/equipment'
import { validateInventoryActionDeclarationAgainstOffer } from '#shared/itemAutomation/inventoryActions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteGroupInventoryRepository } from '../../server/storage/groupInventoryRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { loadTrainerInventoryActionsUseCase } from '../../server/useCases/loadTrainerInventoryActions'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => { while (databases.length) databases.pop()!.close() })

const seed = (database: RotomDatabase): void => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const trainer: TrainerSheet = {
    slug: 'ash', name: 'Ash', level: 10, revision: 3, currentTeam: ['pikachu', 'eevee'],
    inventory: {
      medicalKit: [{ id: 'potion-row', name: 'Potion', qty: 3 }],
      equipment: [
        { id: 're-breather-row', name: 'Re-Breather' },
        { id: 'focus-row', name: 'Focus' },
      ],
    },
    equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' }),
  }
  const pikachu: CharacterSheet = {
    slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', level: 5, revision: 2,
    stats: { hp: { added: 0 } }, combat: { currentHp: 7 },
    equipmentState: createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: 'pikachu' }),
  }
  const eevee: CharacterSheet = {
    slug: 'eevee', nickname: 'Eevee', species: 'Eevee', level: 5, revision: 4,
    stats: { hp: { added: 0 } }, combat: { currentHp: 8 },
    equipmentState: createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: 'eevee' }),
  }
  sheets.save({ kind: 'trainer', slug: 'ash', revision: 3, updatedAt: 10, document: trainer as unknown as Record<string, unknown> })
  sheets.save({ kind: 'pokemon', slug: 'pikachu', revision: 2, updatedAt: 10, document: pikachu as unknown as Record<string, unknown> })
  sheets.save({ kind: 'pokemon', slug: 'eevee', revision: 4, updatedAt: 10, document: eevee as unknown as Record<string, unknown> })
  createSqliteGroupInventoryRepository(database).getOrCreate({ now: 10 })
}

const declarationFor = (offer: ReturnType<typeof loadTrainerInventoryActionsUseCase>['offers'][number], destinationId: string, quantity = 1) => ({
  schemaVersion: 1,
  operationId: 'inventory-action:v1:11111111111111111111111111111111',
  offerId: offer.offerId,
  action: offer.action,
  sourceSelectionId: offer.source.sourceSelectionId,
  quantity,
  destinationId,
  confirmationOptionId: null,
  expectedRevisions: [...offer.revisionRequirements, ...offer.destination.options.find(option => option.destinationId === destinationId)!.revisionRequirements]
    .map(row => ({ requirementId: row.requirementId, expectedRevision: row.expectedRevision })),
})

describe('Trainer unified inventory action offers', () => {
  it('projects safe use, equip, give, transfer, and inspect anatomy with exact revisions', () => {
    const database = open()
    seed(database)
    const projection = loadTrainerInventoryActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })

    const potion = projection.offers.filter(offer => offer.source.canonicalItemId === 'Potion')
    expect(potion.map(offer => offer.action)).toEqual(['use', 'transfer', 'split', 'merge', 'discard', 'inspect'])
    const reBreather = projection.offers.filter(offer => offer.source.canonicalItemId === 'Re-Breather')
    expect(reBreather.map(offer => offer.action)).toEqual(['use', 'equip', 'give', 'transfer', 'discard', 'inspect'])
    expect(reBreather.find(offer => offer.action === 'give')).toMatchObject({
      enabled: true,
      source: {
        containerLabel: 'Trainer inventory', sectionLabel: 'Equipment', rowLabel: 'Row 1',
        availableQuantity: 1, itemForm: 'whole-item',
      },
      destination: {
        mode: 'required', allowedKinds: ['pokemon-equipment'],
        options: [
          { label: 'Pikachu · Held Item', enabled: true },
          { label: 'Eevee · Held Item', enabled: true },
        ],
      },
      consequences: [
        { kind: 'inventory-move', reversibility: 'reversible' },
        { kind: 'equipment-custody', reversibility: 'reversible' },
      ],
      confirmation: { mode: 'action-submit' },
      execution: { handoff: 'equipment-operation' },
    })
    expect(JSON.stringify(projection)).not.toMatch(/potion-row|re-breather-row|equipment-instance|profile_|sha256/i)
  })

  it('projects reviewed configuration and slot choices as bounded destinations', () => {
    const database = open()
    seed(database)
    const projection = loadTrainerInventoryActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })
    const focus = projection.offers.find(offer => offer.action === 'equip' && offer.source.canonicalItemId === 'Focus')!
    expect(focus.enabled).toBe(true)
    expect(focus.destination.options).toHaveLength(24)
    expect(focus.destination.options.map(option => option.label)).toEqual(expect.arrayContaining([
      'Ash · Main Hand · Stat: HP',
      'Ash · Off Hand · Stat: Attack',
      'Ash · Head · Stat: Special Attack',
      'Ash · Accessory · Stat: Speed',
    ]))
    expect(JSON.stringify(focus)).not.toMatch(/configurationId|definitionSha256|focus-row/u)
  })

  it('requires the exact current source, destination, quantity, and both destination revisions', () => {
    const database = open()
    seed(database)
    const projection = loadTrainerInventoryActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => candidate.action === 'give')!
    const destination = offer.destination.options[0]!
    const declaration = declarationFor(offer, destination.destinationId)
    expect(validateInventoryActionDeclarationAgainstOffer(offer, declaration)).toMatchObject({ action: 'give' })
    expect(() => validateInventoryActionDeclarationAgainstOffer(offer, {
      ...declaration,
      expectedRevisions: declaration.expectedRevisions.slice(0, -1),
    })).toThrow('does not match every exact source and destination revision')
    expect(() => validateInventoryActionDeclarationAgainstOffer(offer, { ...declaration, quantity: 2 }))
      .toThrow('does not match the current quantity offer')
  })
})
