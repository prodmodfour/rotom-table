import type { ItemRevivalSpec } from '#shared/itemAutomation/spec'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { computePokemonHealingVitals } from '~/utils/sheets/healing'
import { capabilityActorIsFainted } from '../capabilityAutomation/actionEligibility'

export interface ItemRevivalPreview {
  readonly currentHp: number
  readonly fullFormulaMaximumHp: number
  readonly effectiveMaximumHp: number
  readonly injuries: number
  readonly calculationKind: ItemRevivalSpec['amount']['kind']
  readonly requestedHp: number
  readonly resultingHp: number
  readonly capReducedAmount: number
  readonly clearsFainted: true
  readonly description: string
}

const roundedFraction = (
  maximum: number,
  amount: Extract<ItemRevivalSpec['amount'], { readonly kind: 'maximum-relative' }>,
): number => {
  const raw = (maximum * amount.numerator) / amount.denominator
  const rounded = amount.rounding === 'up' ? Math.ceil(raw)
    : amount.rounding === 'nearest' ? Math.round(raw) : Math.floor(raw)
  return Math.max(amount.minimum, rounded)
}

/** Resolve a revival HP assignment from full formula maximum and injury-adjusted cap. */
export const previewItemRevival = (input: {
  readonly revival: ItemRevivalSpec
  readonly sheetKind: SheetKind
  readonly sheet: AnyLiveSheet
}): ItemRevivalPreview => {
  if (input.revival.targetKind !== 'pokemon' || input.sheetKind !== 'pokemon') {
    throw new Error('Reviewed revival items target Pokémon only.')
  }
  if (!capabilityActorIsFainted(input.sheet as CharacterSheet | TrainerSheet)) {
    throw new Error('Revival requires an authoritative Fainted Pokémon.')
  }
  const vitals = computePokemonHealingVitals(input.sheet as CharacterSheet)
  const requestedHp = input.revival.amount.kind === 'fixed'
    ? input.revival.amount.amount
    : roundedFraction(vitals.fullMaxHp, input.revival.amount)
  const resultingHp = Math.min(requestedHp, vitals.maxHp)
  if (resultingHp < 1) {
    throw new Error('Injuries leave no positive HP capacity for this revival item.')
  }
  const capReducedAmount = requestedHp - resultingHp
  return Object.freeze({
    currentHp: vitals.currentHp,
    fullFormulaMaximumHp: vitals.fullMaxHp,
    effectiveMaximumHp: vitals.maxHp,
    injuries: vitals.injuries,
    calculationKind: input.revival.amount.kind,
    requestedHp,
    resultingHp,
    capReducedAmount,
    clearsFainted: true,
    description: `Revives at ${resultingHp} HP${capReducedAmount > 0 ? ` · ${capReducedAmount} reduced by Injuries` : ''}`,
  })
}
