import { computed, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { normalizeRevision } from '#shared/sessionRevisions'
import { GROUP_INVENTORY_API_PATHS, SHEET_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { buildSheetListFetchOptions, sheetApiProfileContext } from '~/utils/sheetApiRequests'
import { useApiClient } from '~/composables/useApiClient'
import type { ApiClient } from '~/utils/apiClient'
import { getClientId } from '~/utils/clientId'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TrainerInventory, TrainerSheet } from '~/types/trainerSheet'
import type {
  GroupInventoryTrainerLoadStatus,
  GroupInventoryTransferStatus,
  GroupInventoryTransferToGroupRequest,
  GroupInventoryTransferToTrainerRequest,
  GroupInventoryTransferTrainerOption,
} from '~/types/groupInventoryTransferUi'

interface SheetListResponse {
  readonly trainerSheets?: readonly TrainerSheet[]
}

interface TransferResponseTrainerSheet {
  readonly kind: 'trainer'
  readonly slug: string
  readonly sheet: Record<string, unknown>
}

interface GroupInventoryTransferResponse {
  readonly ok: true
  readonly groupInventory: GroupInventoryDocument
  readonly trainerSheet: TransferResponseTrainerSheet
}

export interface UseGroupInventoryTransfersOptions {
  readonly groupInventoryDocument: Readonly<Ref<GroupInventoryDocument | null | undefined>>
  readonly adoptGroupInventoryDocument: (document: GroupInventoryDocument) => void
  readonly isGm: Readonly<Ref<boolean>> | ComputedRef<boolean>
  readonly isPlayer: Readonly<Ref<boolean>> | ComputedRef<boolean>
  readonly selectedProfileId: Readonly<Ref<PlayerProfileId | null | undefined>> | ComputedRef<PlayerProfileId | null | undefined>
  readonly transferBlocked?: Readonly<Ref<boolean>> | ComputedRef<boolean>
  readonly apiClient?: ApiClient
  readonly autoLoadTrainers?: boolean
}

export interface UseGroupInventoryTransfersReturn {
  readonly trainerSheets: Ref<TrainerSheet[]>
  readonly eligibleTrainers: ComputedRef<readonly GroupInventoryTransferTrainerOption[]>
  readonly trainerLoadStatus: Ref<GroupInventoryTrainerLoadStatus>
  readonly trainerLoadError: Ref<string | null>
  readonly transferStatus: Ref<GroupInventoryTransferStatus>
  readonly transferError: Ref<string | null>
  readonly transferNotice: Ref<string | null>
  readonly transferUnavailableReason: ComputedRef<string | null>
  readonly canTransfer: ComputedRef<boolean>
  readonly loadTrainers: () => Promise<void>
  readonly transferToTrainer: (request: GroupInventoryTransferToTrainerRequest) => Promise<void>
  readonly transferToGroup: (request: GroupInventoryTransferToGroupRequest) => Promise<void>
}

const DEFAULT_TRANSFER_ERROR = 'The inventory transfer could not be completed.'
const SELECT_PROFILE_MESSAGE = 'Choose a player profile before transferring inventory for linked trainer sheets.'

const trainerName = (sheet: TrainerSheet): string => sheet.name?.trim() || sheet.slug

const compareTrainers = (left: TrainerSheet, right: TrainerSheet): number => {
  const nameOrder = trainerName(left).localeCompare(trainerName(right))
  return nameOrder === 0 ? left.slug.localeCompare(right.slug) : nameOrder
}

const trainerInventory = (sheet: TrainerSheet): TrainerInventory => sheet.inventory ?? {}

const normalizeTransferTrainerOption = (sheet: TrainerSheet): GroupInventoryTransferTrainerOption => ({
  slug: sheet.slug,
  name: trainerName(sheet),
  revision: normalizeRevision(sheet.revision),
  inventory: trainerInventory(sheet),
  sheet,
  ...(sheet.playerProfileAccessible === true ? { playerProfileAccessible: true } : {}),
})

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
  errorStatusCode(error) === 409 || getErrorMessage(error).toLowerCase().includes('reload before transferring')
)

const trainerSheetFromResponse = (
  responseTrainerSheet: TransferResponseTrainerSheet,
  previous: TrainerSheet | undefined,
): TrainerSheet => {
  const sheet = responseTrainerSheet.sheet as unknown as TrainerSheet
  return {
    ...sheet,
    slug: sheet.slug || responseTrainerSheet.slug,
    revision: normalizeRevision(sheet.revision),
    ...(previous?.playerProfileAccessible === true && sheet.playerProfileAccessible !== true
      ? { playerProfileAccessible: true }
      : {}),
    ...(previous?.sessionPlayerAccessible === true && sheet.sessionPlayerAccessible !== true
      ? { sessionPlayerAccessible: true }
      : {}),
  }
}

export const useGroupInventoryTransfers = (
  options: UseGroupInventoryTransfersOptions,
): UseGroupInventoryTransfersReturn => {
  const apiClient = options.apiClient ?? useApiClient()
  const trainerSheets = ref<TrainerSheet[]>([])
  const trainerLoadStatus = ref<GroupInventoryTrainerLoadStatus>('idle')
  const trainerLoadError = ref<string | null>(null)
  const transferStatus = ref<GroupInventoryTransferStatus>('idle')
  const transferError = ref<string | null>(null)
  const transferNotice = ref<string | null>(null)
  const autoLoadTrainers = options.autoLoadTrainers !== false

  const eligibleTrainers = computed<readonly GroupInventoryTransferTrainerOption[]>(() => {
    if (options.isGm.value) return [...trainerSheets.value].sort(compareTrainers).map(normalizeTransferTrainerOption)
    if (!options.isPlayer.value) return []

    return trainerSheets.value
      .filter((sheet) => sheet.playerProfileAccessible === true)
      .sort(compareTrainers)
      .map(normalizeTransferTrainerOption)
  })

  const transferUnavailableReason = computed<string | null>(() => {
    if (!options.isGm.value && !options.isPlayer.value) {
      return 'Log in as a GM or player before transferring shared inventory.'
    }
    if (options.isPlayer.value && !options.selectedProfileId.value) return SELECT_PROFILE_MESSAGE
    if (!options.groupInventoryDocument.value) return 'Load the shared inventory before transferring items.'
    if (options.transferBlocked?.value === true) return 'Save or reload shared inventory edits before transferring items.'
    if (trainerLoadStatus.value === 'loading') return 'Trainer sheets are still loading.'
    if (trainerLoadStatus.value === 'error') return trainerLoadError.value ?? 'Trainer sheets could not be loaded.'
    if (eligibleTrainers.value.length === 0) {
      return options.isPlayer.value
        ? 'No trainer sheets linked to the selected player profile are available for transfers.'
        : 'No trainer sheets are available for transfers.'
    }
    return null
  })

  const canTransfer = computed(() => transferUnavailableReason.value === null && transferStatus.value !== 'loading')

  const loadTrainers = async (): Promise<void> => {
    if (!options.isGm.value && !options.isPlayer.value) {
      trainerSheets.value = []
      trainerLoadStatus.value = 'idle'
      trainerLoadError.value = null
      return
    }

    if (options.isPlayer.value && !options.selectedProfileId.value) {
      trainerSheets.value = []
      trainerLoadStatus.value = 'idle'
      trainerLoadError.value = null
      return
    }

    trainerLoadStatus.value = 'loading'
    trainerLoadError.value = null
    try {
      const response = await apiClient.getJson<SheetListResponse>(
        SHEET_API_PATHS.list,
        buildSheetListFetchOptions(sheetApiProfileContext(options.isPlayer.value, options.selectedProfileId.value)),
      )
      trainerSheets.value = [...(response.trainerSheets ?? [])].sort(compareTrainers)
      trainerLoadStatus.value = 'loaded'
    } catch (error) {
      trainerLoadStatus.value = 'error'
      trainerLoadError.value = getErrorMessage(error, { fallback: 'Trainer sheets could not be loaded.' })
    }
  }

  const setTransferFailure = (error: unknown): void => {
    transferStatus.value = isConflictError(error) ? 'conflict' : 'error'
    transferError.value = getErrorMessage(error, { fallback: DEFAULT_TRANSFER_ERROR })
    transferNotice.value = null
  }

  const setValidationFailure = (message: string): void => {
    transferStatus.value = 'error'
    transferError.value = message
    transferNotice.value = null
  }

  const requireTransferReady = (): GroupInventoryDocument | null => {
    const unavailableReason = transferUnavailableReason.value
    if (unavailableReason) {
      setValidationFailure(unavailableReason)
      return null
    }

    const document = options.groupInventoryDocument.value
    if (!document) {
      setValidationFailure('Load the shared inventory before transferring items.')
      return null
    }

    return document
  }

  const findEligibleTrainer = (trainerSlug: string): GroupInventoryTransferTrainerOption | null => {
    const trainer = eligibleTrainers.value.find((option) => option.slug === trainerSlug)
    if (!trainer) {
      setValidationFailure('Selected trainer is not eligible for group inventory transfers.')
      return null
    }
    return trainer
  }

  const profilePayload = (): { profileId?: PlayerProfileId } => (
    options.isPlayer.value && options.selectedProfileId.value
      ? { profileId: options.selectedProfileId.value }
      : {}
  )

  const adoptTransferResponse = (response: GroupInventoryTransferResponse): void => {
    options.adoptGroupInventoryDocument(response.groupInventory)

    const previous = trainerSheets.value.find((sheet) => sheet.slug === response.trainerSheet.slug)
    const nextTrainer = trainerSheetFromResponse(response.trainerSheet, previous)
    const replaced = trainerSheets.value.some((sheet) => sheet.slug === nextTrainer.slug)
    trainerSheets.value = (
      replaced
        ? trainerSheets.value.map((sheet) => (sheet.slug === nextTrainer.slug ? nextTrainer : sheet))
        : [...trainerSheets.value, nextTrainer]
    ).sort(compareTrainers)
  }

  const transferToTrainer = async (request: GroupInventoryTransferToTrainerRequest): Promise<void> => {
    const document = requireTransferReady()
    if (!document) return
    const trainer = findEligibleTrainer(request.trainerSlug)
    if (!trainer) return

    transferStatus.value = 'loading'
    transferError.value = null
    transferNotice.value = null

    try {
      const response = await apiClient.postJson<GroupInventoryTransferResponse>(GROUP_INVENTORY_API_PATHS.transferToTrainer, {
        groupSlug: document.slug,
        groupRevision: normalizeRevision(document.revision),
        trainerSlug: trainer.slug,
        trainerRevision: trainer.revision,
        section: request.section,
        itemId: request.itemId,
        quantity: request.quantity,
        clientId: getClientId(),
        ...profilePayload(),
      })
      adoptTransferResponse(response)
      transferStatus.value = 'success'
      transferError.value = null
      transferNotice.value = `Transferred inventory to ${trainer.name}.`
    } catch (error) {
      setTransferFailure(error)
    }
  }

  const transferToGroup = async (request: GroupInventoryTransferToGroupRequest): Promise<void> => {
    const document = requireTransferReady()
    if (!document) return
    const trainer = findEligibleTrainer(request.trainerSlug)
    if (!trainer) return

    transferStatus.value = 'loading'
    transferError.value = null
    transferNotice.value = null

    try {
      const response = await apiClient.postJson<GroupInventoryTransferResponse>(GROUP_INVENTORY_API_PATHS.transferToGroup, {
        trainerSlug: trainer.slug,
        trainerRevision: trainer.revision,
        groupSlug: document.slug,
        groupRevision: normalizeRevision(document.revision),
        section: request.section,
        trainerRowIndex: request.trainerRowIndex,
        quantity: request.quantity,
        clientId: getClientId(),
        ...profilePayload(),
      })
      adoptTransferResponse(response)
      transferStatus.value = 'success'
      transferError.value = null
      transferNotice.value = `Transferred inventory from ${trainer.name}.`
    } catch (error) {
      setTransferFailure(error)
    }
  }

  watch(
    () => options.groupInventoryDocument.value?.revision ?? null,
    () => {
      if (transferStatus.value !== 'conflict') return
      transferStatus.value = 'idle'
      transferError.value = null
      transferNotice.value = null
    },
  )

  if (autoLoadTrainers) {
    onMounted(() => {
      void loadTrainers()
    })

    watch(
      () => [options.isGm.value, options.isPlayer.value, options.selectedProfileId.value] as const,
      () => {
        if (typeof window === 'undefined') return
        void loadTrainers()
      },
    )
  }

  return {
    trainerSheets,
    eligibleTrainers,
    trainerLoadStatus,
    trainerLoadError,
    transferStatus,
    transferError,
    transferNotice,
    transferUnavailableReason,
    canTransfer,
    loadTrainers,
    transferToTrainer,
    transferToGroup,
  }
}
