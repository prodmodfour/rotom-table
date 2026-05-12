import type { PtuRule } from '~/types/ptuReference'
import { matchesReferenceSearch, normalizeReferenceSearch } from '~/utils/reference/search'

export interface RuleCategoryCount {
  category: string
  count: number
}

export interface RuleFilterOptions {
  searchTerm?: string
  category?: string | null
}

export interface RuleGroup {
  category: string
  entries: PtuRule[]
}

export const buildRuleCategoryCounts = (rules: readonly PtuRule[]): RuleCategoryCount[] => {
  const counts = new Map<string, number>()
  for (const rule of rules) {
    counts.set(rule.category, (counts.get(rule.category) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }))
}

export const ruleMatchesSearch = (rule: PtuRule, normalizedQuery: string): boolean => {
  const haystacks = [
    rule.name,
    rule.category,
    rule.text ?? '',
    rule.source ?? '',
    ...(rule.aliases ?? []),
  ]
  return matchesReferenceSearch(haystacks, normalizedQuery)
}

export const filterRulesForIndex = (
  rules: readonly PtuRule[],
  options: RuleFilterOptions,
): PtuRule[] => {
  const query = normalizeReferenceSearch(options.searchTerm ?? '')
  return rules.filter((rule) => {
    if (options.category && rule.category !== options.category) return false
    return ruleMatchesSearch(rule, query)
  })
}

export const groupRulesForIndex = (rules: readonly PtuRule[]): RuleGroup[] => {
  const groups = new Map<string, PtuRule[]>()
  for (const rule of rules) {
    const group = groups.get(rule.category) ?? []
    group.push(rule)
    groups.set(rule.category, group)
  }

  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, entries]) => ({ category, entries }))
}

export const toggledRuleCategory = (currentCategory: string | null, nextCategory: string): string | null =>
  currentCategory === nextCategory ? null : nextCategory
