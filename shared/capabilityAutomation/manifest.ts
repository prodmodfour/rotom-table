import manifestJson from '../../data/capability-automation/manifest.json'
import { CANONICAL_CAPABILITY_IDS, isCanonicalCapabilityId } from './catalog'
import {
  CAPABILITY_AUTOMATION_RULESET_ID,
  CAPABILITY_CANONICAL_SOURCE_SHA256,
} from './ruleset'

export const CAPABILITY_AUTOMATION_MANIFEST_SCHEMA_VERSION = 1 as const
export const CAPABILITY_AUTOMATION_CATEGORIES = [
  'numeric', 'movement', 'sense', 'communication', 'struggle', 'terrain',
  'crafting', 'gathering', 'form', 'integrated',
] as const
export const CAPABILITY_AUTOMATION_RUNTIME_KINDS = [
  'numeric', 'action-and-passive', 'passive-or-integrated',
] as const
export const CAPABILITY_AUTOMATION_PRESENTATION_POLICIES = [
  'contextual-offer', 'passive-fact-only',
] as const
export const CAPABILITY_ACTION_ECONOMY_KINDS = [
  'free', 'swift', 'shift', 'standard', 'extended',
] as const
export const CAPABILITY_FREQUENCIES = [
  'at-will', 'hourly', 'daily', 'weekly', 'cooldown',
] as const

export type CapabilityAutomationCategory = typeof CAPABILITY_AUTOMATION_CATEGORIES[number]
export type CapabilityAutomationRuntimeKind = typeof CAPABILITY_AUTOMATION_RUNTIME_KINDS[number]
export type CapabilityAutomationPresentationPolicy = typeof CAPABILITY_AUTOMATION_PRESENTATION_POLICIES[number]
export type CapabilityActionEconomy = typeof CAPABILITY_ACTION_ECONOMY_KINDS[number]
export type CapabilityFrequency = typeof CAPABILITY_FREQUENCIES[number]

export interface CapabilityActionSpec {
  readonly id: string
  readonly action: CapabilityActionEconomy
  readonly frequency: CapabilityFrequency
  readonly context: string
}

export interface CapabilityAutomationManifestEntry {
  readonly canonicalId: string
  readonly ticketId: string
  readonly category: CapabilityAutomationCategory
  readonly automationStatus: 'native'
  readonly runtimeKind: CapabilityAutomationRuntimeKind
  readonly presentationPolicy: CapabilityAutomationPresentationPolicy
  readonly adjudicationPolicy: 'deterministic' | 'bounded-gm'
  readonly levelRequirement: number | null
  readonly itemOutputs: readonly string[]
  readonly actions: readonly CapabilityActionSpec[]
  readonly passiveProjection: true
  readonly serverAuthoritative: true
  readonly legacyExecutionAllowed: false
  readonly sourceEffectSha256: string
}

export interface CapabilityAutomationManifest {
  readonly schemaVersion: typeof CAPABILITY_AUTOMATION_MANIFEST_SCHEMA_VERSION
  readonly rulesetId: typeof CAPABILITY_AUTOMATION_RULESET_ID
  readonly canonicalSourceSha256: typeof CAPABILITY_CANONICAL_SOURCE_SHA256
  readonly entryCount: 83
  readonly entries: readonly CapabilityAutomationManifestEntry[]
  readonly certification: {
    readonly unresolvedEntries: 0
    readonly manualOnlyEntries: 0
    readonly legacyExecutableEntries: 0
    readonly reviewedAt: string
  }
}

export class CapabilityAutomationManifestValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'CapabilityAutomationManifestValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const fail = (path: string, detail: string): never => { throw new CapabilityAutomationManifestValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail(path, `has invalid fields (missing ${missing.join(', ') || 'none'}; unknown ${unknown.join(', ') || 'none'}).`)
}
const text = (value: unknown, path: string, max = 200): string => {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(path, `must be trimmed text of at most ${max} characters.`)
  return value as string
}
const stableId = (value: unknown, path: string): string => {
  const parsed = text(value, path, 100)
  if (!/^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/.test(parsed)) fail(path, 'must be a lowercase stable ID.')
  return parsed
}
const stringArray = (value: unknown, path: string, max: number): readonly string[] => {
  if (!Array.isArray(value) || value.length > max) fail(path, `must be an array of at most ${max} strings.`)
  const parsed = (value as unknown[]).map((item, index) => text(item, `${path}[${index}]`))
  if (new Set(parsed).size !== parsed.length) fail(path, 'must not contain duplicates.')
  return Object.freeze(parsed)
}
const MEMBER = <T extends string>(values: readonly T[], value: unknown, path: string): T => {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) fail(path, `must be one of ${values.join(', ')}.`)
  return value as T
}

const ENTRY_FIELDS = [
  'canonicalId', 'ticketId', 'category', 'automationStatus', 'runtimeKind',
  'presentationPolicy', 'adjudicationPolicy', 'levelRequirement', 'itemOutputs',
  'actions', 'passiveProjection', 'serverAuthoritative', 'legacyExecutionAllowed',
  'sourceEffectSha256',
] as const
const ACTION_FIELDS = ['id', 'action', 'frequency', 'context'] as const

const parseEntry = (value: unknown, index: number): CapabilityAutomationManifestEntry => {
  const path = `manifest.entries[${index}]`
  const entry = record(value, path)
  exact(entry, ENTRY_FIELDS, path)
  if (!isCanonicalCapabilityId(entry.canonicalId)) fail(`${path}.canonicalId`, 'is not canonical.')
  if (!/^CA-\d{3}$/.test(String(entry.ticketId))) fail(`${path}.ticketId`, 'must be an implementation ticket ID.')
  if (entry.automationStatus !== 'native' || entry.passiveProjection !== true
    || entry.serverAuthoritative !== true || entry.legacyExecutionAllowed !== false) {
    fail(path, 'must remain native, projected, server-authoritative, and legacy-closed.')
  }
  if (entry.adjudicationPolicy !== 'deterministic' && entry.adjudicationPolicy !== 'bounded-gm') fail(`${path}.adjudicationPolicy`, 'is unsupported.')
  if (entry.levelRequirement !== null && (!Number.isSafeInteger(entry.levelRequirement) || (entry.levelRequirement as number) < 1 || (entry.levelRequirement as number) > 100)) fail(`${path}.levelRequirement`, 'must be null or a level from 1 to 100.')
  if (!/^[0-9a-f]{64}$/.test(String(entry.sourceEffectSha256))) fail(`${path}.sourceEffectSha256`, 'must be a SHA-256 digest.')
  if (!Array.isArray(entry.actions) || entry.actions.length > 8) fail(`${path}.actions`, 'must contain at most eight actions.')
  const actionIds = new Set<string>()
  const actions = (entry.actions as unknown[]).map((candidate, actionIndex): CapabilityActionSpec => {
    const actionPath = `${path}.actions[${actionIndex}]`
    const action = record(candidate, actionPath)
    exact(action, ACTION_FIELDS, actionPath)
    const id = stableId(action.id, `${actionPath}.id`)
    if (actionIds.has(id)) fail(`${actionPath}.id`, 'duplicates an action ID.')
    actionIds.add(id)
    return Object.freeze({
      id,
      action: MEMBER(CAPABILITY_ACTION_ECONOMY_KINDS, action.action, `${actionPath}.action`),
      frequency: MEMBER(CAPABILITY_FREQUENCIES, action.frequency, `${actionPath}.frequency`),
      context: stableId(action.context, `${actionPath}.context`),
    })
  })
  const presentationPolicy = MEMBER(CAPABILITY_AUTOMATION_PRESENTATION_POLICIES, entry.presentationPolicy, `${path}.presentationPolicy`)
  if ((actions.length > 0) !== (presentationPolicy === 'contextual-offer')) fail(path, 'action presence must match contextual presentation policy.')
  return Object.freeze({
    canonicalId: entry.canonicalId as string,
    ticketId: entry.ticketId as string,
    category: MEMBER(CAPABILITY_AUTOMATION_CATEGORIES, entry.category, `${path}.category`),
    automationStatus: 'native',
    runtimeKind: MEMBER(CAPABILITY_AUTOMATION_RUNTIME_KINDS, entry.runtimeKind, `${path}.runtimeKind`),
    presentationPolicy,
    adjudicationPolicy: entry.adjudicationPolicy as 'deterministic' | 'bounded-gm',
    levelRequirement: entry.levelRequirement as number | null,
    itemOutputs: stringArray(entry.itemOutputs, `${path}.itemOutputs`, 8),
    actions: Object.freeze(actions),
    passiveProjection: true,
    serverAuthoritative: true,
    legacyExecutionAllowed: false,
    sourceEffectSha256: entry.sourceEffectSha256 as string,
  })
}

export const parseCapabilityAutomationManifest = (value: unknown): CapabilityAutomationManifest => {
  const root = record(value, 'manifest')
  exact(root, ['schemaVersion', 'rulesetId', 'canonicalSourceSha256', 'entryCount', 'entries', 'certification'], 'manifest')
  if (root.schemaVersion !== 1 || root.rulesetId !== CAPABILITY_AUTOMATION_RULESET_ID
    || root.canonicalSourceSha256 !== CAPABILITY_CANONICAL_SOURCE_SHA256 || root.entryCount !== 83) fail('manifest', 'does not target the reviewed 83-entry ruleset.')
  if (!Array.isArray(root.entries) || root.entries.length !== 83) fail('manifest.entries', 'must contain exactly 83 entries.')
  const entries = (root.entries as unknown[]).map(parseEntry)
  const ids = entries.map(entry => entry.canonicalId)
  if (ids.some((id, index) => id !== CANONICAL_CAPABILITY_IDS[index])) fail('manifest.entries', 'must cover every canonical ID exactly once in Unicode-code-point order.')
  const certification = record(root.certification, 'manifest.certification')
  exact(certification, ['unresolvedEntries', 'manualOnlyEntries', 'legacyExecutableEntries', 'reviewedAt'], 'manifest.certification')
  if (certification.unresolvedEntries !== 0 || certification.manualOnlyEntries !== 0 || certification.legacyExecutableEntries !== 0) fail('manifest.certification', 'must certify zero unresolved/manual/legacy entries.')
  return Object.freeze({
    schemaVersion: 1,
    rulesetId: CAPABILITY_AUTOMATION_RULESET_ID,
    canonicalSourceSha256: CAPABILITY_CANONICAL_SOURCE_SHA256,
    entryCount: 83,
    entries: Object.freeze(entries),
    certification: Object.freeze({
      unresolvedEntries: 0,
      manualOnlyEntries: 0,
      legacyExecutableEntries: 0,
      reviewedAt: text(certification.reviewedAt, 'manifest.certification.reviewedAt', 20),
    }),
  })
}

export const CAPABILITY_AUTOMATION_MANIFEST = parseCapabilityAutomationManifest(manifestJson)
export const CAPABILITY_AUTOMATION_MANIFEST_BY_ID: ReadonlyMap<string, CapabilityAutomationManifestEntry> = new Map(
  CAPABILITY_AUTOMATION_MANIFEST.entries.map(entry => [entry.canonicalId, entry]),
)
