import canonicalAbilitiesJson from '../../../data/reference/abilities.json'
import protectionJson from '../../../data/ability-automation/protections.json'
import { ABILITY_RULESET_PROVENANCE } from '#shared/abilityAutomation/ruleset'
import { DEFAULT_ABILITY_PROTECTION } from '#shared/abilityAutomation/protections'
import {
  encounterCreatureRuleEffectAppliesToTarget,
  encounterCreatureRuleEffectIsActive,
  type EncounterCreatureRuleTarget,
} from '#shared/moveAutomation/creatureRuleOverlays'
import {
  parseEncounterEffects,
  type EncounterCreatureRuleOverlayEffect,
  type EncounterEffect,
  type EncounterTransformationEffect,
} from '#shared/moveAutomation/encounterEffects'
import type { EncounterCreatureAbilityOverlayPayload } from '#shared/moveAutomation/creatureRuleOverlayPayloads'
import {
  abilityInstanceParameterValues,
  type AbilityInstanceData,
  type AbilityInstanceParameterStatus,
} from '#shared/abilityAutomation/parameters'
import { fabulousTrimGrantedAbility } from '#shared/abilityAutomation/fabulousTrim'
import {
  AA083_POLTERGEIST_FORMS,
  aa083PoltergeistFormForSpecies,
} from '#shared/abilityAutomation/aa083'
import {
  createEmptyAbilityTransformationState,
  parseAbilityTransformationState,
  type AbilityTransformationState,
} from '#shared/abilityAutomation/transformations'
import type { AuthoritativeEffectiveAbility } from './context'
import { abilityRequiresInstanceParameters } from './instanceParameters'

export const EFFECTIVE_ABILITY_PROJECTION_LIMIT = 64 as const

export type EffectiveAbilityProjectionErrorCode =
  | 'invalid-protection-catalog'
  | 'protected-copy'
  | 'protected-transfer'
  | 'projection-limit-exceeded'

export class EffectiveAbilityProjectionError extends Error {
  readonly code: EffectiveAbilityProjectionErrorCode

  constructor(code: EffectiveAbilityProjectionErrorCode, detail: string) {
    super(detail)
    this.name = 'EffectiveAbilityProjectionError'
    this.code = code
  }
}

export interface ProjectedBaseAbilityInput {
  readonly instanceId: string
  readonly canonicalId: string
  readonly parameterStatus: AbilityInstanceParameterStatus
  readonly parameterData: AbilityInstanceData | null
}

export interface ProjectAuthoritativeEffectiveAbilitiesInput {
  /** Legacy compatibility input; parameterized names remain inactive. */
  readonly baseAbilityNames?: readonly string[]
  readonly baseAbilities?: readonly ProjectedBaseAbilityInput[]
  readonly target: EncounterCreatureRuleTarget
  /** Canonical species/form label used by species-owned ability projections. */
  readonly species?: string | null
  readonly effects?: readonly EncounterEffect[] | null
  readonly transformationSnapshots?: AbilityTransformationState | null
}

type Protection = Readonly<{
  copyable: boolean
  disableable: boolean
  transferable: boolean
}>

type MutableProjectedAbility = {
  -readonly [Key in keyof AuthoritativeEffectiveAbility]: AuthoritativeEffectiveAbility[Key]
}

const CANONICAL_IDS = new Set(Object.keys(canonicalAbilitiesJson))

export const isCanonicalAutomationAbility = (value: string): boolean => CANONICAL_IDS.has(value)
const PROTECTION_FIELDS = ['copyable', 'disableable', 'transferable'] as const

const fail = (code: EffectiveAbilityProjectionErrorCode, detail: string): never => {
  throw new EffectiveAbilityProjectionError(code, detail)
}

const protectionByCanonicalId = (): ReadonlyMap<string, Protection> => {
  if (
    protectionJson.schemaVersion !== 1
    || protectionJson.sourceDataSha256 !== ABILITY_RULESET_PROVENANCE.sourceData.sha256
  ) fail('invalid-protection-catalog', 'Protection metadata does not match active ability rules data.')
  const result = new Map<string, Protection>()
  for (const entry of protectionJson.entries) {
    if (!CANONICAL_IDS.has(entry.canonicalId) || result.has(entry.canonicalId)) {
      fail('invalid-protection-catalog', `Invalid protection identity ${entry.canonicalId}.`)
    }
    if (PROTECTION_FIELDS.some(field => typeof entry[field] !== 'boolean')) {
      fail('invalid-protection-catalog', `Invalid protection flags for ${entry.canonicalId}.`)
    }
    result.set(entry.canonicalId, Object.freeze({
      copyable: entry.copyable,
      disableable: entry.disableable,
      transferable: entry.transferable,
    }))
  }
  return result
}

const protectionFor = (
  protections: ReadonlyMap<string, Protection>,
  canonicalId: string,
): Protection => protections.get(canonicalId) ?? DEFAULT_ABILITY_PROTECTION

/** Server-owned protection lookup used before issuing or accepting copy choices. */
export const abilityIsCopyable = (canonicalId: string): boolean => (
  CANONICAL_IDS.has(canonicalId)
  && protectionFor(protectionByCanonicalId(), canonicalId).copyable
)

/** Server-owned protection lookup for Skill Swap-style exchanges. */
export const abilityIsTransferable = (canonicalId: string): boolean => (
  CANONICAL_IDS.has(canonicalId)
  && protectionFor(protectionByCanonicalId(), canonicalId).transferable
)

const canonicalNames = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (!CANONICAL_IDS.has(value) || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

const instance = (input: {
  readonly instanceId: string
  readonly canonicalId: string
  readonly sourceKind: AuthoritativeEffectiveAbility['sourceKind']
  readonly sourcePlacementId: string | null
  readonly parameterStatus: AbilityInstanceParameterStatus
  readonly parameterData: AbilityInstanceData | null
}): MutableProjectedAbility => {
  const parametersReady = input.parameterStatus !== 'missing-required-data'
  return {
    ...input,
    definitionHash: null,
    effective: parametersReady,
    suppressionReasonCode: parametersReady ? null : 'ability.parameters.missing',
  }
}

const replaceActive = (
  projected: MutableProjectedAbility[],
  reasonCode: string,
): void => {
  for (const ability of projected) {
    if (!ability.effective) continue
    ability.effective = false
    ability.suppressionReasonCode = reasonCode
  }
}

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

type AbilityOverlayEffect = EncounterCreatureRuleOverlayEffect & {
  readonly payload: EncounterCreatureAbilityOverlayPayload
}

const applicableAbilityOverlays = (
  effects: readonly EncounterEffect[],
  target: EncounterCreatureRuleTarget,
): readonly AbilityOverlayEffect[] => effects.filter(
  (effect): effect is AbilityOverlayEffect => (
    effect.kind === 'creature-rule-overlay'
    && effect.payload.domain === 'ability'
    && encounterCreatureRuleEffectIsActive(effect)
    && encounterCreatureRuleEffectAppliesToTarget(effect, target)
  ),
)

const assertProjectionBound = (projected: readonly MutableProjectedAbility[]): void => {
  if (projected.length > EFFECTIVE_ABILITY_PROJECTION_LIMIT) {
    fail('projection-limit-exceeded', 'Effective ability projection exceeds its bounded limit.')
  }
}

/**
 * Project base, transformed, granted, copied, replaced, and suppressed abilities
 * in durable encounter order. Suppression is a final union and protected
 * copy/transfer attempts fail closed.
 */
export const projectAuthoritativeEffectiveAbilities = (
  input: ProjectAuthoritativeEffectiveAbilitiesInput,
): readonly AuthoritativeEffectiveAbility[] => {
  const protections = protectionByCanonicalId()
  const effects = parseEncounterEffects(input.effects ?? [], 'effectiveAbilities.effects')
  const transformationSnapshots = parseAbilityTransformationState(
    input.transformationSnapshots ?? createEmptyAbilityTransformationState(),
    'effectiveAbilities.transformationSnapshots',
  )
  const legacyBase = canonicalNames(input.baseAbilityNames ?? []).map(
    (canonicalId, index): ProjectedBaseAbilityInput => ({
      instanceId: `base:${input.target.placementId}:${index}`,
      canonicalId,
      parameterStatus: abilityRequiresInstanceParameters(canonicalId)
        ? 'missing-required-data'
        : 'not-parameterized',
      parameterData: null,
    }),
  )
  const base = input.baseAbilities ?? legacyBase
  const seenBaseInstances = new Set<string>()
  const projected: MutableProjectedAbility[] = base.flatMap((ability) => {
    if (!CANONICAL_IDS.has(ability.canonicalId) || seenBaseInstances.has(ability.instanceId)) return []
    seenBaseInstances.add(ability.instanceId)
    return [instance({
      ...ability,
      sourceKind: 'base',
      sourcePlacementId: input.target.placementId,
    })]
  })
  for (const ability of base) {
    if (ability.parameterStatus !== 'ready' || !ability.parameterData) continue
    let grantKey: string | null = null
    let grantedCanonicalIds: readonly string[] = []
    if (ability.canonicalId === 'Fabulous Trim') {
      grantKey = abilityInstanceParameterValues(ability.parameterData, 'trim')[0] ?? null
      const granted = grantKey ? fabulousTrimGrantedAbility(grantKey) : null
      grantedCanonicalIds = granted ? [granted] : []
    }
    else if (ability.canonicalId === 'Seasonal') {
      grantKey = abilityInstanceParameterValues(ability.parameterData, 'season')[0] ?? null
      grantedCanonicalIds = grantKey ? ({
        spring: ['Run Away'], summer: ['Grass Pelt'], autumn: ['Rivalry'], winter: ['Thick Fat'],
      } as Readonly<Record<string, readonly string[]>>)[grantKey] ?? [] : []
    }
    else if (ability.canonicalId === 'Serpent’s Mark') {
      grantKey = abilityInstanceParameterValues(ability.parameterData, 'pattern')[0] ?? null
      grantedCanonicalIds = grantKey ? ({
        attack: ['Strong Jaw', 'Guts'], crush: ['Crush Trap', 'Frisk'],
        fear: ['Unnerve', 'Regal Challenge'], life: ['Regenerator', 'Defy Death'],
        speed: ['Run Away', 'Speed Boost'], stealth: ['Infiltrator', 'Ambush'],
      } as Readonly<Record<string, readonly string[]>>)[grantKey] ?? [] : []
    }
    grantedCanonicalIds.forEach((grantedCanonicalId, index) => projected.push(instance({
      instanceId: `${ability.instanceId}:grant:${grantKey}:${index}`,
      canonicalId: grantedCanonicalId,
      sourceKind: 'granted',
      sourcePlacementId: input.target.placementId,
      parameterStatus: abilityRequiresInstanceParameters(grantedCanonicalId)
        ? 'missing-required-data'
        : 'not-parameterized',
      parameterData: null,
    })))
  }
  assertProjectionBound(projected)

  const transformation = activeTransformation(effects, input.target.placementId)
  if (transformation) {
    const names = canonicalNames(transformation.payload.abilityNames)
    const blocked = names.find(name => !protectionFor(protections, name).copyable)
    if (blocked) fail('protected-copy', `${blocked} cannot be copied by transformation.`)
    replaceActive(projected, 'ability.replaced.transformation')
    names.forEach((canonicalId, index) => projected.push(instance({
      instanceId: `transformed:${transformation.id}:${index}`,
      canonicalId,
      sourceKind: 'transformed',
      sourcePlacementId: transformation.payload.copiedFromPlacementId,
      parameterStatus: abilityRequiresInstanceParameters(canonicalId)
        ? 'missing-required-data'
        : 'not-parameterized',
      parameterData: null,
    })))
  }

  for (const snapshot of transformationSnapshots.entries) {
    if (snapshot.placementId !== input.target.placementId
      || snapshot.kind === 'disguise' || snapshot.kind === 'illusion') continue
    const mechanics = snapshot.mechanics
    const blocked = mechanics.abilities.find(ability => (
      (snapshot.kind === 'copy' || snapshot.kind === 'transformation')
      && !protectionFor(protections, ability.canonicalId).copyable
    ))
    if (blocked) fail('protected-copy', `${blocked.canonicalId} cannot be copied by ${snapshot.kind}.`)
    if (mechanics.abilityPolicy === 'replace') {
      replaceActive(projected, `ability.replaced.${snapshot.kind}`)
    }
    if (mechanics.abilityPolicy !== 'preserve') {
      for (const ability of mechanics.abilities) {
        if (!CANONICAL_IDS.has(ability.canonicalId)) continue
        if (projected.some(projectedAbility => projectedAbility.instanceId === ability.instanceId)) {
          fail('projection-limit-exceeded', `Transformation repeats ability instance ${ability.instanceId}.`)
        }
        const projectedAbility = instance({
          instanceId: ability.instanceId,
          canonicalId: ability.canonicalId,
          sourceKind: snapshot.kind === 'copy' ? 'copied' : 'transformed',
          sourcePlacementId: ability.sourcePlacementId ?? snapshot.copyBase?.sourcePlacementId ?? snapshot.ownerPlacementId,
          parameterStatus: ability.parameterStatus,
          parameterData: ability.parameterData,
        })
        projectedAbility.definitionHash = ability.definitionHash
        projected.push(projectedAbility)
      }
      assertProjectionBound(projected)
    }
  }

  const overlays = applicableAbilityOverlays(effects, input.target)
  const suppressions = overlays.filter(effect => effect.payload.action === 'suppress')
  for (const effect of overlays) {
    const payload = effect.payload
    if (payload.action === 'suppress') continue
    const names = canonicalNames(payload.values)
    if (payload.action === 'copy') {
      const blocked = names.find(name => !protectionFor(protections, name).copyable)
      if (blocked) fail('protected-copy', `${blocked} cannot be copied.`)
    }
    if (payload.action === 'swap') {
      const blockedIncoming = names.find(name => !protectionFor(protections, name).transferable)
      const blockedOutgoing = projected.find(ability => (
        ability.effective && !protectionFor(protections, ability.canonicalId).transferable
      ))
      if (blockedIncoming || blockedOutgoing) {
        fail(
          'protected-transfer',
          `${blockedIncoming ?? blockedOutgoing!.canonicalId} cannot be transferred.`,
        )
      }
    }
    const sourceKind: AuthoritativeEffectiveAbility['sourceKind'] = payload.action === 'add'
      ? 'granted'
      : payload.action === 'copy'
        ? 'copied'
        : 'replaced'
    if (payload.action !== 'add') replaceActive(projected, `ability.replaced.${payload.action}`)
    names.forEach((canonicalId, index) => {
      const snapshot = payload.abilitySnapshots?.[index] ?? null
      const projectedAbility = instance({
        instanceId: snapshot?.instanceId ?? `${sourceKind}:${effect.id}:${index}`,
        canonicalId,
        sourceKind,
        sourcePlacementId: snapshot?.sourcePlacementId
          ?? payload.referencePlacementId
          ?? effect.source.placementId,
        parameterStatus: snapshot?.parameterStatus
          ?? (abilityRequiresInstanceParameters(canonicalId)
            ? 'missing-required-data'
            : 'not-parameterized'),
        parameterData: snapshot?.parameterData ?? null,
      })
      projectedAbility.definitionHash = snapshot?.definitionHash ?? null
      projected.push(projectedAbility)
    })
    assertProjectionBound(projected)
  }

  const poltergeist = projected.find(ability => ability.effective && ability.canonicalId === 'Poltergeist')
  const rotomForm = aa083PoltergeistFormForSpecies(input.species)
  if (poltergeist && rotomForm) {
    const grantedCanonicalId = AA083_POLTERGEIST_FORMS[rotomForm].abilityId
    projected.push(instance({
      instanceId: `${poltergeist.instanceId}:poltergeist:${rotomForm}`,
      canonicalId: grantedCanonicalId,
      sourceKind: 'granted',
      sourcePlacementId: input.target.placementId,
      parameterStatus: abilityRequiresInstanceParameters(grantedCanonicalId)
        ? 'missing-required-data'
        : 'not-parameterized',
      parameterData: null,
    }))
    assertProjectionBound(projected)
  }

  const suppressAll = suppressions.some(effect => effect.payload.suppressionScope === 'all')
  const suppressedNames = new Set(suppressions.flatMap(effect => effect.payload.values))
  for (const ability of projected) {
    if (!ability.effective || (!suppressAll && !suppressedNames.has(ability.canonicalId))) continue
    if (!protectionFor(protections, ability.canonicalId).disableable) continue
    ability.effective = false
    ability.suppressionReasonCode = suppressAll
      ? 'ability.suppressed.all'
      : 'ability.suppressed.listed'
  }
  assertProjectionBound(projected)
  return Object.freeze(projected.map(ability => Object.freeze({ ...ability })))
}
