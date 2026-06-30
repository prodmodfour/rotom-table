import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { normalizeRevision } from '#shared/sessionRevisions'
import { GROUP_INVENTORY_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { deepCloneJson, stableJsonStringify } from '~/utils/serialization'
import { useApiClient } from '~/composables/useApiClient'
import type { GroupInventoryDocument } from '~/types/groupInventory'

export type GroupInventorySaveStatus = 'idle' | 'saving' | 'saved' | 'conflict' | 'error'

export interface SaveGroupInventoryResponse {
  readonly ok: true
  readonly changed: boolean
  readonly document: GroupInventoryDocument
}

export interface UseGroupInventoryEditorOptions {
  readonly canEdit: Readonly<Ref<boolean>> | ComputedRef<boolean>
}

export interface UseGroupInventoryEditorReturn {
  readonly document: Ref<GroupInventoryDocument | null>
  readonly isDirty: ComputedRef<boolean>
  readonly saveStatus: Ref<GroupInventorySaveStatus>
  readonly saveError: Ref<string | null>
  readonly adoptAuthoritativeDocument: (nextDocument: GroupInventoryDocument | null | undefined) => void
  readonly save: () => Promise<void>
}

const cloneDocument = (document: GroupInventoryDocument): GroupInventoryDocument => deepCloneJson(document)

const documentJson = (document: GroupInventoryDocument | null): string => (
  document ? stableJsonStringify(document) : 'null'
)

const numericErrorField = (source: unknown, field: string): number | null => {
  if (!source || typeof source !== 'object') return null
  const value = (source as Record<string, unknown>)[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const errorStatusCode = (error: unknown): number | null => {
  for (const field of ['statusCode', 'status'] as const) {
    const directStatus = numericErrorField(error, field)
    if (directStatus !== null) return directStatus
  }

  const response = error && typeof error === 'object'
    ? (error as Record<string, unknown>).response
    : null
  return numericErrorField(response, 'status')
}

const isConflictError = (error: unknown): boolean => (
  errorStatusCode(error) === 409 || getErrorMessage(error).toLowerCase().includes('reload before saving')
)

export const useGroupInventoryEditor = (
  source: Readonly<Ref<GroupInventoryDocument | null | undefined>>,
  options: UseGroupInventoryEditorOptions,
): UseGroupInventoryEditorReturn => {
  const document = ref<GroupInventoryDocument | null>(null)
  const saveStatus = ref<GroupInventorySaveStatus>('idle')
  const saveError = ref<string | null>(null)
  const lastAuthoritativeJson = ref(documentJson(null))
  const { postJson } = useApiClient()

  const adoptAuthoritativeDocument = (nextDocument: GroupInventoryDocument | null | undefined): void => {
    document.value = nextDocument ? cloneDocument(nextDocument) : null
    lastAuthoritativeJson.value = documentJson(document.value)
    saveError.value = null
    saveStatus.value = 'idle'
  }

  watch(
    source,
    (nextDocument) => {
      adoptAuthoritativeDocument(nextDocument)
    },
    { immediate: true },
  )

  const isDirty = computed(() => documentJson(document.value) !== lastAuthoritativeJson.value)

  const save = async (): Promise<void> => {
    if (!options.canEdit.value) {
      saveStatus.value = 'error'
      saveError.value = 'Only GMs can save the shared inventory.'
      return
    }

    const currentDocument = document.value
    if (!currentDocument) {
      saveStatus.value = 'error'
      saveError.value = 'No shared inventory document is loaded.'
      return
    }

    if (!isDirty.value) {
      saveStatus.value = 'saved'
      saveError.value = null
      return
    }

    saveStatus.value = 'saving'
    saveError.value = null

    try {
      const response = await postJson<SaveGroupInventoryResponse>(GROUP_INVENTORY_API_PATHS.save, {
        slug: currentDocument.slug,
        expectedRevision: normalizeRevision(currentDocument.revision),
        document: cloneDocument(currentDocument),
      })
      document.value = cloneDocument(response.document)
      lastAuthoritativeJson.value = documentJson(document.value)
      saveStatus.value = 'saved'
      saveError.value = null
    } catch (error) {
      saveStatus.value = isConflictError(error) ? 'conflict' : 'error'
      saveError.value = getErrorMessage(error, { fallback: 'The shared inventory could not be saved.' })
    }
  }

  return {
    document,
    isDirty,
    saveStatus,
    saveError,
    adoptAuthoritativeDocument,
    save,
  }
}
