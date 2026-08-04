import type {
  TrainerCapabilities,
  TrainerSheet,
  TrainerSkillKey,
  TrainerStatKey,
} from '~/types/trainerSheet'
import { computeInjuryAdjustedMaxHp, computeTrainerFormulaMaxHp } from '~/utils/ptuHp'
import { TRAINER_SKILL_ORDER } from '~/utils/sheets/trainerSkillConstants'
import {
  resolveTrainerSkillCalculations,
  type TrainerSkillCalculation,
} from '~/utils/sheets/trainerSkillCalculation'
import { SKILL_RANK_TO_VALUE } from '~/utils/skillRanks'
import { sheetHasCanonicalEdge } from '#shared/edgeAutomation/sheetEdges'
import { featureTrainerStatBonus } from '#shared/featureAutomation/providers'

// ---------------------------------------------------------------------------
// Stat resolution
// ---------------------------------------------------------------------------

export const TRAINER_STAT_LABELS: Record<TrainerStatKey, string> = {
  hp:   'HP',
  atk:  'Attack',
  def:  'Defense',
  satk: 'Special Attack',
  sdef: 'Special Defense',
  spd:  'Speed',
}

export const TRAINER_STAT_ORDER: TrainerStatKey[] = [
  'hp', 'atk', 'def', 'satk', 'sdef', 'spd',
]

const DEFAULT_BASE: Record<TrainerStatKey, number> = {
  hp: 10, atk: 5, def: 5, satk: 5, sdef: 5, spd: 5,
}

export interface ResolvedTrainerStat {
  key: TrainerStatKey
  label: string
  base: number
  feats: number
  bonus: number
  levelUp: number
  /** Sheet-authored Combat Stage before temporary condition effects. */
  stage: number
  /** Alias for the sheet-authored Combat Stage, useful when an effective stage is displayed. */
  manualStage: number
  /** Condition-supplied Combat Stage delta, such as Burned's Defense -2. */
  conditionStageModifier: number
  /** Combat Stage after temporary condition effects. */
  effectiveStage: number
  /** Stat sum before Combat Stages; used for permanent build math such as HP and stat budgets. */
  baseTotal: number
  /** Current sheet Total. Raw resolution initializes this to baseTotal; sheet views apply Combat Stages. */
  total: number
}

export const resolveTrainerStats = (sheet: TrainerSheet): ResolvedTrainerStat[] =>
  TRAINER_STAT_ORDER.map((key) => {
    const row = sheet.stats?.[key] ?? {}
    const base    = row.base    ?? DEFAULT_BASE[key]
    const feats   = Math.max(row.feats ?? 0, featureTrainerStatBonus(sheet, key))
    const bonus   = row.bonus   ?? 0
    const levelUp = row.levelUp ?? 0
    const stage   = row.stage   ?? (key === 'hp' ? 0 : sheet.combatStages?.[key] ?? 0)
    const baseTotal = base + feats + bonus + levelUp
    return {
      key,
      label: TRAINER_STAT_LABELS[key],
      base,
      feats,
      bonus,
      levelUp,
      stage,
      manualStage: stage,
      conditionStageModifier: 0,
      effectiveStage: stage,
      baseTotal,
      total: baseTotal,
    }
  })

/** PTU Trainer real/formula Max HP = Level × 2 + (HP × 3) + 10 (Core Character Creation p.16). */
export const computeTrainerFullMaxHp = (sheet: TrainerSheet): number => {
  const stats = resolveTrainerStats(sheet)
  const hpTotal = stats.find((s) => s.key === 'hp')!.total
  return computeTrainerFormulaMaxHp(sheet.level ?? 1, hpTotal)
}

/** Effective Max HP / healing cap after Injuries (Core Combat p.250). */
export const computeTrainerMaxHp = (sheet: TrainerSheet): number =>
  computeInjuryAdjustedMaxHp(computeTrainerFullMaxHp(sheet), sheet.currentInjuries)

/** PTU Trainer Max AP = 5 + floor(Lv / 5) (per PTU 1.05). */
export const computeTrainerMaxAp = (sheet: TrainerSheet): number => {
  if (sheet.ap?.max != null) return sheet.ap.max
  const lvl = sheet.level ?? 1
  return 5 + Math.floor(lvl / 5)
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export { TRAINER_SKILL_ORDER } from '~/utils/sheets/trainerSkillConstants'
export type ResolvedTrainerSkill = TrainerSkillCalculation

/**
 * Resolve trainer skills from default rank, Skill Background choices, skill
 * rank/bonus Edges, and miscellaneous bonus fields.
 */
export const resolveTrainerSkills = (sheet: TrainerSheet): ResolvedTrainerSkill[] =>
  resolveTrainerSkillCalculations(sheet)

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface TrainerCapabilityRow {
  label: string
  value: number | string
}

export type BasicTrainerCapabilityKey =
  | 'overland'
  | 'throwingRange'
  | 'highJump'
  | 'longJump'
  | 'swim'
  | 'power'

export type DefaultTrainerCapabilities = Required<Pick<TrainerCapabilities, BasicTrainerCapabilityKey>>

const trainerSkillRankValue = (skills: readonly ResolvedTrainerSkill[], key: TrainerSkillKey): number =>
  skills.find((skill) => skill.key === key)?.rankValue ?? SKILL_RANK_TO_VALUE.Untrained

/**
 * PTU 1.05 trainer capability formulas (Core Character Creation p.16):
 * - Power starts at 4, +1 at Novice Athletics, +1 at Adept Combat.
 * - High Jump starts at 0, +1 at Adept Acrobatics, +1 more at Master Acrobatics.
 * - Long Jump = floor(Acrobatics Rank / 2).
 * - Overland = 3 + floor((Athletics Rank + Acrobatics Rank) / 2).
 * - Swim = floor(Overland / 2).
 * - Throwing Range = 4 + Athletics Rank.
 */
export const computeDefaultTrainerCapabilities = (sheet: TrainerSheet): DefaultTrainerCapabilities => {
  const skills = resolveTrainerSkills(sheet)
  const athletics = trainerSkillRankValue(skills, 'athletics')
  const acrobatics = trainerSkillRankValue(skills, 'acrobatics')
  const survival = trainerSkillRankValue(skills, 'survival')
  const combat = trainerSkillRankValue(skills, 'combat')
  const traveler = sheetHasCanonicalEdge(sheet, 'trainer', 'Traveler')
  const powerAthletics = traveler ? survival : athletics
  const jumpAcrobatics = traveler ? survival : acrobatics
  const overlandRanks = traveler
    ? Math.max(athletics, acrobatics) + survival
    : athletics + acrobatics
  const overland = 3 + Math.floor(overlandRanks / 2)

  return {
    overland,
    throwingRange: 4 + athletics,
    highJump: (jumpAcrobatics >= SKILL_RANK_TO_VALUE.Adept ? 1 : 0) + (jumpAcrobatics >= SKILL_RANK_TO_VALUE.Master ? 1 : 0),
    longJump: Math.floor(jumpAcrobatics / 2),
    swim: Math.floor(overland / 2),
    power: 4
      + (powerAthletics >= SKILL_RANK_TO_VALUE.Novice ? 1 : 0)
      + (combat >= SKILL_RANK_TO_VALUE.Adept ? 1 : 0),
  }
}

export const resolveTrainerCapabilities = (sheet: TrainerSheet): {
  rows: TrainerCapabilityRow[]
  other: string[]
} => {
  const c = sheet.capabilities ?? {}
  const defaults = computeDefaultTrainerCapabilities(sheet)
  const acrobat = sheetHasCanonicalEdge(sheet, 'trainer', 'Acrobat') ? 1 : 0
  const throwingMasteries = sheetHasCanonicalEdge(sheet, 'trainer', 'Throwing Masteries') ? 2 : 0
  const swimmer = sheetHasCanonicalEdge(sheet, 'trainer', 'Swimmer') ? 2 : 0
  const powerBoost = sheetHasCanonicalEdge(sheet, 'trainer', 'Power Boost') ? 2 : 0
  const rows: TrainerCapabilityRow[] = [
    { label: 'Overland',       value: c.overland       ?? defaults.overland },
    { label: 'Throwing Range', value: (c.throwingRange ?? defaults.throwingRange) + throwingMasteries },
    { label: 'High Jump',      value: (c.highJump       ?? defaults.highJump) + acrobat },
    { label: 'Long Jump',      value: (c.longJump       ?? defaults.longJump) + acrobat },
    { label: 'Swim',           value: (c.swim           ?? defaults.swim) + swimmer },
    { label: 'Power',          value: (c.power          ?? defaults.power) + powerBoost },
  ]
  if (c.sky      != null) rows.splice(2, 0, { label: 'Sky',      value: c.sky })
  if (c.levitate != null) rows.push({ label: 'Levitate', value: c.levitate })
  if (c.burrow   != null) rows.push({ label: 'Burrow',   value: c.burrow })
  return { rows, other: c.other ?? [] }
}

// ---------------------------------------------------------------------------
// Defaults / convenience
// ---------------------------------------------------------------------------

/** Derive starting Features remaining (4 at character creation). */
export const remainingFeatures = (sheet: TrainerSheet): number =>
  sheet.remainingFeatures ?? 0

export const remainingEdges = (sheet: TrainerSheet): number =>
  sheet.remainingEdges ?? 0

/** Build the Lv 5/10/20/30/40 advancement table, filling missing rows. */
const ADVANCEMENT_LEVELS = [5, 10, 20, 30, 40]
export const resolveAdvancement = (sheet: TrainerSheet) => {
  const map = new Map((sheet.advancement ?? []).map((row) => [row.level, row]))
  return ADVANCEMENT_LEVELS.map((level) => map.get(level) ?? { level })
}
