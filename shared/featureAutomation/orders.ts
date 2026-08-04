import ordersJson from '../../data/feature-automation/orders.json'
import { FEATURE_AUTOMATION_MANIFEST_BY_ID } from './manifest'

export interface FeatureGrantedOrderDefinition {
  readonly name: string
  readonly tags: readonly string[]
  readonly frequency: string | null
  readonly trigger: string | null
  readonly target: string | null
  readonly condition: string | null
  readonly effect: string | null
}
export interface FeatureGrantedOrderSource {
  readonly sourceCanonicalId: string
  readonly sourceEffectSha256: string
  readonly orders: readonly FeatureGrantedOrderDefinition[]
}
const catalog = ordersJson as unknown as { schemaVersion: 1, entryCount: number, orderCount: number, entries: readonly FeatureGrantedOrderSource[] }
if (catalog.schemaVersion !== 1 || catalog.entryCount !== catalog.entries.length || catalog.orderCount !== catalog.entries.reduce((sum, entry) => sum + entry.orders.length, 0)) throw new Error('Feature granted Order catalog is malformed.')
for (const entry of catalog.entries) if (FEATURE_AUTOMATION_MANIFEST_BY_ID.get(entry.sourceCanonicalId)?.sourceEffectSha256 !== entry.sourceEffectSha256 || !entry.orders.length) throw new Error(`Feature granted Orders for ${entry.sourceCanonicalId} are stale.`)
export const FEATURE_GRANTED_ORDER_SOURCES = Object.freeze(catalog.entries)
export const FEATURE_GRANTED_ORDERS_BY_SOURCE: ReadonlyMap<string, readonly FeatureGrantedOrderDefinition[]> = new Map(catalog.entries.map(entry => [entry.sourceCanonicalId, Object.freeze(entry.orders)]))
