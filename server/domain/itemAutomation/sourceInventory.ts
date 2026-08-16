import type { PlayerProfile } from '#shared/playerProfiles'
import type { AuthRole } from '#shared/auth'
import { parseSerializedEquipmentInventoryState } from '#shared/itemAutomation/equipment'
import type { ItemInventorySection, AuthoritativeItemInventoryInstance } from '#shared/itemAutomation/inventory'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import { parseItemExplorationState } from '#shared/itemAutomation/exploration'
import type { ItemInventorySourceRef } from '#shared/itemAutomation/operations'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from './registry'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'

export class ItemSourceInventoryError extends Error {
  readonly code: 'not-authorized' | 'stale' | 'missing' | 'ambiguous' | 'unsupported' | 'insufficient'

  constructor(code: ItemSourceInventoryError['code'], message: string) {
    super(message)
    this.name = 'ItemSourceInventoryError'
    this.code = code
  }
}

export interface ResolveItemSourceInventoryInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly source: ItemInventorySourceRef
  readonly sourceInstanceId: string
  readonly trainerSheet?: TrainerSheet | null
  readonly groupInventory?: GroupInventoryDocument | null
  /** Server-only evidence that current shared-custody actor delegation was reauthorized. */
  readonly groupInventoryUseAuthorized?: boolean
  readonly requiredQuantity?: number
  readonly reservedQuantity?: number
}

export interface ResolvedItemSourceInventory {
  readonly instance: AuthoritativeItemInventoryInstance
  readonly entry: InventoryEntry
  readonly definition: ReturnType<typeof ITEM_AUTOMATION_RUNTIME_REGISTRY.require>
}

const quantity = (entry: InventoryEntry, section: ItemInventorySection): number => {
  if (entry.serializedEquipment !== undefined) {
    parseSerializedEquipmentInventoryState(entry.serializedEquipment)
    return 1
  }
  if (section === 'equipment') return 1
  const value = entry.qty ?? 1
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

const assertAuthorized = (input: ResolveItemSourceInventoryInput): void => {
  if (input.role === 'gm') return
  if (input.source.kind === 'group') {
    if (input.groupInventoryUseAuthorized === true) return
    throw new ItemSourceInventoryError('not-authorized', 'Players cannot use shared inventory without an explicit delegated-use policy with current authority.')
  }
  if (!playerProfileCanControlTokenSheet(input.playerProfile, 'trainer', input.source.slug, {
    linkedTrainerSheets: input.trainerSheet ? [input.trainerSheet] : [],
  })) {
    throw new ItemSourceInventoryError('not-authorized', 'The selected player profile does not control this source inventory.')
  }
}

/** Resolve one exact stable inventory row and derive canonical identity solely from server-owned row data. */
export const resolveAuthoritativeItemSourceInventory = (
  input: ResolveItemSourceInventoryInput,
): ResolvedItemSourceInventory => {
  assertAuthorized(input)
  const container = input.source.kind === 'trainer' ? input.trainerSheet : input.groupInventory
  if (!container) throw new ItemSourceInventoryError('missing', `Item source ${input.source.kind}/${input.source.slug} was not found.`)
  const revision = Number(container.revision ?? 0)
  if (!Number.isSafeInteger(revision) || revision < 0 || revision !== input.source.expectedRevision) {
    throw new ItemSourceInventoryError('stale', 'The item source inventory changed. Refresh before retrying.')
  }
  if (container.slug !== input.source.slug) throw new ItemSourceInventoryError('missing', 'The item source container identity is inconsistent.')
  const rows = input.source.kind === 'trainer'
    ? (input.trainerSheet?.inventory?.[input.source.section] ?? [])
    : (input.groupInventory?.inventory[input.source.section] ?? [])
  const matches = rows.filter(row => row.id === input.source.rowId)
  if (matches.length > 1) throw new ItemSourceInventoryError('ambiguous', 'The item source row identity is duplicated.')
  const entry = matches[0]
  if (!entry) throw new ItemSourceInventoryError('missing', 'The item source row moved or no longer exists.')
  const expectedInstanceId = itemInventoryInstanceId({
    containerKind: input.source.kind,
    containerSlug: input.source.slug,
    section: input.source.section,
    rowId: input.source.rowId,
  })
  if (input.sourceInstanceId !== expectedInstanceId) throw new ItemSourceInventoryError('ambiguous', 'The item source identity does not match the authoritative row.')
  let serialized: ReturnType<typeof parseSerializedEquipmentInventoryState> | null = null
  try {
    serialized = entry.serializedEquipment === undefined
      ? null
      : parseSerializedEquipmentInventoryState(entry.serializedEquipment)
  }
  catch {
    throw new ItemSourceInventoryError('unsupported', 'This serialized item row is malformed.')
  }
  const resolvedQuantity = quantity(entry, input.source.section)
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(serialized?.canonicalItemId ?? entry.name)
  if (!definition
    || (serialized && (definition.canonicalId !== serialized.canonicalItemId
      || definition.spec.evidence.canonicalRecordSha256 !== serialized.canonicalRecordSha256))) {
    throw new ItemSourceInventoryError('unsupported', 'This inventory row has no reviewed executable item definition.')
  }
  if (input.source.kind === 'trainer') {
    let activityLocked = false
    try {
      activityLocked = parseItemExplorationState(input.trainerSheet?.serverPrivate?.itemExploration)
        .routeLures.some(activity => activity.reusable
          && (activity.status === 'active' || activity.status === 'awaiting-encounter')
          && activity.sourceInstanceId === expectedInstanceId)
    }
    catch {
      throw new ItemSourceInventoryError('unsupported', 'Exploration activity authority is malformed.')
    }
    if (activityLocked) {
      throw new ItemSourceInventoryError('insufficient', 'This Fishing Lure is locked by an unresolved route activity.')
    }
  }
  const required = input.requiredQuantity ?? Math.max(1, definition.spec.consumption.quantity)
  const reserved = input.reservedQuantity ?? 0
  if (!Number.isSafeInteger(required) || required < 1 || !Number.isSafeInteger(reserved) || reserved < 0
    || resolvedQuantity - reserved < required) {
    throw new ItemSourceInventoryError('insufficient', 'The item source does not have enough unreserved quantity.')
  }
  return Object.freeze({
    entry: Object.freeze({ ...entry }),
    definition,
    instance: Object.freeze({
      containerKind: input.source.kind,
      containerSlug: input.source.slug,
      section: input.source.section,
      rowId: input.source.rowId,
      instanceId: expectedInstanceId,
      canonicalItemId: definition.canonicalId,
      displayLabel: entry.name,
      quantity: resolvedQuantity,
      revision,
      ownerSheet: input.source.kind === 'trainer' ? { kind: 'trainer' as const, slug: input.source.slug } : null,
    }),
  })
}

export const consumeAuthoritativeItemSourceRow = (input: {
  readonly source: ItemInventorySourceRef
  readonly quantity: number
  readonly trainerSheet?: TrainerSheet | null
  readonly groupInventory?: GroupInventoryDocument | null
}): { readonly trainerSheet?: TrainerSheet; readonly groupInventory?: GroupInventoryDocument } => {
  const container = structuredClone(input.source.kind === 'trainer' ? input.trainerSheet : input.groupInventory)
  if (!container) throw new ItemSourceInventoryError('missing', 'The item source container no longer exists.')
  const inventory = container.inventory
  const rows = input.source.kind === 'trainer'
    ? [...((inventory as TrainerSheet['inventory'])?.[input.source.section] ?? [])]
    : [...(inventory as GroupInventoryDocument['inventory'])[input.source.section]]
  const index = rows.findIndex(row => row.id === input.source.rowId)
  if (index < 0 || rows.some((row, candidate) => candidate !== index && row.id === input.source.rowId)) {
    throw new ItemSourceInventoryError(index < 0 ? 'missing' : 'ambiguous', 'The item source row cannot be consumed safely.')
  }
  const entry = { ...rows[index]! }
  const before = quantity(entry, input.source.section)
  if (before < input.quantity) throw new ItemSourceInventoryError('insufficient', 'The item source quantity changed before commit.')
  if (entry.serializedEquipment !== undefined || input.source.section === 'equipment' || before === input.quantity) rows.splice(index, 1)
  else {
    entry.qty = before - input.quantity
    rows[index] = entry
  }
  container.inventory = { ...(inventory ?? {}), [input.source.section]: rows } as never
  return input.source.kind === 'trainer'
    ? { trainerSheet: container as TrainerSheet }
    : { groupInventory: container as GroupInventoryDocument }
}
