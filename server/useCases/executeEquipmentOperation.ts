import { createHash } from 'node:crypto'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import {
  EQUIPMENT_CONFIGURATION_SCHEMA_VERSION,
  parseSerializedEquipmentInventoryState,
  parseSheetEquipmentStateForOwner,
  serializedEquipmentInventoryStateFromInstance,
  type EquippedItemInstanceV1,
  type EquipmentActivityReasonV1,
  type EquipmentActivityStatus,
  type EquipmentItemConfigurationV1,
  type EquipmentOwnerKind,
  type SheetEquipmentStateV1,
} from '#shared/itemAutomation/equipment'
import {
  EQUIPMENT_OPERATION_SCHEMA_VERSION,
  parseEquipmentOperationCommand,
  parseEquipmentOperationResult,
  type EquipmentActivityOperationCommandV1,
  type EquipmentCustodyOperationCommandV1,
  type EquipmentDurabilityOperationCommandV1,
  type EquipmentOperationCommandV1,
  type EquipmentOperationInventoryDestinationV1,
  type EquipmentOperationInventorySourceV1,
  type EquipmentOperationResourceRevisionV1,
  type EquipmentOperationResultV1,
} from '#shared/itemAutomation/equipmentOperations'
import type { ItemInventorySection, ItemSourceContainerKind } from '#shared/itemAutomation/inventory'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TabletopMap } from '~/types/map'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import {
  equipmentCanonicalItemIdForName,
  equipmentConfigurationDefinitionSha256,
  equipmentDefinitionFor,
  equipmentDefinitionSha256,
} from '../domain/itemAutomation/equipmentDefinitionRegistry'
import { evaluateEquipmentCompatibility, type EquipmentCompatibilityOwner } from '../domain/itemAutomation/equipmentCompatibility'
import { equipmentEventProviderDefinitionFor } from '../domain/itemAutomation/equipmentEventProviderRegistry'
import {
  initializeEquipmentDurabilityState,
  parseEquipmentDurabilityState,
  updateEquipmentDurabilityState,
} from '../domain/itemAutomation/equipmentDurability'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteItemOperationRepository, type ItemOperationRepository } from '../storage/itemOperationRepository'
import {
  createSqliteEquipmentOperationRepository,
  equipmentOperationCommandSha256,
  type EquipmentOperationEvidenceV1,
  type EquipmentOperationRepository,
  type EquipmentOperationResourceEvidenceV1,
  type StoredEquipmentOperationRecord,
} from '../storage/equipmentOperationRepository'
import {
  createSqliteGroupInventoryRepository,
  type GroupInventoryRepository,
} from '../storage/groupInventoryRepository'
import {
  createSqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import {
  createSqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import { groupInventoryUpdatedRealtimeAppendInputs } from '../realtime/groupInventoryRealtime'
import { itemOperationSheetUpdatedRealtimeAppendInputs } from '../realtime/itemOperationRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'

export class ExecuteEquipmentOperationUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

type EquipmentSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
type EquipmentGroupRepository = Pick<GroupInventoryRepository, 'get' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
type EquipmentRealtimeRepository = Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }
type EquipmentMapRepository = Pick<MapRepository<TabletopMap>, 'list'> & { readonly database?: RotomDatabase }

export interface ExecuteEquipmentOperationDependencies {
  readonly database?: RotomDatabase
  readonly sheetRepository?: EquipmentSheetRepository
  readonly groupInventoryRepository?: EquipmentGroupRepository
  readonly operationRepository?: EquipmentOperationRepository
  readonly itemOperationRepository?: Pick<ItemOperationRepository, 'reservedQuantity'> & { readonly database?: RotomDatabase }
  readonly realtimeEventRepository?: EquipmentRealtimeRepository
  readonly mapRepository?: EquipmentMapRepository
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly now?: () => number
}

export interface ExecuteEquipmentOperationInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: unknown
  readonly clientId?: unknown
}

export interface ExecuteEquipmentOperationResult {
  readonly result: EquipmentOperationResultV1
  readonly sheets: readonly PersistedSheet[]
  readonly groupInventories: readonly GroupInventoryDocument[]
}

interface MutableSheetResource {
  readonly key: string
  readonly kind: EquipmentOwnerKind
  readonly slug: string
  readonly expectedRevision: number
  readonly before: PersistedSheet
  document: Record<string, unknown>
  dirty: boolean
}

interface MutableGroupResource {
  readonly key: string
  readonly kind: 'group-inventory'
  readonly slug: string
  readonly expectedRevision: number
  readonly before: GroupInventoryDocument
  document: GroupInventoryDocument
  dirty: boolean
}

type MutableResource = MutableSheetResource | MutableGroupResource
interface ResourceExpectation {
  readonly kind: 'sheet' | 'group-inventory'
  readonly sheetKind: EquipmentOwnerKind | null
  readonly slug: string
  readonly revision: number
}

const fail = (status: 400 | 403 | 404 | 409, message: string): never => {
  throw new ExecuteEquipmentOperationUseCaseError(status, message)
}
const resourceKey = (kind: 'sheet' | 'group-inventory', sheetKind: EquipmentOwnerKind | null, slug: string): string =>
  `${kind}:${sheetKind ?? ''}:${slug}`
const nextRevision = (revision: number, label: string): number => {
  if (!Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER) fail(409, `${label} cannot advance within the safe integer range.`)
  return revision + 1
}
const digest32 = (...parts: readonly string[]): string => createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 32)
const ACTIVITY_OPERATION_KINDS = new Set(['suppress', 'deactivate', 'break', 'restore', 'repair'])
const DURABILITY_OPERATION_KINDS = new Set(['damage', 'restore-durability'])
const isActivityOperation = (
  command: EquipmentOperationCommandV1,
): command is EquipmentActivityOperationCommandV1 => ACTIVITY_OPERATION_KINDS.has(command.commandKind)
const isDurabilityOperation = (
  command: EquipmentOperationCommandV1,
): command is EquipmentDurabilityOperationCommandV1 => DURABILITY_OPERATION_KINDS.has(command.commandKind)
const isLifecycleOperation = (
  command: EquipmentOperationCommandV1,
): command is EquipmentActivityOperationCommandV1 | EquipmentDurabilityOperationCommandV1 =>
  isActivityOperation(command) || isDurabilityOperation(command)

const databaseFrom = (dependencies: ExecuteEquipmentOperationDependencies): RotomDatabase => {
  const candidates = [
    dependencies.sheetRepository?.database,
    dependencies.groupInventoryRepository?.database,
    dependencies.operationRepository?.database,
    dependencies.itemOperationRepository?.database,
    dependencies.realtimeEventRepository?.database,
    dependencies.mapRepository?.database,
  ].filter((entry): entry is RotomDatabase => Boolean(entry))
  const database = dependencies.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) throw new Error('Equipment operation repositories must share one RotomDatabase.')
  return database
}

const assertEquipmentInstanceNotBackingActiveItemForm = (input: {
  readonly maps: EquipmentMapRepository
  readonly ownerKind: EquipmentOwnerKind
  readonly ownerSlug: string
  readonly instanceId: string
}): void => {
  for (const stored of input.maps.list()) {
    const map = stored.document
    if (!map.activeScene) continue
    let entries: ReturnType<typeof parseEncounterState>['itemFormChanges'] = undefined
    try { entries = parseEncounterState(map.encounterState).itemFormChanges }
    catch { fail(409, 'Encounter item form-change state is malformed; equipment custody is locked.') }
    const itemFormLocked = (entries?.entries ?? []).some(entry => (
      entry.duration.kind === 'scene'
      && entry.duration.sceneStartedAt === map.activeScene?.startedAt
      && ((input.ownerKind === 'trainer'
        && entry.trainerSheetSlug === input.ownerSlug
        && entry.ringInstanceId === input.instanceId)
        || (input.ownerKind === 'pokemon'
          && entry.pokemonSheetSlug === input.ownerSlug
          && entry.stoneInstanceId === input.instanceId))
    ))
    const deltaRingLocked = input.ownerKind === 'trainer'
      && Array.isArray(map.metadata?.capabilityMegaEvolutionUses)
      && map.metadata.capabilityMegaEvolutionUses.some((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
        const use = raw as Record<string, unknown>
        return use.trainerSlug === input.ownerSlug
          && use.sceneStartedAt === map.activeScene?.startedAt
          && use.ringInstanceId === input.instanceId
      })
    if (itemFormLocked || deltaRingLocked) fail(409, 'Equipment backing an active Mega Evolution cannot be removed or reconfigured until the Scene ends.')
  }
}

const expectationsFor = (command: EquipmentOperationCommandV1): readonly ResourceExpectation[] => {
  const entries: ResourceExpectation[] = []
  const inventory = (ref: EquipmentOperationInventorySourceV1 | EquipmentOperationInventoryDestinationV1): void => {
    entries.push(ref.containerKind === 'trainer'
      ? { kind: 'sheet', sheetKind: 'trainer', slug: ref.containerSlug, revision: ref.expectedRevision }
      : { kind: 'group-inventory', sheetKind: null, slug: ref.containerSlug, revision: ref.expectedRevision })
  }
  const equipment = (ref: { readonly ownerKind: EquipmentOwnerKind; readonly ownerSlug: string; readonly expectedSheetRevision: number }): void => {
    entries.push({ kind: 'sheet', sheetKind: ref.ownerKind, slug: ref.ownerSlug, revision: ref.expectedSheetRevision })
  }
  if (command.source.kind === 'inventory') inventory(command.source)
  else equipment(command.source)
  if (!isLifecycleOperation(command)) {
    if (command.destination.kind === 'inventory') inventory(command.destination)
    else equipment(command.destination)
    if (command.swapReturnDestination) inventory(command.swapReturnDestination)
  }
  const byKey = new Map<string, ResourceExpectation>()
  for (const entry of entries) {
    const key = resourceKey(entry.kind, entry.sheetKind, entry.slug)
    const existing = byKey.get(key)
    if (existing && existing.revision !== entry.revision) fail(400, `Equipment command has conflicting expected revisions for ${key}.`)
    byKey.set(key, entry)
  }
  return Object.freeze([...byKey.values()].sort((left, right) => resourceKey(left.kind, left.sheetKind, left.slug)
    .localeCompare(resourceKey(right.kind, right.sheetKind, right.slug))))
}

const authorize = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: EquipmentOperationCommandV1
  readonly expectations: readonly ResourceExpectation[]
  readonly trainerSheets: readonly TrainerSheet[]
}): void => {
  if (input.role === 'gm') {
    if (input.command.actorProfileId !== null) fail(400, 'GM equipment commands must not claim a player profile.')
    return
  }
  if (isLifecycleOperation(input.command)) {
    fail(403, 'Only the GM can adjudicate equipment suppression, durability, breakage, or restoration.')
  }
  if (input.role !== 'player' || !input.playerProfile || input.command.actorProfileId !== input.playerProfile.id) {
    fail(403, 'Choose the same controlled player profile before changing equipment.')
  }
  if (input.expectations.some(entry => entry.kind === 'group-inventory')) {
    fail(403, 'Players cannot move equipment into or out of shared group inventory.')
  }
  for (const entry of input.expectations) {
    if (entry.kind !== 'sheet' || !entry.sheetKind) continue
    if (!playerProfileCanControlTokenSheet(input.playerProfile, entry.sheetKind, entry.slug, {
      linkedTrainerSheets: input.trainerSheets,
    })) fail(403, `The selected player profile does not control ${entry.sheetKind}/${entry.slug}.`)
  }
}

const cloneRow = (value: InventoryEntry): InventoryEntry => structuredClone(value)
const inventoryRows = (
  resource: MutableSheetResource | MutableGroupResource,
  section: ItemInventorySection,
): InventoryEntry[] => {
  const document = resource.document as Record<string, unknown>
  const inventoryValue = document.inventory
  if (inventoryValue !== undefined && (!inventoryValue || typeof inventoryValue !== 'object' || Array.isArray(inventoryValue))) {
    fail(409, `${resource.key} inventory is malformed.`)
  }
  const inventory = (inventoryValue ?? {}) as Record<string, unknown>
  const rowsValue = inventory[section]
  if (rowsValue === undefined) return []
  if (!Array.isArray(rowsValue)) return fail(409, `${resource.key} ${section} inventory is malformed.`)
  return rowsValue.map((entry: unknown, index: number) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(409, `${resource.key} ${section}[${index}] is malformed.`)
    return cloneRow(entry as InventoryEntry)
  })
}
const setInventoryRows = (
  resource: MutableSheetResource | MutableGroupResource,
  section: ItemInventorySection,
  rows: readonly InventoryEntry[],
): void => {
  const document = resource.document as Record<string, unknown>
  const inventory = document.inventory && typeof document.inventory === 'object' && !Array.isArray(document.inventory)
    ? document.inventory as Record<string, unknown>
    : {}
  document.inventory = { ...inventory, [section]: rows.map(cloneRow) }
  resource.dirty = true
}
const inventoryResource = (
  resources: ReadonlyMap<string, MutableResource>,
  ref: { readonly containerKind: ItemSourceContainerKind; readonly containerSlug: string },
): MutableSheetResource | MutableGroupResource => {
  const key = ref.containerKind === 'trainer'
    ? resourceKey('sheet', 'trainer', ref.containerSlug)
    : resourceKey('group-inventory', null, ref.containerSlug)
  const resource = resources.get(key)
  if (!resource || (resource.kind !== 'group-inventory' && resource.kind !== 'trainer')) fail(404, `Inventory ${ref.containerKind}/${ref.containerSlug} was not loaded.`)
  return resource as MutableSheetResource | MutableGroupResource
}
const consumeSourceRow = (
  resources: ReadonlyMap<string, MutableResource>,
  source: EquipmentOperationInventorySourceV1,
  reservedQuantity: number,
): InventoryEntry => {
  const resource = inventoryResource(resources, source)
  const rows = inventoryRows(resource, source.section)
  const matches = rows.flatMap((row, index) => row.id === source.rowId ? [{ row, index }] : [])
  if (matches.length !== 1) fail(matches.length ? 409 : 404, 'The equipment source row moved or has a duplicate identity.')
  const { row, index } = matches[0]!
  let serialized = false
  try {
    serialized = row.serializedEquipment !== undefined
      && Boolean(parseSerializedEquipmentInventoryState(row.serializedEquipment))
  }
  catch { fail(409, 'The serialized equipment source row is malformed.') }
  const quantity = serialized || source.section === 'equipment' ? 1 : (row.qty ?? 1)
  if (!Number.isSafeInteger(quantity) || quantity < 1) fail(409, 'The equipment source row has no whole item available.')
  if (!Number.isSafeInteger(reservedQuantity) || reservedQuantity < 0 || quantity - reservedQuantity < 1) {
    fail(409, 'The equipment source does not have an unreserved whole item available.')
  }
  if (serialized || source.section === 'equipment' || quantity === 1) rows.splice(index, 1)
  else rows[index] = { ...row, qty: quantity - 1 }
  setInventoryRows(resource, source.section, rows)
  return cloneRow(row)
}

const sheetResource = (
  resources: ReadonlyMap<string, MutableResource>,
  kind: EquipmentOwnerKind,
  slug: string,
): MutableSheetResource => {
  const resource = resources.get(resourceKey('sheet', kind, slug))
  if (!resource) return fail(404, `${kind} sheet ${slug} was not loaded.`)
  if (resource.kind === 'group-inventory') return fail(404, `${kind} sheet ${slug} was not loaded.`)
  return resource
}
const equipmentState = (
  resource: MutableSheetResource,
  expectedEquipmentRevision: number,
): SheetEquipmentStateV1 => {
  let state: SheetEquipmentStateV1
  try { state = parseSheetEquipmentStateForOwner(resource.document.equipmentState, { kind: resource.kind, slug: resource.slug }) }
  catch (error) { return fail(409, error instanceof Error ? error.message : 'Equipment state is malformed.') }
  if (state.revision !== expectedEquipmentRevision) fail(409, 'Equipment state changed. Refresh before retrying.')
  return state
}
const applyDurableEquipProviderEffects = (
  resource: MutableSheetResource,
  canonicalItemId: string,
): void => {
  const effects = (equipmentEventProviderDefinitionFor(canonicalItemId)?.providers ?? []).flatMap(provider => (
    provider.predicate.kind === 'item'
    && provider.predicate.changes.includes('equipped')
    && provider.effect.kind === 'apply-condition'
    && provider.effect.duration === 'persistent'
      ? [provider.effect]
      : []
  ))
  if (!effects.length) return
  const combat = resource.document.combat
  if (!combat || typeof combat !== 'object' || Array.isArray(combat)) {
    fail(409, `${resource.kind} sheet ${resource.slug} cannot accept its reviewed equipment condition.`)
  }
  const rawConditions = (combat as Record<string, unknown>).conditions
  if (rawConditions !== undefined && (!Array.isArray(rawConditions)
    || rawConditions.some(condition => typeof condition !== 'string'))) {
    fail(409, `${resource.kind} sheet ${resource.slug} has malformed combat conditions.`)
  }
  const conditions = [...(rawConditions as string[] | undefined ?? [])]
  for (const effect of effects) {
    if (!conditions.some(condition => condition.trim().toLocaleLowerCase('en-US')
      === effect.conditionId.trim().toLocaleLowerCase('en-US'))) conditions.push(effect.conditionId)
  }
  resource.document.combat = { ...(combat as Record<string, unknown>), conditions }
}

const ownerFor = (resource: MutableSheetResource): EquipmentCompatibilityOwner => resource.kind === 'trainer'
  ? { kind: 'trainer', slug: resource.slug, sheet: resource.document as unknown as TrainerSheet }
  : { kind: 'pokemon', slug: resource.slug, sheet: resource.document as unknown as CharacterSheet }
const configurationFor = (
  command: EquipmentCustodyOperationCommandV1,
  canonicalItemId: string,
  serialized: ReturnType<typeof parseSerializedEquipmentInventoryState> | null,
): EquipmentItemConfigurationV1 | null => {
  const requested = command.configuration
  if (!requested) return serialized?.configuration ?? null
  const definitionSha256 = equipmentConfigurationDefinitionSha256(canonicalItemId)
  if (!definitionSha256) return fail(409, 'This item does not have a current equipment configuration definition.')
  return {
    schemaVersion: EQUIPMENT_CONFIGURATION_SCHEMA_VERSION,
    configurationId: requested.configurationId,
    definitionSha256,
    values: requested.values,
  }
}
const requireEquippedInstance = (
  state: SheetEquipmentStateV1,
  input: { readonly instanceId: string; readonly expectedInstanceRevision?: number },
): EquippedItemInstanceV1 => {
  const projected = /^equipment-projection:v1:(\d+)$/.exec(input.instanceId)
  const instance = projected
    ? state.instances[Number(projected[1])]
    : state.instances.find(row => row.instanceId === input.instanceId)
  if (!instance) return fail(404, 'The equipped item instance no longer exists.')
  if (input.expectedInstanceRevision !== undefined && instance.revision !== input.expectedInstanceRevision) {
    fail(409, 'The equipped item changed. Refresh before retrying.')
  }
  return instance
}
const withoutInstance = (state: SheetEquipmentStateV1, instanceId: string): SheetEquipmentStateV1 =>
  parseSheetEquipmentStateForOwner({
    ...state,
    slots: state.slots.map(slot => ({ ...slot, instanceId: slot.instanceId === instanceId ? null : slot.instanceId })),
    instances: state.instances.filter(instance => instance.instanceId !== instanceId),
  }, state.owner)
const withStateRevision = (state: SheetEquipmentStateV1, changes: Pick<SheetEquipmentStateV1, 'slots' | 'instances'>): SheetEquipmentStateV1 =>
  parseSheetEquipmentStateForOwner({
    ...state,
    revision: nextRevision(state.revision, `${state.owner.kind} equipment revision`),
    slots: changes.slots,
    instances: changes.instances,
  }, state.owner)

const activityReasonKey = (reason: EquipmentActivityReasonV1): string =>
  `${reason.code}\u001f${reason.sourceId ?? ''}`
const activityStatusForReasons = (
  reasons: readonly EquipmentActivityReasonV1[],
  previousStatus: EquipmentActivityStatus,
): EquipmentActivityStatus => {
  if (!reasons.length) return 'active'
  const breakage = reasons.some(reason => reason.code.startsWith('equipment.breakage.'))
  const inactive = reasons.some(reason => reason.code.startsWith('equipment.inactive.')
    || reason.code === 'equipment.definition-pending')
  const suppressed = reasons.some(reason => reason.code.startsWith('equipment.suppression.'))
  const unknown = reasons.some(reason => !reason.code.startsWith('equipment.breakage.')
    && !reason.code.startsWith('equipment.inactive.')
    && reason.code !== 'equipment.definition-pending'
    && !reason.code.startsWith('equipment.suppression.'))
  if (breakage || (unknown && previousStatus === 'broken')) return 'broken'
  if (inactive || (unknown && previousStatus === 'inactive')) return 'inactive'
  if (suppressed || (unknown && previousStatus === 'suppressed')) return 'suppressed'
  // Unknown durable reasons fail closed rather than silently reactivating mechanics.
  return 'inactive'
}

const returnRowId = (input: {
  readonly operationId: string
  readonly instance: EquippedItemInstanceV1
  readonly destination: EquipmentOperationInventoryDestinationV1
}): string => input.instance.source.containerKind === input.destination.containerKind
  && input.instance.source.containerSlug === input.destination.containerSlug
  && input.instance.source.section === input.destination.section
  ? input.instance.source.rowId
  : `equipment-return-v1-${digest32(input.operationId, input.instance.instanceId, input.destination.containerKind, input.destination.containerSlug, input.destination.section)}`
const previousSourceRow = (
  operationRepository: EquipmentOperationRepository,
  instance: EquippedItemInstanceV1,
): InventoryEntry | null => {
  const origin = operationRepository.get(instance.equippedByOperationId)
  const row = origin?.evidence.sourceInventoryRow
  return row && equipmentCanonicalItemIdForName(row.name) === instance.canonicalItemId ? cloneRow(row) : null
}
const returnInstanceToInventory = (input: {
  readonly resources: ReadonlyMap<string, MutableResource>
  readonly operationRepository: EquipmentOperationRepository
  readonly operationId: string
  readonly instance: EquippedItemInstanceV1
  readonly destination: EquipmentOperationInventoryDestinationV1
}): void => {
  const resource = inventoryResource(input.resources, input.destination)
  const rows = inventoryRows(resource, input.destination.section)
  const preferredRowId = returnRowId(input)
  const rowId = rows.some(row => row.id === preferredRowId)
    ? `equipment-return-v1-${digest32(input.operationId, input.instance.instanceId, input.destination.containerKind, input.destination.containerSlug, input.destination.section)}`
    : preferredRowId
  if (rows.some(row => row.id === rowId)) fail(409, 'The return inventory row identity is already occupied. No equipment was moved.')
  const prior = previousSourceRow(input.operationRepository, input.instance)
  const row: InventoryEntry = {
    ...(prior ?? { name: input.instance.canonicalItemId }),
    id: rowId,
    name: input.instance.canonicalItemId,
    serializedEquipment: serializedEquipmentInventoryStateFromInstance(
      input.instance,
      nextRevision(input.instance.revision, 'serialized equipment revision'),
    ),
    qty: undefined,
  }
  if (row.qty === undefined) delete row.qty
  rows.push(row)
  setInventoryRows(resource, input.destination.section, rows)
}

const loadResources = (input: {
  readonly expectations: readonly ResourceExpectation[]
  readonly sheets: EquipmentSheetRepository
  readonly groups: EquipmentGroupRepository
}): Map<string, MutableResource> => {
  const resources = new Map<string, MutableResource>()
  for (const expectation of input.expectations) {
    const key = resourceKey(expectation.kind, expectation.sheetKind, expectation.slug)
    if (expectation.kind === 'sheet') {
      const stored = input.sheets.getByRef(expectation.sheetKind!, expectation.slug)
      if (!stored) return fail(404, `${expectation.sheetKind} sheet ${expectation.slug} was not found.`)
      if (stored.revision !== expectation.revision) fail(409, `${expectation.sheetKind} sheet ${expectation.slug} changed. Refresh before retrying.`)
      resources.set(key, {
        key, kind: expectation.sheetKind!, slug: expectation.slug,
        expectedRevision: expectation.revision, before: stored,
        document: structuredClone(stored.sheet), dirty: false,
      })
    }
    else {
      const stored = input.groups.get(expectation.slug)?.document ?? null
      if (!stored) return fail(404, `Group inventory ${expectation.slug} was not found.`)
      if (stored.revision !== expectation.revision) fail(409, `Group inventory ${expectation.slug} changed. Refresh before retrying.`)
      resources.set(key, {
        key, kind: 'group-inventory', slug: expectation.slug,
        expectedRevision: expectation.revision, before: stored,
        document: structuredClone(stored), dirty: false,
      })
    }
  }
  return resources
}

const snapshotResult = (record: StoredEquipmentOperationRecord, exactReplay: boolean): ExecuteEquipmentOperationResult => ({
  result: parseEquipmentOperationResult({ ...record.result, exactReplay }),
  sheets: Object.freeze(record.evidence.resources.flatMap((resource): PersistedSheet[] => resource.kind === 'sheet' ? [{
    kind: resource.sheetKind,
    slug: resource.slug,
    sheet: structuredClone(resource.afterDocument),
    revision: resource.afterRevision,
    updatedAt: Number(resource.afterDocument.updatedAt ?? 0),
  }] : [])),
  groupInventories: Object.freeze(record.evidence.resources.flatMap((resource): GroupInventoryDocument[] =>
    resource.kind === 'group-inventory' ? [structuredClone(resource.afterDocument) as unknown as GroupInventoryDocument] : [])),
})

export const executeEquipmentOperation = (
  input: ExecuteEquipmentOperationInput,
  dependencies: ExecuteEquipmentOperationDependencies = {},
): ExecuteEquipmentOperationResult => {
  let command: EquipmentOperationCommandV1
  try { command = parseEquipmentOperationCommand(input.command) }
  catch (error) { return fail(400, error instanceof Error ? error.message : 'Equipment command is malformed.') }
  const expectations = expectationsFor(command)
  const database = databaseFrom(dependencies)
  const sheets = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const groups = dependencies.groupInventoryRepository ?? createSqliteGroupInventoryRepository(database)
  const operations = dependencies.operationRepository ?? createSqliteEquipmentOperationRepository({ database })
  const itemOperations = dependencies.itemOperationRepository ?? createSqliteItemOperationRepository({ database })
  const realtime = dependencies.realtimeEventRepository ?? createSqliteRealtimeEventRepository({ database })
  const maps = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const now = dependencies.now ?? Date.now

  const trainerSheets = sheets.list('trainer').map(row => ({
    ...(row.document as unknown as TrainerSheet), slug: row.slug, revision: row.revision,
  }))
  authorize({ role: input.role, playerProfile: input.playerProfile, command, expectations, trainerSheets })

  const existing = operations.get(command.operationId)
  if (existing) {
    if (existing.commandSha256 !== equipmentOperationCommandSha256(command)) {
      fail(409, `Equipment operation ${command.operationId} was reused for a different command.`)
    }
    return snapshotResult(existing, true)
  }

  const transaction = database.withTransaction(() => {
    const concurrentExisting = operations.get(command.operationId)
    if (concurrentExisting) {
      if (concurrentExisting.commandSha256 !== equipmentOperationCommandSha256(command)) {
        fail(409, `Equipment operation ${command.operationId} was reused for a different command.`)
      }
      return { replay: concurrentExisting, events: [] as const }
    }
    const currentTrainerSheets = sheets.list('trainer').map(row => ({
      ...(row.document as unknown as TrainerSheet), slug: row.slug, revision: row.revision,
    }))
    authorize({ role: input.role, playerProfile: input.playerProfile, command, expectations, trainerSheets: currentTrainerSheets })
    const resources = loadResources({ expectations, sheets, groups })
    if (!isLifecycleOperation(command)) {
      if (command.source.kind === 'equipment') {
        assertEquipmentInstanceNotBackingActiveItemForm({
          maps,
          ownerKind: command.source.ownerKind,
          ownerSlug: command.source.ownerSlug,
          instanceId: command.source.instanceId,
        })
      }
      if (command.commandKind === 'swap' && command.destination.kind === 'equipment' && command.replacedInstanceId) {
        assertEquipmentInstanceNotBackingActiveItemForm({
          maps,
          ownerKind: command.destination.ownerKind,
          ownerSlug: command.destination.ownerSlug,
          instanceId: command.replacedInstanceId,
        })
      }
    }
    const timestamp = now()
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) fail(400, 'Equipment operation timestamp is invalid.')

    let canonicalItemId: string
    let equippedInstanceId: string | null = null
    let displacedCanonicalItemId: string | null = null
    let sourceInventoryRow: InventoryEntry | null = null

    if (isActivityOperation(command)) {
      const owner = sheetResource(resources, command.source.ownerKind, command.source.ownerSlug)
      const state = equipmentState(owner, command.source.expectedEquipmentRevision)
      const instance = requireEquippedInstance(state, {
        instanceId: command.source.instanceId,
        expectedInstanceRevision: command.source.expectedInstanceRevision,
      })
      const requestedReason: EquipmentActivityReasonV1 = {
        code: command.reason.code,
        sourceId: command.reason.sourceId,
      }
      const requestedKey = activityReasonKey(requestedReason)
      const removesReason = command.commandKind === 'restore' || command.commandKind === 'repair'
      const hasReason = instance.activity.reasons.some(reason => activityReasonKey(reason) === requestedKey)
      if (removesReason ? !hasReason : hasReason) {
        fail(409, removesReason
          ? 'The selected equipment activity reason is no longer present. Refresh before retrying.'
          : 'The selected equipment activity reason is already present. No equipment was changed.')
      }
      const reasons = (removesReason
        ? instance.activity.reasons.filter(reason => activityReasonKey(reason) !== requestedKey)
        : [...instance.activity.reasons, requestedReason])
        .slice()
        .sort((left, right) => activityReasonKey(left).localeCompare(activityReasonKey(right)))
      const updatedInstance: EquippedItemInstanceV1 = {
        ...instance,
        revision: nextRevision(instance.revision, 'equipped item revision'),
        activity: {
          status: activityStatusForReasons(reasons, instance.activity.status),
          reasons,
        },
      }
      owner.document.equipmentState = withStateRevision(state, {
        slots: state.slots,
        instances: state.instances.map(row => row.instanceId === instance.instanceId ? updatedInstance : row),
      })
      owner.dirty = true
      canonicalItemId = instance.canonicalItemId
      equippedInstanceId = instance.instanceId
    }
    else if (isDurabilityOperation(command)) {
      const owner = sheetResource(resources, command.source.ownerKind, command.source.ownerSlug)
      const state = equipmentState(owner, command.source.expectedEquipmentRevision)
      const instance = requireEquippedInstance(state, {
        instanceId: command.source.instanceId,
        expectedInstanceRevision: command.source.expectedInstanceRevision,
      })
      const durabilityUpdate = (() => {
        try {
          return updateEquipmentDurabilityState({
            serializedState: instance.serializedState,
            amount: command.amount,
            kind: command.commandKind === 'damage' ? 'damage' : 'restore',
          })
        }
        catch (error) {
          return fail(409, error instanceof Error ? error.message : 'Equipment durability state is malformed.')
        }
      })()
      const durabilityReason: EquipmentActivityReasonV1 = {
        code: 'equipment.breakage.durability',
        sourceId: instance.instanceId,
      }
      const durabilityReasonKey = activityReasonKey(durabilityReason)
      const withoutDurabilityReason = instance.activity.reasons
        .filter(reason => activityReasonKey(reason) !== durabilityReasonKey)
      const reasons = (durabilityUpdate.durability.current === 0
        ? [...withoutDurabilityReason, durabilityReason]
        : withoutDurabilityReason)
        .slice()
        .sort((left, right) => activityReasonKey(left).localeCompare(activityReasonKey(right)))
      const updatedInstance: EquippedItemInstanceV1 = {
        ...instance,
        revision: nextRevision(instance.revision, 'equipped item revision'),
        serializedState: durabilityUpdate.state,
        activity: {
          status: activityStatusForReasons(reasons, instance.activity.status),
          reasons,
        },
      }
      owner.document.equipmentState = withStateRevision(state, {
        slots: state.slots,
        instances: state.instances.map(row => row.instanceId === instance.instanceId ? updatedInstance : row),
      })
      owner.dirty = true
      canonicalItemId = instance.canonicalItemId
      equippedInstanceId = instance.instanceId
    }
    else if (command.source.kind === 'inventory' && command.destination.kind === 'equipment') {
      const source = command.source
      const destination = command.destination
      sourceInventoryRow = consumeSourceRow(
        resources,
        source,
        itemOperations.reservedQuantity(source.sourceInstanceId),
      )
      let serialized: ReturnType<typeof parseSerializedEquipmentInventoryState> | null = null
      try {
        serialized = sourceInventoryRow.serializedEquipment === undefined
          ? null
          : parseSerializedEquipmentInventoryState(sourceInventoryRow.serializedEquipment)
      }
      catch { fail(409, 'The serialized equipment source row is malformed.') }
      const nameCanonicalItemId = equipmentCanonicalItemIdForName(sourceInventoryRow.name)
        ?? fail(409, 'This inventory row has no current reviewed equipment definition.')
      canonicalItemId = serialized?.canonicalItemId ?? nameCanonicalItemId
      if (serialized && nameCanonicalItemId !== serialized.canonicalItemId) {
        fail(409, 'The serialized equipment identity does not match its inventory row label.')
      }
      const definition = equipmentDefinitionFor(canonicalItemId)
      const definitionHash = equipmentDefinitionSha256(canonicalItemId)
      if (!definition || !definitionHash) return fail(409, 'This item has no current reviewed equipment definition.')
      if (serialized && (serialized.canonicalRecordSha256 !== definition.canonicalRecordSha256
        || serialized.equipmentDefinitionSha256 !== definitionHash)) {
        return fail(409, 'This item has no current reviewed equipment definition.')
      }
      const target = sheetResource(resources, destination.ownerKind, destination.ownerSlug)
      let state = equipmentState(target, destination.expectedEquipmentRevision)
      if (command.commandKind === 'swap') {
        const displaced = requireEquippedInstance(state, { instanceId: command.replacedInstanceId! })
        const displacedSlots = state.slots
          .filter(slot => slot.instanceId === displaced.instanceId)
          .map(slot => slot.slotId)
        if (!destination.slotIds.some(slotId => displacedSlots.includes(slotId))) {
          fail(409, 'The displaced item does not occupy a requested destination slot. No equipment was moved.')
        }
        if (displaced.source.sourceInstanceId === source.sourceInstanceId) {
          fail(409, 'The incoming and displaced items have the same source identity. No equipment was moved.')
        }
        displacedCanonicalItemId = displaced.canonicalItemId
        state = withoutInstance(state, displaced.instanceId)
        returnInstanceToInventory({
          resources,
          operationRepository: operations,
          operationId: command.operationId,
          instance: displaced,
          destination: command.swapReturnDestination!,
        })
      }
      const configuration = configurationFor(command, canonicalItemId, serialized)
      const compatibility = evaluateEquipmentCompatibility({
        owner: ownerFor(target),
        equipmentState: state,
        canonicalItemId,
        canonicalRecordSha256: definition.canonicalRecordSha256,
        requestedSlots: destination.slotIds,
        configuration,
      })
      if (!compatibility.eligible) fail(409, compatibility.unavailableReason?.message ?? 'This item cannot be equipped.')
      const newInstanceId = serialized?.instanceId
        ?? `equipped-item:v1:${digest32(command.operationId, canonicalItemId, source.sourceInstanceId)}`
      equippedInstanceId = newInstanceId
      if (state.instances.some(instance => instance.instanceId === newInstanceId)) fail(409, 'The deterministic equipped-item identity is already assigned.')
      const serializedState = (() => {
        try {
          return initializeEquipmentDurabilityState({
            definition,
            configuration,
            serializedState: serialized?.state ?? {},
          })
        }
        catch (error) {
          return fail(409, error instanceof Error ? error.message : 'Equipment durability state is malformed.')
        }
      })()
      const serializedActivity = serialized?.activity ?? { status: 'active' as const, reasons: [] }
      const durability = parseEquipmentDurabilityState(serializedState)
      const durabilityReason: EquipmentActivityReasonV1 = {
        code: 'equipment.breakage.durability',
        sourceId: newInstanceId,
      }
      const hasDurabilityReason = serializedActivity.reasons
        .some(reason => activityReasonKey(reason) === activityReasonKey(durabilityReason))
      if (durability && ((durability.current === 0) !== hasDurabilityReason)) {
        fail(409, 'Serialized equipment durability and breakage state are inconsistent.')
      }
      const instance: EquippedItemInstanceV1 = {
        instanceId: newInstanceId,
        revision: serialized
          ? nextRevision(serialized.revision, 'serialized equipment revision')
          : 0,
        canonicalItemId,
        canonicalRecordSha256: definition.canonicalRecordSha256,
        equipmentDefinitionSha256: definitionHash,
        source: {
          kind: 'inventory',
          containerKind: source.containerKind,
          containerSlug: source.containerSlug,
          section: source.section,
          rowId: source.rowId,
          sourceInstanceId: source.sourceInstanceId,
          sourceRevision: source.expectedRevision,
          quantity: 1,
        },
        configuration,
        serializedState,
        activity: serializedActivity,
        equippedByOperationId: command.operationId,
        equippedAt: timestamp,
      }
      const slots = state.slots.map(slot => ({
        ...slot,
        instanceId: destination.slotIds.includes(slot.slotId) ? newInstanceId : slot.instanceId,
      }))
      state = withStateRevision(state, { slots, instances: [...state.instances, instance] })
      target.document.equipmentState = state
      applyDurableEquipProviderEffects(target, canonicalItemId)
      target.dirty = true
    }
    else if (command.source.kind === 'equipment' && command.destination.kind === 'inventory') {
      const owner = sheetResource(resources, command.source.ownerKind, command.source.ownerSlug)
      const state = equipmentState(owner, command.source.expectedEquipmentRevision)
      const instance = requireEquippedInstance(state, {
        instanceId: command.source.instanceId,
        expectedInstanceRevision: command.source.expectedInstanceRevision,
      })
      canonicalItemId = instance.canonicalItemId
      returnInstanceToInventory({
        resources,
        operationRepository: operations,
        operationId: command.operationId,
        instance,
        destination: command.destination,
      })
      owner.document.equipmentState = withStateRevision(withoutInstance(state, instance.instanceId), {
        slots: withoutInstance(state, instance.instanceId).slots,
        instances: withoutInstance(state, instance.instanceId).instances,
      })
      owner.dirty = true
    }
    else return fail(400, 'Equipment command source and destination are inconsistent.')

    const dirty = [...resources.values()].filter(resource => resource.dirty)
    if (!dirty.length) fail(409, 'Equipment command produced no authoritative change.')
    const authoritativeSheets: PersistedSheet[] = []
    const authoritativeGroups: GroupInventoryDocument[] = []
    for (const resource of dirty) {
      if (resource.kind === 'group-inventory') {
        const update = groups.applyLivePlayUpdate({
          slug: resource.slug,
          expectedRevision: resource.expectedRevision,
          now: timestamp,
          nextDocument: { ...resource.document, updatedAt: timestamp },
        })
        if (update.status !== 'applied') return fail(409, `Group inventory ${resource.slug} changed before equipment commit.`)
        authoritativeGroups.push(update.document)
      }
      else {
        const update = sheets.applyLivePlayUpdate({
          kind: resource.kind,
          slug: resource.slug,
          expectedRevision: resource.expectedRevision,
          nextSheet: { ...resource.document, updatedAt: timestamp },
          sourceOperationId: command.operationId,
          heldItemCustodyChanged: resource.kind === 'pokemon',
        })
        if (update !== 'applied') fail(409, `${resource.kind} sheet ${resource.slug} changed before equipment commit.`)
        const stored = sheets.getByRef(resource.kind, resource.slug) ?? fail(404, `${resource.kind} sheet ${resource.slug} disappeared after equipment commit.`)
        authoritativeSheets.push(stored)
      }
    }
    const resultResources: EquipmentOperationResourceRevisionV1[] = dirty.map(resource => ({
      kind: resource.kind === 'group-inventory' ? 'group-inventory' : 'sheet',
      sheetKind: resource.kind === 'group-inventory' ? null : resource.kind,
      slug: resource.slug,
      beforeRevision: resource.expectedRevision,
      afterRevision: nextRevision(resource.expectedRevision, `${resource.key} revision`),
    }))
    const result = parseEquipmentOperationResult({
      schemaVersion: EQUIPMENT_OPERATION_SCHEMA_VERSION,
      operationId: command.operationId,
      commandKind: command.commandKind,
      status: 'accepted',
      exactReplay: false,
      canonicalItemId,
      equippedInstanceId,
      displacedCanonicalItemId,
      resources: resultResources,
    })
    const evidenceResources: EquipmentOperationResourceEvidenceV1[] = dirty.map((resource) => {
      if (resource.kind === 'group-inventory') {
        const after = authoritativeGroups.find(group => group.slug === resource.slug)!
        return {
          kind: 'group-inventory', slug: resource.slug,
          beforeRevision: resource.expectedRevision, afterRevision: after.revision,
          beforeDocument: structuredClone(resource.before) as unknown as Record<string, unknown>,
          afterDocument: structuredClone(after) as unknown as Record<string, unknown>,
        }
      }
      const after = authoritativeSheets.find(sheet => sheet.kind === resource.kind && sheet.slug === resource.slug)!
      return {
        kind: 'sheet', sheetKind: resource.kind, slug: resource.slug,
        beforeRevision: resource.expectedRevision, afterRevision: after.revision,
        beforeDocument: structuredClone(resource.before.sheet),
        afterDocument: structuredClone(after.sheet),
      }
    })
    const evidence: EquipmentOperationEvidenceV1 = {
      schemaVersion: 1,
      operationId: command.operationId,
      sourceInventoryRow,
      resources: evidenceResources,
    }
    const stored = operations.saveAccepted({ command, result, evidence, createdAt: timestamp })
    const events = realtime.appendMany([
      ...authoritativeSheets.flatMap(sheet => itemOperationSheetUpdatedRealtimeAppendInputs({
        operationId: command.operationId,
        sheet,
        clientId: input.clientId,
      })),
      ...authoritativeGroups.flatMap(group => groupInventoryUpdatedRealtimeAppendInputs(group, input.clientId, 'item-operation')),
    ])
    return { replay: null, stored, events }
  })

  if (transaction.replay) return snapshotResult(transaction.replay, true)
  publishPersistedRealtimeEventsAfterCommit({
    events: transaction.events,
    operation: 'equipment-operation',
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
  })
  return snapshotResult(transaction.stored, false)
}
