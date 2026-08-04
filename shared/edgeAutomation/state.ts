import type { EdgeFamily } from './catalog'

export const EDGE_USAGE_LEDGER_SCHEMA_VERSION = 1 as const
export const EDGE_USAGE_ENTRY_LIMIT = 256 as const

export type EdgeUsageScope = 'turn' | 'round' | 'scene' | 'day' | 'target' | 'once'

export interface EdgeUsageEntry {
  readonly usageId: string
  readonly edgeInstanceId: string
  readonly actionId: string
  readonly scope: EdgeUsageScope
  readonly scopeId: string
  readonly targetId: string | null
  readonly count: number
  readonly sourceOperationIds: readonly string[]
}

export interface EdgeUsageLedger {
  readonly schemaVersion: typeof EDGE_USAGE_LEDGER_SCHEMA_VERSION
  readonly entries: readonly EdgeUsageEntry[]
}

export interface EdgePermanentGrantProvenance {
  readonly schemaVersion: 1
  readonly family: EdgeFamily
  readonly edgeInstanceId: string
  readonly canonicalId: string
  readonly definitionHash: string
  readonly grantId: string
  readonly sourceOperationId: string
}

export interface EdgeCampaignOperationHandoff {
  readonly schemaVersion: 1
  readonly capabilityId: string
  readonly contractId: string
  readonly edgeInstanceId: string
  readonly trainerSlug: string
  readonly contributionEvidenceIds: readonly string[]
  readonly definitionHash: string
  readonly available: boolean
  readonly unavailableReason: 'downstream-capability-unavailable' | null
}

type UnknownRecord = Record<string, unknown>
const stable = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(value) || value.length > 200) throw new Error(`${path} must be a stable ID.`)
  return value
}

export const createEmptyEdgeUsageLedger = (): EdgeUsageLedger => Object.freeze({ schemaVersion: 1, entries: Object.freeze([]) })

export const parseEdgeUsageLedger = (value: unknown): EdgeUsageLedger => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('edgeUsage must be an object.')
  const root = value as UnknownRecord
  if (root.schemaVersion !== 1 || !Array.isArray(root.entries) || root.entries.length > EDGE_USAGE_ENTRY_LIMIT) throw new Error('edgeUsage has an unsupported version or size.')
  const keys = new Set<string>()
  const entries = root.entries.map((candidate, index): EdgeUsageEntry => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error(`edgeUsage.entries[${index}] must be an object.`)
    const row = candidate as UnknownRecord
    const scope = row.scope
    if (!['turn', 'round', 'scene', 'day', 'target', 'once'].includes(String(scope))) throw new Error(`edgeUsage.entries[${index}].scope is invalid.`)
    if (!Number.isSafeInteger(row.count) || (row.count as number) < 0 || (row.count as number) > 1_000) throw new Error(`edgeUsage.entries[${index}].count is invalid.`)
    if (!Array.isArray(row.sourceOperationIds) || row.sourceOperationIds.length > 64) throw new Error(`edgeUsage.entries[${index}].sourceOperationIds is invalid.`)
    const entry = Object.freeze({
      usageId: stable(row.usageId, `edgeUsage.entries[${index}].usageId`),
      edgeInstanceId: stable(row.edgeInstanceId, `edgeUsage.entries[${index}].edgeInstanceId`),
      actionId: stable(row.actionId, `edgeUsage.entries[${index}].actionId`),
      scope: scope as EdgeUsageScope,
      scopeId: stable(row.scopeId, `edgeUsage.entries[${index}].scopeId`),
      targetId: row.targetId === null ? null : stable(row.targetId, `edgeUsage.entries[${index}].targetId`),
      count: row.count as number,
      sourceOperationIds: Object.freeze(row.sourceOperationIds.map((id, operationIndex) => stable(id, `edgeUsage.entries[${index}].sourceOperationIds[${operationIndex}]`))),
    })
    const key = `${entry.edgeInstanceId}:${entry.actionId}:${entry.scope}:${entry.scopeId}:${entry.targetId ?? ''}`
    if (keys.has(key)) throw new Error(`edgeUsage.entries[${index}] duplicates a usage identity.`)
    keys.add(key)
    return entry
  })
  return Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries) })
}

export const recordEdgeUsage = (input: {
  readonly ledger: EdgeUsageLedger | null | undefined
  readonly edgeInstanceId: string
  readonly actionId: string
  readonly scope: EdgeUsageScope
  readonly scopeId: string
  readonly targetId?: string | null
  readonly operationId: string
}): EdgeUsageLedger => {
  const ledger = parseEdgeUsageLedger(input.ledger ?? createEmptyEdgeUsageLedger())
  const targetId = input.targetId ?? null
  const index = ledger.entries.findIndex(entry => entry.edgeInstanceId === input.edgeInstanceId
    && entry.actionId === input.actionId && entry.scope === input.scope
    && entry.scopeId === input.scopeId && entry.targetId === targetId)
  const entries = [...ledger.entries]
  if (index < 0) {
    entries.push({
      usageId: `edge-usage:${input.edgeInstanceId}:${input.actionId}:${input.scope}:${input.scopeId}:${targetId ?? 'none'}`,
      edgeInstanceId: input.edgeInstanceId,
      actionId: input.actionId,
      scope: input.scope,
      scopeId: input.scopeId,
      targetId,
      count: 1,
      sourceOperationIds: [input.operationId],
    })
  }
  else if (!entries[index]!.sourceOperationIds.includes(input.operationId)) {
    const previous = entries[index]!
    entries[index] = { ...previous, count: previous.count + 1, sourceOperationIds: [...previous.sourceOperationIds, input.operationId] }
  }
  return parseEdgeUsageLedger({ schemaVersion: 1, entries })
}
