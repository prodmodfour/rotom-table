import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
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
import type { MapShopInterface, SheetPlacement, TabletopMap } from '~/types/map'
import {
  appendShopPurchaseAuditEntry,
  type ShopPurchaseAuditEntry,
  type ShopTableDocument,
} from '~/types/shop'
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
  createSqliteMapRepository,
  type MapRepository,
} from '../storage/mapRepository'
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
  createSqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import {
  createSqliteShopTableRepository,
  type ShopTableRepository,
} from '../storage/shopTableRepository'
import { canAccessMapForRole } from '../policies/mapPolicy'
import { playerProfileCanAccessSheet } from '../policies/playerProfilePolicy'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControl,
} from '../policies/playerProfileTokenControlPolicy'
import {
  shopCheckoutRealtimeAppendInputs,
  shopCheckoutRejectedRealtimeAppendInput,
} from '../realtime/shopCheckoutRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'

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
  readonly mapRepository?: Pick<MapRepository, 'getBySlug'> & { readonly database?: RotomDatabase }
  readonly operationRepository?: Pick<ShopCheckoutOperationRepository, 'getStoredOperation' | 'saveCommandResult'>
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly now?: () => number
  readonly createGroupInventoryRowId?: InventoryTransferTargetRowIdGenerator
}

interface ShopCheckoutCommandDependencySet {
  readonly database: RotomDatabase
  readonly shopTableRepository: Pick<ShopTableRepository, 'get' | 'applyLivePlayUpdate'>
  readonly groupInventoryRepository: Pick<GroupInventoryRepository, 'get' | 'applyLivePlayUpdate'>
  readonly sheetRepository: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'applyLivePlayUpdate'>
  readonly mapRepository: Pick<MapRepository, 'getBySlug'>
  readonly operationRepository: Pick<ShopCheckoutOperationRepository, 'getStoredOperation' | 'saveCommandResult'>
  readonly realtimeEventRepository: Pick<RealtimeEventRepository, 'appendMany'>
  readonly publishPersistedRealtimeEvent: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure: PersistedRealtimePublicationFailureReporter
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

interface ExecutedFreshShopCheckoutCommand {
  readonly result: StorableShopCheckoutCommandResult
  readonly realtimeEvents: readonly PersistedRealtimeEvent[]
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
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository(database)
  const operationRepository = dependencies.operationRepository ?? createSqliteShopCheckoutOperationRepository({ database })
  const realtimeEventRepository = dependencies.realtimeEventRepository ?? createSqliteRealtimeEventRepository({ database })

  assertRepositoryDatabase(database, dependencies.shopTableRepository?.database, 'shop table repository')
  assertRepositoryDatabase(database, dependencies.groupInventoryRepository?.database, 'group inventory repository')
  assertRepositoryDatabase(database, dependencies.sheetRepository?.database, 'sheet repository')
  assertRepositoryDatabase(database, dependencies.mapRepository?.database, 'map repository')
  assertRepositoryDatabase(database, dependencies.realtimeEventRepository?.database, 'realtime event repository')

  return {
    database,
    shopTableRepository,
    groupInventoryRepository,
    sheetRepository,
    mapRepository,
    operationRepository,
    realtimeEventRepository,
    publishPersistedRealtimeEvent: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportAfterCommitPublicationFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
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

const findMapShopInterface = (
  map: TabletopMap,
  interfaceId: string,
): MapShopInterface | null => (map.shopInterfaces ?? []).find((shopInterface) => (
  shopInterface.id === interfaceId
)) ?? null

const findMapPlacement = (
  map: TabletopMap,
  placementId: string,
): SheetPlacement | null => map.placements.find((placement) => placement.id === placementId) ?? null

const distanceMetersBetweenAnchors = (
  left: SheetPlacement['position'],
  right: NonNullable<MapShopInterface['position']>,
): number => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)

const formatDistance = (value: number): string => (
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
)

const linkedTrainerSheetsForMapTokenControl = (
  playerProfile: PlayerProfile,
  dependencies: ShopCheckoutCommandDependencySet,
) => playerProfileLinkedTrainerSheetsForTokenControl(playerProfile, (slug) => {
  const persisted = dependencies.sheetRepository.getByRef('trainer', slug)
  return persisted ? trainerSheetFromPersisted(persisted) : null
})

const assertPlayerCanUseMapOriginInterface = (
  shopInterface: MapShopInterface,
  mapSlug: string,
): void => {
  if (shopInterface.playerVisible === true) return
  rejectLivePlayCommand(
    'unauthorized',
    `Shop interface ${shopInterface.id} on map ${mapSlug} is not player visible.`,
  )
}

const assertMapOriginInterfaceMatchesShop = (
  shopInterface: MapShopInterface,
  command: ShopCheckoutLivePlayCommand,
  mapSlug: string,
): void => {
  if (shopInterface.shopSlug === command.payload.shopSlug) return
  rejectLivePlayCommand(
    'conflict',
    `Shop interface ${shopInterface.id} on map ${mapSlug} references shop ${shopInterface.shopSlug}, not ${command.payload.shopSlug}.`,
  )
}

const requirePlayerMapOriginActorPlacement = (
  input: ExecuteShopCheckoutCommandUseCaseInput,
  dependencies: ShopCheckoutCommandDependencySet,
  map: TabletopMap,
  actorPlacementId: string | undefined,
  reason: string,
): SheetPlacement => {
  if (!actorPlacementId) {
    return rejectLivePlayCommand('unauthorized', reason)
  }

  const actorPlacement = findMapPlacement(map, actorPlacementId)
  if (!actorPlacement) {
    return rejectLivePlayCommand('not-found', `Placement ${actorPlacementId} was not found on map ${map.slug}.`)
  }

  const playerProfile = requireSelectedPlayerProfileForCheckout(input.playerProfile)
  if (actorCanControlMapPlacement({
    role: input.role,
    profile: playerProfile,
    placement: actorPlacement,
    linkedTrainerSheets: linkedTrainerSheetsForMapTokenControl(playerProfile, dependencies),
  })) {
    return actorPlacement
  }

  return rejectLivePlayCommand(
    'unauthorized',
    `Placement ${actorPlacementId} is not linked to the selected player profile for map-origin shop checkout.`,
  )
}

const assertPlayerMapOriginRange = (
  map: TabletopMap,
  shopInterface: MapShopInterface,
  actorPlacement: SheetPlacement,
): void => {
  const range = shopInterface.interactionRangeMeters
  if (range === undefined) return

  const position = shopInterface.position
  if (!position) {
    return rejectLivePlayCommand(
      'conflict',
      `Shop interface ${shopInterface.id} on map ${map.slug} has an interaction range but no position.`,
    )
  }

  const distance = distanceMetersBetweenAnchors(actorPlacement.position, position)
  if (distance <= range) return

  rejectLivePlayCommand(
    'unauthorized',
    `Placement ${actorPlacement.id} is out of range for shop interface ${shopInterface.id} on map ${map.slug}: ${formatDistance(distance)}m away, range ${formatDistance(range)}m.`,
  )
}

const authorizeCheckoutMapOrigin = (
  input: ExecuteShopCheckoutCommandUseCaseInput,
  command: ShopCheckoutLivePlayCommand,
  dependencies: ShopCheckoutCommandDependencySet,
): void => {
  const origin = command.payload.origin
  if (!origin || origin.kind !== 'mapInterface') return

  const map = dependencies.mapRepository.getBySlug(origin.mapSlug)
  if (!map) return rejectLivePlayCommand('not-found', `Map ${origin.mapSlug} was not found.`)

  if (!canAccessMapForRole(input.role, map)) {
    rejectLivePlayCommand('unauthorized', `Map ${origin.mapSlug} is not player visible.`)
  }

  const shopInterface = findMapShopInterface(map, origin.interfaceId)
  if (!shopInterface) {
    return rejectLivePlayCommand('not-found', `Shop interface ${origin.interfaceId} was not found on map ${origin.mapSlug}.`)
  }

  assertMapOriginInterfaceMatchesShop(shopInterface, command, origin.mapSlug)

  if (input.role === 'gm') return
  assertPlayerCanUseMapOriginInterface(shopInterface, origin.mapSlug)

  const actorPlacementRequired = origin.actorPlacementId !== undefined || shopInterface.interactionRangeMeters !== undefined
  if (!actorPlacementRequired) return

  const actorPlacement = requirePlayerMapOriginActorPlacement(
    input,
    dependencies,
    map,
    origin.actorPlacementId,
    `Select a controlled map token before checking out from shop interface ${shopInterface.id} on map ${origin.mapSlug}.`,
  )
  assertPlayerMapOriginRange(map, shopInterface, actorPlacement)
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
  authorizeCheckoutMapOrigin(input, command, dependencies)

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

const purchaseAuditActor = (
  input: ExecuteShopCheckoutCommandUseCaseInput,
): ShopPurchaseAuditEntry['actor'] => ({
  role: input.role,
  ...(input.playerProfile?.id ? { profileId: input.playerProfile.id } : {}),
  ...(input.playerProfile?.displayName ? { profileName: input.playerProfile.displayName } : {}),
})

const purchaseAuditEntry = (
  command: ShopCheckoutLivePlayCommand,
  input: ExecuteShopCheckoutCommandUseCaseInput,
  applied: AppliedShopCheckoutDocuments,
  purchasedAt: number,
): ShopPurchaseAuditEntry => ({
  opId: command.opId,
  purchasedAt,
  actor: purchaseAuditActor(input),
  paymentSource: {
    kind: command.payload.paymentSource.kind,
    slug: command.payload.paymentSource.slug,
  },
  deliveryTarget: {
    kind: command.payload.deliveryTarget.kind,
    slug: command.payload.deliveryTarget.slug,
  },
  lines: applied.lines.map((line) => ({
    entryId: line.entryId,
    itemName: line.itemName,
    section: line.section,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
  })),
  total: applied.totalPrice,
})

const withPurchaseAuditEntry = (
  command: ShopCheckoutLivePlayCommand,
  input: ExecuteShopCheckoutCommandUseCaseInput,
  applied: AppliedShopCheckoutDocuments,
  purchasedAt: number,
): AppliedShopCheckoutDocuments => ({
  ...applied,
  shop: appendShopPurchaseAuditEntry(
    applied.shop,
    purchaseAuditEntry(command, input, applied, purchasedAt),
  ),
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

const appendAcceptedCheckoutRealtimeEvents = (
  command: ShopCheckoutLivePlayCommand,
  result: ShopCheckoutCommandAccepted,
  input: ExecuteShopCheckoutCommandUseCaseInput,
  dependencies: ShopCheckoutCommandDependencySet,
): readonly PersistedRealtimeEvent[] => dependencies.realtimeEventRepository.appendMany(
  shopCheckoutRealtimeAppendInputs({
    command,
    result,
    clientId: input.clientId,
  }),
)

const appendRejectedCheckoutRealtimeEvent = (
  command: ShopCheckoutLivePlayCommand,
  result: ShopCheckoutCommandRejected,
  input: ExecuteShopCheckoutCommandUseCaseInput,
  dependencies: ShopCheckoutCommandDependencySet,
): readonly PersistedRealtimeEvent[] => dependencies.realtimeEventRepository.appendMany([
  shopCheckoutRejectedRealtimeAppendInput({
    command,
    result,
    clientId: input.clientId,
  }),
])

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

const executedFreshResult = (
  result: StorableShopCheckoutCommandResult,
  realtimeEvents: readonly PersistedRealtimeEvent[] = [],
): ExecutedFreshShopCheckoutCommand => ({ result, realtimeEvents })

const executedRejectedCheckoutResult = (
  command: ShopCheckoutLivePlayCommand,
  input: ExecuteShopCheckoutCommandUseCaseInput,
  commandHash: ShopCheckoutCommandHash,
  rejection: ShopCheckoutCommandRejected,
  dependencies: ShopCheckoutCommandDependencySet,
): ExecutedFreshShopCheckoutCommand => {
  try {
    return dependencies.database.withTransaction(() => {
      const result = saveRejectedResult(command, commandHash, rejection, dependencies)
      const realtimeEvents = result.ok === false && result.reason !== 'persistence-failed'
        ? appendRejectedCheckoutRealtimeEvent(command, result, input, dependencies)
        : []
      return executedFreshResult(result, realtimeEvents)
    })
  } catch (error) {
    return executedFreshResult(persistenceFailedResult(command, error, rejection.currentShopRevision))
  }
}

const executeFreshCheckout = (
  command: ShopCheckoutLivePlayCommand,
  input: ExecuteShopCheckoutCommandUseCaseInput,
  commandHash: ShopCheckoutCommandHash,
  dependencies: ShopCheckoutCommandDependencySet,
): ExecutedFreshShopCheckoutCommand => {
  let loaded: LoadedShopCheckoutDocuments | null = null

  try {
    assertCheckoutActorHasRequiredProfile(input)
    loaded = loadCheckoutDocuments(command, input, dependencies)
    const applied = applyCheckout(command, loaded, dependencies)
    const updatedAt = dependencies.now()
    const auditedApplied = withPurchaseAuditEntry(command, input, applied, updatedAt)

    return dependencies.database.withTransaction(() => {
      const persistedShop = persistShopDocument(command, auditedApplied, dependencies, updatedAt)
      const persistedParticipants = persistParticipantDocuments(auditedApplied, dependencies, updatedAt)
      const persisted = {
        shop: persistedShop,
        groupInventories: persistedParticipants.groupInventories,
        trainerSheets: persistedParticipants.trainerSheets,
      }
      const result = acceptedResult(command, loaded as LoadedShopCheckoutDocuments, auditedApplied, persisted)
      const storedResult = storeTerminalResult(command, commandHash, result, dependencies)
      if (storedResult.ok !== true || 'duplicate' in storedResult) return executedFreshResult(storedResult)
      return executedFreshResult(
        storedResult,
        appendAcceptedCheckoutRealtimeEvents(command, storedResult, input, dependencies),
      )
    })
  } catch (error) {
    if (error instanceof ShopCheckoutCalculationError && loaded) {
      return executedRejectedCheckoutResult(
        command,
        input,
        commandHash,
        rejectionFromCheckoutCalculationError(command, error, loaded.shop),
        dependencies,
      )
    }

    const currentShopRevision = loaded?.shop.revision
    const currentState = loaded?.shop
    if (error instanceof LivePlayCommandRejectionError) {
      return executedRejectedCheckoutResult(
        command,
        input,
        commandHash,
        rejectionFromError(command, error, currentShopRevision, currentState),
        dependencies,
      )
    }

    const rejection = collisionResultForCommand(command, commandHash, error)
      ?? idempotencyViolationResultFromError(command, error, currentShopRevision)
      ?? persistenceFailedResult(command, error, currentShopRevision)
    return rejection.ok === false
      ? executedRejectedCheckoutResult(command, input, commandHash, rejection, dependencies)
      : executedFreshResult(rejection)
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

  const fresh = executeFreshCheckout(command, input, commandHash, deps)
  publishPersistedRealtimeEventsAfterCommit({
    events: fresh.realtimeEvents,
    operation: 'shop-checkout',
    publish: deps.publishPersistedRealtimeEvent,
    reportFailure: deps.reportAfterCommitPublicationFailure,
  })

  return responseFromResult(fresh.result)
}
