import { computeInjuryAdjustedMaxHp, normalizeInjuryCount } from '~/utils/ptuHp'

/**
 * PTU Injury automation helpers.
 *
 * Core Combat p.237/p.250:
 * - Damage causes 1 Massive Damage Injury when a single damage source deals at
 *   least 50% of the target's real/formula Max HP.
 * - Hit Point loss / HP-setting effects never cause Massive Damage Injuries.
 * - Any HP reduction can cause Hit Point Marker Injuries when crossing 50%, 0%,
 *   -50%, -100%, and every -50% real/formula Max HP thereafter.
 * - Injury-adjusted Max HP is not used for these checks.
 */

export type PtuInjuryHpReductionSource = 'damage' | 'hp-loss'

export interface PtuInjuryAutomationInput {
  beforeHp: number
  afterHp: number
  fullMaxHp: number
  currentInjuries?: number | null
  source: PtuInjuryHpReductionSource
}

export interface PtuInjuryAutomationResult {
  injuries: number
  injuryDelta: number
  massiveDamageInjuries: number
  markerInjuries: number
  crossedMarkers: number[]
  maxHp: number
}

const whole = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.floor(value)
}

const normalizeHp = (value: number): number => whole(value)

const uniquePush = (values: number[], value: number): void => {
  if (!values.includes(value)) values.push(value)
}

export const ptuMassiveDamageThreshold = (fullMaxHp: number): number => {
  const maxHp = Math.max(0, whole(fullMaxHp))
  if (maxHp <= 0) return 0
  return Math.max(1, Math.floor(maxHp / 2))
}

export const ptuHitPointInjuryMarkersCrossed = (
  beforeHp: number,
  afterHp: number,
  fullMaxHp: number,
): number[] => {
  const before = normalizeHp(beforeHp)
  const after = normalizeHp(afterHp)
  const maxHp = Math.max(0, whole(fullMaxHp))
  if (maxHp <= 0 || after >= before) return []

  const markers: number[] = []
  uniquePush(markers, Math.floor(maxHp / 2))
  uniquePush(markers, 0)

  for (let halfSteps = 1; ; halfSteps += 1) {
    const marker = -Math.floor((maxHp * halfSteps) / 2)
    if (marker >= 0) continue
    if (marker < after) break
    uniquePush(markers, marker)
  }

  return markers
    .filter((marker) => before > marker && after <= marker)
    .sort((a, b) => b - a)
}

export const computePtuInjuryAutomation = ({
  beforeHp,
  afterHp,
  fullMaxHp,
  currentInjuries,
  source,
}: PtuInjuryAutomationInput): PtuInjuryAutomationResult => {
  const before = normalizeHp(beforeHp)
  const after = normalizeHp(afterHp)
  const baseInjuries = normalizeInjuryCount(currentInjuries)
  const maxHp = Math.max(0, whole(fullMaxHp))
  if (maxHp <= 0 || after >= before) {
    return {
      injuries: baseInjuries,
      injuryDelta: 0,
      massiveDamageInjuries: 0,
      markerInjuries: 0,
      crossedMarkers: [],
      maxHp: computeInjuryAdjustedMaxHp(maxHp, baseInjuries),
    }
  }

  const crossedMarkers = ptuHitPointInjuryMarkersCrossed(before, after, maxHp)
  const markerInjuries = crossedMarkers.length
  const hpReduced = before - after
  const massiveDamageInjuries = source === 'damage' && hpReduced >= ptuMassiveDamageThreshold(maxHp) ? 1 : 0
  const injuryDelta = markerInjuries + massiveDamageInjuries
  const injuries = baseInjuries + injuryDelta

  return {
    injuries,
    injuryDelta,
    massiveDamageInjuries,
    markerInjuries,
    crossedMarkers,
    maxHp: computeInjuryAdjustedMaxHp(maxHp, injuries),
  }
}
