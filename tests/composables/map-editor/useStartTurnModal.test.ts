import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useStartTurnModal } from '~/composables/map-editor/useStartTurnModal'
import { applyStartTurnModalStateUpdate, readStartTurnModalState, writeStartTurnModalState } from '#shared/startTurnModalState'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'
import type { TabletopMap } from '~/types/map'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  revision: 4,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 6, y: 2, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-pikachu',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
    },
  ],
  lights: [],
  initiative: { activeId: 'token-pikachu', round: 2 },
  metadata: {},
  updatedAt: 100,
})

const initiativeRow = (conditions: string[] = []): InitiativeRow => ({
  id: 'token-pikachu',
  name: 'Pikachu',
  meta: 'Pokémon · Lv 5',
  sprite: { url: null, isSpriteSheet: false, frameWidth: 32, frameHeight: 32, scale: 1 },
  profileUrl: null,
  currentHp: 20,
  maxHp: 20,
  conditions,
  initiative: null,
  baseSpeed: 10,
  speed: 10,
  speedCombatStage: 0,
  baseInitiative: 10,
  initiativeItemBonus: 0,
  initiativeTrainingBonus: 0,
  initiativeScore: 10,
})

describe('useStartTurnModal', () => {
  it('shows the current active turn until that turn is dismissed in metadata', () => {
    const map = ref(mapFixture())
    const modal = useStartTurnModal({
      map,
      canViewMap: computed(() => true),
      mapInPrepareMode: computed(() => false),
      activeInitiativeId: computed(() => 'token-pikachu'),
      initiativeRound: computed(() => 2),
      sortedInitiativeRows: computed(() => [initiativeRow()]),
      placementById: (id) => map.value?.placements.find((placement) => placement.id === id) ?? null,
      isGm: computed(() => true),
      livePlayReady: computed(() => true),
      commandSaving: computed(() => false),
      updateTurn: vi.fn(),
      replaceConditions: vi.fn(),
    })

    expect(modal.activeStartTurnModal.value).toMatchObject({
      activeId: 'token-pikachu',
      round: 2,
      characterName: 'Pikachu',
      characterMeta: 'Pokémon · Lv 5',
      conditions: [],
    })

    map.value = {
      ...map.value,
      metadata: writeStartTurnModalState(map.value.metadata, applyStartTurnModalStateUpdate(
        { schemaVersion: 3, dismissedTurn: null, conditionResolutions: [] },
        { action: 'dismiss', activeId: 'token-pikachu', round: 2 },
      )),
    }

    expect(modal.activeStartTurnModal.value).toBeNull()
  })

  it('allows only ready GMs to close the modal', () => {
    const updateTurn = vi.fn()
    const isGm = ref(false)
    const livePlayReady = ref(true)
    const commandSaving = ref(false)
    const modal = useStartTurnModal({
      map: ref(mapFixture()),
      canViewMap: computed(() => true),
      mapInPrepareMode: computed(() => false),
      activeInitiativeId: computed(() => 'token-pikachu'),
      initiativeRound: computed(() => 2),
      sortedInitiativeRows: computed(() => []),
      placementById: () => mapFixture().placements[0] ?? null,
      isGm: computed(() => isGm.value),
      livePlayReady: computed(() => livePlayReady.value),
      commandSaving: computed(() => commandSaving.value),
      updateTurn,
      replaceConditions: vi.fn(),
    })

    modal.closeStartTurnModal()
    expect(updateTurn).not.toHaveBeenCalled()

    isGm.value = true
    commandSaving.value = true
    modal.closeStartTurnModal()
    expect(updateTurn).not.toHaveBeenCalled()

    commandSaving.value = false
    livePlayReady.value = false
    modal.closeStartTurnModal()
    expect(updateTurn).not.toHaveBeenCalled()

    livePlayReady.value = true
    modal.closeStartTurnModal()
    expect(updateTurn).toHaveBeenCalledWith({ action: 'dismiss', activeId: 'token-pikachu', round: 2 })
  })

  it('shows active conditions with synced results for the current turn', () => {
    const state = applyStartTurnModalStateUpdate(
      readStartTurnModalState(undefined),
      {
        action: 'resolveCondition',
        activeId: 'token-pikachu',
        round: 2,
        condition: 'Paralysis',
        occurrence: 0,
        resolution: 'roll',
      },
      { conditionRoll: 12, resolvedAt: 44 },
    )
    const map = ref({
      ...mapFixture(),
      metadata: writeStartTurnModalState({}, state),
    })

    const modal = useStartTurnModal({
      map,
      canViewMap: computed(() => true),
      mapInPrepareMode: computed(() => false),
      activeInitiativeId: computed(() => 'token-pikachu'),
      initiativeRound: computed(() => 2),
      sortedInitiativeRows: computed(() => [initiativeRow(['Burned', 'Paralysis'])]),
      placementById: (id) => map.value?.placements.find((placement) => placement.id === id) ?? null,
      isGm: computed(() => false),
      livePlayReady: computed(() => true),
      commandSaving: computed(() => false),
      updateTurn: vi.fn(),
      replaceConditions: vi.fn(),
    })

    expect(modal.activeStartTurnModal.value?.conditions).toMatchObject([
      { condition: 'Burned', occurrence: 0, result: null },
      {
        condition: 'Paralysis',
        occurrence: 0,
        result: {
          resolution: 'roll',
          roll: 12,
          dc: 11,
          success: true,
          resolvedAt: 44,
        },
      },
    ])
  })

  it('keeps removed condition results visible after the sheet condition disappears', () => {
    const state = applyStartTurnModalStateUpdate(
      readStartTurnModalState(undefined),
      {
        action: 'resolveCondition',
        activeId: 'token-pikachu',
        round: 2,
        condition: 'Burned',
        occurrence: 0,
        resolution: 'remove',
      },
      { resolvedAt: 55 },
    )
    const map = ref({
      ...mapFixture(),
      metadata: writeStartTurnModalState({}, state),
    })

    const modal = useStartTurnModal({
      map,
      canViewMap: computed(() => true),
      mapInPrepareMode: computed(() => false),
      activeInitiativeId: computed(() => 'token-pikachu'),
      initiativeRound: computed(() => 2),
      sortedInitiativeRows: computed(() => [initiativeRow([])]),
      placementById: (id) => map.value?.placements.find((placement) => placement.id === id) ?? null,
      isGm: computed(() => false),
      livePlayReady: computed(() => true),
      commandSaving: computed(() => false),
      updateTurn: vi.fn(),
      replaceConditions: vi.fn(),
    })

    expect(modal.activeStartTurnModal.value?.conditions).toMatchObject([{
      condition: 'Burned',
      occurrence: 0,
      present: false,
      result: {
        resolution: 'remove',
        resolvedAt: 55,
      },
    }])
  })

  it('lets ready GMs resolve condition options and removes the selected condition from the sheet', async () => {
    const updateTurn = vi.fn(async () => ({ dispatched: true }))
    const replaceConditions = vi.fn(async () => ({ dispatched: true }))
    const isGm = ref(true)
    const modal = useStartTurnModal({
      map: ref(mapFixture()),
      canViewMap: computed(() => true),
      mapInPrepareMode: computed(() => false),
      activeInitiativeId: computed(() => 'token-pikachu'),
      initiativeRound: computed(() => 2),
      sortedInitiativeRows: computed(() => [initiativeRow(['Burned', 'Paralysis'])]),
      placementById: () => mapFixture().placements[0] ?? null,
      isGm: computed(() => isGm.value),
      livePlayReady: computed(() => true),
      commandSaving: computed(() => false),
      updateTurn,
      replaceConditions,
    })

    const paralysis = modal.activeStartTurnModal.value?.conditions.find((condition) => condition.condition === 'Paralysis')
    expect(paralysis).toBeTruthy()

    await modal.resolveStartTurnModalCondition(paralysis!.id, 'remove')

    expect(updateTurn).toHaveBeenCalledWith({
      action: 'resolveCondition',
      activeId: 'token-pikachu',
      round: 2,
      condition: 'Paralysis',
      occurrence: 0,
      resolution: 'remove',
    })
    expect(replaceConditions).toHaveBeenCalledWith({
      id: 'token-pikachu',
      conditions: ['Burned'],
    })

    isGm.value = false
    await modal.resolveStartTurnModalCondition(paralysis!.id, 'skip')
    expect(updateTurn).toHaveBeenCalledTimes(1)
  })
})
