import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseSerializedEquipmentInventoryState } from '#shared/itemAutomation/equipment'
import { ITEM_INVENTORY_SECTIONS, type ItemInventorySection } from '#shared/itemAutomation/inventory'
import {
  parseEncounterSettlementDocument,
  type EncounterSettlementAllocation,
  type EncounterSettlementAllocationDestination,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementDocument,
} from '#shared/encounterSettlement/document'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import {
  inventoryTransferEntriesCanMerge,
  mergeInventoryEntryIntoSection,
  type InventoryTransferInventory,
} from '~/utils/groupInventoryTransfers'
import {
  INVENTORY_STACK_MAX_ROWS_PER_SECTION,
  parseInventoryStackEvidenceRow,
} from '../itemAutomation/inventoryStackOperations'
import type {
  EncounterSettlementRewardDestinationAuthority,
  EncounterSettlementRewardPermissionAuthority,
  EncounterSettlementRewardWriteAuthority,
} from './rewardPackage'

export const ENCOUNTER_SETTLEMENT_LOOT_REWARD_KINDS = ['money', 'item'] as const
export type EncounterSettlementLootRewardKind = typeof ENCOUNTER_SETTLEMENT_LOOT_REWARD_KINDS[number]

export interface EncounterSettlementMoneyLootDeclaration {
  readonly kind: 'money'
  readonly rewardId: string
  readonly destination: EncounterSettlementAllocationDestination
  readonly amount: number
  readonly permission: EncounterSettlementRewardPermissionAuthority
}

export interface EncounterSettlementItemLootDeclaration {
  readonly kind: 'item'
  readonly rewardId: string
  readonly destination: EncounterSettlementAllocationDestination
  readonly amount: number
  readonly section: ItemInventorySection
  /** Exact server-owned inventory template authorised by this reviewed definition. */
  readonly definitionAuthority: EncounterSettlementAuthorityRef
  readonly entry: InventoryEntry
  readonly permission: EncounterSettlementRewardPermissionAuthority
}

export type EncounterSettlementLootDeclaration =
  | EncounterSettlementMoneyLootDeclaration
  | EncounterSettlementItemLootDeclaration

export interface EncounterSettlementTrainerLootAuthority {
  readonly kind: 'trainer'
  readonly slug: string
  readonly revision: number
  readonly document: TrainerSheet
}

export interface EncounterSettlementGroupLootAuthority {
  readonly kind: 'group'
  readonly slug: string
  readonly revision: number
  readonly document: GroupInventoryDocument
}

export type EncounterSettlementLootContainerAuthority =
  | EncounterSettlementTrainerLootAuthority
  | EncounterSettlementGroupLootAuthority

export interface EncounterSettlementLootAuthoritySnapshot {
  readonly completeness: 'authoritative-current'
  readonly declarations: readonly EncounterSettlementLootDeclaration[]
  readonly containers: readonly EncounterSettlementLootContainerAuthority[]
}

export interface EncounterSettlementMoneyLootPreview {
  readonly kind: 'money'
  readonly rewardId: string
  readonly allocationId: string
  readonly destination: EncounterSettlementAllocationDestination
  readonly amount: number
  readonly balanceBefore: number
  readonly balanceAfter: number
}

export interface EncounterSettlementItemLootPreview {
  readonly kind: 'item'
  readonly rewardId: string
  readonly allocationId: string
  readonly destination: EncounterSettlementAllocationDestination
  readonly amount: number
  readonly section: ItemInventorySection
  readonly canonicalItemId: string
  readonly rowDisposition: 'merged' | 'created'
  readonly quantityBefore: number
  readonly quantityAfter: number
  readonly serialized: boolean
}

export type EncounterSettlementLootPreview =
  | EncounterSettlementMoneyLootPreview
  | EncounterSettlementItemLootPreview

export interface EncounterSettlementLootContainerWrite {
  readonly kind: 'trainer' | 'group'
  readonly slug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly beforeDefinitionSha256: string
  readonly afterDefinitionSha256: string
  readonly nextDocument: TrainerSheet | GroupInventoryDocument
}

export interface EncounterSettlementLootAllocationPlan {
  readonly complete: boolean
  readonly document: EncounterSettlementDocument
  readonly allocations: readonly EncounterSettlementAllocation[]
  readonly destinationAuthorities: readonly EncounterSettlementRewardDestinationAuthority[]
  readonly previews: readonly EncounterSettlementLootPreview[]
  readonly containerWrites: readonly EncounterSettlementLootContainerWrite[]
  readonly pendingRewardIds: readonly string[]
  readonly deniedRewardIds: readonly string[]
}

export type EncounterSettlementLootAllocationErrorCode =
  | 'incomplete-authority'
  | 'invalid-declaration'
  | 'duplicate-declaration'
  | 'invalid-destination'
  | 'missing-container'
  | 'stale-container'
  | 'invalid-container'
  | 'invalid-reward-entry'
  | 'invalid-serialized-equipment'
  | 'duplicate-serialized-equipment'
  | 'capacity-exceeded'
  | 'overflow'
  | 'foreign-loot-allocation'
  | 'terminal-loot-state'
  | 'stale-loot-plan'

export class EncounterSettlementLootAllocationError extends Error {
  constructor(
    readonly code: EncounterSettlementLootAllocationErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'EncounterSettlementLootAllocationError'
  }
}

const SECTION_SET = new Set<string>(ITEM_INVENTORY_SECTIONS)
const AUTHORITY_KIND_SET = new Set<EncounterSettlementAuthorityRef['kind']>([
  'encounter-document', 'map', 'sheet', 'group-inventory', 'campaign-clock',
  'capture-operation', 'item-operation', 'equipment-operation', 'inventory-operation',
  'objective', 'clock', 'phase', 'effect', 'resource',
])
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const ALLOCATION_PREFIX = 'settlement-loot-allocation:v1:'
const WRITE_PREFIX = 'settlement-loot-write:v1:'
const ROW_PREFIX = 'settlement-loot-row-v1-'
const MAX_INVENTORY_ROWS = ITEM_INVENTORY_SECTIONS.length * INVENTORY_STACK_MAX_ROWS_PER_SECTION

const fail = (
  code: EncounterSettlementLootAllocationErrorCode,
  path: string,
  message: string,
): never => {
  throw new EncounterSettlementLootAllocationError(code, path, message)
}

const isStableId = (value: unknown): value is string => (
  typeof value === 'string' && STABLE_ID.test(value)
)

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value, {
    path: 'lootContainer',
    limits: {
      maxDepth: 64,
      maxNodes: 250_000,
      maxObjectFields: 10_000,
      maxArrayEntries: 100_000,
      maxStringLength: 100_000,
    },
  }))
  .digest('hex')

const deterministicDigest = (prefix: string, ...parts: readonly string[]): string => {
  const hash = createHash('sha256').update(prefix)
  parts.forEach(part => hash.update('\u0000').update(part))
  return hash.digest('hex')
}

const allocationIdFor = (
  settlementId: string,
  rewardId: string,
  destination: EncounterSettlementAllocationDestination,
): string => `${ALLOCATION_PREFIX}${deterministicDigest(
  ALLOCATION_PREFIX,
  settlementId,
  rewardId,
  destination.kind,
  destination.id,
)}`

export const encounterSettlementSerializedRewardInstanceId = (
  settlementId: string,
  rewardId: string,
): string => `equipped-item:v1:${deterministicDigest('settlement-serialized-loot:v1:', settlementId, rewardId).slice(0, 32)}`

const rowIdFor = (
  settlementId: string,
  rewardId: string,
  destination: EncounterSettlementAllocationDestination,
): string => `${ROW_PREFIX}${deterministicDigest(
  ROW_PREFIX,
  settlementId,
  rewardId,
  destination.kind,
  destination.id,
).slice(0, 32)}`

const destinationIdentity = (
  destination: Pick<EncounterSettlementAllocationDestination, 'kind' | 'id'>,
): string => `${destination.kind}\u0000${destination.id}`

const declarationIdentity = (declaration: EncounterSettlementLootDeclaration): string => (
  `${declaration.rewardId}\u0000${destinationIdentity(declaration.destination)}`
)

const samePermission = (
  left: EncounterSettlementRewardPermissionAuthority,
  right: EncounterSettlementRewardPermissionAuthority,
): boolean => left.status === right.status
  && left.reasonId === right.reasonId
  && left.authority.kind === right.authority.kind
  && left.authority.id === right.authority.id
  && left.authority.revision === right.authority.revision

const parsePermission = (
  permission: EncounterSettlementRewardPermissionAuthority,
  path: string,
): EncounterSettlementRewardPermissionAuthority => {
  if (!permission || (permission.status !== 'allowed' && permission.status !== 'denied')
    || !permission.authority || !AUTHORITY_KIND_SET.has(permission.authority.kind)
    || !isStableId(permission.authority.id)
    || !Number.isSafeInteger(permission.authority.revision) || permission.authority.revision < 0
    || (permission.status === 'denied') !== (permission.reasonId !== null)
    || (permission.reasonId !== null && !isStableId(permission.reasonId))) {
    return fail('invalid-declaration', path, 'must contain one exact allowed or denied permission authority.')
  }
  return Object.freeze({
    status: permission.status,
    authority: Object.freeze({ ...permission.authority }),
    reasonId: permission.reasonId,
  })
}

const containerIdentity = (
  container: Pick<EncounterSettlementLootContainerAuthority, 'kind' | 'slug'>,
): string => `${container.kind}\u0000${container.slug}`

const containerForDestination = (
  destination: EncounterSettlementAllocationDestination,
): { readonly kind: 'trainer' | 'group', readonly slug: string } => {
  if (!destination || !isStableId(destination.id)
    || !Number.isSafeInteger(destination.revision) || destination.revision < 0) {
    return fail('invalid-destination', 'declaration.destination', 'must contain one exact current destination identity and revision.')
  }
  if (destination.kind === 'trainer-inventory') return { kind: 'trainer', slug: destination.id }
  if (destination.kind === 'group-inventory') return { kind: 'group', slug: destination.id }
  return fail('invalid-destination', 'declaration.destination', 'money and item loot must target one exact Trainer or group inventory.')
}

const sameAuthority = (
  left: EncounterSettlementAuthorityRef,
  right: EncounterSettlementAuthorityRef,
): boolean => left.kind === right.kind && left.id === right.id && left.revision === right.revision

const parseContainers = (
  values: readonly EncounterSettlementLootContainerAuthority[],
): ReadonlyMap<string, EncounterSettlementLootContainerAuthority> => {
  if (!Array.isArray(values) || values.length > 2_048) {
    return fail('incomplete-authority', 'authority.containers', 'must be one bounded complete loot-container read.')
  }
  const containers = new Map<string, EncounterSettlementLootContainerAuthority>()
  values.forEach((container, index) => {
    const path = `authority.containers[${index}]`
    if (!container || (container.kind !== 'trainer' && container.kind !== 'group')
      || !isStableId(container.slug) || !Number.isSafeInteger(container.revision)
      || container.revision < 0 || container.revision >= Number.MAX_SAFE_INTEGER
      || !container.document || container.document.slug !== container.slug
      || container.document.revision !== container.revision) {
      fail('invalid-container', path, 'must contain one exact current Trainer or group inventory document.')
    }
    const identity = containerIdentity(container)
    if (containers.has(identity)) fail('invalid-container', 'authority.containers', 'must not contain duplicate container identities.')
    containers.set(identity, Object.freeze({ ...container }))
  })
  return containers
}

const inventoryFor = (
  container: EncounterSettlementLootContainerAuthority,
): InventoryTransferInventory => container.kind === 'trainer'
  ? container.document.inventory ?? {}
  : container.document.inventory

const moneyFor = (container: EncounterSettlementLootContainerAuthority, path: string): number => {
  const money = container.document.money ?? 0
  if (!Number.isSafeInteger(money) || money < 0) {
    return fail('invalid-container', `${path}.money`, 'must be a safe non-negative balance.')
  }
  return money
}

const allRows = (inventory: InventoryTransferInventory): readonly InventoryEntry[] => (
  ITEM_INVENTORY_SECTIONS.flatMap(section => [...(inventory[section] ?? [])])
)

const assertUniqueRowsAndEquipment = (
  inventory: InventoryTransferInventory,
  path: string,
): void => {
  const rows = allRows(inventory)
  const rowIds = rows.flatMap(row => row.id?.trim() ? [row.id.trim()] : [])
  if (new Set(rowIds).size !== rowIds.length) {
    fail('invalid-container', path, 'contains duplicate inventory row identities.')
  }
  const instanceIds = rows.flatMap(row => row.serializedEquipment?.instanceId
    ? [row.serializedEquipment.instanceId]
    : [])
  if (new Set(instanceIds).size !== instanceIds.length) {
    fail('duplicate-serialized-equipment', path, 'contains duplicate whole-item identities.')
  }
}

const replaceContainerInventory = (
  container: EncounterSettlementLootContainerAuthority,
  inventory: InventoryTransferInventory,
): EncounterSettlementLootContainerAuthority => {
  if (container.kind === 'trainer') {
    return Object.freeze({
      ...container,
      document: { ...container.document, inventory: inventory as TrainerSheet['inventory'] },
    })
  }
  return Object.freeze({
    ...container,
    document: { ...container.document, inventory: inventory as GroupInventoryDocument['inventory'] },
  })
}

const replaceContainerMoney = (
  container: EncounterSettlementLootContainerAuthority,
  money: number,
): EncounterSettlementLootContainerAuthority => container.kind === 'trainer'
  ? Object.freeze({ ...container, document: { ...container.document, money } })
  : Object.freeze({ ...container, document: { ...container.document, money } })

const validateItemEntry = (input: {
  readonly settlementId: string
  readonly declaration: EncounterSettlementItemLootDeclaration
  readonly canonicalItemId: string
  readonly serialized: boolean
  readonly path: string
}): InventoryEntry => {
  if (!SECTION_SET.has(input.declaration.section) || input.declaration.entry.name !== input.canonicalItemId) {
    return fail('invalid-reward-entry', input.path, 'must use the exact canonical item identity and one supported inventory section.')
  }
  const rowId = rowIdFor(input.settlementId, input.declaration.rewardId, input.declaration.destination)
  const value: InventoryEntry = {
    ...input.declaration.entry,
    id: rowId,
    ...(input.serialized ? {} : { qty: input.declaration.amount }),
  }
  let parsed: InventoryEntry
  try {
    parsed = parseInventoryStackEvidenceRow(value, input.declaration.section, `${input.path}.entry`)
  }
  catch (error) {
    return fail('invalid-reward-entry', `${input.path}.entry`, error instanceof Error ? error.message : 'is malformed.')
  }
  if (input.serialized) {
    if (input.declaration.section !== 'equipment' || parsed.serializedEquipment === undefined || parsed.qty !== undefined) {
      return fail('invalid-serialized-equipment', input.path, 'serialized equipment must be one whole equipment-section row.')
    }
    let serialized: ReturnType<typeof parseSerializedEquipmentInventoryState>
    try { serialized = parseSerializedEquipmentInventoryState(parsed.serializedEquipment) }
    catch (error) {
      return fail('invalid-serialized-equipment', input.path, error instanceof Error ? error.message : 'is malformed.')
    }
    const expectedInstanceId = encounterSettlementSerializedRewardInstanceId(input.settlementId, input.declaration.rewardId)
    if (serialized.instanceId !== expectedInstanceId || serialized.revision !== 0
      || serialized.canonicalItemId !== input.canonicalItemId
      || serialized.equipmentDefinitionSha256 === null) {
      return fail('invalid-serialized-equipment', input.path, 'must retain the deterministic new whole-item identity, revision zero, and reviewed definitions.')
    }
  }
  else if (input.declaration.section === 'equipment' || parsed.serializedEquipment !== undefined) {
    return fail('invalid-reward-entry', input.path, 'stack rewards cannot enter whole-item equipment custody.')
  }
  return parsed
}

const quantityOf = (row: InventoryEntry): number => {
  const quantity = row.qty ?? 1
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0
}

export const planEncounterSettlementLootAllocation = (input: {
  readonly settlement: unknown
  readonly authority: EncounterSettlementLootAuthoritySnapshot
}): EncounterSettlementLootAllocationPlan => {
  const settlement = parseEncounterSettlementDocument(input.settlement)
  const lootLines = settlement.rewardPackage.lines.filter(line => (
    line.payload.kind === 'money' || line.payload.kind === 'item'
  ))
  const lootRewardIds = new Set(lootLines.map(line => line.rewardId))
  if (settlement.status === 'committing' || settlement.status === 'completed' || settlement.status === 'cancelled'
    || settlement.rewardPackage.status === 'committed' || settlement.rewardPackage.status === 'cancelled'
    || lootLines.some(line => line.disposition === 'committed')
    || settlement.allocations.some(allocation => lootRewardIds.has(allocation.rewardId)
      && (allocation.state === 'applied' || allocation.receiptId !== null))) {
    return fail('terminal-loot-state', 'settlement', 'cannot re-plan money or item loot after commit has begun.')
  }
  if (!input.authority || input.authority.completeness !== 'authoritative-current'
    || !Array.isArray(input.authority.declarations)) {
    return fail('incomplete-authority', 'authority', 'must contain one complete current loot authority read.')
  }
  const containers = parseContainers(input.authority.containers)
  const linesById = new Map(lootLines.map(line => [line.rewardId, line] as const))
  const declarationIds = new Set<string>()
  const declarationsByReward = new Map<string, EncounterSettlementLootDeclaration[]>()
  input.authority.declarations.forEach((declaration, index) => {
    const path = `authority.declarations[${index}]`
    if (!declaration || (declaration.kind !== 'money' && declaration.kind !== 'item')
      || !isStableId(declaration.rewardId) || !linesById.has(declaration.rewardId)
      || linesById.get(declaration.rewardId)!.payload.kind !== declaration.kind
      || !Number.isSafeInteger(declaration.amount) || declaration.amount < 1) {
      fail('invalid-declaration', path, 'must name one current matching money or item reward and positive amount.')
    }
    if (linesById.get(declaration.rewardId)!.disposition === 'excluded') {
      fail('invalid-declaration', path, 'cannot allocate an explicitly excluded loot reward.')
    }
    if (declaration.kind === 'item') {
      const payload = linesById.get(declaration.rewardId)!.payload
      const definition = declaration.definitionAuthority
      if (payload.kind !== 'item' || !definition || !AUTHORITY_KIND_SET.has(definition.kind)
        || !isStableId(definition.id) || !Number.isSafeInteger(definition.revision)
        || definition.revision < 0 || !sameAuthority(definition, payload.definitionAuthority)) {
        fail('invalid-declaration', `${path}.definitionAuthority`, 'must match the reward package exact reviewed item definition authority.')
      }
    }
    const identity = declarationIdentity(declaration)
    if (declarationIds.has(identity)) {
      fail('duplicate-declaration', path, 'cannot declare the same reward and destination more than once.')
    }
    declarationIds.add(identity)
    parsePermission(declaration.permission, `${path}.permission`)
    containerForDestination(declaration.destination)
    const list = declarationsByReward.get(declaration.rewardId) ?? []
    list.push(declaration)
    declarationsByReward.set(declaration.rewardId, list)
  })

  for (const allocation of settlement.allocations.filter(allocation => lootRewardIds.has(allocation.rewardId))) {
    if (!allocation.allocationId.startsWith(ALLOCATION_PREFIX)) {
      fail('foreign-loot-allocation', allocation.allocationId, 'cannot replace a money or item allocation not owned by this provider.')
    }
  }

  const requiredContainers = new Set(input.authority.declarations.map(declaration => {
    const target = containerForDestination(declaration.destination)
    return containerIdentity(target)
  }))
  for (const identity of containers.keys()) {
    if (!requiredContainers.has(identity)) {
      fail('invalid-container', 'authority.containers', 'cannot include an undeclared loot destination container.')
    }
  }

  const pendingRewardIds: string[] = []
  const deniedRewardIds: string[] = []
  for (const line of lootLines) {
    if (line.disposition === 'excluded') continue
    const declarations = declarationsByReward.get(line.rewardId) ?? []
    const lootPayload = line.payload.kind === 'money' || line.payload.kind === 'item'
      ? line.payload
      : fail('invalid-declaration', line.rewardId, 'loot planning received a non-loot reward payload.')
    const expected = lootPayload.kind === 'money' ? lootPayload.amount : lootPayload.quantity
    const total = declarations.reduce((sum, declaration) => sum + declaration.amount, 0)
    const validTotal = Number.isSafeInteger(total) && total === expected
    const validSerialized = lootPayload.kind !== 'item' || !lootPayload.serialized
      || (declarations.length === 1 && declarations[0]!.amount === 1)
    if (!validTotal || !validSerialized || declarations.length === 0) pendingRewardIds.push(line.rewardId)
    if (declarations.some(declaration => declaration.permission.status === 'denied')) deniedRewardIds.push(line.rewardId)
  }

  const currentContainers = new Map<string, EncounterSettlementLootContainerAuthority>()
  for (const [identity, container] of containers) {
    const cloned = Object.freeze({ ...container, document: deepCloneJson(container.document) }) as EncounterSettlementLootContainerAuthority
    assertUniqueRowsAndEquipment(inventoryFor(cloned), `authority.containers.${container.slug}.inventory`)
    currentContainers.set(identity, cloned)
  }

  const generatedAllocations: EncounterSettlementAllocation[] = []
  const previews: EncounterSettlementLootPreview[] = []
  const writesByDestination = new Map<string, EncounterSettlementRewardWriteAuthority[]>()
  const permissionByDestination = new Map<string, EncounterSettlementRewardPermissionAuthority>()
  const declarations = [...input.authority.declarations].sort((left, right) => (
    allocationIdFor(settlement.settlementId, left.rewardId, left.destination)
      .localeCompare(allocationIdFor(settlement.settlementId, right.rewardId, right.destination))
  ))

  for (const declaration of declarations) {
    const line = linesById.get(declaration.rewardId)!
    const path = `authority.declarations.${declaration.rewardId}`
    const target = containerForDestination(declaration.destination)
    const identity = containerIdentity(target)
    const original = containers.get(identity)
      ?? fail('missing-container', path, 'the declared loot destination container is unavailable.')
    if (declaration.destination.revision !== original.revision) {
      fail('stale-container', `${path}.destination.revision`, 'does not match the exact current loot container revision.')
    }
    const permission = parsePermission(declaration.permission, `${path}.permission`)
    const existingPermission = permissionByDestination.get(identity)
    if (existingPermission && !samePermission(existingPermission, permission)) {
      fail('invalid-declaration', `${path}.permission`, 'declarations sharing one destination require the same exact permission authority.')
    }
    permissionByDestination.set(identity, permission)
    const allocationId = allocationIdFor(settlement.settlementId, declaration.rewardId, declaration.destination)
    generatedAllocations.push(Object.freeze({
      allocationId,
      rewardId: declaration.rewardId,
      destination: declaration.destination,
      method: line.payload.kind === 'item' && line.payload.serialized ? 'whole' : 'fixed',
      amount: declaration.amount,
      weight: null,
      state: 'proposed',
      decisionId: null,
      receiptId: null,
    }))
    if (permission.status === 'denied') continue

    let current = currentContainers.get(identity)!
    const writes = writesByDestination.get(identity) ?? []
    if (declaration.kind === 'money') {
      const before = moneyFor(current, path)
      const after = before + declaration.amount
      if (!Number.isSafeInteger(after)) fail('overflow', path, 'money reward exceeds safe integer balance authority.')
      current = replaceContainerMoney(current, after)
      previews.push(Object.freeze({
        kind: 'money',
        rewardId: declaration.rewardId,
        allocationId,
        destination: declaration.destination,
        amount: declaration.amount,
        balanceBefore: before,
        balanceAfter: after,
      }))
      writes.push(Object.freeze({
        sourceWriteId: `${WRITE_PREFIX}${deterministicDigest(WRITE_PREFIX, settlement.settlementId, allocationId, 'money')}`,
        allocationId,
        targetAuthority: Object.freeze({
          kind: target.kind === 'trainer' ? 'sheet' as const : 'group-inventory' as const,
          id: target.slug,
          revision: original.revision,
        }),
        field: 'money',
        amount: declaration.amount,
        countsTowardAllocation: true,
        capacityCost: 0,
      }))
    }
    else {
      const itemDeclaration: EncounterSettlementItemLootDeclaration = declaration
      const payload = line.payload.kind === 'item'
        ? line.payload
        : fail('invalid-declaration', path, 'item declaration lost its exact item reward.')
      const entry = validateItemEntry({
        settlementId: settlement.settlementId,
        declaration: itemDeclaration,
        canonicalItemId: payload.canonicalItemId,
        serialized: payload.serialized,
        path,
      })
      const inventory = inventoryFor(current)
      const beforeRows = [...(inventory[itemDeclaration.section] ?? [])]
      const mergeTarget = payload.serialized ? null : beforeRows.find(row => (
        inventoryTransferEntriesCanMerge(itemDeclaration.section, row, entry)
      )) ?? null
      const quantityBefore = mergeTarget ? quantityOf(mergeTarget) : 0
      const generatedRowId = entry.id!
      const allCurrentRows = allRows(inventory)
      if (!mergeTarget && allCurrentRows.some(row => row.id === generatedRowId)) {
        fail('invalid-container', path, 'deterministic reward row identity is already occupied by another item.')
      }
      if (payload.serialized) {
        const instanceId = entry.serializedEquipment!.instanceId
        if (allCurrentRows.some(row => row.serializedEquipment?.instanceId === instanceId)) {
          fail('duplicate-serialized-equipment', path, 'deterministic whole-item identity already exists at the destination.')
        }
      }
      let nextRows: readonly InventoryEntry[] = []
      try {
        nextRows = mergeInventoryEntryIntoSection({
          section: itemDeclaration.section,
          rows: beforeRows,
          entry,
          quantity: declaration.amount,
          createTargetRowId: () => generatedRowId,
        })
      }
      catch (error) {
        fail('invalid-reward-entry', path, error instanceof Error ? error.message : 'cannot merge into destination inventory.')
      }
      if (nextRows.length > INVENTORY_STACK_MAX_ROWS_PER_SECTION) {
        fail('capacity-exceeded', path, `inventory sections support at most ${INVENTORY_STACK_MAX_ROWS_PER_SECTION} rows.`)
      }
      const nextInventory = { ...inventory, [itemDeclaration.section]: nextRows }
      assertUniqueRowsAndEquipment(nextInventory, `${path}.nextInventory`)
      current = replaceContainerInventory(current, nextInventory)
      const resultingRow = mergeTarget
        ? nextRows.find(row => row.id === mergeTarget.id)!
        : nextRows.find(row => row.id === generatedRowId)!
      previews.push(Object.freeze({
        kind: 'item',
        rewardId: declaration.rewardId,
        allocationId,
        destination: itemDeclaration.destination,
        amount: itemDeclaration.amount,
        section: itemDeclaration.section,
        canonicalItemId: payload.canonicalItemId,
        rowDisposition: mergeTarget ? 'merged' : 'created',
        quantityBefore,
        quantityAfter: payload.serialized ? 1 : quantityOf(resultingRow),
        serialized: payload.serialized,
      }))
      writes.push(Object.freeze({
        sourceWriteId: `${WRITE_PREFIX}${deterministicDigest(WRITE_PREFIX, settlement.settlementId, allocationId, 'item')}`,
        allocationId,
        targetAuthority: Object.freeze({
          kind: target.kind === 'trainer' ? 'sheet' as const : 'group-inventory' as const,
          id: target.slug,
          revision: original.revision,
        }),
        field: payload.serialized ? 'serialized-equipment' : 'inventory-stack',
        amount: declaration.amount,
        countsTowardAllocation: true,
        capacityCost: mergeTarget ? 0 : 1,
      }))
    }
    writesByDestination.set(identity, writes)
    currentContainers.set(identity, current)
  }

  const destinationAuthorities: EncounterSettlementRewardDestinationAuthority[] = []
  for (const [identity, permission] of permissionByDestination) {
    const original = containers.get(identity)!
    const inventory = inventoryFor(original)
    const used = allRows(inventory).length
    destinationAuthorities.push(Object.freeze({
      destination: declarations.find(declaration => {
        const target = containerForDestination(declaration.destination)
        return containerIdentity(target) === identity
      })!.destination,
      permission,
      capacity: Object.freeze({ metric: 'slots', limit: MAX_INVENTORY_ROWS, used }),
      writes: Object.freeze(writesByDestination.get(identity) ?? []),
    }))
  }

  const containerWrites: EncounterSettlementLootContainerWrite[] = []
  for (const [identity, next] of currentContainers) {
    const previous = containers.get(identity)!
    if (sha256(previous.document) === sha256(next.document)) continue
    const nextDocument = { ...next.document, revision: previous.revision + 1 } as TrainerSheet | GroupInventoryDocument
    containerWrites.push(Object.freeze({
      kind: previous.kind,
      slug: previous.slug,
      expectedRevision: previous.revision,
      revision: previous.revision + 1,
      beforeDefinitionSha256: sha256(previous.document),
      afterDefinitionSha256: sha256(nextDocument),
      nextDocument,
    }))
  }

  const otherAllocations = settlement.allocations.filter(allocation => !lootRewardIds.has(allocation.rewardId))
  const document = parseEncounterSettlementDocument({
    ...settlement,
    allocations: [...otherAllocations, ...generatedAllocations].sort((left, right) => left.allocationId.localeCompare(right.allocationId)),
  })
  const pending = Object.freeze([...new Set(pendingRewardIds)].sort())
  const denied = Object.freeze([...new Set(deniedRewardIds)].sort())
  previews.sort((left, right) => left.allocationId.localeCompare(right.allocationId))
  containerWrites.sort((left, right) => `${left.kind}:${left.slug}`.localeCompare(`${right.kind}:${right.slug}`))
  destinationAuthorities.sort((left, right) => (
    `${left.destination.kind}:${left.destination.id}`.localeCompare(`${right.destination.kind}:${right.destination.id}`)
  ))
  return Object.freeze({
    complete: pending.length === 0 && denied.length === 0,
    document,
    allocations: Object.freeze(document.allocations.filter(allocation => lootRewardIds.has(allocation.rewardId))),
    destinationAuthorities: Object.freeze(destinationAuthorities),
    previews: Object.freeze(previews),
    containerWrites: Object.freeze(containerWrites),
    pendingRewardIds: pending,
    deniedRewardIds: denied,
  })
}

export const applyEncounterSettlementLootAllocationPlan = (input: {
  readonly plan: EncounterSettlementLootAllocationPlan
  readonly currentContainers: readonly EncounterSettlementLootContainerAuthority[]
}): readonly EncounterSettlementLootContainerWrite[] => {
  if (!input.plan.complete) {
    return fail('stale-loot-plan', 'plan.complete', 'all money and item rewards must be allocated or explicitly excluded before application.')
  }
  const current = parseContainers(input.currentContainers)
  for (const write of input.plan.containerWrites) {
    const authority = current.get(`${write.kind}\u0000${write.slug}`)
    if (!authority || authority.revision !== write.expectedRevision
      || sha256(authority.document) !== write.beforeDefinitionSha256
      || sha256(write.nextDocument) !== write.afterDefinitionSha256
      || write.revision !== write.expectedRevision + 1) {
      fail('stale-loot-plan', `${write.kind}:${write.slug}`, 'current loot authority no longer matches the complete allocation preview.')
    }
  }
  return input.plan.containerWrites
}
