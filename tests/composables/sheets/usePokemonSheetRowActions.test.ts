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
    digestionFoods: ['Berry Snack'],
    extraItems: ['Berry'],
    pointsLeft: 2,
  },
  movelist: [],
  eggMoves: [],
  appliedMoves: [],
  abilities: [],
  edges: [],
  inheritedMoves: {},
})

describe('usePokemonSheetRowActions', () => {
  it('adds and removes editable Pokémon move, applied move, ability, and edge rows', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const actions = usePokemonSheetRowActions(sheet)

    actions.addMove()
    actions.addAppliedMove()
    actions.addAbility()
    actions.addEdge()

    expect(sheet.value?.movelist?.[0]).toEqual({ name: '' })
    expect(sheet.value?.appliedMoves?.[0]).toEqual({ name: '', source: 'tm' })
    expect(sheet.value?.abilities?.[0]).toEqual({ name: '' })
    expect(sheet.value?.edges?.[0]).toEqual({ name: '', choices: {} })

    actions.removeMove(null)
    expect(sheet.value?.movelist).toHaveLength(1)

    actions.removeMove(0)
    actions.removeAppliedMove(0)
    actions.removeAbility(0)
    actions.removeEdge(0)

    expect(sheet.value?.movelist).toHaveLength(0)
    expect(sheet.value?.eggMoves).toEqual([])
    expect(sheet.value?.appliedMoves).toHaveLength(0)
    expect(sheet.value?.abilities).toHaveLength(0)
    expect(sheet.value?.edges).toHaveLength(0)
  })

  it('creates a default applied Move list for older sheet payloads without touching Egg compatibility data', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    delete sheet.value!.eggMoves
    delete sheet.value!.appliedMoves

    const actions = usePokemonSheetRowActions(sheet)
    actions.addAppliedMove()

    expect(sheet.value?.eggMoves).toBeUndefined()
    expect(sheet.value?.appliedMoves).toEqual([{ name: '', source: 'tm' }])
  })

  it('reorders Pokémon move rows by sheet index', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const actions = usePokemonSheetRowActions(sheet)

    sheet.value!.movelist = [{ name: 'A' }, { name: 'B' }, { name: 'C' }]

    actions.reorderMove(0, 2)
    expect(sheet.value?.movelist?.map((move) => move.name)).toEqual(['B', 'C', 'A'])

    actions.reorderMove(2, 0)
    expect(sheet.value?.movelist?.map((move) => move.name)).toEqual(['A', 'B', 'C'])

    actions.reorderMove(null, 1)
    actions.reorderMove(0, 99)
    expect(sheet.value?.movelist?.map((move) => move.name)).toEqual(['A', 'B', 'C'])
  })

  it('updates held item names and strips lookup-backed item details', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const actions = usePokemonSheetRowActions(sheet)

    actions.setHeldItemName(123)

    expect(sheet.value?.items).toEqual({
      held: '123', digestionFood: 'Snack', digestionFoods: ['Berry Snack'],
    })

    actions.setHeldItemName(null)
    expect(sheet.value?.items?.held).toBe('')
  })

  it('updates stats and evasion without exposing an inherited-Move writer', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const actions = usePokemonSheetRowActions(sheet)

    actions.setStat('atk', 'added', 3)
    actions.setStat('atk', 'stage', undefined)
    actions.setEvasionBonus('vsAnyBonus', -99)
    actions.setAccuracyStage(99)

    expect(sheet.value?.stats?.atk).toEqual({ added: 3, stage: 0 })
    expect(sheet.value?.combat?.evasion?.vsAnyBonus).toBe(-6)
    expect(sheet.value?.combatStages?.acc).toBe(6)
    expect(sheet.value?.inheritedMoves).toEqual({})
    expect(actions).not.toHaveProperty('setInheritedMove')
    expect(actions).not.toHaveProperty('addEggMove')
    expect(actions).not.toHaveProperty('removeEggMove')
  })

  it('updates Pokémon vitamin tracking fields', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const actions = usePokemonSheetRowActions(sheet)

    actions.setVitaminStatCount('statBoosts', 'atk', 2)
    actions.setVitaminStatCount('statSuppressants', 'def', -3)
    actions.setVitaminFlag('heartBooster', true)
    actions.setVitaminFlag('ppUp', true)
    actions.setVitaminNumber('rareCandies', 99)
    actions.setVitaminNumber('heartScales', '3')
    actions.setVitaminText('ppUpMove', 'Thunderbolt')
    actions.setVitaminText('notes', undefined)

    expect(sheet.value?.vitamins).toMatchObject({
      statBoosts: { atk: 2 },
      statSuppressants: { def: 0 },
      heartBooster: true,
      ppUp: true,
      rareCandies: 5,
      heartScales: 3,
      ppUpMove: 'Thunderbolt',
      notes: '',
    })
  })

  it('is inert when no Pokémon sheet is loaded', () => {
    const sheet = ref<CharacterSheet | null>(null)
    const actions = usePokemonSheetRowActions(sheet)

    actions.addMove()
    actions.addAppliedMove()
    actions.reorderMove(0, 1)
    actions.setStat('atk', 'added', 5)
    actions.setEvasionBonus('vsAtkBonus', 1)
    actions.setAccuracyStage(1)
    actions.setVitaminStatCount('statBoosts', 'atk', 1)
    actions.setVitaminFlag('heartBooster', true)
    actions.setVitaminNumber('heartScales', 1)
    actions.setVitaminText('notes', 'Ignored')
    actions.removeAppliedMove(0)
    actions.setHeldItemName('Ignored')

    expect(sheet.value).toBeNull()
  })
})
