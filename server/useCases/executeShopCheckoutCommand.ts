import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type {
  LivePlayCommandRejectionReason,
  ShopCheckoutChangedDocuments,
  ShopCheckoutCommandAccepted,
  ShopCheckoutCommandRejected,
  ShopCheckoutCommandResult,
  ShopCheckoutDeliveryTarget,
  ShopCheckoutLivePlayCommand,
  ShopCheckoutPaymentSource,
} from '#shared/livePlayCommands'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { ShopTableDocument } from '~/types/shop'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  ShopCheckoutCalculationError,
  applyShopCheckoutDeliveryToGroupInventory,
  applyShopCheckoutDeliveryToTrainerSheet,
  calculateShopCheckout,
  subtractShopCheckoutMoney,
} from '~/utils/shopCheckout'
import type { InventoryTransferTargetRowIdGenerator } from '~/utils/groupInventoryTransfers'
import {
  LivePlayCommandRejectionError,
  rejectLivePlayCommand,
} from '../livePlay/commandExecutor'
import { validateLivePlayOperationId } from '../livePlay/commandIdempotency'
import {
  areShopCheckoutCommandsSemanticallyEqual,
  createShopCheckoutCommandHash,
  isShopCheckoutOperationResultConflictError,
  shopCheckoutIdempotencyViolationMessage,
  type ShopCheckoutCommandHash,
  type StorableShopCheckoutCommandResult,
} from '../livePlay/shopCheckoutOpResult'
import { parseShopCheckoutLivePlayCommand } from '../livePlay/shopCheckoutCommandParser'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteGroupInventoryRepository,
  type GroupInventoryRepository,
} from '../storage/groupInventoryRepository'
import {
  createSqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import {
  createSqliteShopCheckoutOperationRepository,
  type ShopCheckoutOperationRepository,
} from '../storage/shopCheckoutOperationRepository'
import {
  createSqliteShopTableRepository,
  type ShopTableRepository,
} from '../storage/shopTableRepository'
import { playerProfileCanAccessSheet } from '../policies/playerProfilePolicy'

export interface ExecuteShopCheckoutCommandUseCaseInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
}

export interface ExecuteShopCheckoutCommandUseCaseResponse {
  readonly result: ShopCheckoutCommandResult
  readonly shop?: ShopTableDocument
  readonly groupInventories?: readonly GroupInventoryDocument[]
  readonly trainerSheets?: readonly TrainerSheet[]
}

export interface ExecuteShopCheckoutCommandDependencies {
  readonly database?: RotomDatabase
  readonly shopTableRepository?: Pick<ShopTableRepository, 'get' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
  readonly groupInventoryRepository?: Pick<GroupInventoryRepository, 'get' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
  readonly operationRepository?: Pick<ShopCheckoutOperationRepository, 'getStoredOperation' | 'saveCommandResult'>
  readonly now?: () => number
  readonly createGroupInventoryRowId?: InventoryTransferTargetRowIdGenerator
}

interface ShopCheckoutCommandDependencySet {
  readonly database: RotomDatabase
  readonly shopTableRepository: Pick<ShopTableRepository, 'get' | 'applyLivePlayUpdate'>
  readonly groupInventoryRepository: Pick<GroupInventoryRepository, 'get' | 'applyLivePlayUpdate'>
  readonly sheetRepository: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'applyLivePlayUpdate'>
  readonly operationRepository: Pick<ShopCheckoutOperationRepository, 'getStoredOperation' | 'saveCommandResult'>
  readonly now: () => number
  readonly createGroupInventoryRowId?: InventoryTransferTargetRowIdGenerator
}

type CheckoutParticipantReference = ShopCheckoutPaymentSource | ShopCheckoutDeliveryTarget

type CheckoutParticipantKey = `${CheckoutParticipantReference['kind']}:${string}`

interface LoadedGroupInventoryParticipant {
  readonly kind: 'groupInventory'
  readonly slug: string
  readonly revision: number
  readonly document: GroupInventoryDocument
  nextDocument: GroupInventoryDocument
}

interface LoadedTrainerParticipant {
  readonly kind: 'trainer'
  readonly slug: string
  readonly revision: number
  readonly document: TrainerSheet
  nextDocument: TrainerSheet
}

type LoadedCheckoutParticipant = LoadedGroupInventoryParticipant | LoadedTrainerParticipant

type LoadedCheckoutParticipantMap = Map<CheckoutParticipantKey, LoadedCheckoutParticipant>

interface LoadedShopCheckoutDocuments {
  readonly shop: ShopTableDocument
  readonly participants: LoadedCheckoutParticipantMap
}

interface AppliedShopCheckoutDocuments {
  readonly shop: ShopTableDocument
  readonly participants: LoadedCheckoutParticipantMap
  readonly totalPrice: number
  readonly lines: ShopCheckoutCommandAccepted['lines']
}

interface PersistedShopCheckoutDocuments {
  readonly shop: ShopTableDocument
  readonly groupInventories: readonly GroupInventoryDocument[]
  readonly trainerSheets: readonly TrainerSheet[]
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const actionDependencies = (
  dependencies: ExecuteShopCheckoutCommandDependencies,
): ShopCheckoutCommandDependencySet => {
  const database = dependencies.database ?? getRotomDatabase()
  const shopTableRepository = dependencies.shopTableRepository ?? createSqliteShopTableRepository(database)
  const groupInventoryRepository = dependencies.groupInventoryRepository ?? createSqliteGroupInventoryRepository(database)
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const operationRepository = dependencies.operationRepository ?? createSqliteShopCheckoutOperationRepository({ database })

  assertRepositoryDatabase(database, dependencies.shopTableRepository?.database, 'shop table repository')
  assertRepositoryDatabase(database, dependencies.groupInventoryRepository?.database, 'group inventory repository')
  assertRepositoryDatabase(database, dependencies.sheetRepository?.database, 'sheet repository')

  return {
    database,
    shopTableRepository,
    groupInventoryRepository,
    sheetRepository,
    operationRepository,
    now: dependencies.now ?? Date.now,
    ...(dependencies.createGroupInventoryRowId ? { createGroupInventoryRowId: dependencies.createGroupInventoryRowId } : {}),
  }
}

const assertRepositoryDatabase = (
  database: RotomDatabase,
  repositoryDatabase: RotomDatabase | undefined,
  label: string,
): void => {
  if (repositoryDatabase && repositoryDatabase !== database) {
    throw new Error(`Shop checkout ${label} must use the same RotomDatabase as the checkout transaction`)
  }
}

const defaultResultOpId = (value: unknown): string => (
  isRecord(value) && typeof value.opId === 'string' ? value.opId : 'invalid-op-id'
)

const defaultResultShopSlug = (value: unknown): string | undefined => {
  if (!isRecord(value) || !isRecord(value.payload)) return undefined
  return typeof value.payload.shopSlug === 'string' ? value.payload.shopSlug : undefined
}

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
)

const httpStatusToRejectionReason = (statusCode: number): LivePlayCommandRejectionReason => {
  if (statusCode === 401 || statusCode === 403) return 'unauthorized'
  if (statusCode === 404) return 'not-found'
  if (statusCode === 409) return 'conflict'
  return 'invalid'
}

const createShopCheckoutRejectedResult = (input: {
  readonly opId: string
  readonly reason: LivePlayCommandRejectionReason
  readonly message: string
  readonly shopSlug?: string
  readonly currentShopRevision?: number
  readonly currentState?: unknown
}): ShopCheckoutCommandRejected => ({
  ok: false,
  opId: input.opId,
  reason: input.reason,
  message: input.message,
  ...(input.shopSlug === undefined ? {} : { shopSlug: input.shopSlug }),
  ...(input.currentShopRevision === undefined ? {} : { currentShopRevision: input.currentShopRevision }),
  ...(input.currentState === undefined ? {} : { currentState: input.currentState }),
})

const invalidEnvelopeResult = (value: unknown, message: string): ShopCheckoutCommandRejected => (
  createShopCheckoutRejectedResult({
    opId: defaultResultOpId(value),
    shopSlug: defaultResultShopSlug(value),
    reason: 'invalid',
    message,
  })
)

const currentShopRevisionFromResult = (
  result: StorableShopCheckoutCommandResult,
): number | undefined => result.ok ? result.shopRevision : result.currentShopRevision

const createShopCheckoutIdempotencyViolationResult = (
  command: ShopCheckoutLivePlayCommand,
  existing: { readonly shopSlug: string; readonly opId: string; readonly result: StorableShopCheckoutCommandResult },
): ShopCheckoutCommandRejected => createShopCheckoutRejectedResult({
  opId: command.opId,
  shopSlug: command.payload.shopSlug,
  reason: 'conflict',
  message: shopCheckoutIdempotencyViolationMessage(existing.shopSlug, existing.opId),
  currentShopRevision: currentShopRevisionFromResult(existing.result),
})

const persistenceFailedResult = (
  command: ShopCheckoutLivePlayCommand,
  error: unknown,
  currentShopRevision?: number,
): ShopCheckoutCommandRejected => createShopCheckoutRejectedResult({
  opId: command.opId,
  shopSlug: command.payload.shopSlug,
  reason: 'persistence-failed',
  message: `Could not persist shop checkout command: ${errorMessage(error)}`,
  currentShopRevision,
})

const rejectionFromError = (
  command: ShopCheckoutLivePlayCommand,
  error: unknown,
  currentShopRevision?: number,
  currentState?: unknown,
): ShopCheckoutCommandRejected => {
  if (error instanceof LivePlayCommandRejectionError) {
    const fallbackCurrentState = error.reason === 'unauthorized' ? undefined : currentState
    return createShopCheckoutRejectedResult({
      opId: command.opId,
      shopSlug: command.payload.shopSlug,
      reason: error.reason,
      message: error.message,
      currentShopRevision: error.currentRevision ?? currentShopRevision,
      currentState: error.currentState ?? fallbackCurrentState,
    })
  }

  if (error instanceof Error) {
    const statusCode = (error as Error & { readonly statusCode?: unknown }).statusCode
    if (typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 400) {
      return createShopCheckoutRejectedResult({
        opId: command.opId,
        shopSlug: command.payload.shopSlug,
        reason: httpStatusToRejectionReason(statusCode),
        message: error.message,
        currentShopRevision,
        currentState,
      })
    }
  }

  return createShopCheckoutRejectedResult({
    opId: command.opId,
    shopSlug: command.payload.shopSlug,
    reason: 'invalid',
    message: errorMessage(error),
    currentShopRevision,
    currentState,
  })
}

const calculationRejectionReason = (
  error: ShopCheckoutCalculationError,
): LivePlayCommandRejectionReason => {
  if (error.code === 'missing-entry') return 'not-found'
  if (
    error.code === 'insufficient-stock'
    || error.code === 'insufficient-money'
    || error.code === 'max-per-purchase-exceeded'
  ) return 'conflict'
  return 'invalid'
}

const rejectionFromCheckoutCalculationError = (
  command: ShopCheckoutLivePlayCommand,
  error: ShopCheckoutCalculationError,
  shop: ShopTableDocument,
): ShopCheckoutCommandRejected => createShopCheckoutRejectedResult({
  opId: command.opId,
  shopSlug: command.payload.shopSlug,
  reason: calculationRejectionReason(error),
  message: error.message,
  currentShopRevision: shop.revision,
  currentState: shop,
})

const responseFromResult = (
  result: ShopCheckoutCommandResult,
): ExecuteShopCheckoutCommandUseCaseResponse => {
  if (result.ok !== true || 'duplicate' in result) return { result }

  return {
    result,
    shop: result.documents.shop,
    ...(result.documents.groupInventories ? { groupInventories: result.documents.groupInventories } : {}),
    ...(result.documents.trainerSheets ? { trainerSheets: result.documents.trainerSheets } : {}),
  }
}

const participantKey = (participant: Pick<CheckoutParticipantReference, 'kind' | 'slug'>): CheckoutParticipantKey => (
  `${participant.kind}:${participant.slug}` as CheckoutParticipantKey
)

const trainerSheetFromPersisted = (persisted: PersistedSheet): TrainerSheet => (
  persisted.sheet as unknown as TrainerSheet
)

const loadTrainerParticipant = (
  source: ShopCheckoutPaymentSource | ShopCheckoutDeliveryTarget,
  dependencies: ShopCheckoutCommandDependencySet,
): LoadedTrainerParticipant => {
  const persisted = dependencies.sheetRepository.getByRef('trainer', source.slug)
  if (!persisted) return rejectLivePlayCommand('not-found', `Trainer sheet ${source.slug} not found`)
  return {
    kind: 'trainer',
    slug: source.slug,
    revision: persisted.revision,
    document: trainerSheetFromPersisted(persisted),
    nextDocument: trainerSheetFromPersisted(persisted),
  }
}

const loadGroupInventoryParticipant = (
  source: ShopCheckoutPaymentSource | ShopCheckoutDeliveryTarget,
  dependencies: ShopCheckoutCommandDependencySet,
): LoadedGroupInventoryParticipant => {
  const stored = dependencies.groupInventoryRepository.get(source.slug)
  if (!stored) return rejectLivePlayCommand('not-found', `Group inventory ${source.slug} not found`)
  return {
    kind: 'groupInventory',
    slug: source.slug,
    revision: stored.revision,
    document: stored.document,
    nextDocument: stored.document,
  }
}

const loadParticipant = (
  participant: CheckoutParticipantReference,
  dependencies: ShopCheckoutCommandDependencySet,
  loadedParticipants: LoadedCheckoutParticipantMap,
): LoadedCheckoutParticipant => {
  const key = participantKey(participant)
  const loaded = loadedParticipants.get(key)
  if (loaded) return loaded

  const nextLoaded = participant.kind === 'trainer'
    ? loadTrainerParticipant(participant, dependencies)
    : loadGroupInventoryParticipant(participant, dependencies)
  loadedParticipants.set(key, nextLoaded)
  return nextLoaded
}

const assertRevisionMatches = (
  participant: CheckoutParticipantReference,
  loaded: LoadedCheckoutParticipant,
): void => {
  if (participant.revision === loaded.revision) return
  rejectLivePlayCommand(
    'stale-revision',
    `${participant.kind === 'trainer' ? 'Trainer sheet' : 'Group inventory'} ${participant.slug} is at revision ${loaded.revision}; refresh before checking out.`,
    { currentState: loaded.document },
  )
}

const checkoutActorProfileRequiredMessage = 'Choose a player profile before checking out from shops.'

const requireSelectedPlayerProfileForCheckout = (
  playerProfile: PlayerProfile | null | undefined,
): PlayerProfile => {
  if (playerProfile) return playerProfile
  return rejectLivePlayCommand('unauthorized', checkoutActorProfileRequiredMessage)
}

const assertCheckoutActorHasRequiredProfile = (
  input: ExecuteShopCheckoutCommandUseCaseInput,
): void => {
  if (input.role === 'gm') return
  requireSelectedPlayerProfileForCheckout(input.playerProfile)
}

const assertPlayerCanAccessShop = (shop: ShopTableDocument): void => {
  if (shop.playerVisible !== true) {
    rejectLivePlayCommand(
      'unauthorized',
      `Shop ${shop.slug} is not player visible.`,
      { currentRevision: shop.revision },
    )
  }

  if (shop.open !== true) {
    rejectLivePlayCommand(
      'unauthorized',
      `Shop ${shop.slug} is closed.`,
      { currentRevision: shop.revision },
    )
  }
}

const paymentSourceKindLabel = (source: ShopCheckoutPaymentSource): string => (
  source.kind === 'trainer' ? 'trainer money' : 'group inventory funds'
)

const deliveryTargetKindLabel = (target: ShopCheckoutDeliveryTarget): string => (
  target.kind === 'trainer' ? 'trainer inventory' : 'group inventory delivery'
)

const assertShopAllowsPaymentSource = (
  shop: ShopTableDocument,
  source: ShopCheckoutPaymentSource,
): void => {
  if (shop.allowedPaymentSources.includes(source.kind)) return
  rejectLivePlayCommand(
    'unauthorized',
    `Shop ${shop.slug} does not allow ${paymentSourceKindLabel(source)} as a payment source.`,
    { currentRevision: shop.revision },
  )
}

const assertShopAllowsDeliveryTarget = (
  shop: ShopTableDocument,
  target: ShopCheckoutDeliveryTarget,
): void => {
  if (shop.allowedDeliveryTargets.includes(target.kind)) return
  rejectLivePlayCommand(
    'unauthorized',
    `Shop ${shop.slug} does not allow ${deliveryTargetKindLabel(target)} as a delivery target.`,
    { currentRevision: shop.revision },
  )
}

const assertPlayerCanUseTrainerParticipant = (
  playerProfile: PlayerProfile,
  participant: CheckoutParticipantReference,
  usage: 'payment source' | 'delivery target',
): void => {
  if (participant.kind !== 'trainer') return
  if (playerProfileCanAccessSheet(playerProfile, 'trainer', participant.slug)) return
  rejectLivePlayCommand(
    'unauthorized',
    `Trainer sheet ${participant.slug} is not linked to the selected player profile for shop checkout ${usage}.`,
  )
}

const authorizeCheckoutActorForShop = (
  input: ExecuteShopCheckoutCommandUseCaseInput,
  command: ShopCheckoutLivePlayCommand,
  shop: ShopTableDocument,
): void => {
  if (input.role === 'gm') return
  const playerProfile = requireSelectedPlayerProfileForCheckout(input.playerProfile)

  assertPlayerCanAccessShop(shop)
  assertShopAllowsPaymentSource(shop, command.payload.paymentSource)
  assertShopAllowsDeliveryTarget(shop, command.payload.deliveryTarget)
  assertPlayerCanUseTrainerParticipant(playerProfile, command.payload.paymentSource, 'payment source')
  assertPlayerCanUseTrainerParticipant(playerProfile, command.payload.deliveryTarget, 'delivery target')
}

const loadCheckoutDocuments = (
  command: ShopCheckoutLivePlayCommand,
  input: ExecuteShopCheckoutCommandUseCaseInput,
  dependencies: ShopCheckoutCommandDependencySet,
): LoadedShopCheckoutDocuments => {
  const storedShop = dependencies.shopTableRepository.get(command.payload.shopSlug)
  if (!storedShop) return rejectLivePlayCommand('not-found', `Shop ${command.payload.shopSlug} not found`)

  const shop = storedShop.document
  if (shop.revision !== command.payload.shopRevision) {
    rejectLivePlayCommand(
      'stale-revision',
      `Shop ${shop.slug} is at revision ${shop.revision}; refresh before checking out.`,
      { currentRevision: shop.revision, currentState: shop },
    )
  }

  authorizeCheckoutActorForShop(input, command, shop)

  const participants: LoadedCheckoutParticipantMap = new Map()
  const paymentSource = loadParticipant(command.payload.paymentSource, dependencies, participants)
  const deliveryTarget = loadParticipant(command.payload.deliveryTarget, dependencies, participants)
  assertRevisionMatches(command.payload.paymentSource, paymentSource)
  assertRevisionMatches(command.payload.deliveryTarget, deliveryTarget)

  return { shop, participants }
}

const paymentParticipant = (
  participants: LoadedCheckoutParticipantMap,
  source: ShopCheckoutPaymentSource,
): LoadedCheckoutParticipant => {
  const participant = participants.get(participantKey(source))
  if (!participant) throw new Error(`Payment source ${source.kind}:${source.slug} was not loaded`)
  return participant
}

const deliveryParticipant = (
  participants: LoadedCheckoutParticipantMap,
  target: ShopCheckoutDeliveryTarget,
): LoadedCheckoutParticipant => {
  const participant = participants.get(participantKey(target))
  if (!participant) throw new Error(`Delivery target ${target.kind}:${target.slug} was not loaded`)
  return participant
}

const applyPayment = (
  source: LoadedCheckoutParticipant,
  totalPrice: number,
): void => {
  if (source.kind === 'trainer') {
    source.nextDocument = subtractShopCheckoutMoney(source.nextDocument, totalPrice)
    return
  }

  source.nextDocument = subtractShopCheckoutMoney(source.nextDocument, totalPrice)
}

const applyDelivery = (
  target: LoadedCheckoutParticipant,
  purchasedEntries: ReturnType<typeof calculateShopCheckout>['purchasedEntries'],
  dependencies: ShopCheckoutCommandDependencySet,
): void => {
  if (target.kind === 'trainer') {
    target.nextDocument = applyShopCheckoutDeliveryToTrainerSheet({
      trainerSheet: target.nextDocument,
      purchasedEntries,
    })
    return
  }

  target.nextDocument = applyShopCheckoutDeliveryToGroupInventory({
    groupInventory: target.nextDocument,
    purchasedEntries,
    ...(dependencies.createGroupInventoryRowId
      ? { createTargetRowId: dependencies.createGroupInventoryRowId }
      : {}),
  })
}

const applyCheckout = (
  command: ShopCheckoutLivePlayCommand,
  loaded: LoadedShopCheckoutDocuments,
  dependencies: ShopCheckoutCommandDependencySet,
): AppliedShopCheckoutDocuments => {
  const calculation = calculateShopCheckout({
    shop: loaded.shop,
    lines: command.payload.lines,
  })

  applyPayment(paymentParticipant(loaded.participants, command.payload.paymentSource), calculation.totalPrice)
  applyDelivery(deliveryParticipant(loaded.participants, command.payload.deliveryTarget), calculation.purchasedEntries, dependencies)

  return {
    shop: calculation.shop,
    participants: loaded.participants,
    totalPrice: calculation.totalPrice,
    lines: calculation.lines,
  }
}

const participantValues = (
  participants: LoadedCheckoutParticipantMap,
): readonly LoadedCheckoutParticipant[] => [...participants.values()]

const persistShopDocument = (
  command: ShopCheckoutLivePlayCommand,
  applied: AppliedShopCheckoutDocuments,
  dependencies: ShopCheckoutCommandDependencySet,
  updatedAt: number,
): ShopTableDocument => {
  const result = dependencies.shopTableRepository.applyLivePlayUpdate({
    slug: command.payload.shopSlug,
    expectedRevision: command.payload.shopRevision,
    nextDocument: {
      ...applied.shop,
      updatedAt,
    },
    now: updatedAt,
  })
  if (result.status === 'stale') {
    return rejectLivePlayCommand(
      'stale-revision',
      `Shop ${command.payload.shopSlug} changed before the checkout command could be persisted.`,
      {
        currentRevision: result.current?.revision,
        currentState: result.current ?? undefined,
      },
    )
  }
  return result.document
}

const persistGroupInventoryParticipant = (
  participant: LoadedGroupInventoryParticipant,
  dependencies: ShopCheckoutCommandDependencySet,
  updatedAt: number,
): GroupInventoryDocument => {
  const result = dependencies.groupInventoryRepository.applyLivePlayUpdate({
    slug: participant.slug,
    expectedRevision: participant.revision,
    nextDocument: {
      ...participant.nextDocument,
      updatedAt,
    },
    now: updatedAt,
  })
  if (result.status === 'stale') {
    return rejectLivePlayCommand(
      'stale-revision',
      `Group inventory ${participant.slug} changed before the checkout command could be persisted.`,
      {
        currentRevision: result.current?.revision,
        currentState: result.current ?? undefined,
      },
    )
  }
  return result.document
}

const persistTrainerParticipant = (
  participant: LoadedTrainerParticipant,
  dependencies: ShopCheckoutCommandDependencySet,
  updatedAt: number,
): TrainerSheet => {
  const result = dependencies.sheetRepository.applyLivePlayUpdate({
    kind: 'trainer',
    slug: participant.slug,
    expectedRevision: participant.revision,
    nextSheet: {
      ...participant.nextDocument,
      updatedAt,
    } as Record<string, unknown>,
  })
  if (result === 'stale') {
    rejectLivePlayCommand(
      'stale-revision',
      `Trainer sheet ${participant.slug} changed before the checkout command could be persisted.`,
    )
  }

  const authoritative = dependencies.sheetRepository.getByRef('trainer', participant.slug)
  if (!authoritative) return rejectLivePlayCommand('not-found', `Trainer sheet ${participant.slug} not found after checkout`)
  return trainerSheetFromPersisted(authoritative)
}

const persistParticipantDocuments = (
  applied: AppliedShopCheckoutDocuments,
  dependencies: ShopCheckoutCommandDependencySet,
  updatedAt: number,
): Omit<PersistedShopCheckoutDocuments, 'shop'> => {
  const groupInventories: GroupInventoryDocument[] = []
  const trainerSheets: TrainerSheet[] = []

  for (const participant of participantValues(applied.participants)) {
    if (participant.kind === 'groupInventory') {
      groupInventories.push(persistGroupInventoryParticipant(participant, dependencies, updatedAt))
      continue
    }

    trainerSheets.push(persistTrainerParticipant(participant, dependencies, updatedAt))
  }

  return { groupInventories, trainerSheets }
}

const changedDocuments = (
  documents: PersistedShopCheckoutDocuments,
): ShopCheckoutChangedDocuments => ({
  shop: documents.shop,
  ...(documents.groupInventories.length > 0 ? { groupInventories: documents.groupInventories } : {}),
  ...(documents.trainerSheets.length > 0 ? { trainerSheets: documents.trainerSheets } : {}),
})

const acceptedResult = (
  command: ShopCheckoutLivePlayCommand,
  loaded: LoadedShopCheckoutDocuments,
  applied: AppliedShopCheckoutDocuments,
  persisted: PersistedShopCheckoutDocuments,
): ShopCheckoutCommandAccepted => ({
  ok: true,
  opId: command.opId,
  shopSlug: command.payload.shopSlug,
  previousShopRevision: loaded.shop.revision,
  shopRevision: persisted.shop.revision,
  totalPrice: applied.totalPrice,
  lines: applied.lines,
  documents: changedDocuments(persisted),
})

const storeTerminalResult = (
  command: ShopCheckoutLivePlayCommand,
  commandHash: ShopCheckoutCommandHash,
  result: StorableShopCheckoutCommandResult,
  dependencies: ShopCheckoutCommandDependencySet,
): StorableShopCheckoutCommandResult => dependencies.operationRepository.saveCommandResult({
  shopSlug: command.payload.shopSlug,
  opId: validateLivePlayOperationId(command.opId, 'shop checkout command opId'),
  command,
  commandHash,
  result,
}).result

const collisionResultForCommand = (
  command: ShopCheckoutLivePlayCommand,
  commandHash: ShopCheckoutCommandHash,
  error: unknown,
): StorableShopCheckoutCommandResult | null => {
  if (!isShopCheckoutOperationResultConflictError(error)) return null
  if (error.shopSlug !== command.payload.shopSlug || error.opId !== command.opId || error.commandHash !== commandHash) {
    return null
  }
  return error.existingResult
}

const idempotencyViolationResultFromError = (
  command: ShopCheckoutLivePlayCommand,
  error: unknown,
  currentShopRevision?: number,
): ShopCheckoutCommandRejected | null => {
  if (!(error instanceof Error) || !error.message.includes('already recorded for a different command envelope')) return null
  return createShopCheckoutRejectedResult({
    opId: command.opId,
    shopSlug: command.payload.shopSlug,
    reason: 'conflict',
    message: error.message,
    currentShopRevision,
  })
}

const saveRejectedResult = (
  command: ShopCheckoutLivePlayCommand,
  commandHash: ShopCheckoutCommandHash,
  rejection: ShopCheckoutCommandRejected,
  dependencies: ShopCheckoutCommandDependencySet,
): StorableShopCheckoutCommandResult => {
  try {
    return storeTerminalResult(command, commandHash, rejection, dependencies)
  } catch (error) {
    return collisionResultForCommand(command, commandHash, error)
      ?? idempotencyViolationResultFromError(command, error, rejection.currentShopRevision)
      ?? persistenceFailedResult(command, error, rejection.currentShopRevision)
  }
}

const storedResultOrViolation = (
  command: ShopCheckoutLivePlayCommand,
  commandHash: ShopCheckoutCommandHash,
  dependencies: ShopCheckoutCommandDependencySet,
): StorableShopCheckoutCommandResult | null => {
  const existing = dependencies.operationRepository.getStoredOperation(command.payload.shopSlug, command.opId)
  if (!existing) return null
  if (
    existing.commandHash === commandHash
    && areShopCheckoutCommandsSemanticallyEqual(existing.command, command)
  ) return existing.result

  return createShopCheckoutIdempotencyViolationResult(command, existing)
}

const executeFreshCheckout = (
  command: ShopCheckoutLivePlayCommand,
  input: ExecuteShopCheckoutCommandUseCaseInput,
  commandHash: ShopCheckoutCommandHash,
  dependencies: ShopCheckoutCommandDependencySet,
): StorableShopCheckoutCommandResult => {
  let loaded: LoadedShopCheckoutDocuments | null = null

  try {
    assertCheckoutActorHasRequiredProfile(input)
    loaded = loadCheckoutDocuments(command, input, dependencies)
    const applied = applyCheckout(command, loaded, dependencies)
    const updatedAt = dependencies.now()

    return dependencies.database.withTransaction(() => {
      const persistedShop = persistShopDocument(command, applied, dependencies, updatedAt)
      const persistedParticipants = persistParticipantDocuments(applied, dependencies, updatedAt)
      const persisted = {
        shop: persistedShop,
        groupInventories: persistedParticipants.groupInventories,
        trainerSheets: persistedParticipants.trainerSheets,
      }
      const result = acceptedResult(command, loaded as LoadedShopCheckoutDocuments, applied, persisted)
      return storeTerminalResult(command, commandHash, result, dependencies)
    })
  } catch (error) {
    if (error instanceof ShopCheckoutCalculationError && loaded) {
      return saveRejectedResult(
        command,
        commandHash,
        rejectionFromCheckoutCalculationError(command, error, loaded.shop),
        dependencies,
      )
    }

    const currentShopRevision = loaded?.shop.revision
    const currentState = loaded?.shop
    if (error instanceof LivePlayCommandRejectionError) {
      return saveRejectedResult(
        command,
        commandHash,
        rejectionFromError(command, error, currentShopRevision, currentState),
        dependencies,
      )
    }

    return collisionResultForCommand(command, commandHash, error)
      ?? idempotencyViolationResultFromError(command, error, currentShopRevision)
      ?? persistenceFailedResult(command, error, currentShopRevision)
  }
}

export const executeShopCheckoutCommandUseCase = (
  input: ExecuteShopCheckoutCommandUseCaseInput,
  dependencies: ExecuteShopCheckoutCommandDependencies = {},
): ExecuteShopCheckoutCommandUseCaseResponse => {
  const deps = actionDependencies(dependencies)
  let command: ShopCheckoutLivePlayCommand

  try {
    command = parseShopCheckoutLivePlayCommand(input.command)
  } catch (error) {
    return responseFromResult(invalidEnvelopeResult(
      input.command,
      error instanceof LivePlayCommandRejectionError ? error.message : errorMessage(error),
    ))
  }

  let commandHash: ShopCheckoutCommandHash
  try {
    commandHash = createShopCheckoutCommandHash(command)
  } catch (error) {
    return responseFromResult(invalidEnvelopeResult(command, errorMessage(error)))
  }

  const storedResult = storedResultOrViolation(command, commandHash, deps)
  if (storedResult) return responseFromResult(storedResult)

  return responseFromResult(executeFreshCheckout(command, input, commandHash, deps))
}
