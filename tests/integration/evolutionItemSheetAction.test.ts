import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { loadSheetItemActionsUseCase } from '../../server/useCases/loadSheetItemActions'
import { declareSheetItemActionUseCase } from '../../server/useCases/declareSheetItemAction'
import { executeItemOperationUseCase } from '../../server/useCases/executeItemOperation'
import {
  itemCommandFromAuthorizedSheetAction,
  sheetItemTargetId,
} from '#shared/itemAutomation/sheetActions'
import { parseItemEvolutionState } from '#shared/itemAutomation/evolution'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { PlayerProfile } from '#shared/playerProfiles'
import { randomizePokemonAddedStats } from '~/utils/sheets/pokemonAddedStatRandomizer'
import { redactSheetRecordForPlayer } from '../../server/utils/sheetPrivacy'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length) databases.pop()!.close()
})

const statKeys: readonly StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3, currentTeam: ['volt'],
  inventory: { pokemonItems: [{ id: 'thunder-row', name: 'Thunder Stone', qty: 1 }] },
})
const pokemon = (): CharacterSheet => ({
  slug: 'volt', nickname: 'Volt', species: 'Pikachu', level: 25, revision: 2,
  gender: 'Male', nature: 'Hardy',
  stats: Object.fromEntries(statKeys.map(key => [key, { added: key === 'spd' ? 35 : 0 }])),
  abilities: [{ name: 'Static' }], movelist: [{ name: 'Quick Attack' }],
})
const profile = (): PlayerProfile => ({
  schemaVersion: 1, id: 'profile_evolution01', displayName: 'Player',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
})
const seed = (database: RotomDatabase): void => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({
    kind: 'trainer', slug: 'ash', revision: 3, updatedAt: 10,
    document: trainer() as unknown as Record<string, unknown>,
  })
  sheets.save({
    kind: 'pokemon', slug: 'volt', revision: 2, updatedAt: 10,
    document: pokemon() as unknown as Record<string, unknown>,
  })
}

describe('Evolutionary Item sheet action lifecycle', () => {
  it('projects private bounded choices, atomically consumes and evolves, exact-replays, and resolves setup attention', () => {
    const database = open()
    seed(database)
    const projection = loadSheetItemActionsUseCase({
      role: 'player', playerProfile: profile(), trainerSlug: 'ash',
    }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => candidate.source.canonicalId === 'Thunder Stone')!
    expect(offer).toMatchObject({
      timingLabel: 'Outside encounter', acceptanceNotice: 'Consumes 1 when accepted.',
      availability: { enabled: true, unavailableReason: null },
    })
    const target = offer.targeting!.options.find(option => option.targetId === sheetItemTargetId('pokemon', 'volt'))!
    expect(target).toMatchObject({
      label: 'Volt', summary: 'Level 25 · Pikachu', enabled: true,
    })
    expect(target.choices.map(choice => [choice.choiceId, choice.presentation])).toEqual([
      ['evolution-destination', 'radio'], ['evolution-confirmation', 'confirmation'],
    ])
    const destination = target.choices[0]!.options[0]!
    expect(destination.label).toBe('Evolve to Raichu')
    expect(destination.previewFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Evolution', value: 'Pikachu → Raichu' }),
      expect.objectContaining({ label: 'Stat allocation', value: '35 Stat Points need allocation after evolution' }),
      expect.objectContaining({ label: 'Move decisions', value: 'No new Move decision' }),
    ]))
    expect(JSON.stringify(projection)).not.toContain('ruleRecordSha256')
    expect(JSON.stringify(projection)).not.toContain('thunder-row')

    const declared = declareSheetItemActionUseCase({
      role: 'player', playerProfile: profile(), intent: {
        schemaVersion: 1, trainerSlug: 'ash', trainerRevision: projection.trainerRevision,
        offerId: offer.offerId, action: 'use',
      },
    }, { database, now: () => 110 })
    const command = itemCommandFromAuthorizedSheetAction({
      offer: declared,
      operationId: 'sheet-item:v1:55555555555555555555555555555555',
      targetIds: [target.targetId],
      choices: [
        { choiceId: 'evolution-destination', optionIds: [destination.optionId] },
        { choiceId: 'evolution-confirmation', optionIds: ['confirmed'] },
      ],
    })
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 120 })
    const accepted = executeItemOperationUseCase({
      role: 'player', playerProfile: profile(), command,
    }, { database, realtimeEventRepository: realtime, now: () => 120 })
    expect(accepted.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Thunder Stone', exactReplay: false })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const acceptedTrainer = sheets.getByRef('trainer', 'ash')!
    const acceptedPokemon = sheets.getByRef('pokemon', 'volt')!
    expect((acceptedTrainer.sheet as unknown as TrainerSheet).inventory?.pokemonItems).toEqual([])
    expect(acceptedPokemon.sheet).toMatchObject({
      species: 'Raichu', itemEvolutionLocked: true,
      itemEvolutionAttention: { statAllocation: { status: 'open', required: 35, allocated: 0 } },
    })
    const privateState = parseItemEvolutionState((acceptedPokemon.sheet as unknown as CharacterSheet).serverPrivate?.itemEvolution)
    expect(privateState.applications).toHaveLength(1)
    const playerProjection = redactSheetRecordForPlayer('pokemon', acceptedPokemon.sheet)
    expect(playerProjection).not.toHaveProperty('serverPrivate')
    expect(JSON.stringify(playerProjection)).not.toContain('sourceOperationId')
    expect(playerProjection).toHaveProperty('itemEvolutionAttention.statAllocation.status', 'open')
    const realtimeJson = JSON.stringify(realtime.readAfter({ afterSequence: 0, limit: 20 }).events)
    expect(realtimeJson).toContain('itemEvolutionAttention')
    expect(realtimeJson).not.toContain('itemEvolution\":')
    expect(realtimeJson).not.toContain('sourceOperationId')
    expect(realtimeJson).not.toContain('ruleRecordSha256')

    const replay = executeItemOperationUseCase({
      role: 'player', playerProfile: profile(), command,
    }, { database, now: () => 130 })
    expect(replay.result).toMatchObject({ status: 'accepted', exactReplay: true })
    expect(replay.sheets).toEqual([])
    expect(parseItemEvolutionState(
      (sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet).serverPrivate?.itemEvolution,
    ).applications).toHaveLength(1)

    const partialCurrent = sheets.getByRef('pokemon', 'volt')!
    const partial = structuredClone(partialCurrent.sheet) as unknown as CharacterSheet
    partial.stats!.hp!.added = 5
    const partialSaved = sheets.replaceSetupSheet({
      kind: 'pokemon', slug: 'volt', expectedRevision: partialCurrent.revision,
      sheet: partial as unknown as Record<string, unknown>, now: 140,
    })!
    expect((partialSaved.sheet.sheet as unknown as CharacterSheet).itemEvolutionAttention?.statAllocation.status).toBe('open')

    const completeCurrent = sheets.getByRef('pokemon', 'volt')!
    const complete = structuredClone(completeCurrent.sheet) as unknown as CharacterSheet
    randomizePokemonAddedStats(complete, { random: () => 0.5 })
    const completed = sheets.replaceSetupSheet({
      kind: 'pokemon', slug: 'volt', expectedRevision: completeCurrent.revision,
      sheet: complete as unknown as Record<string, unknown>, now: 150,
    })!
    const completedSheet = completed.sheet.sheet as unknown as CharacterSheet
    expect(completedSheet.itemEvolutionAttention?.statAllocation).toEqual({ status: 'resolved', required: 35, allocated: 35 })
    expect(parseItemEvolutionState(completedSheet.serverPrivate?.itemEvolution).statResolutions).toEqual([
      expect.objectContaining({ allocatedStatPoints: 35, resolvedAt: 150 }),
    ])
  })

  it('rejects a stale target or locked species tamper without consuming another source', () => {
    const database = open()
    seed(database)
    const projection = loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => candidate.source.canonicalId === 'Thunder Stone')!
    const target = offer.targeting!.options.find(option => option.sheetSlug === 'volt')!
    const declared = declareSheetItemActionUseCase({ role: 'gm', intent: {
      schemaVersion: 1, trainerSlug: 'ash', trainerRevision: 3, offerId: offer.offerId, action: 'use',
    } }, { database, now: () => 110 })
    const command = itemCommandFromAuthorizedSheetAction({
      offer: declared, operationId: 'sheet-item:v1:66666666666666666666666666666666',
      targetIds: [target.targetId], choices: [
        { choiceId: 'evolution-destination', optionIds: [target.choices[0]!.options[0]!.optionId] },
        { choiceId: 'evolution-confirmation', optionIds: ['confirmed'] },
      ],
    })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({
      kind: 'pokemon', slug: 'volt', revision: 3, updatedAt: 111,
      document: { ...pokemon(), revision: 3 } as unknown as Record<string, unknown>,
    })
    expect(() => executeItemOperationUseCase({ role: 'gm', command }, { database, now: () => 120 }))
      .toThrow('command authority changed')
    expect((sheets.getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet).inventory?.pokemonItems?.[0]?.qty).toBe(1)
  })
})
