export type ParsedSkillDiceValue = {
  dice: number
  modifier: number
}

export const stripParenthetical = (value: string) => value.replace(/\s*\([^)]*\)/g, '').trim()

export const minimumIntegerSearchValues = (value: number | null | undefined): number[] => {
  if (value == null || !Number.isFinite(value)) return []

  const maximum = Math.floor(value)
  if (maximum < 1) return []

  return Array.from({ length: maximum }, (_, index) => index + 1)
}

export const maximumNumericComponent = (value: string | number | null | undefined): number | null => {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  const numbers = value
    .match(/\d+(?:\.\d+)?/g)
    ?.map((number) => Number(number))
    .filter((number) => Number.isFinite(number)) ?? []

  return numbers.length > 0 ? Math.max(...numbers) : null
}

export const parseSkillDiceValue = (value: string): ParsedSkillDiceValue | null => {
  const match = value.trim().toLowerCase().match(/^(\d+)\s*d\s*6\s*([+-]\s*(\d+)?)?$/)
  if (!match) return null

  const dice = Number(match[1])
  if (!Number.isFinite(dice) || dice < 1) return null

  const sign = match[2]?.trim().charAt(0) ?? ''
  const modifierValue = match[3] ? Number(match[3]) : 0
  const modifier = sign === '-' ? -modifierValue : modifierValue

  return { dice: Math.floor(dice), modifier }
}

export const formatSkillDiceSearchValue = (dice: number, modifier = 0): string => {
  if (modifier > 0) return `${dice}d6+${modifier}`
  if (modifier < 0) return `${dice}d6${modifier}`
  return `${dice}d6`
}

export const minimumSkillDiceSearchValues = (value: string): string[] => {
  const parsed = parseSkillDiceValue(value)
  if (!parsed) return []

  const values: string[] = []
  for (let dice = 1; dice <= parsed.dice; dice += 1) {
    values.push(formatSkillDiceSearchValue(dice))
  }

  if (parsed.modifier > 0) {
    for (let modifier = 1; modifier <= parsed.modifier; modifier += 1) {
      values.push(formatSkillDiceSearchValue(parsed.dice, modifier))
    }
  }

  return values
}
