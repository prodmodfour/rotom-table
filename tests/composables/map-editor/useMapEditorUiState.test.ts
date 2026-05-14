import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultLeftSidebarSections,
  useMapEditorUiState,
} from '~/composables/map-editor/useMapEditorUiState'

const keyEvent = (overrides: Partial<Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'preventDefault'>> = {}) => ({
  key: '',
  ctrlKey: false,
  shiftKey: false,
  preventDefault: vi.fn(),
  ...overrides,
}) as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> }

describe('createDefaultLeftSidebarSections', () => {
  it('returns independent expanded sidebar section state', () => {
    const first = createDefaultLeftSidebarSections()
    const second = createDefaultLeftSidebarSections()

    expect(first).toEqual({ details: false, terrain: false, fieldEffects: false })
    first.terrain = true
    expect(second.terrain).toBe(false)
  })
})

describe('useMapEditorUiState', () => {
  it('owns sidebar, section, and layer visibility toggles', () => {
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
    expect(ui.sidebarCollapsed.value).toBe(false)
    expect(ui.initiativeCollapsed.value).toBe(false)
    expect(ui.layerVisibility.value.grid).toBe(true)

    ui.toggleSidebarCollapsed()
    ui.toggleInitiativeCollapsed()
    ui.toggleLeftSection('terrain')
    ui.setLayerVisibility('grid', false)

    expect(ui.sidebarCollapsed.value).toBe(true)
    expect(ui.initiativeCollapsed.value).toBe(true)
    expect(ui.leftSidebarSectionsCollapsed.value.terrain).toBe(true)
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
