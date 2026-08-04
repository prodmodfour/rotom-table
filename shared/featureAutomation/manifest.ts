import manifestJson from '../../data/feature-automation/manifest.json'
import { CANONICAL_FEATURE_IDS, isCanonicalFeatureId } from './catalog'
import { FEATURE_AUTOMATION_RULESET_ID } from './ruleset'

export const FEATURE_AUTOMATION_ROLES = [
  'class-anchor', 'branch-anchor', 'ranked-progression', 'passive-provider',
  'permanent-grant', 'activated-action', 'orders-action', 'training-operation',
  'stratagem', 'weapon-provider', 'triggered-automatic', 'triggered-optional',
  'interrupt-reaction', 'contextual-affordance', 'campaign-operation',
  'crafting-or-research', 'gm-adjudicated', 'classification-only',
] as const
export type FeatureAutomationRole = typeof FEATURE_AUTOMATION_ROLES[number]

export const FEATURE_CHOICE_KINDS = [
  'ability', 'contest-stat', 'edge', 'equipment-slot', 'feature', 'feature-or-edge',
  'move', 'research-field', 'species', 'stat', 'terrain', 'training-feature', 'type',
  'skill', 'damage-class', 'taste',
] as const
export type FeatureChoiceKind = typeof FEATURE_CHOICE_KINDS[number]

export interface FeatureChoiceDefinition {
  readonly id: string
  readonly kind: FeatureChoiceKind
  readonly minimum: number
  readonly maximum: number
  /** Cardinality is multiplied by the owned Feature rank. */
  readonly perRank?: boolean
  /** Values selected by choices in the same group must be globally distinct. */
  readonly distinctGroup?: string
  readonly options?: readonly string[]
}

export interface FeatureFrequencyDefinition {
  readonly source: string
  readonly mode: 'static' | 'at-will' | 'scene' | 'daily' | 'eot' | 'one-time' | 'special'
  readonly uses: number | null
  readonly action: 'full' | 'standard' | 'shift' | 'swift' | 'free' | 'extended' | 'special' | null
  readonly modifiers: readonly string[]
  readonly payment: {
    readonly mode: 'spend' | 'bind' | 'drain'
    readonly amount: number | null
    readonly variable: boolean
    readonly phase: 'declaration'
  } | null
}

export interface FeatureActionChoiceDefinition {
  readonly id: string
  readonly minimum: number
  readonly maximum: number
  readonly authority: 'server-offered'
}

export interface FeatureActionDefinition {
  readonly id: 'execute'
  readonly domain: 'encounter' | 'orders' | 'campaign'
  readonly timing: string
  readonly triggered: boolean
  readonly targetRequired: boolean
  readonly conditionRequired: boolean
  readonly choices: readonly FeatureActionChoiceDefinition[]
  readonly frequency: FeatureFrequencyDefinition
  readonly operation: 'feature-native-v1'
}

export interface FeatureAutomationManifestEntry {
  readonly canonicalId: string
  readonly status: 'complete'
  readonly className: string | null
  readonly tags: readonly string[]
  readonly roles: readonly FeatureAutomationRole[]
  readonly choices: readonly FeatureChoiceDefinition[]
  readonly actions: readonly FeatureActionDefinition[]
  readonly sourceRecordSha256: string
  readonly sourceEffectSha256: string
  readonly runtimeHandlerId: 'feature.native.v1'
  readonly serverAuthoritative: true
  readonly legacyExecutionAllowed: false
}

export interface FeatureAutomationManifest {
  readonly schemaVersion: 1
  readonly rulesetId: typeof FEATURE_AUTOMATION_RULESET_ID
  readonly entryCount: 444
  readonly entries: readonly FeatureAutomationManifestEntry[]
}

const sha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const raw = manifestJson as unknown as FeatureAutomationManifest
if (raw.schemaVersion !== 1 || raw.rulesetId !== FEATURE_AUTOMATION_RULESET_ID || raw.entryCount !== 444 || raw.entries.length !== 444) {
  throw new Error('Feature automation manifest must cover all 444 rows.')
}
const roleSet = new Set<string>(FEATURE_AUTOMATION_ROLES)
const choiceKindSet = new Set<string>(FEATURE_CHOICE_KINDS)
const seen = new Set<string>()
for (const entry of raw.entries) {
  if (!isCanonicalFeatureId(entry.canonicalId) || seen.has(entry.canonicalId) || entry.status !== 'complete'
    || entry.runtimeHandlerId !== 'feature.native.v1' || entry.serverAuthoritative !== true
    || entry.legacyExecutionAllowed !== false || !sha(entry.sourceRecordSha256) || !sha(entry.sourceEffectSha256)
    || !entry.roles.length || entry.roles.some(role => !roleSet.has(role))
    || entry.choices.some(choice => !choiceKindSet.has(choice.kind) || choice.minimum < 0 || choice.maximum < choice.minimum || (choice.perRank !== undefined && typeof choice.perRank !== 'boolean'))) {
    throw new Error(`Invalid Feature automation manifest row: ${entry.canonicalId || '<unknown>'}`)
  }
  seen.add(entry.canonicalId)
}
if (CANONICAL_FEATURE_IDS.some(id => !seen.has(id))) throw new Error('Feature automation manifest omits canonical identities.')

export const FEATURE_AUTOMATION_MANIFEST = Object.freeze(raw)
export const FEATURE_AUTOMATION_MANIFEST_BY_ID: ReadonlyMap<string, FeatureAutomationManifestEntry> = new Map(raw.entries.map(entry => [entry.canonicalId, Object.freeze(entry)]))
