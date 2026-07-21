import type { AbilitySpecV1Runtime } from '../registry'
import {
  isAbilityMechanicOperation,
  parseAbilityMechanicOperation,
  type Aa060AbilityMechanicId,
  type AbilityMechanicOperation,
} from '#shared/abilityAutomation/mechanics'
import { aggregateAbilityPassiveProviders, type AbilityPassiveProvider } from '#shared/abilityAutomation/passiveProviders'
import { parseAbilityHpProviders, type AbilityHpProvider } from '#shared/abilityAutomation/hpProviders'
import { deepFreezeStrictJson } from '#shared/automation/strictJson'
import { computeMultiplier, resistMultiplierOneStepFurther } from '~/utils/typeChart'
import { computeTickValue } from '~/utils/ptuHp'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { GridAnchor, TabletopMap } from '~/types/map'

export interface Aa060EffectiveAbility {
  readonly instanceId: string
  readonly canonicalId: string
  readonly sourcePlacementId: string
}
export interface Aa060MoveFact {
  readonly actorPlacementId: string
  readonly targetPlacementId: string
  readonly moveInstanceId: string
  readonly moveType: 'bug' | 'dark' | 'dragon' | 'electric' | 'fairy' | 'fighting' | 'fire' | 'flying' | 'ghost' | 'grass' | 'ground' | 'ice' | 'normal' | 'poison' | 'psychic' | 'rock' | 'steel' | 'water'
  readonly actorTypeIds: readonly Aa060MoveFact['moveType'][]
  readonly damageClass: 'physical' | 'special' | 'status'
  readonly damageBaseBeforeStab: number | null
  readonly keywords: readonly string[]
  readonly actorSpeed: number
  readonly actorInitiativeOrder: number | null
  readonly targetInitiativeOrder: number | null
  readonly hit: boolean
  readonly baseTypeMultiplier: number
  /** Recorded server result for Adaptability; absent means no die may be applied. */
  readonly adaptabilityRoll: number | null
  readonly activeMechanics: readonly Aa060AbilityMechanicId[]
  readonly accelerateMoveInstanceId: string | null
  readonly ambushMoveInstanceId: string | null
}
export interface Aa060MoveMechanicsResolution {
  readonly moveType: Aa060MoveFact['moveType']
  readonly hasStab: boolean
  readonly priority: boolean
  readonly accuracyBonus: number
  readonly preTypeDamageBonus: number
  readonly resistanceSteps: number
  readonly finalTypeMultiplier: number
  readonly ignoreRecoil: boolean
  readonly hitEffects: readonly {
    readonly kind: 'condition' | 'accuracy-penalty'
    readonly conditionId: string | null
    readonly value: number
    readonly durationRounds: number
    readonly sourceMechanicId: Aa060AbilityMechanicId
  }[]
  readonly appliedMechanicIds: readonly Aa060AbilityMechanicId[]
}
export interface Aa060AftermathRecipient {
  readonly placementId: string
  readonly maximumHp: number
  readonly distance: number
  readonly externalImmune: boolean
}
export interface Aa060AftermathResult {
  readonly placementId: string
  readonly tickValue: number
  readonly attemptedHpLoss: number
  readonly appliedHpLoss: number
  readonly outcome: 'applied' | 'prevented' | 'outside-burst'
}
export interface Aa060AnticipationResult {
  readonly targetPlacementId: string
  readonly hasSuperEffectiveMove: boolean
  readonly revealedMoveIds: readonly []
  readonly receiptId: string
}
export interface Aa060AirLockState {
  readonly active: boolean
  readonly weatherSuppressed: boolean
  readonly sustainAction: 'swift'
  readonly round: number
  readonly sourceAbilityInstanceId: string
}
export interface Aa060AnchorShiftResult {
  readonly legal: boolean
  readonly reasonCode: 'anchor-shift-legal' | 'anchor-out-of-range' | 'anchor-space-occupied' | 'anchor-not-controlled'
  readonly position: { readonly x: number; readonly y: number; readonly z: number } | null
  readonly nestedAttack: {
    readonly moveInstanceId: string
    readonly origin: { readonly x: number; readonly y: number; readonly z: number }
    readonly rangeId: 'melee-1-target'
    readonly bonusFormula: '2d6'
    readonly damageClass: 'physical'
  } | null
}
export class Aa060AbilityMechanicError extends Error {
  constructor(readonly code: 'runtime-mismatch' | 'invalid-fact' | 'roll-missing' | 'already-used' | 'unsupported-mechanic', detail: string) {
    super(detail)
    this.name = 'Aa060AbilityMechanicError'
  }
}
const fail = (code: Aa060AbilityMechanicError['code'], detail: string): never => { throw new Aa060AbilityMechanicError(code, detail) }
const mechanicSet = (fact: Aa060MoveFact): ReadonlySet<Aa060AbilityMechanicId> => new Set(fact.activeMechanics)
const validMoveFact = (fact: Aa060MoveFact): void => {
  if (!Number.isSafeInteger(fact.actorSpeed) || fact.actorSpeed < 0
    || (fact.damageBaseBeforeStab !== null && (!Number.isSafeInteger(fact.damageBaseBeforeStab) || fact.damageBaseBeforeStab < 0))
    || !Number.isFinite(fact.baseTypeMultiplier) || fact.baseTypeMultiplier < 0
    || fact.keywords.some(keyword => typeof keyword !== 'string')
    || new Set(fact.activeMechanics).size !== fact.activeMechanics.length) {
    fail('invalid-fact', 'AA-060 move fact is invalid.')
  }
}

/** Extract one reviewed mechanic from the exact manifest-selected runtime mode. */
export const aa060MechanicForRuntime = (
  runtime: AbilitySpecV1Runtime,
  modeId: string,
): AbilityMechanicOperation => {
  const nodes = runtime.definition.spec.phases
    .filter(phase => phase.modeId === modeId)
    .flatMap(phase => phase.operations)
    .filter(isAbilityMechanicOperation)
  if (nodes.length !== 1 || !nodes[0]!.mechanicId.startsWith('aa060.')) {
    fail('runtime-mismatch', `${runtime.canonicalId}:${modeId} must contain one AA-060 mechanic.`)
  }
  return parseAbilityMechanicOperation(nodes[0])
}

/** Materialize only automatic provider forms; source identity is never read from sheet prose. */
export const materializeAa060PassiveProviders = (input: {
  readonly abilities: readonly Aa060EffectiveAbility[]
}): {
  readonly passiveGroups: ReturnType<typeof aggregateAbilityPassiveProviders>
  readonly hpProviders: readonly AbilityHpProvider[]
} => {
  const passive: AbilityPassiveProvider[] = []
  const hp: AbilityHpProvider[] = []
  for (const ability of input.abilities) {
    if (ability.canonicalId !== 'Abominable') continue
    passive.push({
      schemaVersion: 1,
      providerId: `${ability.instanceId}:base-hp`, abilityInstanceId: ability.instanceId,
      canonicalId: ability.canonicalId, sourcePlacementId: ability.sourcePlacementId,
      scopeKey: `placement:${ability.sourcePlacementId}`,
      domain: 'stat', attribute: 'stat.hp', operation: 'add', value: 5,
      priority: 0, stackingGroup: 'stat.base', stackingPolicy: 'stack',
      reasonCode: 'ability.abominable.base-hp',
    })
    hp.push({
      schemaVersion: 1,
      providerId: `${ability.instanceId}:ignore-recoil`, abilityInstanceId: ability.instanceId,
      canonicalId: ability.canonicalId, sourcePlacementId: ability.sourcePlacementId,
      subject: 'actor', relation: 'self',
      predicate: { damageKinds: ['recoil'], moveTypes: [], requiredKeywords: [], excludedKeywords: [], requiresCritical: null },
      effect: { kind: 'damage-prevention' }, stackingGroup: 'abominable-recoil',
      stackingPolicy: 'union', priority: 0, reasonCode: 'ability.abominable.ignore-recoil',
    })
  }
  return deepFreezeStrictJson({
    passiveGroups: aggregateAbilityPassiveProviders(passive),
    hpProviders: parseAbilityHpProviders(hp),
  })
}

/** Ordered move-facing mechanics for the AA-060 cohort. */
export const resolveAa060MoveMechanics = (fact: Aa060MoveFact): Aa060MoveMechanicsResolution => {
  validMoveFact(fact)
  const active = mechanicSet(fact)
  const applied: Aa060AbilityMechanicId[] = []
  let moveType = fact.moveType
  const damaging = fact.damageClass !== 'status'
  if (active.has('aa060.aerilate') && damaging && moveType === 'normal') {
    moveType = 'flying'
    applied.push('aa060.aerilate')
  }
  const hasStab = fact.actorTypeIds.includes(moveType)
  const basePriority = fact.keywords.includes('priority')
  let priority = basePriority
  let accuracyBonus = 0
  let preTypeDamageBonus = 0
  if (active.has('aa060.accelerate') && fact.accelerateMoveInstanceId === fact.moveInstanceId
    && damaging && hasStab) {
    priority = true
    if (basePriority) accuracyBonus += 4
    if (fact.hit) preTypeDamageBonus += Math.floor(fact.actorSpeed / 2)
    applied.push('aa060.accelerate')
  }
  const hitEffects: Aa060MoveMechanicsResolution['hitEffects'][number][] = []
  if (active.has('aa060.ambush') && fact.ambushMoveInstanceId === fact.moveInstanceId
    && damaging && fact.damageBaseBeforeStab !== null && fact.damageBaseBeforeStab <= 6) {
    priority = true
    if (fact.hit) {
      hitEffects.push({ kind: 'condition', conditionId: 'flinched', value: 1, durationRounds: 1, sourceMechanicId: 'aa060.ambush' })
      hitEffects.push({ kind: 'accuracy-penalty', conditionId: null, value: -2, durationRounds: 1, sourceMechanicId: 'aa060.ambush' })
    }
    applied.push('aa060.ambush')
  }
  if (active.has('aa060.adaptability') && hasStab) {
    if (!Number.isSafeInteger(fact.adaptabilityRoll) || fact.adaptabilityRoll! < 1 || fact.adaptabilityRoll! > 10) {
      fail('roll-missing', 'Adaptability requires one recorded d10 result.')
    }
    preTypeDamageBonus += fact.adaptabilityRoll!
    applied.push('aa060.adaptability')
  }
  if (active.has('aa060.analytic') && damaging
    && fact.actorInitiativeOrder !== null && fact.targetInitiativeOrder !== null
    && fact.targetInitiativeOrder < fact.actorInitiativeOrder) {
    preTypeDamageBonus += 5
    applied.push('aa060.analytic')
  }
  const resistanceSteps = active.has('aa060.absorb-force') && fact.damageClass === 'physical' ? 1 : 0
  if (resistanceSteps) applied.push('aa060.absorb-force')
  const finalTypeMultiplier = resistanceSteps
    ? resistMultiplierOneStepFurther(fact.baseTypeMultiplier)
    : fact.baseTypeMultiplier
  const ignoreRecoil = active.has('aa060.abominable')
  if (ignoreRecoil) applied.push('aa060.abominable')
  return deepFreezeStrictJson({
    moveType, hasStab, priority, accuracyBonus, preTypeDamageBonus, resistanceSteps,
    finalTypeMultiplier, ignoreRecoil, hitEffects: Object.freeze(hitEffects),
    appliedMechanicIds: Object.freeze([...new Set(applied)]),
  })
}

export const resolveAa060Aftermath = (recipients: readonly Aa060AftermathRecipient[]): readonly Aa060AftermathResult[] => deepFreezeStrictJson(
  recipients.map((recipient) => {
    if (!Number.isSafeInteger(recipient.maximumHp) || recipient.maximumHp < 0
      || !Number.isFinite(recipient.distance) || recipient.distance < 0) fail('invalid-fact', 'Aftermath recipient is invalid.')
    const tickValue = computeTickValue(recipient.maximumHp)
    const attemptedHpLoss = tickValue * 3
    const outcome = recipient.distance > 1 ? 'outside-burst' : recipient.externalImmune ? 'prevented' : 'applied'
    return {
      placementId: recipient.placementId, tickValue, attemptedHpLoss,
      appliedHpLoss: outcome === 'applied' ? attemptedHpLoss : 0,
      outcome,
    }
  }),
)

export const resolveAa060AngerPoint = (input: {
  readonly critical: boolean
  readonly prevented: boolean
  readonly currentAttackStage: number
  readonly conditions: readonly string[]
}): { readonly applied: boolean; readonly attackStage: number; readonly conditions: readonly string[] } => {
  if (!Number.isSafeInteger(input.currentAttackStage) || input.currentAttackStage < -6 || input.currentAttackStage > 6) {
    fail('invalid-fact', 'Anger Point stage is invalid.')
  }
  if (!input.critical || input.prevented) return deepFreezeStrictJson({ applied: false, attackStage: input.currentAttackStage, conditions: input.conditions })
  return deepFreezeStrictJson({
    applied: true,
    attackStage: Math.min(6, input.currentAttackStage + 6),
    conditions: Object.freeze(input.conditions.includes('Enraged') ? [...input.conditions] : [...input.conditions, 'Enraged']),
  })
}

export const resolveAa060AirLock = (input: {
  readonly sourceAbilityInstanceId: string
  readonly round: number
  readonly activated: boolean
  readonly previous: Aa060AirLockState | null
  readonly swiftSustainPaid: boolean
}): Aa060AirLockState => {
  if (!Number.isSafeInteger(input.round) || input.round < 0) fail('invalid-fact', 'Air Lock round is invalid.')
  const active = input.activated || Boolean(
    input.previous?.active
    && input.previous.sourceAbilityInstanceId === input.sourceAbilityInstanceId
    && (input.previous.round === input.round || (input.previous.round + 1 === input.round && input.swiftSustainPaid)),
  )
  return deepFreezeStrictJson({
    active,
    weatherSuppressed: active,
    sustainAction: 'swift',
    round: input.round,
    sourceAbilityInstanceId: input.sourceAbilityInstanceId,
  })
}

const gridDistance = (
  left: { readonly x: number; readonly y: number; readonly z: number },
  right: { readonly x: number; readonly y: number; readonly z: number },
): number => ptuGridDistanceBetweenFootprints(
  { position: left, base: 1, clearance: 1 },
  { position: right, base: 1, clearance: 1 },
)

export const resolveAa060AnchorShift = (input: {
  readonly sourcePosition: { readonly x: number; readonly y: number; readonly z: number }
  readonly destination: { readonly x: number; readonly y: number; readonly z: number }
  readonly controllerAuthorized: boolean
  readonly destinationOpen: boolean
  readonly optionalMoveInstanceId: string | null
  readonly damagingMove: boolean
  readonly attackActionAvailable: boolean
}): Aa060AnchorShiftResult => {
  const reasonCode = !input.controllerAuthorized ? 'anchor-not-controlled'
    : !input.destinationOpen ? 'anchor-space-occupied'
      : gridDistance(input.sourcePosition, input.destination) > 3 ? 'anchor-out-of-range'
        : 'anchor-shift-legal'
  const legal = reasonCode === 'anchor-shift-legal'
  return deepFreezeStrictJson({
    legal,
    reasonCode,
    position: legal ? input.destination : null,
    nestedAttack: legal && input.optionalMoveInstanceId && input.damagingMove && input.attackActionAvailable
      ? {
          moveInstanceId: input.optionalMoveInstanceId,
          origin: input.destination,
          rangeId: 'melee-1-target',
          bonusFormula: '2d6',
          damageClass: 'physical',
        }
      : null,
  })
}

export const aa060AnchorAllowsPlacement = (input: {
  readonly anchorPosition: { readonly x: number; readonly y: number; readonly z: number }
  readonly placementPosition: { readonly x: number; readonly y: number; readonly z: number }
}): boolean => gridDistance(input.anchorPosition, input.placementPosition) <= 3

export class Aa060AnchoredMovementError extends Error {
  constructor(readonly entityId: string) {
    super(`Anchored entity ${entityId} limits movement to 3 meters.`)
    this.name = 'Aa060AnchoredMovementError'
  }
}

/** Final server planning boundary shared by voluntary, forced, Pass, teleport, and swap movement. */
export const assertAa060AnchoredDestination = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placementId: string
  readonly destination: GridAnchor
}): void => {
  for (const entity of input.map.encounterState?.abilityEntities?.entries ?? []) {
    if (entity.payload.kind !== 'anchor'
      || entity.payload.anchorKind !== 'aa060.anchored'
      || !entity.payload.anchoredPlacementIds.includes(input.placementId)) continue
    if (ptuGridDistanceBetweenFootprints(
      { position: entity.position, base: 1, clearance: 1 },
      { position: input.destination, base: 1, clearance: 1 },
    ) > 3) throw new Aa060AnchoredMovementError(entity.entityId)
  }
}

/** Private binary Anticipation result. Specific moves are absent by contract. */
export const resolveAa060Anticipation = (input: {
  readonly actorTypeIds: readonly string[]
  readonly targetPlacementId: string
  readonly targetMoves: readonly { readonly moveId: string; readonly type: string; readonly damageClass: 'physical' | 'special' | 'status' }[]
  readonly existingReceiptIds: readonly string[]
  readonly receiptId: string
}): Aa060AnticipationResult => {
  if (input.existingReceiptIds.includes(input.receiptId)) fail('already-used', 'Anticipation target was already queried this encounter.')
  const hasSuperEffectiveMove = input.targetMoves.some(move => (
    move.damageClass !== 'status' && computeMultiplier(move.type, input.actorTypeIds) > 1
  ))
  return deepFreezeStrictJson({
    targetPlacementId: input.targetPlacementId,
    hasSuperEffectiveMove,
    revealedMoveIds: Object.freeze([]),
    receiptId: input.receiptId,
  })
}
