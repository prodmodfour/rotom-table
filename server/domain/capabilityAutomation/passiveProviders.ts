export type PackMonDisposition = 'obeys' | 'fearful' | 'dominance-fight' | 'expects-obedience' | 'none'

export const resolvePackMonDisposition = (input: {
  readonly userSpecies: string
  readonly userLevel: number
  readonly userIsWild: boolean
  readonly targetSpecies: string
  readonly targetLevel: number
  readonly targetIsWild: boolean
  readonly targetIsUnevolvedFormOfUser?: boolean
  readonly bothHavePackMon: boolean
}): PackMonDisposition => {
  if (!input.targetIsWild) return 'none'
  const sameSpecies = input.userSpecies.trim().toLocaleLowerCase('en-US')
    === input.targetSpecies.trim().toLocaleLowerCase('en-US')
  // The later, specific Pack Leader clause wins the exact-ten overlap with
  // the general same-species "within 10 Levels" dominance clause.
  if (input.bothHavePackMon && input.targetLevel >= input.userLevel + 10) return 'expects-obedience'
  if (input.bothHavePackMon && sameSpecies && Math.abs(input.userLevel - input.targetLevel) <= 10) return 'dominance-fight'
  if (input.targetIsUnevolvedFormOfUser || input.targetLevel <= input.userLevel - 10) return 'obeys'
  return 'fearful'
}

export const xRayVisionCanPenetrate = (input: {
  readonly thicknessFeet: number
  readonly material: string
}): boolean => {
  const material = input.material.trim()
  return Number.isFinite(input.thicknessFeet)
    && input.thicknessFeet >= 0
    && input.thicknessFeet <= 1
    && material.length > 0
    && !/(?:^|[^a-z])(?:lead|tungsten)(?:[^a-z]|$)/i.test(material)
}

export const tremorsenseCanResolve = (input: {
  readonly distanceMeters: number
  readonly inGround: boolean
  readonly maximumMeters?: number
}): boolean => input.inGround
  && Number.isFinite(input.distanceMeters)
  && input.distanceMeters >= 0
  && input.distanceMeters <= (input.maximumMeters ?? 5)

export interface PremonitionResolution {
  readonly warningBand: 'unease-hours' | 'regional-warning-days' | 'specific-area-days'
  readonly revealsSpecificArea: boolean
}

/** Bounded GM-authored magnitude/proximity become a stable warning band; no prose is interpreted. */
export const resolvePremonitionBand = (input: {
  readonly magnitude: 1 | 2 | 3
  readonly proximity: 1 | 2 | 3
}): PremonitionResolution => {
  const strength = input.magnitude + input.proximity
  if (strength >= 6) return { warningBand: 'specific-area-days', revealsSpecificArea: true }
  if (strength >= 4) return { warningBand: 'regional-warning-days', revealsSpecificArea: false }
  return { warningBand: 'unease-hours', revealsSpecificArea: false }
}
