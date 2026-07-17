import type {
  EncounterEffectSource,
  EncounterNumericModifierEffect,
} from '#shared/moveAutomation/encounterEffects'
import {
  TAILWIND_EFFECT_TAG,
  isTailwindInitiativeEffect,
} from '#shared/moveAutomation/globalFields'
import type { EncounterSideId } from '#shared/moveAutomation/encounterState'
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
): readonly EncounterNumericModifierEffect[] => {
  const seenTailwindSides = new Set<EncounterSideId>()
  return (map.encounterState?.effects ?? []).filter(
    (effect): effect is EncounterNumericModifierEffect => {
      if (
        effect.kind !== 'numeric-modifier'
        || effect.payload.attribute !== 'initiative'
        || effect.suppression.sources.length !== 0
        || effect.charges === 0
        || !appliesToPlacement(effect, placement)
      ) return false

      // Canonical Tailwind never stacks for one side, even if malformed legacy
      // state retained two independently identified copies.
      if (isTailwindInitiativeEffect(effect)) {
        const sideId = effect.affected.sideIds[0]!
        if (seenTailwindSides.has(sideId)) return false
        seenTailwindSides.add(sideId)
      }
      return true
    },
  )
}

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

export interface EncounterInitiativeContribution {
  readonly effectId: string
  readonly source: EncounterEffectSource
  readonly sideId: EncounterSideId | null
  readonly previousScore: number
  readonly currentScore: number
  readonly reasonCode: 'field.tailwind.initiative' | 'encounter.initiative-modifier'
}

export interface EncounterInitiativeResolution {
  readonly placementId: string
  readonly baseScore: number
  readonly score: number
  readonly contributions: readonly EncounterInitiativeContribution[]
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

/**
 * Query the effective calculated initiative score without rewriting placement
 * initiative or manual order. Active effects apply in durable encounter-state
 * order; canonical side-owned Tailwind contributes at most once. A complete
 * GM-authored manual order bypasses this query entirely.
 */
export const resolveEncounterInitiative = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placement: SheetPlacement
  readonly calculatedScore: number
}): EncounterInitiativeResolution => {
  let score = input.calculatedScore
  const contributions: EncounterInitiativeContribution[] = []
  for (const effect of activeInitiativeModifiers(input.map, input.placement)) {
    const previousScore = score
    score = applyModifier(score, effect)
    const tailwind = effect.tags.includes(TAILWIND_EFFECT_TAG)
      && isTailwindInitiativeEffect(effect)
    contributions.push({
      effectId: effect.id,
      source: effect.source,
      sideId: tailwind ? effect.affected.sideIds[0] ?? null : null,
      previousScore,
      currentScore: score,
      reasonCode: tailwind
        ? 'field.tailwind.initiative'
        : 'encounter.initiative-modifier',
    })
  }
  return deepFreeze({
    placementId: input.placement.id,
    baseScore: input.calculatedScore,
    score,
    contributions,
  })
}

export const encounterModifiedInitiativeScore = (
  input: Parameters<typeof resolveEncounterInitiative>[0],
): number => resolveEncounterInitiative(input).score
