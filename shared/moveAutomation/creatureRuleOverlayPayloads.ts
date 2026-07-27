import type { AbilityTransformationAbilitySnapshot } from '../abilityAutomation/transformations'
import { parseAbilityTransformationAbilitySnapshot } from '../abilityAutomation/transformations'
import {
  POKEMON_TYPE_IDS,
  pokemonTypeId,
  type PokemonTypeId,
} from '../pokemonTypes'

export const ENCOUNTER_CREATURE_RULE_COLLECTION_ACTIONS = [
  'add',
  'replace',
  'suppress',
  'copy',
  'swap',
] as const
export const ENCOUNTER_CREATURE_RULE_REFERENCE_ACTIONS = ['copy', 'swap'] as const
export const ENCOUNTER_CREATURE_RULE_SUPPRESSION_SCOPES = ['listed', 'all'] as const
export const ENCOUNTER_CREATURE_RULE_SIZES = [
  'small',
  'medium',
  'large',
  'huge',
  'gigantic',
] as const

export const ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS = Object.freeze({
  typeIds: 4,
  abilityNames: 32,
  identifierChars: 160,
  textChars: 160,
})

export type EncounterCreatureRuleCollectionAction =
  (typeof ENCOUNTER_CREATURE_RULE_COLLECTION_ACTIONS)[number]
export type EncounterCreatureRuleReferenceAction =
  (typeof ENCOUNTER_CREATURE_RULE_REFERENCE_ACTIONS)[number]
export type EncounterCreatureRuleSuppressionScope =
  (typeof ENCOUNTER_CREATURE_RULE_SUPPRESSION_SCOPES)[number]
export type EncounterCreatureRuleSize =
  (typeof ENCOUNTER_CREATURE_RULE_SIZES)[number]

interface EncounterCreatureRuleCollectionMutation {
  readonly action: 'add' | 'replace'
  readonly referencePlacementId: null
  readonly suppressionScope: null
}

interface EncounterCreatureRuleCollectionReferenceMutation {
  readonly action: EncounterCreatureRuleReferenceAction
  /** Server-observed provider/counterpart retained for provenance, never a live lookup instruction. */
  readonly referencePlacementId: string
  readonly suppressionScope: null
}

interface EncounterCreatureRuleCollectionSuppression {
  readonly action: 'suppress'
  readonly referencePlacementId: null
  readonly suppressionScope: EncounterCreatureRuleSuppressionScope
}

export type EncounterCreatureTypeOverlayPayload = {
  readonly domain: 'type'
  /** Final canonical values are snapshotted when copy/swap resolves. */
  readonly values: readonly PokemonTypeId[]
} & (
  | EncounterCreatureRuleCollectionMutation
  | EncounterCreatureRuleCollectionReferenceMutation
  | EncounterCreatureRuleCollectionSuppression
)

export type EncounterCreatureAbilityOverlayPayload = {
  readonly domain: 'ability'
  /** Final canonical names are snapshotted when copy/swap resolves. */
  readonly values: readonly string[]
  /** Optional immutable instance data for server-reviewed grants such as Receiver. */
  readonly abilitySnapshots?: readonly AbilityTransformationAbilitySnapshot[]
} & (
  | EncounterCreatureRuleCollectionMutation
  | EncounterCreatureRuleCollectionReferenceMutation
  | EncounterCreatureRuleCollectionSuppression
)

interface EncounterCreatureRuleScalarReplacement {
  readonly action: 'replace'
  readonly referencePlacementId: null
}

interface EncounterCreatureRuleScalarReference {
  readonly action: EncounterCreatureRuleReferenceAction
  readonly referencePlacementId: string
}

export type EncounterCreatureFormOverlayPayload = {
  readonly domain: 'form'
  readonly value: string
} & (EncounterCreatureRuleScalarReplacement | EncounterCreatureRuleScalarReference)

export type EncounterCreatureSizeOverlayPayload = {
  readonly domain: 'size'
  readonly value: EncounterCreatureRuleSize
} & (EncounterCreatureRuleScalarReplacement | EncounterCreatureRuleScalarReference)

export interface EncounterCreatureSonicLockOverlayPayload {
  readonly domain: 'sonic-lock'
  readonly action: 'lock'
}

/** Closed durable payload for non-destructive creature-rule projections. */
export type EncounterCreatureRuleOverlayEffectPayload =
  | EncounterCreatureTypeOverlayPayload
  | EncounterCreatureAbilityOverlayPayload
  | EncounterCreatureFormOverlayPayload
  | EncounterCreatureSizeOverlayPayload
  | EncounterCreatureSonicLockOverlayPayload

export type EncounterCreatureRuleOverlayValidationCode =
  | 'invalid-creature-rule-overlay'
  | 'limit-exceeded'
  | 'duplicate-id'

export class EncounterCreatureRuleOverlayValidationError extends Error {
  readonly code: EncounterCreatureRuleOverlayValidationCode
  readonly path: string
  readonly detail: string

  constructor(
    code: EncounterCreatureRuleOverlayValidationCode,
    path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'EncounterCreatureRuleOverlayValidationError'
    this.code = code
    this.path = path
    this.detail = detail
  }
}

type UnknownRecord = Record<string, unknown>

const COLLECTION_FIELDS = [
  'domain',
  'action',
  'values',
  'referencePlacementId',
  'suppressionScope',
] as const
const ABILITY_SNAPSHOT_COLLECTION_FIELDS = [...COLLECTION_FIELDS, 'abilitySnapshots'] as const
const SCALAR_FIELDS = ['domain', 'action', 'value', 'referencePlacementId'] as const
const SONIC_LOCK_FIELDS = ['domain', 'action'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const COLLECTION_ACTION_SET = new Set<string>(ENCOUNTER_CREATURE_RULE_COLLECTION_ACTIONS)
const REFERENCE_ACTION_SET = new Set<string>(ENCOUNTER_CREATURE_RULE_REFERENCE_ACTIONS)
const SUPPRESSION_SCOPE_SET = new Set<string>(ENCOUNTER_CREATURE_RULE_SUPPRESSION_SCOPES)
const SIZE_SET = new Set<string>(ENCOUNTER_CREATURE_RULE_SIZES)
const TYPE_ID_SET = new Set<string>(POKEMON_TYPE_IDS)

const fail = (
  code: EncounterCreatureRuleOverlayValidationCode,
  path: string,
  detail: string,
): never => {
  throw new EncounterCreatureRuleOverlayValidationError(code, path, detail)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-creature-rule-overlay', path, 'must be a plain object.')
  }
  return value
}

const assertExactFields = (
  record: UnknownRecord,
  fields: readonly string[],
  path: string,
): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return
  const details = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  fail(
    'invalid-creature-rule-overlay',
    path,
    `must contain exactly the supported fields (${details}).`,
  )
}

const parseStableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.identifierChars
    || value.trim() !== value
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return fail(
      'invalid-creature-rule-overlay',
      path,
      `must be a lowercase stable identifier of at most ${ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.identifierChars} characters.`,
    )
  }
  return value
}

const parseText = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.textChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-creature-rule-overlay',
      path,
      `must be trimmed text of at most ${ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.textChars} characters without control characters.`,
    )
  }
  return value
}

const parseArray = (
  value: unknown,
  path: string,
  maximum: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-creature-rule-overlay', path, 'must be an array.')
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  }
  return value
}

const assertUnique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) {
    fail('duplicate-id', path, 'must not contain duplicate values.')
  }
}

const parseTypeIds = (value: unknown, path: string): readonly PokemonTypeId[] => {
  const values = parseArray(
    value,
    path,
    ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.typeIds,
  ).map((entry, index) => {
    if (typeof entry !== 'string') {
      return fail('invalid-creature-rule-overlay', `${path}[${index}]`, 'must be a canonical Pokémon type ID.')
    }
    const parsed = pokemonTypeId(entry)
    if (!parsed || !TYPE_ID_SET.has(parsed)) {
      return fail(
        'invalid-creature-rule-overlay',
        `${path}[${index}]`,
        'must be a canonical lowercase Pokémon type ID.',
      )
    }
    if (entry !== parsed) {
      return fail(
        'invalid-creature-rule-overlay',
        `${path}[${index}]`,
        'must use canonical lowercase type spelling.',
      )
    }
    return parsed
  })
  assertUnique(values, path)
  return values
}

const parseAbilityNames = (value: unknown, path: string): readonly string[] => {
  const values = parseArray(
    value,
    path,
    ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.abilityNames,
  ).map((entry, index) => parseText(entry, `${path}[${index}]`))
  assertUnique(values.map(entry => entry.toLowerCase()), path)
  return values
}

const parseCollectionAction = (
  value: unknown,
  path: string,
): EncounterCreatureRuleCollectionAction => {
  if (typeof value !== 'string' || !COLLECTION_ACTION_SET.has(value)) {
    return fail(
      'invalid-creature-rule-overlay',
      path,
      'must be add, replace, suppress, copy, or swap.',
    )
  }
  return value as EncounterCreatureRuleCollectionAction
}

const parseCollectionReference = (
  action: EncounterCreatureRuleCollectionAction,
  value: unknown,
  path: string,
): string | null => {
  if (REFERENCE_ACTION_SET.has(action)) {
    if (value === null) {
      return fail('invalid-creature-rule-overlay', path, `${action} requires a reference placement ID.`)
    }
    return parseStableId(value, path)
  }
  if (value !== null) {
    fail('invalid-creature-rule-overlay', path, 'must be null unless action is copy or swap.')
  }
  return null
}

const parseSuppressionScope = (
  action: EncounterCreatureRuleCollectionAction,
  value: unknown,
  valueCount: number,
  path: string,
): EncounterCreatureRuleSuppressionScope | null => {
  if (action !== 'suppress') {
    if (value !== null) {
      fail('invalid-creature-rule-overlay', path, 'must be null unless action is suppress.')
    }
    if (valueCount === 0) {
      fail('invalid-creature-rule-overlay', path.replace(/\.suppressionScope$/, '.values'), 'must not be empty for this action.')
    }
    return null
  }
  if (typeof value !== 'string' || !SUPPRESSION_SCOPE_SET.has(value)) {
    return fail('invalid-creature-rule-overlay', path, 'must be listed or all for suppression.')
  }
  if ((value === 'listed') !== (valueCount > 0)) {
    fail(
      'invalid-creature-rule-overlay',
      path.replace(/\.suppressionScope$/, '.values'),
      'must be non-empty exactly when suppressionScope is listed.',
    )
  }
  return value as EncounterCreatureRuleSuppressionScope
}

const parseCollection = (
  payload: UnknownRecord,
  path: string,
  domain: 'type' | 'ability',
): EncounterCreatureTypeOverlayPayload | EncounterCreatureAbilityOverlayPayload => {
  const hasAbilitySnapshots = domain === 'ability'
    && Object.prototype.hasOwnProperty.call(payload, 'abilitySnapshots')
  assertExactFields(
    payload,
    hasAbilitySnapshots ? ABILITY_SNAPSHOT_COLLECTION_FIELDS : COLLECTION_FIELDS,
    path,
  )
  const action = parseCollectionAction(payload.action, `${path}.action`)
  const values = domain === 'type'
    ? parseTypeIds(payload.values, `${path}.values`)
    : parseAbilityNames(payload.values, `${path}.values`)
  const referencePlacementId = parseCollectionReference(
    action,
    payload.referencePlacementId,
    `${path}.referencePlacementId`,
  )
  const suppressionScope = parseSuppressionScope(
    action,
    payload.suppressionScope,
    values.length,
    `${path}.suppressionScope`,
  )
  if (hasAbilitySnapshots) {
    if (action !== 'add') {
      fail('invalid-creature-rule-overlay', `${path}.abilitySnapshots`, 'are supported only for add operations.')
    }
    const snapshots = parseArray(
      payload.abilitySnapshots,
      `${path}.abilitySnapshots`,
      ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.abilityNames,
    ).map((snapshot, index) => parseAbilityTransformationAbilitySnapshot(
      snapshot,
      `${path}.abilitySnapshots[${index}]`,
    ))
    if (snapshots.length !== values.length
      || snapshots.some((snapshot, index) => snapshot.canonicalId !== values[index])) {
      fail(
        'invalid-creature-rule-overlay',
        `${path}.abilitySnapshots`,
        'must correspond one-for-one with canonical values.',
      )
    }
    if (new Set(snapshots.map(snapshot => snapshot.instanceId)).size !== snapshots.length) {
      fail('duplicate-id', `${path}.abilitySnapshots`, 'must not repeat instance IDs.')
    }
    return {
      domain,
      action,
      values,
      referencePlacementId,
      suppressionScope,
      abilitySnapshots: Object.freeze(snapshots),
    } as EncounterCreatureAbilityOverlayPayload
  }
  return {
    domain,
    action,
    values,
    referencePlacementId,
    suppressionScope,
  } as EncounterCreatureTypeOverlayPayload | EncounterCreatureAbilityOverlayPayload
}

const parseScalarReference = (
  action: unknown,
  referencePlacementId: unknown,
  path: string,
): EncounterCreatureRuleScalarReplacement | EncounterCreatureRuleScalarReference => {
  if (action !== 'replace' && action !== 'copy' && action !== 'swap') {
    return fail('invalid-creature-rule-overlay', `${path}.action`, 'must be replace, copy, or swap.')
  }
  if (action === 'replace') {
    if (referencePlacementId !== null) {
      fail('invalid-creature-rule-overlay', `${path}.referencePlacementId`, 'must be null for replace.')
    }
    return { action, referencePlacementId: null }
  }
  if (referencePlacementId === null) {
    return fail(
      'invalid-creature-rule-overlay',
      `${path}.referencePlacementId`,
      `${action} requires a reference placement ID.`,
    )
  }
  return {
    action,
    referencePlacementId: parseStableId(
      referencePlacementId,
      `${path}.referencePlacementId`,
    ),
  }
}

/** Strictly parse and detach one server-authored creature-rule overlay payload. */
export const parseEncounterCreatureRuleOverlayEffectPayload = (
  value: unknown,
  path = 'creatureRuleOverlay',
): EncounterCreatureRuleOverlayEffectPayload => {
  const payload = parseRecord(value, path)
  const domain = payload.domain
  if (domain === 'type' || domain === 'ability') {
    return parseCollection(payload, path, domain)
  }
  if (domain === 'form') {
    assertExactFields(payload, SCALAR_FIELDS, path)
    return {
      domain,
      ...parseScalarReference(payload.action, payload.referencePlacementId, path),
      value: parseStableId(payload.value, `${path}.value`),
    }
  }
  if (domain === 'size') {
    assertExactFields(payload, SCALAR_FIELDS, path)
    const reference = parseScalarReference(payload.action, payload.referencePlacementId, path)
    if (typeof payload.value !== 'string' || !SIZE_SET.has(payload.value)) {
      return fail(
        'invalid-creature-rule-overlay',
        `${path}.value`,
        'must be small, medium, large, huge, or gigantic.',
      )
    }
    return { domain, ...reference, value: payload.value as EncounterCreatureRuleSize }
  }
  if (domain === 'sonic-lock') {
    assertExactFields(payload, SONIC_LOCK_FIELDS, path)
    if (payload.action !== 'lock') {
      return fail('invalid-creature-rule-overlay', `${path}.action`, 'must be lock.')
    }
    return { domain, action: 'lock' }
  }
  return fail(
    'invalid-creature-rule-overlay',
    `${path}.domain`,
    'must be type, ability, form, size, or sonic-lock.',
  )
}
