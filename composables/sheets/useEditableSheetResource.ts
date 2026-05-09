import { computed, type ComputedRef } from 'vue'
import { deepCloneJson } from '~/utils/serialization'
import { useEditableSheet, type SaveStatus, type UseEditableSheetReturn } from '~/composables/useEditableSheet'
import type { SheetKind } from '~/shared/sheets'

export interface EditableSheetResourceOptions<TSheet extends { slug: string; player?: boolean }> {
  baseSheet: TSheet | null
  kind: SheetKind
  isPlayer: ComputedRef<boolean>
  normalize: (sheet: TSheet) => TSheet
  prepareInitial?: (sheet: TSheet) => void
}

export interface EditableSheetResource<TSheet extends { slug: string }> {
  editor: UseEditableSheetReturn<TSheet> | null
  sheet: ComputedRef<TSheet | null>
  saveStatus: ComputedRef<SaveStatus>
  saveError: ComputedRef<string | null>
}

export function useEditableSheetResource<TSheet extends { slug: string; player?: boolean }>(
  options: EditableSheetResourceOptions<TSheet>,
): EditableSheetResource<TSheet> {
  const canAccessBaseSheet = computed(() => Boolean(
    options.baseSheet && (!options.isPlayer.value || options.baseSheet.player === true),
  ))

  const initialClone = canAccessBaseSheet.value && options.baseSheet
    ? options.normalize(deepCloneJson(options.baseSheet))
    : null

  if (initialClone) options.prepareInitial?.(initialClone)

  const editor = initialClone ? useEditableSheet(initialClone, options.kind) : null
  const sheet = computed<TSheet | null>(() => editor?.sheet.value ?? null)
  const saveStatus = computed<SaveStatus>(() => editor?.saveStatus.value ?? 'idle')
  const saveError = computed<string | null>(() => editor?.saveError.value ?? null)

  return {
    editor,
    sheet,
    saveStatus,
    saveError,
  }
}
