import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useTrainerSheetRowActions } from '~/composables/sheets/useTrainerSheetRowActions'
import type { TrainerSheet } from '~/types/trainerSheet'

const makeSheet = (): TrainerSheet => ({
  slug: 'trainer',
  name: 'Trainer',
  level: 1,
  classes: [],
  movelist: [],
  abilities: [],
  maneuvers: [],
  orders: [],
  features: [],
  edges: [],
  advancement: [],
  inventory: {
    keyItems: [],
    pokemonItems: [],
    medicalKit: [],
    pokeBalls: [],
    foodStuff: [],
    equipment: [],
  },
  stats: {},
  evasion: {},
  skills: {},
})

describe('useTrainerSheetRowActions', () => {
  it('adds and removes trainer rows through focused actions', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const actions = useTrainerSheetRowActions(sheet)

    actions.addClass()
    actions.addMove()
    actions.addAbility()
    actions.addManeuver()
    actions.addOrder()
    actions.addFeature()
    actions.addEdge()
    actions.addInvItem('keyItems')

    expect(sheet.value?.classes?.[0]).toMatchObject({ name: 'New Class' })
    expect(sheet.value?.movelist?.[0]).toMatchObject({ name: '' })
    expect(sheet.value?.abilities?.[0]).toMatchObject({ name: '' })
    expect(sheet.value?.maneuvers?.[0]).toMatchObject({ name: 'New Maneuver' })
    expect(sheet.value?.orders?.[0]).toMatchObject({ name: 'New Order' })
    expect(sheet.value?.features?.[0]).toMatchObject({ name: 'New Feature' })
    expect(sheet.value?.edges?.[0]).toMatchObject({ name: 'New Edge' })
    expect(sheet.value?.inventory?.keyItems?.[0]).toMatchObject({ name: 'New Item' })

    actions.removeClass(0)
    actions.removeMove(null)
    expect(sheet.value?.movelist).toHaveLength(1)
    actions.removeMove(0)
    actions.removeAbility(0)
    actions.removeManeuver(0)
    actions.removeOrder(0)
    actions.removeFeature(0)
    actions.removeEdge(0)
    actions.removeInvItem('keyItems', 0)

    expect(sheet.value?.classes).toHaveLength(0)
    expect(sheet.value?.movelist).toHaveLength(0)
    expect(sheet.value?.abilities).toHaveLength(0)
    expect(sheet.value?.maneuvers).toHaveLength(0)
    expect(sheet.value?.orders).toHaveLength(0)
    expect(sheet.value?.features).toHaveLength(0)
    expect(sheet.value?.edges).toHaveLength(0)
    expect(sheet.value?.inventory?.keyItems).toHaveLength(0)
  })

  it('updates advancement rows without duplicating levels', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const actions = useTrainerSheetRowActions(sheet)

    actions.addAdvancement(5)
    actions.addAdvancement(5)
    actions.setAdv(10, 'stats', 1)
    actions.setAdv(10, 'notes', 'Feat')

    expect(sheet.value?.advancement).toEqual([
      { level: 5 },
      { level: 10, stats: 1, notes: 'Feat' },
    ])
  })

  it('parses tags, stat fields, and evasion bonuses consistently', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const actions = useTrainerSheetRowActions(sheet)
    const feature = { name: 'Feature', tags: ['Class'] }
    const order = { name: 'Order', tags: ['Order'] }

    expect(actions.featureTagsCsv(feature)).toBe('Class')
    expect(actions.orderTagsCsv(order)).toBe('Order')

    actions.setFeatureTags(feature, 'Class, Orders,')
    actions.setOrderTags(order, 'Training, Command')
    actions.setStatField('atk', 'levelUp', 3)
    actions.setStatField('atk', 'stage', undefined)
    actions.setEvasionBonus('speedBonus', 99)

    expect(feature.tags).toEqual(['Class', 'Orders'])
    expect(order.tags).toEqual(['Training', 'Command'])
    expect(sheet.value?.stats?.atk).toEqual({ levelUp: 3, stage: 0 })
    expect(sheet.value?.evasion?.speedBonus).toBe(6)
  })

  it('sets, clears, and reads skill overrides', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const actions = useTrainerSheetRowActions(sheet)

    actions.setSkillRank('focus', 'Adept')
    actions.setSkillModifier('focus', 2)
    expect(sheet.value?.skills?.focus).toEqual({ rank: 'Adept', modifier: 2 })
    expect(actions.skillModifier('focus')).toBe(2)

    actions.setSkillRank('focus', undefined)
    expect(sheet.value?.skills?.focus).toEqual({ modifier: 2 })

    actions.setSkillModifier('focus', 0)
    expect(sheet.value?.skills?.focus).toBeUndefined()
  })

  it('is inert when no trainer sheet is loaded', () => {
    const sheet = ref<TrainerSheet | null>(null)
    const actions = useTrainerSheetRowActions(sheet)

    actions.addClass()
    actions.setStatField('atk', 'base', 10)
    actions.setSkillRank('focus', 'Adept')

    expect(sheet.value).toBeNull()
    expect(actions.skillModifier('focus')).toBe(0)
  })
})
