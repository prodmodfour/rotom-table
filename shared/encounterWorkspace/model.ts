import type {
  AcceptedEncounterPresentation,
  EncounterActionOffer,
  EncounterContextualAffordance,
  EncounterPassiveSummary,
  EncounterPendingInteractionView,
  EncounterProjectionDiagnostic,
} from '../encounterPresentation/contracts'
import type { EncounterProjectionAudience } from '../encounterPresentation/catalog'
import type { EncounterResourceSummary, EncounterSideAccent } from './primitives'
import type {
  EncounterDocumentObjective,
  EncounterDocumentClock,
  EncounterDocumentPhase,
  EncounterDocumentCastRole,
  EncounterDocumentReserve,
  EncounterDocumentWave,
  EncounterRecipeId,
} from '../encounterDocuments/model'

export const ENCOUNTER_WORKSPACE_SCHEMA_VERSION = 1 as const

export const ENCOUNTER_WORKSPACE_AUDIENCES = [
  'gm',
  'player-owner',
  'public',
  'diagnostic',
] as const
export type EncounterWorkspaceAudience = typeof ENCOUNTER_WORKSPACE_AUDIENCES[number]

export const ENCOUNTER_WORKSPACE_CONNECTION_STATES = [
  'ready',
  'saving',
  'reconnecting',
  'reconciling',
  'stale',
  'error',
] as const
export type EncounterWorkspaceConnectionState = typeof ENCOUNTER_WORKSPACE_CONNECTION_STATES[number]

export const ENCOUNTER_WORKSPACE_LIMITS = Object.freeze({
  participants: 512,
  sides: 32,
  teams: 64,
  reserves: 512,
  initiativeEntries: 512,
  environmentEntries: 512,
  objectives: 64,
  offers: 2_048,
  pending: 256,
  accepted: 512,
  activeEffects: 256,
  resourcesPerParticipant: 32,
  conditionsPerParticipant: 64,
  labelChars: 200,
})

export interface EncounterWorkspaceSource {
  readonly workspaceId: string
  readonly encounterId: string
  /** Public encounter display identity; falls back to the reusable battlefield name for compatibility rows. */
  readonly encounterName?: string
  readonly encounterRevision: number | null
  readonly mapSlug: string
  readonly mapRevision: number
  readonly presentationProjectionId: string
  readonly presentationAudience: EncounterProjectionAudience
  readonly generatedAt: number
}

export interface EncounterWorkspaceViewer {
  readonly audience: EncounterWorkspaceAudience
  readonly controlledParticipantIds: readonly string[]
  readonly canUseDirector: boolean
  readonly canInspectDiagnostics: boolean
  readonly canUseExactGeometry: boolean
}

export interface EncounterWorkspacePosition {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface EncounterWorkspaceParticipant {
  readonly participantId: string
  readonly kind: 'pokemon' | 'trainer' | 'entity' | 'group'
  readonly sheetSlug: string | null
  readonly displayName: string
  readonly roleLabel: string
  readonly portraitUrl: string | null
  readonly side: EncounterSideAccent | null
  readonly onMap: boolean
  readonly reserve: boolean
  readonly hidden: boolean
  readonly currentTurn: boolean
  readonly controlled: boolean
  readonly initiative: number | null
  readonly position: EncounterWorkspacePosition | null
  /** Exact projected token dimensions; null whenever exact geometry is unavailable. */
  readonly footprint: { readonly base: number, readonly clearance: number } | null
  readonly hp: {
    readonly current: number
    readonly maximum: number
    readonly temporary: number
  } | null
  readonly injuries: number
  readonly conditions: readonly string[]
  readonly resources: readonly EncounterResourceSummary[]
  readonly fainted: boolean
}

export interface EncounterWorkspaceSide {
  readonly sideId: string
  readonly label: string
  readonly accent: string | null
  readonly symbol: string
  readonly status: 'active' | 'inactive'
  readonly participantIds: readonly string[]
  /** Available only in GM/diagnostic projection; never implies hidden identity. */
  readonly hiddenParticipantCount: number | null
}

export interface EncounterWorkspaceReserveMember {
  readonly reserveId: string
  readonly ownerParticipantId: string
  readonly sheetSlug: string
  readonly displayName: string
  readonly portraitUrl: string | null
  readonly location: 'party' | 'boxed'
}

export interface EncounterWorkspaceTeam {
  readonly trainerParticipantId: string
  readonly sideId: string | null
  readonly activeParticipantIds: readonly string[]
  readonly reserves: readonly EncounterWorkspaceReserveMember[]
}

export interface EncounterWorkspaceTurnEntry {
  readonly participantId: string
  readonly initiative: number | null
  readonly state: 'past' | 'current' | 'upcoming' | 'fainted'
  readonly waitingDecisionCount: number
}

export interface EncounterWorkspaceTurn {
  readonly round: number
  readonly currentParticipantId: string | null
  readonly entries: readonly EncounterWorkspaceTurnEntry[]
}

export interface EncounterWorkspaceScene {
  readonly active: boolean
  readonly name: string | null
  readonly startedAt: number | null
}

export interface EncounterWorkspaceEnvironmentEntry {
  readonly environmentId: string
  readonly kind: 'weather' | 'terrain' | 'room' | 'hazard' | 'zone'
  readonly label: string
  readonly rounds: number | null
  readonly scopeLabel: string | null
}

export interface EncounterWorkspaceObjective {
  readonly objectiveId: string
  readonly label: string
  readonly status: 'active' | 'completed' | 'failed'
  readonly progress: number | null
  readonly maximum: number | null
}

export interface EncounterWorkspaceClock {
  readonly clockId: string
  readonly label: string
  readonly status: 'active' | 'paused' | 'completed'
  readonly progress: number
  readonly maximum: number
}

export interface EncounterWorkspacePhase {
  readonly phaseId: string
  readonly label: string
  readonly status: 'upcoming' | 'active' | 'completed'
  readonly summary: string | null
}

/** GM-only display projection of one authoritative durable encounter effect. */
export interface EncounterWorkspaceActiveEffect {
  /** Opaque server-authored row identity. It is never displayed or derived by clients. */
  readonly effectRef: string
  readonly label: string
  readonly sourceLabel: string
  readonly affectedLabel: string
  readonly durationKind: 'turns' | 'rounds' | 'scene' | 'encounter' | 'campaign-time' | 'explicit-dismissal' | 'until-triggered' | 'permanent'
  /** Complete server-authored duration copy. Clients do not calculate expiry. */
  readonly durationLabel: string
  /** Server-owned dismissal authority; null for every non-dismissible duration. */
  readonly dismissalRef: string | null
  readonly dismissible: boolean
}

/** Full story/cast authoring projection. This object is structurally absent outside GM/diagnostic views. */
export interface EncounterWorkspaceDirectorState {
  readonly encounterRevision: number
  readonly name: string
  readonly lifecycle: 'draft' | 'active' | 'paused' | 'completed' | 'archived'
  readonly recipe: EncounterRecipeId
  readonly hiddenParticipantIds: readonly string[]
  readonly castRoles: readonly EncounterDocumentCastRole[]
  readonly reserves: readonly EncounterDocumentReserve[]
  readonly waves: readonly EncounterDocumentWave[]
  readonly objectives: readonly EncounterDocumentObjective[]
  readonly clocks: readonly EncounterDocumentClock[]
  readonly phases: readonly EncounterDocumentPhase[]
  readonly activePhaseId: string | null
  readonly stakes: { readonly public: string | null, readonly gm: string | null }
  readonly notes: string | null
}

export interface EncounterWorkspaceSystem {
  readonly connection: EncounterWorkspaceConnectionState
  readonly replayGap: boolean
  readonly commandsBlocked: boolean
  readonly blockingMessage: string | null
  readonly lastAdoptedRevision: number
}

/**
 * One immutable, role-projected read model for the Battle Cockpit. Mechanics,
 * authorization, and durable state remain in the map/sheet/presentation owners.
 */
export interface EncounterWorkspaceViewModel {
  readonly schemaVersion: typeof ENCOUNTER_WORKSPACE_SCHEMA_VERSION
  readonly source: EncounterWorkspaceSource
  readonly viewer: EncounterWorkspaceViewer
  readonly scene: EncounterWorkspaceScene
  readonly turn: EncounterWorkspaceTurn
  readonly sides: readonly EncounterWorkspaceSide[]
  readonly participants: readonly EncounterWorkspaceParticipant[]
  readonly teams: readonly EncounterWorkspaceTeam[]
  readonly environment: readonly EncounterWorkspaceEnvironmentEntry[]
  readonly objectives: readonly EncounterWorkspaceObjective[]
  readonly clocks: readonly EncounterWorkspaceClock[]
  readonly phase: EncounterWorkspacePhase | null
  readonly stakes: string | null
  readonly director: EncounterWorkspaceDirectorState | null
  /** Structurally absent outside GM/diagnostic projections. */
  readonly activeEffects?: readonly EncounterWorkspaceActiveEffect[]
  readonly offers: readonly EncounterActionOffer[]
  readonly passives: readonly EncounterPassiveSummary[]
  readonly affordances: readonly EncounterContextualAffordance[]
  readonly pending: readonly EncounterPendingInteractionView[]
  readonly accepted: readonly AcceptedEncounterPresentation[]
  readonly diagnostics: readonly EncounterProjectionDiagnostic[]
  readonly system: EncounterWorkspaceSystem
  /** Explicit discoveries that still belong to the later encounter-document ADR. */
  readonly mapBackedLimitations: readonly ('objectives' | 'phases' | 'stakes' | 'notes' | 'waves')[]
}

export class EncounterWorkspaceValidationError extends Error {
  readonly code: 'invalid-workspace' | 'privacy-violation' | 'revision-mismatch' | 'limit-exceeded'

  constructor(
    code: EncounterWorkspaceValidationError['code'],
    message: string,
  ) {
    super(message)
    this.name = 'EncounterWorkspaceValidationError'
    this.code = code
  }
}

const fail = (
  code: EncounterWorkspaceValidationError['code'],
  message: string,
): never => {
  throw new EncounterWorkspaceValidationError(code, message)
}

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length
const bounded = (value: string, label: string): void => {
  if (!value.trim() || value.length > ENCOUNTER_WORKSPACE_LIMITS.labelChars || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('invalid-workspace', `${label} must be bounded non-empty display text.`)
  }
}

/** Validate cross-container and privacy invariants after every server projection. */
export const assertEncounterWorkspaceViewModel = (
  workspace: EncounterWorkspaceViewModel,
): EncounterWorkspaceViewModel => {
  if (workspace.schemaVersion !== ENCOUNTER_WORKSPACE_SCHEMA_VERSION) {
    fail('invalid-workspace', `Unsupported workspace schema ${workspace.schemaVersion}.`)
  }
  if (workspace.source.encounterName !== undefined) bounded(workspace.source.encounterName, 'Encounter name')
  if (!Number.isSafeInteger(workspace.source.mapRevision) || workspace.source.mapRevision < 0) {
    fail('invalid-workspace', 'Workspace map revision must be a non-negative safe integer.')
  }
  if (workspace.source.encounterRevision !== null
    && (!Number.isSafeInteger(workspace.source.encounterRevision) || workspace.source.encounterRevision < 0)) {
    fail('invalid-workspace', 'Workspace encounter revision must be null or a non-negative safe integer.')
  }
  if ((workspace.source.encounterRevision === null) !== (workspace.director === null && workspace.mapBackedLimitations.length > 0)) {
    fail('invalid-workspace', 'Workspace encounter authority and map-backed limitations disagree.')
  }
  if (workspace.source.mapRevision !== workspace.system.lastAdoptedRevision) {
    fail('revision-mismatch', 'Workspace system revision must match its source map revision.')
  }
  if (workspace.participants.length > ENCOUNTER_WORKSPACE_LIMITS.participants
    || workspace.sides.length > ENCOUNTER_WORKSPACE_LIMITS.sides
    || workspace.teams.length > ENCOUNTER_WORKSPACE_LIMITS.teams
    || workspace.teams.reduce((total, team) => total + team.reserves.length, 0) > ENCOUNTER_WORKSPACE_LIMITS.reserves
    || workspace.turn.entries.length > ENCOUNTER_WORKSPACE_LIMITS.initiativeEntries
    || workspace.environment.length > ENCOUNTER_WORKSPACE_LIMITS.environmentEntries
    || workspace.objectives.length > ENCOUNTER_WORKSPACE_LIMITS.objectives
    || workspace.offers.length > ENCOUNTER_WORKSPACE_LIMITS.offers
    || workspace.pending.length > ENCOUNTER_WORKSPACE_LIMITS.pending
    || workspace.accepted.length > ENCOUNTER_WORKSPACE_LIMITS.accepted
    || (workspace.activeEffects?.length ?? 0) > ENCOUNTER_WORKSPACE_LIMITS.activeEffects) {
    fail('limit-exceeded', 'Workspace exceeds a bounded collection limit.')
  }

  const participantIds = workspace.participants.map(participant => participant.participantId)
  const participantSet = new Set(participantIds)
  const sideIds = workspace.sides.map(side => side.sideId)
  if (!unique(participantIds) || !unique(sideIds)) fail('invalid-workspace', 'Workspace identities must be unique.')
  if (!unique(workspace.viewer.controlledParticipantIds)) fail('invalid-workspace', 'Controlled participant identities must be unique.')
  if (!workspace.viewer.controlledParticipantIds.every(id => participantSet.has(id))) {
    fail('privacy-violation', 'A controlled participant is absent from the projected participant set.')
  }

  for (const participant of workspace.participants) {
    bounded(participant.displayName, `Participant ${participant.participantId}`)
    if (participant.conditions.length > ENCOUNTER_WORKSPACE_LIMITS.conditionsPerParticipant
      || participant.resources.length > ENCOUNTER_WORKSPACE_LIMITS.resourcesPerParticipant) {
      fail('limit-exceeded', `Participant ${participant.participantId} exceeds status/resource limits.`)
    }
    if (participant.controlled !== workspace.viewer.controlledParticipantIds.includes(participant.participantId)) {
      fail('privacy-violation', `Participant ${participant.participantId} control flag disagrees with viewer projection.`)
    }
    if (!workspace.viewer.canUseDirector && participant.hidden) {
      fail('privacy-violation', `Participant ${participant.participantId} exposes hidden status outside Director projection.`)
    }
    if (!workspace.viewer.canUseExactGeometry && (participant.position !== null || participant.footprint !== null)) {
      fail('privacy-violation', `Participant ${participant.participantId} exposes exact geometry to this projection.`)
    }
    if ((participant.position === null) !== (participant.footprint === null)) {
      fail('invalid-workspace', `Participant ${participant.participantId} has incomplete exact geometry.`)
    }
    if (participant.footprint && (!Number.isSafeInteger(participant.footprint.base)
      || !Number.isSafeInteger(participant.footprint.clearance)
      || participant.footprint.base < 1 || participant.footprint.clearance < 1)) {
      fail('invalid-workspace', `Participant ${participant.participantId} has invalid exact dimensions.`)
    }
  }
  for (const team of workspace.teams) {
    const owner = workspace.participants.find(participant => participant.participantId === team.trainerParticipantId)
      ?? fail('invalid-workspace', 'Encounter team owner must be a projected Trainer participant.')
    if (owner.kind !== 'trainer') fail('invalid-workspace', 'Encounter team owner must be a projected Trainer participant.')
    if (!unique(team.activeParticipantIds) || !team.activeParticipantIds.every(id => participantSet.has(id))) {
      fail('invalid-workspace', `Encounter team ${team.trainerParticipantId} has invalid active participants.`)
    }
    const reserveIds = team.reserves.map(reserve => reserve.reserveId)
    if (!unique(reserveIds) || team.reserves.some(reserve => reserve.ownerParticipantId !== team.trainerParticipantId)) {
      fail('invalid-workspace', `Encounter team ${team.trainerParticipantId} has invalid reserve identities.`)
    }
    for (const reserve of team.reserves) bounded(reserve.displayName, `Reserve ${reserve.reserveId}`)
    if (workspace.viewer.audience === 'player-owner' && !owner.controlled) {
      fail('privacy-violation', 'Player workspace cannot expose another Trainer team.')
    }
    if (workspace.viewer.audience === 'public') fail('privacy-violation', 'Public workspace cannot expose Trainer team reserves.')
  }
  for (const side of workspace.sides) {
    bounded(side.label, `Side ${side.sideId}`)
    if (!unique(side.participantIds) || !side.participantIds.every(id => participantSet.has(id))) {
      fail('invalid-workspace', `Side ${side.sideId} references invalid participants.`)
    }
    if (!workspace.viewer.canUseDirector && side.hiddenParticipantCount !== null) {
      fail('privacy-violation', `Side ${side.sideId} exposes hidden counts outside Director projection.`)
    }
  }
  if (!workspace.turn.entries.every(entry => participantSet.has(entry.participantId))) {
    fail('invalid-workspace', 'Turn rail references a participant outside the projection.')
  }
  if (workspace.turn.currentParticipantId !== null && !participantSet.has(workspace.turn.currentParticipantId)) {
    fail('invalid-workspace', 'Current actor is outside the participant projection.')
  }

  if (workspace.viewer.audience === 'public') {
    if (workspace.viewer.controlledParticipantIds.length > 0 || workspace.offers.length > 0) {
      fail('privacy-violation', 'Public workspace cannot expose controls or action offers.')
    }
    if (workspace.pending.some(pending => pending.projection !== 'public')) {
      fail('privacy-violation', 'Public workspace cannot expose authorized pending choices.')
    }
  }
  if (workspace.viewer.audience === 'player-owner'
    && workspace.offers.some(offer => !workspace.viewer.controlledParticipantIds.includes(offer.actor.participantId))) {
    fail('privacy-violation', 'Player workspace offer actor is not controlled by the viewer.')
  }
  if (!workspace.viewer.canUseDirector && workspace.director !== null) {
    fail('privacy-violation', 'Director state is present outside a Director workspace.')
  }
  if (workspace.director) {
    if (workspace.source.encounterRevision !== workspace.director.encounterRevision) {
      fail('revision-mismatch', 'Director revision must match encounter source revision.')
    }
    const hidden = new Set(workspace.director.hiddenParticipantIds)
    if (workspace.participants.some(participant => participant.hidden !== hidden.has(participant.participantId))) {
      fail('privacy-violation', 'Director hidden participant projection is inconsistent.')
    }
  }
  if (!workspace.viewer.canUseDirector && workspace.activeEffects !== undefined) {
    fail('privacy-violation', 'Active-effect authority is present outside a Director workspace.')
  }
  if (workspace.activeEffects) {
    const effectRefs = workspace.activeEffects.map(effect => effect.effectRef)
    if (!unique(effectRefs)) fail('invalid-workspace', 'Director active-effect references must be unique.')
    for (const effect of workspace.activeEffects) {
      if (!effect.effectRef.trim() || effect.effectRef.length > 160 || effect.effectRef.trim() !== effect.effectRef
        || /[\u0000-\u001f\u007f]/.test(effect.effectRef)) {
        fail('invalid-workspace', 'Director active-effect reference must be bounded opaque text.')
      }
      bounded(effect.label, `Effect ${effect.effectRef} label`)
      bounded(effect.sourceLabel, `Effect ${effect.effectRef} source label`)
      bounded(effect.affectedLabel, `Effect ${effect.effectRef} affected label`)
      bounded(effect.durationLabel, `Effect ${effect.effectRef} duration label`)
      if (effect.dismissible !== (effect.durationKind === 'explicit-dismissal')
        || effect.dismissible !== (effect.dismissalRef !== null)) {
        fail('invalid-workspace', `Effect ${effect.effectRef} dismissal authority disagrees with its duration.`)
      }
      if (effect.dismissalRef !== null && effect.dismissalRef !== effect.effectRef) {
        fail('invalid-workspace', `Effect ${effect.effectRef} has inconsistent opaque command authority.`)
      }
    }
  }
  if (!workspace.viewer.canInspectDiagnostics && workspace.diagnostics.length > 0) {
    fail('privacy-violation', 'Diagnostics are present outside a diagnostic workspace.')
  }
  if (workspace.system.commandsBlocked !== (workspace.system.connection !== 'ready' || workspace.system.replayGap)) {
    fail('invalid-workspace', 'Command blocking must follow connection and replay-gap state.')
  }
  return workspace
}
