import type {
  EncounterActionOffer,
  EncounterChoiceOffer,
  EncounterTargetingSummary,
} from '../encounterPresentation/contracts'
import type {
  EncounterWorkspaceEnvironmentEntry,
  EncounterWorkspaceParticipant,
} from './model'

export const ENCOUNTER_SPATIAL_PRESENTATIONS = [
  'card',
  'relationship',
  'compact-tactical',
  'full-tactical',
] as const
export type EncounterSpatialPresentation = typeof ENCOUNTER_SPATIAL_PRESENTATIONS[number]

export const ENCOUNTER_TACTICAL_LENS_BUDGETS = Object.freeze({
  startupMs: 5_000,
  mountedRendererCount: 1,
  compactPreviewOptions: 64,
})

export const encounterTacticalStartupWithinBudget = (startupMs: number): boolean => (
  Number.isFinite(startupMs) && startupMs >= 0 && startupMs <= ENCOUNTER_TACTICAL_LENS_BUDGETS.startupMs
)

const SPATIAL_CHOICE_KINDS = new Set([
  'cell', 'area', 'direction', 'destination', 'path',
])

/**
 * Select the least-spatial presentation justified by an authoritative offer.
 * This chooses UI only and never grants target eligibility or command authority.
 */
export const encounterSpatialPresentationForOffer = (
  offer: EncounterActionOffer,
): EncounterSpatialPresentation => {
  const targets = offer.targeting
  if (offer.intent.input === 'spatial' || targets.some(target => target.requiresSpatialInput)) return 'full-tactical'
  if (targets.some(target => target.kind === 'participant' || target.kind === 'side')) return 'relationship'
  return 'card'
}

/** Server-issued spatial previews can remain compact; missing exact options fail into the full lens. */
export const encounterSpatialPresentationForChoice = (
  choice: EncounterChoiceOffer,
): EncounterSpatialPresentation => {
  if (!SPATIAL_CHOICE_KINDS.has(choice.kind)) {
    return choice.kind === 'participant' || choice.kind === 'side' ? 'relationship' : 'card'
  }
  return choice.options.length > 0 && choice.options.every(option => option.preview.kind === 'spatial')
    ? 'compact-tactical'
    : 'full-tactical'
}

export type EncounterRelationshipKind = 'self' | 'ally' | 'foe' | 'unaligned'

export interface EncounterRelationshipRow {
  readonly participantId: string
  readonly displayName: string
  readonly relation: EncounterRelationshipKind
  readonly sideLabel: string | null
  readonly distanceMeters: number | null
  readonly adjacent: boolean | null
  readonly lineOfSight: 'server-validation-required' | 'not-required'
  readonly eligibility: 'server-validation-required'
  readonly rangeLabels: readonly string[]
  readonly relationshipLabels: readonly string[]
  readonly zoneLabels: readonly string[]
}

const stepCount = (value: number): number => Math.max(0, Math.floor(Math.abs(value)))
const vectorDistance = (delta: { readonly x: number, readonly y: number, readonly z: number }): number => {
  const axes = [stepCount(delta.x), stepCount(delta.y), stepCount(delta.z)].sort((left, right) => right - left)
  return (axes[0] ?? 0) + Math.floor((axes[1] ?? 0) / 2)
}
const axisSeparation = (leftStart: number, leftSize: number, rightStart: number, rightSize: number): number => {
  if (leftStart <= rightStart) {
    const gap = rightStart - (leftStart + leftSize)
    return gap >= 0 ? gap + 1 : 0
  }
  const gap = leftStart - (rightStart + rightSize)
  return gap >= 0 ? gap + 1 : 0
}

export const encounterProjectedDistance = (
  left: EncounterWorkspaceParticipant,
  right: EncounterWorkspaceParticipant,
): number | null => {
  if (!left.position || !left.footprint || !right.position || !right.footprint) return null
  return vectorDistance({
    x: axisSeparation(left.position.x, left.footprint.base, right.position.x, right.footprint.base),
    y: axisSeparation(left.position.y, left.footprint.clearance, right.position.y, right.footprint.clearance),
    z: axisSeparation(left.position.z, left.footprint.base, right.position.z, right.footprint.base),
  })
}

const relationFor = (
  actor: EncounterWorkspaceParticipant,
  participant: EncounterWorkspaceParticipant,
): EncounterRelationshipKind => {
  if (actor.participantId === participant.participantId) return 'self'
  if (!actor.side || !participant.side) return 'unaligned'
  return actor.side.id === participant.side.id ? 'ally' : 'foe'
}

const uniqueLabels = (values: readonly (string | null | undefined)[]): string[] => [
  ...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))),
]

const relevantZoneLabels = (
  environment: readonly EncounterWorkspaceEnvironmentEntry[],
): string[] => uniqueLabels(environment.map(entry => (
  entry.kind === 'weather' || entry.kind === 'terrain' || entry.kind === 'room'
    ? entry.label
    : null
)))

/**
 * Build presentation-only relationship rows from an already role-projected
 * workspace. Candidate eligibility and LOS remain explicitly server-owned.
 */
export const encounterRelationshipRows = (input: {
  readonly actor: EncounterWorkspaceParticipant
  readonly participants: readonly EncounterWorkspaceParticipant[]
  readonly targeting: readonly EncounterTargetingSummary[]
  readonly environment: readonly EncounterWorkspaceEnvironmentEntry[]
}): EncounterRelationshipRow[] => {
  const rangeLabels = uniqueLabels(input.targeting.map(target => target.rangeLabel))
  const relationshipLabels = uniqueLabels(input.targeting.map(target => target.relationshipLabel))
  const requiresLineOfSight = input.targeting.some(target => target.requiresLineOfSight)
  const zoneLabels = relevantZoneLabels(input.environment)
  return input.participants.map((participant): EncounterRelationshipRow => {
    const distanceMeters = encounterProjectedDistance(input.actor, participant)
    return {
      participantId: participant.participantId,
      displayName: participant.displayName,
      relation: relationFor(input.actor, participant),
      sideLabel: participant.side?.label ?? null,
      distanceMeters,
      adjacent: distanceMeters === null ? null : distanceMeters <= 1,
      lineOfSight: requiresLineOfSight ? 'server-validation-required' : 'not-required',
      eligibility: 'server-validation-required',
      rangeLabels,
      relationshipLabels,
      zoneLabels,
    }
  }).sort((left, right) => (
    (left.relation === 'self' ? 0 : 1) - (right.relation === 'self' ? 0 : 1)
    || (left.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (right.distanceMeters ?? Number.MAX_SAFE_INTEGER)
    || left.displayName.localeCompare(right.displayName)
    || left.participantId.localeCompare(right.participantId)
  ))
}

export interface EncounterCompactSpatialPreview {
  readonly optionId: string
  readonly label: string
  readonly cells: readonly { readonly x: number, readonly y: number, readonly z: number }[]
  readonly destination: { readonly x: number, readonly y: number, readonly z: number } | null
  readonly path: readonly { readonly x: number, readonly y: number, readonly z: number }[]
  readonly direction: string | null
}

/** Extract only explicit server-issued spatial previews; option IDs are never parsed as coordinates. */
export const encounterCompactSpatialPreviews = (
  choice: EncounterChoiceOffer,
): EncounterCompactSpatialPreview[] => choice.options
  .slice(0, ENCOUNTER_TACTICAL_LENS_BUDGETS.compactPreviewOptions)
  .flatMap(option => option.preview.kind === 'spatial'
  ? [{
      optionId: option.optionId,
      label: option.label,
      cells: option.preview.cells.map(cell => ({ ...cell })),
      destination: option.preview.destination ? { ...option.preview.destination } : null,
      path: option.preview.path.map(cell => ({ ...cell })),
      direction: option.preview.direction,
    }]
  : [])
