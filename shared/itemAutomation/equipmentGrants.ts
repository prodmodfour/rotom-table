import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const EQUIPMENT_GRANT_SCHEMA_VERSION = 1 as const
export type EquipmentWeaponClass = 'small-melee' | 'large-melee' | 'short-range' | 'long-range'
export type EquipmentGrantExecutionStatus = 'native' | 'definition-missing'
export type EquipmentWeaponTargetingPolicy = 'melee' | 'ranged-line-of-sight'

export interface EquipmentWeaponProfileGrantV1 {
  readonly grantId: string
  readonly kind: 'weapon-profile'
  readonly weaponClass: EquipmentWeaponClass
  readonly pokemonWielderSizePolicy: 'small-only' | 'medium-plus' | 'trainer-only'
  readonly damageBaseBonus: number
  readonly accuracyCheckPenalty: number
  readonly rangeMinimumMeters: number
  readonly rangeMaximumMeters: number | null
  readonly handsRequired: 1 | 2
  readonly targetingPolicy: EquipmentWeaponTargetingPolicy
  readonly weaponRangeReplacesSingleTargetMoveRange: boolean
  readonly ammunitionPolicy: 'abstracted-no-tracked-consumption'
  readonly recoveryPolicy: 'no-canonical-projectile-recovery'
  readonly allowsStab: false
  readonly grantsReach: boolean
  readonly sourcePath: 'books/markdown/core/09-gear-and-items.md'
  readonly sourceSha256: string
  readonly executionStatus: EquipmentGrantExecutionStatus
}
export const applyEquipmentWeaponRangeToMoveRange = (
  profile: EquipmentWeaponProfileGrantV1,
  moveRange: string,
): string => {
  if (profile.targetingPolicy !== 'ranged-line-of-sight' || profile.rangeMaximumMeters === null) return moveRange
  const ranged = /\bMelee\b/iu.test(moveRange)
    ? moveRange.replace(/\bMelee\b/giu, String(profile.rangeMaximumMeters))
    : `${profile.rangeMaximumMeters}, ${moveRange}`
  return [
    ranged,
    'Ranged Weapon',
    ...(profile.rangeMinimumMeters > 0 ? [`Minimum Range ${profile.rangeMinimumMeters}`] : []),
  ].join(', ')
}

export const equipmentWeaponRangeLabel = (
  profile: EquipmentWeaponProfileGrantV1,
): string => profile.rangeMaximumMeters === null
  ? 'Melee'
  : profile.rangeMinimumMeters > 0
    ? `${profile.rangeMinimumMeters}–${profile.rangeMaximumMeters} meters`
    : `${profile.rangeMaximumMeters} meters`

export interface EquipmentMoveGrantV1 {
  readonly grantId: string
  readonly kind: 'move'
  readonly canonicalId: string
  readonly minimumCombatRank: 4 | 6
  readonly trainerEligible: boolean
  readonly pokemonWielderEligible: boolean
  readonly executionStatus: EquipmentGrantExecutionStatus
}
export interface EquipmentCapabilityGrantV1 {
  readonly grantId: string
  readonly kind: 'capability'
  readonly canonicalId: string
  readonly parameterLabel: string | null
  readonly activation: 'while-equipped' | 'while-re-breather-active'
}
export interface EquipmentAbilityGrantV1 {
  readonly grantId: string
  readonly kind: 'ability'
  readonly canonicalId: string
  readonly activation: 'while-equipped'
}
export interface EquipmentActionGrantV1 {
  readonly grantId: string
  readonly kind: 'action'
  readonly actionId: string
  readonly label: string
  readonly timing: 'standard' | 'swift' | 'free' | 'extended'
  readonly interactionRole: 'activated-action' | 'contextual-affordance'
  readonly targetKind: 'self' | 'participant' | 'item' | 'move' | 'cell'
  /** Executor readiness; guided actions still have a native declaration/commit dispatcher. */
  readonly executionStatus: 'native' | 'deferred'
  /** Reviewed end-to-end mechanic state, distinct from executor readiness. */
  readonly finalState: 'native' | 'guided' | 'deferred'
  readonly deferredTicket: string | null
}
export type EquipmentGrantV1 =
  | EquipmentWeaponProfileGrantV1
  | EquipmentMoveGrantV1
  | EquipmentCapabilityGrantV1
  | EquipmentAbilityGrantV1
  | EquipmentActionGrantV1

export interface EquipmentGrantDefinitionV1 {
  readonly canonicalItemId: string
  readonly canonicalRecordSha256: string
  readonly equipmentDefinitionSha256: string
  readonly grants: readonly EquipmentGrantV1[]
}
export interface EquipmentGrantDocumentV1 {
  readonly schemaVersion: typeof EQUIPMENT_GRANT_SCHEMA_VERSION
  readonly ticket: 'P8-047'
  readonly catalogSha256: string
  readonly equipmentDefinitionsSha256: string
  readonly definitionCount: number
  readonly grantingItemCount: number
  readonly grantCount: number
  readonly classificationPolicy: {
    readonly status: 'reviewed'
    readonly runtimeProseParsing: false
    readonly missingDefinitionPolicy: 'visible-unavailable-no-execution'
    readonly inactiveOrSuppressedPolicy: 'withdraw-immediately'
    readonly acceptedDurableEffectsSurviveSourceLoss: true
    readonly finalStateAuthorityPath: 'data/deferred-closure/item-action-matrix.v1.json'
    readonly finalStateAuthoritySha256: string
  }
  readonly definitions: readonly EquipmentGrantDefinitionV1[]
}

export class EquipmentGrantValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'EquipmentGrantValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[a-f0-9]{64}$/
const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const WEAPON_CLASSES = new Set(['small-melee', 'large-melee', 'short-range', 'long-range'])
const SIZE_POLICIES = new Set(['small-only', 'medium-plus', 'trainer-only'])
const WEAPON_TARGETING_POLICIES = new Set(['melee', 'ranged-line-of-sight'])
const WEAPON_SOURCE_PATH = 'books/markdown/core/09-gear-and-items.md' as const
const WEAPON_SOURCE_SHA256 = 'b700b95186df42500c49575d8e7f5396188809cb46cc22c3cb3df7b1e9f6b1e0'
const ITEM_ACTION_FINAL_STATE_PATH = 'data/deferred-closure/item-action-matrix.v1.json' as const
const ITEM_ACTION_FINAL_STATE_SHA256 = '1de4da8ae7fe2dd937b75975e6aa684339d8174c87ec088443acb37963518d83'
const REVIEWED_WEAPON_CLASSES = Object.freeze({
  'small-melee': Object.freeze({
    pokemonWielderSizePolicy: 'small-only', damageBaseBonus: 1, accuracyCheckPenalty: 0,
    rangeMinimumMeters: 0, rangeMaximumMeters: null, handsRequired: 1,
    targetingPolicy: 'melee', weaponRangeReplacesSingleTargetMoveRange: false,
  }),
  'large-melee': Object.freeze({
    pokemonWielderSizePolicy: 'medium-plus', damageBaseBonus: 2, accuracyCheckPenalty: 1,
    rangeMinimumMeters: 0, rangeMaximumMeters: null, handsRequired: 2,
    targetingPolicy: 'melee', weaponRangeReplacesSingleTargetMoveRange: false,
  }),
  'short-range': Object.freeze({
    pokemonWielderSizePolicy: 'trainer-only', damageBaseBonus: 0, accuracyCheckPenalty: 0,
    rangeMinimumMeters: 0, rangeMaximumMeters: 4, handsRequired: 1,
    targetingPolicy: 'ranged-line-of-sight', weaponRangeReplacesSingleTargetMoveRange: true,
  }),
  'long-range': Object.freeze({
    pokemonWielderSizePolicy: 'trainer-only', damageBaseBonus: 1, accuracyCheckPenalty: 1,
    rangeMinimumMeters: 4, rangeMaximumMeters: 12, handsRequired: 2,
    targetingPolicy: 'ranged-line-of-sight', weaponRangeReplacesSingleTargetMoveRange: true,
  }),
} as const satisfies Record<EquipmentWeaponClass, Record<string, unknown>>)
const TIMINGS = new Set(['standard', 'swift', 'free', 'extended'])
const ROLES = new Set(['activated-action', 'contextual-affordance'])
const TARGETS = new Set(['self', 'participant', 'item', 'move', 'cell'])

const fail = (path: string, detail: string): never => { throw new EquipmentGrantValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail(path, `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`)
}
const array = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(path, `must be an array with at most ${maximum} entries.`)
  return value as readonly unknown[]
}
const text = (value: unknown, path: string, maximum = 200): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(path, `must be non-empty trimmed text of at most ${maximum} characters.`)
  }
  return value as string
}
const stableId = (value: unknown, path: string): string => {
  const result = text(value, path)
  if (!STABLE_ID.test(result)) fail(path, 'must be a lowercase stable identity.')
  return result
}
const hash = (value: unknown, path: string): string => {
  const result = text(value, path, 64)
  if (!SHA256.test(result)) fail(path, 'must be a lowercase SHA-256 digest.')
  return result
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) fail(path, `must be a safe integer from 0 through ${maximum}.`)
  return Number(value)
}
const boolean = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') fail(path, 'must be boolean.')
  return value as boolean
}
const oneOf = <Value extends string>(value: unknown, values: ReadonlySet<string>, path: string): Value => {
  if (typeof value !== 'string' || !values.has(value)) fail(path, 'is unsupported.')
  return value as Value
}
const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) fail(path, 'must contain unique values.')
}

const parseGrant = (value: unknown, path: string): EquipmentGrantV1 => {
  const input = record(value, path)
  const grantId = stableId(input.grantId, `${path}.grantId`)
  if (input.kind === 'weapon-profile') {
    exact(input, [
      'grantId', 'kind', 'weaponClass', 'pokemonWielderSizePolicy',
      'damageBaseBonus', 'accuracyCheckPenalty', 'rangeMinimumMeters', 'rangeMaximumMeters',
      'handsRequired', 'targetingPolicy', 'weaponRangeReplacesSingleTargetMoveRange',
      'ammunitionPolicy', 'recoveryPolicy', 'allowsStab', 'grantsReach',
      'sourcePath', 'sourceSha256', 'executionStatus',
    ], path)
    const weaponClass = oneOf<EquipmentWeaponClass>(input.weaponClass, WEAPON_CLASSES, `${path}.weaponClass`)
    const sizePolicy = oneOf<EquipmentWeaponProfileGrantV1['pokemonWielderSizePolicy']>(input.pokemonWielderSizePolicy, SIZE_POLICIES, `${path}.pokemonWielderSizePolicy`)
    const targetingPolicy = oneOf<EquipmentWeaponTargetingPolicy>(input.targetingPolicy, WEAPON_TARGETING_POLICIES, `${path}.targetingPolicy`)
    const damageBaseBonus = integer(input.damageBaseBonus, `${path}.damageBaseBonus`, 10)
    const accuracyCheckPenalty = integer(input.accuracyCheckPenalty, `${path}.accuracyCheckPenalty`, 10)
    const rangeMinimumMeters = integer(input.rangeMinimumMeters, `${path}.rangeMinimumMeters`, 12)
    const rangeMaximumMeters = input.rangeMaximumMeters === null
      ? null
      : integer(input.rangeMaximumMeters, `${path}.rangeMaximumMeters`, 12)
    const handsRequired = integer(input.handsRequired, `${path}.handsRequired`, 2)
    const weaponRangeReplacesSingleTargetMoveRange = boolean(
      input.weaponRangeReplacesSingleTargetMoveRange,
      `${path}.weaponRangeReplacesSingleTargetMoveRange`,
    )
    const reviewed = REVIEWED_WEAPON_CLASSES[weaponClass]
    if (sizePolicy !== reviewed.pokemonWielderSizePolicy
      || damageBaseBonus !== reviewed.damageBaseBonus
      || accuracyCheckPenalty !== reviewed.accuracyCheckPenalty
      || rangeMinimumMeters !== reviewed.rangeMinimumMeters
      || rangeMaximumMeters !== reviewed.rangeMaximumMeters
      || handsRequired !== reviewed.handsRequired
      || targetingPolicy !== reviewed.targetingPolicy
      || weaponRangeReplacesSingleTargetMoveRange !== reviewed.weaponRangeReplacesSingleTargetMoveRange) {
      fail(path, 'weapon profile disagrees with the reviewed class policy.')
    }
    if (input.ammunitionPolicy !== 'abstracted-no-tracked-consumption'
      || input.recoveryPolicy !== 'no-canonical-projectile-recovery') {
      fail(path, 'weapon profile invents unreviewed ammunition or projectile recovery semantics.')
    }
    if (input.allowsStab !== false) fail(`${path}.allowsStab`, 'weapon attacks cannot benefit from STAB.')
    if (input.sourcePath !== WEAPON_SOURCE_PATH || input.sourceSha256 !== WEAPON_SOURCE_SHA256) {
      fail(path, 'weapon profile is not bound to the reviewed gear source fingerprint.')
    }
    if (input.executionStatus !== 'native') fail(`${path}.executionStatus`, 'all reviewed weapon classes must be native.')
    return {
      grantId, kind: 'weapon-profile', weaponClass,
      pokemonWielderSizePolicy: sizePolicy,
      damageBaseBonus,
      accuracyCheckPenalty,
      rangeMinimumMeters,
      rangeMaximumMeters,
      handsRequired: handsRequired as 1 | 2,
      targetingPolicy,
      weaponRangeReplacesSingleTargetMoveRange,
      ammunitionPolicy: 'abstracted-no-tracked-consumption',
      recoveryPolicy: 'no-canonical-projectile-recovery',
      allowsStab: false,
      grantsReach: boolean(input.grantsReach, `${path}.grantsReach`),
      sourcePath: WEAPON_SOURCE_PATH,
      sourceSha256: hash(input.sourceSha256, `${path}.sourceSha256`),
      executionStatus: 'native',
    }
  }
  if (input.kind === 'move') {
    exact(input, [
      'grantId', 'kind', 'canonicalId', 'minimumCombatRank', 'trainerEligible',
      'pokemonWielderEligible', 'executionStatus',
    ], path)
    const minimumCombatRank = input.minimumCombatRank
    if (minimumCombatRank !== 4 && minimumCombatRank !== 6) fail(`${path}.minimumCombatRank`, 'must be Adept (4) or Master (6).')
    const executionStatus = input.executionStatus
    if (executionStatus !== 'native' && executionStatus !== 'definition-missing') fail(`${path}.executionStatus`, 'is unsupported.')
    const pokemonEligible = boolean(input.pokemonWielderEligible, `${path}.pokemonWielderEligible`)
    if (minimumCombatRank === 6 && pokemonEligible) fail(path, 'Pokémon Wielder sources cannot grant Master-rank weapon Moves.')
    return {
      grantId, kind: 'move', canonicalId: text(input.canonicalId, `${path}.canonicalId`),
      minimumCombatRank: minimumCombatRank as 4 | 6,
      trainerEligible: boolean(input.trainerEligible, `${path}.trainerEligible`),
      pokemonWielderEligible: pokemonEligible,
      executionStatus: executionStatus as EquipmentGrantExecutionStatus,
    }
  }
  if (input.kind === 'capability') {
    exact(input, ['grantId', 'kind', 'canonicalId', 'parameterLabel', 'activation'], path)
    if (input.activation !== 'while-equipped' && input.activation !== 'while-re-breather-active') {
      fail(`${path}.activation`, 'is unsupported.')
    }
    if ((input.activation === 'while-re-breather-active') !== (input.canonicalId === 'Gilled')) {
      fail(path, 'conditional Re-Breather activation is reviewed only for Gilled.')
    }
    return {
      grantId, kind: 'capability', canonicalId: text(input.canonicalId, `${path}.canonicalId`),
      parameterLabel: input.parameterLabel === null ? null : text(input.parameterLabel, `${path}.parameterLabel`),
      activation: input.activation as EquipmentCapabilityGrantV1['activation'],
    }
  }
  if (input.kind === 'ability') {
    exact(input, ['grantId', 'kind', 'canonicalId', 'activation'], path)
    if (input.activation !== 'while-equipped') fail(`${path}.activation`, 'is unsupported.')
    return { grantId, kind: 'ability', canonicalId: text(input.canonicalId, `${path}.canonicalId`), activation: 'while-equipped' }
  }
  if (input.kind === 'action') {
    exact(input, [
      'grantId', 'kind', 'actionId', 'label', 'timing', 'interactionRole',
      'targetKind', 'executionStatus', 'finalState', 'deferredTicket',
    ], path)
    if (input.executionStatus !== 'deferred' && input.executionStatus !== 'native') {
      fail(`${path}.executionStatus`, 'is unsupported.')
    }
    const finalState = oneOf<EquipmentActionGrantV1['finalState']>(
      input.finalState,
      new Set(['native', 'guided', 'deferred']),
      `${path}.finalState`,
    )
    const deferredTicket = input.deferredTicket === null
      ? null
      : text(input.deferredTicket, `${path}.deferredTicket`)
    const nativeActionIds = new Set([
      'equipment.wonder-launcher.apply',
      'equipment.mega-ring.evolve',
      'equipment.mega-stone.evolve',
      'equipment.re-breather.activate',
      'equipment.light-shield.ready',
      'equipment.heavy-shield.ready',
      'equipment.shock-collar.activate',
      'equipment.glue-cannon.attack',
      'equipment.hand-net.attack',
      'equipment.weighted-nets.throw',
      'equipment.weighted-nets.pull',
      'equipment.fishing.old-rod',
      'equipment.fishing.good-rod',
      'equipment.fishing.super-rod',
      'equipment.snag-machine.convert',
    ])
    if ((input.executionStatus === 'native') !== (deferredTicket === null)
      || (finalState === 'deferred') !== (deferredTicket !== null)
      || (input.executionStatus === 'native' && !nativeActionIds.has(String(input.actionId)))) {
      fail(path, 'native executors require a reviewed final state; deferred actions require a follow-up ticket.')
    }
    return {
      grantId, kind: 'action', actionId: stableId(input.actionId, `${path}.actionId`),
      label: text(input.label, `${path}.label`),
      timing: oneOf<EquipmentActionGrantV1['timing']>(input.timing, TIMINGS, `${path}.timing`),
      interactionRole: oneOf<EquipmentActionGrantV1['interactionRole']>(input.interactionRole, ROLES, `${path}.interactionRole`),
      targetKind: oneOf<EquipmentActionGrantV1['targetKind']>(input.targetKind, TARGETS, `${path}.targetKind`),
      executionStatus: input.executionStatus as EquipmentActionGrantV1['executionStatus'],
      finalState,
      deferredTicket,
    }
  }
  return fail(`${path}.kind`, 'is unsupported.')
}

export const parseEquipmentGrantDocument = (value: unknown): EquipmentGrantDocumentV1 => {
  const input = record(cloneStrictJson(value, 'equipmentGrants', {
    limits: { depth: 10, nodes: 20_000, objectFields: 32, arrayEntries: 512, stringLength: 500, objectKeyLength: 100 },
    rootLabel: 'equipment grant data', valueLabel: 'equipment grants',
    failNotJson: (path, detail) => fail(path, detail),
    failLimit: (path, detail) => fail(path, detail),
  }), 'equipmentGrants')
  exact(input, [
    'schemaVersion', 'ticket', 'catalogSha256', 'equipmentDefinitionsSha256',
    'definitionCount', 'grantingItemCount', 'grantCount', 'classificationPolicy', 'definitions',
  ], 'equipmentGrants')
  if (input.schemaVersion !== 1 || input.ticket !== 'P8-047') fail('equipmentGrants.schemaVersion', 'is unsupported.')
  const policy = record(input.classificationPolicy, 'equipmentGrants.classificationPolicy')
  exact(policy, [
    'status', 'runtimeProseParsing', 'missingDefinitionPolicy',
    'inactiveOrSuppressedPolicy', 'acceptedDurableEffectsSurviveSourceLoss',
    'finalStateAuthorityPath', 'finalStateAuthoritySha256',
  ], 'equipmentGrants.classificationPolicy')
  if (policy.status !== 'reviewed' || policy.runtimeProseParsing !== false
    || policy.missingDefinitionPolicy !== 'visible-unavailable-no-execution'
    || policy.inactiveOrSuppressedPolicy !== 'withdraw-immediately'
    || policy.acceptedDurableEffectsSurviveSourceLoss !== true
    || policy.finalStateAuthorityPath !== ITEM_ACTION_FINAL_STATE_PATH
    || policy.finalStateAuthoritySha256 !== ITEM_ACTION_FINAL_STATE_SHA256) {
    fail('equipmentGrants.classificationPolicy', 'must retain reviewed source-loss and fail-closed semantics.')
  }
  const definitions = array(input.definitions, 'equipmentGrants.definitions', 256)
    .map((entry, index): EquipmentGrantDefinitionV1 => {
      const path = `equipmentGrants.definitions[${index}]`
      const row = record(entry, path)
      exact(row, ['canonicalItemId', 'canonicalRecordSha256', 'equipmentDefinitionSha256', 'grants'], path)
      const grants = array(row.grants, `${path}.grants`, 16)
        .map((grant, grantIndex) => parseGrant(grant, `${path}.grants[${grantIndex}]`))
      unique(grants.map(grant => grant.grantId), `${path}.grants.grantId`)
      return {
        canonicalItemId: text(row.canonicalItemId, `${path}.canonicalItemId`),
        canonicalRecordSha256: hash(row.canonicalRecordSha256, `${path}.canonicalRecordSha256`),
        equipmentDefinitionSha256: hash(row.equipmentDefinitionSha256, `${path}.equipmentDefinitionSha256`),
        grants,
      }
    })
  const definitionCount = integer(input.definitionCount, 'equipmentGrants.definitionCount', 256)
  const grantingItemCount = integer(input.grantingItemCount, 'equipmentGrants.grantingItemCount', 256)
  const grantCount = integer(input.grantCount, 'equipmentGrants.grantCount', 4096)
  if (definitionCount !== definitions.length) fail('equipmentGrants.definitionCount', 'does not match definitions.')
  if (grantingItemCount !== definitions.filter(row => row.grants.length > 0).length) fail('equipmentGrants.grantingItemCount', 'does not match granting definitions.')
  if (grantCount !== definitions.reduce((sum, row) => sum + row.grants.length, 0)) fail('equipmentGrants.grantCount', 'does not match grants.')
  unique(definitions.map(row => row.canonicalItemId), 'equipmentGrants.definitions.canonicalItemId')
  unique(definitions.flatMap(row => row.grants.map(grant => grant.grantId)), 'equipmentGrants.grantIds')
  return deepFreezeStrictJson({
    schemaVersion: EQUIPMENT_GRANT_SCHEMA_VERSION,
    ticket: 'P8-047',
    catalogSha256: hash(input.catalogSha256, 'equipmentGrants.catalogSha256'),
    equipmentDefinitionsSha256: hash(input.equipmentDefinitionsSha256, 'equipmentGrants.equipmentDefinitionsSha256'),
    definitionCount,
    grantingItemCount,
    grantCount,
    classificationPolicy: {
      status: 'reviewed', runtimeProseParsing: false,
      missingDefinitionPolicy: 'visible-unavailable-no-execution',
      inactiveOrSuppressedPolicy: 'withdraw-immediately',
      acceptedDurableEffectsSurviveSourceLoss: true,
      finalStateAuthorityPath: ITEM_ACTION_FINAL_STATE_PATH,
      finalStateAuthoritySha256: hash(policy.finalStateAuthoritySha256, 'equipmentGrants.classificationPolicy.finalStateAuthoritySha256'),
    },
    definitions,
  })
}
