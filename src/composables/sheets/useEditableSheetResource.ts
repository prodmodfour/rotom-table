import {
  computed,
  effectScope,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
  type EffectScope,
  type MaybeRefOrGetter,
} from 'vue'
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
  baseSheet: MaybeRefOrGetter<TSheet | null | undefined>
  kind: SheetKind
  isPlayer: ComputedRef<boolean>
  isGm?: ComputedRef<boolean>
  normalize: (sheet: TSheet) => TSheet
  prepareInitial?: (sheet: TSheet) => void
  profileContext?: () => SheetApiProfileContext
}

export interface EditableSheetResource<TSheet extends { slug: string }> {
  readonly editor: UseEditableSheetReturn<TSheet> | null
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
  const baseSheet = computed<TSheet | null>(() => toValue(options.baseSheet) ?? null)
  const canAccessBaseSheet = computed(() => Boolean(
    baseSheet.value && (
      !options.isPlayer.value ||
      isPlayerAccessibleSheet(baseSheet.value)
    ),
  ))
  const editor = shallowRef<UseEditableSheetReturn<TSheet> | null>(null)
  let editorScope: EffectScope | null = null

  const isProfileLinkedPlayerSheet = (): boolean => Boolean(
    options.isPlayer.value &&
    baseSheet.value &&
    baseSheet.value.playerProfileAccessible === true,
  )
  const requiresSelectedPlayerProfile = (): boolean => isProfileLinkedPlayerSheet()
  const allowSlugSync = (): boolean => !isProfileLinkedPlayerSheet()

  const createEditor = (sourceSheet: TSheet): void => {
    if (editor.value) return

    const initialClone = options.normalize(deepCloneJson(sourceSheet))
    options.prepareInitial?.(initialClone)

    const scope = effectScope()
    const nextEditor = scope.run(() => useEditableSheet(initialClone, options.kind, {
      profileContext: options.profileContext,
      requiresSelectedPlayerProfile,
      allowSlugSync,
    }))

    if (!nextEditor) {
      scope.stop()
      return
    }

    editorScope = scope
    editor.value = nextEditor
  }

  watch(
    [baseSheet, canAccessBaseSheet],
    ([nextBaseSheet, nextCanAccess]) => {
      if (!nextBaseSheet || !nextCanAccess || editor.value) return
      createEditor(nextBaseSheet)
    },
    { immediate: true },
  )

  if (getCurrentScope()) {
    onScopeDispose(() => {
      editorScope?.stop()
      editorScope = null
      editor.value = null
    })
  }

  const sheet = computed<TSheet | null>(() => editor.value?.sheet.value ?? null)
  const capabilitySheet = computed<SheetEditorCapabilitySheet | null>(() => sheet.value ?? baseSheet.value)
  const editorCapabilities = computed<SheetEditorCapabilities>(() => resolveSheetEditorCapabilities({
    isGm: options.isGm?.value ?? !options.isPlayer.value,
    isPlayer: options.isPlayer.value,
    sheet: capabilitySheet.value,
    hasEditableResource: Boolean(editor.value),
  }))
  const saveStatus = computed<SaveStatus>(() => editor.value?.saveStatus.value ?? 'idle')
  const saveError = computed<string | null>(() => editor.value?.saveError.value ?? null)
  const renamedTo = computed<string | null>(() => editor.value?.renamedTo.value ?? null)

  return {
    get editor() {
      return editor.value
    },
    sheet,
    editorCapabilities,
    saveStatus,
    saveError,
    renamedTo,
  }
}
