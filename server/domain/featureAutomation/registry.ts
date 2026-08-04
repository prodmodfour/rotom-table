import { createHash } from 'node:crypto'
import specsJson from '../../../data/feature-automation/specs.json'
import { CANONICAL_FEATURE_IDS } from '#shared/featureAutomation/catalog'
import { FEATURE_AUTOMATION_MANIFEST_BY_ID, type FeatureAutomationManifestEntry } from '#shared/featureAutomation/manifest'
import type { FeatureMechanicDeclaration, FeatureMechanicKind, FeatureRuntimeDefinition, FeatureRuntimeRegistry, FeatureRuntimeSpec } from '#shared/featureAutomation/spec'
import { stableJsonStringify } from '#shared/automation/stableJson'

interface FrozenSpecRow {
  readonly canonicalId: string
  readonly version: 1
  readonly sourceEffectSha256: string
  readonly frequency: FeatureRuntimeSpec['frequency']
}
const frozen = specsJson as unknown as { schemaVersion: 1, entryCount: 444, entries: readonly FrozenSpecRow[] }
if (frozen.schemaVersion !== 1 || frozen.entryCount !== 444 || frozen.entries.length !== 444) throw new Error('Frozen Feature specs are incomplete.')
const frozenById = new Map(frozen.entries.map(entry => [entry.canonicalId, entry]))

const mechanicKind = (role: FeatureAutomationManifestEntry['roles'][number]): FeatureMechanicKind => {
  if (role === 'permanent-grant') return 'permanent-grant'
  if (role === 'triggered-automatic' || role === 'triggered-optional' || role === 'interrupt-reaction') return 'event-subscription'
  if (role === 'class-anchor' || role === 'branch-anchor' || role === 'ranked-progression' || role === 'classification-only') return 'class-progression'
  if (role === 'campaign-operation' || role === 'crafting-or-research' || role === 'training-operation') return 'campaign-operation'
  if (role === 'activated-action' || role === 'orders-action' || role === 'stratagem' || role === 'contextual-affordance') return 'action-provider'
  return 'passive-provider'
}
const operation = (kind: FeatureMechanicKind): FeatureMechanicDeclaration['operation'] => kind === 'permanent-grant'
  ? 'grant' : kind === 'event-subscription' ? 'subscribe' : kind === 'class-progression' ? 'classify' : kind === 'campaign-operation' || kind === 'action-provider' ? 'permit' : 'add'
const slug = (value: string): string => value.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const sha = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')

const build = (entry: FeatureAutomationManifestEntry): FeatureRuntimeDefinition => {
  const source = frozenById.get(entry.canonicalId)
  if (!source || source.sourceEffectSha256 !== entry.sourceEffectSha256) throw new Error(`Feature ${entry.canonicalId} has stale frozen semantics.`)
  const mechanics = entry.roles.map((role, index): FeatureMechanicDeclaration => {
    const kind = mechanicKind(role)
    return Object.freeze({
      mechanicId: `${slug(entry.canonicalId)}:${index + 1}:${role}`,
      kind,
      propertyId: `feature.${slug(entry.canonicalId)}.${role}`,
      operation: operation(kind),
      contextId: entry.actions.length ? entry.actions[0]!.domain : 'always',
      parameters: Object.freeze({ className: entry.className, tags: Object.freeze([...entry.tags]) }),
    })
  })
  const spec: FeatureRuntimeSpec = Object.freeze({
    schemaVersion: 1, canonicalId: entry.canonicalId, sourceEffectSha256: entry.sourceEffectSha256,
    roles: entry.roles, frequency: source.frequency, mechanics: Object.freeze(mechanics), actions: entry.actions,
    registeredHandlerId: 'feature.native.v1',
  })
  return Object.freeze({ canonicalId: entry.canonicalId, definitionHash: sha(spec), spec })
}

const definitions = Object.freeze(CANONICAL_FEATURE_IDS.map(id => build(FEATURE_AUTOMATION_MANIFEST_BY_ID.get(id)!)))
const byId = new Map(definitions.map(definition => [definition.canonicalId, definition]))
if (byId.size !== 444) throw new Error('Feature runtime registry must cover all 444 rows.')

export const FEATURE_AUTOMATION_RUNTIME_REGISTRY: FeatureRuntimeRegistry = Object.freeze({
  definitions,
  resolve: (canonicalId: string) => byId.get(canonicalId) ?? null,
  require: (canonicalId: string) => {
    const definition = byId.get(canonicalId)
    if (!definition) throw new Error(`Feature ${canonicalId} is not registered.`)
    return definition
  },
})
