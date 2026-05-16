import { describe, expect, it, vi } from 'vitest'
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

  it('selects targets from an AoE template placement', () => {
    const user = token('user', 'Bolt', { x: 5, y: 0, z: 5 })
    const adjacent = token('adjacent', 'Aqua', { x: 5, y: 0, z: 4 })
    const far = token('far', 'Leaf', { x: 9, y: 0, z: 5 })
    const wizard = useMoveAutomationWizard({
      user,
      moves: [{ name: 'Growl' }],
      allTokens: [user, adjacent, far],
    }, () => undefined)

    expect(wizard.areaTemplateOptions.value).toHaveLength(1)
    expect(wizard.areaTemplateOptions.value[0].targetIds).toEqual(['adjacent'])

    wizard.applyAreaTemplate(wizard.areaTemplateOptions.value[0].id)
    expect(wizard.targetIds.value).toEqual(['adjacent'])
  })

  it('can start on the context-menu selected move', () => {
    const user = token('user', 'Bolt')
    const wizard = useMoveAutomationWizard({
      user,
      moves: sheetMoves(),
      allTokens: [user],
      initialMoveName: 'Water Gun',
    }, () => undefined)

    expect(wizard.step.value).toBe(1)
    expect(wizard.selectedEntry.value?.move.name).toBe('Water Gun')
  })

  it('applies Luck Incense when rolling accuracy in the review wizard', () => {
    const user = { ...token('user', 'Bolt'), tokenItems: ['Luck Incense'] }
    const target = { ...token('target', 'Aqua'), conditions: ['Vulnerable'] }
    const wizard = useMoveAutomationWizard({
      user,
      moves: [{ name: 'Custom Shot', type: 'Normal', category: 'Physical', db: 4, ac: 4, range: '4, 1 Target' }],
      allTokens: [user, target],
    }, () => undefined)

    const random = vi.spyOn(Math, 'random')
    random.mockReturnValue(0.1)
    try {
      wizard.rollAccuracy('target')
    } finally {
      random.mockRestore()
    }

    expect(wizard.ensureTargetResolution('target')).toMatchObject({
      accuracyRoll: '3 + 1',
      hit: true,
      crit: false,
    })
  })
})
