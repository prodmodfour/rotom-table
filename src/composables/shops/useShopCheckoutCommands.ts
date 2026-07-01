import { computed, getCurrentScope, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'
import { isAuthRole, type AuthRole } from '#shared/auth'
import {
  isLivePlayCommandRejectionReason,
  isLivePlayOpId,
  type LivePlayRandomUuidProvider,
  type ShopCheckoutCommandAccepted,
  type ShopCheckoutCommandDuplicate,
  type ShopCheckoutCommandRejected,
  type ShopCheckoutCommandResult,
  type ShopCheckoutDeliveryTarget,
  type ShopCheckoutLineInput,
  type ShopCheckoutPaymentSource,
  validateShopCheckoutCommandEnvelope,
} from '#shared/livePlayCommands'
import { isSlug } from '#shared/paths'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import { bindPendingLivePlayCommandUnloadWarning } from '~/utils/livePlayCommandUnloadWarning'
import {
  getLivePlayCommandOutbox,
  isShopCheckoutCommandOutboxEntry,
  type LivePlayCommandOutbox,
  type LivePlayCommandOutboxAuthContext,
  type LivePlayCommandOutboxEntry,
  type ShopCheckoutCommandOutboxEntry,
} from '~/utils/livePlayCommandOutbox'
import {
  buildShopCheckoutCommand,
  type ShopCheckoutCommandBody,
} from '~/utils/shopCheckoutCommandBuilder'
import { deepCloneJson } from '~/utils/serialization'
import { useApiClient } from '~/composables/useApiClient'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { ShopTableDocument } from '~/types/shop'
import type { TrainerSheet } from '~/types/trainerSheet'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export type ShopCheckoutCommandStatus =
  | 'idle'
  | 'sending'
  | 'accepted'
  | 'rejected'
  | 'stale'
  | 'uncertain'
  | 'error'

export type ShopCheckoutOutboxStatus =
  | 'idle'
  | 'loading'
  | 'retrying'
  | 'discarding'
  | 'error'

export interface ShopCheckoutCommandInput {
  readonly shopSlug?: string
  readonly shopRevision?: number
  readonly paymentSource: ShopCheckoutPaymentSource
  readonly deliveryTarget: ShopCheckoutDeliveryTarget
  readonly lines: readonly ShopCheckoutLineInput[]
  readonly opId?: string
  readonly randomUuid?: LivePlayRandomUuidProvider
}

export interface ShopCheckoutCommandDispatchResult {
  readonly dispatched: boolean
  readonly opId?: string
  readonly response?: ShopCheckoutCommandResult
  readonly message?: string
  readonly uncertain?: boolean
  readonly outboxError?: string
}

export type ShopCheckoutOutboxDiscardResult =
  | {
      readonly discarded: true
      readonly opId: string
      readonly entry: ShopCheckoutCommandOutboxEntry
      readonly message?: string
    }
  | {
      readonly discarded: false
      readonly opId: string
      readonly message: string
    }

export interface ShopCheckoutApiClient {
  readonly postJson: (request: string, body: unknown) => Promise<unknown>
}

export interface UseShopCheckoutCommandsOptions {
  readonly authRole: ReadonlyValueRef<AuthRole | null | undefined>
  readonly playerProfileId?: ReadonlyValueRef<PlayerProfileId | null | undefined>
  readonly shop?: ReadonlyValueRef<ShopTableDocument | null | undefined>
  readonly shopSlug?: ReadonlyValueRef<string | null | undefined>
  readonly apiClient?: ShopCheckoutApiClient
  readonly outbox?: LivePlayCommandOutbox
  readonly leaseOwner?: string
  readonly clientId?: () => string
  readonly adoptShop?: (shop: ShopTableDocument) => void
  readonly adoptGroupInventory?: (document: GroupInventoryDocument) => void
  readonly adoptTrainerSheet?: (sheet: TrainerSheet) => void
  readonly onCheckoutStarted?: (opId: string) => void
  readonly onCheckoutAccepted?: (response: ShopCheckoutCommandAccepted) => void
  readonly onCheckoutRejected?: (transition: {
    readonly response: ShopCheckoutCommandRejected
    readonly message: string
  }) => void
  readonly onCheckoutFailed?: (message: string) => void
}

export interface UseShopCheckoutCommandsReturn {
  readonly status: Ref<ShopCheckoutCommandStatus>
  readonly lastError: Ref<string | null>
  readonly pendingOutboxEntries: ComputedRef<readonly ShopCheckoutCommandOutboxEntry[]>
  readonly outboxStatus: Ref<ShopCheckoutOutboxStatus>
  readonly outboxError: Ref<string | null>
  readonly hasPendingOutboxEntries: ComputedRef<boolean>
  readonly clearError: () => void
  readonly refreshPendingOutboxEntries: () => Promise<readonly ShopCheckoutCommandOutboxEntry[]>
  readonly checkout: (input: ShopCheckoutCommandInput) => Promise<ShopCheckoutCommandDispatchResult>
  readonly retryOutboxEntry: (opId: string) => Promise<ShopCheckoutCommandDispatchResult>
  readonly discardOutboxEntry: (opId: string) => Promise<ShopCheckoutOutboxDiscardResult>
}

type UnknownRecord = Record<string, unknown>

type TerminalValidationResult =
  | { readonly valid: true; readonly response: ShopCheckoutCommandResult }
  | { readonly valid: false; readonly issues: readonly string[] }

const SHOP_CHECKOUT_REQUEST_PATHS = new Set<string>([SHOP_API_PATHS.checkout])

const shopCheckoutLeaseOwner = (): string => `shop-checkout-command:${getClientId()}`

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = (record: UnknownRecord, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(record, key)
)

const isSafeNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)

const isPositiveSafeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
)

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const cloneJson = <TValue>(value: TValue): TValue => deepCloneJson(value)

const outboxErrorMessage = (error: unknown): string => (
  getErrorMessage(error, { fallback: 'Durable shop checkout command storage failed' })
)

const combineWarnings = (
  ...warnings: readonly (string | null | undefined)[]
): string | undefined => {
  const messages = warnings.filter((warning): warning is string => (
    typeof warning === 'string' && warning.trim().length > 0
  ))
  return messages.length === 0 ? undefined : messages.join(' ')
}

const validationIssueSummary = (issues: readonly string[]): string => issues.join('; ')

const isShopCheckoutRequestPath = (requestPath: string): boolean => (
  typeof requestPath === 'string'
  && requestPath.startsWith('/api/')
  && !requestPath.includes('?')
  && !requestPath.includes('#')
  && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(requestPath)
  && !requestPath.startsWith('//')
  && !requestPath.includes('://')
  && !/\p{C}/u.test(requestPath)
  && SHOP_CHECKOUT_REQUEST_PATHS.has(requestPath)
)

const authContextsEqual = (
  left: LivePlayCommandOutboxAuthContext,
  right: LivePlayCommandOutboxAuthContext,
): boolean => left.role === right.role && (left.profileId ?? null) === (right.profileId ?? null)

const commandShopSlug = (command: unknown): string | null => {
  if (!isRecord(command) || !isRecord(command.payload)) return null
  return isSlug(command.payload.shopSlug) ? command.payload.shopSlug : null
}

const validateResultLine = (
  line: unknown,
  path: string,
  issues: string[],
): void => {
  if (!isRecord(line)) {
    issues.push(`${path} must be an object.`)
    return
  }
  if (!isNonEmptyString(line.entryId)) issues.push(`${path}.entryId must be a non-empty string.`)
  if (typeof line.itemName !== 'string') issues.push(`${path}.itemName must be a string.`)
  if (!isNonEmptyString(line.section)) issues.push(`${path}.section must be a non-empty string.`)
  if (!isPositiveSafeInteger(line.quantity)) issues.push(`${path}.quantity must be a positive safe integer.`)
  if (!isSafeNonNegativeInteger(line.unitPrice)) issues.push(`${path}.unitPrice must be a safe non-negative integer.`)
  if (!isSafeNonNegativeInteger(line.lineTotal)) issues.push(`${path}.lineTotal must be a safe non-negative integer.`)
  if (line.stock !== null && !isSafeNonNegativeInteger(line.stock)) {
    issues.push(`${path}.stock must be null or a safe non-negative integer.`)
  }
}

const validateAcceptedResult = (
  response: UnknownRecord,
  path: string,
  issues: string[],
): void => {
  if (!isLivePlayOpId(response.opId)) issues.push(`${path}.opId must be a valid live-play operation ID.`)
  if (!isSlug(response.shopSlug)) issues.push(`${path}.shopSlug must be a valid shop slug.`)
  if (!isSafeNonNegativeInteger(response.previousShopRevision)) {
    issues.push(`${path}.previousShopRevision must be a safe non-negative integer.`)
  }
  if (!isSafeNonNegativeInteger(response.shopRevision)) {
    issues.push(`${path}.shopRevision must be a safe non-negative integer.`)
  }
  if (!isSafeNonNegativeInteger(response.totalPrice)) {
    issues.push(`${path}.totalPrice must be a safe non-negative integer.`)
  }
  if (!Array.isArray(response.lines)) {
    issues.push(`${path}.lines must be an array.`)
  } else {
    response.lines.forEach((line, index) => validateResultLine(line, `${path}.lines[${index}]`, issues))
  }
  if (!isRecord(response.documents)) {
    issues.push(`${path}.documents must be an object.`)
  } else {
    if (!isRecord(response.documents.shop)) {
      issues.push(`${path}.documents.shop must be an object.`)
    } else {
      if (response.documents.shop.slug !== response.shopSlug) {
        issues.push(`${path}.documents.shop.slug must match ${path}.shopSlug.`)
      }
      if (response.documents.shop.revision !== response.shopRevision) {
        issues.push(`${path}.documents.shop.revision must match ${path}.shopRevision.`)
      }
    }
    if (hasOwn(response.documents, 'groupInventories') && response.documents.groupInventories !== undefined) {
      if (!Array.isArray(response.documents.groupInventories)) {
        issues.push(`${path}.documents.groupInventories must be an array when present.`)
      } else if (!response.documents.groupInventories.every(isRecord)) {
        issues.push(`${path}.documents.groupInventories must contain only objects.`)
      }
    }
    if (hasOwn(response.documents, 'trainerSheets') && response.documents.trainerSheets !== undefined) {
      if (!Array.isArray(response.documents.trainerSheets)) {
        issues.push(`${path}.documents.trainerSheets must be an array when present.`)
      } else if (!response.documents.trainerSheets.every(isRecord)) {
        issues.push(`${path}.documents.trainerSheets must contain only objects.`)
      }
    }
  }
}

const validateRejectedResult = (
  response: UnknownRecord,
  path: string,
  issues: string[],
): void => {
  if (!isLivePlayOpId(response.opId)) issues.push(`${path}.opId must be a valid live-play operation ID.`)
  if (!isLivePlayCommandRejectionReason(response.reason)) {
    issues.push(`${path}.reason must be a supported live-play rejection reason.`)
  }
  if (!isNonEmptyString(response.message)) issues.push(`${path}.message must be a non-empty string.`)
  if (hasOwn(response, 'shopSlug') && response.shopSlug !== undefined && !isSlug(response.shopSlug)) {
    issues.push(`${path}.shopSlug must be a valid shop slug when present.`)
  }
  if (
    hasOwn(response, 'currentShopRevision')
    && response.currentShopRevision !== undefined
    && !isSafeNonNegativeInteger(response.currentShopRevision)
  ) {
    issues.push(`${path}.currentShopRevision must be a safe non-negative integer when present.`)
  }
}

const validateAcceptedOrRejectedResult = (
  response: unknown,
  path: string,
  issues: string[],
): void => {
  if (!isRecord(response)) {
    issues.push(`${path} must be an object.`)
    return
  }

  if (response.ok === true) {
    if (hasOwn(response, 'duplicate')) {
      issues.push(`${path}.duplicate is not allowed on nested original results.`)
      return
    }
    validateAcceptedResult(response, path, issues)
    return
  }

  if (response.ok === false) {
    validateRejectedResult(response, path, issues)
    return
  }

  issues.push(`${path}.ok must be true or false.`)
}

const nestedResultShopSlug = (response: ShopCheckoutCommandAccepted | ShopCheckoutCommandRejected): string | undefined => (
  response.ok ? response.shopSlug : response.shopSlug
)

const validateShopCheckoutTerminalResponseForCommand = (input: {
  readonly response: unknown
  readonly command: Record<string, unknown>
}): TerminalValidationResult => {
  const issues: string[] = []
  const commandValidation = validateShopCheckoutCommandEnvelope(input.command)
  if (!commandValidation.valid) {
    for (const issue of commandValidation.issues) issues.push(`command.${issue.path}: ${issue.message}`)
  }

  const expectedOpId = isRecord(input.command) && typeof input.command.opId === 'string'
    ? input.command.opId
    : null
  const expectedShopSlug = commandShopSlug(input.command)
  if (expectedShopSlug === null) issues.push('command.payload.shopSlug must be a valid shop slug.')

  if (!isRecord(input.response)) {
    issues.push('response must be an object.')
  } else if (input.response.ok === true && hasOwn(input.response, 'duplicate')) {
    if (input.response.duplicate !== true) {
      issues.push('response.duplicate must be true when present.')
    } else {
      if (!isLivePlayOpId(input.response.opId)) {
        issues.push('response.opId must be a valid live-play operation ID.')
      }
      validateAcceptedOrRejectedResult(input.response.original, 'response.original', issues)
    }
  } else if (input.response.ok === true) {
    validateAcceptedResult(input.response, 'response', issues)
  } else if (input.response.ok === false) {
    validateRejectedResult(input.response, 'response', issues)
  } else {
    issues.push('response.ok must be true or false.')
  }

  if (issues.length > 0) return { valid: false, issues }

  const response = input.response as ShopCheckoutCommandResult
  if (expectedOpId !== null && response.opId !== expectedOpId) {
    issues.push('response.opId must match the sent command operation ID.')
  }

  if (expectedShopSlug !== null) {
    if (response.ok && 'duplicate' in response && response.duplicate === true) {
      if (response.original.opId !== expectedOpId) {
        issues.push('response.original.opId must match the sent command operation ID.')
      }
      const originalShopSlug = nestedResultShopSlug(response.original)
      if (originalShopSlug !== undefined && originalShopSlug !== expectedShopSlug) {
        issues.push('response.original.shopSlug must match the sent command shop slug when present.')
      }
    } else {
      const terminalShopSlug = nestedResultShopSlug(response as ShopCheckoutCommandAccepted | ShopCheckoutCommandRejected)
      if (terminalShopSlug !== undefined && terminalShopSlug !== expectedShopSlug) {
        issues.push('response.shopSlug must match the sent command shop slug when present.')
      }
    }
  }

  if (issues.length > 0) return { valid: false, issues }
  return { valid: true, response }
}

const isDuplicateShopCheckoutResult = (
  response: ShopCheckoutCommandResult,
): response is ShopCheckoutCommandDuplicate => response.ok === true && 'duplicate' in response && response.duplicate === true

const acceptedShopCheckoutResult = (
  response: ShopCheckoutCommandResult,
): ShopCheckoutCommandAccepted | null => {
  if (!response.ok) return null
  if (isDuplicateShopCheckoutResult(response)) return response.original.ok ? response.original : null
  return response
}

const rejectedShopCheckoutResult = (
  response: ShopCheckoutCommandResult,
): ShopCheckoutCommandRejected | null => {
  if (!response.ok) return response
  if (isDuplicateShopCheckoutResult(response) && !response.original.ok) return response.original
  return null
}

const responseMessage = (response: ShopCheckoutCommandResult): string | null => (
  rejectedShopCheckoutResult(response)?.message ?? null
)

const isStaleRejection = (response: ShopCheckoutCommandResult): boolean => (
  rejectedShopCheckoutResult(response)?.reason === 'stale-revision'
)

const profileBody = (
  authContext: LivePlayCommandOutboxAuthContext,
): { readonly profileId?: PlayerProfileId } => (
  authContext.role === 'player' && authContext.profileId ? { profileId: authContext.profileId } : {}
)

export const useShopCheckoutCommands = (
  options: UseShopCheckoutCommandsOptions,
): UseShopCheckoutCommandsReturn => {
  const apiClient = options.apiClient ?? useApiClient()
  const outbox = options.outbox ?? getLivePlayCommandOutbox()
  const leaseOwner = options.leaseOwner ?? shopCheckoutLeaseOwner()
  const clientId = options.clientId ?? getClientId
  const status = ref<ShopCheckoutCommandStatus>('idle')
  const lastError = ref<string | null>(null)
  const outboxEntrySnapshot = ref<readonly LivePlayCommandOutboxEntry[]>([])
  const outboxStatus = ref<ShopCheckoutOutboxStatus>('idle')
  const outboxError = ref<string | null>(null)
  let activeOpId: string | null = null

  if (getCurrentScope()) {
    const removePendingCommandUnloadWarning = bindPendingLivePlayCommandUnloadWarning(() => status.value === 'sending')
    onScopeDispose(() => {
      removePendingCommandUnloadWarning?.()
    })
  }

  const currentShopSlug = computed<string | null>(() => {
    const explicitSlug = String(options.shopSlug?.value ?? '').trim()
    if (explicitSlug) return explicitSlug
    const loadedSlug = String(options.shop?.value?.slug ?? '').trim()
    return loadedSlug || null
  })

  const currentAuthContext = (): LivePlayCommandOutboxAuthContext | null => {
    const role = options.authRole.value
    if (!isAuthRole(role)) return null
    if (role === 'gm') return { role: 'gm', profileId: null }
    return { role: 'player', profileId: options.playerProfileId?.value ?? null }
  }

  const entryMatchesCurrentContext = (entry: LivePlayCommandOutboxEntry): entry is ShopCheckoutCommandOutboxEntry => {
    const authContext = currentAuthContext()
    if (!authContext || !isShopCheckoutCommandOutboxEntry(entry)) return false
    if (!authContextsEqual(entry.authContext, authContext)) return false
    const slug = currentShopSlug.value
    return slug === null || entry.shopSlug === slug
  }

  const pendingOutboxEntries = computed<readonly ShopCheckoutCommandOutboxEntry[]>(() => (
    outboxEntrySnapshot.value.filter(entryMatchesCurrentContext)
  ))

  const hasPendingOutboxEntries = computed(() => pendingOutboxEntries.value.length > 0)

  const clearError = (): void => {
    if (status.value === 'error' || status.value === 'rejected' || status.value === 'stale' || status.value === 'uncertain') {
      status.value = 'idle'
    }
    lastError.value = null
    if (outboxStatus.value === 'error') outboxStatus.value = 'idle'
    outboxError.value = null
  }

  const setFailure = (
    nextStatus: Exclude<ShopCheckoutCommandStatus, 'idle' | 'sending' | 'accepted'>,
    message: string,
  ): void => {
    status.value = nextStatus
    lastError.value = message
    options.onCheckoutFailed?.(message)
  }

  const beginSend = (opId: string | null): void => {
    activeOpId = opId
    status.value = 'sending'
    lastError.value = null
    if (opId) options.onCheckoutStarted?.(opId)
  }

  const markAccepted = (opId: string): void => {
    if (activeOpId === null || activeOpId === opId) {
      status.value = 'accepted'
      lastError.value = null
    }
    if (activeOpId === opId) activeOpId = null
  }

  const markTerminalRejected = (opId: string, response: ShopCheckoutCommandResult): void => {
    const rejected = rejectedShopCheckoutResult(response)
    const message = responseMessage(response) ?? 'Shop checkout was rejected.'
    if (activeOpId === null || activeOpId === opId) {
      status.value = isStaleRejection(response) ? 'stale' : 'rejected'
      lastError.value = message
    }
    if (activeOpId === opId) activeOpId = null
    if (rejected) options.onCheckoutRejected?.({ response: rejected, message })
  }

  const listOutboxEntries = async (
    authContext: LivePlayCommandOutboxAuthContext,
  ): Promise<readonly LivePlayCommandOutboxEntry[]> => {
    const slug = currentShopSlug.value
    return outbox.list({
      authContext,
      ...(slug === null ? {} : { shopSlug: slug }),
    })
  }

  const replaceOutboxEntries = (
    entries: readonly LivePlayCommandOutboxEntry[],
  ): readonly ShopCheckoutCommandOutboxEntry[] => {
    outboxEntrySnapshot.value = entries
    return pendingOutboxEntries.value
  }

  const refreshPendingOutboxEntriesQuiet = async (): Promise<string | undefined> => {
    const authContext = currentAuthContext()
    if (!authContext) {
      outboxEntrySnapshot.value = []
      const message = 'A valid GM or player auth role is required before loading pending shop checkout commands.'
      outboxStatus.value = 'error'
      outboxError.value = message
      return message
    }

    try {
      replaceOutboxEntries(await listOutboxEntries(authContext))
      if (outboxStatus.value === 'error') {
        outboxStatus.value = 'idle'
        outboxError.value = null
      }
      return undefined
    } catch (error) {
      const message = `Failed to refresh pending shop checkout commands: ${outboxErrorMessage(error)}`
      outboxStatus.value = 'error'
      outboxError.value = message
      return message
    }
  }

  const refreshPendingOutboxEntries: UseShopCheckoutCommandsReturn['refreshPendingOutboxEntries'] = async () => {
    outboxStatus.value = 'loading'
    outboxError.value = null
    const authContext = currentAuthContext()
    if (!authContext) {
      const message = 'A valid GM or player auth role is required before loading pending shop checkout commands.'
      outboxEntrySnapshot.value = []
      outboxStatus.value = 'error'
      outboxError.value = message
      throw new Error(message)
    }

    try {
      const entries = replaceOutboxEntries(await listOutboxEntries(authContext))
      outboxStatus.value = 'idle'
      outboxError.value = null
      return entries
    } catch (error) {
      const message = `Failed to refresh pending shop checkout commands: ${outboxErrorMessage(error)}`
      outboxStatus.value = 'error'
      outboxError.value = message
      throw new Error(message, { cause: error })
    }
  }

  const markClaimedEntryUncertain = async (
    entry: ShopCheckoutCommandOutboxEntry,
    error: string,
  ): Promise<string | undefined> => {
    let markWarning: string | undefined
    try {
      await outbox.markUncertain({ opId: entry.opId, leaseOwner, error })
    } catch (markError) {
      markWarning = outboxErrorMessage(markError)
    }
    return combineWarnings(markWarning, await refreshPendingOutboxEntriesQuiet())
  }

  const acknowledgeTerminal = async (opId: string): Promise<string | undefined> => {
    try {
      await outbox.acknowledgeTerminal(opId)
      return undefined
    } catch (error) {
      return `Shop checkout operation ${opId} received a terminal response, but removing it from durable storage failed: ${outboxErrorMessage(error)}`
    }
  }

  const adoptAcceptedResponse = (response: ShopCheckoutCommandAccepted): void => {
    options.adoptShop?.(cloneJson(response.documents.shop))
    for (const document of response.documents.groupInventories ?? []) {
      options.adoptGroupInventory?.(cloneJson(document))
    }
    for (const sheet of response.documents.trainerSheets ?? []) {
      options.adoptTrainerSheet?.(cloneJson(sheet))
    }
  }

  const processTerminalResponse = async (
    entry: ShopCheckoutCommandOutboxEntry,
    response: ShopCheckoutCommandResult,
    outboxWarning: string | undefined,
  ): Promise<ShopCheckoutCommandDispatchResult> => {
    const accepted = acceptedShopCheckoutResult(response)
    if (!accepted) {
      markTerminalRejected(entry.opId, response)
      return {
        dispatched: false,
        opId: entry.opId,
        response,
        message: responseMessage(response) ?? 'Shop checkout was rejected.',
        ...(outboxWarning === undefined ? {} : { outboxError: outboxWarning }),
      }
    }

    try {
      adoptAcceptedResponse(accepted)
      markAccepted(entry.opId)
      options.onCheckoutAccepted?.(accepted)
      return {
        dispatched: true,
        opId: entry.opId,
        response,
        ...(outboxWarning === undefined ? {} : { outboxError: outboxWarning }),
      }
    } catch (error) {
      const message = getErrorMessage(error, {
        fallback: 'Shop checkout was accepted, but authoritative client state could not be adopted.',
      })
      setFailure('error', message)
      if (activeOpId === entry.opId) activeOpId = null
      return {
        dispatched: true,
        opId: entry.opId,
        response,
        message,
        ...(outboxWarning === undefined ? {} : { outboxError: outboxWarning }),
      }
    }
  }

  const uncertaintyResult = async (
    entry: ShopCheckoutCommandOutboxEntry,
    detail: string,
  ): Promise<ShopCheckoutCommandDispatchResult> => {
    const message = `The server outcome for shop checkout operation ${entry.opId} is unknown. Retrying the same operation ID will be safe later. ${detail}`
    const outboxWarning = await markClaimedEntryUncertain(entry, message)
    setFailure('uncertain', message)
    if (activeOpId === entry.opId) activeOpId = null
    return {
      dispatched: false,
      opId: entry.opId,
      message,
      uncertain: true,
      ...(outboxWarning === undefined ? {} : { outboxError: outboxWarning }),
    }
  }

  const sendClaimedOutboxEntry = async (
    entry: ShopCheckoutCommandOutboxEntry,
  ): Promise<ShopCheckoutCommandDispatchResult> => {
    let rawResponse: unknown
    try {
      rawResponse = await apiClient.postJson(entry.requestPath, entry.body)
    } catch (error) {
      return uncertaintyResult(
        entry,
        getErrorMessage(error, { fallback: 'The HTTP request failed before a terminal checkout result was received.' }),
      )
    }

    const validation = validateShopCheckoutTerminalResponseForCommand({
      response: rawResponse,
      command: entry.body,
    })
    if (!validation.valid) {
      return uncertaintyResult(
        entry,
        `The checkout response was not trustworthy: ${validationIssueSummary(validation.issues)}`,
      )
    }

    const acknowledgeWarning = await acknowledgeTerminal(entry.opId)
    const refreshWarning = await refreshPendingOutboxEntriesQuiet()
    return processTerminalResponse(
      entry,
      validation.response,
      combineWarnings(acknowledgeWarning, refreshWarning),
    )
  }

  const validateEntryForCurrentContext = (
    entry: LivePlayCommandOutboxEntry | null,
    opId: string,
  ): ShopCheckoutCommandOutboxEntry | string => {
    if (!entry) return `No pending shop checkout operation ${opId} was found.`
    if (!isShopCheckoutCommandOutboxEntry(entry)) return `Pending operation ${opId} is not a shop checkout command.`
    if (!isShopCheckoutRequestPath(entry.requestPath)) return `Pending operation ${opId} is not stored for the shop checkout endpoint.`
    const authContext = currentAuthContext()
    if (!authContext || !authContextsEqual(entry.authContext, authContext)) {
      return `Pending shop checkout operation ${opId} does not belong to the current actor context.`
    }
    const slug = currentShopSlug.value
    if (slug !== null && entry.shopSlug !== slug) {
      return `Pending shop checkout operation ${opId} belongs to a different shop.`
    }
    return entry
  }

  const claimAndSendEntry = async (
    entry: ShopCheckoutCommandOutboxEntry,
  ): Promise<ShopCheckoutCommandDispatchResult> => {
    let claimResult: Awaited<ReturnType<LivePlayCommandOutbox['claimForSend']>>
    try {
      claimResult = await outbox.claimForSend({ opId: entry.opId, leaseOwner })
    } catch (error) {
      const message = `Shop checkout operation ${entry.opId} could not be claimed for sending: ${outboxErrorMessage(error)}`
      setFailure('error', message)
      return { dispatched: false, opId: entry.opId, message, outboxError: outboxErrorMessage(error) }
    }

    await refreshPendingOutboxEntriesQuiet()

    if (!claimResult.claimed) {
      const message = claimResult.reason === 'missing'
        ? `Shop checkout operation ${entry.opId} disappeared before it could be sent.`
        : `Shop checkout operation ${entry.opId} is already being sent by another tab or page.`
      setFailure(claimResult.reason === 'missing' ? 'error' : 'uncertain', message)
      return { dispatched: false, opId: entry.opId, message }
    }

    if (!isShopCheckoutCommandOutboxEntry(claimResult.entry)) {
      const message = `Shop checkout operation ${entry.opId} is not a shop checkout command after claim.`
      setFailure('error', message)
      return { dispatched: false, opId: entry.opId, message }
    }

    return sendClaimedOutboxEntry(claimResult.entry)
  }

  const resolveCheckoutShop = (input: ShopCheckoutCommandInput): { readonly shopSlug: string; readonly shopRevision: number } => {
    const shopSlug = input.shopSlug ?? currentShopSlug.value
    if (!shopSlug) throw new Error('Load a shop before checking out.')
    const shopRevision = input.shopRevision ?? options.shop?.value?.revision
    if (!isSafeNonNegativeInteger(shopRevision)) throw new Error('Load the current shop revision before checking out.')
    return { shopSlug, shopRevision }
  }

  const buildCheckoutBody = (
    input: ShopCheckoutCommandInput,
    authContext: LivePlayCommandOutboxAuthContext,
  ): ShopCheckoutCommandBody => {
    const shop = resolveCheckoutShop(input)
    return buildShopCheckoutCommand({
      ...shop,
      paymentSource: input.paymentSource,
      deliveryTarget: input.deliveryTarget,
      lines: input.lines,
      clientId: clientId(),
      ...profileBody(authContext),
      ...(input.opId === undefined ? {} : { opId: input.opId }),
      ...(input.randomUuid === undefined ? {} : { randomUuid: input.randomUuid }),
    })
  }

  const checkout: UseShopCheckoutCommandsReturn['checkout'] = async (input) => {
    if (status.value === 'sending') {
      const message = 'A shop checkout command is already in flight.'
      return { dispatched: false, message }
    }

    const authContext = currentAuthContext()
    if (!authContext) {
      const message = 'A valid GM or player auth role is required before checking out.'
      setFailure('error', message)
      return { dispatched: false, message }
    }

    let body: ShopCheckoutCommandBody
    try {
      body = buildCheckoutBody(input, authContext)
    } catch (error) {
      const message = getErrorMessage(error, { fallback: 'Shop checkout command could not be built.' })
      setFailure('error', message)
      return { dispatched: false, message }
    }

    beginSend(body.opId)

    let entry: LivePlayCommandOutboxEntry
    try {
      entry = await outbox.enqueue({
        requestPath: SHOP_API_PATHS.checkout,
        body: body as unknown as Record<string, unknown>,
        authContext,
      })
    } catch (error) {
      const outboxError = outboxErrorMessage(error)
      const message = `Shop checkout operation ${body.opId} was not sent because durable command storage was unavailable: ${outboxError}`
      setFailure('error', message)
      if (activeOpId === body.opId) activeOpId = null
      return { dispatched: false, opId: body.opId, message, outboxError }
    }

    await refreshPendingOutboxEntriesQuiet()

    if (!isShopCheckoutCommandOutboxEntry(entry)) {
      const message = `Shop checkout operation ${body.opId} did not create a shop checkout outbox entry.`
      setFailure('error', message)
      if (activeOpId === body.opId) activeOpId = null
      return { dispatched: false, opId: body.opId, message }
    }

    return claimAndSendEntry(entry)
  }

  const retryOutboxEntry: UseShopCheckoutCommandsReturn['retryOutboxEntry'] = async (opId) => {
    if (status.value === 'sending') {
      return { dispatched: false, opId, message: 'A shop checkout command is already in flight.' }
    }

    outboxStatus.value = 'retrying'
    outboxError.value = null

    let rawEntry: LivePlayCommandOutboxEntry | null
    try {
      rawEntry = await outbox.get(opId)
    } catch (error) {
      const message = `Could not load pending shop checkout operation ${opId}: ${outboxErrorMessage(error)}`
      outboxStatus.value = 'error'
      outboxError.value = message
      setFailure('error', message)
      return { dispatched: false, opId, message, outboxError: outboxErrorMessage(error) }
    }

    const entry = validateEntryForCurrentContext(rawEntry, opId)
    if (typeof entry === 'string') {
      outboxStatus.value = 'error'
      outboxError.value = entry
      setFailure('error', entry)
      return { dispatched: false, opId, message: entry }
    }

    beginSend(entry.opId)
    const result = await claimAndSendEntry(entry)
    outboxStatus.value = result.uncertain || result.outboxError ? 'error' : 'idle'
    outboxError.value = result.outboxError ?? (result.uncertain ? result.message ?? null : null)
    return result
  }

  const discardOutboxEntry: UseShopCheckoutCommandsReturn['discardOutboxEntry'] = async (opId) => {
    outboxStatus.value = 'discarding'
    outboxError.value = null

    let rawEntry: LivePlayCommandOutboxEntry | null
    try {
      rawEntry = await outbox.get(opId)
    } catch (error) {
      const message = `Could not load pending shop checkout operation ${opId}: ${outboxErrorMessage(error)}`
      outboxStatus.value = 'error'
      outboxError.value = message
      return { discarded: false, opId, message }
    }

    const entry = validateEntryForCurrentContext(rawEntry, opId)
    if (typeof entry === 'string') {
      outboxStatus.value = 'error'
      outboxError.value = entry
      return { discarded: false, opId, message: entry }
    }

    try {
      const discarded = await outbox.discard(opId)
      await refreshPendingOutboxEntriesQuiet()
      outboxStatus.value = 'idle'
      outboxError.value = null
      return {
        discarded: true,
        opId,
        entry: discarded !== null && isShopCheckoutCommandOutboxEntry(discarded) ? discarded : entry,
        message: 'The local pending shop checkout command was discarded. This does not undo a server-side checkout that may already have committed.',
      }
    } catch (error) {
      const message = `Could not discard pending shop checkout operation ${opId}: ${outboxErrorMessage(error)}`
      outboxStatus.value = 'error'
      outboxError.value = message
      return { discarded: false, opId, message }
    }
  }

  return {
    status,
    lastError,
    pendingOutboxEntries,
    outboxStatus,
    outboxError,
    hasPendingOutboxEntries,
    clearError,
    refreshPendingOutboxEntries,
    checkout,
    retryOutboxEntry,
    discardOutboxEntry,
  }
}
