import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { executeContestPreparationUseCase, ContestPreparationUseCaseError } from '../../server/useCases/contestPreparation'
import { buildContestPerformerSnapshot } from '../../shared/contests/integrations'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const op = (id: string) => `contest-op:v1:${id.padEnd(8, 'x')}`
const setup = () => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({ kind: 'trainer', slug: 'contest-trainer', revision: 0, updatedAt: 1, document: { slug: 'contest-trainer', name: 'Maya', level: 10, money: 1_000, skills: {}, inventory: { foodStuff: [{ id: 'poffin-stack', name: 'Poffin', qty: 1 }, { id: 'pecha-stack', name: 'Pecha Berry', qty: 2 }], pokemonItems: [{ id: 'mixer', name: 'Poffin Mixer', qty: 1 }] } } })
  sheets.save({ kind: 'pokemon', slug: 'contest-pokemon', revision: 0, updatedAt: 1, document: { slug: 'contest-pokemon', nickname: 'Partner', species: 'Pikachu', level: 10, stats: {}, movelist: [{ name: 'Charm' }] } })
  return { database, sheets }
}

describe('Contest preparation operations', () => {
  it('consumes one exact Poffin atomically and exact retry does not consume twice', () => {
    const { database, sheets } = setup()
    const command = { schemaVersion: 1 as const, commandKind: 'consume-poffin' as const, operationId: op('consume'), trainerSheetSlug: 'contest-trainer', trainerRevision: 0, pokemonSheetSlug: 'contest-pokemon', pokemonRevision: 0, sourceSection: 'foodStuff' as const, sourceRowId: 'poffin-stack', statId: 'cute' as const }
    const result = executeContestPreparationUseCase(command, { role: 'gm' }, { database, now: () => 100 })
    expect(result).toMatchObject({ exactRetry: false, trainerRevision: 1, pokemonRevision: 1 })
    const retry = executeContestPreparationUseCase(command, { role: 'gm' }, { database, now: () => 200 })
    expect(retry).toMatchObject({ exactRetry: true, trainerRevision: 1, pokemonRevision: 1 })
    const trainer = sheets.getByRef('trainer', 'contest-trainer')!.sheet as any
    const pokemon = sheets.getByRef('pokemon', 'contest-pokemon')!.sheet as any
    expect(trainer.inventory.foodStuff.some((row: any) => row.name === 'Poffin')).toBe(false)
    expect(pokemon.contestStats.poffins).toHaveLength(1)
    expect(pokemon.contestStats.poffins[0]).toMatchObject({ statId: 'cute', sourceOperationId: command.operationId })
  })

  it('crafts only from the reviewed berry mapping and charges money in the same transaction', () => {
    const { database, sheets } = setup()
    const result = executeContestPreparationUseCase({ schemaVersion: 1, commandKind: 'craft-poffins', operationId: op('craft'), trainerSheetSlug: 'contest-trainer', trainerRevision: 0, statId: 'cute', reviewedBerryItemIds: ['Pecha Berry'] }, { role: 'gm' }, { database, now: () => 100 })
    expect(result.message).toContain('Two cute Poffins')
    const trainer = sheets.getByRef('trainer', 'contest-trainer')!.sheet as any
    expect(trainer.money).toBe(500)
    expect(trainer.inventory.foodStuff.find((row: any) => row.name === 'Pecha Berry').qty).toBe(1)
    expect(trainer.inventory.foodStuff.find((row: any) => row.name === 'Poffin' && !row.contestPoffinStatId).qty).toBe(1)
    expect(trainer.inventory.foodStuff.find((row: any) => row.name === 'Poffin' && row.contestPoffinStatId === 'cute').qty).toBe(2)
    const crafted = trainer.inventory.foodStuff.find((row: any) => row.contestPoffinStatId === 'cute')
    expect(() => executeContestPreparationUseCase({ schemaVersion: 1, commandKind: 'consume-poffin', operationId: op('wrongstat'), trainerSheetSlug: 'contest-trainer', trainerRevision: 1, pokemonSheetSlug: 'contest-pokemon', pokemonRevision: 0, sourceSection: 'foodStuff', sourceRowId: crafted.id, statId: 'tough' }, { role: 'gm' }, { database })).toThrowError(ContestPreparationUseCaseError)
    expect((sheets.getByRef('trainer', 'contest-trainer')!.sheet as any).inventory.foodStuff.find((row: any) => row.id === crafted.id).qty).toBe(2)
  })

  it('crafts Contest Trends items at reviewed costs through ordinary inventory', () => {
    const { database, sheets } = setup()
    const current = sheets.getByRef('trainer', 'contest-trainer')!
    const trainer = structuredClone(current.sheet) as any
    trainer.money = 4_000
    trainer.features = [{ name: 'Contest Trends', automation: { schemaVersion: 1, instanceId: 'feature:contest-trends:1', canonicalId: 'Contest Trends', definitionVersion: 1, rank: 1, choices: [], acquisition: { kind: 'gm', sourceId: 'test' }, prerequisiteOverride: null } }]
    expect(sheets.applyLivePlayUpdate({ kind: 'trainer', slug: 'contest-trainer', expectedRevision: current.revision, nextSheet: trainer, sourceOperationId: op('granttrends') })).toBe('applied')
    const command = { schemaVersion: 1 as const, commandKind: 'craft-contest-item' as const, operationId: op('trendcraft'), trainerSheetSlug: 'contest-trainer', trainerRevision: 1, itemId: 'Contest Accessory' as const }
    const result = executeContestPreparationUseCase(command, { role: 'gm' }, { database, now: () => 100 })
    expect(result.message).toContain('Contest Accessory crafted for $750')
    expect(executeContestPreparationUseCase(command, { role: 'gm' }, { database, now: () => 200 }).exactRetry).toBe(true)
    executeContestPreparationUseCase({ ...command, operationId: op('trendclothes'), trainerRevision: 2, itemId: 'Fancy Clothes' }, { role: 'gm' }, { database, now: () => 300 })
    const updated = sheets.getByRef('trainer', 'contest-trainer')!.sheet as any
    expect(updated.money).toBe(750)
    expect(updated.inventory.pokemonItems.filter((row: any) => row.name === 'Contest Accessory')).toHaveLength(1)
    const clothes = updated.inventory.equipment.filter((row: any) => row.name === 'Fancy Clothes')
    expect(clothes).toHaveLength(1)
    expect(Object.hasOwn(clothes[0], 'qty')).toBe(false)
  })

  it('charges Flexible Preparations against ordinary Daily Feature authority and resets only on a new campaign day', () => {
    const { database, sheets } = setup()
    const trainerCurrent = sheets.getByRef('trainer', 'contest-trainer')!, trainer = structuredClone(trainerCurrent.sheet) as any
    trainer.features = [{ name: 'Flexible Preparations', automation: { schemaVersion: 1, instanceId: 'feature:flexible-preparations:1', canonicalId: 'Flexible Preparations', definitionVersion: 1, rank: 1, choices: [], acquisition: { kind: 'gm', sourceId: 'test' }, prerequisiteOverride: null } }]
    expect(sheets.applyLivePlayUpdate({ kind: 'trainer', slug: 'contest-trainer', expectedRevision: 0, nextSheet: trainer, sourceOperationId: op('grantflex') })).toBe('applied')
    const pokemonCurrent = sheets.getByRef('pokemon', 'contest-pokemon')!, pokemon = structuredClone(pokemonCurrent.sheet) as any
    pokemon.contestStats = { schemaVersion: 1, legacyDescription: '', grooming: null, reallocations: [], poffins: [0, 1].map(index => ({ entryId: `poffin:${index}`, statId: 'cute', sourceItemId: 'Poffin', sourceInventoryInstanceId: `inventory:${index}`, sourceOperationId: op(`seed${index}`), consumedAt: index })) }
    expect(sheets.applyLivePlayUpdate({ kind: 'pokemon', slug: 'contest-pokemon', expectedRevision: 0, nextSheet: pokemon, sourceOperationId: op('seedpoffins') })).toBe('applied')
    const first = { schemaVersion: 1 as const, commandKind: 'flexible-preparations' as const, operationId: op('flexday0'), trainerSheetSlug: 'contest-trainer', trainerRevision: 1, pokemonSheetSlug: 'contest-pokemon', pokemonRevision: 1, fromStatId: 'cute' as const, toStatId: 'cool' as const, dice: 1 as const }
    expect(executeContestPreparationUseCase(first, { role: 'gm' }, { database, now: () => 10 }).exactRetry).toBe(false)
    expect(executeContestPreparationUseCase(first, { role: 'gm' }, { database, now: () => 11 }).exactRetry).toBe(true)
    const duplicateDay = { ...first, operationId: op('flexagain'), trainerRevision: 2, pokemonRevision: 2, toStatId: 'beauty' as const }
    expect(() => executeContestPreparationUseCase(duplicateDay, { role: 'gm' }, { database, now: () => 12 })).toThrowError(ContestPreparationUseCaseError)
    expect((sheets.getByRef('pokemon', 'contest-pokemon')!.sheet as any).contestStats.reallocations).toHaveLength(1)
    const clockOperationId = `breeding-operation:v1:${'9'.repeat(32)}`
    database.connection.prepare("INSERT INTO breeding_operations (operation_id, command_sha256, command_kind, command_json, status, result_json, result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute) VALUES (?, ?, 'advance-campaign-clock', '{}', 'pending', NULL, NULL, 0, NULL)").run(clockOperationId, '9'.repeat(64))
    database.connection.prepare('UPDATE campaign_clock SET campaign_minute = 1440, revision = 1, last_operation_id = ?').run(clockOperationId)
    const nextDay = { ...duplicateDay, operationId: op('flexday1') }
    expect(executeContestPreparationUseCase(nextDay, { role: 'gm' }, { database, now: () => 20 }).exactRetry).toBe(false)
    const updatedTrainer = sheets.getByRef('trainer', 'contest-trainer')!.sheet as any
    expect(updatedTrainer.featureUsage.entries).toContainEqual(expect.objectContaining({ canonicalId: 'Flexible Preparations', scope: 'day', scopeId: 'campaign-day:1', uses: 1 }))
  })

  it('binds a GM-reviewed Contest identity to a Feature-created Move and protects it from setup saves', () => {
    const { database, sheets } = setup()
    const trainerCurrent = sheets.getByRef('trainer', 'contest-trainer')!, trainer = structuredClone(trainerCurrent.sheet) as any
    trainer.features = [{ name: 'Innovation', automation: { schemaVersion: 1, instanceId: 'feature:innovation:1', canonicalId: 'Innovation', definitionVersion: 1, rank: 1, choices: [], acquisition: { kind: 'gm', sourceId: 'test' }, prerequisiteOverride: null } }]
    expect(sheets.applyLivePlayUpdate({ kind: 'trainer', slug: 'contest-trainer', expectedRevision: 0, nextSheet: trainer, sourceOperationId: op('grantinnovate') })).toBe('applied')
    const pokemonCurrent = sheets.getByRef('pokemon', 'contest-pokemon')!, pokemon = structuredClone(pokemonCurrent.sheet) as any
    pokemon.movelist.push({ name: 'Aurora Pirouette', frequency: 'Scene' })
    expect(sheets.applyLivePlayUpdate({ kind: 'pokemon', slug: 'contest-pokemon', expectedRevision: 0, nextSheet: pokemon, sourceOperationId: op('grantcreated') })).toBe('applied')
    expect(() => executeContestPreparationUseCase({ schemaVersion: 1, commandKind: 'bind-created-move', operationId: op('bindcanonical'), trainerSheetSlug: 'contest-trainer', trainerRevision: 1, pokemonSheetSlug: 'contest-pokemon', pokemonRevision: 1, moveName: 'Charm', typeId: 'beauty', effectId: 'big-show', sourceFeatureId: 'Innovation' }, { role: 'gm' }, { database, now: () => 99 })).toThrow(/cannot be rebound/)
    executeContestPreparationUseCase({ schemaVersion: 1, commandKind: 'bind-created-move', operationId: op('bindcreated'), trainerSheetSlug: 'contest-trainer', trainerRevision: 1, pokemonSheetSlug: 'contest-pokemon', pokemonRevision: 1, moveName: 'Aurora Pirouette', typeId: 'beauty', effectId: 'big-show', sourceFeatureId: 'Innovation' }, { role: 'gm' }, { database, now: () => 100 })
    let updated = sheets.getByRef('pokemon', 'contest-pokemon')!.sheet as any
    expect(updated.movelist.find((row: any) => row.name === 'Aurora Pirouette').contestIdentity).toMatchObject({ typeId: 'beauty', effectId: 'big-show', sourceFeatureId: 'Innovation' })
    expect(() => executeContestPreparationUseCase({ schemaVersion: 1, commandKind: 'bind-created-move', operationId: op('rebindcreated'), trainerSheetSlug: 'contest-trainer', trainerRevision: 2, pokemonSheetSlug: 'contest-pokemon', pokemonRevision: 2, moveName: 'Aurora Pirouette', typeId: 'cool', effectId: 'safe-option', sourceFeatureId: 'Innovation' }, { role: 'gm' }, { database, now: () => 101 })).toThrow(/immutable accepted Contest identity/)
    const offer = buildContestPerformerSnapshot({ sheet: updated, trainer: sheets.getByRef('trainer', 'contest-trainer')!.sheet as any, campaignDay: 0, revision: updated.revision })
    expect(offer.moves.find(row => row.label === 'Aurora Pirouette')).toMatchObject({ available: true, typeId: 'beauty', effectId: 'big-show' })
    const forged = structuredClone(updated)
    forged.movelist.find((row: any) => row.name === 'Aurora Pirouette').contestIdentity.effectId = 'safe-option'
    sheets.replaceSetupSheet({ kind: 'pokemon', slug: 'contest-pokemon', expectedRevision: updated.revision, sheet: forged, now: 200 })
    updated = sheets.getByRef('pokemon', 'contest-pokemon')!.sheet as any
    expect(updated.movelist.find((row: any) => row.name === 'Aurora Pirouette').contestIdentity.effectId).toBe('big-show')
  })

  it('binds Dance-created Moves only to their reviewed Contest effects', () => {
    const { database, sheets } = setup()
    const trainerCurrent = sheets.getByRef('trainer', 'contest-trainer')!, trainer = structuredClone(trainerCurrent.sheet) as any
    trainer.features = ['Passing Waltz', 'Beguiling Dance'].map((canonicalId, index) => ({ name: canonicalId, automation: { schemaVersion: 1, instanceId: `feature:dance:${index}`, canonicalId, definitionVersion: 1, rank: 1, choices: [], acquisition: { kind: 'gm', sourceId: 'test' }, prerequisiteOverride: null } }))
    expect(sheets.applyLivePlayUpdate({ kind: 'trainer', slug: 'contest-trainer', expectedRevision: 0, nextSheet: trainer, sourceOperationId: op('grantdances') })).toBe('applied')
    const pokemonCurrent = sheets.getByRef('pokemon', 'contest-pokemon')!, pokemon = structuredClone(pokemonCurrent.sheet) as any
    pokemon.movelist.push({ name: 'Passing Step' }, { name: 'Beguiling Step' })
    expect(sheets.applyLivePlayUpdate({ kind: 'pokemon', slug: 'contest-pokemon', expectedRevision: 0, nextSheet: pokemon, sourceOperationId: op('grantdances') })).toBe('applied')
    const passing = { schemaVersion: 1 as const, commandKind: 'bind-created-move' as const, operationId: op('passingbad'), trainerSheetSlug: 'contest-trainer', trainerRevision: 1, pokemonSheetSlug: 'contest-pokemon', pokemonRevision: 1, moveName: 'Passing Step', typeId: 'cool' as const, effectId: 'big-show' as const, sourceFeatureId: 'Passing Waltz' as const }
    expect(() => executeContestPreparationUseCase(passing, { role: 'gm' }, { database, now: () => 100 })).toThrow(/Get Ready/)
    executeContestPreparationUseCase({ ...passing, operationId: op('passingok'), effectId: 'get-ready' }, { role: 'gm' }, { database, now: () => 101 })
    executeContestPreparationUseCase({ ...passing, operationId: op('beguilingok'), trainerRevision: 2, pokemonRevision: 2, moveName: 'Beguiling Step', typeId: 'beauty', effectId: 'excitement', sourceFeatureId: 'Beguiling Dance' }, { role: 'gm' }, { database, now: () => 102 })
    const updated = sheets.getByRef('pokemon', 'contest-pokemon')!.sheet as any
    expect(updated.movelist.find((row: any) => row.name === 'Passing Step').contestIdentity).toMatchObject({ typeId: 'cool', effectId: 'get-ready', sourceFeatureId: 'Passing Waltz' })
    expect(updated.movelist.find((row: any) => row.name === 'Beguiling Step').contestIdentity).toMatchObject({ typeId: 'beauty', effectId: 'excitement', sourceFeatureId: 'Beguiling Dance' })
  })

  it('rolls back stale and invalid crafting attempts without partial custody changes', () => {
    const { database, sheets } = setup()
    expect(() => executeContestPreparationUseCase({ schemaVersion: 1, commandKind: 'craft-poffins', operationId: op('badberry'), trainerSheetSlug: 'contest-trainer', trainerRevision: 0, statId: 'beauty', reviewedBerryItemIds: ['Pecha Berry'] }, { role: 'gm' }, { database })).toThrowError(ContestPreparationUseCaseError)
    expect(() => executeContestPreparationUseCase({ schemaVersion: 1, commandKind: 'consume-poffin', operationId: op('stale'), trainerSheetSlug: 'contest-trainer', trainerRevision: 2, pokemonSheetSlug: 'contest-pokemon', pokemonRevision: 0, sourceSection: 'foodStuff', sourceRowId: 'poffin-stack', statId: 'cute' }, { role: 'gm' }, { database })).toThrowError(ContestPreparationUseCaseError)
    const trainer = sheets.getByRef('trainer', 'contest-trainer')!.sheet as any
    expect(trainer.money).toBe(1_000)
    expect(trainer.inventory.foodStuff.find((row: any) => row.name === 'Poffin').qty).toBe(1)
    expect(trainer.inventory.foodStuff.find((row: any) => row.name === 'Pecha Berry').qty).toBe(2)
  })

  it('requires a player profile to own both ordinary sheets', () => {
    const { database } = setup()
    const command = { schemaVersion: 1 as const, commandKind: 'consume-poffin' as const, operationId: op('privacy'), trainerSheetSlug: 'contest-trainer', trainerRevision: 0, pokemonSheetSlug: 'contest-pokemon', pokemonRevision: 0, sourceSection: 'foodStuff' as const, sourceRowId: 'poffin-stack', statId: 'cute' as const }
    const unrelatedProfile = { id: 'profile_unrelated1', displayName: 'Other', linkedCharacters: [], createdAt: 1, updatedAt: 1 } as any
    expect(() => executeContestPreparationUseCase(command, { role: 'player', playerProfile: unrelatedProfile }, { database })).toThrowError(ContestPreparationUseCaseError)
  })
})
