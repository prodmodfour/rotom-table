export type ConditionSaveTiming = 'start-turn' | 'end-turn'

export interface ConditionSaveAutomationRule {
  readonly condition: string
  readonly dc: number
  readonly timing: ConditionSaveTiming
}

export const CONDITION_SAVE_AUTOMATION_RULES = [
  { condition: 'Paralysis', dc: 11, timing: 'start-turn' },
  { condition: 'Frozen', dc: 16, timing: 'end-turn' },
  { condition: 'Sleep', dc: 16, timing: 'end-turn' },
  { condition: 'Rage', dc: 15, timing: 'end-turn' },
  { condition: 'Infatuation', dc: 16, timing: 'end-turn' },
  { condition: 'Confused', dc: 16, timing: 'end-turn' },
] as const satisfies readonly ConditionSaveAutomationRule[]

const CONDITION_SAVE_RULES_BY_NAME = new Map<string, ConditionSaveAutomationRule>(
  CONDITION_SAVE_AUTOMATION_RULES.map((rule) => [rule.condition, rule]),
)

const CONDITION_DETAIL_SEPARATOR_RE = /\s*(?::|：|[-–—])\s*.+$/
const CONDITION_DETAIL_PAREN_RE = /\s*\(.+\)\s*$/

export const conditionAutomationBaseName = (condition: string): string => (
  condition
    .trim()
    .replace(CONDITION_DETAIL_SEPARATOR_RE, '')
    .replace(CONDITION_DETAIL_PAREN_RE, '')
)

export const conditionSaveAutomationRule = (condition: string): ConditionSaveAutomationRule | null => (
  CONDITION_SAVE_RULES_BY_NAME.get(conditionAutomationBaseName(condition)) ?? null
)

export const conditionSaveDc = (condition: string): number | null => (
  conditionSaveAutomationRule(condition)?.dc ?? null
)

export const conditionSaveDcText = (condition: string): string => {
  const dc = conditionSaveDc(condition)
  return dc === null ? 'DC —' : `DC ${dc}`
}

export const conditionSaveThresholdText = (condition: string): string => {
  const dc = conditionSaveDc(condition)
  return dc === null ? '—+' : `${dc}+`
}
