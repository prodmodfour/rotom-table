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

export type MoveAutomationAreaDirection =
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west'
  | 'north-west'

export interface MoveAutomationAreaDirectionOption {
  direction: MoveAutomationAreaDirection
  label: string
  areaCells: GridAnchor[]
  affectedIds: string[]
}

export interface MoveAutomationTargetingOverlayState {
  userId: string
  moveName: string
  mode?: 'target' | 'area-confirmation'
  rangeLabel: string
  rangeMeters: number
  candidateIds: string[]
  areaCells?: GridAnchor[]
  affectedIds?: string[]
  areaDirection?: MoveAutomationAreaDirection
  areaDirectionOptions?: MoveAutomationAreaDirectionOption[]
}

export interface MoveAutomationFeedbackCondition {
  condition: string
  applied: boolean
  blockedBy?: string
}

export interface MoveAutomationFeedbackState {
  id: string
  userId: string
  targetId: string
  moveName: string
  phase: 'rolling' | 'result'
  naturalRoll: number
  modifiedRoll: number
  accuracyCheck: number | null
  userAccuracy: number
  targetEvasion: number
  targetEvasionLabel: string
  hit: boolean
  crit: boolean
  damageLoss: number
  conditions: MoveAutomationFeedbackCondition[]
}

export interface MoveAutomationTransaction {
  userId: string
  userName: string
  moveName: string
  scriptKind: MoveAutomationScript['kind']
  scriptVersion: number
  hpUpdates: MoveAutomationHpUpdate[]
  conditionUpdates: MoveAutomationConditionUpdate[]
  combatStageUpdates: MoveAutomationCombatStageUpdate[]
  hazardsToAdd: MapHazardV2[]
  fieldEffectsToApply: MoveAutomationFieldEffectApply[]
  logLines: string[]
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

export interface MoveAutomationConditionSuggestion {
  recipient: MoveAutomationRecipient
  /** Canonical condition name, or '*' when action is 'clear'. */
  condition: string
  action?: 'add' | 'remove' | 'clear'
  label: string
  optional?: boolean
  threshold?: string
}

export interface MoveAutomationHpSuggestion {
  recipient: MoveAutomationRecipient
  mode: 'heal-percent-max' | 'lose-percent-max' | 'lose-percent-current' | 'fixed-loss' | 'set-zero'
  percent?: number
  amount?: number
  label: string
  optional?: boolean
}

export interface MoveAutomationDirectHpLossRollTableEntry {
  roll: number
  multiplier: number
  label: string
}

export interface MoveAutomationDirectHpLossRule {
  kind: 'user-level-roll-table'
  rollFormula: string
  rollTable: MoveAutomationDirectHpLossRollTableEntry[]
  applyTypeImmunity: boolean
  ignoreWeaknessResistance: boolean
  ignoreStats: boolean
  label: string
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
  | 'cardinally-adjacent'

export interface MoveAutomationAreaTemplate {
  kind: MoveAutomationAreaTemplateKind
  /** Template size in meters/squares: Burst X, Cone X, Line X, Blast X. */
  size: number
  /** Maximum placement range for Ranged X Blast Y templates. */
  range?: number | null
  label: string
}

export interface MoveAutomationScript {
  /**
   * `explicit` means a human-authored move script owns this move. `manual-fallback`
   * is not automation coverage; it is only a guided manual resolver.
   */
  kind: 'explicit' | 'manual-fallback'
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
  areaTemplates?: MoveAutomationAreaTemplate[]
  conditionSuggestions: MoveAutomationConditionSuggestion[]
  stageSuggestions: MoveAutomationStageSuggestion[]
  hpSuggestions: MoveAutomationHpSuggestion[]
  fieldSuggestions: MoveAutomationFieldSuggestion[]
  hazardSuggestions: MoveAutomationHazardSuggestion[]
  automationNotes: string[]
}
