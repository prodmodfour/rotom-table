import { describe, expect, it } from 'vitest'
import { useMoveAutomationWizard } from '~/composables/move-automation/useMoveAutomationWizard'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const token = (id: string, species: string, position = { x: 0, y: 0, z: 0 }): SpawnedPokemon => ({
  id,
  species,
  slug: species.toLowerCase(),
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: `/sprites/${species.toLowerCase()}.png`,
  entityKind: 'pokemon',
  position,
  sheetKind: 'pokemon',
  sheetSlug: species.toLowerCase(),
  level: 5,
  currentHp: 10,
  maxHp: 20,
  atk: 5,
  satk: 5,
  def: 5,
  sdef: 5,
  defenderTypes: ['Normal'],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
})

const sheetMoves = (): CharacterSheetMove[] => [
  { name: 'Tackle' },
  { name: 'Water Gun' },
]

describe('useMoveAutomationWizard', () => {
  it('owns move selection, target gating, hazard text, and apply orchestration', () => {
    const applied: MoveAutomationTransaction[] = []
    const user = token('user', 'Bolt', { x: 1, y: 0, z: 2 })
    const target = token('target', 'Aqua')
    const wizard = useMoveAutomationWizard({
      user,
      moves: sheetMoves(),
      allTokens: [user, target],
    }, (transaction) => applied.push(transaction))

    expect(wizard.moveEntries.value.map((entry) => entry.move.name)).toEqual(['Tackle', 'Water Gun'])
    expect(wizard.selectedEntry.value?.move.name).toBe('Tackle')

    wizard.search.value = 'water'
    expect(wizard.filteredMoveEntries.value.map((entry) => entry.move.name)).toEqual(['Water Gun'])

    wizard.selectMove('Water Gun')
    expect(wizard.step.value).toBe(1)
    expect(wizard.canContinue.value).toBe(false)

    wizard.toggleTarget('target')
    expect(wizard.targetIds.value).toEqual(['target'])
    expect(wizard.canContinue.value).toBe(true)

    wizard.addUserCellToHazardText()
    expect(wizard.hazardCellsText.value).toBe('1, 0, 2')

    wizard.apply()
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ userId: 'user', moveName: 'Water Gun' })
  })
})
