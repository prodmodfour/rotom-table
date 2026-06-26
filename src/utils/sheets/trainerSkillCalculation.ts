import type {
  SkillRank,
  TrainerEdgeEntry,
  TrainerSheet,
  TrainerSkillKey,
} from '~/types/trainerSheet'
import { TRAINER_SKILL_ORDER } from '~/utils/sheets/trainerSkillConstants'
import { trainerSkillKeyFromInput } from '~/utils/sheets/trainerSkillCsv'
import {
  SKILL_RANK_TO_DICE,
  SKILL_RANK_TO_VALUE,
} from '~/utils/skillRanks'

export type TrainerSkillRankSourceKind = 'base' | 'background' | 'edge' | 'misc'
export type TrainerSkillModifierSourceKind = 'edge'

export interface TrainerSkillRankSource {
  id: string
  kind: TrainerSkillRankSourceKind
  label: string
  detail: string
  fromRank?: SkillRank
  rank: SkillRank
  applied: boolean
}

export interface TrainerSkillModifierSource {
  id: string
  kind: TrainerSkillModifierSourceKind
  label: string
  detail: string
  modifier: number
  applied: boolean
}

export interface TrainerSkillCalculation {
  key: TrainerSkillKey
  label: string
  /** Rank from default + background + edges before any miscellaneous rank bonus. */
  automaticRank: SkillRank
  rank: SkillRank
  rankValue: number
  modifier: number
  edgeModifier: number
  rankBonus: number
  miscModifier: number
  dice: string
  raised: boolean
  lowered: boolean
  rankSources: TrainerSkillRankSource[]
  modifierSources: TrainerSkillModifierSource[]
}

type MutableSkillCalculation = {
  key: TrainerSkillKey
  label: string
  rank: SkillRank
  edgeModifier: number
  rankSources: TrainerSkillRankSource[]
  modifierSources: TrainerSkillModifierSource[]
}

const SKILL_RANKS: readonly SkillRank[] = [
  'Pathetic',
  'Untrained',
  'Novice',
  'Adept',
  'Expert',
  'Master',
]

const DEFAULT_SKILL_RANK: SkillRank = 'Untrained'
const NOVICE_RANK_VALUE = SKILL_RANK_TO_VALUE.Novice

const rankFromValue = (value: number): SkillRank => {
  const clamped = Math.max(1, Math.min(SKILL_RANKS.length, Math.floor(value)))
  return SKILL_RANKS[clamped - 1] ?? DEFAULT_SKILL_RANK
}

const maxRank = (left: SkillRank, right: SkillRank): SkillRank =>
  SKILL_RANK_TO_VALUE[left] >= SKILL_RANK_TO_VALUE[right] ? left : right

const coerceFiniteNumber = (value: unknown): number => {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

const coerceInteger = (value: unknown): number => Math.trunc(coerceFiniteNumber(value))

const formatSignedNumber = (value: number): string => value > 0 ? `+${value}` : String(value)

const normalizeChoiceToken = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/gi, '')
  .toLowerCase()

const trailingChoiceMatch = (name: string): RegExpMatchArray | null =>
  name.match(/^(.*?)\s*\(([^)]*)\)\s*$/)

const stripEntryChoiceSuffix = (name: string): string =>
  trailingChoiceMatch(name)?.[1]?.trim() ?? name.trim()

const trailingChoiceText = (name: string): string =>
  trailingChoiceMatch(name)?.[2]?.trim() ?? ''

const splitChoiceTokens = (raw: string): string[] => raw
  .split(/\s*(?:,|\/|;|\band\b|&)\s*/i)
  .map((token) => token.trim())
  .filter(Boolean)

const coerceSkillKey = (value: unknown): TrainerSkillKey | undefined => {
  if (typeof value !== 'string') return undefined
  return trainerSkillKeyFromInput(value)
}

const asSkillKeyArray = (value: unknown): TrainerSkillKey[] => {
  const list = Array.isArray(value) ? value : value == null ? [] : [value]
  const parsed: TrainerSkillKey[] = []
  for (const item of list) {
    const key = coerceSkillKey(item)
    if (key && !parsed.includes(key)) parsed.push(key)
  }
  return parsed
}

const edgeBaseName = (edge: TrainerEdgeEntry): string => stripEntryChoiceSuffix(edge.name ?? '')
const edgeKindToken = (edge: TrainerEdgeEntry): string => normalizeChoiceToken(edgeBaseName(edge))

const edgeLabel = (edge: TrainerEdgeEntry, index: number): string =>
  `Edge #${index + 1}: ${edgeBaseName(edge) || 'Unnamed Edge'}`

const parentheticalChoice = (
  edge: TrainerEdgeEntry,
  choiceIndex: number,
): TrainerSkillKey | undefined => {
  const tokens = splitChoiceTokens(trailingChoiceText(edge.name ?? ''))
  return coerceSkillKey(tokens[choiceIndex])
}

const edgeSkillChoice = (
  edge: TrainerEdgeEntry,
  choiceKey: 'skill' | 'skill2',
  choiceIndex: number,
): TrainerSkillKey | undefined => {
  const legacyBasicSkill = choiceKey === 'skill' ? coerceSkillKey(edge.basicSkill) : undefined
  return legacyBasicSkill
    ?? coerceSkillKey(edge.choices?.[choiceKey])
    ?? parentheticalChoice(edge, choiceIndex)
}

const rankChangeDetail = (
  fromRank: SkillRank,
  toRank: SkillRank,
  noChangeDetail: string,
): string => fromRank === toRank ? noChangeDetail : `${fromRank} → ${toRank}`

const rankBonusChangeDetail = (
  fromRank: SkillRank,
  toRank: SkillRank,
  rankBonus: number,
): string => fromRank === toRank
  ? `${formatSignedNumber(rankBonus)} rank step; ${fromRank} is already at the rank limit`
  : `${formatSignedNumber(rankBonus)} rank step: ${fromRank} → ${toRank}`

const createSkillRows = (): Map<TrainerSkillKey, MutableSkillCalculation> => {
  const rows = new Map<TrainerSkillKey, MutableSkillCalculation>()
  for (const [key, label] of TRAINER_SKILL_ORDER) {
    rows.set(key, {
      key,
      label,
      rank: DEFAULT_SKILL_RANK,
      edgeModifier: 0,
      rankSources: [{
        id: `${key}:base`,
        kind: 'base',
        label: 'Base',
        detail: `${DEFAULT_SKILL_RANK} by default`,
        rank: DEFAULT_SKILL_RANK,
        applied: true,
      }],
      modifierSources: [],
    })
  }
  return rows
}

const applyRankSource = (
  row: MutableSkillCalculation,
  source: Omit<TrainerSkillRankSource, 'fromRank' | 'applied'>,
): void => {
  const fromRank = row.rank
  const applied = source.rank !== fromRank
  row.rankSources.push({
    ...source,
    fromRank,
    applied,
  })
  if (applied) row.rank = source.rank
}

const applyBackgroundRank = (
  rows: Map<TrainerSkillKey, MutableSkillCalculation>,
  keys: readonly TrainerSkillKey[],
  rank: SkillRank,
  sourceLabel: string,
): void => {
  for (const key of keys) {
    const row = rows.get(key)
    if (!row) continue
    applyRankSource(row, {
      id: `${key}:background:${rank}`,
      kind: 'background',
      label: sourceLabel,
      detail: rankChangeDetail(row.rank, rank, `Already ${rank}`),
      rank,
    })
  }
}

const applySkillBackground = (
  sheet: TrainerSheet,
  rows: Map<TrainerSkillKey, MutableSkillCalculation>,
): void => {
  const background = sheet.skillBackground
  if (!background) return

  const sourceLabel = background.name?.trim()
    ? `Background: ${background.name.trim()}`
    : 'Skill Background'

  applyBackgroundRank(rows, asSkillKeyArray(background.pathetic), 'Pathetic', sourceLabel)
  applyBackgroundRank(rows, asSkillKeyArray(background.novice), 'Novice', sourceLabel)
  applyBackgroundRank(rows, asSkillKeyArray(background.adept), 'Adept', sourceLabel)
}

const applyBasicSkillsEdge = (
  row: MutableSkillCalculation,
  edge: TrainerEdgeEntry,
  index: number,
): void => {
  const fromRank = row.rank
  const fromValue = SKILL_RANK_TO_VALUE[fromRank]
  const rank = fromValue < NOVICE_RANK_VALUE
    ? rankFromValue(fromValue + 1)
    : fromRank

  applyRankSource(row, {
    id: `${row.key}:edge:${index}:rank`,
    kind: 'edge',
    label: edgeLabel(edge, index),
    detail: rankChangeDetail(fromRank, rank, `No rank change; ${fromRank} is already Novice or higher`),
    rank,
  })
}

const TARGET_RANK_EDGES: Record<string, SkillRank> = {
  adeptskills: 'Adept',
  expertskills: 'Expert',
  masterskills: 'Master',
}

const applyTargetRankEdge = (
  row: MutableSkillCalculation,
  edge: TrainerEdgeEntry,
  index: number,
  targetRank: SkillRank,
): void => {
  const fromRank = row.rank
  const rank = maxRank(fromRank, targetRank)
  applyRankSource(row, {
    id: `${row.key}:edge:${index}:rank`,
    kind: 'edge',
    label: edgeLabel(edge, index),
    detail: rankChangeDetail(fromRank, rank, `No rank change; already ${fromRank}`),
    rank,
  })
}

const applyVirtuosoEdge = (
  row: MutableSkillCalculation,
  edge: TrainerEdgeEntry,
  index: number,
): void => {
  row.rankSources.push({
    id: `${row.key}:edge:${index}:virtuoso`,
    kind: 'edge',
    label: edgeLabel(edge, index),
    detail: 'Virtuoso affects rank-based prerequisites/effects; skill checks remain Master at most',
    fromRank: row.rank,
    rank: row.rank,
    applied: false,
  })
}

const applySkillEnhancementEdge = (
  rows: Map<TrainerSkillKey, MutableSkillCalculation>,
  enhancedSkills: Set<TrainerSkillKey>,
  edge: TrainerEdgeEntry,
  index: number,
): void => {
  const skills = [
    edgeSkillChoice(edge, 'skill', 0),
    edgeSkillChoice(edge, 'skill2', 1),
  ].filter((key): key is TrainerSkillKey => Boolean(key))

  const uniqueSkills = [...new Set(skills)]
  for (const key of uniqueSkills) {
    const row = rows.get(key)
    if (!row) continue
    const duplicate = enhancedSkills.has(key)
    const modifier = duplicate ? 0 : 2
    row.modifierSources.push({
      id: `${key}:edge:${index}:skill-enhancement`,
      kind: 'edge',
      label: edgeLabel(edge, index),
      detail: duplicate
        ? 'Duplicate Skill Enhancement ignored; a skill can only receive this bonus once'
        : '+2 from Skill Enhancement',
      modifier,
      applied: !duplicate,
    })
    if (!duplicate) {
      row.edgeModifier += modifier
      enhancedSkills.add(key)
    }
  }
}

const applySkillEdges = (
  sheet: TrainerSheet,
  rows: Map<TrainerSkillKey, MutableSkillCalculation>,
): void => {
  const enhancedSkills = new Set<TrainerSkillKey>()

  for (const [index, edge] of (sheet.edges ?? []).entries()) {
    const kind = edgeKindToken(edge)

    if (kind === 'skillenhancement') {
      applySkillEnhancementEdge(rows, enhancedSkills, edge, index)
      continue
    }

    const skill = edgeSkillChoice(edge, 'skill', 0)
    if (!skill) continue
    const row = rows.get(skill)
    if (!row) continue

    if (kind === 'basicskills') {
      applyBasicSkillsEdge(row, edge, index)
      continue
    }

    const targetRank = TARGET_RANK_EDGES[kind]
    if (targetRank) {
      applyTargetRankEdge(row, edge, index, targetRank)
      continue
    }

    if (kind === 'virtuoso') {
      applyVirtuosoEdge(row, edge, index)
    }
  }
}

const applyMiscRankBonus = (
  row: MutableSkillCalculation,
  rankBonus: number,
): void => {
  if (rankBonus === 0) return

  const fromRank = row.rank
  const rank = rankFromValue(SKILL_RANK_TO_VALUE[fromRank] + rankBonus)
  applyRankSource(row, {
    id: `${row.key}:misc-rank-bonus`,
    kind: 'misc',
    label: 'Miscellaneous rank bonus',
    detail: rankBonusChangeDetail(fromRank, rank, rankBonus),
    rank,
  })
}

export const resolveTrainerSkillCalculations = (sheet: TrainerSheet): TrainerSkillCalculation[] => {
  const rows = createSkillRows()
  applySkillBackground(sheet, rows)
  applySkillEdges(sheet, rows)

  return TRAINER_SKILL_ORDER.map(([key]) => {
    const row = rows.get(key)!
    const automaticRank = row.rank
    const rankBonus = coerceInteger(sheet.skills?.[key]?.rankBonus)
    applyMiscRankBonus(row, rankBonus)

    const miscModifier = coerceFiniteNumber(sheet.skills?.[key]?.modifier)
    const modifier = row.edgeModifier + miscModifier
    const rankValue = SKILL_RANK_TO_VALUE[row.rank]

    return {
      key: row.key,
      label: row.label,
      automaticRank,
      rank: row.rank,
      rankValue,
      modifier,
      edgeModifier: row.edgeModifier,
      rankBonus,
      miscModifier,
      dice: SKILL_RANK_TO_DICE[row.rank],
      raised: rankValue > SKILL_RANK_TO_VALUE.Untrained,
      lowered: rankValue < SKILL_RANK_TO_VALUE.Untrained,
      rankSources: row.rankSources,
      modifierSources: row.modifierSources,
    }
  })
}
