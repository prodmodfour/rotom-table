import manifestJson from '../../data/edge-automation/manifest.json'
import {
  CANONICAL_POKE_EDGE_IDS,
  CANONICAL_TRAINER_EDGE_IDS,
  canonicalEdgeKey,
  isCanonicalEdgeId,
  type EdgeFamily,
} from './catalog'
import { EDGE_AUTOMATION_RULESET_ID } from './ruleset'

export const EDGE_AUTOMATION_MANIFEST_SCHEMA_VERSION = 1 as const
export const EDGE_AUTOMATION_STATUSES = ['complete', 'delegated-complete', 'assisted', 'blocked', 'unimplemented'] as const
export const EDGE_AUTOMATION_ROLES = [
  'passive-provider', 'permanent-grant', 'triggered-effect', 'campaign-operation',
  'contextual-action', 'lifecycle-provider',
] as const
export const EDGE_CHOICE_KINDS = [
  'skill', 'skill-category', 'type', 'bounded-text', 'weapon', 'ability', 'move',
  'movement-capability', 'attack-stat', 'elemental-struggle-capability',
  'power-or-jump-capability', 'final-evolution',
] as const
export const EDGE_ACTION_TIMINGS = ['standard', 'shift', 'swift', 'free', 'extended'] as const
export const EDGE_ACTION_OPERATIONS = [
  'craft', 'campaign', 'training', 'encounter', 'skill-check', 'delegated-campaign',
] as const

export type EdgeAutomationStatus = typeof EDGE_AUTOMATION_STATUSES[number]
export type EdgeAutomationRole = typeof EDGE_AUTOMATION_ROLES[number]
export type EdgeChoiceKind = typeof EDGE_CHOICE_KINDS[number]
export type EdgeActionTiming = typeof EDGE_ACTION_TIMINGS[number]
export type EdgeActionOperation = typeof EDGE_ACTION_OPERATIONS[number]

export interface EdgeChoiceDefinition {
  readonly id: string
  readonly kind: EdgeChoiceKind
  readonly minimum: number
  readonly maximum: number
  readonly sameAcrossRanks?: boolean
}

export interface EdgeActionDefinition {
  readonly id: string
  readonly timing: EdgeActionTiming
  readonly context: string
  readonly operation: EdgeActionOperation
}

export interface EdgeDelegationDefinition {
  readonly capabilityId: 'breeding.v1'
  readonly plan: 'BREEDING_AND_EGG_LIFECYCLE_PLAN.md'
  readonly requestContract: 'edge.breeder.request.v1'
  readonly unavailableReason: 'downstream-capability-unavailable'
}

export interface EdgeAutomationManifestEntry {
  readonly family: EdgeFamily
  readonly canonicalId: string
  readonly ticketId: string
  readonly status: EdgeAutomationStatus
  readonly roles: readonly EdgeAutomationRole[]
  readonly choices: readonly EdgeChoiceDefinition[]
  readonly actions: readonly EdgeActionDefinition[]
  readonly sourceEffectSha256: string
  readonly runtimeHandlerId: 'edge.native.v1'
  readonly serverAuthoritative: true
  readonly legacyExecutionAllowed: false
  readonly delegation: EdgeDelegationDefinition | null
  readonly interactionDomains: readonly string[]
}

export interface EdgeAutomationManifest {
  readonly schemaVersion: 1
  readonly rulesetId: typeof EDGE_AUTOMATION_RULESET_ID
  readonly entryCount: 81
  readonly entries: readonly EdgeAutomationManifestEntry[]
}

export class EdgeAutomationManifestValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'EdgeAutomationManifestValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const fail = (path: string, detail: string): never => { throw new EdgeAutomationManifestValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object.')
  return value as UnknownRecord
}
const text = (value: unknown, path: string, max = 200): string => {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(path, 'must be bounded trimmed text.')
  return value as string
}
const stableId = (value: unknown, path: string): string => {
  const parsed = text(value, path, 160)
  if (!/^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/.test(parsed)) fail(path, 'must be a lowercase stable ID.')
  return parsed
}
const member = <T extends string>(values: readonly T[], value: unknown, path: string): T => {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) fail(path, `must be one of ${values.join(', ')}.`)
  return value as T
}
const boundedInteger = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail(path, `must be ${minimum}–${maximum}.`)
  return value as number
}

const parseChoice = (value: unknown, path: string): EdgeChoiceDefinition => {
  const row = record(value, path)
  const minimum = boundedInteger(row.minimum, `${path}.minimum`, 0, 64)
  const maximum = boundedInteger(row.maximum, `${path}.maximum`, minimum, 64)
  if (row.sameAcrossRanks !== undefined && typeof row.sameAcrossRanks !== 'boolean') fail(`${path}.sameAcrossRanks`, 'must be boolean.')
  return Object.freeze({
    id: stableId(row.id, `${path}.id`),
    kind: member(EDGE_CHOICE_KINDS, row.kind, `${path}.kind`),
    minimum,
    maximum,
    ...(row.sameAcrossRanks === undefined ? {} : { sameAcrossRanks: row.sameAcrossRanks as boolean }),
  })
}

const parseAction = (value: unknown, path: string): EdgeActionDefinition => {
  const row = record(value, path)
  return Object.freeze({
    id: stableId(row.id, `${path}.id`),
    timing: member(EDGE_ACTION_TIMINGS, row.timing, `${path}.timing`),
    context: stableId(row.context, `${path}.context`),
    operation: member(EDGE_ACTION_OPERATIONS, row.operation, `${path}.operation`),
  })
}

const parseEntry = (value: unknown, index: number): EdgeAutomationManifestEntry => {
  const path = `manifest.entries[${index}]`
  const row = record(value, path)
  const family = member(['trainer', 'poke'] as const, row.family, `${path}.family`)
  const canonicalId = text(row.canonicalId, `${path}.canonicalId`)
  if (!isCanonicalEdgeId(family, canonicalId)) fail(`${path}.canonicalId`, 'is not canonical for this family.')
  const rawRoles: unknown[] = Array.isArray(row.roles)
    ? row.roles as unknown[]
    : fail(`${path}.roles`, 'must be a list.')
  if (rawRoles.length < 1 || rawRoles.length > 6) fail(`${path}.roles`, 'must be a non-empty bounded list.')
  const roles = rawRoles.map((role: unknown, roleIndex: number) => member(EDGE_AUTOMATION_ROLES, role, `${path}.roles[${roleIndex}]`))
  if (new Set(roles).size !== roles.length) fail(`${path}.roles`, 'must not contain duplicates.')
  const rawChoices: unknown[] = Array.isArray(row.choices)
    ? row.choices as unknown[]
    : fail(`${path}.choices`, 'must be a list.')
  if (rawChoices.length > 8) fail(`${path}.choices`, 'must be bounded.')
  const rawActions: unknown[] = Array.isArray(row.actions)
    ? row.actions as unknown[]
    : fail(`${path}.actions`, 'must be a list.')
  if (rawActions.length > 8) fail(`${path}.actions`, 'must be bounded.')
  const status = member(EDGE_AUTOMATION_STATUSES, row.status, `${path}.status`)
  const delegationRow = row.delegation === null ? null : record(row.delegation, `${path}.delegation`)
  const delegation: EdgeDelegationDefinition | null = delegationRow === null ? null : Object.freeze({
    capabilityId: delegationRow.capabilityId as 'breeding.v1',
    plan: delegationRow.plan as 'BREEDING_AND_EGG_LIFECYCLE_PLAN.md',
    requestContract: delegationRow.requestContract as 'edge.breeder.request.v1',
    unavailableReason: delegationRow.unavailableReason as 'downstream-capability-unavailable',
  })
  if ((status === 'delegated-complete') !== (delegation !== null)
    || (delegation && (canonicalId !== 'Breeder' || family !== 'trainer'
      || delegation.capabilityId !== 'breeding.v1'
      || delegation.plan !== 'BREEDING_AND_EGG_LIFECYCLE_PLAN.md'
      || delegation.requestContract !== 'edge.breeder.request.v1'
      || delegation.unavailableReason !== 'downstream-capability-unavailable'))) {
    fail(`${path}.delegation`, 'must be the single closed Breeder delegation or null.')
  }
  if (row.runtimeHandlerId !== 'edge.native.v1' || row.serverAuthoritative !== true || row.legacyExecutionAllowed !== false) fail(path, 'weakens native server authority.')
  if (typeof row.sourceEffectSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sourceEffectSha256)) fail(`${path}.sourceEffectSha256`, 'must be SHA-256.')
  const sourceEffectSha256 = row.sourceEffectSha256 as string
  const interactionDomains: unknown[] = Array.isArray(row.interactionDomains)
    ? row.interactionDomains as unknown[]
    : fail(`${path}.interactionDomains`, 'must be a list.')
  if (interactionDomains.length > 16
    || interactionDomains.some((value: unknown) => typeof value !== 'string' || !/^[a-z][a-z-]*$/.test(value))) fail(`${path}.interactionDomains`, 'must contain stable domains.')
  return Object.freeze({
    family,
    canonicalId,
    ticketId: /^EA-07[0-7]$/.test(String(row.ticketId)) ? row.ticketId as string : fail(`${path}.ticketId`, 'must name a cohort ticket.'),
    status,
    roles: Object.freeze(roles),
    choices: Object.freeze(rawChoices.map((choice: unknown, choiceIndex: number) => parseChoice(choice, `${path}.choices[${choiceIndex}]`))),
    actions: Object.freeze(rawActions.map((action: unknown, actionIndex: number) => parseAction(action, `${path}.actions[${actionIndex}]`))),
    sourceEffectSha256,
    runtimeHandlerId: 'edge.native.v1',
    serverAuthoritative: true,
    legacyExecutionAllowed: false,
    delegation,
    interactionDomains: Object.freeze([...(interactionDomains as string[])]),
  })
}

export const parseEdgeAutomationManifest = (value: unknown): EdgeAutomationManifest => {
  const root = record(value, 'manifest')
  if (root.schemaVersion !== 1 || root.rulesetId !== EDGE_AUTOMATION_RULESET_ID || root.entryCount !== 81) fail('manifest', 'does not cover the frozen ruleset.')
  if (!Array.isArray(root.entries) || root.entries.length !== 81) fail('manifest.entries', 'must contain all 81 entries.')
  const rawEntries = root.entries as unknown[]
  const entries = rawEntries.map((entry: unknown, index: number) => parseEntry(entry, index))
  const expected = [
    ...CANONICAL_TRAINER_EDGE_IDS.map(id => canonicalEdgeKey('trainer', id)),
    ...CANONICAL_POKE_EDGE_IDS.map(id => canonicalEdgeKey('poke', id)),
  ]
  if (entries.some((entry, index) => canonicalEdgeKey(entry.family, entry.canonicalId) !== expected[index])) fail('manifest.entries', 'must follow frozen family and identity order.')
  const certification = record(root.certification, 'manifest.certification')
  if (certification.complete !== 80 || certification.delegatedComplete !== 1
    || certification.assisted !== 0 || certification.blocked !== 0
    || certification.unimplemented !== 0 || certification.legacyExecutable !== 0) fail('manifest.certification', 'does not certify semantic closure.')
  return Object.freeze({ schemaVersion: 1, rulesetId: EDGE_AUTOMATION_RULESET_ID, entryCount: 81, entries: Object.freeze(entries) })
}

export const EDGE_AUTOMATION_MANIFEST = parseEdgeAutomationManifest(manifestJson)
export const EDGE_AUTOMATION_MANIFEST_BY_KEY: ReadonlyMap<string, EdgeAutomationManifestEntry> = new Map(
  EDGE_AUTOMATION_MANIFEST.entries.map(entry => [canonicalEdgeKey(entry.family, entry.canonicalId), entry]),
)
