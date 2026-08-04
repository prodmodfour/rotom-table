import type { FeatureRollLedgerEntry } from './statePlanning'

export type FeatureDieRoller = (sides: number) => number
const DICE = /^(\d{1,2})d(\d{1,4})(?:([+-])(\d{1,4}))?$/i

/** Server-injected bounded dice evaluation retained as replay evidence. */
export const rollFeatureDice = (input: {
  readonly rollId: string
  readonly expression: string
  readonly reasonCode: string
  readonly roller: FeatureDieRoller
}): FeatureRollLedgerEntry => {
  if (!/^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(input.rollId)) throw new Error('Feature roll ID is invalid.')
  const match = DICE.exec(input.expression.trim())
  if (!match) throw new Error('Feature dice expression is invalid.')
  const count = Number(match[1]); const sides = Number(match[2]); const modifier = Number(match[4] ?? 0) * (match[3] === '-' ? -1 : 1)
  if (count < 1 || count > 32 || sides < 2 || sides > 1000 || Math.abs(modifier) > 10_000) throw new Error('Feature dice expression exceeds its budget.')
  const rolls = Array.from({ length: count }, () => {
    const value = input.roller(sides)
    if (!Number.isSafeInteger(value) || value < 1 || value > sides) throw new Error('Feature die roller returned an invalid result.')
    return value
  })
  return Object.freeze({ rollId: input.rollId, expression: `${count}d${sides}${modifier ? modifier > 0 ? `+${modifier}` : modifier : ''}`, rolls: Object.freeze(rolls), total: rolls.reduce((sum, roll) => sum + roll, modifier), reasonCode: input.reasonCode })
}
