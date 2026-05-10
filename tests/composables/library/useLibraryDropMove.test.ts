import { describe, expect, it, vi } from 'vitest'
import { useLibraryDropMove } from '~/composables/library/useLibraryDropMove'

const fakeDragEvent = {} as DragEvent

describe('useLibraryDropMove', () => {
  it('ignores drops that do not yield a valid payload', async () => {
    const movePayload = vi.fn()
    const dropMove = useLibraryDropMove<string>({
      takeDropPayload: () => null,
      movePayload,
    })
    dropMove.moveError.value = 'previous error'

    await expect(dropMove.onDrop(fakeDragEvent, 'target')).resolves.toBe(false)

    expect(movePayload).not.toHaveBeenCalled()
    expect(dropMove.moving.value).toBe(false)
    expect(dropMove.moveError.value).toBe('previous error')
  })

  it('persists a dropped payload and clears previous errors', async () => {
    let resolveMove!: () => void
    const movePromise = new Promise<void>((resolve) => {
      resolveMove = resolve
    })
    const movePayload = vi.fn(() => movePromise)
    const dropMove = useLibraryDropMove<string>({
      takeDropPayload: () => 'sheet-1',
      movePayload,
    })
    dropMove.moveError.value = 'old error'

    const result = dropMove.onDrop(fakeDragEvent, 'dest')

    expect(dropMove.moving.value).toBe(true)
    expect(dropMove.moveError.value).toBeNull()
    expect(movePayload).toHaveBeenCalledWith('sheet-1', 'dest')

    resolveMove()

    await expect(result).resolves.toBe(true)
    expect(dropMove.moving.value).toBe(false)
    expect(dropMove.moveError.value).toBeNull()
  })

  it('normalizes move errors and calls the optional error hook', async () => {
    const error = { statusMessage: 'Move failed.' }
    const onError = vi.fn()
    const dropMove = useLibraryDropMove<string>({
      takeDropPayload: () => 'map-1',
      movePayload: () => {
        throw error
      },
      onError,
    })

    await expect(dropMove.onDrop(fakeDragEvent, 'dest')).resolves.toBe(false)

    expect(dropMove.moving.value).toBe(false)
    expect(dropMove.moveError.value).toBe('Move failed.')
    expect(onError).toHaveBeenCalledWith(error)
  })

  it('can persist an explicit payload without a drag event', async () => {
    const movePayload = vi.fn()
    const dropMove = useLibraryDropMove<string>({
      takeDropPayload: () => null,
      movePayload,
    })

    await expect(dropMove.persistDroppedPayload('folder-a', 'folder-b')).resolves.toBe(true)

    expect(movePayload).toHaveBeenCalledWith('folder-a', 'folder-b')
    expect(dropMove.moveError.value).toBeNull()
  })
})
