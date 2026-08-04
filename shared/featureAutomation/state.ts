export const FEATURE_USAGE_SCHEMA_VERSION = 1 as const
export interface FeatureUsageLedgerEntry {
  readonly sourceInstanceId: string
  readonly canonicalId: string
  readonly scope: 'turn' | 'round' | 'scene' | 'day' | 'campaign' | 'target'
  readonly scopeId: string
  readonly uses: number
  readonly targetId?: string
  readonly updatedAt: number
}
export interface FeatureUsageLedger {
  readonly schemaVersion: 1
  readonly entries: readonly FeatureUsageLedgerEntry[]
}

export interface FeatureApBinding {
  readonly bindingId: string
  readonly sourceInstanceId: string
  readonly canonicalId: string
  readonly amount: number
  readonly release: 'manual' | 'scene-end' | 'source-loss' | 'effect-end' | 'extended-rest'
  readonly createdAt: number
}
export interface FeatureApDrain {
  readonly drainId: string
  readonly sourceInstanceId: string
  readonly canonicalId: string
  readonly amount: number
  readonly recovery: 'extended-rest' | 'campaign-boundary'
  readonly createdAt: number
}
export interface FeatureTemporaryAp {
  readonly grantId: string
  readonly sourceInstanceId: string
  readonly amount: number
  readonly expiresAtRound: number | null
  readonly expiresAt: number | null
}
export interface FeatureApState {
  readonly schemaVersion: 1
  readonly max: number
  readonly spent: number
  readonly bindings: readonly FeatureApBinding[]
  readonly drains: readonly FeatureApDrain[]
  readonly temporary: readonly FeatureTemporaryAp[]
}

export interface FeatureExecutionReceipt {
  readonly requestId: string
  readonly requestHash: string
  readonly canonicalId: string
  readonly sourceInstanceId: string
  readonly acceptedAt: number
}
export interface FeaturePendingWorkflow {
  readonly workflowId: string
  readonly requestId: string
  readonly sourceInstanceId: string
  readonly canonicalId: string
  readonly kind: 'choice' | 'reaction' | 'adjudication' | 'campaign'
  readonly status: 'pending' | 'passed' | 'cancelled' | 'expired' | 'resolved'
  readonly allowedResponderIds: readonly string[]
  readonly boundedOptionIds: readonly string[]
  readonly createdAt: number
  readonly expiresAt: number | null
}
export interface FeatureRuntimeState {
  readonly schemaVersion: 1
  readonly receipts: readonly FeatureExecutionReceipt[]
  readonly pending: readonly FeaturePendingWorkflow[]
}

const whole = (value: unknown): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
const stableId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(value)
const boundedText = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
export const normalizedFeatureUsageLedger = (value: unknown): FeatureUsageLedger => {
  const rows = value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as { entries?: unknown }).entries)
    ? (value as { entries: unknown[] }).entries : []
  const entries = rows.slice(0, 4096).flatMap((candidate): FeatureUsageLedgerEntry[] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const row = candidate as Record<string, unknown>
    if (typeof row.sourceInstanceId !== 'string' || typeof row.canonicalId !== 'string' || typeof row.scopeId !== 'string') return []
    const scope = row.scope
    if (!['turn', 'round', 'scene', 'day', 'campaign', 'target'].includes(String(scope))) return []
    return [Object.freeze({ sourceInstanceId: row.sourceInstanceId, canonicalId: row.canonicalId, scope: scope as FeatureUsageLedgerEntry['scope'], scopeId: row.scopeId, uses: whole(row.uses), ...(typeof row.targetId === 'string' ? { targetId: row.targetId } : {}), updatedAt: whole(row.updatedAt) })]
  })
  return Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries) })
}

export const normalizedFeatureApState = (value: unknown, maximum: number): FeatureApState => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as { schemaVersion?: unknown }).schemaVersion !== 1) return emptyFeatureApState(maximum)
  const row = value as Record<string, unknown>
  const bindings = (Array.isArray(row.bindings) ? row.bindings : []).slice(0, 1024).flatMap((candidate): FeatureApBinding[] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const binding = candidate as Record<string, unknown>
    if (!stableId(binding.bindingId) || !stableId(binding.sourceInstanceId) || typeof binding.canonicalId !== 'string' || !['manual', 'scene-end', 'source-loss', 'effect-end', 'extended-rest'].includes(String(binding.release))) return []
    const amount = whole(binding.amount); if (amount < 1) return []
    return [Object.freeze({ bindingId: binding.bindingId, sourceInstanceId: binding.sourceInstanceId, canonicalId: binding.canonicalId, amount, release: binding.release as FeatureApBinding['release'], createdAt: whole(binding.createdAt) })]
  })
  const drains = (Array.isArray(row.drains) ? row.drains : []).slice(0, 1024).flatMap((candidate): FeatureApDrain[] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const drain = candidate as Record<string, unknown>
    if (!stableId(drain.drainId) || !stableId(drain.sourceInstanceId) || typeof drain.canonicalId !== 'string' || !['extended-rest', 'campaign-boundary'].includes(String(drain.recovery))) return []
    const amount = whole(drain.amount); if (amount < 1) return []
    return [Object.freeze({ drainId: drain.drainId, sourceInstanceId: drain.sourceInstanceId, canonicalId: drain.canonicalId, amount, recovery: drain.recovery as FeatureApDrain['recovery'], createdAt: whole(drain.createdAt) })]
  })
  const temporary = (Array.isArray(row.temporary) ? row.temporary : []).slice(0, 1024).flatMap((candidate): FeatureTemporaryAp[] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const grant = candidate as Record<string, unknown>
    if (!stableId(grant.grantId) || !stableId(grant.sourceInstanceId)) return []
    const amount = whole(grant.amount); if (amount < 1) return []
    return [Object.freeze({ grantId: grant.grantId, sourceInstanceId: grant.sourceInstanceId, amount, expiresAtRound: grant.expiresAtRound === null ? null : whole(grant.expiresAtRound), expiresAt: grant.expiresAt === null ? null : whole(grant.expiresAt) })]
  })
  return Object.freeze({ schemaVersion: 1, max: whole(maximum), spent: whole(row.spent), bindings: Object.freeze(bindings), drains: Object.freeze(drains), temporary: Object.freeze(temporary) })
}

export const featureApBound = (state: FeatureApState): number => state.bindings.reduce((sum, binding) => sum + whole(binding.amount), 0)
export const featureApDrained = (state: FeatureApState): number => state.drains.reduce((sum, drain) => sum + whole(drain.amount), 0)
export const featureTemporaryApAvailable = (state: FeatureApState, now: number, round: number | null): number => state.temporary
  .filter(grant => (grant.expiresAt === null || grant.expiresAt > now) && (grant.expiresAtRound === null || round === null || grant.expiresAtRound > round))
  .reduce((sum, grant) => sum + whole(grant.amount), 0)
export const featureApAvailable = (state: FeatureApState, now: number, round: number | null): number => Math.max(0, whole(state.max) - whole(state.spent) - featureApBound(state) - featureApDrained(state) + featureTemporaryApAvailable(state, now, round))

export const emptyFeatureUsageLedger = (): FeatureUsageLedger => Object.freeze({ schemaVersion: 1, entries: Object.freeze([]) })
export const emptyFeatureApState = (max: number): FeatureApState => Object.freeze({ schemaVersion: 1, max: whole(max), spent: 0, bindings: Object.freeze([]), drains: Object.freeze([]), temporary: Object.freeze([]) })
export const emptyFeatureRuntimeState = (): FeatureRuntimeState => Object.freeze({ schemaVersion: 1, receipts: Object.freeze([]), pending: Object.freeze([]) })

export const normalizedFeatureRuntimeState = (value: unknown): FeatureRuntimeState => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as { schemaVersion?: unknown }).schemaVersion !== 1) return emptyFeatureRuntimeState()
  const row = value as { receipts?: unknown, pending?: unknown }
  const receipts = (Array.isArray(row.receipts) ? row.receipts : []).slice(-4096).flatMap((candidate): FeatureExecutionReceipt[] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const receipt = candidate as Record<string, unknown>
    if (!stableId(receipt.requestId) || typeof receipt.requestHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.requestHash) || typeof receipt.canonicalId !== 'string' || !stableId(receipt.sourceInstanceId)) return []
    return [Object.freeze({ requestId: receipt.requestId, requestHash: receipt.requestHash, canonicalId: receipt.canonicalId, sourceInstanceId: receipt.sourceInstanceId, acceptedAt: whole(receipt.acceptedAt) })]
  })
  const pending = (Array.isArray(row.pending) ? row.pending : []).slice(-1024).flatMap((candidate): FeaturePendingWorkflow[] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const workflow = candidate as Record<string, unknown>
    if (!stableId(workflow.workflowId) || !stableId(workflow.requestId) || !stableId(workflow.sourceInstanceId) || typeof workflow.canonicalId !== 'string' || !['choice', 'reaction', 'adjudication', 'campaign'].includes(String(workflow.kind)) || !['pending', 'passed', 'cancelled', 'expired', 'resolved'].includes(String(workflow.status))) return []
    const responders = Array.isArray(workflow.allowedResponderIds) ? workflow.allowedResponderIds.filter(stableId).slice(0, 64) : []
    const options = Array.isArray(workflow.boundedOptionIds) ? workflow.boundedOptionIds.filter(boundedText).slice(0, 128) : []
    const expiresAt = workflow.expiresAt === null ? null : whole(workflow.expiresAt)
    return [Object.freeze({ workflowId: workflow.workflowId, requestId: workflow.requestId, sourceInstanceId: workflow.sourceInstanceId, canonicalId: workflow.canonicalId, kind: workflow.kind as FeaturePendingWorkflow['kind'], status: workflow.status as FeaturePendingWorkflow['status'], allowedResponderIds: Object.freeze(responders), boundedOptionIds: Object.freeze(options), createdAt: whole(workflow.createdAt), expiresAt })]
  })
  return Object.freeze({ schemaVersion: 1, receipts: Object.freeze(receipts), pending: Object.freeze(pending) })
}
