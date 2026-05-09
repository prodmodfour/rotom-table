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
})

const makeWatcherHarness = () => {
  const ready = ref(false)
  const pokemons = ref<unknown[]>([])
  const terrainVoxelRevision = ref('terrain:1')
  const hazardRevision = ref('hazard:1')
  const fieldEffectsRevision = ref('field:1')
  const selectedId = ref<string | null>(null)
  const selectedPokemon = ref<unknown | null>(null)
  const controllableIdsKey = ref('')
  const layerVisibility = ref<unknown>({})
  const buildMode = ref(false)
  const hazardMode = ref(false)
  const buildSettings = ref<unknown[]>([])
  const hazardSettings = ref<unknown[]>([])
  const groundLevelY = ref(0)
  const dimensionsKey = ref<unknown[]>([1, 1, 1])
  const controllable = new Set<string>()
  const actions = makeActions()
  const scope = effectScope()

  scope.run(() => {
    useIsometricSceneWatchers({
      sources: {
        pokemons,
        terrainVoxelRevision,
        hazardRevision,
        fieldEffectsRevision,
        selectedId: () => selectedId.value,
        selectedPokemon: () => selectedPokemon.value,
        controllableIdsKey,
        canControlPokemon: (id) => Boolean(id && controllable.has(id)),
        layerVisibility,
        buildMode: () => buildMode.value,
        hazardMode: () => hazardMode.value,
        buildSettings,
        hazardSettings,
        groundLevelY,
        dimensionsKey,
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
    groundLevelY,
    dimensionsKey,
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

    harness.selectedPokemon.value = null
    harness.selectedId.value = null
    await nextTick()

    expect(harness.actions.setControlsZoomEnabled).toHaveBeenLastCalledWith(true)
    expect(harness.actions.clearPreviewVisuals).toHaveBeenCalled()
    expect(harness.actions.closeContextMenu).toHaveBeenCalled()
    expect(harness.actions.disposePreviewOwner).toHaveBeenCalledTimes(1)
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

    harness.hazardMode.value = true
    await nextTick()

    expect(harness.actions.hideBuildGhost).toHaveBeenCalled()
    expect(harness.actions.ensureHazardGhost).toHaveBeenCalled()
    expect(harness.actions.replayHazardPreview).toHaveBeenCalled()
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
    harness.stop()
  })

  it('refreshes token and terrain state only after renderer readiness', async () => {
    const harness = makeWatcherHarness()

    harness.pokemons.value = [{}]
    harness.terrainVoxelRevision.value = 'terrain:2'
    await nextTick()

    expect(harness.actions.syncPokemonObjects).not.toHaveBeenCalled()
    expect(harness.actions.syncVoxelMeshes).not.toHaveBeenCalled()

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
    harness.stop()
  })
})
