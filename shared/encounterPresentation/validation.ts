import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import { stableJsonStringify } from '../automation/stableJson'
import { computeRulesetSourceSha256 } from '../ruleset/sourceHash'
import { isSheetKind, type SheetKind } from '../sheets'
import {
  ENCOUNTER_ACTION_COST_KINDS,
  ENCOUNTER_ACTION_GROUPS,
  ENCOUNTER_ACTION_TIMINGS,
  ENCOUNTER_ANNOUNCEMENT_PRIORITIES,
  ENCOUNTER_AVAILABILITY_REASON_CODES,
  ENCOUNTER_AVAILABILITY_REASON_DEFINITIONS,
  ENCOUNTER_CHANGE_KINDS,
  ENCOUNTER_CHANGE_OPERATIONS,
  ENCOUNTER_CHOICE_KINDS,
  ENCOUNTER_CHOICE_ORDERINGS,
  ENCOUNTER_CONTRIBUTION_KINDS,
  ENCOUNTER_INTERACTION_ROLES,
  ENCOUNTER_OUTCOME_KINDS,
  ENCOUNTER_PENDING_STATUSES,
  ENCOUNTER_PRESENTATION_LIMITS,
  ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  ENCOUNTER_PRESENTATION_TONES,
  ENCOUNTER_PROJECTION_AUDIENCES,
  ENCOUNTER_RULE_SOURCE_KINDS,
  ENCOUNTER_TARGETING_KINDS,
  ENCOUNTER_VFX_KINDS,
  type EncounterActionCostKind,
  type EncounterActionGroup,
  type EncounterActionTimingKind,
  type EncounterAnnouncementPriority,
  type EncounterAvailabilityReasonCode,
  type EncounterChangeKind,
  type EncounterChangeOperation,
  type EncounterChoiceKind,
  type EncounterChoiceOrdering,
  type EncounterContributionKind,
  type EncounterInteractionRole,
  type EncounterOutcomeKind,
  type EncounterPendingStatus,
  type EncounterPresentationTone,
  type EncounterProjectionAudience,
  type EncounterRuleSourceKind,
  type EncounterTargetingKind,
  type EncounterVfxKind,
} from './catalog'
import type {
  AcceptedEncounterPresentation,
  EncounterActionCost,
  EncounterActionDeclarationIntent,
  EncounterActionIntentDescriptor,
  EncounterActionOffer,
  EncounterActionTiming,
  EncounterAvailability,
  EncounterAvailabilityReason,
  EncounterCausalPresentationGroup,
  EncounterChangeFact,
  EncounterChoiceCardinality,
  EncounterChoiceOffer,
  EncounterChoiceOption,
  EncounterChoiceOptionPreview,
  EncounterChoiceSelection,
  EncounterContextualAffordance,
  EncounterContributionExplanation,
  EncounterContributionRow,
  EncounterCorrectionPresentation,
  EncounterDerivedFactValue,
  EncounterGridCell,
  EncounterHistoryEntry,
  EncounterInteractionResponseIntent,
  EncounterOutcomeFact,
  EncounterParticipantPresentationRef,
  EncounterPassiveFact,
  EncounterPassiveSummary,
  EncounterPendingInteractionAuthorizedView,
  EncounterPendingInteractionPublicView,
  EncounterPendingInteractionView,
  EncounterPendingRecoveryAction,
  EncounterPendingResponseIdentity,
  EncounterPresentationCopy,
  EncounterPresentationProjection,
  EncounterProjectionDiagnostic,
  EncounterScreenReaderAnnouncement,
  EncounterTargetingSummary,
  EncounterUsageSummary,
  EncounterVfxHint,
  RuleSourceRef,
} from './contracts'

export type EncounterPresentationValidationCode =
  | 'not-json'
  | 'unsupported-schema-version'
  | 'invalid-shape'
  | 'invalid-value'
  | 'unknown-enum'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'inconsistent-contract'
  | 'privacy-violation'

export class EncounterPresentationValidationError extends Error {
  constructor(
    readonly code: EncounterPresentationValidationCode,
    readonly path: string,
    readonly detail: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'EncounterPresentationValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
type EnumValue = string

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const STABLE_ID_PATTERN = /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const set = <Value extends string>(values: readonly Value[]): ReadonlySet<string> => new Set(values)
const SOURCE_KINDS = set(ENCOUNTER_RULE_SOURCE_KINDS)
const ROLES = set(ENCOUNTER_INTERACTION_ROLES)
const AUDIENCES = set(ENCOUNTER_PROJECTION_AUDIENCES)
const GROUPS = set(ENCOUNTER_ACTION_GROUPS)
const TIMINGS = set(ENCOUNTER_ACTION_TIMINGS)
const COSTS = set(ENCOUNTER_ACTION_COST_KINDS)
const TARGETS = set(ENCOUNTER_TARGETING_KINDS)
const CHOICES = set(ENCOUNTER_CHOICE_KINDS)
const CHOICE_ORDERINGS = set(ENCOUNTER_CHOICE_ORDERINGS)
const REASONS = set(ENCOUNTER_AVAILABILITY_REASON_CODES)
const CONTRIBUTIONS = set(ENCOUNTER_CONTRIBUTION_KINDS)
const OUTCOMES = set(ENCOUNTER_OUTCOME_KINDS)
const CHANGES = set(ENCOUNTER_CHANGE_KINDS)
const CHANGE_OPERATIONS = set(ENCOUNTER_CHANGE_OPERATIONS)
const TONES = set(ENCOUNTER_PRESENTATION_TONES)
const ANNOUNCEMENTS = set(ENCOUNTER_ANNOUNCEMENT_PRIORITIES)
const VFX = set(ENCOUNTER_VFX_KINDS)
const PENDING_STATUSES = set(ENCOUNTER_PENDING_STATUSES)
const DURATION_VALUES = set(['instant', 'short', 'normal', 'long'] as const)
const REDUCED_MOTION_VALUES = set(['none', 'static', 'fade', 'shorten'] as const)
const CONTEXT_KINDS = set(['participant', 'terrain', 'object', 'shop', 'inventory', 'campaign', 'encounter'] as const)
const RECOVERY_ACTIONS = set(['force-pass', 'cancel', 'expire', 'retry', 'correct'] as const)
const RESPONSE_DECISIONS = set(['choose', 'pass', 'cancel', 'force-pass'] as const)

const fail = (
  code: EncounterPresentationValidationCode,
  path: string,
  detail: string,
): never => {
  throw new EncounterPresentationValidationError(code, path, detail)
}

const clone = (value: unknown, path: string): unknown => cloneStrictJson(value, path, {
  limits: {
    depth: ENCOUNTER_PRESENTATION_LIMITS.jsonDepth,
    nodes: ENCOUNTER_PRESENTATION_LIMITS.jsonNodes,
    objectFields: ENCOUNTER_PRESENTATION_LIMITS.objectFields,
    arrayEntries: ENCOUNTER_PRESENTATION_LIMITS.arrayEntries,
    stringLength: ENCOUNTER_PRESENTATION_LIMITS.diagnosticLength,
    objectKeyLength: ENCOUNTER_PRESENTATION_LIMITS.identifierLength,
  },
  rootLabel: 'encounter presentation contract',
  valueLabel: 'encounter presentation values',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-shape', path, 'must be an object.')
  return value as UnknownRecord
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return
  fail('invalid-shape', path, [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; '))
}

const enumValue = <Value extends EnumValue>(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
): Value => {
  if (typeof value !== 'string' || !allowed.has(value)) fail('unknown-enum', path, 'is unsupported.')
  return value as Value
}

const text = (
  value: unknown,
  path: string,
  maximum: number,
  options: { readonly nullable?: boolean; readonly empty?: boolean } = {},
): string | null => {
  if (options.nullable && value === null) return null
  if (typeof value !== 'string'
    || value.length > maximum
    || (!options.empty && value.length === 0)
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)) {
    fail('invalid-value', path, `must be trimmed text of at most ${maximum} characters.`)
  }
  return value as string
}

const requiredText = (value: unknown, path: string, maximum: number): string => (
  text(value, path, maximum) as string
)

const nullableText = (value: unknown, path: string, maximum: number): string | null => (
  text(value, path, maximum, { nullable: true })
)

const stableId = (value: unknown, path: string): string => {
  const id = requiredText(value, path, ENCOUNTER_PRESENTATION_LIMITS.identifierLength)
  if (!STABLE_ID_PATTERN.test(id)) fail('invalid-value', path, 'must be a stable identifier.')
  return id
}

const canonicalId = (value: unknown, path: string): string => requiredText(
  value,
  path,
  ENCOUNTER_PRESENTATION_LIMITS.canonicalIdLength,
)

const safeInteger = (
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail('invalid-value', path, `must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}

const finiteNumber = (
  value: unknown,
  path: string,
  minimum = -Number.MAX_VALUE,
  maximum = Number.MAX_VALUE,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail('invalid-value', path, `must be a finite number from ${minimum} through ${maximum}.`)
  }
  return value as number
}

const nullableNumber = (
  value: unknown,
  path: string,
  minimum = -Number.MAX_VALUE,
  maximum = Number.MAX_VALUE,
): number | null => value === null ? null : finiteNumber(value, path, minimum, maximum)

const boolean = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') fail('invalid-value', path, 'must be boolean.')
  return value as boolean
}

const boundedArray = (
  value: unknown,
  path: string,
  maximum: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) fail('invalid-shape', path, 'must be an array.')
  const entries = value as readonly unknown[]
  if (entries.length > maximum) fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  return entries
}

const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) fail('duplicate-id', path, 'must not repeat stable identities.')
}

const parseSchemaVersion = (value: unknown, path: string): void => {
  if (value !== ENCOUNTER_PRESENTATION_SCHEMA_VERSION) {
    fail('unsupported-schema-version', path, `must be ${ENCOUNTER_PRESENTATION_SCHEMA_VERSION}.`)
  }
}

const parseHref = (value: unknown, path: string): string | null => {
  const href = nullableText(value, path, ENCOUNTER_PRESENTATION_LIMITS.descriptionLength)
  if (href !== null && (!href.startsWith('/') || href.startsWith('//') || href.includes('\\'))) {
    fail('invalid-value', path, 'must be a same-origin absolute path.')
  }
  return href
}

const parseRuleSource = (value: unknown, path: string): RuleSourceRef => {
  const input = record(value, path)
  exact(input, ['sourceKind', 'canonicalId', 'instanceId', 'displayName', 'referenceHref'], path)
  return Object.freeze({
    sourceKind: enumValue<EncounterRuleSourceKind>(input.sourceKind, SOURCE_KINDS, `${path}.sourceKind`),
    canonicalId: canonicalId(input.canonicalId, `${path}.canonicalId`),
    instanceId: input.instanceId === null ? null : stableId(input.instanceId, `${path}.instanceId`),
    displayName: requiredText(input.displayName, `${path}.displayName`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    referenceHref: parseHref(input.referenceHref, `${path}.referenceHref`),
  })
}

export const parseRuleSourceRef = (value: unknown): RuleSourceRef => deepFreezeStrictJson(
  parseRuleSource(clone(value, 'ruleSource'), 'ruleSource'),
)

const parseParticipant = (value: unknown, path: string): EncounterParticipantPresentationRef => {
  const input = record(value, path)
  exact(input, [
    'participantId', 'displayName', 'portraitUrl', 'sideId', 'sideLabel', 'sideAccent',
    'sheetKind', 'statusLabels',
  ], path)
  const portraitUrl = parseHref(input.portraitUrl, `${path}.portraitUrl`)
  const sideAccent = nullableText(input.sideAccent, `${path}.sideAccent`, 32)
  if (sideAccent !== null && !HEX_COLOR_PATTERN.test(sideAccent)) {
    fail('invalid-value', `${path}.sideAccent`, 'must be a six-digit hexadecimal color.')
  }
  const statusLabels = boundedArray(input.statusLabels, `${path}.statusLabels`, 32)
    .map((label, index) => requiredText(label, `${path}.statusLabels[${index}]`, ENCOUNTER_PRESENTATION_LIMITS.labelLength))
  unique(statusLabels, `${path}.statusLabels`)
  if (input.sheetKind !== null && !isSheetKind(input.sheetKind)) {
    fail('unknown-enum', `${path}.sheetKind`, 'must be pokemon, trainer, or null.')
  }
  return Object.freeze({
    participantId: stableId(input.participantId, `${path}.participantId`),
    displayName: requiredText(input.displayName, `${path}.displayName`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    portraitUrl,
    sideId: input.sideId === null ? null : stableId(input.sideId, `${path}.sideId`),
    sideLabel: nullableText(input.sideLabel, `${path}.sideLabel`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    sideAccent,
    sheetKind: input.sheetKind as SheetKind | null,
    statusLabels: Object.freeze(statusLabels),
  })
}

export const parseEncounterParticipantPresentationRef = (
  value: unknown,
): EncounterParticipantPresentationRef => deepFreezeStrictJson(
  parseParticipant(clone(value, 'participant'), 'participant'),
)

const parseCopy = (value: unknown, path: string): EncounterPresentationCopy => {
  const input = record(value, path)
  exact(input, ['label', 'description', 'iconKey', 'tone'], path)
  return Object.freeze({
    label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    description: nullableText(input.description, `${path}.description`, ENCOUNTER_PRESENTATION_LIMITS.descriptionLength),
    iconKey: input.iconKey === null ? null : stableId(input.iconKey, `${path}.iconKey`),
    tone: enumValue<EncounterPresentationTone>(input.tone, TONES, `${path}.tone`),
  })
}

const parseReason = (value: unknown, path: string): EncounterAvailabilityReason => {
  const input = record(value, path)
  exact(input, ['code', 'label', 'sources', 'diagnosticDetail'], path)
  const code = enumValue<EncounterAvailabilityReasonCode>(input.code, REASONS, `${path}.code`)
  const label = requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength)
  if (label !== ENCOUNTER_AVAILABILITY_REASON_DEFINITIONS[code].label) {
    fail('inconsistent-contract', `${path}.label`, 'must use the safe catalog label for its reason code.')
  }
  const sources = boundedArray(input.sources, `${path}.sources`, ENCOUNTER_PRESENTATION_LIMITS.sourceEvidence)
    .map((source, index) => parseRuleSource(source, `${path}.sources[${index}]`))
  unique(sources.map(source => `${source.sourceKind}:${source.canonicalId}:${source.instanceId ?? ''}`), `${path}.sources`)
  return Object.freeze({
    code,
    label,
    sources: Object.freeze(sources),
    diagnosticDetail: nullableText(input.diagnosticDetail, `${path}.diagnosticDetail`, ENCOUNTER_PRESENTATION_LIMITS.diagnosticLength),
  })
}

const parseAvailability = (value: unknown, path: string): EncounterAvailability => {
  const input = record(value, path)
  exact(input, ['status', 'reasons'], path)
  const status = enumValue<'available' | 'unavailable'>(input.status, set(['available', 'unavailable'] as const), `${path}.status`)
  const reasons = boundedArray(input.reasons, `${path}.reasons`, 16)
    .map((reason, index) => parseReason(reason, `${path}.reasons[${index}]`))
  unique(reasons.map(reason => reason.code), `${path}.reasons`)
  if ((status === 'available') !== (reasons.length === 0)) {
    fail('inconsistent-contract', path, 'available actions have no reasons and unavailable actions have at least one reason.')
  }
  return Object.freeze({ status, reasons: Object.freeze(reasons) })
}

const parseTiming = (value: unknown, path: string): EncounterActionTiming => {
  const input = record(value, path)
  exact(input, ['kind', 'label', 'triggerLabel', 'priority'], path)
  const kind = enumValue<EncounterActionTimingKind>(input.kind, TIMINGS, `${path}.kind`)
  const priority = input.priority === null ? null : safeInteger(input.priority, `${path}.priority`, -1_000_000, 1_000_000)
  if ((kind === 'priority' || kind === 'interrupt' || kind === 'reaction') !== (priority !== null)) {
    fail('inconsistent-contract', `${path}.priority`, 'is required only for priority, interrupt, and reaction timing.')
  }
  return Object.freeze({
    kind,
    label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    triggerLabel: nullableText(input.triggerLabel, `${path}.triggerLabel`, ENCOUNTER_PRESENTATION_LIMITS.descriptionLength),
    priority,
  })
}

const parseCost = (value: unknown, path: string): EncounterActionCost => {
  const input = record(value, path)
  exact(input, ['kind', 'resourceId', 'amount', 'label'], path)
  return Object.freeze({
    kind: enumValue<EncounterActionCostKind>(input.kind, COSTS, `${path}.kind`),
    resourceId: input.resourceId === null ? null : stableId(input.resourceId, `${path}.resourceId`),
    amount: finiteNumber(input.amount, `${path}.amount`, 0, 1_000_000),
    label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
  })
}

const parseTargeting = (value: unknown, path: string): EncounterTargetingSummary => {
  const input = record(value, path)
  exact(input, [
    'requirementId', 'kind', 'minSelections', 'maxSelections', 'rangeLabel',
    'relationshipLabel', 'requiresLineOfSight', 'requiresSpatialInput',
  ], path)
  const kind = enumValue<EncounterTargetingKind>(input.kind, TARGETS, `${path}.kind`)
  const minSelections = safeInteger(input.minSelections, `${path}.minSelections`, 0, ENCOUNTER_PRESENTATION_LIMITS.selectedOptions)
  const maxSelections = safeInteger(input.maxSelections, `${path}.maxSelections`, 0, ENCOUNTER_PRESENTATION_LIMITS.selectedOptions)
  if (minSelections > maxSelections) fail('inconsistent-contract', path, 'has inverted selection cardinality.')
  if ((kind === 'none' || kind === 'self') && (minSelections !== 0 || maxSelections > 1)) {
    fail('inconsistent-contract', path, 'none/self targeting cannot request multiple selections.')
  }
  const spatial = ['cell', 'area', 'direction', 'destination', 'path'].includes(kind)
  if (spatial !== boolean(input.requiresSpatialInput, `${path}.requiresSpatialInput`)) {
    fail('inconsistent-contract', `${path}.requiresSpatialInput`, 'must match the targeting kind.')
  }
  return Object.freeze({
    requirementId: stableId(input.requirementId, `${path}.requirementId`),
    kind,
    minSelections,
    maxSelections,
    rangeLabel: nullableText(input.rangeLabel, `${path}.rangeLabel`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    relationshipLabel: nullableText(input.relationshipLabel, `${path}.relationshipLabel`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    requiresLineOfSight: boolean(input.requiresLineOfSight, `${path}.requiresLineOfSight`),
    requiresSpatialInput: spatial,
  })
}

const parseUsage = (value: unknown, path: string): EncounterUsageSummary => {
  const input = record(value, path)
  exact(input, ['frequencyLabel', 'remaining', 'maximum', 'cooldownLabel', 'resetLabel'], path)
  const remaining = input.remaining === null ? null : safeInteger(input.remaining, `${path}.remaining`)
  const maximum = input.maximum === null ? null : safeInteger(input.maximum, `${path}.maximum`)
  if ((remaining === null) !== (maximum === null) || (remaining !== null && maximum !== null && remaining > maximum)) {
    fail('inconsistent-contract', path, 'remaining and maximum must be paired and ordered.')
  }
  return Object.freeze({
    frequencyLabel: nullableText(input.frequencyLabel, `${path}.frequencyLabel`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    remaining,
    maximum,
    cooldownLabel: nullableText(input.cooldownLabel, `${path}.cooldownLabel`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    resetLabel: nullableText(input.resetLabel, `${path}.resetLabel`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
  })
}

const parseIntentDescriptor = (value: unknown, path: string): EncounterActionIntentDescriptor => {
  const input = record(value, path)
  exact(input, ['actionId', 'input'], path)
  return Object.freeze({
    actionId: stableId(input.actionId, `${path}.actionId`),
    input: enumValue<'immediate' | 'choices' | 'spatial'>(input.input, set(['immediate', 'choices', 'spatial'] as const), `${path}.input`),
  })
}

const parseActionOffer = (value: unknown, path: string): EncounterActionOffer => {
  const input = record(value, path)
  exact(input, [
    'schemaVersion', 'offerId', 'mapSlug', 'mapRevision', 'actor', 'source', 'roles',
    'group', 'groupOrder', 'offerOrder', 'timing', 'costs', 'targeting', 'usage',
    'availability', 'presentation', 'intent',
  ], path)
  parseSchemaVersion(input.schemaVersion, `${path}.schemaVersion`)
  const roles = boundedArray(input.roles, `${path}.roles`, ENCOUNTER_INTERACTION_ROLES.length)
    .map((role, index) => enumValue<EncounterInteractionRole>(role, ROLES, `${path}.roles[${index}]`))
  unique(roles, `${path}.roles`)
  if (roles.length === 0 || roles.every(role => role === 'passive-provider' || role === 'diagnostic-only')) {
    fail('inconsistent-contract', `${path}.roles`, 'an action offer must include an invocable or contextual role.')
  }
  const costs = boundedArray(input.costs, `${path}.costs`, 16)
    .map((cost, index) => parseCost(cost, `${path}.costs[${index}]`))
  const targeting = boundedArray(input.targeting, `${path}.targeting`, ENCOUNTER_PRESENTATION_LIMITS.choicesPerInteraction)
    .map((target, index) => parseTargeting(target, `${path}.targeting[${index}]`))
  unique(targeting.map(target => target.requirementId), `${path}.targeting`)
  const intent = parseIntentDescriptor(input.intent, `${path}.intent`)
  const hasSpatial = targeting.some(target => target.requiresSpatialInput)
  if ((intent.input === 'spatial') !== hasSpatial) {
    fail('inconsistent-contract', `${path}.intent.input`, 'spatial intent must match spatial targeting.')
  }
  return Object.freeze({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    offerId: stableId(input.offerId, `${path}.offerId`),
    mapSlug: stableId(input.mapSlug, `${path}.mapSlug`),
    mapRevision: safeInteger(input.mapRevision, `${path}.mapRevision`),
    actor: parseParticipant(input.actor, `${path}.actor`),
    source: parseRuleSource(input.source, `${path}.source`),
    roles: Object.freeze(roles),
    group: enumValue<EncounterActionGroup>(input.group, GROUPS, `${path}.group`),
    groupOrder: safeInteger(input.groupOrder, `${path}.groupOrder`, -1_000_000, 1_000_000),
    offerOrder: safeInteger(input.offerOrder, `${path}.offerOrder`, -1_000_000, 1_000_000),
    timing: parseTiming(input.timing, `${path}.timing`),
    costs: Object.freeze(costs),
    targeting: Object.freeze(targeting),
    usage: parseUsage(input.usage, `${path}.usage`),
    availability: parseAvailability(input.availability, `${path}.availability`),
    presentation: parseCopy(input.presentation, `${path}.presentation`),
    intent,
  })
}

export const parseEncounterActionOffer = (value: unknown): EncounterActionOffer => deepFreezeStrictJson(
  parseActionOffer(clone(value, 'encounterActionOffer'), 'encounterActionOffer'),
)

const parseFactValue = (value: unknown, path: string): EncounterDerivedFactValue => {
  const input = record(value, path)
  exact(input, ['kind', 'numberValue', 'textValue', 'booleanValue', 'unit'], path)
  const kind = enumValue<'number' | 'text' | 'boolean'>(input.kind, set(['number', 'text', 'boolean'] as const), `${path}.kind`)
  const numberValue = nullableNumber(input.numberValue, `${path}.numberValue`)
  const textValue = nullableText(input.textValue, `${path}.textValue`, ENCOUNTER_PRESENTATION_LIMITS.descriptionLength)
  const booleanValue = input.booleanValue === null ? null : boolean(input.booleanValue, `${path}.booleanValue`)
  if ((kind === 'number') !== (numberValue !== null)
    || (kind === 'text') !== (textValue !== null)
    || (kind === 'boolean') !== (booleanValue !== null)) {
    fail('inconsistent-contract', path, 'must populate exactly the value matching its kind.')
  }
  return Object.freeze({
    kind,
    numberValue,
    textValue,
    booleanValue,
    unit: nullableText(input.unit, `${path}.unit`, 40),
  })
}

const parsePassiveFact = (value: unknown, path: string): EncounterPassiveFact => {
  const input = record(value, path)
  exact(input, ['factId', 'factKey', 'value', 'label'], path)
  return Object.freeze({
    factId: stableId(input.factId, `${path}.factId`),
    factKey: stableId(input.factKey, `${path}.factKey`),
    value: parseFactValue(input.value, `${path}.value`),
    label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
  })
}

const parseContributionRow = (value: unknown, path: string): EncounterContributionRow => {
  const input = record(value, path)
  exact(input, [
    'contributionId', 'order', 'kind', 'source', 'label', 'value', 'applied', 'private',
    'preventionReason',
  ], path)
  const kind = enumValue<EncounterContributionKind>(input.kind, CONTRIBUTIONS, `${path}.kind`)
  const preventionReason = input.preventionReason === null
    ? null
    : parseReason(input.preventionReason, `${path}.preventionReason`)
  if ((kind === 'prevent' || kind === 'immunity') !== (preventionReason !== null)) {
    fail('inconsistent-contract', `${path}.preventionReason`, 'is required exactly for prevention and immunity contributions.')
  }
  return Object.freeze({
    contributionId: stableId(input.contributionId, `${path}.contributionId`),
    order: safeInteger(input.order, `${path}.order`, -1_000_000, 1_000_000),
    kind,
    source: input.source === null ? null : parseRuleSource(input.source, `${path}.source`),
    label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    value: input.value === null ? null : parseFactValue(input.value, `${path}.value`),
    applied: boolean(input.applied, `${path}.applied`),
    private: boolean(input.private, `${path}.private`),
    preventionReason,
  })
}

const parseExplanation = (value: unknown, path: string): EncounterContributionExplanation => {
  const input = record(value, path)
  exact(input, ['schemaVersion', 'explanationId', 'subjectId', 'label', 'result', 'contributions'], path)
  parseSchemaVersion(input.schemaVersion, `${path}.schemaVersion`)
  const contributions = boundedArray(input.contributions, `${path}.contributions`, ENCOUNTER_PRESENTATION_LIMITS.contributions)
    .map((row, index) => parseContributionRow(row, `${path}.contributions[${index}]`))
  unique(contributions.map(row => row.contributionId), `${path}.contributions`)
  for (let index = 1; index < contributions.length; index += 1) {
    if (contributions[index]!.order < contributions[index - 1]!.order) {
      fail('inconsistent-contract', `${path}.contributions`, 'must be ordered by contribution order.')
    }
  }
  return Object.freeze({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    explanationId: stableId(input.explanationId, `${path}.explanationId`),
    subjectId: stableId(input.subjectId, `${path}.subjectId`),
    label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    result: parseFactValue(input.result, `${path}.result`),
    contributions: Object.freeze(contributions),
  })
}

export const parseEncounterContributionExplanation = (
  value: unknown,
): EncounterContributionExplanation => deepFreezeStrictJson(
  parseExplanation(clone(value, 'encounterContributionExplanation'), 'encounterContributionExplanation'),
)

const parsePassive = (value: unknown, path: string): EncounterPassiveSummary => {
  const input = record(value, path)
  exact(input, [
    'schemaVersion', 'summaryId', 'participant', 'source', 'roles', 'active', 'facts',
    'presentation', 'explanation',
  ], path)
  parseSchemaVersion(input.schemaVersion, `${path}.schemaVersion`)
  const roles = boundedArray(input.roles, `${path}.roles`, ENCOUNTER_INTERACTION_ROLES.length)
    .map((role, index) => enumValue<EncounterInteractionRole>(role, ROLES, `${path}.roles[${index}]`))
  unique(roles, `${path}.roles`)
  if (!roles.some(role => [
    'passive-provider', 'triggered-automatic', 'triggered-optional', 'interrupt-reaction',
  ].includes(role))) {
    fail('inconsistent-contract', `${path}.roles`, 'a passive summary must include a passive or triggered role.')
  }
  const facts = boundedArray(input.facts, `${path}.facts`, 128)
    .map((fact, index) => parsePassiveFact(fact, `${path}.facts[${index}]`))
  unique(facts.map(fact => fact.factId), `${path}.facts`)
  return Object.freeze({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    summaryId: stableId(input.summaryId, `${path}.summaryId`),
    participant: parseParticipant(input.participant, `${path}.participant`),
    source: parseRuleSource(input.source, `${path}.source`),
    roles: Object.freeze(roles),
    active: boolean(input.active, `${path}.active`),
    facts: Object.freeze(facts),
    presentation: parseCopy(input.presentation, `${path}.presentation`),
    explanation: input.explanation === null ? null : parseExplanation(input.explanation, `${path}.explanation`),
  })
}

export const parseEncounterPassiveSummary = (value: unknown): EncounterPassiveSummary => deepFreezeStrictJson(
  parsePassive(clone(value, 'encounterPassiveSummary'), 'encounterPassiveSummary'),
)

const parseAffordance = (value: unknown, path: string): EncounterContextualAffordance => {
  const input = record(value, path)
  exact(input, [
    'schemaVersion', 'affordanceId', 'contextKind', 'contextId', 'source', 'actor',
    'linkedOfferId', 'availability', 'presentation',
  ], path)
  parseSchemaVersion(input.schemaVersion, `${path}.schemaVersion`)
  return Object.freeze({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    affordanceId: stableId(input.affordanceId, `${path}.affordanceId`),
    contextKind: enumValue<EncounterContextualAffordance['contextKind']>(input.contextKind, CONTEXT_KINDS, `${path}.contextKind`),
    contextId: stableId(input.contextId, `${path}.contextId`),
    source: parseRuleSource(input.source, `${path}.source`),
    actor: input.actor === null ? null : parseParticipant(input.actor, `${path}.actor`),
    linkedOfferId: input.linkedOfferId === null ? null : stableId(input.linkedOfferId, `${path}.linkedOfferId`),
    availability: parseAvailability(input.availability, `${path}.availability`),
    presentation: parseCopy(input.presentation, `${path}.presentation`),
  })
}

export const parseEncounterContextualAffordance = (
  value: unknown,
): EncounterContextualAffordance => deepFreezeStrictJson(
  parseAffordance(clone(value, 'encounterContextualAffordance'), 'encounterContextualAffordance'),
)

const parseGridCell = (value: unknown, path: string): EncounterGridCell => {
  const input = record(value, path)
  exact(input, ['x', 'y', 'z'], path)
  return Object.freeze({
    x: safeInteger(input.x, `${path}.x`, -1_000_000, 1_000_000),
    y: safeInteger(input.y, `${path}.y`, -1_000_000, 1_000_000),
    z: safeInteger(input.z, `${path}.z`, -1_000_000, 1_000_000),
  })
}

const parseGridCells = (value: unknown, path: string, maximum: number): readonly EncounterGridCell[] => {
  const cells = boundedArray(value, path, maximum)
    .map((cell, index) => parseGridCell(cell, `${path}[${index}]`))
  unique(cells.map(cell => `${cell.x}:${cell.y}:${cell.z}`), path)
  return Object.freeze(cells)
}

const parseChoicePreview = (value: unknown, path: string): EncounterChoiceOptionPreview => {
  const input = record(value, path)
  if (input.kind === 'none') {
    exact(input, ['kind'], path)
    return Object.freeze({ kind: 'none' })
  }
  if (input.kind === 'participant') {
    exact(input, ['kind', 'participant'], path)
    return Object.freeze({ kind: 'participant', participant: parseParticipant(input.participant, `${path}.participant`) })
  }
  if (input.kind === 'reference') {
    exact(input, ['kind', 'source'], path)
    return Object.freeze({ kind: 'reference', source: parseRuleSource(input.source, `${path}.source`) })
  }
  if (input.kind === 'item') {
    exact(input, ['kind', 'source', 'quantity'], path)
    return Object.freeze({
      kind: 'item',
      source: parseRuleSource(input.source, `${path}.source`),
      quantity: input.quantity === null ? null : safeInteger(input.quantity, `${path}.quantity`, 0, 1_000_000),
    })
  }
  if (input.kind === 'side') {
    exact(input, ['kind', 'sideId', 'label', 'accent'], path)
    const accent = nullableText(input.accent, `${path}.accent`, 32)
    if (accent !== null && !HEX_COLOR_PATTERN.test(accent)) fail('invalid-value', `${path}.accent`, 'must be a six-digit hexadecimal color.')
    return Object.freeze({
      kind: 'side',
      sideId: stableId(input.sideId, `${path}.sideId`),
      label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
      accent,
    })
  }
  if (input.kind === 'spatial') {
    exact(input, ['kind', 'cells', 'destination', 'path', 'direction'], path)
    return Object.freeze({
      kind: 'spatial',
      cells: parseGridCells(input.cells, `${path}.cells`, ENCOUNTER_PRESENTATION_LIMITS.spatialCells),
      destination: input.destination === null ? null : parseGridCell(input.destination, `${path}.destination`),
      path: parseGridCells(input.path, `${path}.path`, ENCOUNTER_PRESENTATION_LIMITS.pathCells),
      direction: nullableText(input.direction, `${path}.direction`, 80),
    })
  }
  return fail('unknown-enum', `${path}.kind`, 'is unsupported.')
}

const parseChoiceOption = (value: unknown, path: string): EncounterChoiceOption => {
  const input = record(value, path)
  exact(input, ['optionId', 'label', 'description', 'disabled', 'unavailableReason', 'preview'], path)
  const disabled = boolean(input.disabled, `${path}.disabled`)
  const unavailableReason = input.unavailableReason === null
    ? null
    : parseReason(input.unavailableReason, `${path}.unavailableReason`)
  if (disabled !== (unavailableReason !== null)) {
    fail('inconsistent-contract', path, 'disabled options require exactly one unavailable reason.')
  }
  return Object.freeze({
    optionId: stableId(input.optionId, `${path}.optionId`),
    label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    description: nullableText(input.description, `${path}.description`, ENCOUNTER_PRESENTATION_LIMITS.descriptionLength),
    disabled,
    unavailableReason,
    preview: parseChoicePreview(input.preview, `${path}.preview`),
  })
}

const parseCardinality = (value: unknown, path: string): EncounterChoiceCardinality => {
  const input = record(value, path)
  exact(input, ['minimum', 'maximum'], path)
  const minimum = safeInteger(input.minimum, `${path}.minimum`, 0, ENCOUNTER_PRESENTATION_LIMITS.selectedOptions)
  const maximum = safeInteger(input.maximum, `${path}.maximum`, 0, ENCOUNTER_PRESENTATION_LIMITS.selectedOptions)
  if (minimum > maximum) fail('inconsistent-contract', path, 'has inverted selection cardinality.')
  return Object.freeze({ minimum, maximum })
}

const parseChoiceOffer = (value: unknown, path: string): EncounterChoiceOffer => {
  const input = record(value, path)
  exact(input, [
    'schemaVersion', 'choiceOfferId', 'interactionId', 'mapSlug', 'mapRevision',
    'choiceId', 'kind', 'prompt', 'helpText', 'cardinality', 'ordering', 'options',
    'defaultOptionIds', 'requiresConfirmation', 'allowPass', 'allowCancel', 'expiresAt',
  ], path)
  parseSchemaVersion(input.schemaVersion, `${path}.schemaVersion`)
  const options = boundedArray(input.options, `${path}.options`, ENCOUNTER_PRESENTATION_LIMITS.optionsPerChoice)
    .map((option, index) => parseChoiceOption(option, `${path}.options[${index}]`))
  unique(options.map(option => option.optionId), `${path}.options`)
  const cardinality = parseCardinality(input.cardinality, `${path}.cardinality`)
  const availableOptionIds = new Set(options.filter(option => !option.disabled).map(option => option.optionId))
  if (cardinality.maximum > availableOptionIds.size) {
    fail('inconsistent-contract', `${path}.cardinality.maximum`, 'cannot exceed the available option count.')
  }
  const defaultOptionIds = boundedArray(input.defaultOptionIds, `${path}.defaultOptionIds`, ENCOUNTER_PRESENTATION_LIMITS.selectedOptions)
    .map((optionId, index) => stableId(optionId, `${path}.defaultOptionIds[${index}]`))
  unique(defaultOptionIds, `${path}.defaultOptionIds`)
  if (defaultOptionIds.length > cardinality.maximum || defaultOptionIds.some(optionId => !availableOptionIds.has(optionId))) {
    fail('inconsistent-contract', `${path}.defaultOptionIds`, 'must identify selectable options within cardinality.')
  }
  return Object.freeze({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    choiceOfferId: stableId(input.choiceOfferId, `${path}.choiceOfferId`),
    interactionId: stableId(input.interactionId, `${path}.interactionId`),
    mapSlug: stableId(input.mapSlug, `${path}.mapSlug`),
    mapRevision: safeInteger(input.mapRevision, `${path}.mapRevision`),
    choiceId: stableId(input.choiceId, `${path}.choiceId`),
    kind: enumValue<EncounterChoiceKind>(input.kind, CHOICES, `${path}.kind`),
    prompt: requiredText(input.prompt, `${path}.prompt`, ENCOUNTER_PRESENTATION_LIMITS.descriptionLength),
    helpText: nullableText(input.helpText, `${path}.helpText`, ENCOUNTER_PRESENTATION_LIMITS.descriptionLength),
    cardinality,
    ordering: enumValue<EncounterChoiceOrdering>(input.ordering, CHOICE_ORDERINGS, `${path}.ordering`),
    options: Object.freeze(options),
    defaultOptionIds: Object.freeze(defaultOptionIds),
    requiresConfirmation: boolean(input.requiresConfirmation, `${path}.requiresConfirmation`),
    allowPass: boolean(input.allowPass, `${path}.allowPass`),
    allowCancel: boolean(input.allowCancel, `${path}.allowCancel`),
    expiresAt: input.expiresAt === null ? null : safeInteger(input.expiresAt, `${path}.expiresAt`),
  })
}

export const parseEncounterChoiceOffer = (value: unknown): EncounterChoiceOffer => deepFreezeStrictJson(
  parseChoiceOffer(clone(value, 'encounterChoiceOffer'), 'encounterChoiceOffer'),
)

const parseAnnouncement = (value: unknown, path: string): EncounterScreenReaderAnnouncement => {
  const input = record(value, path)
  exact(input, ['announcementId', 'priority', 'message', 'dedupeKey'], path)
  return Object.freeze({
    announcementId: stableId(input.announcementId, `${path}.announcementId`),
    priority: enumValue<EncounterAnnouncementPriority>(input.priority, ANNOUNCEMENTS, `${path}.priority`),
    message: requiredText(input.message, `${path}.message`, ENCOUNTER_PRESENTATION_LIMITS.announcementLength),
    dedupeKey: stableId(input.dedupeKey, `${path}.dedupeKey`),
  })
}

const parseResponseIdentity = (value: unknown, path: string): EncounterPendingResponseIdentity => {
  const input = record(value, path)
  exact(input, ['interactionId', 'resolutionId', 'windowId', 'retryKey'], path)
  return Object.freeze({
    interactionId: stableId(input.interactionId, `${path}.interactionId`),
    resolutionId: stableId(input.resolutionId, `${path}.resolutionId`),
    windowId: stableId(input.windowId, `${path}.windowId`),
    retryKey: stableId(input.retryKey, `${path}.retryKey`),
  })
}

const parseRecoveryAction = (value: unknown, path: string): EncounterPendingRecoveryAction => {
  const input = record(value, path)
  exact(input, ['action', 'actionId', 'label', 'enabled', 'unavailableReason'], path)
  const enabled = boolean(input.enabled, `${path}.enabled`)
  const unavailableReason = input.unavailableReason === null
    ? null
    : parseReason(input.unavailableReason, `${path}.unavailableReason`)
  if (enabled === (unavailableReason !== null)) {
    fail('inconsistent-contract', path, 'enabled recovery actions have no unavailable reason.')
  }
  return Object.freeze({
    action: enumValue<EncounterPendingRecoveryAction['action']>(input.action, RECOVERY_ACTIONS, `${path}.action`),
    actionId: stableId(input.actionId, `${path}.actionId`),
    label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    enabled,
    unavailableReason,
  })
}

const PUBLIC_PENDING_FIELDS = [
  'schemaVersion', 'projection', 'interactionId', 'mapSlug', 'mapRevision', 'status',
  'source', 'actor', 'prompt', 'outstandingChoiceCount', 'allowPass', 'allowCancel',
  'expiresAt', 'announcement',
] as const
const AUTHORIZED_PENDING_FIELDS = [
  'schemaVersion', 'projection', 'interactionId', 'mapSlug', 'mapRevision', 'status',
  'source', 'actor', 'prompt', 'choices', 'responseIdentity', 'allowPass', 'allowCancel',
  'expiresAt', 'recoveryActions', 'announcement',
] as const

const parsePending = (value: unknown, path: string): EncounterPendingInteractionView => {
  const input = record(value, path)
  const publicProjection = input.projection === 'public'
  exact(input, publicProjection ? PUBLIC_PENDING_FIELDS : AUTHORIZED_PENDING_FIELDS, path)
  parseSchemaVersion(input.schemaVersion, `${path}.schemaVersion`)
  const projection = enumValue<EncounterPendingInteractionView['projection']>(
    input.projection,
    set(['public', 'actor-owner', 'responder-owner', 'gm', 'diagnostic'] as const),
    `${path}.projection`,
  )
  const common = {
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    interactionId: stableId(input.interactionId, `${path}.interactionId`),
    mapSlug: stableId(input.mapSlug, `${path}.mapSlug`),
    mapRevision: safeInteger(input.mapRevision, `${path}.mapRevision`),
    status: enumValue<EncounterPendingStatus>(input.status, PENDING_STATUSES, `${path}.status`),
    source: input.source === null ? null : parseRuleSource(input.source, `${path}.source`),
    actor: input.actor === null ? null : parseParticipant(input.actor, `${path}.actor`),
    prompt: requiredText(input.prompt, `${path}.prompt`, ENCOUNTER_PRESENTATION_LIMITS.descriptionLength),
    allowPass: boolean(input.allowPass, `${path}.allowPass`),
    allowCancel: boolean(input.allowCancel, `${path}.allowCancel`),
    expiresAt: input.expiresAt === null ? null : safeInteger(input.expiresAt, `${path}.expiresAt`),
    announcement: parseAnnouncement(input.announcement, `${path}.announcement`),
  }
  if (publicProjection) {
    return Object.freeze({
      ...common,
      projection: 'public',
      outstandingChoiceCount: safeInteger(
        input.outstandingChoiceCount,
        `${path}.outstandingChoiceCount`,
        0,
        ENCOUNTER_PRESENTATION_LIMITS.choicesPerInteraction,
      ),
    } satisfies EncounterPendingInteractionPublicView)
  }
  if (projection === 'public') return fail('invalid-shape', `${path}.projection`, 'does not match the authorized shape.')
  const choices = boundedArray(input.choices, `${path}.choices`, ENCOUNTER_PRESENTATION_LIMITS.choicesPerInteraction)
    .map((choice, index) => parseChoiceOffer(choice, `${path}.choices[${index}]`))
  unique(choices.map(choice => choice.choiceId), `${path}.choices`)
  const responseIdentity = parseResponseIdentity(input.responseIdentity, `${path}.responseIdentity`)
  if (responseIdentity.interactionId !== common.interactionId
    || choices.some(choice => choice.interactionId !== common.interactionId
      || choice.mapSlug !== common.mapSlug
      || choice.mapRevision !== common.mapRevision)) {
    fail('inconsistent-contract', path, 'pending identity, choice offers, map, and revision must agree.')
  }
  const recoveryActions = boundedArray(input.recoveryActions, `${path}.recoveryActions`, 16)
    .map((action, index) => parseRecoveryAction(action, `${path}.recoveryActions[${index}]`))
  unique(recoveryActions.map(action => action.actionId), `${path}.recoveryActions`)
  if (projection !== 'gm' && projection !== 'diagnostic' && recoveryActions.length > 0) {
    fail('privacy-violation', `${path}.recoveryActions`, 'are GM/diagnostic-only.')
  }
  return Object.freeze({
    ...common,
    projection,
    choices: Object.freeze(choices),
    responseIdentity,
    recoveryActions: Object.freeze(recoveryActions),
  } satisfies EncounterPendingInteractionAuthorizedView)
}

export const parseEncounterPendingInteractionView = (
  value: unknown,
): EncounterPendingInteractionView => deepFreezeStrictJson(
  parsePending(clone(value, 'encounterPendingInteraction'), 'encounterPendingInteraction'),
)

const parseOutcome = (value: unknown, path: string): EncounterOutcomeFact => {
  const input = record(value, path)
  exact(input, ['outcomeId', 'kind', 'participantId', 'label', 'tone', 'preventedBy'], path)
  const kind = enumValue<EncounterOutcomeKind>(input.kind, OUTCOMES, `${path}.kind`)
  const preventedBy = boundedArray(input.preventedBy, `${path}.preventedBy`, ENCOUNTER_PRESENTATION_LIMITS.sourceEvidence)
    .map((source, index) => parseRuleSource(source, `${path}.preventedBy[${index}]`))
  if ((kind === 'prevented' || kind === 'immune') !== (preventedBy.length > 0)) {
    fail('inconsistent-contract', `${path}.preventedBy`, 'must be populated exactly for prevented or immune outcomes.')
  }
  return Object.freeze({
    outcomeId: stableId(input.outcomeId, `${path}.outcomeId`),
    kind,
    participantId: input.participantId === null ? null : stableId(input.participantId, `${path}.participantId`),
    label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    tone: enumValue<EncounterPresentationTone>(input.tone, TONES, `${path}.tone`),
    preventedBy: Object.freeze(preventedBy),
  })
}

const parseChange = (value: unknown, path: string): EncounterChangeFact => {
  const input = record(value, path)
  exact(input, [
    'changeId', 'kind', 'operation', 'participantId', 'subjectId', 'field', 'before',
    'after', 'delta', 'label',
  ], path)
  const operation = enumValue<EncounterChangeOperation>(input.operation, CHANGE_OPERATIONS, `${path}.operation`)
  const before = input.before === null ? null : parseFactValue(input.before, `${path}.before`)
  const after = input.after === null ? null : parseFactValue(input.after, `${path}.after`)
  if (operation === 'create' && before !== null) fail('inconsistent-contract', `${path}.before`, 'must be null for create.')
  if (operation === 'delete' && after !== null) fail('inconsistent-contract', `${path}.after`, 'must be null for delete.')
  if (before === null && after === null) fail('inconsistent-contract', path, 'must include a before or after value.')
  return Object.freeze({
    changeId: stableId(input.changeId, `${path}.changeId`),
    kind: enumValue<EncounterChangeKind>(input.kind, CHANGES, `${path}.kind`),
    operation,
    participantId: input.participantId === null ? null : stableId(input.participantId, `${path}.participantId`),
    subjectId: stableId(input.subjectId, `${path}.subjectId`),
    field: stableId(input.field, `${path}.field`),
    before,
    after,
    delta: nullableNumber(input.delta, `${path}.delta`),
    label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.descriptionLength),
  })
}

const parseCausal = (value: unknown, path: string): EncounterCausalPresentationGroup => {
  const input = record(value, path)
  exact(input, ['groupId', 'parentPresentationId', 'depth', 'sequence'], path)
  const depth = safeInteger(input.depth, `${path}.depth`, 0, ENCOUNTER_PRESENTATION_LIMITS.causalDepth)
  const parentPresentationId = input.parentPresentationId === null
    ? null
    : stableId(input.parentPresentationId, `${path}.parentPresentationId`)
  if ((depth === 0) !== (parentPresentationId === null)) {
    fail('inconsistent-contract', path, 'root causal groups have no parent and nested groups have one.')
  }
  return Object.freeze({
    groupId: stableId(input.groupId, `${path}.groupId`),
    parentPresentationId,
    depth,
    sequence: safeInteger(input.sequence, `${path}.sequence`),
  })
}

const parseVfx = (value: unknown, path: string): EncounterVfxHint => {
  const input = record(value, path)
  exact(input, [
    'vfxId', 'kind', 'sourceParticipantId', 'targetParticipantIds', 'cells', 'tone',
    'duration', 'reducedMotionKind', 'label',
  ], path)
  const targetParticipantIds = boundedArray(
    input.targetParticipantIds,
    `${path}.targetParticipantIds`,
    ENCOUNTER_PRESENTATION_LIMITS.affectedParticipants,
  ).map((id, index) => stableId(id, `${path}.targetParticipantIds[${index}]`))
  unique(targetParticipantIds, `${path}.targetParticipantIds`)
  return Object.freeze({
    vfxId: stableId(input.vfxId, `${path}.vfxId`),
    kind: enumValue<EncounterVfxKind>(input.kind, VFX, `${path}.kind`),
    sourceParticipantId: input.sourceParticipantId === null
      ? null
      : stableId(input.sourceParticipantId, `${path}.sourceParticipantId`),
    targetParticipantIds: Object.freeze(targetParticipantIds),
    cells: parseGridCells(input.cells, `${path}.cells`, ENCOUNTER_PRESENTATION_LIMITS.spatialCells),
    tone: enumValue<EncounterPresentationTone>(input.tone, TONES, `${path}.tone`),
    duration: enumValue<EncounterVfxHint['duration']>(input.duration, DURATION_VALUES, `${path}.duration`),
    reducedMotionKind: enumValue<EncounterVfxHint['reducedMotionKind']>(input.reducedMotionKind, REDUCED_MOTION_VALUES, `${path}.reducedMotionKind`),
    label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
  })
}

const parseHistory = (value: unknown, path: string): EncounterHistoryEntry => {
  const input = record(value, path)
  exact(input, ['entryId', 'occurredAt', 'headline', 'detail', 'tone', 'participantIds'], path)
  const participantIds = boundedArray(
    input.participantIds,
    `${path}.participantIds`,
    ENCOUNTER_PRESENTATION_LIMITS.affectedParticipants,
  ).map((id, index) => stableId(id, `${path}.participantIds[${index}]`))
  unique(participantIds, `${path}.participantIds`)
  return Object.freeze({
    entryId: stableId(input.entryId, `${path}.entryId`),
    occurredAt: safeInteger(input.occurredAt, `${path}.occurredAt`),
    headline: requiredText(input.headline, `${path}.headline`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    detail: nullableText(input.detail, `${path}.detail`, ENCOUNTER_PRESENTATION_LIMITS.descriptionLength),
    tone: enumValue<EncounterPresentationTone>(input.tone, TONES, `${path}.tone`),
    participantIds: Object.freeze(participantIds),
  })
}

const parseCorrection = (value: unknown, path: string): EncounterCorrectionPresentation => {
  const input = record(value, path)
  exact(input, ['correctionId', 'correctsPresentationId', 'reasonLabel', 'rollbackChangeIds'], path)
  const rollbackChangeIds = boundedArray(input.rollbackChangeIds, `${path}.rollbackChangeIds`, ENCOUNTER_PRESENTATION_LIMITS.changeFacts)
    .map((id, index) => stableId(id, `${path}.rollbackChangeIds[${index}]`))
  unique(rollbackChangeIds, `${path}.rollbackChangeIds`)
  return Object.freeze({
    correctionId: stableId(input.correctionId, `${path}.correctionId`),
    correctsPresentationId: stableId(input.correctsPresentationId, `${path}.correctsPresentationId`),
    reasonLabel: requiredText(input.reasonLabel, `${path}.reasonLabel`, ENCOUNTER_PRESENTATION_LIMITS.descriptionLength),
    rollbackChangeIds: Object.freeze(rollbackChangeIds),
  })
}

const parseAccepted = (value: unknown, path: string): AcceptedEncounterPresentation => {
  const input = record(value, path)
  exact(input, [
    'schemaVersion', 'presentationId', 'operationId', 'mapSlug', 'previousRevision',
    'revision', 'source', 'actor', 'affectedParticipants', 'outcomes', 'changes',
    'explanations', 'causal', 'headline', 'splash', 'vfx', 'announcements', 'history',
    'correction',
  ], path)
  parseSchemaVersion(input.schemaVersion, `${path}.schemaVersion`)
  const previousRevision = safeInteger(input.previousRevision, `${path}.previousRevision`)
  const revision = safeInteger(input.revision, `${path}.revision`)
  if (revision <= previousRevision) fail('inconsistent-contract', `${path}.revision`, 'must advance beyond previousRevision.')
  const affectedParticipants = boundedArray(
    input.affectedParticipants,
    `${path}.affectedParticipants`,
    ENCOUNTER_PRESENTATION_LIMITS.affectedParticipants,
  ).map((participant, index) => parseParticipant(participant, `${path}.affectedParticipants[${index}]`))
  unique(affectedParticipants.map(participant => participant.participantId), `${path}.affectedParticipants`)
  const outcomes = boundedArray(input.outcomes, `${path}.outcomes`, ENCOUNTER_PRESENTATION_LIMITS.outcomeFacts)
    .map((outcome, index) => parseOutcome(outcome, `${path}.outcomes[${index}]`))
  unique(outcomes.map(outcome => outcome.outcomeId), `${path}.outcomes`)
  const changes = boundedArray(input.changes, `${path}.changes`, ENCOUNTER_PRESENTATION_LIMITS.changeFacts)
    .map((change, index) => parseChange(change, `${path}.changes[${index}]`))
  unique(changes.map(change => change.changeId), `${path}.changes`)
  const explanations = boundedArray(input.explanations, `${path}.explanations`, ENCOUNTER_PRESENTATION_LIMITS.contributions)
    .map((explanation, index) => parseExplanation(explanation, `${path}.explanations[${index}]`))
  unique(explanations.map(explanation => explanation.explanationId), `${path}.explanations`)
  const vfx = boundedArray(input.vfx, `${path}.vfx`, 256)
    .map((hint, index) => parseVfx(hint, `${path}.vfx[${index}]`))
  unique(vfx.map(hint => hint.vfxId), `${path}.vfx`)
  const announcements = boundedArray(input.announcements, `${path}.announcements`, 64)
    .map((announcement, index) => parseAnnouncement(announcement, `${path}.announcements[${index}]`))
  unique(announcements.map(announcement => announcement.announcementId), `${path}.announcements`)
  const history = boundedArray(input.history, `${path}.history`, 256)
    .map((entry, index) => parseHistory(entry, `${path}.history[${index}]`))
  unique(history.map(entry => entry.entryId), `${path}.history`)
  const participantIds = new Set(affectedParticipants.map(participant => participant.participantId))
  const actor = input.actor === null ? null : parseParticipant(input.actor, `${path}.actor`)
  if (actor) participantIds.add(actor.participantId)
  const referencedIds = [
    ...outcomes.flatMap(outcome => outcome.participantId ? [outcome.participantId] : []),
    ...changes.flatMap(change => change.participantId ? [change.participantId] : []),
    ...vfx.flatMap(hint => [
      ...(hint.sourceParticipantId ? [hint.sourceParticipantId] : []),
      ...hint.targetParticipantIds,
    ]),
    ...history.flatMap(entry => entry.participantIds),
  ]
  if (referencedIds.some(id => !participantIds.has(id))) {
    fail('inconsistent-contract', path, 'references a participant absent from actor/affectedParticipants.')
  }
  const correction = input.correction === null ? null : parseCorrection(input.correction, `${path}.correction`)
  if (correction && correction.rollbackChangeIds.some(id => !changes.some(change => change.changeId === id))) {
    fail('inconsistent-contract', `${path}.correction.rollbackChangeIds`, 'must reference projected change facts.')
  }
  return Object.freeze({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    presentationId: stableId(input.presentationId, `${path}.presentationId`),
    operationId: stableId(input.operationId, `${path}.operationId`),
    mapSlug: stableId(input.mapSlug, `${path}.mapSlug`),
    previousRevision,
    revision,
    source: parseRuleSource(input.source, `${path}.source`),
    actor,
    affectedParticipants: Object.freeze(affectedParticipants),
    outcomes: Object.freeze(outcomes),
    changes: Object.freeze(changes),
    explanations: Object.freeze(explanations),
    causal: parseCausal(input.causal, `${path}.causal`),
    headline: parseCopy(input.headline, `${path}.headline`),
    splash: input.splash === null ? null : parseCopy(input.splash, `${path}.splash`),
    vfx: Object.freeze(vfx),
    announcements: Object.freeze(announcements),
    history: Object.freeze(history),
    correction,
  })
}

export const parseAcceptedEncounterPresentation = (
  value: unknown,
): AcceptedEncounterPresentation => {
  const parsed = parseAccepted(clone(value, 'acceptedEncounterPresentation'), 'acceptedEncounterPresentation')
  const bytes = new TextEncoder().encode(stableJsonStringify(parsed)).byteLength
  if (bytes > ENCOUNTER_PRESENTATION_LIMITS.realtimeBytes) {
    fail(
      'limit-exceeded',
      'acceptedEncounterPresentation',
      `must encode to at most ${ENCOUNTER_PRESENTATION_LIMITS.realtimeBytes} bytes.`,
    )
  }
  return deepFreezeStrictJson(parsed)
}

const parseDiagnostic = (value: unknown, path: string): EncounterProjectionDiagnostic => {
  const input = record(value, path)
  exact(input, ['diagnosticId', 'label', 'detail', 'source'], path)
  return Object.freeze({
    diagnosticId: stableId(input.diagnosticId, `${path}.diagnosticId`),
    label: requiredText(input.label, `${path}.label`, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
    detail: requiredText(input.detail, `${path}.detail`, ENCOUNTER_PRESENTATION_LIMITS.diagnosticLength),
    source: input.source === null ? null : parseRuleSource(input.source, `${path}.source`),
  })
}

const assertProjectionPrivacy = (projection: EncounterPresentationProjection, path: string): void => {
  const diagnostic = projection.audience === 'diagnostic'
  const reasons = [
    ...projection.offers.flatMap(offer => offer.availability.reasons),
    ...projection.affordances.flatMap(affordance => affordance.availability.reasons),
    ...projection.pending.flatMap(pending => pending.projection === 'public'
      ? []
      : [
          ...pending.choices.flatMap(choice => choice.options.flatMap(option => option.unavailableReason ? [option.unavailableReason] : [])),
          ...pending.recoveryActions.flatMap(action => action.unavailableReason ? [action.unavailableReason] : []),
        ]),
  ]
  if (!diagnostic && reasons.some(reason => reason.diagnosticDetail !== null)) {
    fail('privacy-violation', path, 'non-diagnostic projections cannot contain diagnostic reason evidence.')
  }
  if (!diagnostic && projection.passives.some(passive => (
    passive.explanation?.contributions.some(row => row.private) ?? false
  ))) {
    fail('privacy-violation', path, 'non-diagnostic projections cannot contain private contribution rows.')
  }
  if (!diagnostic && projection.accepted.some(accepted => accepted.explanations.some(explanation => (
    explanation.contributions.some(row => row.private)
  )))) {
    fail('privacy-violation', path, 'non-diagnostic projections cannot contain private accepted contribution rows.')
  }
  if (!diagnostic && projection.diagnostics.length > 0) {
    fail('privacy-violation', `${path}.diagnostics`, 'are diagnostic-projection-only.')
  }
  if (projection.audience === 'public' && projection.pending.some(pending => pending.projection !== 'public')) {
    fail('privacy-violation', `${path}.pending`, 'public projections cannot contain authorized pending choices.')
  }
  if ((projection.audience === 'actor-owner' || projection.audience === 'responder-owner')
    && projection.pending.some(pending => pending.projection === 'gm' || pending.projection === 'diagnostic')) {
    fail('privacy-violation', `${path}.pending`, 'owner projections cannot contain GM or diagnostic pending views.')
  }
}

const parseProjection = (value: unknown, path: string): EncounterPresentationProjection => {
  const input = record(value, path)
  exact(input, [
    'schemaVersion', 'projectionId', 'audience', 'mapSlug', 'mapRevision', 'generatedAt',
    'offers', 'passives', 'affordances', 'pending', 'accepted', 'diagnostics',
  ], path)
  parseSchemaVersion(input.schemaVersion, `${path}.schemaVersion`)
  const mapSlug = stableId(input.mapSlug, `${path}.mapSlug`)
  const mapRevision = safeInteger(input.mapRevision, `${path}.mapRevision`)
  const offers = boundedArray(input.offers, `${path}.offers`, ENCOUNTER_PRESENTATION_LIMITS.offers)
    .map((offer, index) => parseActionOffer(offer, `${path}.offers[${index}]`))
  unique(offers.map(offer => offer.offerId), `${path}.offers`)
  const passives = boundedArray(input.passives, `${path}.passives`, ENCOUNTER_PRESENTATION_LIMITS.passiveSummaries)
    .map((passive, index) => parsePassive(passive, `${path}.passives[${index}]`))
  unique(passives.map(passive => passive.summaryId), `${path}.passives`)
  const affordances = boundedArray(input.affordances, `${path}.affordances`, ENCOUNTER_PRESENTATION_LIMITS.contextualAffordances)
    .map((affordance, index) => parseAffordance(affordance, `${path}.affordances[${index}]`))
  unique(affordances.map(affordance => affordance.affordanceId), `${path}.affordances`)
  const pending = boundedArray(input.pending, `${path}.pending`, ENCOUNTER_PRESENTATION_LIMITS.pendingInteractions)
    .map((pendingView, index) => parsePending(pendingView, `${path}.pending[${index}]`))
  unique(pending.map(pendingView => `${pendingView.projection}:${pendingView.interactionId}`), `${path}.pending`)
  const accepted = boundedArray(input.accepted, `${path}.accepted`, 512)
    .map((presentation, index) => parseAccepted(presentation, `${path}.accepted[${index}]`))
  unique(accepted.map(presentation => presentation.presentationId), `${path}.accepted`)
  const diagnostics = boundedArray(input.diagnostics, `${path}.diagnostics`, 512)
    .map((diagnostic, index) => parseDiagnostic(diagnostic, `${path}.diagnostics[${index}]`))
  unique(diagnostics.map(diagnostic => diagnostic.diagnosticId), `${path}.diagnostics`)
  if (offers.some(offer => offer.mapSlug !== mapSlug || offer.mapRevision !== mapRevision)
    || pending.some(view => view.mapSlug !== mapSlug || view.mapRevision !== mapRevision)
    || accepted.some(presentation => presentation.mapSlug !== mapSlug || presentation.revision > mapRevision)) {
    fail('inconsistent-contract', path, 'nested offers, pending views, and accepted facts must match the projection map/revision.')
  }
  const offerIds = new Set(offers.map(offer => offer.offerId))
  if (affordances.some(affordance => affordance.linkedOfferId !== null && !offerIds.has(affordance.linkedOfferId))) {
    fail('inconsistent-contract', `${path}.affordances`, 'linkedOfferId must reference an offer in the same projection.')
  }
  const projection = Object.freeze({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    projectionId: stableId(input.projectionId, `${path}.projectionId`),
    audience: enumValue<EncounterProjectionAudience>(input.audience, AUDIENCES, `${path}.audience`),
    mapSlug,
    mapRevision,
    generatedAt: safeInteger(input.generatedAt, `${path}.generatedAt`),
    offers: Object.freeze(offers),
    passives: Object.freeze(passives),
    affordances: Object.freeze(affordances),
    pending: Object.freeze(pending),
    accepted: Object.freeze(accepted),
    diagnostics: Object.freeze(diagnostics),
  })
  assertProjectionPrivacy(projection, path)
  const bytes = new TextEncoder().encode(stableJsonStringify(projection)).byteLength
  if (bytes > ENCOUNTER_PRESENTATION_LIMITS.realtimeBytes) {
    fail('limit-exceeded', path, `must encode to at most ${ENCOUNTER_PRESENTATION_LIMITS.realtimeBytes} bytes.`)
  }
  return projection
}

export const parseEncounterPresentationProjection = (
  value: unknown,
): EncounterPresentationProjection => deepFreezeStrictJson(
  parseProjection(clone(value, 'encounterPresentation'), 'encounterPresentation'),
)

const parseSelection = (value: unknown, path: string): EncounterChoiceSelection => {
  const input = record(value, path)
  exact(input, ['choiceId', 'optionIds'], path)
  const optionIds = boundedArray(input.optionIds, `${path}.optionIds`, ENCOUNTER_PRESENTATION_LIMITS.selectedOptions)
    .map((optionId, index) => stableId(optionId, `${path}.optionIds[${index}]`))
  unique(optionIds, `${path}.optionIds`)
  return Object.freeze({
    choiceId: stableId(input.choiceId, `${path}.choiceId`),
    optionIds: Object.freeze(optionIds),
  })
}

export const parseEncounterActionDeclarationIntent = (
  value: unknown,
): EncounterActionDeclarationIntent => {
  const input = record(clone(value, 'encounterActionDeclaration'), 'encounterActionDeclaration')
  exact(input, [
    'schemaVersion', 'intentId', 'offerId', 'mapSlug', 'baseRevision',
    'actorParticipantId', 'actionId', 'selections',
  ], 'encounterActionDeclaration')
  parseSchemaVersion(input.schemaVersion, 'encounterActionDeclaration.schemaVersion')
  const selections = boundedArray(
    input.selections,
    'encounterActionDeclaration.selections',
    ENCOUNTER_PRESENTATION_LIMITS.choicesPerInteraction,
  ).map((selection, index) => parseSelection(selection, `encounterActionDeclaration.selections[${index}]`))
  unique(selections.map(selection => selection.choiceId), 'encounterActionDeclaration.selections')
  return deepFreezeStrictJson({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    intentId: stableId(input.intentId, 'encounterActionDeclaration.intentId'),
    offerId: stableId(input.offerId, 'encounterActionDeclaration.offerId'),
    mapSlug: stableId(input.mapSlug, 'encounterActionDeclaration.mapSlug'),
    baseRevision: safeInteger(input.baseRevision, 'encounterActionDeclaration.baseRevision'),
    actorParticipantId: stableId(input.actorParticipantId, 'encounterActionDeclaration.actorParticipantId'),
    actionId: stableId(input.actionId, 'encounterActionDeclaration.actionId'),
    selections: Object.freeze(selections),
  })
}

export const parseEncounterInteractionResponseIntent = (
  value: unknown,
): EncounterInteractionResponseIntent => {
  const input = record(clone(value, 'encounterInteractionResponse'), 'encounterInteractionResponse')
  exact(input, [
    'schemaVersion', 'responseId', 'interactionId', 'resolutionId', 'windowId',
    'retryKey', 'mapSlug', 'baseRevision', 'decision', 'selections',
  ], 'encounterInteractionResponse')
  parseSchemaVersion(input.schemaVersion, 'encounterInteractionResponse.schemaVersion')
  const decision = enumValue<EncounterInteractionResponseIntent['decision']>(
    input.decision,
    RESPONSE_DECISIONS,
    'encounterInteractionResponse.decision',
  )
  const selections = boundedArray(
    input.selections,
    'encounterInteractionResponse.selections',
    ENCOUNTER_PRESENTATION_LIMITS.choicesPerInteraction,
  ).map((selection, index) => parseSelection(selection, `encounterInteractionResponse.selections[${index}]`))
  unique(selections.map(selection => selection.choiceId), 'encounterInteractionResponse.selections')
  if ((decision === 'choose') !== (selections.length > 0)) {
    fail('inconsistent-contract', 'encounterInteractionResponse.selections', 'are required only for choose decisions.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    responseId: stableId(input.responseId, 'encounterInteractionResponse.responseId'),
    interactionId: stableId(input.interactionId, 'encounterInteractionResponse.interactionId'),
    resolutionId: stableId(input.resolutionId, 'encounterInteractionResponse.resolutionId'),
    windowId: stableId(input.windowId, 'encounterInteractionResponse.windowId'),
    retryKey: stableId(input.retryKey, 'encounterInteractionResponse.retryKey'),
    mapSlug: stableId(input.mapSlug, 'encounterInteractionResponse.mapSlug'),
    baseRevision: safeInteger(input.baseRevision, 'encounterInteractionResponse.baseRevision'),
    decision,
    selections: Object.freeze(selections),
  })
}

export const encounterPresentationStableJson = (value: unknown): string => stableJsonStringify(
  parseEncounterPresentationProjection(value),
  {
    path: 'encounterPresentation',
    limits: {
      maxDepth: ENCOUNTER_PRESENTATION_LIMITS.jsonDepth,
      maxNodes: ENCOUNTER_PRESENTATION_LIMITS.jsonNodes,
      maxObjectFields: ENCOUNTER_PRESENTATION_LIMITS.objectFields,
      maxArrayEntries: ENCOUNTER_PRESENTATION_LIMITS.arrayEntries,
      maxStringLength: ENCOUNTER_PRESENTATION_LIMITS.diagnosticLength,
    },
  },
)

export const computeEncounterPresentationSha256 = async (value: unknown): Promise<string> => (
  computeRulesetSourceSha256(encounterPresentationStableJson(value))
)
