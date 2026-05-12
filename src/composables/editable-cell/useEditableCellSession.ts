import { ref } from 'vue'
import {
  editableCellDraftFromValue,
  parseEditableCellDraft,
  type EditableCellType,
  type EditableCellValue,
} from '~/utils/editableCell'

export interface EditableCellSessionOptions {
  value: () => EditableCellValue
  type: () => EditableCellType
  readonly?: () => boolean
  min?: () => number | undefined
  max?: () => number | undefined
  commitOnInput?: () => boolean
  onUpdate: (value: EditableCellValue) => void
  onCommit: (value: EditableCellValue) => void
}

export const useEditableCellSession = (options: EditableCellSessionOptions) => {
  const editing = ref(false)
  const draft = ref('')
  const sessionStartValue = ref<EditableCellValue>(undefined)
  let committedThisSession = false

  const isReadonly = () => options.readonly?.() ?? false
  const shouldCommitOnInput = () => options.commitOnInput?.() ?? true

  const beginEdit = () => {
    if (isReadonly()) return

    sessionStartValue.value = options.value()
    draft.value = editableCellDraftFromValue(options.value())
    committedThisSession = false
    editing.value = true
  }

  const parseDraft = (raw: string): EditableCellValue => parseEditableCellDraft(raw, {
    type: options.type(),
    currentValue: options.value(),
    min: options.min?.(),
    max: options.max?.(),
  })

  const applyDraft = (emitCommit = false) => {
    const next = parseDraft(draft.value)
    if (next !== options.value()) options.onUpdate(next)
    if (emitCommit) options.onCommit(next)
  }

  const commit = () => {
    if (committedThisSession) {
      editing.value = false
      return
    }

    committedThisSession = true
    applyDraft(true)
    editing.value = false
  }

  const cancel = () => {
    committedThisSession = true
    if (shouldCommitOnInput() && options.value() !== sessionStartValue.value) {
      options.onUpdate(sessionStartValue.value)
    }
    editing.value = false
  }

  const onEditorInput = () => {
    if (shouldCommitOnInput()) applyDraft()
  }

  return {
    editing,
    draft,
    beginEdit,
    commit,
    cancel,
    onEditorInput,
  }
}
