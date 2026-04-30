export type CombatStageKey = 'atk' | 'def' | 'satk' | 'sdef' | 'spd' | 'acc'

export type CombatStatStageKey = Exclude<CombatStageKey, 'acc'>

export type CombatStageMap = Record<CombatStageKey, number>
