import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useMapEditorUiState } from '~/composables/map-editor/useMapEditorUiState'

const keyEvent = (overrides: Partial<Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'preventDefault'>> = {}) => ({
  key: '',
  ctrlKey: false,
  shiftKey: false,
  preventDefault: vi.fn(),
  ...overrides,
}) as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> }

describe('useMapEditorUiState', () => {
  it('owns menu and layer visibility state', () => {
    const registerKeydown = vi.fn()
    const ui = useMapEditorUiState({
      isGm: ref(true),
      canEditMap: ref(true),
      buildMode: ref(false),
      hazardMode: ref(false),
      clearSelection: vi.fn(),
      registerKeydown,
    })

    expect(registerKeydown).toHaveBeenCalledTimes(1)
    expect(registerKeydown).toHaveBeenCalledWith(ui.handleKeydown)
    expect(ui.activeMapMenu.value).toBe(null)
    expect(ui.fieldEffectsMenuOpen.value).toBe(false)
    expect(ui.sheetsMenuOpen.value).toBe(false)
    expect(ui.initiativeMenuOpen.value).toBe(false)
    expect(ui.layerVisibility.value.grid).toBe(true)

    ui.setLayerVisibility('grid', false)
    ui.openFieldEffectsMenu()

    expect(ui.activeMapMenu.value).toBe('fieldEffects')
    expect(ui.fieldEffectsMenuOpen.value).toBe(true)
    expect(ui.layerVisibility.value.grid).toBe(false)
    expect(ui.layerOptions).toContain('fieldEffects')
  })

  it('switches editor modes and clears token selection when entering build or hazard mode', () => {
    const canEditMap = ref(true)
    const buildMode = ref(false)
    const hazardMode = ref(false)
    const clearSelection = vi.fn()
    const ui = useMapEditorUiState({
      isGm: ref(true),
      canEditMap,
      buildMode,
      hazardMode,
      clearSelection,
      registerKeydown: vi.fn(),
    })

    ui.setMode('build')
    expect(buildMode.value).toBe(true)
    expect(hazardMode.value).toBe(false)
    expect(clearSelection).toHaveBeenCalledTimes(1)

    ui.setMode('build')
    expect(clearSelection).toHaveBeenCalledTimes(1)

    ui.setMode('hazards')
    expect(buildMode.value).toBe(false)
    expect(hazardMode.value).toBe(true)
    expect(clearSelection).toHaveBeenCalledTimes(2)

    ui.setMode('play')
    expect(buildMode.value).toBe(false)
    expect(hazardMode.value).toBe(false)
    expect(clearSelection).toHaveBeenCalledTimes(2)
  })

  it('toggles build mode with Ctrl+B and clears token selection when entering', () => {
    const buildMode = ref(false)
    const hazardMode = ref(false)
    const clearSelection = vi.fn()
    const ui = useMapEditorUiState({
      isGm: ref(true),
      canEditMap: ref(true),
      buildMode,
      hazardMode,
      clearSelection,
      registerKeydown: vi.fn(),
    })

    const enterEvent = keyEvent({ key: 'b', ctrlKey: true })
    ui.handleKeydown(enterEvent)

    expect(enterEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(buildMode.value).toBe(true)
    expect(hazardMode.value).toBe(false)
    expect(clearSelection).toHaveBeenCalledTimes(1)

    const exitEvent = keyEvent({ key: 'B', ctrlKey: true })
    ui.handleKeydown(exitEvent)

    expect(exitEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(buildMode.value).toBe(false)
    expect(hazardMode.value).toBe(false)
    expect(clearSelection).toHaveBeenCalledTimes(1)
  })

  it('toggles the field effects menu with Ctrl+F and closes it with Escape', () => {
    const ui = useMapEditorUiState({
      isGm: ref(false),
      canEditMap: ref(false),
      buildMode: ref(false),
      hazardMode: ref(false),
      clearSelection: vi.fn(),
      registerKeydown: vi.fn(),
    })

    const openEvent = keyEvent({ key: 'f', ctrlKey: true })
    ui.handleKeydown(openEvent)

    expect(openEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(ui.fieldEffectsMenuOpen.value).toBe(true)

    const toggleClosedEvent = keyEvent({ key: 'F', ctrlKey: true })
    ui.handleFieldEffectsShortcut(toggleClosedEvent)

    expect(toggleClosedEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(ui.fieldEffectsMenuOpen.value).toBe(false)

    ui.openFieldEffectsMenu()
    ui.handleKeydown(keyEvent({ key: 'Escape' }))

    expect(ui.fieldEffectsMenuOpen.value).toBe(false)
  })

  it('opens sheets and initiative menus from keyboard shortcuts', () => {
    const ui = useMapEditorUiState({
      isGm: ref(false),
      canEditMap: ref(false),
      buildMode: ref(false),
      hazardMode: ref(false),
      clearSelection: vi.fn(),
      registerKeydown: vi.fn(),
    })

    const sheetsEvent = keyEvent({ key: 's', ctrlKey: true })
    ui.handleKeydown(sheetsEvent)

    expect(sheetsEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(ui.sheetsMenuOpen.value).toBe(true)
    expect(ui.fieldEffectsMenuOpen.value).toBe(false)

    const initiativeEvent = keyEvent({ key: 'I', ctrlKey: true })
    ui.handleKeydown(initiativeEvent)

    expect(initiativeEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(ui.sheetsMenuOpen.value).toBe(false)
    expect(ui.initiativeMenuOpen.value).toBe(true)

    const toggleClosedEvent = keyEvent({ key: 'i', ctrlKey: true })
    ui.handleInitiativeShortcut(toggleClosedEvent)

    expect(toggleClosedEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(ui.activeMapMenu.value).toBe(null)
  })

  it('blocks GM-only modes when map editing is unavailable', () => {
    const buildMode = ref(false)
    const hazardMode = ref(false)
    const ui = useMapEditorUiState({
      isGm: ref(false),
      canEditMap: ref(false),
      buildMode,
      hazardMode,
      clearSelection: vi.fn(),
      registerKeydown: vi.fn(),
    })

    ui.setMode('build')
    expect(buildMode.value).toBe(false)
    expect(hazardMode.value).toBe(false)

    ui.setMode('hazards')
    expect(buildMode.value).toBe(false)
    expect(hazardMode.value).toBe(false)

    const event = keyEvent({ key: 'b', ctrlKey: true })
    ui.handleKeydown(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(buildMode.value).toBe(false)
    expect(hazardMode.value).toBe(false)
  })

  it('handles the GM admin keyboard shortcut and Escape close behavior', () => {
    const ui = useMapEditorUiState({
      isGm: ref(true),
      canEditMap: ref(true),
      buildMode: ref(false),
      hazardMode: ref(false),
      clearSelection: vi.fn(),
      registerKeydown: vi.fn(),
    })

    const openEvent = keyEvent({ key: 'A', ctrlKey: true, shiftKey: true })
    ui.handleAdminShortcut(openEvent)
    expect(openEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(ui.adminPanelOpen.value).toBe(true)

    ui.handleAdminShortcut(keyEvent({ key: 'Escape' }))
    expect(ui.adminPanelOpen.value).toBe(false)
  })

  it('ignores admin shortcuts for non-GMs', () => {
    const ui = useMapEditorUiState({
      isGm: ref(false),
      canEditMap: ref(false),
      buildMode: ref(false),
      hazardMode: ref(false),
      clearSelection: vi.fn(),
      registerKeydown: vi.fn(),
    })
    const event = keyEvent({ key: 'A', ctrlKey: true, shiftKey: true })

    ui.handleAdminShortcut(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(ui.adminPanelOpen.value).toBe(false)
  })
})
