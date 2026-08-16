import itemsJson from '~~/data/reference/items.json'
import type { AuthRole } from '#shared/auth'
import {
  INVENTORY_HISTORY_LIMITS,
  INVENTORY_HISTORY_SCHEMA_VERSION,
  parseInventoryHistoryProjection,
  type InventoryHistoryFactKind,
  type InventoryHistoryFactV1,
  type InventoryHistoryProjectionV1,
  type InventoryHistoryScopeKind,
} from '#shared/itemAutomation/inventoryHistory'
import type { EquipmentOperationCommandV1 } from '#shared/itemAutomation/equipmentOperations'
import type { ItemOperationPlanV1 } from '#shared/itemAutomation/operations'
import type { PlayerProfile } from '#shared/playerProfiles'
import { playerProfileCanAccessSheet } from '../../policies/playerProfilePolicy'
import type {
  InventoryHistoryItemOperationSource,
  InventoryHistorySourceBatch,
} from '../../storage/inventoryHistorySourceRepository'
import type { StoredInventoryActionOperation } from '../../storage/inventoryActionOperationRepository'
import type { StoredEquipmentOperationRecord } from '../../storage/equipmentOperationRepository'
import type { StoredItemGuidedRequestRecord } from '../../storage/itemGuidedRequestRepository'
import type { SqliteShopCheckoutOperationRecord } from '../../storage/shopCheckoutOperationRepository'

export interface InventoryHistorySettlementAwardSource {
  /** Private durable settlement-line identity used only for retry deduplication. */
  readonly sourceKey: string
  readonly occurredAt: number
  readonly itemLabel: string
  readonly quantity: number
  readonly destinationLabel: string
  readonly details: readonly string[]
}

export interface ProjectInventoryHistoryInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly scope: {
    readonly kind: InventoryHistoryScopeKind
    readonly label: string
  }
  readonly sources: InventoryHistorySourceBatch
  /** P8-076 supplies these from its authoritative settlement journal. */
  readonly settlementAwards?: readonly InventoryHistorySettlementAwardSource[]
  readonly generatedAt: number
  readonly limit: number
}

interface CandidateFact {
  readonly privateSortKey: string
  readonly fact: InventoryHistoryFactV1
}

const canonicalItems = itemsJson as Record<string, { readonly name?: unknown }>
const safeItemLabel = (canonicalItemId: string | null | undefined): string => {
  const name = canonicalItemId ? canonicalItems[canonicalItemId]?.name : null
  const candidate = typeof name === 'string' && name.trim() ? name.trim() : canonicalItemId?.trim()
  return candidate ? boundedText(candidate) : 'Item'
}
const boundedText = (value: string): string => {
  if (!value || value !== value.trim()
    || value.length > INVENTORY_HISTORY_LIMITS.textLength
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Inventory history source contains unsafe presentation text.')
  }
  return value
}
const uniqueDetails = (values: readonly string[]): readonly string[] => Object.freeze(
  [...new Set(values.map(boundedText).filter(Boolean))].slice(0, INVENTORY_HISTORY_LIMITS.detailsPerFact),
)
const item = (label: string, quantity: number | null): InventoryHistoryFactV1['item'] => Object.freeze({
  label: boundedText(label),
  quantity,
})
const custody = (sourceLabel: string, destinationLabel: string): InventoryHistoryFactV1['custody'] => Object.freeze({
  sourceLabel: boundedText(sourceLabel),
  destinationLabel: boundedText(destinationLabel),
})
const candidate = (privateSortKey: string, fact: InventoryHistoryFactV1): CandidateFact => Object.freeze({
  privateSortKey,
  fact: Object.freeze({ ...fact, details: uniqueDetails(fact.details) }),
})
const displayQuantity = (label: string, quantity: number | null): string => quantity && quantity > 1
  ? `${label} ×${quantity}`
  : label
const money = (value: number): string => `$${value.toLocaleString('en-US')}`

const checkoutFacts = (record: SqliteShopCheckoutOperationRecord): readonly CandidateFact[] => {
  if (!record.result.ok) return Object.freeze([])
  const destinationLabel = record.command.payload.deliveryTarget.kind === 'trainer'
    ? 'Trainer inventory'
    : 'Shared inventory'
  return Object.freeze(record.result.lines.map((line, index) => candidate(
    `purchase:${record.opId}:${index}`,
    {
      kind: 'purchase',
      occurredAt: record.createdAt,
      headline: displayQuantity(line.itemName, line.quantity),
      item: item(line.itemName, line.quantity),
      custody: custody('Shop', destinationLabel),
      details: [
        `Purchase accepted for ${money(line.lineTotal)}.`,
        `Delivered to ${destinationLabel}.`,
      ],
    },
  )))
}

const transferLabels = (kind: 'transfer-to-group' | 'transfer-to-trainer') => kind === 'transfer-to-group'
  ? Object.freeze({ source: 'Trainer inventory', destination: 'Shared inventory' })
  : Object.freeze({ source: 'Shared inventory', destination: 'Trainer inventory' })

const inventoryActionFact = (record: StoredInventoryActionOperation): CandidateFact | null => {
  if (record.status !== 'accepted' || !record.accepted) return null
  const command = record.downstreamCommand
  if (command.kind === 'transfer-to-group' || command.kind === 'transfer-to-trainer') {
    const labels = transferLabels(command.kind)
    const label = command.itemLabel ?? 'Inventory item'
    return candidate(`inventory:${record.declaration.operationId}`, {
      kind: 'transfer',
      occurredAt: record.updatedAt,
      headline: `${displayQuantity(label, command.quantity)} transferred`,
      item: item(label, command.quantity),
      custody: custody(labels.source, labels.destination),
      details: [`Moved from ${labels.source} to ${labels.destination}.`],
    })
  }
  if (command.kind === 'inventory-stack-operation' && command.action === 'discard') {
    const label = command.sourceRowBefore.name.trim() || 'Inventory item'
    const source = command.containerKind === 'group' ? 'Shared inventory' : 'Trainer inventory'
    return candidate(`discard:${record.declaration.operationId}`, {
      kind: 'discard',
      occurredAt: record.updatedAt,
      headline: `${displayQuantity(label, command.quantity)} discarded`,
      item: item(label, command.quantity),
      custody: null,
      details: [`Permanently removed from ${source}.`],
    })
  }
  return null
}

const inventoryLocationLabel = (value: { readonly containerKind: 'trainer' | 'group' }): string => (
  value.containerKind === 'group' ? 'Shared inventory' : 'Trainer inventory'
)
const equipmentLocationLabel = (value: { readonly ownerKind: 'trainer' | 'pokemon' }): string => (
  value.ownerKind === 'trainer' ? 'Trainer equipment' : 'Pokémon held equipment'
)
const sourceLocationLabel = (command: EquipmentOperationCommandV1): string => command.source.kind === 'inventory'
  ? inventoryLocationLabel(command.source)
  : equipmentLocationLabel(command.source)
const destinationLocationLabel = (command: EquipmentOperationCommandV1): string | null => {
  if (!('destination' in command)) return null
  return command.destination.kind === 'inventory'
    ? inventoryLocationLabel(command.destination)
    : equipmentLocationLabel(command.destination)
}
const equipmentActionCopy: Readonly<Record<EquipmentOperationCommandV1['commandKind'], string>> = Object.freeze({
  equip: 'equipped',
  unequip: 'unequipped',
  swap: 'swapped',
  give: 'given to Pokémon equipment',
  take: 'returned to inventory',
  suppress: 'suppressed',
  deactivate: 'deactivated',
  break: 'broken',
  restore: 'restored',
  repair: 'repaired',
  damage: 'damaged',
  'restore-durability': 'durability restored',
})
const equipmentSlotLabels: Readonly<Record<string, string>> = Object.freeze({
  mainHand: 'Main Hand', offHand: 'Off Hand', head: 'Head', body: 'Body',
  feet: 'Feet', accessory: 'Accessory', held: 'Held Item',
})

const equipmentFact = (record: StoredEquipmentOperationRecord): CandidateFact => {
  const command = record.command
  const label = record.evidence.sourceInventoryRow?.name?.trim()
    || safeItemLabel(record.result.canonicalItemId)
  const destination = destinationLocationLabel(command)
  const details: string[] = []
  let movement: InventoryHistoryFactV1['custody'] = null
  if (destination) {
    const source = sourceLocationLabel(command)
    if (source !== destination) {
      movement = custody(source, destination)
      details.push(`Moved from ${source} to ${destination}.`)
    }
  }
  if ('destination' in command && command.destination.kind === 'equipment') {
    const slots = command.destination.slotIds.map(slot => equipmentSlotLabels[slot] ?? 'Equipment slot')
    if (slots.length) details.push(`${slots.join(' + ')} slot${slots.length === 1 ? '' : 's'}.`)
  }
  if (command.commandKind === 'swap' && record.result.displacedCanonicalItemId) {
    details.push(`${safeItemLabel(record.result.displacedCanonicalItemId)} returned to inventory in the same accepted change.`)
  }
  if (command.commandKind === 'damage' || command.commandKind === 'restore-durability') {
    details.push(`${command.amount} durability ${command.commandKind === 'damage' ? 'lost' : 'restored'}.`)
  }
  return candidate(`equipment:${record.operationId}`, {
    kind: 'equipment-change',
    occurredAt: record.createdAt,
    headline: `${label} ${equipmentActionCopy[command.commandKind]}`,
    item: item(label, 1),
    custody: movement,
    details,
  })
}

const consumedQuantity = (plan: ItemOperationPlanV1 | null): number | null => {
  const quantities = (plan?.operations ?? []).flatMap(operation => (
    operation.kind === 'inventory'
      && operation.payload.action === 'consume'
      && operation.payload.reservationOnly !== true
      && Number.isSafeInteger(operation.payload.quantity)
      && Number(operation.payload.quantity) > 0
      ? [Number(operation.payload.quantity)]
      : []
  ))
  if (!quantities.length) return null
  const total = quantities.reduce((sum, quantity) => sum + quantity, 0)
  return Number.isSafeInteger(total) ? total : null
}
const canReadReceiptAudience = (
  audience: ItemOperationPlanV1['receiptFacts'][number]['audience'],
  access: 'public' | 'owner' | 'gm',
): boolean => audience === 'public' || access === 'gm' || (audience === 'owner' && access === 'owner')
const itemAccess = (input: ProjectInventoryHistoryInput, source: InventoryHistoryItemOperationSource): 'public' | 'owner' | 'gm' => {
  if (input.role === 'gm') return 'gm'
  if (input.scope.kind === 'trainer') return 'owner'
  const actor = source.record.command.actorSheet
  return playerProfileCanAccessSheet(input.playerProfile, actor.kind, actor.slug) ? 'owner' : 'public'
}

const itemOperationFact = (
  input: ProjectInventoryHistoryInput,
  source: InventoryHistoryItemOperationSource,
): CandidateFact | null => {
  const record = source.record
  const plan = record.status === 'corrected' ? source.correctionOrigin?.plan ?? null : record.plan
  const canonicalItemId = record.canonicalItemId ?? source.correctionOrigin?.canonicalItemId
  const label = safeItemLabel(canonicalItemId)
  const quantity = consumedQuantity(plan)
  if (record.status === 'corrected') {
    const details = [
      'Inventory and affected state were restored from the accepted receipt.',
      ...(quantity ? [`${quantity} consumed item${quantity === 1 ? '' : 's'} restored.`] : []),
    ]
    return candidate(`correction:${record.operationId}`, {
      kind: 'gm-correction',
      occurredAt: record.updatedAt,
      headline: `${label} use corrected`,
      item: item(label, quantity),
      custody: null,
      details,
    })
  }
  if (record.status !== 'accepted' || record.result?.status !== 'accepted' || !record.plan) return null
  const access = itemAccess(input, source)
  const visibleReceipts = record.plan.receiptFacts.filter(receipt => canReadReceiptAudience(receipt.audience, access))
  const storedHeadline = visibleReceipts.find(receipt => receipt.factId === 'item-used')?.label
  const guidedRequest = source.guidedRequest?.status === 'accepted' ? source.guidedRequest : null
  const kind: InventoryHistoryFactKind = guidedRequest ? 'guided-outcome' : 'item-use'
  const details = visibleReceipts
    .filter(receipt => receipt.factId !== 'item-used')
    .map(receipt => receipt.label)
  if (guidedRequest?.result?.acceptedSummary && access !== 'public') {
    details.unshift(guidedRequest.result.acceptedSummary)
  }
  else if (guidedRequest && details.length === 0) {
    details.push('Guided outcome accepted.')
  }
  if (quantity) details.push(`${quantity} item${quantity === 1 ? '' : 's'} consumed.`)
  const occurredAt = guidedRequest?.updatedAt ?? record.updatedAt
  return candidate(`item:${record.operationId}`, {
    kind,
    occurredAt,
    headline: storedHeadline ?? `${label} was used.`,
    item: item(label, quantity),
    custody: null,
    details,
  })
}

const guidedRequestFact = (record: StoredItemGuidedRequestRecord): CandidateFact | null => {
  if (record.status !== 'accepted' || record.itemOperationId !== null || !record.result?.acceptedSummary) return null
  const label = safeItemLabel(record.canonicalItemId)
  return candidate(`guided:${record.requestId}`, {
    kind: 'guided-outcome',
    occurredAt: record.updatedAt,
    headline: `${label} guided outcome accepted`,
    item: item(label, null),
    custody: null,
    details: [record.result.acceptedSummary],
  })
}

const settlementAwardFact = (source: InventoryHistorySettlementAwardSource): CandidateFact => {
  if (!source.sourceKey.trim() || source.sourceKey.length > 500) {
    throw new Error('Inventory history settlement award source identity is invalid.')
  }
  return candidate(`settlement:${source.sourceKey}`, {
    kind: 'settlement-award',
    occurredAt: source.occurredAt,
    headline: `${displayQuantity(source.itemLabel, source.quantity)} awarded`,
    item: item(source.itemLabel, source.quantity),
    custody: custody('Encounter settlement', source.destinationLabel),
    details: source.details,
  })
}

export const projectInventoryHistory = (input: ProjectInventoryHistoryInput): InventoryHistoryProjectionV1 => {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > INVENTORY_HISTORY_LIMITS.facts) {
    throw new Error(`Inventory history projection limit must be from 1 through ${INVENTORY_HISTORY_LIMITS.facts}.`)
  }
  const candidates: CandidateFact[] = [
    ...input.sources.shopCheckouts.flatMap(checkoutFacts),
    ...input.sources.inventoryActions.flatMap(record => {
      const fact = inventoryActionFact(record)
      return fact ? [fact] : []
    }),
    ...input.sources.equipmentOperations.map(equipmentFact),
    ...input.sources.itemOperations.flatMap(source => {
      const fact = itemOperationFact(input, source)
      return fact ? [fact] : []
    }),
    ...input.sources.guidedRequests.flatMap(record => {
      const fact = guidedRequestFact(record)
      return fact ? [fact] : []
    }),
    ...(input.settlementAwards ?? []).map(settlementAwardFact),
  ]
  const candidatesBySource = new Map<string, CandidateFact>()
  for (const value of candidates) {
    const existing = candidatesBySource.get(value.privateSortKey)
    if (existing && JSON.stringify(existing.fact) !== JSON.stringify(value.fact)) {
      throw new Error('Inventory history source identity produced conflicting structured facts.')
    }
    if (!existing) candidatesBySource.set(value.privateSortKey, value)
  }
  const uniqueCandidates = [...candidatesBySource.values()]
  uniqueCandidates.sort((left, right) => right.fact.occurredAt - left.fact.occurredAt
    || right.privateSortKey.localeCompare(left.privateSortKey))
  const facts = uniqueCandidates.slice(0, input.limit).map(value => value.fact)
  return parseInventoryHistoryProjection({
    schemaVersion: INVENTORY_HISTORY_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    scope: input.scope,
    facts,
    truncated: input.sources.sourceTruncated || uniqueCandidates.length > input.limit,
  })
}
