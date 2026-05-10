import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useLibraryDragDrop } from '~/composables/library/useLibraryDragDrop'

type TestDragEvent = DragEvent & {
  dataTransfer: NonNullable<DragEvent['dataTransfer']> & {
    effectAllowed: string
    dropEffect: string
    setData: ReturnType<typeof vi.fn>
  }
  data: Map<string, string>
}

const makeDragEvent = (): TestDragEvent => {
  const data = new Map<string, string>()
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn((type: string, value: string) => data.set(type, value)),
    },
    data,
  } as unknown as TestDragEvent
}

describe('useLibraryDragDrop', () => {
  it('starts allowed drags and writes transfer metadata', () => {
    const canDrag = ref(true)
    const dnd = useLibraryDragDrop<{ from: string }>({
      canDrag,
      canDropPayloadOn: (payload, target) => payload.from !== target,
    })
    const event = makeDragEvent()

    expect(dnd.startDrag(event, { from: 'a' }, { mimeType: 'application/x-test', value: 'payload' })).toBe(true)

    expect(dnd.drag.value).toEqual({ from: 'a' })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.dataTransfer.effectAllowed).toBe('move')
    expect(event.dataTransfer.setData).toHaveBeenCalledWith('application/x-test', 'payload')
  })

  it('prevents blocked drag starts without changing active drag state', () => {
    const canDrag = ref(false)
    const dnd = useLibraryDragDrop<{ from: string }>({
      canDrag,
      canDropPayloadOn: () => true,
    })
    const event = makeDragEvent()

    expect(dnd.startDrag(event, { from: 'a' })).toBe(false)

    expect(dnd.drag.value).toBeNull()
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.dataTransfer.setData).not.toHaveBeenCalled()
  })

  it('tracks hover state only for valid drop targets', () => {
    const dnd = useLibraryDragDrop<{ from: string }>({
      canDrag: true,
      canDropPayloadOn: (payload, target) => payload.from !== target,
    })
    dnd.startDrag(makeDragEvent(), { from: 'root' })

    const invalid = makeDragEvent()
    dnd.onDropEnter(invalid, 'root')
    expect(dnd.hoverTarget.value).toBeNull()
    expect(invalid.preventDefault).not.toHaveBeenCalled()

    const valid = makeDragEvent()
    dnd.onDropOver(valid, 'archive')
    expect(dnd.hoverTarget.value).toBe('archive')
    expect(valid.preventDefault).toHaveBeenCalledTimes(1)
    expect(valid.dataTransfer.dropEffect).toBe('move')

    dnd.onDropLeave('archive')
    expect(dnd.hoverTarget.value).toBeNull()
  })

  it('captures valid drop payloads and clears drag state', () => {
    const dnd = useLibraryDragDrop<{ from: string }>({
      canDrag: true,
      canDropPayloadOn: (payload, target) => payload.from !== target,
    })
    dnd.startDrag(makeDragEvent(), { from: 'a' })
    dnd.hoverTarget.value = 'b'
    const event = makeDragEvent()

    expect(dnd.takeDropPayload(event, 'b')).toEqual({ from: 'a' })
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(dnd.drag.value).toBeNull()
    expect(dnd.hoverTarget.value).toBeNull()
  })

  it('clears invalid drops without returning a payload', () => {
    const dnd = useLibraryDragDrop<{ from: string }>({
      canDrag: true,
      canDropPayloadOn: (payload, target) => payload.from !== target,
    })
    dnd.startDrag(makeDragEvent(), { from: 'a' })
    dnd.hoverTarget.value = 'a'
    const event = makeDragEvent()

    expect(dnd.takeDropPayload(event, 'a')).toBeNull()
    expect(dnd.drag.value).toBeNull()
    expect(dnd.hoverTarget.value).toBeNull()
  })
})
