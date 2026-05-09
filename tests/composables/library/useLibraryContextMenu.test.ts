import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useLibraryContextMenu } from '~/composables/library/useLibraryContextMenu'

interface TestTarget {
  id: string
  label: string
  folder: string
}

const mouseEvent = (x = 40, y = 80) => ({
  clientX: x,
  clientY: y,
  preventDefault: vi.fn(),
}) as unknown as MouseEvent & { preventDefault: ReturnType<typeof vi.fn> }

const createMenu = (canOpen = ref(true)) => useLibraryContextMenu<TestTarget>({
  canOpen,
  targetLabel: (target) => target.label,
  renameInputForTarget: (target) => `rename-${target.label}`,
  moveDestinationsForTarget: (target) => [
    { value: '', label: 'Home (root)' },
    { value: `archive/${target.folder}`, label: `Archive / ${target.folder}` },
  ],
})

describe('useLibraryContextMenu', () => {
  it('opens menu state for allowed targets', () => {
    const menu = createMenu()
    const event = mouseEvent(12, 34)

    expect(menu.openContext(event, { id: 'a', label: 'Alpha', folder: 'team' })).toBe(true)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(menu.ctx.value).toMatchObject({
      x: 12,
      y: 34,
      mode: 'menu',
      input: '',
      busy: false,
      error: null,
      target: { id: 'a', label: 'Alpha', folder: 'team' },
    })
    expect(menu.ctxTargetLabel.value).toBe('Alpha')
  })

  it('does not open when blocked', () => {
    const canOpen = ref(false)
    const menu = createMenu(canOpen)
    const event = mouseEvent()

    expect(menu.openContext(event, { id: 'a', label: 'Alpha', folder: 'team' })).toBe(false)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(menu.ctx.value).toBeNull()
    expect(menu.ctxTargetLabel.value).toBe('')
  })

  it('enters move mode with the first destination selected', () => {
    const menu = createMenu()
    menu.openContext(mouseEvent(), { id: 'a', label: 'Alpha', folder: 'team' })
    menu.ctx.value!.error = 'old error'

    menu.enterMove()

    expect(menu.ctx.value?.mode).toBe('move')
    expect(menu.ctx.value?.error).toBeNull()
    expect(menu.ctx.value?.input).toBe('')
    expect(menu.ctxMoveDestinations.value).toEqual([
      { value: '', label: 'Home (root)' },
      { value: 'archive/team', label: 'Archive / team' },
    ])
  })

  it('enters rename mode with target-specific input', () => {
    const menu = createMenu()
    menu.openContext(mouseEvent(), { id: 'a', label: 'Alpha', folder: 'team' })
    menu.ctx.value!.error = 'old error'

    menu.enterRename()

    expect(menu.ctx.value?.mode).toBe('rename')
    expect(menu.ctx.value?.error).toBeNull()
    expect(menu.ctx.value?.input).toBe('rename-Alpha')
  })

  it('enters delete mode and closes cleanly', () => {
    const menu = createMenu()
    menu.openContext(mouseEvent(), { id: 'a', label: 'Alpha', folder: 'team' })
    menu.ctx.value!.error = 'old error'

    menu.enterDelete()
    expect(menu.ctx.value?.mode).toBe('delete')
    expect(menu.ctx.value?.error).toBeNull()

    menu.closeContext()
    expect(menu.ctx.value).toBeNull()
    expect(menu.ctxMoveDestinations.value).toEqual([])
  })
})
