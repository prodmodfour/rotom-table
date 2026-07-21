import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import { ABILITY_COMBAT_PROVIDER_TYPE_IDS, type AbilityCombatProviderTypeId } from './combatProviders'

export const ABILITY_MOVE_PROVIDER_SCHEMA_VERSION = 1 as const
export const ABILITY_MOVE_PROVIDER_EFFECT_KINDS = ['mutation', 'grant', 'connection', 'disable', 'replacement', 'nested-use'] as const
export const ABILITY_MOVE_PROVIDER_STACKING_POLICIES = ['stack', 'priority', 'exclusive'] as const
export type AbilityMoveProviderEffectKind = (typeof ABILITY_MOVE_PROVIDER_EFFECT_KINDS)[number]
export type AbilityMoveProviderStackingPolicy = (typeof ABILITY_MOVE_PROVIDER_STACKING_POLICIES)[number]
export interface AbilityMoveRuntimeSnapshot {
  readonly moveInstanceId: string
  readonly canonicalMoveId: string
  readonly runtimeKind: 'movespec-v2'
  readonly runtimeVersion: number
  readonly definitionHash: string
  readonly sourceModule: string
  readonly sourceKind: 'sheet' | 'granted' | 'replacement'
  readonly mechanics: {
    readonly typeId: AbilityCombatProviderTypeId | null
    readonly damageBase: number | null
    readonly accuracyCheck: number | null
    readonly damageClass: 'physical' | 'special' | 'status' | null
    readonly frequencyId: string | null
    readonly rangeId: string | null
    readonly keywords: readonly string[]
  }
}
export interface AbilityMoveMutation {
  readonly typeId: AbilityCombatProviderTypeId | null
  readonly damageBaseOperation: 'add' | 'set' | null
  readonly damageBaseValue: number | null
  readonly accuracyOperation: 'add' | 'set' | null
  readonly accuracyValue: number | null
  readonly damageClass: 'physical' | 'special' | 'status' | null
  readonly frequencyId: string | null
  readonly rangeId: string | null
  readonly addKeywords: readonly string[]
  readonly removeKeywords: readonly string[]
}
export type AbilityMoveProviderEffect =
  | { readonly kind: 'mutation'; readonly moveInstanceIds: readonly string[]; readonly mutation: AbilityMoveMutation }
  | { readonly kind: 'grant'; readonly moves: readonly AbilityMoveRuntimeSnapshot[] }
  | { readonly kind: 'connection'; readonly moveInstanceIds: readonly string[]; readonly connectionId: string; readonly action: 'add' | 'remove' }
  | { readonly kind: 'disable'; readonly moveInstanceIds: readonly string[] }
  | { readonly kind: 'replacement'; readonly removeMoveInstanceIds: readonly string[]; readonly moves: readonly AbilityMoveRuntimeSnapshot[] }
  | {
      readonly kind: 'nested-use'
      readonly move: AbilityMoveRuntimeSnapshot
      readonly targetPolicy: 'inherit-selected' | 'self' | 'new-reviewed-selection'
      readonly costPolicy: 'pay-normal' | 'waive-reviewed'
      readonly maximumDepth: number
    }
export interface AbilityMoveProvider {
  readonly schemaVersion: typeof ABILITY_MOVE_PROVIDER_SCHEMA_VERSION
  readonly providerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly sourcePlacementId: string
  readonly ownerPlacementId: string
  readonly effect: AbilityMoveProviderEffect
  readonly stackingGroup: string
  readonly stackingPolicy: AbilityMoveProviderStackingPolicy
  readonly priority: number
  readonly reasonCode: string
}
export interface AbilityMoveProjection {
  readonly snapshot: AbilityMoveRuntimeSnapshot
  readonly enabled: boolean
  readonly disabledByProviderIds: readonly string[]
  readonly connectionIds: readonly string[]
  readonly mutationProviderIds: readonly string[]
}
export interface AbilityNestedMoveUse {
  readonly providerId: string
  readonly parentOperationId: string
  readonly move: AbilityMoveRuntimeSnapshot
  readonly targetPolicy: 'inherit-selected' | 'self' | 'new-reviewed-selection'
  readonly costPolicy: 'pay-normal' | 'waive-reviewed'
  readonly maximumDepth: number
}
export interface AbilityMoveProviderTraceEntry {
  readonly providerId: string
  readonly effectKind: AbilityMoveProviderEffectKind
  readonly status: 'applied' | 'shadowed' | 'move-missing' | 'no-op'
  readonly moveInstanceIds: readonly string[]
  readonly reasonCode: string
}
export interface AbilityMoveProviderResolution {
  readonly ownerPlacementId: string
  readonly moves: readonly AbilityMoveProjection[]
  readonly nestedUses: readonly AbilityNestedMoveUse[]
  readonly trace: readonly AbilityMoveProviderTraceEntry[]
}
export const ABILITY_MOVE_PROVIDER_LIMITS = Object.freeze({
  providers: 1_024, moves: 128, list: 128, identifier: 300, priority: 1_000,
  damageBase: 100, accuracy: 100, nestedDepth: 32,
})
export class AbilityMoveProviderValidationError extends Error {
  constructor(readonly code: 'invalid-provider' | 'duplicate-id' | 'stacking-conflict' | 'limit-exceeded' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityMoveProviderValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const PROVIDER_FIELDS = [
  'schemaVersion', 'providerId', 'abilityInstanceId', 'canonicalId', 'sourcePlacementId',
  'ownerPlacementId', 'effect', 'stackingGroup', 'stackingPolicy', 'priority', 'reasonCode',
] as const
const EFFECT_FIELDS: Readonly<Record<AbilityMoveProviderEffectKind, readonly string[]>> = {
  mutation: ['kind', 'moveInstanceIds', 'mutation'],
  grant: ['kind', 'moves'],
  connection: ['kind', 'moveInstanceIds', 'connectionId', 'action'],
  disable: ['kind', 'moveInstanceIds'],
  replacement: ['kind', 'removeMoveInstanceIds', 'moves'],
  'nested-use': ['kind', 'move', 'targetPolicy', 'costPolicy', 'maximumDepth'],
}
const SNAPSHOT_FIELDS = ['moveInstanceId', 'canonicalMoveId', 'runtimeKind', 'runtimeVersion', 'definitionHash', 'sourceModule', 'sourceKind', 'mechanics'] as const
const MECHANICS_FIELDS = ['typeId', 'damageBase', 'accuracyCheck', 'damageClass', 'frequencyId', 'rangeId', 'keywords'] as const
const MUTATION_FIELDS = ['typeId', 'damageBaseOperation', 'damageBaseValue', 'accuracyOperation', 'accuracyValue', 'damageClass', 'frequencyId', 'rangeId', 'addKeywords', 'removeKeywords'] as const
const EFFECT_SET = new Set<string>(ABILITY_MOVE_PROVIDER_EFFECT_KINDS)
const POLICY_SET = new Set<string>(ABILITY_MOVE_PROVIDER_STACKING_POLICIES)
const TYPE_SET = new Set<string>(ABILITY_COMBAT_PROVIDER_TYPE_IDS)
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const HASH = /^[a-f0-9]{64}$/
const fail = (code: AbilityMoveProviderValidationError['code'], path: string, detail: string): never => {
  throw new AbilityMoveProviderValidationError(code, path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-provider', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))) fail('invalid-provider', path, 'has invalid shape.')
}
const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_MOVE_PROVIDER_LIMITS.identifier || !ID.test(value)) {
    fail('invalid-provider', path, 'must be a bounded stable ID.')
  }
  return value as string
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_MOVE_PROVIDER_LIMITS.identifier
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-provider', path, 'must be bounded text.')
  return value as string
}
const enumValue = <Value extends string>(value: unknown, path: string, supported: ReadonlySet<string>): Value => (
  typeof value === 'string' && supported.has(value) ? value as Value : fail('invalid-provider', path, 'is unsupported.')
)
const integer = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail('invalid-provider', path, `must be from ${minimum} through ${maximum}.`)
  return Number(value)
}
const nullableId = (value: unknown, path: string): string | null => value === null ? null : stableId(value, path)
const ordered = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value) || value.length > ABILITY_MOVE_PROVIDER_LIMITS.list) fail('limit-exceeded', path, 'must be bounded.')
  const result = (value as unknown[]).map((entry, index) => stableId(entry, `${path}[${index}]`))
  if (new Set(result).size !== result.length || result.some((entry, index) => index > 0 && entry <= result[index - 1]!)) {
    fail('duplicate-id', path, 'must be unique in code-point order.')
  }
  return Object.freeze(result)
}
export const parseAbilityMoveRuntimeSnapshot = (value: unknown, path = 'moveSnapshot'): AbilityMoveRuntimeSnapshot => {
  const input = record(value, path)
  exact(input, SNAPSHOT_FIELDS, path)
  const mechanicsInput = record(input.mechanics, `${path}.mechanics`)
  exact(mechanicsInput, MECHANICS_FIELDS, `${path}.mechanics`)
  const typeId = mechanicsInput.typeId === null ? null : enumValue<AbilityCombatProviderTypeId>(mechanicsInput.typeId, `${path}.mechanics.typeId`, TYPE_SET)
  const damageClass = mechanicsInput.damageClass === null ? null : enumValue<'physical' | 'special' | 'status'>(mechanicsInput.damageClass, `${path}.mechanics.damageClass`, new Set(['physical', 'special', 'status']))
  if (input.runtimeKind !== 'movespec-v2' || typeof input.definitionHash !== 'string' || !HASH.test(input.definitionHash)) {
    fail('invalid-provider', path, 'must reference one hash-bound MoveSpec v2 runtime.')
  }
  return Object.freeze({
    moveInstanceId: stableId(input.moveInstanceId, `${path}.moveInstanceId`),
    canonicalMoveId: text(input.canonicalMoveId, `${path}.canonicalMoveId`),
    runtimeKind: 'movespec-v2', runtimeVersion: integer(input.runtimeVersion, `${path}.runtimeVersion`, 1, 1_000_000),
    definitionHash: input.definitionHash as string, sourceModule: text(input.sourceModule, `${path}.sourceModule`),
    sourceKind: enumValue<'sheet' | 'granted' | 'replacement'>(input.sourceKind, `${path}.sourceKind`, new Set(['sheet', 'granted', 'replacement'])),
    mechanics: Object.freeze({
      typeId,
      damageBase: mechanicsInput.damageBase === null ? null : integer(mechanicsInput.damageBase, `${path}.mechanics.damageBase`, 0, ABILITY_MOVE_PROVIDER_LIMITS.damageBase),
      accuracyCheck: mechanicsInput.accuracyCheck === null ? null : integer(mechanicsInput.accuracyCheck, `${path}.mechanics.accuracyCheck`, 0, ABILITY_MOVE_PROVIDER_LIMITS.accuracy),
      damageClass,
      frequencyId: nullableId(mechanicsInput.frequencyId, `${path}.mechanics.frequencyId`),
      rangeId: nullableId(mechanicsInput.rangeId, `${path}.mechanics.rangeId`),
      keywords: ordered(mechanicsInput.keywords, `${path}.mechanics.keywords`),
    }),
  })
}
const parseSnapshots = (value: unknown, path: string): readonly AbilityMoveRuntimeSnapshot[] => {
  if (!Array.isArray(value) || value.length > ABILITY_MOVE_PROVIDER_LIMITS.moves) fail('limit-exceeded', path, 'must be bounded.')
  const snapshots = (value as unknown[]).map((entry, index) => parseAbilityMoveRuntimeSnapshot(entry, `${path}[${index}]`))
  if (new Set(snapshots.map(entry => entry.moveInstanceId)).size !== snapshots.length) fail('duplicate-id', path, 'must not repeat move instance IDs.')
  return Object.freeze(snapshots)
}
const parseMutation = (value: unknown, path: string): AbilityMoveMutation => {
  const input = record(value, path)
  exact(input, MUTATION_FIELDS, path)
  const damageBaseOperation = input.damageBaseOperation === null ? null : enumValue<'add' | 'set'>(input.damageBaseOperation, `${path}.damageBaseOperation`, new Set(['add', 'set']))
  const accuracyOperation = input.accuracyOperation === null ? null : enumValue<'add' | 'set'>(input.accuracyOperation, `${path}.accuracyOperation`, new Set(['add', 'set']))
  if ((damageBaseOperation === null) !== (input.damageBaseValue === null)
    || (accuracyOperation === null) !== (input.accuracyValue === null)) fail('invalid-provider', path, 'numeric operations and values must be jointly present.')
  const addKeywords = ordered(input.addKeywords, `${path}.addKeywords`)
  const removeKeywords = ordered(input.removeKeywords, `${path}.removeKeywords`)
  if (addKeywords.some(keyword => removeKeywords.includes(keyword))) fail('invalid-provider', path, 'cannot add and remove one keyword.')
  return Object.freeze({
    typeId: input.typeId === null ? null : enumValue(input.typeId, `${path}.typeId`, TYPE_SET),
    damageBaseOperation,
    damageBaseValue: input.damageBaseValue === null ? null : integer(input.damageBaseValue, `${path}.damageBaseValue`, -ABILITY_MOVE_PROVIDER_LIMITS.damageBase, ABILITY_MOVE_PROVIDER_LIMITS.damageBase),
    accuracyOperation,
    accuracyValue: input.accuracyValue === null ? null : integer(input.accuracyValue, `${path}.accuracyValue`, -ABILITY_MOVE_PROVIDER_LIMITS.accuracy, ABILITY_MOVE_PROVIDER_LIMITS.accuracy),
    damageClass: input.damageClass === null ? null : enumValue(input.damageClass, `${path}.damageClass`, new Set(['physical', 'special', 'status'])),
    frequencyId: nullableId(input.frequencyId, `${path}.frequencyId`),
    rangeId: nullableId(input.rangeId, `${path}.rangeId`),
    addKeywords, removeKeywords,
  }) as AbilityMoveMutation
}
const parseEffect = (value: unknown, path: string): AbilityMoveProviderEffect => {
  const input = record(value, path)
  const kind = enumValue<AbilityMoveProviderEffectKind>(input.kind, `${path}.kind`, EFFECT_SET)
  exact(input, EFFECT_FIELDS[kind], path)
  if (kind === 'mutation') return Object.freeze({ kind, moveInstanceIds: ordered(input.moveInstanceIds, `${path}.moveInstanceIds`), mutation: parseMutation(input.mutation, `${path}.mutation`) })
  if (kind === 'grant') return Object.freeze({ kind, moves: parseSnapshots(input.moves, `${path}.moves`) })
  if (kind === 'connection') return Object.freeze({
    kind, moveInstanceIds: ordered(input.moveInstanceIds, `${path}.moveInstanceIds`),
    connectionId: stableId(input.connectionId, `${path}.connectionId`),
    action: enumValue(input.action, `${path}.action`, new Set(['add', 'remove'])),
  }) as Extract<AbilityMoveProviderEffect, { kind: 'connection' }>
  if (kind === 'disable') return Object.freeze({ kind, moveInstanceIds: ordered(input.moveInstanceIds, `${path}.moveInstanceIds`) })
  if (kind === 'replacement') return Object.freeze({ kind, removeMoveInstanceIds: ordered(input.removeMoveInstanceIds, `${path}.removeMoveInstanceIds`), moves: parseSnapshots(input.moves, `${path}.moves`) })
  return Object.freeze({
    kind,
    move: parseAbilityMoveRuntimeSnapshot(input.move, `${path}.move`),
    targetPolicy: enumValue(input.targetPolicy, `${path}.targetPolicy`, new Set(['inherit-selected', 'self', 'new-reviewed-selection'])),
    costPolicy: enumValue(input.costPolicy, `${path}.costPolicy`, new Set(['pay-normal', 'waive-reviewed'])),
    maximumDepth: integer(input.maximumDepth, `${path}.maximumDepth`, 1, ABILITY_MOVE_PROVIDER_LIMITS.nestedDepth),
  }) as Extract<AbilityMoveProviderEffect, { kind: 'nested-use' }>
}
export const parseAbilityMoveProviders = (value: unknown): readonly AbilityMoveProvider[] => {
  const cloned = cloneStrictJson(value, 'abilityMoveProviders', {
    limits: { depth: 12, nodes: 131_072, objectFields: 24, arrayEntries: ABILITY_MOVE_PROVIDER_LIMITS.providers, stringLength: 500, objectKeyLength: 200 },
    rootLabel: 'ability move providers', valueLabel: 'ability move provider values',
    failNotJson: (path, detail) => fail('not-json', path, detail),
    failLimit: (path, detail) => fail('limit-exceeded', path, detail),
  })
  if (!Array.isArray(cloned) || cloned.length > ABILITY_MOVE_PROVIDER_LIMITS.providers) fail('limit-exceeded', 'abilityMoveProviders', 'must be bounded.')
  const providers = (cloned as unknown[]).map((entry, index): AbilityMoveProvider => {
    const path = `abilityMoveProviders[${index}]`
    const input = record(entry, path)
    exact(input, PROVIDER_FIELDS, path)
    if (input.schemaVersion !== 1) fail('invalid-provider', `${path}.schemaVersion`, 'is unsupported.')
    if (!Number.isSafeInteger(input.priority) || Math.abs(Number(input.priority)) > ABILITY_MOVE_PROVIDER_LIMITS.priority) fail('invalid-provider', `${path}.priority`, 'must be bounded.')
    return Object.freeze({
      schemaVersion: 1, providerId: stableId(input.providerId, `${path}.providerId`),
      abilityInstanceId: stableId(input.abilityInstanceId, `${path}.abilityInstanceId`), canonicalId: text(input.canonicalId, `${path}.canonicalId`),
      sourcePlacementId: stableId(input.sourcePlacementId, `${path}.sourcePlacementId`), ownerPlacementId: stableId(input.ownerPlacementId, `${path}.ownerPlacementId`),
      effect: parseEffect(input.effect, `${path}.effect`), stackingGroup: stableId(input.stackingGroup, `${path}.stackingGroup`),
      stackingPolicy: enumValue(input.stackingPolicy, `${path}.stackingPolicy`, POLICY_SET),
      priority: Number(input.priority), reasonCode: stableId(input.reasonCode, `${path}.reasonCode`),
    }) as AbilityMoveProvider
  })
  if (new Set(providers.map(entry => entry.providerId)).size !== providers.length) fail('duplicate-id', 'abilityMoveProviders', 'must not repeat provider IDs.')
  return deepFreezeStrictJson(providers)
}
const compare = (left: AbilityMoveProvider, right: AbilityMoveProvider): number => left.priority - right.priority
  || (left.canonicalId < right.canonicalId ? -1 : left.canonicalId > right.canonicalId ? 1 : 0)
  || (left.abilityInstanceId < right.abilityInstanceId ? -1 : left.abilityInstanceId > right.abilityInstanceId ? 1 : 0)
  || (left.providerId < right.providerId ? -1 : left.providerId > right.providerId ? 1 : 0)
const selected = (providers: readonly AbilityMoveProvider[], trace: AbilityMoveProviderTraceEntry[]) => {
  if (providers.length === 0) return []
  const policy = providers[0]!.stackingPolicy
  if (providers.some(provider => provider.stackingPolicy !== policy)) fail('stacking-conflict', providers[0]!.stackingGroup, 'providers disagree on stacking policy.')
  if (policy === 'exclusive' && providers.length !== 1) fail('stacking-conflict', providers[0]!.stackingGroup, 'exclusive group has multiple providers.')
  if (policy === 'stack' || policy === 'exclusive') return [...providers]
  const winner = [...providers].sort(compare).at(-1)!
  providers.filter(provider => provider !== winner).forEach(provider => trace.push({
    providerId: provider.providerId, effectKind: provider.effect.kind, status: 'shadowed', moveInstanceIds: [], reasonCode: provider.reasonCode,
  }))
  return [winner]
}
const mutate = (snapshot: AbilityMoveRuntimeSnapshot, mutation: AbilityMoveMutation): AbilityMoveRuntimeSnapshot => {
  const keywords = new Set(snapshot.mechanics.keywords)
  mutation.removeKeywords.forEach(keyword => keywords.delete(keyword))
  mutation.addKeywords.forEach(keyword => keywords.add(keyword))
  const damageBase = mutation.damageBaseOperation === null || snapshot.mechanics.damageBase === null
    ? snapshot.mechanics.damageBase
    : mutation.damageBaseOperation === 'set' ? mutation.damageBaseValue!
      : snapshot.mechanics.damageBase + mutation.damageBaseValue!
  const accuracyCheck = mutation.accuracyOperation === null || snapshot.mechanics.accuracyCheck === null
    ? snapshot.mechanics.accuracyCheck
    : mutation.accuracyOperation === 'set' ? mutation.accuracyValue!
      : snapshot.mechanics.accuracyCheck + mutation.accuracyValue!
  return {
    ...snapshot,
    mechanics: {
      typeId: mutation.typeId ?? snapshot.mechanics.typeId,
      damageBase: damageBase === null ? null : Math.max(0, Math.min(ABILITY_MOVE_PROVIDER_LIMITS.damageBase, damageBase)),
      accuracyCheck: accuracyCheck === null ? null : Math.max(0, Math.min(ABILITY_MOVE_PROVIDER_LIMITS.accuracy, accuracyCheck)),
      damageClass: mutation.damageClass ?? snapshot.mechanics.damageClass,
      frequencyId: mutation.frequencyId ?? snapshot.mechanics.frequencyId,
      rangeId: mutation.rangeId ?? snapshot.mechanics.rangeId,
      keywords: Object.freeze([...keywords].sort()),
    },
  }
}
/** Resolve immutable move projections and declarations; this never executes a nested move. */
export const resolveAbilityMoveProviders = (input: {
  readonly ownerPlacementId: string
  readonly parentOperationId: string
  readonly baseMoves: unknown
  readonly providers: unknown
}): AbilityMoveProviderResolution => {
  if (!ID.test(input.ownerPlacementId) || !ID.test(input.parentOperationId)) fail('invalid-provider', 'abilityMoveProviderFact', 'identities are invalid.')
  const baseMoves = parseSnapshots(input.baseMoves, 'abilityMoveProviderFact.baseMoves')
  const all = [...parseAbilityMoveProviders(input.providers)]
    .filter(provider => provider.ownerPlacementId === input.ownerPlacementId)
    .sort(compare)
  const trace: AbilityMoveProviderTraceEntry[] = []
  const groups = new Map<string, AbilityMoveProvider[]>()
  for (const provider of all) {
    const key = `${provider.effect.kind}|${provider.stackingGroup}`
    groups.set(key, [...(groups.get(key) ?? []), provider])
  }
  const providers = [...groups.values()].flatMap(group => selected(group, trace)).sort((left, right) => {
    const order = new Map<AbilityMoveProviderEffectKind, number>([
      ['replacement', 0], ['grant', 1], ['mutation', 2],
      ['connection', 3], ['disable', 4], ['nested-use', 5],
    ])
    return order.get(left.effect.kind)! - order.get(right.effect.kind)! || compare(left, right)
  })
  const moves = new Map(baseMoves.map(snapshot => [snapshot.moveInstanceId, {
    snapshot, enabled: true, disabledByProviderIds: [] as string[], connectionIds: [] as string[], mutationProviderIds: [] as string[],
  }]))
  const nestedUses: AbilityNestedMoveUse[] = []
  for (const provider of providers) {
    const effect = provider.effect
    let touched: string[] = []
    if (effect.kind === 'replacement') {
      effect.removeMoveInstanceIds.forEach(id => { if (moves.delete(id)) touched.push(id) })
      for (const snapshot of effect.moves) {
        if (moves.has(snapshot.moveInstanceId)) fail('duplicate-id', provider.providerId, `replacement repeats move ${snapshot.moveInstanceId}.`)
        moves.set(snapshot.moveInstanceId, { snapshot: { ...snapshot, sourceKind: 'replacement' }, enabled: true, disabledByProviderIds: [], connectionIds: [], mutationProviderIds: [] })
        touched.push(snapshot.moveInstanceId)
      }
    }
    else if (effect.kind === 'grant') {
      for (const snapshot of effect.moves) {
        if (moves.has(snapshot.moveInstanceId)) fail('duplicate-id', provider.providerId, `grant repeats move ${snapshot.moveInstanceId}.`)
        moves.set(snapshot.moveInstanceId, { snapshot: { ...snapshot, sourceKind: 'granted' }, enabled: true, disabledByProviderIds: [], connectionIds: [], mutationProviderIds: [] })
        touched.push(snapshot.moveInstanceId)
      }
    }
    else if (effect.kind === 'mutation') {
      effect.moveInstanceIds.forEach((id) => {
        const move = moves.get(id)
        if (!move) return
        move.snapshot = mutate(move.snapshot, effect.mutation)
        move.mutationProviderIds.push(provider.providerId)
        touched.push(id)
      })
    }
    else if (effect.kind === 'connection') {
      effect.moveInstanceIds.forEach((id) => {
        const move = moves.get(id)
        if (!move) return
        const values = new Set(move.connectionIds)
        effect.action === 'add' ? values.add(effect.connectionId) : values.delete(effect.connectionId)
        move.connectionIds = [...values].sort()
        touched.push(id)
      })
    }
    else if (effect.kind === 'disable') {
      effect.moveInstanceIds.forEach((id) => {
        const move = moves.get(id)
        if (!move) return
        move.enabled = false
        move.disabledByProviderIds.push(provider.providerId)
        touched.push(id)
      })
    }
    else {
      nestedUses.push({
        providerId: provider.providerId, parentOperationId: input.parentOperationId,
        move: effect.move, targetPolicy: effect.targetPolicy, costPolicy: effect.costPolicy,
        maximumDepth: effect.maximumDepth,
      })
      touched = [effect.move.moveInstanceId]
    }
    trace.push({
      providerId: provider.providerId, effectKind: effect.kind,
      status: touched.length > 0 ? 'applied' : ('moveInstanceIds' in effect || 'removeMoveInstanceIds' in effect) ? 'move-missing' : 'no-op',
      moveInstanceIds: Object.freeze(touched), reasonCode: provider.reasonCode,
    })
  }
  return deepFreezeStrictJson({
    ownerPlacementId: input.ownerPlacementId,
    moves: Object.freeze([...moves.values()].map(move => ({
      snapshot: move.snapshot, enabled: move.enabled,
      disabledByProviderIds: Object.freeze([...move.disabledByProviderIds]),
      connectionIds: Object.freeze([...move.connectionIds]), mutationProviderIds: Object.freeze([...move.mutationProviderIds]),
    }))),
    nestedUses: Object.freeze(nestedUses), trace: Object.freeze(trace),
  })
}
