import type {
  ItemHealingAmountSpec,
  ItemHealingRoundingKind,
  ItemHpRestorationSpec,
  ItemSkillCheckId,
} from '#shared/itemAutomation/spec'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { computePokemonHealingVitals, computeTrainerHealingVitals } from '~/utils/sheets/healing'
import { resolveTrainerEdgeCheck } from '../edgeAutomation/trainerChecks'

export type ItemHealingDieRoller = (sides: number) => number

export interface ItemHealingRollEvidence {
  readonly expression: string
  readonly rolls: readonly number[]
  readonly modifier: number
  /** Raw check total; skill-check healing applies at least zero HP. */
  readonly total: number
  readonly skillId?: ItemSkillCheckId
  readonly rankValue?: number
  readonly dieSides?: 6
}

export interface ItemHealingResolution {
  readonly calculationKind: ItemHealingAmountSpec['kind']
  readonly currentHp: number
  /** Formula maximum before Injuries reduce the target's current healing cap. */
  readonly fullFormulaMaximumHp: number
  readonly effectiveMaximumHp: number
  readonly injuries: number
  readonly requestedHealing: number
  readonly effectiveHealing: number
  readonly overheal: number
  readonly resultingHp: number
  readonly roll: ItemHealingRollEvidence | null
}

export interface ItemHealingPreview {
  readonly calculationKind: ItemHealingAmountSpec['kind']
  readonly currentHp: number
  readonly fullFormulaMaximumHp: number
  readonly effectiveMaximumHp: number
  readonly injuries: number
  /** Exact for fixed/relative healing; minimum roll for rolled healing. */
  readonly minimumRequestedHealing: number
  /** Exact for fixed/relative healing; maximum roll for rolled healing. */
  readonly maximumRequestedHealing: number
  readonly expectedRequestedHealing: number
  readonly minimumEffectiveHealing: number
  readonly maximumEffectiveHealing: number
  readonly expectedEffectiveHealing: number
  readonly minimumOverheal: number
  readonly maximumOverheal: number
  readonly expectedOverheal: number
  readonly fullHealth: boolean
}

const safePositive = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`)
  return value
}

const round = (value: number, rounding: ItemHealingRoundingKind): number => rounding === 'up'
  ? Math.ceil(value)
  : rounding === 'nearest' ? Math.round(value) : Math.floor(value)

const maximumRelativeAmount = (
  amount: Extract<ItemHealingAmountSpec, { readonly kind: 'maximum-relative' }>,
  fullFormulaMaximumHp: number,
): number => Math.max(
  amount.minimum,
  round(fullFormulaMaximumHp * amount.numerator / amount.denominator, amount.rounding),
)

export interface ItemSkillCheckProfile {
  readonly skillId: ItemSkillCheckId
  readonly diceCount: number
  readonly dieSides: 6
  readonly modifier: number
}

export const resolveItemSkillCheckProfile = (input: {
  readonly amount: Extract<ItemHealingAmountSpec, { readonly kind: 'skill-check' }>
  readonly actorSheetKind?: SheetKind
  readonly actorSheet?: AnyLiveSheet
}): ItemSkillCheckProfile => {
  if (input.actorSheetKind !== 'trainer' || !input.actorSheet) {
    throw new Error('Item skill-check healing requires an authoritative Trainer actor.')
  }
  const projection = resolveTrainerEdgeCheck({
    sheet: input.actorSheet as TrainerSheet,
    requestedSkill: input.amount.skillId,
    context: 'ordinary',
  })
  if (projection.effectiveSkill !== input.amount.skillId
    || !Number.isSafeInteger(projection.rankValue)
    || projection.rankValue < 1
    || projection.rankValue > 6
    || !Number.isSafeInteger(projection.modifier)
    || Math.abs(projection.modifier) > 10_000) {
    throw new Error(`Item skill check ${input.amount.skillId} has invalid authoritative dice.`)
  }
  return Object.freeze({
    skillId: input.amount.skillId,
    diceCount: projection.rankValue,
    dieSides: 6,
    modifier: projection.modifier,
  })
}

const amountBounds = (input: {
  readonly amount: ItemHealingAmountSpec
  readonly fullFormulaMaximumHp: number
  readonly actorSheetKind?: SheetKind
  readonly actorSheet?: AnyLiveSheet
}): {
  readonly minimum: number
  readonly maximum: number
  readonly expected: number
} => {
  const { amount } = input
  if (amount.kind === 'fixed') return { minimum: amount.amount, maximum: amount.amount, expected: amount.amount }
  if (amount.kind === 'maximum-relative') {
    const value = maximumRelativeAmount(amount, input.fullFormulaMaximumHp)
    return { minimum: value, maximum: value, expected: value }
  }
  const profile = amount.kind === 'skill-check'
    ? resolveItemSkillCheckProfile({ amount, actorSheetKind: input.actorSheetKind, actorSheet: input.actorSheet })
    : { diceCount: amount.diceCount, dieSides: amount.dieSides, modifier: amount.modifier }
  const minimum = profile.diceCount + profile.modifier
  const maximum = profile.diceCount * profile.dieSides + profile.modifier
  // The arithmetic mean can be fractional; previews intentionally round down
  // to the server's whole-HP vocabulary without consuming entropy.
  const expected = Math.floor(profile.diceCount * (profile.dieSides + 1) / 2 + profile.modifier)
  if (amount.kind === 'skill-check') {
    return {
      minimum: Math.max(0, minimum),
      maximum: Math.max(0, maximum),
      expected: Math.max(0, expected),
    }
  }
  return {
    minimum: safePositive(minimum, 'Rolled healing minimum'),
    maximum: safePositive(maximum, 'Rolled healing maximum'),
    expected: safePositive(expected, 'Rolled healing expectation'),
  }
}

const vitalsFor = (kind: SheetKind, sheet: AnyLiveSheet) => kind === 'pokemon'
  ? computePokemonHealingVitals(sheet as CharacterSheet)
  : computeTrainerHealingVitals(sheet as TrainerSheet)

const effective = (currentHp: number, effectiveMaximumHp: number, requested: number): number => (
  Math.min(requested, Math.max(0, effectiveMaximumHp - currentHp))
)

/**
 * Project bounded healing without rolling. This is safe to expose only after
 * the participant itself has passed role/visibility projection.
 */
export const previewItemHpRestoration = (input: {
  readonly restoration: ItemHpRestorationSpec
  readonly sheetKind: SheetKind
  readonly sheet: AnyLiveSheet
  readonly actorSheetKind?: SheetKind
  readonly actorSheet?: AnyLiveSheet
}): ItemHealingPreview => {
  const vitals = vitalsFor(input.sheetKind, input.sheet)
  const bounds = amountBounds({
    amount: input.restoration.amount,
    fullFormulaMaximumHp: vitals.fullMaxHp,
    actorSheetKind: input.actorSheetKind,
    actorSheet: input.actorSheet,
  })
  const minimumEffectiveHealing = effective(vitals.currentHp, vitals.maxHp, bounds.minimum)
  const maximumEffectiveHealing = effective(vitals.currentHp, vitals.maxHp, bounds.maximum)
  const expectedEffectiveHealing = effective(vitals.currentHp, vitals.maxHp, bounds.expected)
  return Object.freeze({
    calculationKind: input.restoration.amount.kind,
    currentHp: vitals.currentHp,
    fullFormulaMaximumHp: vitals.fullMaxHp,
    effectiveMaximumHp: vitals.maxHp,
    injuries: vitals.injuries,
    minimumRequestedHealing: bounds.minimum,
    maximumRequestedHealing: bounds.maximum,
    expectedRequestedHealing: bounds.expected,
    minimumEffectiveHealing,
    maximumEffectiveHealing,
    expectedEffectiveHealing,
    minimumOverheal: bounds.minimum - minimumEffectiveHealing,
    maximumOverheal: bounds.maximum - maximumEffectiveHealing,
    expectedOverheal: bounds.expected - expectedEffectiveHealing,
    fullHealth: vitals.currentHp >= vitals.maxHp,
  })
}

/** Resolve server-owned healing exactly once; the returned roll evidence belongs in the immutable plan. */
export const resolveItemHpRestoration = (input: {
  readonly restoration: ItemHpRestorationSpec
  readonly sheetKind: SheetKind
  readonly sheet: AnyLiveSheet
  readonly actorSheetKind?: SheetKind
  readonly actorSheet?: AnyLiveSheet
  readonly rollDie: ItemHealingDieRoller
}): ItemHealingResolution => {
  const vitals = vitalsFor(input.sheetKind, input.sheet)
  const amount = input.restoration.amount
  let requestedHealing: number
  let rollEvidence: ItemHealingRollEvidence | null = null
  if (amount.kind === 'fixed') requestedHealing = amount.amount
  else if (amount.kind === 'maximum-relative') requestedHealing = maximumRelativeAmount(amount, vitals.fullMaxHp)
  else {
    const profile = amount.kind === 'skill-check'
      ? resolveItemSkillCheckProfile({ amount, actorSheetKind: input.actorSheetKind, actorSheet: input.actorSheet })
      : { diceCount: amount.diceCount, dieSides: amount.dieSides, modifier: amount.modifier }
    const rolls = Array.from({ length: profile.diceCount }, () => {
      const value = input.rollDie(profile.dieSides)
      if (!Number.isSafeInteger(value) || value < 1 || value > profile.dieSides) {
        throw new Error('Item healing die roller returned an invalid result.')
      }
      return value
    })
    const total = rolls.reduce((sum, value) => sum + value, profile.modifier)
    requestedHealing = amount.kind === 'skill-check'
      ? Math.max(0, total)
      : safePositive(total, 'Rolled healing result')
    rollEvidence = Object.freeze({
      expression: `${profile.diceCount}d${profile.dieSides}${profile.modifier === 0 ? '' : profile.modifier > 0 ? `+${profile.modifier}` : profile.modifier}`,
      rolls: Object.freeze(rolls),
      modifier: profile.modifier,
      total,
      ...(amount.kind === 'skill-check'
        ? { skillId: amount.skillId, rankValue: profile.diceCount, dieSides: 6 as const }
        : {}),
    })
  }
  const effectiveHealing = effective(vitals.currentHp, vitals.maxHp, requestedHealing)
  return Object.freeze({
    calculationKind: amount.kind,
    currentHp: vitals.currentHp,
    fullFormulaMaximumHp: vitals.fullMaxHp,
    effectiveMaximumHp: vitals.maxHp,
    injuries: vitals.injuries,
    requestedHealing,
    effectiveHealing,
    overheal: requestedHealing - effectiveHealing,
    resultingHp: vitals.currentHp + effectiveHealing,
    roll: rollEvidence,
  })
}

export const itemHealingPreviewDescription = (preview: ItemHealingPreview): string => {
  const amount = preview.minimumRequestedHealing === preview.maximumRequestedHealing
    ? `${preview.expectedRequestedHealing} HP requested`
    : `${preview.minimumRequestedHealing}–${preview.maximumRequestedHealing} HP rolled (expected ${preview.expectedRequestedHealing})`
  const restored = preview.minimumEffectiveHealing === preview.maximumEffectiveHealing
    ? `${preview.expectedEffectiveHealing} HP restored`
    : `${preview.minimumEffectiveHealing}–${preview.maximumEffectiveHealing} HP restored (expected ${preview.expectedEffectiveHealing})`
  const injury = preview.effectiveMaximumHp < preview.fullFormulaMaximumHp
    ? ` · Injury-adjusted cap ${preview.effectiveMaximumHp}/${preview.fullFormulaMaximumHp}`
    : ''
  const overheal = preview.expectedOverheal > 0 ? ` · ${preview.expectedOverheal} expected overheal` : ''
  return `${preview.currentHp}/${preview.effectiveMaximumHp} HP · ${amount} · ${restored}${overheal}${injury}`
}
