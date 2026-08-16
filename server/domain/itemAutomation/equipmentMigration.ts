import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import itemsJson from '~~/data/reference/items.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { createItemIdentityRegistry } from '#shared/itemAutomation/identity'
import {
  createEmptySheetEquipmentState,
  parseSerializedEquipmentInventoryState,
  parseSheetEquipmentStateForOwner,
  type EquipmentLegacyIssueReason,
  type EquipmentOwnerKind,
  type EquipmentSlotId,
  type SheetEquipmentStateV1,
} from '#shared/itemAutomation/equipment'
import type { EquipmentCompatibilityOwner } from './equipmentCompatibility'
import { reconcileSheetEquipmentCompatibility } from './equipmentCompatibilityReconciliation'
import {
  ITEM_INVENTORY_SECTIONS,
  itemInventoryInstanceId,
  type ItemInventorySection,
  type ItemSourceContainerKind,
} from '#shared/itemAutomation/inventory'

interface CanonicalItemRecord {
  readonly name: string
  readonly aliases: readonly string[]
  readonly [key: string]: unknown
}

interface SheetSqlRow {
  readonly kind: unknown
  readonly slug: unknown
  readonly document_json: unknown
  readonly revision: unknown
  readonly updated_at: unknown
}

interface GroupSqlRow {
  readonly slug: unknown
  readonly document_json: unknown
  readonly revision: unknown
  readonly updated_at: unknown
}

type MutableRecord = Record<string, unknown>

interface MutableContainer<Kind extends EquipmentOwnerKind | 'group'> {
  readonly kind: Kind
  readonly slug: string
  readonly document: MutableRecord
  readonly originalRevision: number
  readonly originalUpdatedAt: number
  dirty: boolean
}

type MutableInventoryContainer = MutableContainer<ItemSourceContainerKind>
type MutableSheet = MutableContainer<EquipmentOwnerKind>

interface SourceCandidate {
  readonly container: MutableInventoryContainer
  readonly section: ItemInventorySection
  readonly row: MutableRecord
  readonly rowId: string
  readonly instanceId: string
  readonly capacity: number
  readonly identityUnique: boolean
  readonly serialized: ReturnType<typeof parseSerializedEquipmentInventoryState> | null
}

interface LegacyClaim {
  readonly owner: MutableSheet
  readonly slotId: EquipmentSlotId
  readonly legacyDisplayName: string
  readonly canonicalItemId: string | null
  readonly candidates: readonly SourceCandidate[]
  readonly duplicateAssignment: boolean
  resolution: 'convert' | EquipmentLegacyIssueReason
  source: SourceCandidate | null
}

export interface LegacyEquipmentDocumentMigrationReport {
  readonly sheetsExamined: number
  readonly sheetsInitialized: number
  readonly effectiveInstancesMigrated: number
  readonly unresolvedEntriesCreated: number
  readonly inventoryRowsGivenStableIdentity: number
  readonly legacyValuesRetired: number
  readonly sourceItemsMoved: number
  readonly changedSheets: readonly { readonly kind: EquipmentOwnerKind; readonly slug: string }[]
  readonly changedGroupInventories: readonly string[]
}

const canonicalItems = itemsJson as Record<string, CanonicalItemRecord>
const itemIdentity = createItemIdentityRegistry(Object.entries(canonicalItems).map(([canonicalId, item]) => {
  if (item.name !== canonicalId) throw new Error(`Canonical item record ${canonicalId} has a mismatched name.`)
  return { canonicalId, aliases: item.aliases }
}))
const canonicalRecordSha256 = new Map(Object.entries(canonicalItems).map(([canonicalId, item]) => [
  canonicalId,
  createHash('sha256').update(stableJsonStringify(item)).digest('hex'),
]))

const TRAINER_SLOTS = ['mainHand', 'offHand', 'head', 'body', 'feet', 'accessory'] as const
const POKEMON_SLOTS = ['held'] as const
const ROW_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/
const MAX_TEXT = 500
const nextSerializedRevision = (value: number): number => {
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Serialized equipment revision cannot advance during migration.')
  }
  return value + 1
}

const isRecord = (value: unknown): value is MutableRecord => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

const safeInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a safe non-negative integer.`)
  return Number(value)
}

const parseJsonObject = (value: unknown, label: string): MutableRecord => {
  if (typeof value !== 'string') throw new Error(`${label} document_json must be text.`)
  let parsed: unknown
  try { parsed = JSON.parse(value) }
  catch { throw new Error(`${label} document_json must contain valid JSON.`) }
  if (!isRecord(parsed)) throw new Error(`${label} document_json must contain an object.`)
  return parsed
}

const digest32 = (...parts: readonly string[]): string => createHash('sha256')
  .update(parts.join('\u001f'))
  .digest('hex')
  .slice(0, 32)

const boundedLegacyText = (value: string): string => value.length <= MAX_TEXT
  ? value
  : `${value.slice(0, MAX_TEXT - 1)}…`

const inventory = (container: MutableInventoryContainer): MutableRecord => {
  if (!isRecord(container.document.inventory)) container.document.inventory = {}
  return container.document.inventory as MutableRecord
}

const rowsFor = (container: MutableInventoryContainer, section: ItemInventorySection): MutableRecord[] => {
  const source = inventory(container)
  if (!Array.isArray(source[section])) source[section] = []
  return (source[section] as unknown[]).filter(isRecord)
}

const stableRowId = (
  container: MutableInventoryContainer,
  section: ItemInventorySection,
  index: number,
  row: MutableRecord,
  used: ReadonlySet<string>,
): string => {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const candidate = `equipment-source-v1-${digest32(
      container.kind,
      container.slug,
      section,
      String(index),
      String(row.name ?? ''),
      String(attempt),
    )}`
    if (!used.has(candidate)) return candidate
  }
  throw new Error(`Could not allocate a stable equipment source row identity for ${container.kind}/${container.slug}.`)
}

const ensureMatchingSourceRows = (
  container: MutableInventoryContainer,
  canonicalItemId: string,
  incrementNormalizedRows: () => void,
): SourceCandidate[] => {
  const candidates: SourceCandidate[] = []
  for (const section of ITEM_INVENTORY_SECTIONS) {
    const rows = rowsFor(container, section)
    const used = new Set(rows.flatMap((row) => {
      const id = typeof row.id === 'string' ? row.id.trim() : ''
      return ROW_ID_PATTERN.test(id) ? [id] : []
    }))
    for (const [index, row] of rows.entries()) {
      const rowName = typeof row.name === 'string' ? row.name : ''
      if (itemIdentity.resolve(rowName) !== canonicalItemId) continue
      const currentId = typeof row.id === 'string' ? row.id.trim() : ''
      const rowId = ROW_ID_PATTERN.test(currentId)
        ? currentId
        : stableRowId(container, section, index, row, used)
      if (rowId !== currentId) {
        row.id = rowId
        container.dirty = true
        incrementNormalizedRows()
      }
      used.add(rowId)
    }
    const identityCounts = new Map<string, number>()
    for (const row of rows) {
      const rowId = typeof row.id === 'string' ? row.id.trim() : ''
      if (ROW_ID_PATTERN.test(rowId)) identityCounts.set(rowId, (identityCounts.get(rowId) ?? 0) + 1)
    }
    for (const row of rows) {
      const rowName = typeof row.name === 'string' ? row.name : ''
      if (itemIdentity.resolve(rowName) !== canonicalItemId) continue
      const rowId = typeof row.id === 'string' ? row.id.trim() : ''
      if (!ROW_ID_PATTERN.test(rowId)) continue
      const serialized = row.serializedEquipment === undefined
        ? null
        : parseSerializedEquipmentInventoryState(row.serializedEquipment)
      if (serialized && (serialized.canonicalItemId !== canonicalItemId
        || serialized.canonicalRecordSha256 !== canonicalRecordSha256.get(canonicalItemId))) continue
      const rawQuantity = row.qty ?? 1
      const capacity = section === 'equipment' || serialized
        ? 1
        : Number.isSafeInteger(rawQuantity) && Number(rawQuantity) > 0 ? Number(rawQuantity) : 0
      if (capacity < 1) continue
      candidates.push({
        container,
        section,
        row,
        rowId,
        instanceId: itemInventoryInstanceId({
          containerKind: container.kind,
          containerSlug: container.slug,
          section,
          rowId,
        }),
        capacity,
        identityUnique: identityCounts.get(rowId) === 1,
        serialized,
      })
    }
  }
  return candidates
}

const stringArray = (value: unknown): readonly string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim()).filter(Boolean)
  : []

const legacyClaimsForSheet = (sheet: MutableSheet): Array<Pick<LegacyClaim, 'slotId' | 'legacyDisplayName' | 'canonicalItemId'>> => {
  if (sheet.kind === 'trainer') {
    const slots = isRecord(sheet.document.equipmentSlots) ? sheet.document.equipmentSlots : {}
    return TRAINER_SLOTS.flatMap((slotId) => {
      const value = typeof slots[slotId] === 'string' ? slots[slotId].trim() : ''
      return value ? [{ slotId, legacyDisplayName: value, canonicalItemId: itemIdentity.resolve(value) }] : []
    })
  }
  const items = isRecord(sheet.document.items) ? sheet.document.items : {}
  const value = typeof items.held === 'string' ? items.held.trim() : ''
  return value ? [{ slotId: 'held', legacyDisplayName: value, canonicalItemId: itemIdentity.resolve(value) }] : []
}

const canonicalSlots = (kind: EquipmentOwnerKind): readonly EquipmentSlotId[] => kind === 'trainer'
  ? TRAINER_SLOTS
  : POKEMON_SLOTS

const compatibilityOwner = (sheet: MutableSheet): EquipmentCompatibilityOwner => sheet.kind === 'trainer'
  ? { kind: 'trainer', slug: sheet.slug, sheet: sheet.document as unknown as TrainerSheet }
  : { kind: 'pokemon', slug: sheet.slug, sheet: sheet.document as unknown as CharacterSheet }

const retireLegacyEffectiveValues = (sheet: MutableSheet): number => {
  if (sheet.kind === 'trainer') {
    if (!isRecord(sheet.document.equipmentSlots)) return 0
    const slots = { ...sheet.document.equipmentSlots }
    let retired = 0
    for (const slotId of TRAINER_SLOTS) {
      if (typeof slots[slotId] === 'string' && slots[slotId].trim()) retired += 1
      delete slots[slotId]
    }
    if (retired > 0) {
      sheet.document.equipmentSlots = slots
      sheet.dirty = true
    }
    return retired
  }
  if (!isRecord(sheet.document.items)) return 0
  const items = { ...sheet.document.items }
  const retired = typeof items.held === 'string' && items.held.trim() ? 1 : 0
  delete items.held
  if (retired > 0) {
    sheet.document.items = items
    sheet.dirty = true
  }
  return retired
}

const nextTimestamp = (value: number, label: string): number => {
  if (value >= Number.MAX_SAFE_INTEGER) throw new Error(`${label} cannot advance for equipment document migration.`)
  return value + 1
}

const migrateDocuments = (connection: DatabaseSync): LegacyEquipmentDocumentMigrationReport => {
  const sheetRows = connection.prepare(`
    SELECT kind, slug, document_json, revision, updated_at
    FROM sheets
    ORDER BY kind, slug
  `).all() as unknown as readonly SheetSqlRow[]
  const groupRows = connection.prepare(`
    SELECT slug, document_json, revision, updated_at
    FROM group_inventories
    ORDER BY slug
  `).all() as unknown as readonly GroupSqlRow[]

  const sheets: MutableSheet[] = sheetRows.map((row) => {
    if (row.kind !== 'trainer' && row.kind !== 'pokemon') throw new Error('Equipment migration found an unsupported sheet kind.')
    if (typeof row.slug !== 'string' || !row.slug) throw new Error('Equipment migration found an invalid sheet slug.')
    return {
      kind: row.kind,
      slug: row.slug,
      document: parseJsonObject(row.document_json, `${row.kind} sheet ${row.slug}`),
      originalRevision: safeInteger(row.revision, `${row.kind} sheet ${row.slug} revision`),
      originalUpdatedAt: safeInteger(row.updated_at, `${row.kind} sheet ${row.slug} updatedAt`),
      dirty: false,
    }
  })
  const groups: MutableInventoryContainer[] = groupRows.map((row) => {
    if (typeof row.slug !== 'string' || !row.slug) throw new Error('Equipment migration found an invalid group inventory slug.')
    return {
      kind: 'group',
      slug: row.slug,
      document: parseJsonObject(row.document_json, `group inventory ${row.slug}`),
      originalRevision: safeInteger(row.revision, `group inventory ${row.slug} revision`),
      originalUpdatedAt: safeInteger(row.updated_at, `group inventory ${row.slug} updatedAt`),
      dirty: false,
    }
  })
  const trainers = sheets.filter((sheet): sheet is MutableSheet & { readonly kind: 'trainer' } => sheet.kind === 'trainer')
  const targetSheets = sheets.filter((sheet) => !Object.hasOwn(sheet.document, 'equipmentState'))
  let legacyValuesRetired = 0
  let existingUnresolvedCreated = 0
  for (const sheet of sheets.filter(sheet => Object.hasOwn(sheet.document, 'equipmentState'))) {
    let state = parseSheetEquipmentStateForOwner(sheet.document.equipmentState, { kind: sheet.kind, slug: sheet.slug })
    const additions: Array<SheetEquipmentStateV1['unresolved'][number]> = []
    for (const claim of legacyClaimsForSheet(sheet)) {
      const assignment = state.slots.find(slot => slot.slotId === claim.slotId)
      const issue = state.unresolved.find(entry => entry.slotId === claim.slotId)
      if (assignment?.instanceId) {
        const assigned = state.instances.find(instance => instance.instanceId === assignment.instanceId)
        if (!assigned || assigned.canonicalItemId !== claim.canonicalItemId) {
          throw new Error(`${sheet.kind} sheet ${sheet.slug} has conflicting explicit and legacy equipment in ${claim.slotId}.`)
        }
        continue
      }
      if (issue) {
        if (issue.legacyDisplayName !== boundedLegacyText(claim.legacyDisplayName)) {
          throw new Error(`${sheet.kind} sheet ${sheet.slug} has conflicting unresolved and legacy equipment in ${claim.slotId}.`)
        }
        continue
      }
      additions.push({
        issueId: `equipment-issue:v1:${digest32(
          sheet.kind, sheet.slug, claim.slotId, claim.legacyDisplayName, 'invalid-assignment',
        )}`,
        slotId: claim.slotId,
        legacyDisplayName: boundedLegacyText(claim.legacyDisplayName),
        reason: 'invalid-assignment',
        candidateCanonicalItemIds: claim.canonicalItemId ? [claim.canonicalItemId] : [],
        candidateSourceInstanceIds: [],
      })
    }
    if (additions.length > 0) {
      if (!Number.isSafeInteger(state.revision + 1)) {
        throw new Error(`${sheet.kind} sheet ${sheet.slug} equipment revision cannot advance for migration.`)
      }
      state = parseSheetEquipmentStateForOwner({
        ...state,
        revision: state.revision + 1,
        unresolved: [...state.unresolved, ...additions],
      }, { kind: sheet.kind, slug: sheet.slug })
      sheet.document.equipmentState = state
      sheet.dirty = true
      existingUnresolvedCreated += additions.length
    }
    const reconciled = reconcileSheetEquipmentCompatibility({
      owner: compatibilityOwner(sheet),
      equipmentState: state,
    })
    if (reconciled.changed) {
      state = reconciled.state
      sheet.document.equipmentState = state
      sheet.dirty = true
    }
    legacyValuesRetired += retireLegacyEffectiveValues(sheet)
    if (Object.hasOwn(sheet.document, 'equipmentProjection')) {
      delete sheet.document.equipmentProjection
      sheet.dirty = true
    }
  }

  let inventoryRowsGivenStableIdentity = 0
  const incrementNormalizedRows = (): void => { inventoryRowsGivenStableIdentity += 1 }
  const candidateCache = new Map<string, readonly SourceCandidate[]>()
  const matchingCandidates = (container: MutableInventoryContainer, canonicalItemId: string): readonly SourceCandidate[] => {
    const key = `${container.kind}:${container.slug}:${canonicalItemId}`
    const cached = candidateCache.get(key)
    if (cached) return cached
    const candidates = ensureMatchingSourceRows(container, canonicalItemId, incrementNormalizedRows)
    candidateCache.set(key, candidates)
    return candidates
  }
  const rawClaims = targetSheets.flatMap(owner => legacyClaimsForSheet(owner).map(claim => ({ owner, ...claim })))
  const duplicateKeys = new Map<string, number>()
  for (const claim of rawClaims) {
    if (!claim.canonicalItemId) continue
    const key = `${claim.owner.kind}:${claim.owner.slug}:${claim.canonicalItemId}`
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1)
  }

  const claims: LegacyClaim[] = rawClaims.map((claim): LegacyClaim => {
    const linkedTrainers = claim.owner.kind === 'trainer'
      ? trainers.filter(trainer => trainer.slug === claim.owner.slug)
      : trainers.filter((trainer) => [
          ...stringArray(trainer.document.currentTeam),
          ...stringArray(trainer.document.boxedPokemon),
        ].includes(claim.owner.slug))
    const trainerCandidates = claim.canonicalItemId
      ? linkedTrainers.flatMap(container => matchingCandidates(container, claim.canonicalItemId!))
      : []
    const groupCandidates = claim.canonicalItemId && trainerCandidates.length === 0
      ? groups.flatMap(container => matchingCandidates(container, claim.canonicalItemId!))
      : []
    const candidates = trainerCandidates.length > 0 ? trainerCandidates : groupCandidates
    const duplicateAssignment = Boolean(claim.canonicalItemId
      && duplicateKeys.get(`${claim.owner.kind}:${claim.owner.slug}:${claim.canonicalItemId}`)! > 1)
    return {
      ...claim,
      candidates,
      duplicateAssignment,
      resolution: !claim.canonicalItemId
        ? 'unknown-item'
        : duplicateAssignment
          ? 'invalid-assignment'
          : candidates.length === 0
            ? 'missing-source'
            : candidates.length !== 1 || !candidates[0]!.identityUnique
              ? 'ambiguous-source'
              : 'convert',
      source: candidates.length === 1 ? candidates[0]! : null,
    }
  })

  const claimsBySource = new Map<SourceCandidate, LegacyClaim[]>()
  for (const claim of claims) {
    if (claim.resolution !== 'convert' || !claim.source) continue
    const entries = claimsBySource.get(claim.source) ?? []
    entries.push(claim)
    claimsBySource.set(claim.source, entries)
  }
  for (const [source, sourceClaims] of claimsBySource) {
    if (sourceClaims.length <= source.capacity) continue
    for (const claim of sourceClaims) {
      claim.resolution = 'ambiguous-source'
      claim.source = null
    }
  }

  let effectiveInstancesMigrated = 0
  let unresolvedEntriesCreated = existingUnresolvedCreated
  const allocatedBySource = new Map<SourceCandidate, number>()
  for (const owner of targetSheets) {
    const ownerClaims = claims.filter(claim => claim.owner === owner)
    const instanceIds = new Map<EquipmentSlotId, string>()
    const instances: MutableRecord[] = []
    const unresolved: MutableRecord[] = []
    for (const claim of ownerClaims) {
      const identitySeed = [owner.kind, owner.slug, claim.slotId, claim.legacyDisplayName]
      if (claim.resolution === 'convert' && claim.source && claim.canonicalItemId) {
        const operationId = `equipment-migration:v1:${digest32(...identitySeed, claim.source.instanceId)}`
        const instanceId = claim.source.serialized?.instanceId
          ?? `equipped-item:v1:${digest32(operationId, claim.canonicalItemId)}`
        instanceIds.set(claim.slotId, instanceId)
        instances.push({
          instanceId,
          revision: claim.source.serialized
            ? nextSerializedRevision(claim.source.serialized.revision)
            : 0,
          canonicalItemId: claim.canonicalItemId,
          canonicalRecordSha256: canonicalRecordSha256.get(claim.canonicalItemId),
          equipmentDefinitionSha256: null,
          source: {
            kind: 'inventory',
            containerKind: claim.source.container.kind,
            containerSlug: claim.source.container.slug,
            section: claim.source.section,
            rowId: claim.source.rowId,
            sourceInstanceId: claim.source.instanceId,
            sourceRevision: claim.source.container.originalRevision,
            quantity: 1,
          },
          configuration: claim.source.serialized?.configuration ?? null,
          serializedState: claim.source.serialized?.state ?? {},
          activity: {
            status: 'inactive',
            reasons: [{ code: 'equipment.definition-pending', sourceId: operationId }],
          },
          equippedByOperationId: operationId,
          equippedAt: Math.max(owner.originalUpdatedAt, claim.source.container.originalUpdatedAt),
        })
        allocatedBySource.set(claim.source, (allocatedBySource.get(claim.source) ?? 0) + 1)
        effectiveInstancesMigrated += 1
      }
      else {
        unresolved.push({
          issueId: `equipment-issue:v1:${digest32(...identitySeed, claim.resolution)}`,
          slotId: claim.slotId,
          legacyDisplayName: boundedLegacyText(claim.legacyDisplayName),
          reason: claim.resolution,
          candidateCanonicalItemIds: claim.canonicalItemId ? [claim.canonicalItemId] : [],
          candidateSourceInstanceIds: [...new Set(claim.candidates.map(candidate => candidate.instanceId))].sort(),
        })
        unresolvedEntriesCreated += 1
      }
    }
    const pendingState: SheetEquipmentStateV1 = parseSheetEquipmentStateForOwner({
      ...createEmptySheetEquipmentState({ ownerKind: owner.kind, ownerSlug: owner.slug }),
      slots: canonicalSlots(owner.kind).map(slotId => ({ slotId, instanceId: instanceIds.get(slotId) ?? null })),
      instances,
      unresolved,
    }, { kind: owner.kind, slug: owner.slug })
    const state = reconcileSheetEquipmentCompatibility({
      owner: compatibilityOwner(owner),
      equipmentState: pendingState,
      incrementStateRevision: false,
    }).state
    owner.document.equipmentState = state
    delete owner.document.equipmentProjection
    legacyValuesRetired += retireLegacyEffectiveValues(owner)
    owner.dirty = true
  }

  for (const [source, allocated] of allocatedBySource) {
    const sourceRows = rowsFor(source.container, source.section)
    const index = sourceRows.indexOf(source.row)
    if (index < 0) throw new Error('Equipment migration source row moved during deterministic planning.')
    if (source.section === 'equipment' || source.serialized || allocated === source.capacity) sourceRows.splice(index, 1)
    else source.row.qty = source.capacity - allocated
    inventory(source.container)[source.section] = sourceRows
    source.container.dirty = true
  }

  const changedSheets: Array<{ kind: EquipmentOwnerKind; slug: string }> = []
  const changedGroupInventories: string[] = []
  const updateSheet = connection.prepare(`
    UPDATE sheets
    SET document_json = ?, revision = ?, updated_at = ?
    WHERE kind = ? AND slug = ? AND revision = ?
  `)
  for (const sheet of sheets.filter(sheet => sheet.dirty)) {
    const revision = sheet.originalRevision + 1
    if (!Number.isSafeInteger(revision)) throw new Error(`${sheet.kind} sheet ${sheet.slug} revision cannot advance for equipment migration.`)
    const updatedAt = nextTimestamp(sheet.originalUpdatedAt, `${sheet.kind} sheet ${sheet.slug} updatedAt`)
    sheet.document.revision = revision
    sheet.document.updatedAt = updatedAt
    const result = updateSheet.run(JSON.stringify(sheet.document), revision, updatedAt, sheet.kind, sheet.slug, sheet.originalRevision)
    if (result.changes !== 1) throw new Error(`${sheet.kind} sheet ${sheet.slug} changed during equipment migration.`)
    changedSheets.push({ kind: sheet.kind, slug: sheet.slug })
  }
  const updateGroup = connection.prepare(`
    UPDATE group_inventories
    SET document_json = ?, revision = ?, updated_at = ?
    WHERE slug = ? AND revision = ?
  `)
  for (const group of groups.filter(group => group.dirty)) {
    const revision = group.originalRevision + 1
    if (!Number.isSafeInteger(revision)) throw new Error(`Group inventory ${group.slug} revision cannot advance for equipment migration.`)
    const updatedAt = nextTimestamp(group.originalUpdatedAt, `group inventory ${group.slug} updatedAt`)
    group.document.revision = revision
    group.document.updatedAt = updatedAt
    const result = updateGroup.run(JSON.stringify(group.document), revision, updatedAt, group.slug, group.originalRevision)
    if (result.changes !== 1) throw new Error(`Group inventory ${group.slug} changed during equipment migration.`)
    changedGroupInventories.push(group.slug)
  }

  return Object.freeze({
    sheetsExamined: sheets.length,
    sheetsInitialized: targetSheets.length,
    effectiveInstancesMigrated,
    unresolvedEntriesCreated,
    inventoryRowsGivenStableIdentity,
    legacyValuesRetired,
    sourceItemsMoved: [...allocatedBySource.values()].reduce((sum, value) => sum + value, 0),
    changedSheets: Object.freeze(changedSheets),
    changedGroupInventories: Object.freeze(changedGroupInventories),
  })
}

/** Idempotent document migration, intentionally separate from SQLite schema versioning. */
export const migrateLegacyEquipmentDocuments = (
  connection: DatabaseSync,
): LegacyEquipmentDocumentMigrationReport => {
  const started = !connection.isTransaction
  if (started) connection.exec('BEGIN IMMEDIATE')
  try {
    const report = migrateDocuments(connection)
    if (started) connection.exec('COMMIT')
    return report
  }
  catch (error) {
    if (started && connection.isTransaction) connection.exec('ROLLBACK')
    throw error
  }
}
