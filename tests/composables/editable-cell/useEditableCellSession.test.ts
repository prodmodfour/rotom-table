import { describe, expect, it } from 'vitest'
import { useEditableCellSession } from '~/composables/editable-cell/useEditableCellSession'
import type { EditableCellType, EditableCellValue } from '~/utils/editableCell'

const createSession = (overrides: Partial<{
  value: EditableCellValue
  type: EditableCellType
  readonly: boolean
  min: number
  max: number
  commitOnInput: boolean
}> = {}) => {
  let value: EditableCellValue = overrides.value ?? 'start'
  const updates: EditableCellValue[] = []
  const commits: EditableCellValue[] = []
  const session = useEditableCellSession({
    value: () => value,
    type: () => overrides.type ?? 'text',
    readonly: () => overrides.readonly ?? false,
    min: () => overrides.min,
    max: () => overrides.max,
    commitOnInput: () => overrides.commitOnInput ?? true,
    onUpdate: (next) => {
      updates.push(next)
      value = next
    },
    onCommit: (next) => commits.push(next),
  })

  return {
    session,
    updates,
    commits,
    get value() {
      return value
    },
    set value(next: EditableCellValue) {
      value = next
    },
  }
}

describe('useEditableCellSession', () => {
  it('opens editable sessions with a draft unless readonly', () => {
    const blocked = createSession({ readonly: true })
    blocked.session.beginEdit()
    expect(blocked.session.editing.value).toBe(false)

    const editable = createSession({ value: 42 })
    editable.session.beginEdit()

    expect(editable.session.editing.value).toBe(true)
    expect(editable.session.draft.value).toBe('42')
  })

  it('commits draft changes on input and rolls back to the session start on cancel', () => {
    const context = createSession({ value: 'old' })

    context.session.beginEdit()
    context.session.draft.value = 'new'
    context.session.onEditorInput()

    expect(context.updates).toEqual(['new'])
    expect(context.value).toBe('new')

    context.session.cancel()

    expect(context.updates).toEqual(['new', 'old'])
    expect(context.session.editing.value).toBe(false)
  })

  it('delays updates when commitOnInput is disabled and commits clamped number drafts', () => {
    const context = createSession({ value: 5, type: 'number', min: 0, max: 10, commitOnInput: false })

    context.session.beginEdit()
    context.session.draft.value = '99'
    context.session.onEditorInput()

    expect(context.updates).toEqual([])
    expect(context.value).toBe(5)

    context.session.commit()

    expect(context.updates).toEqual([10])
    expect(context.commits).toEqual([10])
    expect(context.value).toBe(10)
  })

  it('guards against duplicate commit events from blur after enter', () => {
    const context = createSession({ value: 'before' })

    context.session.beginEdit()
    context.session.draft.value = 'after'
    context.session.commit()
    context.session.commit()

    expect(context.updates).toEqual(['after'])
    expect(context.commits).toEqual(['after'])
    expect(context.session.editing.value).toBe(false)
  })
})
