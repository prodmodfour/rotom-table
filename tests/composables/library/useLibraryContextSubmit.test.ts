import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useLibraryContextSubmit } from '~/composables/library/useLibraryContextSubmit'
import type { LibraryContextState } from '~/composables/library/useLibraryContextMenu'

interface Target {
  id: string
}

const createState = (
  mode: LibraryContextState<Target>['mode'],
  input = 'value',
): LibraryContextState<Target> => ({
  x: 1,
  y: 2,
  target: { id: 'target-1' },
  mode,
  input,
  busy: false,
  error: null,
})

const createSubmitter = (state: LibraryContextState<Target> | null) => {
  const ctx = ref(state)
  const closeContext = vi.fn(() => {
    ctx.value = null
  })
  const onMove = vi.fn()
  const onRename = vi.fn()
  const onDelete = vi.fn()

  const submitter = useLibraryContextSubmit({
    ctx,
    closeContext,
    onMove,
    onRename,
    onDelete,
  })

  return { ctx, closeContext, onMove, onRename, onDelete, ...submitter }
}

describe('useLibraryContextSubmit', () => {
  it('ignores missing or already-busy context state', async () => {
    const missing = createSubmitter(null)
    await expect(missing.submitContext()).resolves.toBe(false)
    expect(missing.closeContext).not.toHaveBeenCalled()

    const busy = createSubmitter({ ...createState('delete'), busy: true })
    await expect(busy.submitContext()).resolves.toBe(false)
    expect(busy.onDelete).not.toHaveBeenCalled()
  })

  it('submits move actions with the selected destination and closes on success', async () => {
    const state = createState('move', 'archive')
    const submitter = createSubmitter(state)

    await expect(submitter.submitContext()).resolves.toBe(true)

    expect(submitter.onMove).toHaveBeenCalledWith({ id: 'target-1' }, 'archive', state)
    expect(submitter.onRename).not.toHaveBeenCalled()
    expect(submitter.closeContext).toHaveBeenCalledTimes(1)
    expect(submitter.ctx.value).toBeNull()
  })

  it('trims rename input and validates blank names without closing', async () => {
    const renameState = createState('rename', '  New name  ')
    const renameSubmitter = createSubmitter(renameState)

    await expect(renameSubmitter.submitContext()).resolves.toBe(true)
    expect(renameSubmitter.onRename).toHaveBeenCalledWith({ id: 'target-1' }, 'New name', renameState)

    const blankState = createState('rename', '   ')
    const blankSubmitter = createSubmitter(blankState)

    await expect(blankSubmitter.submitContext()).resolves.toBe(false)

    expect(blankSubmitter.onRename).not.toHaveBeenCalled()
    expect(blankState.error).toBe('Name required.')
    expect(blankState.busy).toBe(false)
    expect(blankSubmitter.closeContext).not.toHaveBeenCalled()
  })

  it('submits delete actions', async () => {
    const state = createState('delete')
    const submitter = createSubmitter(state)

    await expect(submitter.submitContext()).resolves.toBe(true)

    expect(submitter.onDelete).toHaveBeenCalledWith({ id: 'target-1' }, state)
    expect(submitter.closeContext).toHaveBeenCalledTimes(1)
  })

  it('normalizes handler errors and clears busy state', async () => {
    const state = createState('delete')
    const ctx = ref(state)
    const submitter = useLibraryContextSubmit({
      ctx,
      closeContext: vi.fn(),
      onMove: vi.fn(),
      onRename: vi.fn(),
      onDelete: () => {
        throw { data: { statusMessage: 'Delete failed.' } }
      },
    })

    await expect(submitter.submitContext()).resolves.toBe(false)

    expect(ctx.value).toMatchObject({
      mode: 'delete',
      error: 'Delete failed.',
      busy: false,
      target: { id: 'target-1' },
    })
  })
})
