import { describe, expect, it } from 'vitest'
import { advanceCampaignDayUseCase } from '../../server/useCases/advanceCampaignDay'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

describe('advanceCampaignDayUseCase', () => {
  it('advances pokemon and trainer sheets and emits sheet update events', () => {
    const pokemon: CharacterSheet = {
      slug: 'testmon',
      nickname: 'Testmon',
      species: '',
      level: 10,
      stats: { hp: { added: 10 } },
      combat: { currentHp: 10, injuries: 1, conditions: ['Poisoned'] },
      moveUsage: { daily: { rest: { moveName: 'Rest', uses: 1 } } },
    }
    const trainer: TrainerSheet = {
      slug: 'trainer',
      name: 'Trainer',
      level: 5,
      currentHp: 10,
      currentInjuries: 1,
      ap: { left: 2, spent: 1, drained: 1 },
    }
    const writes = new Map<string, Record<string, unknown>>()

    const result = advanceCampaignDayUseCase({ clientId: 'client-1' }, {
      listPokemonSheetPaths: () => ['/campaign/data/sheets/testmon.json'],
      listTrainerSheetPaths: () => ['/campaign/data/trainers/trainer.json'],
      readPokemonSheet: () => structuredClone(pokemon),
      readTrainerSheet: () => structuredClone(trainer),
      writeSheet: (path, sheet) => writes.set(path, sheet),
      relativePath: (path) => path.replace('/campaign/', ''),
    })

    expect(result).toMatchObject({
      ok: true,
      totalSheets: 2,
      updatedSheets: 2,
      pokemonUpdated: 1,
      trainerUpdated: 1,
      injuriesHealed: 2,
      dailyMoveUsesCleared: 1,
      conditionsCleared: 1,
    })
    expect(writes.size).toBe(2)
    expect(result.events.map((event) => event.channel)).toEqual([
      'sheet:pokemon:testmon',
      'sheets',
      'sheet:trainer:trainer',
      'sheets',
    ])
    expect(result.events.every((event) => event.clientId === 'client-1')).toBe(true)
  })
})
