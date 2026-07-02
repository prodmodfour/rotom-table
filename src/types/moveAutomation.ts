import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import type {
  GridAnchor,
  MapHazardV2,
  MapRoomKind,
  MapTerrainKind,
  MapWeatherKind,
} from '~/types/map'

export interface MoveAutomationHpUpdate {
  id: string
  currentHp: number
  /** Scene-local temporary HP after applying HP loss. Undefined leaves it unchanged. */
  temporaryHp?: number
  /** Absolute Injury count after automating HP-marker / Massive Damage Injuries. */
  injuries?: number
}

export interface MoveAutomationConditionUpdate {
  id: string
  conditions: string[]
}

export interface MoveAutomationCombatStageUpdate {
  id: string
  stages: CombatStageMap
}

export interface MoveAutomationFieldEffectApply {
  kind: 'weather' | 'terrain' | 'room'
  value: MapWeatherKind | MapTerrainKind | MapRoomKind
  source?: string
}

export interface MoveAutomationLogEntry {
  at: number
  userId: string
  userName: string
  moveName: string
  scriptKind: MoveAutomationScript['kind']
  scriptVersion: number
  lines: string[]
}

export const MOVE_AUTOMATION_AREA_DIRECTIONS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
  'up',
  'down',
] as const

export type MoveAutomationAreaDirection = typeof MOVE_AUTOMATION_AREA_DIRECTIONS[number]

export interface MoveAutomationAreaDirectionOption {
  direction: MoveAutomationAreaDirection
  label: string
  areaCells: GridAnchor[]
  affectedIds: string[]
  destination?: GridAnchor
}

export interface MoveAutomationAreaTemplateOption {
  id: string
  label: string
}

export type MoveAutomationHitChanceTone = 'low' | 'medium' | 'high'

export interface MoveAutomationTargetHitChance {
  targetId: string
  percent: number
  label: string
  tone: MoveAutomationHitChanceTone
  title: string
}

export interface MoveAutomationTargetingOverlayState {
  userId: string
  moveName: string
  mode?: 'target' | 'target-count' | 'area-confirmation'
  rangeLabel: string
  rangeMeters: number
  /** Optional HUD copy override for non-move target selection flows that reuse the targeting overlay. */
  targetPrompt?: string
  candidateIds: string[]
  hitChances?: Record<string, MoveAutomationTargetHitChance | undefined>
  /** Explicit multi-target-count overlays expose the currently selected target ids before confirmation. */
  selectedTargetIds?: string[]
  /** Number of targets currently selected by an explicit target-count overlay. */
  targetCount?: number
  /** Maximum targets allowed by an explicit target-count overlay. */
  maxTargetCount?: number
  areaCells?: GridAnchor[]
  affectedIds?: string[]
  /** Area-confirmation overlays may let the user exclude/re-include candidate targets before confirming. */
  canToggleTargets?: boolean
  /** Free-aim area overlays follow the battlefield pointer instead of snapping to token-centered placements. */
  areaAimMode?: 'free'
  /** Current aim cell for a free-aim area overlay. */
  areaAimCenter?: GridAnchor
  /** Optional maximum distance, in meters, from the user for free-aim area cells. */
  areaAimRangeMeters?: number
  areaDirection?: MoveAutomationAreaDirection
  areaDirectionOptions?: MoveAutomationAreaDirectionOption[]
  /** Active area-template choice when a range has legal alternatives, such as Burst 1 or Line 6. */
  areaTemplateId?: string
  /** Legal area-template alternatives exposed before direction/target confirmation. */
  areaTemplateOptions?: MoveAutomationAreaTemplateOption[]
}

export interface MoveAutomationFeedbackCondition {
  condition: string
  applied: boolean
  blockedBy?: string
}

export type MoveAutomationFeedbackPhase = 'rolling' | 'hit-roll' | 'outcome' | 'effectiveness' | 'damage'
export type MoveAutomationFeedbackEffectiveness = 'super-effective' | 'resisted' | null

export interface MoveAutomationFeedbackState {
  id: string
  userId: string
  targetId: string
  moveName: string
  phase: MoveAutomationFeedbackPhase
  naturalRoll: number
  modifiedRoll: number
  accuracyCheck: number | null
  userAccuracy: number
  targetEvasion: number
  targetEvasionLabel: string
  hit: boolean
  crit: boolean
  effectiveness: MoveAutomationFeedbackEffectiveness
  damageResolved: boolean
  damageLoss: number
  conditions: MoveAutomationFeedbackCondition[]
}

export interface MoveAutomationTransaction {
  userId: string
  userName: string
  moveName: string
  scriptKind: MoveAutomationScript['kind']
  scriptVersion: number
  /** Targets that were selected/affected by the move, whether the accuracy roll hit or missed. */
  attackedTargetIds?: string[]
  /** Targets that were actually hit by the move, before damage/effect immunity. */
  hitTargetIds?: string[]
  hpUpdates: MoveAutomationHpUpdate[]
  conditionUpdates: MoveAutomationConditionUpdate[]
  combatStageUpdates: MoveAutomationCombatStageUpdate[]
  hazardsToAdd: MapHazardV2[]
  fieldEffectsToApply: MoveAutomationFieldEffectApply[]
  logLines: string[]
}

export interface MoveAutomationSpitePrompt {
  id: string
  defenderId: string
  defenderName: string
  attackerId: string
  attackerName: string
  moveName: string
}

export interface MoveAutomationCuteCharmPrompt {
  id: string
  defenderId: string
  defenderName: string
  attackerId: string
  attackerName: string
  moveName: string
}

export interface MoveAutomationPoisonPointPrompt {
  id: string
  defenderId: string
  defenderName: string
  attackerId: string
  attackerName: string
  moveName: string
}

export interface MoveAutomationMoxiePrompt {
  id: string
  attackerId: string
  attackerName: string
  moveName: string
  faintedTargetIds: string[]
  faintedTargetNames: string[]
}

export interface MoveAutomationCelebratePrompt {
  id: string
  attackerId: string
  attackerName: string
  moveName: string
  hitTargetIds: string[]
  hitTargetNames: string[]
}

export type MoveAutomationTargetMode =
  | 'none'
  | 'self'
  | 'one-target'
  | 'multi-target'
  | 'field'
  | 'hazard'

export type MoveAutomationRecipient = 'user' | 'target'

export interface MoveAutomationStageSuggestion {
  recipient: MoveAutomationRecipient
  key: CombatStageKey
  delta: number
  label: string
  optional?: boolean
  threshold?: string
}

export type MoveAutomationSuggestionApplyWhen = 'hit' | 'miss' | 'always'

export interface MoveAutomationConditionSuggestion {
  recipient: MoveAutomationRecipient
  /** Canonical condition name, or '*' when action is 'clear'. */
  condition: string
  action?: 'add' | 'remove' | 'clear'
  label: string
  optional?: boolean
  threshold?: string
  /** Target-recipient timing. Defaults to hit; user-recipient suggestions ignore hit/miss. */
  applyWhen?: MoveAutomationSuggestionApplyWhen
}

export interface MoveAutomationHpSuggestion {
  recipient: MoveAutomationRecipient
  mode: 'heal-percent-max' | 'heal-percent-damage-dealt' | 'recoil-percent-damage-dealt' | 'lose-percent-max' | 'lose-percent-current' | 'fixed-loss' | 'set-zero'
  percent?: number
  amount?: number
  /** Optional weather-specific percentages for moves such as Synthesis. */
  weatherPercentOverrides?: Partial<Record<MapWeatherKind, number>>
  rounding?: 'round' | 'floor'
  label: string
  optional?: boolean
}

export interface MoveAutomationDirectHpLossRollTableEntry {
  roll: number
  multiplier: number
  label: string
}

export interface MoveAutomationUserLevelRollTableDirectHpLossRule {
  kind: 'user-level-roll-table'
  rollFormula: string
  rollTable: MoveAutomationDirectHpLossRollTableEntry[]
  applyTypeImmunity: boolean
  ignoreWeaknessResistance: boolean
  ignoreStats: boolean
  label: string
}

export interface MoveAutomationFixedDirectHpLossRule {
  kind: 'fixed'
  amount: number
  applyTypeImmunity: boolean
  ignoreWeaknessResistance: boolean
  ignoreStats: boolean
  label: string
}

export type MoveAutomationDirectHpLossRule =
  | MoveAutomationUserLevelRollTableDirectHpLossRule
  | MoveAutomationFixedDirectHpLossRule

export interface MoveAutomationFiveStrikeDamageBaseRule {
  kind: 'five-strike'
  rollFormula: '1d8'
  label: string
}

export interface MoveAutomationDoubleStrikeDamageBaseRule {
  kind: 'double-strike'
  label: string
}

export interface MoveAutomationPositiveCombatStageDamageBaseRule {
  kind: 'positive-combat-stage-scaling'
  dbPerPositiveStage: number
  maxDamageBase: number
  label: string
}

export type MoveAutomationDynamicDamageBaseRule =
  | MoveAutomationFiveStrikeDamageBaseRule
  | MoveAutomationDoubleStrikeDamageBaseRule
  | MoveAutomationPositiveCombatStageDamageBaseRule

export interface MoveAutomationRandomStageSuggestionEntry {
  roll: number
  stageSuggestionIndex: number
  label: string
}

export interface MoveAutomationRandomStageSuggestionRule {
  kind: 'roll-table'
  rollFormula: '1d6'
  label: string
  entries: MoveAutomationRandomStageSuggestionEntry[]
}

export interface MoveAutomationFieldSuggestion {
  kind: 'weather' | 'terrain' | 'room'
  value: MapWeatherKind | MapTerrainKind | MapRoomKind
  label: string
  optional?: boolean
}

export interface MoveAutomationHazardSuggestion {
  kind: MapHazardV2['kind']
  squares: number
  label: string
  optional?: boolean
}

export type MoveAutomationAreaTemplateKind =
  | 'burst'
  | 'close-blast'
  | 'ranged-blast'
  | 'cone'
  | 'line'
  | 'pass'
  | 'cardinally-adjacent'

export interface MoveAutomationAreaTemplate {
  kind: MoveAutomationAreaTemplateKind
  /** Template size in meters/squares: Burst X, Cone X, Line X, Blast X. */
  size: number
  /** Maximum placement range for Ranged X Blast Y templates. */
  range?: number | null
  label: string
}

export interface MoveAutomationTargetBranch {
  id: string
  label: string
  targetMode: 'one-target' | 'multi-target'
  targetCount: number | null
  range: string
  areaTemplates?: MoveAutomationAreaTemplate[]
}

export interface MoveAutomationScript {
  /** Human-authored or generated move automation that resolves through the on-map flow. */
  kind: 'explicit'
  moveName: string
  version: number
  targetMode: MoveAutomationTargetMode
  targetCount: number | null
  damaging: boolean
  requiresAccuracy: boolean
  damageBase: number | null
  damageClass: 'Physical' | 'Special' | 'Status' | string | null
  type: string
  ac: number | null
  range: string
  effect: string
  special?: string
  keywords: string[]
  criticalRange: number | null
  directHpLoss?: MoveAutomationDirectHpLossRule
  dynamicDamageBase?: MoveAutomationDynamicDamageBaseRule
  /** Dynamic-damage scripts set this per move-user instead of mutating `damageBase` before mechanics resolve. */
  stabDamageBaseBonus?: number
  randomStageSuggestion?: MoveAutomationRandomStageSuggestionRule
  areaTemplates?: MoveAutomationAreaTemplate[]
  targetBranches?: MoveAutomationTargetBranch[]
  conditionSuggestions: MoveAutomationConditionSuggestion[]
  stageSuggestions: MoveAutomationStageSuggestion[]
  hpSuggestions: MoveAutomationHpSuggestion[]
  fieldSuggestions: MoveAutomationFieldSuggestion[]
  hazardSuggestions: MoveAutomationHazardSuggestion[]
  automationNotes: string[]
}
