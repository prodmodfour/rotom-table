import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useIsometricSceneWatchers } from '~/composables/isometric/useIsometricSceneWatchers'

const makeActions = () => ({
  syncPokemonObjects: vi.fn(),
  refreshMovementAfterStateChange: vi.fn(),
  syncDialogsFromPokemons: vi.fn(),
  replayBuildPreview: vi.fn(),
  syncVoxelMeshes: vi.fn(),
  replayHazardPreview: vi.fn(),
  syncHazardMeshes: vi.fn(),
  syncGroundItemMeshes: vi.fn(),
  syncFieldEffectMeshes: vi.fn(),
  selectPokemon: vi.fn(),
  refreshPokemonStyles: vi.fn(),
  updateGridVisibility: vi.fn(),
  setControlsZoomEnabled: vi.fn(),
  clearPreviewVisuals: vi.fn(),
  closeContextMenu: vi.fn(),
  disposePreviewOwner: vi.fn(),
  resetMovementForSelectionChange: vi.fn(),
  closeUnauthorizedActions: vi.fn(),
  applyLayerVisibility: vi.fn(),
  hideBuildGhost: vi.fn(),
  ensureBuildGhost: vi.fn(),
  hideHazardGhost: vi.fn(),
  ensureHazardGhost: vi.fn(),
  buildGrid: vi.fn(),
  alignCameraToGrid: vi.fn(),
  syncRendererSize: vi.fn(),
  focusActiveTurnPokemon: vi.fn(),
  requestRender: vi.fn(),
})

const makeWatcherHarness = () => {
  const ready = ref(false)
  const pokemons = ref<unknown[]>([])
  const terrainVoxelRevision = ref('terrain:1')
  const hazardRevision = ref('hazard:1')
  const groundItemRevision = ref('ground-items:1')
  const fieldEffectsRevision = ref('field:1')
  const selectedId = ref<string | null>(null)
  const selectedPokemon = ref<unknown | null>(null)
  const controllableIdsKey = ref('')
  const layerVisibility = ref<unknown>({})
  const buildMode = ref(false)
  const hazardMode = ref(false)
  const buildSettings = ref<unknown[]>([])
  const ghostVoxelsFaded = ref(false)
  const hazardSettings = ref<unknown[]>([])
  const groundLevelY = ref(0)
  const dimensionsKey = ref<unknown[]>([1, 1, 1])
  const activeTurnId = ref<string | null>(null)
  const activeTurnRound = ref(1)
  const initiativeAutoFocusEnabled = ref(false)
  const controllable = new Set<string>()
  const actions = makeActions()
  const scope = effectScope()

  scope.run(() => {
    useIsometricSceneWatchers({
      sources: {
        pokemons,
        terrainVoxelRevision,
        hazardRevision,
        groundItemRevision,
        fieldEffectsRevision,
        selectedId: () => selectedId.value,
        selectedPokemon: () => selectedPokemon.value,
        controllableIdsKey,
        canControlPokemon: (id) => Boolean(id && controllable.has(id)),
        layerVisibility,
        buildMode: () => buildMode.value,
        hazardMode: () => hazardMode.value,
        buildSettings,
        ghostVoxelsFaded,
        hazardSettings,
        groundLevelY,
        dimensionsKey,
        activeTurnId,
        activeTurnRound,
        initiativeAutoFocusEnabled: () => initiativeAutoFocusEnabled.value,
        isRendererReady: () => ready.value,
      },
      actions,
    })
  })

  return {
    ready,
    pokemons,
    terrainVoxelRevision,
    selectedId,
    selectedPokemon,
    controllableIdsKey,
    buildMode,
    hazardMode,
    buildSettings,
    ghostVoxelsFaded,
    groundLevelY,
    dimensionsKey,
    activeTurnId,
    activeTurnRound,
    initiativeAutoFocusEnabled,
    hazardRevision,
    groundItemRevision,
    fieldEffectsRevision,
    layerVisibility,
    hazardSettings,
    controllable,
    actions,
    stop: () => scope.stop(),
  }
}

describe('useIsometricSceneWatchers', () => {
  it('enforces selected-token control before renderer readiness', async () => {
    const harness = makeWatcherHarness()
    harness.selectedId.value = 'locked-token'

    await nextTick()

    expect(harness.actions.selectPokemon).toHaveBeenCalledWith(null)
    expect(harness.actions.refreshPokemonStyles).not.toHaveBeenCalled()
    expect(harness.actions.requestRender).not.toHaveBeenCalled()
    harness.stop()
  })

  it('resets movement previews for allowed selections and clears previews on deselection', async () => {
    const harness = makeWatcherHarness()
    harness.ready.value = true
    harness.controllable.add('token-1')
    harness.selectedPokemon.value = { id: 'token-1' }
    harness.selectedId.value = 'token-1'

    await nextTick()

    expect(harness.actions.refreshPokemonStyles).toHaveBeenCalled()
    expect(harness.actions.setControlsZoomEnabled).toHaveBeenCalledWith(false)
    expect(harness.actions.resetMovementForSelectionChange).toHaveBeenCalledTimes(1)
    expect(harness.actions.disposePreviewOwner).not.toHaveBeenCalled()
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith([
      'token-style',
      'movement-preview',
      'layer-visibility',
    ])

    harness.selectedPokemon.value = null
    harness.selectedId.value = null
    await nextTick()

    expect(harness.actions.setControlsZoomEnabled).toHaveBeenLastCalledWith(true)
    expect(harness.actions.clearPreviewVisuals).toHaveBeenCalled()
    expect(harness.actions.closeContextMenu).toHaveBeenCalled()
    expect(harness.actions.disposePreviewOwner).toHaveBeenCalledTimes(1)
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith([
      'token-style',
      'movement-preview',
      'layer-visibility',
    ])
    harness.stop()
  })

  it('routes build-mode and hazard-mode watcher transitions through focused actions', async () => {
    const harness = makeWatcherHarness()
    harness.ready.value = true

    harness.buildMode.value = true
    await nextTick()

    expect(harness.actions.updateGridVisibility).toHaveBeenCalled()
    expect(harness.actions.closeContextMenu).toHaveBeenCalled()
    expect(harness.actions.clearPreviewVisuals).toHaveBeenCalled()
    expect(harness.actions.hideHazardGhost).toHaveBeenCalled()
    expect(harness.actions.ensureBuildGhost).toHaveBeenCalled()
    expect(harness.actions.replayBuildPreview).toHaveBeenCalled()
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith([
      'layer-visibility',
      'movement-preview',
      'build-preview',
      'hazard-preview',
    ])

    harness.hazardMode.value = true
    await nextTick()

    expect(harness.actions.hideBuildGhost).toHaveBeenCalled()
    expect(harness.actions.ensureHazardGhost).toHaveBeenCalled()
    expect(harness.actions.replayHazardPreview).toHaveBeenCalled()
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith([
      'layer-visibility',
      'movement-preview',
      'build-preview',
      'hazard-preview',
    ])
    harness.stop()
  })

  it('refreshes dimensions-dependent renderer state and active ghosts', async () => {
    const harness = makeWatcherHarness()
    harness.ready.value = true
    harness.buildMode.value = true
    harness.hazardMode.value = true

    // Let mode watchers settle before testing the dimension watcher call fan-out.
    await nextTick()
    vi.clearAllMocks()

    harness.dimensionsKey.value = [2, 1, 1]
    await nextTick()

    expect(harness.actions.buildGrid).toHaveBeenCalledTimes(1)
    expect(harness.actions.syncFieldEffectMeshes).toHaveBeenCalledTimes(1)
    expect(harness.actions.updateGridVisibility).toHaveBeenCalledTimes(1)
    expect(harness.actions.alignCameraToGrid).toHaveBeenCalledWith(false)
    expect(harness.actions.syncRendererSize).toHaveBeenCalledTimes(1)
    expect(harness.actions.refreshMovementAfterStateChange).toHaveBeenCalledTimes(1)
    expect(harness.actions.hideBuildGhost).toHaveBeenCalledTimes(1)
    expect(harness.actions.hideHazardGhost).toHaveBeenCalledTimes(1)
    expect(harness.actions.requestRender).toHaveBeenCalledWith([
      'resize',
      'camera',
      'terrain',
      'field-effect',
      'movement-preview',
      'build-preview',
      'hazard-preview',
    ])
    harness.stop()
  })

  it('resyncs voxel meshes when the ghost fade setting changes', async () => {
    const harness = makeWatcherHarness()
    harness.ready.value = true

    harness.ghostVoxelsFaded.value = true
    await nextTick()

    expect(harness.actions.syncVoxelMeshes).toHaveBeenCalledTimes(1)
    expect(harness.actions.refreshMovementAfterStateChange).not.toHaveBeenCalled()
    expect(harness.actions.requestRender).toHaveBeenCalledWith('terrain')
    harness.stop()
  })

  it('refreshes token and terrain state only after renderer readiness', async () => {
    const harness = makeWatcherHarness()

    harness.pokemons.value = [{}]
    harness.terrainVoxelRevision.value = 'terrain:2'
    await nextTick()

    expect(harness.actions.syncPokemonObjects).not.toHaveBeenCalled()
    expect(harness.actions.syncVoxelMeshes).not.toHaveBeenCalled()
    expect(harness.actions.requestRender).not.toHaveBeenCalled()

    harness.ready.value = true
    harness.pokemons.value = [{ id: 'token-1' }]
    harness.terrainVoxelRevision.value = 'terrain:3'
    await nextTick()

    expect(harness.actions.syncPokemonObjects).toHaveBeenCalledTimes(1)
    expect(harness.actions.syncDialogsFromPokemons).toHaveBeenCalledTimes(1)
    expect(harness.actions.syncVoxelMeshes).toHaveBeenCalledTimes(1)
    expect(harness.actions.refreshMovementAfterStateChange).toHaveBeenCalledTimes(2)
    expect(harness.actions.replayBuildPreview).toHaveBeenCalledTimes(2)
    expect(harness.actions.replayHazardPreview).toHaveBeenCalledTimes(1)
    expect(harness.actions.requestRender).toHaveBeenCalledWith([
      'tokens',
      'token-style',
      'movement-preview',
      'build-preview',
    ])
    expect(harness.actions.requestRender).toHaveBeenCalledWith([
      'terrain',
      'movement-preview',
      'build-preview',
      'hazard-preview',
    ])

    vi.clearAllMocks()
    const token = harness.pokemons.value[0] as {
      currentHp: number
      combatStages: { atk: number }
      conditions: string[]
    }
    token.currentHp = 7
    token.combatStages = { atk: 1 }
    token.conditions = ['Burned']
    await nextTick()

    expect(harness.actions.syncPokemonObjects).toHaveBeenCalledTimes(1)
    expect(harness.actions.syncDialogsFromPokemons).toHaveBeenCalledTimes(1)
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith([
      'tokens',
      'token-style',
      'movement-preview',
      'build-preview',
    ])
    harness.stop()
  })

  it('requests token-style renders for active-turn changes even when initiative auto-focus is disabled', async () => {
    const harness = makeWatcherHarness()
    harness.ready.value = true

    harness.activeTurnId.value = 'token-1'
    await nextTick()

    expect(harness.actions.requestRender).toHaveBeenLastCalledWith('token-style')
    expect(harness.actions.focusActiveTurnPokemon).not.toHaveBeenCalled()
    harness.stop()
  })

  it('focuses active initiative changes when initiative auto-focus is enabled', async () => {
    const harness = makeWatcherHarness()
    harness.ready.value = true
    harness.initiativeAutoFocusEnabled.value = true
    harness.actions.focusActiveTurnPokemon.mockReturnValue(true)

    harness.activeTurnId.value = 'token-1'
    await nextTick()

    expect(harness.actions.focusActiveTurnPokemon).toHaveBeenCalledWith('token-1')
    expect(harness.actions.requestRender).toHaveBeenCalledWith('token-style')
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith('camera')
    harness.stop()
  })

  it('does not focus active initiative changes when initiative auto-focus is disabled', async () => {
    const harness = makeWatcherHarness()
    harness.ready.value = true
    harness.initiativeAutoFocusEnabled.value = false

    harness.activeTurnId.value = 'token-1'
    await nextTick()

    expect(harness.actions.focusActiveTurnPokemon).not.toHaveBeenCalled()
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith('token-style')
    harness.stop()
  })

  it('does not focus null active initiative ids', async () => {
    const harness = makeWatcherHarness()
    harness.ready.value = true
    harness.initiativeAutoFocusEnabled.value = true
    harness.actions.focusActiveTurnPokemon.mockReturnValue(true)

    harness.activeTurnId.value = 'token-1'
    await nextTick()
    vi.clearAllMocks()

    harness.activeTurnId.value = null
    await nextTick()

    expect(harness.actions.focusActiveTurnPokemon).not.toHaveBeenCalled()
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith('token-style')
    harness.stop()
  })

  it('does not focus active initiative changes before renderer readiness', async () => {
    const harness = makeWatcherHarness()
    harness.initiativeAutoFocusEnabled.value = true
    harness.actions.focusActiveTurnPokemon.mockReturnValue(true)

    harness.activeTurnId.value = 'token-1'
    await nextTick()

    expect(harness.actions.focusActiveTurnPokemon).not.toHaveBeenCalled()
    expect(harness.actions.requestRender).not.toHaveBeenCalled()
    harness.stop()
  })

  it('does not refocus the same active initiative key on unrelated scene updates', async () => {
    const harness = makeWatcherHarness()
    harness.ready.value = true
    harness.initiativeAutoFocusEnabled.value = true
    harness.actions.focusActiveTurnPokemon.mockReturnValue(true)

    harness.activeTurnId.value = 'token-1'
    await nextTick()
    expect(harness.actions.focusActiveTurnPokemon).toHaveBeenCalledWith('token-1')
    vi.clearAllMocks()

    harness.pokemons.value = [{ id: 'token-1', currentHp: 12 }]
    harness.terrainVoxelRevision.value = 'terrain:manual-camera-rotation-regression'
    harness.layerVisibility.value = { tokens: true }
    await nextTick()

    expect(harness.actions.focusActiveTurnPokemon).not.toHaveBeenCalled()
    expect(harness.actions.requestRender).not.toHaveBeenCalledWith('camera')
    harness.stop()
  })

  it('focuses the same active initiative id again when the initiative round changes', async () => {
    const harness = makeWatcherHarness()
    harness.ready.value = true
    harness.initiativeAutoFocusEnabled.value = true
    harness.actions.focusActiveTurnPokemon.mockReturnValue(true)

    harness.activeTurnId.value = 'token-1'
    await nextTick()
    vi.clearAllMocks()

    harness.activeTurnRound.value = 2
    await nextTick()

    expect(harness.actions.focusActiveTurnPokemon).toHaveBeenCalledWith('token-1')
    expect(harness.actions.requestRender).toHaveBeenCalledWith('token-style')
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith('camera')
    harness.stop()
  })

  it('requests renders for focused hazard, field-effect, layer, active-turn, and setting changes', async () => {
    const harness = makeWatcherHarness()
    harness.ready.value = true

    harness.hazardRevision.value = 'hazard:2'
    await nextTick()
    expect(harness.actions.syncHazardMeshes).toHaveBeenCalledTimes(1)
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith(['hazards', 'hazard-preview'])

    harness.groundItemRevision.value = 'ground-items:2'
    await nextTick()
    expect(harness.actions.syncGroundItemMeshes).toHaveBeenCalledTimes(1)
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith(['scene-state'])

    harness.fieldEffectsRevision.value = 'field:2'
    await nextTick()
    expect(harness.actions.syncFieldEffectMeshes).toHaveBeenCalledTimes(1)
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith(['field-effect', 'weather'])

    harness.layerVisibility.value = { tokens: false }
    await nextTick()
    expect(harness.actions.applyLayerVisibility).toHaveBeenCalledTimes(1)
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith('layer-visibility')

    harness.activeTurnId.value = 'token-1'
    await nextTick()
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith('token-style')

    harness.buildMode.value = true
    await nextTick()
    vi.clearAllMocks()

    harness.buildSettings.value = ['eraser']
    await nextTick()
    expect(harness.actions.replayBuildPreview).toHaveBeenCalledTimes(1)
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith('build-preview')

    harness.hazardMode.value = true
    await nextTick()
    vi.clearAllMocks()

    harness.hazardSettings.value = ['toxic-spikes']
    await nextTick()
    expect(harness.actions.replayHazardPreview).toHaveBeenCalledTimes(1)
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith('hazard-preview')

    harness.groundLevelY.value = 1
    await nextTick()
    expect(harness.actions.requestRender).toHaveBeenLastCalledWith([
      'field-effect',
      'movement-preview',
      'token-style',
    ])
    harness.stop()
  })
})
