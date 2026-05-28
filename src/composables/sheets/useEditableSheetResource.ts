import { computed, type ComputedRef } from 'vue'
import { deepCloneJson } from '~/utils/serialization'
import { useEditableSheet, type SaveStatus, type UseEditableSheetReturn } from '~/composables/useEditableSheet'
import {
  resolveSheetEditorCapabilities,
  type SheetEditorCapabilities,
  type SheetEditorCapabilitySheet,
} from '~/utils/sheetEditorCapabilities'
import type { SheetApiProfileContext } from '~/utils/sheetApiRequests'
import type { SheetKind } from '#shared/sheets'

export interface EditableSheetResourceOptions<TSheet extends { slug: string; player?: boolean } & SheetEditorCapabilitySheet> {
  baseSheet: TSheet | null
  kind: SheetKind
  isPlayer: ComputedRef<boolean>
  isGm?: ComputedRef<boolean>
  normalize: (sheet: TSheet) => TSheet
  prepareInitial?: (sheet: TSheet) => void
  profileContext?: () => SheetApiProfileContext
}

export interface EditableSheetResource<TSheet extends { slug: string }> {
  editor: UseEditableSheetReturn<TSheet> | null
  sheet: ComputedRef<TSheet | null>
  editorCapabilities: ComputedRef<SheetEditorCapabilities>
  saveStatus: ComputedRef<SaveStatus>
  saveError: ComputedRef<string | null>
  renamedTo: ComputedRef<string | null>
}

const isPlayerAccessibleSheet = (sheet: SheetEditorCapabilitySheet): boolean => (
  sheet.player === true ||
  sheet.sessionPlayerAccessible === true ||
  sheet.playerProfileAccessible === true
)

export function useEditableSheetResource<TSheet extends { slug: string; player?: boolean } & SheetEditorCapabilitySheet>(
  options: EditableSheetResourceOptions<TSheet>,
): EditableSheetResource<TSheet> {
  const canAccessBaseSheet = computed(() => Boolean(
    options.baseSheet && (
      !options.isPlayer.value ||
      isPlayerAccessibleSheet(options.baseSheet)
    ),
  ))
  const isProfileLinkedPlayerSheet = (): boolean => Boolean(
    options.isPlayer.value &&
    options.baseSheet &&
    options.baseSheet.playerProfileAccessible === true,
  )
  const requiresSelectedPlayerProfile = (): boolean => isProfileLinkedPlayerSheet()
  const allowSlugSync = (): boolean => !isProfileLinkedPlayerSheet()

  const initialClone = canAccessBaseSheet.value && options.baseSheet
    ? options.normalize(deepCloneJson(options.baseSheet))
    : null

  if (initialClone) options.prepareInitial?.(initialClone)

  const editor = initialClone ? useEditableSheet(initialClone, options.kind, {
    profileContext: options.profileContext,
    requiresSelectedPlayerProfile,
    allowSlugSync,
  }) : null
  const sheet = computed<TSheet | null>(() => editor?.sheet.value ?? null)
  const editorCapabilities = computed<SheetEditorCapabilities>(() => resolveSheetEditorCapabilities({
    isGm: options.isGm?.value ?? !options.isPlayer.value,
    isPlayer: options.isPlayer.value,
    sheet: options.baseSheet,
    hasEditableResource: Boolean(editor),
  }))
  const saveStatus = computed<SaveStatus>(() => editor?.saveStatus.value ?? 'idle')
  const saveError = computed<string | null>(() => editor?.saveError.value ?? null)
  const renamedTo = computed<string | null>(() => editor?.renamedTo.value ?? null)

  return {
    editor,
    sheet,
    editorCapabilities,
    saveStatus,
    saveError,
    renamedTo,
  }
}
