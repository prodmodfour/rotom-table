import type {
  EncounterConditionEffect,
  EncounterEffect,
  EncounterEffectCell,
} from '#shared/moveAutomation/encounterEffects'
import type { EncounterSideId } from '#shared/moveAutomation/encounterState'
import type { GridAnchor } from '~/types/pokemon'
import { addAppliedCondition } from '~/utils/conditionApplication'
import { deepCloneJson } from '~/utils/serialization'
import {
  conditionBaseName,
  isStackableCondition,
  normalizeConditionName,
  normalizeConditionNames,
} from '~/utils/statusConditions'

/** Placement facts needed to resolve direct, side, and cell-scoped effects. */
export interface EffectiveConditionTarget {
  readonly placementId: string
  readonly sideId?: EncounterSideId
  readonly position?: GridAnchor
  readonly base?: number
  readonly clearance?: number
  /** Explicit occupied cells take precedence over deriving a rectangular footprint. */
  readonly cells?: readonly EncounterEffectCell[]
}

/**
 * One active encounter modifier with its canonical condition identity.
 * The complete effect remains available for source, duration, stack, charge,
 * payload, dispel, and suppression-aware rules queries.
 */
export interface EffectiveConditionModifier {
  readonly condition: string
  readonly effect: EncounterConditionEffect
}

/** A detached effective view; neither durable storage layer is rewritten. */
export interface EffectiveConditionProjection {
  /** Normalized persistent conditions from the backing sheet only. */
  readonly sheetConditions: readonly string[]
  /** Sheet conditions plus active encounter applications after suppression. */
  readonly conditions: readonly string[]
  /** Active applicable apply/prevent/suppress effects in encounter-state order. */
  readonly modifiers: readonly EffectiveConditionModifier[]
}

export class EffectiveConditionProjectionError extends Error {
  readonly code = 'unknown-condition'
  readonly effectId: string
  readonly conditionId: string

  constructor(effectId: string, conditionId: string) {
    super(`Encounter effect ${effectId} references unknown canonical condition ${conditionId}.`)
    this.name = 'EffectiveConditionProjectionError'
    this.effectId = effectId
    this.conditionId = conditionId
  }
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
  target: EffectiveConditionTarget,
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

const effectAppliesToTarget = (
  effect: EncounterConditionEffect,
  target: EffectiveConditionTarget,
): boolean => (
  effect.affected.placementIds.includes(target.placementId)
  || (
    target.sideId !== undefined
    && effect.affected.sideIds.includes(target.sideId)
  )
  || effect.affected.cells.some(cell => targetOccupiesEffectCell(target, cell))
)

const effectIsActive = (effect: EncounterConditionEffect): boolean => (
  effect.suppression.sources.length === 0
  && effect.charges !== 0
)

const canonicalEffectCondition = (effect: EncounterConditionEffect): string => {
  const condition = normalizeConditionName(effect.payload.conditionId)
  if (!condition) {
    throw new EffectiveConditionProjectionError(effect.id, effect.payload.conditionId)
  }
  return condition
}

const conditionIdentity = (condition: string): string => (
  conditionBaseName(condition) ?? condition
)

const activeApplicableModifiers = (
  effects: readonly EncounterEffect[] | null | undefined,
  target: EffectiveConditionTarget,
): EffectiveConditionModifier[] => (effects ?? []).flatMap((effect) => {
  if (
    effect.kind !== 'condition'
    || !effectIsActive(effect)
    || !effectAppliesToTarget(effect, target)
  ) {
    return []
  }
  return [{ condition: canonicalEffectCondition(effect), effect: deepCloneJson(effect) }]
})

const projectConditionNames = (
  sheetConditions: readonly string[],
  modifiers: readonly EffectiveConditionModifier[],
): string[] => {
  const suppressed = new Set(
    modifiers
      .filter(({ effect }) => effect.payload.action === 'suppress')
      .map(({ condition }) => conditionIdentity(condition)),
  )
  let conditions = [...sheetConditions]
  const nonStackable = new Set(conditions.map(conditionIdentity))

  for (const { condition, effect } of modifiers) {
    if (effect.payload.action !== 'apply') continue
    const identity = conditionIdentity(condition)
    if (suppressed.has(identity)) continue

    const stackable = isStackableCondition(condition)
    const applications = stackable ? effect.stacks : 1
    if (!stackable && nonStackable.has(identity)) continue
    for (let stack = 0; stack < applications; stack += 1) {
      conditions = addAppliedCondition(conditions, condition)
    }
    for (const applied of conditions) nonStackable.add(conditionIdentity(applied))
  }

  return normalizeConditionNames(
    conditions.filter(condition => !suppressed.has(conditionIdentity(condition))),
  )
}

/**
 * Project one placement's effective canonical conditions from persistent sheet
 * strings and active typed encounter modifiers. The query never folds an
 * encounter effect back into the sheet, and duplicate non-stackable names are
 * collapsed while explicit stack counts remain observable.
 */
export const projectEffectiveConditions = (input: {
  readonly sheetConditions?: readonly unknown[] | null
  readonly encounterEffects?: readonly EncounterEffect[] | null
  readonly target: EffectiveConditionTarget
}): EffectiveConditionProjection => {
  const sheetConditions = normalizeConditionNames(input.sheetConditions)
  const modifiers = activeApplicableModifiers(input.encounterEffects, input.target)
  return deepFreeze({
    sheetConditions: [...sheetConditions],
    conditions: projectConditionNames(sheetConditions, modifiers),
    modifiers,
  })
}
