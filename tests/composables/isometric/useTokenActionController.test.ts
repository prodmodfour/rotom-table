import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { SpawnedPokemon } from '~/types/pokemon'
import { useTokenActionController } from '~/composables/isometric/useTokenActionController'

const pokemon = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 'token-1',
  species: 'Pikachu',
  slug: 'pikachu',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/pikachu.png',
  entityKind: 'pokemon',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
  position: { x: 0, y: 0, z: 0 },
  level: 1,
  currentHp: 40,
  maxHp: 50,
  atk: 8,
  satk: 12,
  def: 5,
  sdef: 7,
  defenderTypes: ['Electric'],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

type EmittedEvent = [string, unknown]

const makeController = () => {
  let pokemons: SpawnedPokemon[] = [pokemon()]
  const controllableIds = new Set(['token-1'])
  const events: EmittedEvent[] = []
  const container = ref({
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect,
  })

  const controller = useTokenActionController({
    container,
    pokemons: () => pokemons,
    canDeleteTokens: () => true,
    canControlPokemon: (id) => Boolean(id && controllableIds.has(id)),
    emit: {
      turnPokemon: (id) => events.push(['turn', id]),
      deletePokemon: (id) => events.push(['delete', id]),
      modifyHp: (payload) => events.push(['hp', payload]),
      modifyCombatStages: (payload) => events.push(['stages', payload]),
      modifyConditions: (payload) => events.push(['conditions', payload]),
      grantExperience: (payload) => events.push(['xp', payload]),
      useMove: (payload) => events.push(['move', payload]),
      useManeuver: (payload) => events.push(['maneuver', payload]),
      useAbility: (payload) => events.push(['ability', payload]),
      useOrder: (payload) => events.push(['order', payload]),
      viewSheet: (id) => events.push(['sheet', id]),
      viewPokedex: (id) => events.push(['pokedex', id]),
    },
  })

  return {
    controller,
    events,
    controllableIds,
    setPokemons: (next: SpawnedPokemon[]) => { pokemons = next },
  }
}

describe('useTokenActionController', () => {
  it('opens a token context menu and routes simple menu actions', () => {
    const { controller, events } = makeController()

    controller.openContextMenu({ clientX: 120, clientY: 90 } as MouseEvent, 'token-1')
    expect(controller.contextMenu.value?.id).toBe('token-1')

    controller.handleContextViewSheet()
    expect(events).toEqual([['sheet', 'token-1']])
    expect(controller.contextMenu.value).toBeNull()

    controller.openContextMenu({ clientX: 120, clientY: 90 } as MouseEvent, 'token-1')
    controller.handleContextUseOrder('Mobilize')
    expect(events.at(-1)).toEqual(['order', { id: 'token-1', orderName: 'Mobilize' }])
    expect(controller.contextMenu.value).toBeNull()

    controller.openContextMenu({ clientX: 120, clientY: 90 } as MouseEvent, 'token-1')
    controller.handleContextUseManeuver('Trip')
    expect(events.at(-1)).toEqual(['maneuver', { id: 'token-1', maneuverName: 'Trip' }])
    expect(controller.contextMenu.value).toBeNull()
  })

  it('submits HP, combat-stage, and condition dialog changes', () => {
    const { controller, events } = makeController()

    controller.openContextMenu({ clientX: 120, clientY: 90 } as MouseEvent, 'token-1')
    controller.handleContextModifyHp()
    controller.hpDialog.value!.amount = '5'
    controller.handleHpDialogSubmit()
    expect(events.at(-1)).toEqual(['hp', { id: 'token-1', currentHp: 35 }])

    controller.openContextMenu({ clientX: 120, clientY: 90 } as MouseEvent, 'token-1')
    controller.handleContextModifyCombatStages()
    controller.combatStagesDialog.value!.stages.atk = 2
    controller.handleCombatStagesDialogSubmit()
    expect(events.at(-1)).toEqual([
      'stages',
      {
        id: 'token-1',
        stages: { atk: 2, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
      },
    ])

    controller.openContextMenu({ clientX: 120, clientY: 90 } as MouseEvent, 'token-1')
    controller.handleContextApplyRemoveConditions()
    controller.conditionsDialog.value!.conditions = [' poisoned ', 'Burned']
    controller.handleConditionsDialogSubmit()
    expect(events.at(-1)).toEqual(['conditions', { id: 'token-1', conditions: ['Burned', 'Poisoned'] }])

    controller.openContextMenu({ clientX: 120, clientY: 90 } as MouseEvent, 'token-1')
    controller.handleContextGrantExperience()
    controller.experienceDialog.value!.amount = '25'
    controller.handleExperienceDialogSubmit()
    expect(events.at(-1)).toEqual(['xp', { id: 'token-1', amount: 25 }])
  })

  it('syncs live dialog metadata and closes unauthorized token actions', () => {
    const { controller, controllableIds, setPokemons } = makeController()

    controller.openContextMenu({ clientX: 120, clientY: 90 } as MouseEvent, 'token-1')
    controller.handleContextModifyHp()
    controller.openContextMenu({ clientX: 120, clientY: 90 } as MouseEvent, 'token-1')
    controller.handleContextGrantExperience()
    setPokemons([pokemon({ currentHp: 12, maxHp: 60, species: 'Raichu', level: 5, totalExp: 50 })])

    controller.syncDialogsFromPokemons()
    expect(controller.hpDialog.value).toMatchObject({ currentHp: 12, maxHp: 60, species: 'Raichu' })
    expect(controller.experienceDialog.value).toMatchObject({ species: 'Raichu', level: 5, totalExp: 50 })

    controllableIds.clear()
    controller.closeUnauthorizedActions()
    expect(controller.hpDialog.value).toBeNull()
  })

  it('closes only the topmost action overlay on escape-like requests', () => {
    const { controller } = makeController()

    controller.openContextMenu({ clientX: 120, clientY: 90 } as MouseEvent, 'token-1')
    controller.handleContextModifyCombatStages()
    expect(controller.closeTopmostOverlay()).toBe(true)
    expect(controller.combatStagesDialog.value).toBeNull()
    expect(controller.closeTopmostOverlay()).toBe(false)
  })
})
