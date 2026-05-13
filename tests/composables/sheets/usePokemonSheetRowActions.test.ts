import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { usePokemonSheetRowActions } from '~/composables/sheets/usePokemonSheetRowActions'
import type { CharacterSheet } from '~/types/characterSheet'

const makeSheet = (): CharacterSheet => ({
  slug: 'pikachu',
  species: 'Pikachu',
  nickname: 'Pika',
  level: 5,
  stats: {},
  combat: { evasion: {} },
  items: {
    held: 'Potion',
    itemDescription: 'old lookup text',
    digestionFood: 'Snack',
    extraItems: ['Berry'],
    pointsLeft: 2,
  },
  movelist: [],
  abilities: [],
  edges: [],
  inheritedMoves: {},
})

describe('usePokemonSheetRowActions', () => {
  it('adds and removes Pokémon move, ability, and edge rows', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const actions = usePokemonSheetRowActions(sheet)

    actions.addMove()
    actions.addAbility()
    actions.addEdge()

    expect(sheet.value?.movelist?.[0]).toEqual({ name: '' })
    expect(sheet.value?.abilities?.[0]).toEqual({ name: '' })
    expect(sheet.value?.edges?.[0]).toEqual({ name: 'New Edge' })

    actions.removeMove(null)
    expect(sheet.value?.movelist).toHaveLength(1)

    actions.removeMove(0)
    actions.removeAbility(0)
    actions.removeEdge(0)

    expect(sheet.value?.movelist).toHaveLength(0)
    expect(sheet.value?.abilities).toHaveLength(0)
    expect(sheet.value?.edges).toHaveLength(0)
  })

  it('toggles activatable ability state', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const actions = usePokemonSheetRowActions(sheet)

    sheet.value!.abilities = [{ name: 'Sand Veil' }]

    actions.toggleAbilityActivation(0)
    expect(sheet.value?.abilities?.[0].activated).toBe(true)

    actions.toggleAbilityActivation(0)
    expect(sheet.value?.abilities?.[0].activated).toBe(false)

    sheet.value!.abilities = [{ name: 'Run Away', activated: true }]
    actions.toggleAbilityActivation(0)
    expect(sheet.value?.abilities?.[0]).toEqual({ name: 'Run Away' })
  })

  it('updates held item names and strips lookup-backed item details', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const actions = usePokemonSheetRowActions(sheet)

    actions.setHeldItemName(123)

    expect(sheet.value?.items).toEqual({ held: '123' })

    actions.setHeldItemName(null)
    expect(sheet.value?.items?.held).toBe('')
  })

  it('updates stats, evasion bonuses, and inherited moves', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const actions = usePokemonSheetRowActions(sheet)

    actions.setStat('atk', 'added', 3)
    actions.setStat('atk', 'stage', undefined)
    actions.setEvasionBonus('vsAnyBonus', -99)
    actions.setInheritedMove('20', 'Volt Tackle')
    actions.setInheritedMove('30', '  ')

    expect(sheet.value?.stats?.atk).toEqual({ added: 3, stage: 0 })
    expect(sheet.value?.combat?.evasion?.vsAnyBonus).toBe(-6)
    expect(sheet.value?.inheritedMoves).toEqual({ '20': 'Volt Tackle' })
  })

  it('is inert when no Pokémon sheet is loaded', () => {
    const sheet = ref<CharacterSheet | null>(null)
    const actions = usePokemonSheetRowActions(sheet)

    actions.addMove()
    actions.setStat('atk', 'added', 5)
    actions.setEvasionBonus('vsAtkBonus', 1)
    actions.toggleAbilityActivation(0)
    actions.setInheritedMove('20', 'Ignored')
    actions.setHeldItemName('Ignored')

    expect(sheet.value).toBeNull()
  })
})
