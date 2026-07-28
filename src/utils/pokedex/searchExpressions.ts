import { normalizeSearchText } from '~/utils/pokedex/searchBuckets'

export interface SearchCriterion {
  kind: 'criterion'
  query: string
  compactQuery: string
}

export interface SearchBooleanExpression {
  kind: 'and' | 'or'
  left: SearchExpression
  right: SearchExpression
}

export interface SearchNotExpression {
  kind: 'not'
  expression: SearchExpression
}

export type SearchExpression = SearchCriterion | SearchBooleanExpression | SearchNotExpression

export type SearchToken =
  | { kind: 'term'; value: string }
  | { kind: 'and' | 'or' | 'not' | 'open' | 'close' }

export const normalizeSearchQuery = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['\u2019]/g, '')
  .replace(/[^-a-z0-9#()]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  // Treat a leading dash as an exclusion operator while preserving hyphenated
  // names/phrases such as "jangmo-o" as normal search terms. Whitespace after
  // the dash is optional, so both "-gen 1" and "- gen 1" work.
  .replace(/(^|[(\s])-\s*(?=\S)/g, '$1not ')

export const toSearchCriterion = (value: string): SearchCriterion | null => {
  const query = normalizeSearchText(value)
  if (!query) return null

  return {
    kind: 'criterion',
    query,
    compactQuery: query.replace(/\s+/g, ''),
  }
}

export const tokenizeSearchQuery = (value: string): SearchToken[] => {
  const normalized = normalizeSearchQuery(value)
  if (!normalized) return []

  return normalized
    .split(/(\(|\)|\band\b|\bor\b|\bnot\b)/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): SearchToken => {
      if (part === '(') return { kind: 'open' }
      if (part === ')') return { kind: 'close' }
      if (part === 'and' || part === 'or' || part === 'not') return { kind: part }
      return { kind: 'term', value: part }
    })
}

export const parseSearchExpression = (value: string): SearchExpression | null => {
  const tokens = tokenizeSearchQuery(value)
  let index = 0

  const peek = () => tokens[index] ?? null

  const parsePrimary = (): SearchExpression | null => {
    const token = peek()
    if (!token) return null

    if (token.kind === 'term') {
      index += 1
      return toSearchCriterion(token.value)
    }

    if (token.kind === 'open') {
      index += 1
      const expression = parseOr()
      if (peek()?.kind === 'close') {
        index += 1
      }
      return expression
    }

    if (token.kind === 'not') {
      index += 1
      const expression = parsePrimary()
      return expression ? { kind: 'not', expression } : null
    }

    return null
  }

  const startsPrimary = (token: SearchToken | null): boolean => (
    token?.kind === 'term' || token?.kind === 'open' || token?.kind === 'not'
  )

  const parseAnd = (): SearchExpression | null => {
    let expression = parsePrimary()

    while (peek()?.kind === 'and' || startsPrimary(peek())) {
      if (peek()?.kind === 'and') {
        index += 1
      }
      const right = parsePrimary()
      if (!right) break
      expression = expression ? { kind: 'and', left: expression, right } : right
    }

    return expression
  }

  const parseOr = (): SearchExpression | null => {
    let expression = parseAnd()

    while (peek()?.kind === 'or') {
      index += 1
      const right = parseAnd()
      if (!right) break
      expression = expression ? { kind: 'or', left: expression, right } : right
    }

    return expression
  }

  return parseOr()
}

export const matchesSearchCriterion = (searchText: string, criterion: SearchCriterion): boolean => (
  searchText.includes(criterion.query)
  || (criterion.compactQuery !== criterion.query && searchText.includes(criterion.compactQuery))
)

export const matchesSearchExpression = (searchText: string, expression: SearchExpression): boolean => {
  if (expression.kind === 'criterion') {
    return matchesSearchCriterion(searchText, expression)
  }

  if (expression.kind === 'and') {
    return matchesSearchExpression(searchText, expression.left) && matchesSearchExpression(searchText, expression.right)
  }

  if (expression.kind === 'or') {
    return matchesSearchExpression(searchText, expression.left) || matchesSearchExpression(searchText, expression.right)
  }

  if (expression.kind === 'not') {
    return !matchesSearchExpression(searchText, expression.expression)
  }

  return false
}
