import powerChartJson from '../../data/capability-automation/power-chart.json'

export interface CapabilityPowerLimits {
  readonly power: number
  readonly heavyMinimum: number
  readonly heavyMaximum: number
  readonly staggeringMaximum: number
  readonly dragMaximum: number
}

export type CapabilityPowerLoadClass = 'unburdened' | 'heavy' | 'staggering' | 'drag' | 'too-heavy'

const rows = Object.freeze(powerChartJson.rows.map(row => Object.freeze({ ...row }))) as readonly CapabilityPowerLimits[]
if (rows.length !== 16 || rows.some((row, index) => row.power !== index + 1)) {
  throw new Error('Capability Power chart must contain the reviewed values 1 through 16.')
}
export const CAPABILITY_POWER_LIMITS = rows

/** Values above the printed chart conservatively use the Power 16 limits. */
export const capabilityPowerLimits = (power: number): CapabilityPowerLimits => {
  const normalized = Math.max(1, Math.min(16, Math.floor(Number.isFinite(power) ? power : 1)))
  return rows[normalized - 1]!
}

export interface CapabilityPowerLoadResolution {
  readonly loadClass: CapabilityPowerLoadClass
  readonly movementMetersPerShift: number | null
  readonly speedCombatStagePenalty: number
  readonly accuracyPenalty: number
  readonly evasionPenalty: number
  readonly standardActionsAllowed: boolean
  readonly athleticsCheckDc: number | null
}

export const resolveCapabilityPowerLoad = (
  power: number,
  pounds: number,
): CapabilityPowerLoadResolution => {
  const limits = capabilityPowerLimits(power)
  const weight = Math.max(0, Number.isFinite(pounds) ? pounds : Number.POSITIVE_INFINITY)
  if (weight < limits.heavyMinimum) return {
    loadClass: 'unburdened', movementMetersPerShift: null, speedCombatStagePenalty: 0,
    accuracyPenalty: 0, evasionPenalty: 0, standardActionsAllowed: true, athleticsCheckDc: null,
  }
  if (weight <= limits.heavyMaximum) return {
    loadClass: 'heavy', movementMetersPerShift: null, speedCombatStagePenalty: -2,
    accuracyPenalty: -2, evasionPenalty: -2, standardActionsAllowed: true, athleticsCheckDc: null,
  }
  if (weight <= limits.staggeringMaximum) return {
    loadClass: 'staggering', movementMetersPerShift: 1, speedCombatStagePenalty: -4,
    accuracyPenalty: -4, evasionPenalty: -4, standardActionsAllowed: false, athleticsCheckDc: 4,
  }
  if (weight < limits.dragMaximum) return {
    loadClass: 'drag', movementMetersPerShift: 1, speedCombatStagePenalty: 0,
    accuracyPenalty: 0, evasionPenalty: 0, standardActionsAllowed: true, athleticsCheckDc: null,
  }
  return {
    loadClass: 'too-heavy', movementMetersPerShift: 0, speedCombatStagePenalty: 0,
    accuracyPenalty: 0, evasionPenalty: 0, standardActionsAllowed: false, athleticsCheckDc: null,
  }
}

export const resolveCapabilityJump = (input: {
  readonly long: number
  readonly high: number
  readonly kind: 'long' | 'high'
  readonly acrobaticsCheckTotal?: number | null
  readonly runningStart?: boolean
}): number => {
  const base = input.kind === 'long' ? input.long : input.high
  const checkedBonus = (input.acrobaticsCheckTotal ?? Number.NEGATIVE_INFINITY) >= 16 ? 1 : 0
  // The running-start bonus is part of Trainer High Jump derivation. Pokémon
  // sheet values are already authored as their capability and do not gain it here.
  const runningBonus = input.kind === 'high' && input.runningStart ? 1 : 0
  return Math.max(0, Math.floor(base)) + checkedBonus + runningBonus
}
