import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useStartTurnModal } from '~/composables/map-editor/useStartTurnModal'
import { applyStartTurnModalStateUpdate, writeStartTurnModalState } from '#shared/startTurnModalState'
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

describe('useStartTurnModal', () => {
  it('shows the current active turn until that turn is dismissed in metadata', () => {
    const map = ref(mapFixture())
    const modal = useStartTurnModal({
      map,
      canViewMap: computed(() => true),
      mapInPrepareMode: computed(() => false),
      activeInitiativeId: computed(() => 'token-pikachu'),
      initiativeRound: computed(() => 2),
      sortedInitiativeRows: computed(() => [{
        id: 'token-pikachu',
        name: 'Pikachu',
        meta: 'Pokémon · Lv 5',
        sprite: { url: null, isSpriteSheet: false, frameWidth: 32, frameHeight: 32, scale: 1 },
        profileUrl: null,
        currentHp: 20,
        maxHp: 20,
        conditions: [],
        initiative: null,
        baseSpeed: 10,
        speed: 10,
        speedCombatStage: 0,
        baseInitiative: 10,
        initiativeItemBonus: 0,
        initiativeTrainingBonus: 0,
        initiativeScore: 10,
      }]),
      placementById: (id) => map.value?.placements.find((placement) => placement.id === id) ?? null,
      isGm: computed(() => true),
      livePlayReady: computed(() => true),
      commandSaving: computed(() => false),
      dismissTurn: vi.fn(),
    })

    expect(modal.activeStartTurnModal.value).toMatchObject({
      activeId: 'token-pikachu',
      round: 2,
      characterName: 'Pikachu',
      characterMeta: 'Pokémon · Lv 5',
    })

    map.value = {
      ...map.value,
      metadata: writeStartTurnModalState(map.value.metadata, applyStartTurnModalStateUpdate(
        { schemaVersion: 1, dismissedTurn: null },
        { action: 'dismiss', activeId: 'token-pikachu', round: 2 },
      )),
    }

    expect(modal.activeStartTurnModal.value).toBeNull()
  })

  it('allows only ready GMs to close the modal', () => {
    const dismissTurn = vi.fn()
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
      dismissTurn,
    })

    modal.closeStartTurnModal()
    expect(dismissTurn).not.toHaveBeenCalled()

    isGm.value = true
    commandSaving.value = true
    modal.closeStartTurnModal()
    expect(dismissTurn).not.toHaveBeenCalled()

    commandSaving.value = false
    livePlayReady.value = false
    modal.closeStartTurnModal()
    expect(dismissTurn).not.toHaveBeenCalled()

    livePlayReady.value = true
    modal.closeStartTurnModal()
    expect(dismissTurn).toHaveBeenCalledWith({ action: 'dismiss', activeId: 'token-pikachu', round: 2 })
  })
})
