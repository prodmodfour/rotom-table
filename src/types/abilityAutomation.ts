import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
} from '~/types/moveAutomation'

export type AbilityAutomationCategory = 'sheet' | 'map' | 'passive'

export interface AbilitySheetActivationUpdate {
  id: string
  abilityName: string
  activated: boolean
}

export interface AbilityAutomationLogEntry {
  at: number
  userId: string
  userName: string
  abilityName: string
  category: AbilityAutomationCategory
  lines: string[]
}

export interface AbilityAutomationTransaction {
  userId: string
  userName: string
  abilityName: string
  category: AbilityAutomationCategory
  combatStageUpdates: MoveAutomationCombatStageUpdate[]
  conditionUpdates: MoveAutomationConditionUpdate[]
  logLines: string[]
}
