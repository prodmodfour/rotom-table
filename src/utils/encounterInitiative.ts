import type { EncounterNumericModifierEffect } from '#shared/moveAutomation/encounterEffects'
import type { SheetPlacement, TabletopMap } from '~/types/map'

export type EncounterInitiativeModifierErrorCode = 'non-finite-initiative'

export class EncounterInitiativeModifierError extends Error {
  readonly code: EncounterInitiativeModifierErrorCode

  constructor(code: EncounterInitiativeModifierErrorCode, message: string) {
    super(message)
    this.name = 'EncounterInitiativeModifierError'
    this.code = code
  }
}

const sameCell = (
  left: Pick<SheetPlacement['position'], 'x' | 'y' | 'z'>,
  right: Pick<SheetPlacement['position'], 'x' | 'y' | 'z'>,
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

const appliesToPlacement = (
  effect: EncounterNumericModifierEffect,
  placement: SheetPlacement,
): boolean => (
  effect.affected.placementIds.includes(placement.id)
  || (
    placement.sideId !== undefined
    && effect.affected.sideIds.includes(placement.sideId)
  )
  || effect.affected.cells.some(cell => sameCell(cell, placement.position))
)

const activeInitiativeModifiers = (
  map: Pick<TabletopMap, 'encounterState'>,
  placement: SheetPlacement,
): readonly EncounterNumericModifierEffect[] => (map.encounterState?.effects ?? []).filter(
  (effect): effect is EncounterNumericModifierEffect => (
    effect.kind === 'numeric-modifier'
    && effect.payload.attribute === 'initiative'
    && effect.suppression.sources.length === 0
    && effect.charges !== 0
    && appliesToPlacement(effect, placement)
  ),
)

const rounded = (
  value: number,
  policy: EncounterNumericModifierEffect['payload']['rounding'],
): number => {
  if (policy === 'floor') return Math.floor(value)
  if (policy === 'round') return Math.round(value)
  if (policy === 'ceil') return Math.ceil(value)
  return value
}

const applyModifier = (
  score: number,
  effect: EncounterNumericModifierEffect,
): number => {
  const { operation, value, rounding } = effect.payload
  let next: number
  if (operation === 'add') next = score + (value * effect.stacks)
  else if (operation === 'multiply') next = score * (value ** effect.stacks)
  else next = value
  next = rounded(next, rounding)
  if (!Number.isFinite(next)) {
    throw new EncounterInitiativeModifierError(
      'non-finite-initiative',
      `Encounter initiative effect ${effect.id} produced a non-finite score.`,
    )
  }
  return next
}

/**
 * Query the effective calculated initiative score without rewriting placement
 * initiative or manual order. Active effects apply in durable encounter-state
 * order; a complete GM-authored manual order bypasses this query entirely.
 */
export const encounterModifiedInitiativeScore = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placement: SheetPlacement
  readonly calculatedScore: number
}): number => activeInitiativeModifiers(input.map, input.placement).reduce(
  (score, effect) => applyModifier(score, effect),
  input.calculatedScore,
)
