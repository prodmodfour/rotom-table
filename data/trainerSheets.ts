import type {
  TrainerSheet,
  TrainerStatKey,
  TrainerSkillKey,
  TrainerSkillEntry,
  SkillRank,
} from '~/types/trainerSheet'
import { folderFromGlobKey } from '~/utils/sheetFolders'

// ---------------------------------------------------------------------------
// Auto-discover trainer sheet JSONs under ``data/trainers`` (recursively).
// Subdirectories become folders on the index, e.g.
// ``data/trainers/party-1/foo.json`` is grouped under ``"party-1"``. A sheet
// may set ``folder`` explicitly to override the auto-derived label.
// ---------------------------------------------------------------------------

const trainerModules = import.meta.glob<{ default: TrainerSheet }>(
  './trainers/**/*.json',
  { eager: true },
)

export const trainerSheets: TrainerSheet[] = Object.entries(trainerModules)
  .map(([key, mod]) => {
    const sheet = mod.default
    return {
      ...sheet,
      folder: sheet.folder ?? folderFromGlobKey(key, 'trainers'),
    }
  })
  .sort((a, b) => {
    const folderCmp = (a.folder ?? '').localeCompare(b.folder ?? '')
    if (folderCmp !== 0) return folderCmp
    return a.name.localeCompare(b.name)
  })

export const trainerSheetsBySlug = new Map(
  trainerSheets.map((sheet) => [sheet.slug, sheet]),
)

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
    const stage   = row.stage   ?? sheet.combatStages?.[key] ?? 0
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

/** PTU Trainer Max HP = base HP × Lv/5 + base HP + Lv + 10  (per PTU 1.05). */
export const computeTrainerMaxHp = (sheet: TrainerSheet): number => {
  if (sheet.maxHp != null) return sheet.maxHp
  const stats = resolveTrainerStats(sheet)
  const hpTotal = stats.find((s) => s.key === 'hp')!.total
  const lvl = sheet.level ?? 1
  return Math.floor((hpTotal * lvl) / 5) + hpTotal + lvl + 10
}

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

/** Default trainer capabilities (PTU 1.05 baseline at level 1, no edges). */
const DEFAULT_TRAINER_CAPABILITIES = {
  overland: 5,
  throwingRange: 6,
  highJump: 0,
  longJump: 1,
  swim: 2,
  power: 4,
}

export const resolveTrainerCapabilities = (sheet: TrainerSheet): {
  rows: TrainerCapabilityRow[]
  other: string[]
} => {
  const c = sheet.capabilities ?? {}
  const rows: TrainerCapabilityRow[] = [
    { label: 'Overland',       value: c.overland       ?? DEFAULT_TRAINER_CAPABILITIES.overland },
    { label: 'Throwing Range', value: c.throwingRange  ?? DEFAULT_TRAINER_CAPABILITIES.throwingRange },
    { label: 'High Jump',      value: c.highJump       ?? DEFAULT_TRAINER_CAPABILITIES.highJump },
    { label: 'Long Jump',      value: c.longJump       ?? DEFAULT_TRAINER_CAPABILITIES.longJump },
    { label: 'Swim',           value: c.swim           ?? DEFAULT_TRAINER_CAPABILITIES.swim },
    { label: 'Power',          value: c.power          ?? DEFAULT_TRAINER_CAPABILITIES.power },
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
