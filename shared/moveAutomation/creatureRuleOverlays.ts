import {
  parseEncounterEffects,
  type EncounterCapabilityEffect,
  type EncounterCreatureRuleOverlayEffect,
  type EncounterEffect,
  type EncounterEffectCell,
  type EncounterEffectDuration,
  type EncounterTransformationEffect,
} from './encounterEffects'
import {
  ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS,
  ENCOUNTER_CREATURE_RULE_SIZES,
  type EncounterCreatureAbilityOverlayPayload,
  type EncounterCreatureRuleOverlayEffectPayload,
  type EncounterCreatureRuleSize,
  type EncounterCreatureTypeOverlayPayload,
} from './creatureRuleOverlayPayloads'
import type { EncounterSideId } from './encounterState'
import { pokemonTypeId, type PokemonTypeId } from '../pokemonTypes'
import type { MovementGroundingState } from '~/types/movement'
import type { GridAnchor } from '~/types/pokemon'

export const ENCOUNTER_CREATURE_RULE_CAPABILITY_LIMIT = 128

export type EncounterCreatureRuleSourceDomain =
  | 'transformation'
  | 'type'
  | 'ability'
  | 'form'
  | 'size'
  | 'capability'
  | 'grounding'
  | 'sonic-lock'

export interface EncounterCreatureRuleSource {
  readonly effectId: string
  readonly operationId: string
  readonly moveId: string
  readonly sourcePlacementId: string
  readonly domain: EncounterCreatureRuleSourceDomain
  readonly action: string
  readonly duration: EncounterEffectDuration
}

/** Complete immutable creature facts consumed by type/ability/movement rules. */
export interface EffectiveEncounterCreatureRules {
  readonly placementId: string
  readonly typeIds: readonly PokemonTypeId[]
  readonly abilityNames: readonly string[]
  /** Stable rules form; renderer appearance remains a separate projection. */
  readonly formId: string
  /** Mechanical size does not resize the token footprint or sprite. */
  readonly size: EncounterCreatureRuleSize | null
  /** Stable sheet/effect capability identities after ordered grant/suppress overlays. */
  readonly capabilityIds: readonly string[]
  /** Final movement-query result, independent of display height. */
  readonly grounding: MovementGroundingState
  readonly sonicLocked: boolean
  /** Exact active durable sources in deterministic precedence order. */
  readonly sources: readonly EncounterCreatureRuleSource[]
  readonly sourceEffectIds: readonly string[]
  readonly sonicLockSourceEffectIds: readonly string[]
}

export interface EncounterCreatureRuleTarget {
  readonly placementId: string
  readonly sideId?: EncounterSideId
  readonly position?: GridAnchor
  readonly base?: number
  readonly clearance?: number
  readonly cells?: readonly EncounterEffectCell[]
}

export interface ProjectEncounterCreatureRulesInput {
  readonly base: {
    readonly typeIds: readonly string[]
    readonly abilityNames: readonly string[]
    readonly formId: string
    readonly size: string | null
    readonly capabilityIds: readonly string[]
    readonly grounding: MovementGroundingState
  }
  readonly effects?: readonly EncounterEffect[] | null
  readonly target: EncounterCreatureRuleTarget
}

export type EncounterCreatureRuleProjectionErrorCode =
  | 'invalid-base-form'
  | 'type-limit-exceeded'
  | 'ability-limit-exceeded'
  | 'capability-limit-exceeded'

export class EncounterCreatureRuleProjectionError extends Error {
  readonly code: EncounterCreatureRuleProjectionErrorCode

  constructor(code: EncounterCreatureRuleProjectionErrorCode, message: string) {
    super(message)
    this.name = 'EncounterCreatureRuleProjectionError'
    this.code = code
  }
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SIZE_SET = new Set<string>(ENCOUNTER_CREATURE_RULE_SIZES)

const fail = (
  code: EncounterCreatureRuleProjectionErrorCode,
  message: string,
): never => {
  throw new EncounterCreatureRuleProjectionError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const finitePositiveExtent = (value: number | undefined): number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
)

const sameCell = (left: EncounterEffectCell, right: EncounterEffectCell): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const targetOccupiesEffectCell = (
  target: EncounterCreatureRuleTarget,
  effectCell: EncounterEffectCell,
): boolean => {
  if (target.cells !== undefined) return target.cells.some(cell => sameCell(cell, effectCell))
  if (target.position === undefined) return false
  const base = finitePositiveExtent(target.base)
  const clearance = finitePositiveExtent(target.clearance)
  return effectCell.x >= target.position.x
    && effectCell.x < target.position.x + base
    && effectCell.y >= target.position.y
    && effectCell.y < target.position.y + clearance
    && effectCell.z >= target.position.z
    && effectCell.z < target.position.z + base
}

export const encounterCreatureRuleEffectAppliesToTarget = (
  effect: EncounterCreatureRuleOverlayEffect | EncounterCapabilityEffect,
  target: EncounterCreatureRuleTarget,
): boolean => (
  effect.affected.placementIds.includes(target.placementId)
  || (target.sideId !== undefined && effect.affected.sideIds.includes(target.sideId))
  || effect.affected.cells.some(cell => targetOccupiesEffectCell(target, cell))
)

export const encounterCreatureRuleEffectIsActive = (
  effect: EncounterCreatureRuleOverlayEffect | EncounterCapabilityEffect | EncounterTransformationEffect,
): boolean => effect.suppression.sources.length === 0 && effect.charges !== 0

const uniqueBy = (
  values: readonly string[],
  keyFor: (value: string) => string,
): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = keyFor(value)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

const normalizedBaseTypes = (values: readonly string[]): PokemonTypeId[] => (
  uniqueBy(values.flatMap((value) => {
    const typeId = pokemonTypeId(value)
    return typeId ? [typeId] : []
  }), value => value) as PokemonTypeId[]
)

const normalizedBaseAbilities = (values: readonly string[]): string[] => {
  const normalized = uniqueBy(
    values.map(value => value.trim()).filter(Boolean),
    value => value.toLowerCase(),
  )
  if (normalized.length > ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.abilityNames) {
    return fail(
      'ability-limit-exceeded',
      `Base ability projection exceeds ${ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.abilityNames} names.`,
    )
  }
  return normalized
}

const normalizedBaseForm = (value: string): string => {
  const normalized = value.trim().toLowerCase()
  if (
    !STABLE_ID_PATTERN.test(normalized)
    || normalized.length > ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.identifierChars
  ) {
    return fail('invalid-base-form', 'Creature base form must be a bounded stable identifier.')
  }
  return normalized
}

const normalizedBaseSize = (value: string | null): EncounterCreatureRuleSize | null => {
  if (value === null || value.trim() === '') return null
  const normalized = value.trim().toLowerCase()
  return SIZE_SET.has(normalized) ? normalized as EncounterCreatureRuleSize : null
}

const normalizedBaseCapabilities = (values: readonly string[]): string[] => {
  const normalized = uniqueBy(
    values.filter(value => STABLE_ID_PATTERN.test(value)),
    value => value,
  )
  if (normalized.length > ENCOUNTER_CREATURE_RULE_CAPABILITY_LIMIT) {
    return fail(
      'capability-limit-exceeded',
      `Creature capability projection exceeds ${ENCOUNTER_CREATURE_RULE_CAPABILITY_LIMIT} identities.`,
    )
  }
  return normalized
}

const replaceValues = (
  current: string[],
  values: readonly string[],
): void => {
  current.splice(0, current.length, ...values)
}

const addValues = (
  current: string[],
  values: readonly string[],
  keyFor: (value: string) => string,
): void => {
  const existing = new Set(current.map(keyFor))
  for (const value of values) {
    const key = keyFor(value)
    if (existing.has(key)) continue
    existing.add(key)
    current.push(value)
  }
}

const applyCollectionMutation = (
  current: string[],
  payload: EncounterCreatureTypeOverlayPayload | EncounterCreatureAbilityOverlayPayload,
  keyFor: (value: string) => string,
): void => {
  if (payload.action === 'suppress') return
  if (payload.action === 'add') addValues(current, payload.values, keyFor)
  else replaceValues(current, payload.values)
}

const applyCollectionSuppressions = (
  current: string[],
  payloads: readonly (
    EncounterCreatureTypeOverlayPayload | EncounterCreatureAbilityOverlayPayload
  )[],
  keyFor: (value: string) => string,
): void => {
  const suppressAll = payloads.some(payload => (
    payload.action === 'suppress' && payload.suppressionScope === 'all'
  ))
  if (suppressAll) {
    current.splice(0, current.length)
    return
  }
  const suppressed = new Set(payloads.flatMap(payload => (
    payload.action === 'suppress' ? payload.values.map(keyFor) : []
  )))
  if (suppressed.size === 0) return
  const retained = current.filter(value => !suppressed.has(keyFor(value)))
  replaceValues(current, retained)
}

const assertCollectionBounds = (
  typeIds: readonly string[],
  abilityNames: readonly string[],
): void => {
  if (typeIds.length > ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.typeIds) {
    fail(
      'type-limit-exceeded',
      `Effective creature types exceed ${ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.typeIds}.`,
    )
  }
  if (abilityNames.length > ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.abilityNames) {
    fail(
      'ability-limit-exceeded',
      `Effective creature abilities exceed ${ENCOUNTER_CREATURE_RULE_OVERLAY_LIMITS.abilityNames}.`,
    )
  }
}

const sourceDomainForCapability = (
  effect: EncounterCapabilityEffect,
): EncounterCreatureRuleSourceDomain => (
  effect.payload.capabilityId.startsWith('movement.grounding.')
    ? 'grounding'
    : 'capability'
)

const sourceFor = (
  effect: EncounterCreatureRuleOverlayEffect | EncounterCapabilityEffect | EncounterTransformationEffect,
  domain: EncounterCreatureRuleSourceDomain,
  action: string,
): EncounterCreatureRuleSource => ({
  effectId: effect.id,
  operationId: effect.source.operationId,
  moveId: effect.source.moveId,
  sourcePlacementId: effect.source.placementId,
  domain,
  action,
  duration: { ...effect.duration },
})

const sourceForOverlay = (
  effect: EncounterCreatureRuleOverlayEffect,
): EncounterCreatureRuleSource => sourceFor(
  effect,
  effect.payload.domain,
  effect.payload.action,
)

const activeTransformation = (
  effects: readonly EncounterEffect[],
  placementId: string,
): EncounterTransformationEffect | null => effects.find(
  (effect): effect is EncounterTransformationEffect => (
    effect.kind === 'transformation'
    && effect.affected.placementIds[0] === placementId
    && encounterCreatureRuleEffectIsActive(effect)
  ),
) ?? null

const activeApplicableEffects = (
  effects: readonly EncounterEffect[],
  target: EncounterCreatureRuleTarget,
): readonly (EncounterCreatureRuleOverlayEffect | EncounterCapabilityEffect)[] => effects.filter(
  (effect): effect is EncounterCreatureRuleOverlayEffect | EncounterCapabilityEffect => (
    (effect.kind === 'creature-rule-overlay' || effect.kind === 'capability')
    && encounterCreatureRuleEffectIsActive(effect)
    && encounterCreatureRuleEffectAppliesToTarget(effect, target)
  ),
)

const typePayloadsFor = (
  effects: readonly EncounterCreatureRuleOverlayEffect[],
): readonly EncounterCreatureTypeOverlayPayload[] => effects.flatMap(effect => (
  effect.payload.domain === 'type' ? [effect.payload] : []
))

const abilityPayloadsFor = (
  effects: readonly EncounterCreatureRuleOverlayEffect[],
): readonly EncounterCreatureAbilityOverlayPayload[] => effects.flatMap(effect => (
  effect.payload.domain === 'ability' ? [effect.payload] : []
))

const winningScalar = <Domain extends 'form' | 'size'>(
  effects: readonly EncounterCreatureRuleOverlayEffect[],
  domain: Domain,
): Extract<EncounterCreatureRuleOverlayEffectPayload, { readonly domain: Domain }> | null => {
  const matching = effects.flatMap(effect => effect.payload.domain === domain ? [effect.payload] : [])
  return matching.at(-1) as Extract<
    EncounterCreatureRuleOverlayEffectPayload,
    { readonly domain: Domain }
  > | null
}

/**
 * Resolve every creature-rule layer at one central precedence boundary.
 *
 * Transform supplies the base form first. Active mutation overlays then run in
 * encounter order; copy/swap payloads are already server-snapshotted values.
 * Type/ability suppressions are a final union so a live suppression cannot be
 * bypassed by a later add/copy. The last form/size overlay wins, capability
 * grants/suppressions retain established encounter order, grounding comes from
 * the final movement query, and any active sonic lock blocks Sonic declarations.
 */
export const projectEncounterCreatureRules = (
  input: ProjectEncounterCreatureRulesInput,
): EffectiveEncounterCreatureRules => {
  const effects = parseEncounterEffects(
    input.effects ?? [],
    'creatureRuleProjection.effects',
  )
  const transformation = activeTransformation(effects, input.target.placementId)
  const applicable = activeApplicableEffects(effects, input.target)
  const overlays = applicable.filter(
    (effect): effect is EncounterCreatureRuleOverlayEffect => effect.kind === 'creature-rule-overlay',
  )
  const capabilities = applicable.filter(
    (effect): effect is EncounterCapabilityEffect => effect.kind === 'capability',
  )

  const typeIds = normalizedBaseTypes(input.base.typeIds)
  const abilityNames = normalizedBaseAbilities(input.base.abilityNames)
  const typePayloads = typePayloadsFor(overlays)
  const abilityPayloads = abilityPayloadsFor(overlays)
  for (const payload of typePayloads) applyCollectionMutation(typeIds, payload, value => value)
  for (const payload of abilityPayloads) {
    applyCollectionMutation(abilityNames, payload, value => value.toLowerCase())
  }
  applyCollectionSuppressions(typeIds, typePayloads, value => value)
  applyCollectionSuppressions(abilityNames, abilityPayloads, value => value.toLowerCase())
  assertCollectionBounds(typeIds, abilityNames)

  const form = winningScalar(overlays, 'form')
  const size = winningScalar(overlays, 'size')
  const capabilityIds = normalizedBaseCapabilities(input.base.capabilityIds)
  for (const effect of capabilities) {
    const capabilityId = effect.payload.capabilityId
    const index = capabilityIds.indexOf(capabilityId)
    if (effect.payload.action === 'grant' && index < 0) capabilityIds.push(capabilityId)
    if (effect.payload.action === 'suppress' && index >= 0) capabilityIds.splice(index, 1)
  }
  if (capabilityIds.length > ENCOUNTER_CREATURE_RULE_CAPABILITY_LIMIT) {
    fail(
      'capability-limit-exceeded',
      `Effective creature capabilities exceed ${ENCOUNTER_CREATURE_RULE_CAPABILITY_LIMIT}.`,
    )
  }

  const sonicLockEffects = overlays.filter(effect => effect.payload.domain === 'sonic-lock')
  const sources = [
    ...(transformation
      ? [sourceFor(transformation, 'transformation', 'replace')]
      : []),
    ...applicable.map(effect => effect.kind === 'capability'
      ? sourceFor(effect, sourceDomainForCapability(effect), effect.payload.action)
      : sourceForOverlay(effect)),
  ]
  const sourceEffectIds = uniqueBy(sources.map(source => source.effectId), value => value)

  return deepFreeze({
    placementId: input.target.placementId,
    typeIds: [...typeIds] as PokemonTypeId[],
    abilityNames: [...abilityNames],
    formId: form?.value ?? normalizedBaseForm(input.base.formId),
    size: size?.value ?? normalizedBaseSize(input.base.size),
    capabilityIds: [...capabilityIds],
    grounding: input.base.grounding,
    sonicLocked: sonicLockEffects.length > 0,
    sources,
    sourceEffectIds,
    sonicLockSourceEffectIds: sonicLockEffects.map(effect => effect.id),
  })
}
