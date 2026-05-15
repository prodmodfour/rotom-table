import conditionsJson from '~~/ptu-data/data/conditions.json'
import {
  CONDITION_TAGS,
  conditionTagFallbackDefinition,
  conditionTagSvgMarkup,
  type ConditionTagDefinition,
  type ConditionTagSize,
} from '~/utils/conditionTagArt'

export interface PtuConditionRecord {
  name: string
  category: string
  effect?: string
  aliases?: string[]
  source?: string
}

const conditionsDict = conditionsJson as Record<string, PtuConditionRecord>

export const STATUS_CONDITION_NAMES = [
  'Burned',
  'Paralysis',
  'Frozen',
  'Poisoned',
  'Sleep',
] as const

export const CONDITION_CATEGORY_ORDER = [
  'Persistent Affliction',
  'Volatile Affliction',
  'Other Affliction',
] as const

const categoryIndex = (category: string): number => {
  const index = CONDITION_CATEGORY_ORDER.indexOf(category as (typeof CONDITION_CATEGORY_ORDER)[number])
  return index === -1 ? CONDITION_CATEGORY_ORDER.length : index
}

export const conditions = Object.values(conditionsDict).sort((a, b) => {
  const categoryCmp = categoryIndex(a.category) - categoryIndex(b.category)
  if (categoryCmp !== 0) return categoryCmp
  const statusA = STATUS_CONDITION_NAMES.indexOf(a.name as (typeof STATUS_CONDITION_NAMES)[number])
  const statusB = STATUS_CONDITION_NAMES.indexOf(b.name as (typeof STATUS_CONDITION_NAMES)[number])
  if (statusA !== -1 || statusB !== -1) {
    if (statusA === -1) return 1
    if (statusB === -1) return -1
    return statusA - statusB
  }
  return a.name.localeCompare(b.name)
})

export const conditionByName = new Map(conditions.map((condition) => [condition.name, condition]))
export const conditionSortIndex = new Map(conditions.map((condition, index) => [condition.name, index]))

export const standardStatusConditions = STATUS_CONDITION_NAMES
  .map((name) => conditionByName.get(name))
  .filter((condition): condition is PtuConditionRecord => Boolean(condition))

export const ptuSpecificConditions = conditions.filter(
  (condition) => !STATUS_CONDITION_NAMES.includes(condition.name as (typeof STATUS_CONDITION_NAMES)[number]),
)

export const conditionGroups = CONDITION_CATEGORY_ORDER.map((category) => ({
  category,
  label: category.replace(' Affliction', ' Afflictions'),
  conditions: conditions.filter((condition) => condition.category === category),
})).filter((group) => group.conditions.length > 0)

const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const EXTRA_ALIASES: Record<string, string[]> = {
  Sleep: ['Asleep', 'Sleeping'],
  Poisoned: ['Poison', 'Poisons', 'Poisoned'],
  'Badly Poisoned': ['Badly Poison', 'Toxic', 'Tox'],
  Paralysis: ['Paralyzed', 'Paralysed', 'Paralyze', 'Paralyse', 'Paralyzes', 'Paralyses', 'Paralysis'],
  Frozen: ['Freeze', 'Freezes', 'Freezing', 'Frozen'],
  Burned: ['Burn', 'Burns', 'Burnt', 'Burned'],
  Confused: ['Confusion', 'Confused'],
  Rage: ['Enraged', 'Enrage', 'Rage'],
  Infatuation: ['Infatuated', 'Infatuation'],
  Suppressed: ['Suppression', 'Suppress', 'Suppressed'],
  Cursed: ['Curse', 'Cursed'],
  Disabled: ['Disable', 'Disabled'],
  Fainted: ['Faint', 'Fainted', 'KO', 'Knocked Out'],
  Blindness: ['Blind', 'Blinded', 'Blindness'],
  'Total Blindness': ['Totally Blind', 'Totally Blinded', 'Total Blindness'],
}

const aliasToName = new Map<string, string>()
for (const condition of conditions) {
  const aliases = [condition.name, ...(condition.aliases ?? []), ...(EXTRA_ALIASES[condition.name] ?? [])]
  const tag = CONDITION_TAGS[condition.name]?.label
  if (tag) aliases.push(tag)
  for (const alias of aliases) aliasToName.set(slugify(alias), condition.name)
}

const DISABLED_CONDITION_NAME = 'Disabled'
const DISABLED_CUSTOM_SEPARATOR_RE = /^(.+?)\s*(?::|：|[-–—])\s*(.+)$/
const DISABLED_PAREN_RE = /^(.+?)\s*\((.+)\)\s*$/

const normalizeDisabledMoveName = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const moveName = raw.trim().replace(/\s+/g, ' ')
  return moveName ? moveName : null
}

const parseDisabledConditionEntry = (raw: string): { conditionName: string; moveName: string | null } | null => {
  const value = raw.trim()
  if (!value) return null

  for (const pattern of [DISABLED_PAREN_RE, DISABLED_CUSTOM_SEPARATOR_RE]) {
    const match = value.match(pattern)
    if (!match) continue

    const baseName = aliasToName.get(slugify(match[1] ?? ''))
    if (baseName !== DISABLED_CONDITION_NAME) continue

    return {
      conditionName: DISABLED_CONDITION_NAME,
      moveName: normalizeDisabledMoveName(match[2]),
    }
  }

  return null
}

export const formatDisabledCondition = (moveName: string): string => {
  const normalizedMove = normalizeDisabledMoveName(moveName)
  return normalizedMove ? `${DISABLED_CONDITION_NAME}: ${normalizedMove}` : DISABLED_CONDITION_NAME
}

export const disabledConditionMove = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  return parseDisabledConditionEntry(raw)?.moveName ?? null
}

export const normalizeConditionName = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const disabledEntry = parseDisabledConditionEntry(raw)
  if (disabledEntry) return disabledEntry.conditionName

  const key = slugify(raw.trim())
  if (!key) return null
  return aliasToName.get(key) ?? null
}

export const conditionBaseName = (raw: unknown): string | null => normalizeConditionName(raw)

export const conditionDisplayName = (raw: unknown): string => {
  if (typeof raw !== 'string') return ''
  const baseName = conditionBaseName(raw)
  if (baseName === DISABLED_CONDITION_NAME) {
    const moveName = disabledConditionMove(raw)
    return moveName ? formatDisabledCondition(moveName) : DISABLED_CONDITION_NAME
  }
  return baseName ?? raw.trim()
}

const normalizeConditionEntry = (raw: unknown): string | null => {
  const baseName = conditionBaseName(raw)
  if (!baseName) return null
  if (baseName === DISABLED_CONDITION_NAME) {
    const moveName = disabledConditionMove(raw)
    return moveName ? formatDisabledCondition(moveName) : DISABLED_CONDITION_NAME
  }
  return baseName
}

const normalizedConditionKey = (condition: string): string => {
  const baseName = conditionBaseName(condition) ?? condition
  if (baseName === DISABLED_CONDITION_NAME) {
    const moveName = disabledConditionMove(condition)
    return `${baseName}:${moveName ? slugify(moveName) : ''}`
  }
  return baseName
}

const conditionEntrySortIndex = (condition: string): number =>
  conditionSortIndex.get(conditionBaseName(condition) ?? condition) ?? 999

export const normalizeConditionNames = (raw: readonly unknown[] | undefined | null): string[] => {
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of raw) {
    const name = normalizeConditionEntry(value)
    if (!name) continue
    const key = normalizedConditionKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out.sort((a, b) => {
    const indexCmp = conditionEntrySortIndex(a) - conditionEntrySortIndex(b)
    if (indexCmp !== 0) return indexCmp
    return a.localeCompare(b)
  })
}

export const disabledMoveNamesFromConditions = (
  raw: readonly unknown[] | undefined | null,
): string[] => normalizeConditionNames(raw)
  .map((condition) => disabledConditionMove(condition))
  .filter((moveName): moveName is string => Boolean(moveName))

export const isMoveDisabledByConditions = (
  moveName: unknown,
  rawConditions: readonly unknown[] | undefined | null,
): boolean => {
  const normalizedMoveName = normalizeDisabledMoveName(moveName)
  if (!normalizedMoveName) return false
  const moveKey = slugify(normalizedMoveName)
  return disabledMoveNamesFromConditions(rawConditions).some((disabledMove) => slugify(disabledMove) === moveKey)
}

const aliasSearchTerms = conditions
  .flatMap((condition) => {
    const aliases = [condition.name, ...(condition.aliases ?? []), ...(EXTRA_ALIASES[condition.name] ?? [])]
    const tag = CONDITION_TAGS[condition.name]?.label
    if (tag) aliases.push(tag)
    return aliases.map((alias) => ({ alias, name: condition.name }))
  })
  .sort((a, b) => b.alias.length - a.alias.length)

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const conditionsFromText = (raw: unknown): string[] => {
  if (typeof raw !== 'string' || !raw.trim()) return []
  const found = new Set<string>()
  for (const { alias, name } of aliasSearchTerms) {
    const pattern = new RegExp(`(^|[^A-Za-z])${escapeRegExp(alias)}([^A-Za-z]|$)`, 'i')
    if (pattern.test(raw)) found.add(name)
  }
  return normalizeConditionNames([...found])
}

export const mergeLegacyConditions = (
  explicit: readonly unknown[] | undefined | null,
  legacyText: unknown,
): string[] => normalizeConditionNames([...normalizeConditionNames(explicit), ...conditionsFromText(legacyText)])

export const conditionTagDefinition = (name: string): ConditionTagDefinition => {
  const canonical = conditionBaseName(name) ?? name
  const tag = CONDITION_TAGS[canonical]
  if (tag) return tag
  return conditionTagFallbackDefinition(canonical)
}

export const conditionTagSvg = (name: string, size: ConditionTagSize = 'md'): string => {
  const canonical = conditionBaseName(name) ?? name
  const displayName = conditionDisplayName(name) || canonical
  return conditionTagSvgMarkup(displayName, conditionTagDefinition(canonical), size)
}

export const conditionTitle = (name: string): string => {
  const canonical = conditionBaseName(name) ?? name
  const condition = conditionByName.get(canonical)
  const displayName = conditionDisplayName(name) || canonical
  const disabledMove = canonical === DISABLED_CONDITION_NAME ? disabledConditionMove(name) : null
  const baseTitle = condition?.effect ? `${displayName} — ${condition.effect}` : displayName
  return disabledMove ? `${baseTitle} Disabled Move: ${disabledMove}.` : baseTitle
}
