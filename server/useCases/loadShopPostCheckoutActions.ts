import type { AuthRole } from '#shared/auth'
import type { InventoryActionOfferV1 } from '#shared/itemAutomation/inventoryActions'
import type { SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import { parseShopCheckoutContinuationReceipt, type ShopCheckoutContinuationV1, type ShopPostCheckoutActionItemV1, type ShopPostCheckoutActionProjectionV1, type ShopPostCheckoutActionRequestV1 } from '#shared/shopPostCheckout'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { ShopCheckoutCommandAccepted, ShopCheckoutDeliveryTarget } from '#shared/livePlayCommands'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import {
  inventoryTransferEntriesCanMerge,
  normalizeInventoryItemNameIdentity,
} from '~/utils/groupInventoryTransfers'
import { stableJsonStringify } from '~/utils/serialization'
import {
  createShopPostCheckoutActionProjection,
  groupInventoryContinuationHref,
  postCheckoutAction,
  shopCheckoutContinuationId,
  trainerInventoryContinuationHref,
} from '../domain/shopPostCheckout'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteShopCheckoutOperationRepository, type ShopCheckoutOperationRepository } from '../storage/shopCheckoutOperationRepository'
import { loadGroupInventoryActionAuthority } from './loadGroupInventoryActions'
import { loadGroupInventoryItemActionAuthority } from './loadGroupInventoryItemActions'
import { loadTrainerInventoryActionAuthority } from './loadTrainerInventoryActions'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LoadShopPostCheckoutActionsUseCaseError extends UseCaseHttpError<403 | 404 | 409> {}

export interface LoadShopPostCheckoutActionsInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly request: ShopPostCheckoutActionRequestV1
}

export interface LoadShopPostCheckoutActionsDependencies {
  readonly database?: RotomDatabase
  readonly operationRepository?: Pick<ShopCheckoutOperationRepository, 'getStoredOperation'>
  readonly now?: () => number
}

const fail = (statusCode: 403 | 404 | 409, message: string): never => {
  throw new LoadShopPostCheckoutActionsUseCaseError(statusCode, message)
}
const rowId = (row: InventoryEntry | undefined): string | null => row?.id?.trim() || null
const currentRowById = (
  document: TrainerSheet | GroupInventoryDocument,
  section: ShopCheckoutContinuationV1['source']['section'],
  id: string,
): { readonly row: InventoryEntry, readonly index: number } | null => {
  const rows = document.inventory?.[section] ?? []
  const matches = rows.flatMap((row, index) => rowId(row) === id ? [{ row, index }] : [])
  return matches.length === 1 ? matches[0]! : null
}
const acceptedTargetDocument = (
  result: ShopCheckoutCommandAccepted,
  target: ShopCheckoutDeliveryTarget,
): TrainerSheet | GroupInventoryDocument | null => target.kind === 'trainer'
  ? result.documents.trainerSheets?.find(sheet => sheet.slug === target.slug) ?? null
  : result.documents.groupInventories?.find(document => document.slug === target.slug) ?? null

interface ExactAcceptedDeliveryRow {
  readonly rowId: string
  readonly row: InventoryEntry
}

const exactAcceptedRow = (input: {
  readonly operationId: string
  readonly target: ShopCheckoutDeliveryTarget
  readonly targetDocument: TrainerSheet | GroupInventoryDocument
  readonly continuation: ShopCheckoutContinuationV1
  readonly receiptIndex: number
}): ExactAcceptedDeliveryRow => {
  const targetRevision = input.targetDocument.revision
  if (!Number.isSafeInteger(targetRevision) || Number(targetRevision) < 0) {
    return fail(409, 'The accepted purchase continuation has an invalid delivery revision.')
  }
  const rows = input.targetDocument.inventory?.[input.continuation.source.section] ?? []
  const matches = rows.flatMap((row) => {
    const id = rowId(row)
    if (!id) return []
    return shopCheckoutContinuationId({
      operationId: input.operationId,
      target: input.target,
      targetRevision: Number(targetRevision),
      section: input.continuation.source.section,
      rowId: id,
      receiptIndex: input.receiptIndex,
    }) === input.continuation.continuationId ? [{ rowId: id, row }] : []
  })
  if (matches.length !== 1) return fail(409, 'The accepted purchase continuation lost its exact delivery source.')
  return matches[0]!
}

const sameOptionalText = (left: unknown, right: unknown): boolean => (
  (typeof left === 'string' ? left.trim() : '') === (typeof right === 'string' ? right.trim() : '')
)
const stillRepresentsAcceptedDelivery = (
  section: ShopCheckoutContinuationV1['source']['section'],
  accepted: InventoryEntry,
  current: InventoryEntry,
): boolean => {
  if (section !== 'equipment') return inventoryTransferEntriesCanMerge(section, accepted, current)
  return normalizeInventoryItemNameIdentity(accepted.name) === normalizeInventoryItemNameIdentity(current.name)
    && accepted.cost === current.cost
    && sameOptionalText(accepted.description, current.description)
    && sameOptionalText(accepted.mod, current.mod)
    && sameOptionalText(accepted.slot, current.slot)
    && stableJsonStringify(accepted.itemVariant ?? null) === stableJsonStringify(current.itemVariant ?? null)
    && stableJsonStringify(accepted.serializedEquipment ?? null) === stableJsonStringify(current.serializedEquipment ?? null)
}

const offerReason = (offer: InventoryActionOfferV1 | null, fallback: string): string => (
  offer?.unavailableReason?.label ?? fallback
)
const sheetOfferReason = (
  offer: SheetItemActionOfferV1 | null,
  action: 'use' | 'inspect',
  fallback: string,
): string => offer?.actions.find(row => row.kind === action)?.unavailableReason?.label
  ?? offer?.availability.unavailableReason?.label
  ?? fallback

const trainerAction = (input: {
  readonly continuationId: string
  readonly trainerSlug: string
  readonly kind: 'inspect' | 'use' | 'equip' | 'give' | 'move-to-group'
  readonly offer: InventoryActionOfferV1 | null
}) => {
  const action = input.kind === 'move-to-group' ? 'transfer' : input.kind
  const enabled = input.offer?.enabled === true
  const href = enabled
    ? input.kind === 'inspect'
      ? input.offer?.execution.href
      : trainerInventoryContinuationHref({
          trainerSlug: input.trainerSlug,
          action: action as 'use' | 'equip' | 'give' | 'transfer',
          sourceSelectionId: input.offer!.source.sourceSelectionId,
        })
    : null
  const labels = {
    inspect: 'Inspect',
    use: 'Use now',
    equip: 'Equip now',
    give: 'Give now',
    'move-to-group': 'Move to group',
  } as const
  const fallback = input.kind === 'equip'
    ? 'This item is not equipment.'
    : input.kind === 'give'
      ? 'This item has no current Pokémon equipment destination.'
      : input.kind === 'use'
        ? 'No current legal use is available.'
        : input.kind === 'inspect'
          ? 'No canonical item reference is available.'
          : 'Group inventory is not currently available.'
  return postCheckoutAction({
    continuationId: input.continuationId,
    kind: input.kind,
    label: labels[input.kind],
    authorityIdentity: input.offer?.offerId ?? `unavailable:${input.kind}`,
    href,
    unavailableReason: offerReason(input.offer, fallback),
  })
}

const trainerItem = (input: {
  readonly continuation: ShopCheckoutContinuationV1
  readonly rowId: string
  readonly acceptedRow: InventoryEntry
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly trainerSlug: string
  readonly database: RotomDatabase
  readonly now: number
}): ShopPostCheckoutActionItemV1 => {
  const authority = loadTrainerInventoryActionAuthority({
    role: input.role,
    playerProfile: input.playerProfile,
    trainerSlug: input.trainerSlug,
  }, { database: input.database, now: () => input.now })
  const offers = [...authority.bindings.values()]
    .filter(binding => rowId(binding.sourceEntry) === input.rowId
      && binding.offer.source.section === input.continuation.source.section
      && stillRepresentsAcceptedDelivery(input.continuation.source.section, input.acceptedRow, binding.sourceEntry))
    .map(binding => binding.offer)
  const byAction = (action: InventoryActionOfferV1['action']) => offers.find(offer => offer.action === action) ?? null
  const equip = byAction('equip')
  const give = byAction('give')
  const destination = [equip, give].flatMap(offer => offer?.destination.options.filter(option => option.enabled) ?? [])[0]
  return Object.freeze({
    ...input.continuation,
    actions: Object.freeze([
      trainerAction({ continuationId: input.continuation.continuationId, trainerSlug: input.trainerSlug, kind: 'inspect', offer: byAction('inspect') }),
      trainerAction({ continuationId: input.continuation.continuationId, trainerSlug: input.trainerSlug, kind: 'use', offer: byAction('use') }),
      trainerAction({ continuationId: input.continuation.continuationId, trainerSlug: input.trainerSlug, kind: 'equip', offer: equip }),
      trainerAction({ continuationId: input.continuation.continuationId, trainerSlug: input.trainerSlug, kind: 'give', offer: give }),
      trainerAction({ continuationId: input.continuation.continuationId, trainerSlug: input.trainerSlug, kind: 'move-to-group', offer: byAction('transfer') }),
    ]),
    destinationSummary: destination ? `${destination.label} available` : null,
  })
}

const unavailableGroupAction = (input: {
  readonly continuationId: string
  readonly kind: 'inspect' | 'use' | 'equip' | 'transfer-to-trainer'
  readonly label: string
  readonly reason: string
}) => postCheckoutAction({
  continuationId: input.continuationId,
  kind: input.kind,
  label: input.label,
  authorityIdentity: `unavailable:${input.kind}`,
  unavailableReason: input.reason,
})

const groupItem = (input: {
  readonly continuation: ShopCheckoutContinuationV1
  readonly rowId: string
  readonly acceptedRow: InventoryEntry
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly groupSlug: string
  readonly database: RotomDatabase
  readonly now: number
}): ShopPostCheckoutActionItemV1 => {
  const transfers = loadGroupInventoryActionAuthority({
    role: input.role,
    playerProfile: input.playerProfile,
    groupSlug: input.groupSlug,
  }, { database: input.database, now: () => input.now })
  const transfer = [...transfers.bindings.values()]
    .find(binding => binding.direction === 'group-to-trainer'
      && rowId(binding.sourceRow) === input.rowId
      && binding.offer.source.section === input.continuation.source.section
      && stillRepresentsAcceptedDelivery(input.continuation.source.section, input.acceptedRow, binding.sourceRow))?.offer ?? null
  const itemAuthority = loadGroupInventoryItemActionAuthority({
    role: input.role,
    playerProfile: input.playerProfile,
    groupSlug: input.groupSlug,
  }, { database: input.database, now: () => input.now })
  const current = currentRowById(itemAuthority.groupInventory, input.continuation.source.section, input.rowId)
  const currentAcceptedSource = current
    && stillRepresentsAcceptedDelivery(input.continuation.source.section, input.acceptedRow, current.row)
  const itemOffer = current && currentAcceptedSource
    ? itemAuthority.projection.offers.find(offer => offer.source.section === input.continuation.source.section
      && offer.source.rowIndex === current.index) ?? null
    : null
  const use = itemOffer?.actions.find(action => action.kind === 'use') ?? null
  const inspect = itemOffer?.actions.find(action => action.kind === 'inspect') ?? null
  const useHref = itemOffer?.availability.enabled && use?.enabled && itemAuthority.actorSelectionId
    ? groupInventoryContinuationHref({
        action: 'use',
        sourceSelectionId: itemOffer.source.sourceSelectionId,
        actorSelectionId: itemAuthority.actorSelectionId,
      })
    : null
  const inspectHref = inspect?.enabled ? inspect.href : null
  const transferHref = transfer?.enabled
    ? groupInventoryContinuationHref({ action: 'transfer', sourceSelectionId: transfer.source.sourceSelectionId })
    : null
  const destination = transfer?.destination.options.find(option => option.enabled)
  return Object.freeze({
    ...input.continuation,
    actions: Object.freeze([
      inspectHref ? postCheckoutAction({
        continuationId: input.continuation.continuationId,
        kind: 'inspect', label: 'Inspect', authorityIdentity: itemOffer?.offerId ?? inspectHref,
        href: inspectHref,
      }) : unavailableGroupAction({
        continuationId: input.continuation.continuationId,
        kind: 'inspect', label: 'Inspect',
        reason: sheetOfferReason(itemOffer, 'inspect', 'No canonical item reference is available.'),
      }),
      useHref ? postCheckoutAction({
        continuationId: input.continuation.continuationId,
        kind: 'use', label: 'Use now', authorityIdentity: itemOffer!.offerId,
        href: useHref,
      }) : unavailableGroupAction({
        continuationId: input.continuation.continuationId,
        kind: 'use', label: 'Use now',
        reason: sheetOfferReason(itemOffer, 'use', 'No current legal shared use is available.'),
      }),
      unavailableGroupAction({
        continuationId: input.continuation.continuationId,
        kind: 'equip', label: 'Equip now',
        reason: 'Transfer this item to a Trainer before equipping it.',
      }),
      transferHref ? postCheckoutAction({
        continuationId: input.continuation.continuationId,
        kind: 'transfer-to-trainer', label: 'Transfer to Trainer', authorityIdentity: transfer!.offerId,
        href: transferHref,
      }) : unavailableGroupAction({
        continuationId: input.continuation.continuationId,
        kind: 'transfer-to-trainer', label: 'Transfer to Trainer',
        reason: offerReason(transfer, 'No eligible Trainer destination is currently available.'),
      }),
    ]),
    destinationSummary: destination ? `${destination.label} eligible` : null,
  })
}

export const loadShopPostCheckoutActionsUseCase = (
  input: LoadShopPostCheckoutActionsInput,
  dependencies: LoadShopPostCheckoutActionsDependencies = {},
): ShopPostCheckoutActionProjectionV1 => {
  if (input.role === 'player' && !input.playerProfile) {
    return fail(403, 'Choose the player profile that made this purchase before continuing.')
  }
  const database = dependencies.database ?? getRotomDatabase()
  const operations = dependencies.operationRepository ?? createSqliteShopCheckoutOperationRepository({ database })
  const stored = operations.getStoredOperation(input.request.shopSlug, input.request.checkoutOperationId)
  if (!stored) return fail(404, 'The accepted checkout receipt is no longer available.')
  if (!stored.result.ok) return fail(409, 'Post-checkout actions require an accepted purchase receipt.')
  const result = stored.result
  if (!result.postCheckout) return fail(409, 'This older checkout receipt has no exact post-checkout continuation authority.')
  const receipt = parseShopCheckoutContinuationReceipt(result.postCheckout)
  const requested = new Set(input.request.continuationIds)
  if (requested.size !== input.request.continuationIds.length
    || [...requested].some(id => !receipt.continuations.some(row => row.continuationId === id))) {
    return fail(409, 'The requested post-checkout continuation does not belong to this accepted receipt.')
  }
  const target = stored.command.payload.deliveryTarget
  const targetDocument = acceptedTargetDocument(result, target)
  if (!targetDocument) return fail(409, 'The accepted checkout receipt lost its delivery document authority.')
  const now = (dependencies.now ?? Date.now)()
  const items = receipt.continuations.flatMap((continuation, receiptIndex) => {
    if (!requested.has(continuation.continuationId)) return []
    const acceptedRow = exactAcceptedRow({
      operationId: stored.opId,
      target,
      targetDocument,
      continuation,
      receiptIndex,
    })
    return [target.kind === 'trainer'
      ? trainerItem({
          continuation, rowId: acceptedRow.rowId, acceptedRow: acceptedRow.row,
          role: input.role, playerProfile: input.playerProfile,
          trainerSlug: target.slug, database, now,
        })
      : groupItem({
          continuation, rowId: acceptedRow.rowId, acceptedRow: acceptedRow.row,
          role: input.role, playerProfile: input.playerProfile,
          groupSlug: target.slug, database, now,
        })]
  })
  return createShopPostCheckoutActionProjection({ generatedAt: now, items })
}
