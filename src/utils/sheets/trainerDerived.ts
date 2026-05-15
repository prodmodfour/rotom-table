import type {
  SkillRank,
  TrainerCapabilities,
  TrainerSheet,
  TrainerSkillEntry,
  TrainerSkillKey,
  TrainerStatKey,
} from '~/types/trainerSheet'
import { computeInjuryAdjustedMaxHp, computeTrainerFormulaMaxHp } from '~/utils/ptuHp'

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
  stage: number
  /** Sum used for the "Total" column (excluding stage modifier). */
  total: number
}

export const resolveTrainerStats = (sheet: TrainerSheet): ResolvedTrainerStat[] =>
  TRAINER_STAT_ORDER.map((key) => {
    const row = sheet.stats?.[key] ?? {}
    const base    = row.base    ?? DEFAULT_BASE[key]
    const feats   = row.feats   ?? 0
    const bonus   = row.bonus   ?? 0
    const levelUp = row.levelUp ?? 0
    const stage   = row.stage   ?? (key === 'hp' ? 0 : sheet.combatStages?.[key] ?? 0)
    return {
      key,
      label: TRAINER_STAT_LABELS[key],
      base,
      feats,
      bonus,
      levelUp,
      stage,
      total: base + feats + bonus + levelUp,
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

export const TRAINER_SKILL_ORDER: Array<[TrainerSkillKey, string]> = [
  ['acrobatics',  'Acrobatics'],
  ['athletics',   'Athletics'],
  ['charm',       'Charm'],
  ['combat',      'Combat'],
  ['command',     'Command'],
  ['generalEd',   'General Ed'],
  ['medicineEd',  'Medicine Ed'],
  ['occultEd',    'Occult Ed'],
  ['pokeEd',      'Pokémon Ed'],
  ['techEd',      'Technology Ed'],
  ['focus',       'Focus'],
  ['guile',       'Guile'],
  ['intimidate',  'Intimidate'],
  ['intuition',   'Intuition'],
  ['perception',  'Perception'],
  ['stealth',     'Stealth'],
  ['survival',    'Survival'],
]

const RANK_TO_VALUE: Record<SkillRank, number> = {
  Pathetic:  1,
  Untrained: 2,
  Novice:    3,
  Adept:     4,
  Expert:    5,
  Master:    6,
}

const RANK_TO_DICE: Record<SkillRank, string> = {
  Pathetic:  '1d6',
  Untrained: '2d6',
  Novice:    '3d6',
  Adept:     '4d6',
  Expert:    '5d6',
  Master:    '6d6',
}

export interface ResolvedTrainerSkill {
  key: TrainerSkillKey
  label: string
  rank: SkillRank
  rankValue: number
  modifier: number
  /** ``"2d6"`` etc. Modifier is appended in the renderer. */
  dice: string
  /** True when the background bumped this skill above untrained / below it. */
  raised: boolean
  lowered: boolean
}

const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Apply the trainer's Skill Background to derive a per-skill rank, then layer
 * any explicit `sheet.skills[key]` overrides on top.
 *
 * Background semantics (PTU 1.05): a single Adept skill, a single Novice skill,
 * and any number of Pathetic skills.
 */
export const resolveTrainerSkills = (sheet: TrainerSheet): ResolvedTrainerSkill[] => {
  const adeptKeys: TrainerSkillKey[]  = asArray(sheet.skillBackground?.adept)
  const noviceKeys: TrainerSkillKey[] = asArray(sheet.skillBackground?.novice)
  const patheticKeys                  = sheet.skillBackground?.pathetic ?? []

  return TRAINER_SKILL_ORDER.map(([key, label]) => {
    const override: TrainerSkillEntry | undefined = sheet.skills?.[key]
    let rank: SkillRank = 'Untrained'
    if (patheticKeys.includes(key)) rank = 'Pathetic'
    if (noviceKeys.includes(key))   rank = 'Novice'
    if (adeptKeys.includes(key))    rank = 'Adept'
    if (override?.rank) rank = override.rank
    const modifier = override?.modifier ?? 0
    return {
      key,
      label,
      rank,
      rankValue: RANK_TO_VALUE[rank],
      modifier,
      dice: RANK_TO_DICE[rank],
      raised:  rank === 'Adept' || rank === 'Novice',
      lowered: rank === 'Pathetic',
    }
  })
}

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
  skills.find((skill) => skill.key === key)?.rankValue ?? RANK_TO_VALUE.Untrained

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
  const combat = trainerSkillRankValue(skills, 'combat')
  const overland = 3 + Math.floor((athletics + acrobatics) / 2)

  return {
    overland,
    throwingRange: 4 + athletics,
    highJump: (acrobatics >= RANK_TO_VALUE.Adept ? 1 : 0) + (acrobatics >= RANK_TO_VALUE.Master ? 1 : 0),
    longJump: Math.floor(acrobatics / 2),
    swim: Math.floor(overland / 2),
    power: 4
      + (athletics >= RANK_TO_VALUE.Novice ? 1 : 0)
      + (combat >= RANK_TO_VALUE.Adept ? 1 : 0),
  }
}

export const resolveTrainerCapabilities = (sheet: TrainerSheet): {
  rows: TrainerCapabilityRow[]
  other: string[]
} => {
  const c = sheet.capabilities ?? {}
  const defaults = computeDefaultTrainerCapabilities(sheet)
  const rows: TrainerCapabilityRow[] = [
    { label: 'Overland',       value: c.overland       ?? defaults.overland },
    { label: 'Throwing Range', value: c.throwingRange  ?? defaults.throwingRange },
    { label: 'High Jump',      value: c.highJump       ?? defaults.highJump },
    { label: 'Long Jump',      value: c.longJump       ?? defaults.longJump },
    { label: 'Swim',           value: c.swim           ?? defaults.swim },
    { label: 'Power',          value: c.power          ?? defaults.power },
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
