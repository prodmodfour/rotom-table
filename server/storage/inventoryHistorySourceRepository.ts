import type { StoredInventoryActionOperation } from './inventoryActionOperationRepository'
import { createSqliteInventoryActionOperationRepository } from './inventoryActionOperationRepository'
import type { StoredEquipmentOperationRecord } from './equipmentOperationRepository'
import { createSqliteEquipmentOperationRepository } from './equipmentOperationRepository'
import type { StoredItemGuidedRequestRecord } from './itemGuidedRequestRepository'
import { createSqliteItemGuidedRequestRepository } from './itemGuidedRequestRepository'
import type { StoredItemOperationRecord } from './itemOperationRepository'
import { createSqliteItemOperationRepository } from './itemOperationRepository'
import type { SqliteShopCheckoutOperationRecord } from './shopCheckoutOperationRepository'
import { createSqliteShopCheckoutOperationRepository } from './shopCheckoutOperationRepository'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface InventoryHistorySourceScope {
  readonly kind: 'trainer' | 'group'
  readonly slug: string
  readonly linkedPokemonSlugs?: readonly string[]
}

export interface InventoryHistoryItemOperationSource {
  readonly record: StoredItemOperationRecord
  readonly guidedRequest: StoredItemGuidedRequestRecord | null
  readonly correctionOrigin: StoredItemOperationRecord | null
}

export interface InventoryHistorySourceBatch {
  readonly shopCheckouts: readonly SqliteShopCheckoutOperationRecord[]
  readonly inventoryActions: readonly StoredInventoryActionOperation[]
  readonly equipmentOperations: readonly StoredEquipmentOperationRecord[]
  readonly itemOperations: readonly InventoryHistoryItemOperationSource[]
  readonly guidedRequests: readonly StoredItemGuidedRequestRecord[]
  readonly sourceTruncated: boolean
}

export interface InventoryHistorySourceRepository {
  readonly database: RotomDatabase
  readonly listRecent: (scope: InventoryHistorySourceScope, perSourceLimit: number) => InventoryHistorySourceBatch
}

interface IdRow {
  readonly id: unknown
  readonly secondary_id?: unknown
}

const validateLimit = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new Error('Inventory history source limit must be from 1 through 50.')
  }
  return value
}

const boundedIds = (
  database: RotomDatabase,
  sql: string,
  params: readonly (string | number)[],
  limit: number,
): { readonly rows: readonly IdRow[], readonly truncated: boolean } => {
  const rows = database.connection.prepare(sql).all(...params, limit + 1) as unknown as IdRow[]
  return Object.freeze({ rows: Object.freeze(rows.slice(0, limit)), truncated: rows.length > limit })
}

const requiredId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is malformed.`)
  return value
}

const sheetScopePredicate = (scope: InventoryHistorySourceScope): {
  readonly sql: string
  readonly params: readonly string[]
} => {
  const pokemon = [...new Set(scope.linkedPokemonSlugs ?? [])]
  const pokemonClause = pokemon.length
    ? ` OR (json_extract(resource.value, '$.sheetKind') = 'pokemon'
          AND json_extract(resource.value, '$.slug') IN (${pokemon.map(() => '?').join(', ')}))`
    : ''
  return Object.freeze({
    sql: `(json_extract(resource.value, '$.sheetKind') = 'trainer'
        AND json_extract(resource.value, '$.slug') = ?)${pokemonClause}`,
    params: Object.freeze([scope.slug, ...pokemon]),
  })
}

export const createSqliteInventoryHistorySourceRepository = (
  database: RotomDatabase = getRotomDatabase(),
): InventoryHistorySourceRepository => {
  const shops = createSqliteShopCheckoutOperationRepository({ database })
  const inventoryActions = createSqliteInventoryActionOperationRepository(database)
  const equipment = createSqliteEquipmentOperationRepository({ database })
  const items = createSqliteItemOperationRepository({ database })
  const guided = createSqliteItemGuidedRequestRepository({ database })

  const listRecent = (scope: InventoryHistorySourceScope, perSourceLimitInput: number): InventoryHistorySourceBatch => {
    const perSourceLimit = validateLimit(perSourceLimitInput)
    const checkoutTargetKind = scope.kind === 'trainer' ? 'trainer' : 'groupInventory'
    const checkoutIds = boundedIds(database, `
      SELECT op_id AS id, shop_slug AS secondary_id
      FROM shop_checkout_ops
      WHERE json_extract(result_json, '$.ok') = 1
        AND json_extract(command_json, '$.payload.deliveryTarget.kind') = ?
        AND json_extract(command_json, '$.payload.deliveryTarget.slug') = ?
      ORDER BY created_at DESC, op_id DESC
      LIMIT ?
    `, [checkoutTargetKind, scope.slug], perSourceLimit)

    const acceptedResourcePath = scope.kind === 'trainer' ? '$.sheets' : '$.groupInventories'
    const acceptedKindPredicate = scope.kind === 'trainer'
      ? "json_extract(resource.value, '$.kind') = 'trainer' AND"
      : ''
    const inventoryActionIds = boundedIds(database, `
      SELECT operation_id AS id
      FROM inventory_action_operations
      WHERE status = 'accepted' AND result_json IS NOT NULL
        AND action_kind IN ('transfer', 'discard')
        AND EXISTS (
          SELECT 1 FROM json_each(result_json, '${acceptedResourcePath}') AS resource
          WHERE ${acceptedKindPredicate} json_extract(resource.value, '$.slug') = ?
        )
      ORDER BY updated_at DESC, operation_id DESC
      LIMIT ?
    `, [scope.slug], perSourceLimit)

    let equipmentIds: ReturnType<typeof boundedIds>
    if (scope.kind === 'group') {
      equipmentIds = boundedIds(database, `
        SELECT operation_id AS id
        FROM equipment_operations
        WHERE EXISTS (
          SELECT 1 FROM json_each(result_json, '$.resources') AS resource
          WHERE json_extract(resource.value, '$.kind') = 'group-inventory'
            AND json_extract(resource.value, '$.slug') = ?
        )
        ORDER BY created_at DESC, operation_id DESC
        LIMIT ?
      `, [scope.slug], perSourceLimit)
    }
    else {
      const predicate = sheetScopePredicate(scope)
      equipmentIds = boundedIds(database, `
        SELECT operation_id AS id
        FROM equipment_operations
        WHERE EXISTS (
          SELECT 1 FROM json_each(result_json, '$.resources') AS resource
          WHERE json_extract(resource.value, '$.kind') = 'sheet'
            AND (${predicate.sql})
        )
        ORDER BY created_at DESC, operation_id DESC
        LIMIT ?
      `, predicate.params, perSourceLimit)
    }

    const itemScopeKeys = scope.kind === 'group'
      ? [scope.slug]
      : [`trainer:${scope.slug}`, ...[...new Set(scope.linkedPokemonSlugs ?? [])].map(slug => `pokemon:${slug}`)]
    const itemScopeKind = scope.kind === 'group' ? 'group-inventory' : 'sheet'
    const itemIds = boundedIds(database, `
      SELECT operation.operation_id AS id
      FROM item_operations AS operation
      WHERE operation.status IN ('accepted', 'corrected')
        AND EXISTS (
          SELECT 1 FROM item_operation_scopes AS scope
          WHERE scope.operation_id = operation.operation_id
            AND scope.scope_kind = ?
            AND scope.scope_key IN (${itemScopeKeys.map(() => '?').join(', ')})
        )
      ORDER BY operation.updated_at DESC, operation.operation_id DESC
      LIMIT ?
    `, [itemScopeKind, ...itemScopeKeys], perSourceLimit)

    let guidedIds: ReturnType<typeof boundedIds> = Object.freeze({ rows: Object.freeze([]), truncated: false })
    if (scope.kind === 'trainer') {
      const linked = [...new Set(scope.linkedPokemonSlugs ?? [])]
      const linkedClause = linked.length
        ? ` OR (actor_kind = 'pokemon' AND actor_slug IN (${linked.map(() => '?').join(', ')}))
            OR (target_kind = 'pokemon' AND target_slug IN (${linked.map(() => '?').join(', ')}))`
        : ''
      guidedIds = boundedIds(database, `
        SELECT request_id AS id
        FROM item_guided_requests
        WHERE status = 'accepted' AND item_operation_id IS NULL
          AND ((actor_kind = 'trainer' AND actor_slug = ?)
            OR (target_kind = 'trainer' AND target_slug = ?)
            ${linkedClause})
        ORDER BY updated_at DESC, request_id DESC
        LIMIT ?
      `, [scope.slug, scope.slug, ...linked, ...linked], perSourceLimit)
    }

    const shopCheckouts = checkoutIds.rows.map(row => {
      const opId = requiredId(row.id, 'Inventory history checkout operation identity')
      const shopSlug = requiredId(row.secondary_id, 'Inventory history checkout shop identity')
      return shops.getStoredOperation(shopSlug, opId)
        ?? (() => { throw new Error('Inventory history checkout source disappeared during projection.') })()
    })
    const storedInventoryActions = inventoryActionIds.rows.map(row => inventoryActions.find(
      requiredId(row.id, 'Inventory history action identity'),
    ) ?? (() => { throw new Error('Inventory history action source disappeared during projection.') })())
    const equipmentOperations = equipmentIds.rows.map(row => equipment.get(
      requiredId(row.id, 'Inventory history equipment identity'),
    ) ?? (() => { throw new Error('Inventory history equipment source disappeared during projection.') })())
    const itemOperations = itemIds.rows.map((row): InventoryHistoryItemOperationSource => {
      const record = items.get(requiredId(row.id, 'Inventory history item identity'))
        ?? (() => { throw new Error('Inventory history item source disappeared during projection.') })()
      return Object.freeze({
        record,
        guidedRequest: record.status === 'accepted' ? guided.getByItemOperation(record.operationId) : null,
        correctionOrigin: record.correctionOfOperationId ? items.get(record.correctionOfOperationId) : null,
      })
    })
    const guidedRequests = guidedIds.rows.map(row => guided.get(
      requiredId(row.id, 'Inventory history guided request identity'),
    ) ?? (() => { throw new Error('Inventory history guided source disappeared during projection.') })())

    return Object.freeze({
      shopCheckouts: Object.freeze(shopCheckouts),
      inventoryActions: Object.freeze(storedInventoryActions),
      equipmentOperations: Object.freeze(equipmentOperations),
      itemOperations: Object.freeze(itemOperations),
      guidedRequests: Object.freeze(guidedRequests),
      sourceTruncated: checkoutIds.truncated || inventoryActionIds.truncated
        || equipmentIds.truncated || itemIds.truncated || guidedIds.truncated,
    })
  }

  return Object.freeze({ database, listRecent })
}
