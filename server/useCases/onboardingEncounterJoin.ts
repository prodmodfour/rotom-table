import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import type { TabletopMap } from '~/types/map'
import {
  createSqliteOnboardingRepository,
  onboardingPayloadHash,
  type OnboardingRepository,
} from '../storage/onboardingRepository'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { getMapInteractionModeUseCase } from './getMapInteractionMode'
import { saveMapUseCase } from './saveMap'
import { readPlayerProfile } from '../utils/playerProfileStorage'
import { OnboardingUseCaseError } from './onboardingWorkflows'

/**
 * Active-encounter onboarding handoff (P9-074) and Builder party join
 * (P9-075).
 *
 * A completed, profile-linked package joins an eligible staging encounter map
 * through one explicit GM-controlled operation. Eligibility is re-authorized
 * server-side: completion provenance, sheet existence, profile links, map
 * revision, interaction mode, and side identity. Whole-map placement writes
 * are structurally setup-edit-only in this platform ("live play uses
 * commands"), so an actively running scene is joined with the existing
 * certified live-play token tools instead; this workflow reports that state
 * explicitly rather than bypassing command authority.
 */

export interface OnboardedPartyCandidate {
  readonly completionRecordId: string
  readonly trainerSlug: string
  readonly trainerName: string
  readonly pokemonSlugs: readonly string[]
  readonly profileId: string
  readonly kind: 'guided' | 'intake'
  readonly ready: boolean
  readonly completedAt: number
}

export interface OnboardingEncounterJoinDependencies {
  readonly repository?: OnboardingRepository
  readonly mapRepository?: MapRepository<TabletopMap>
  readonly sheetRepository?: SheetRepository<Record<string, unknown>>
  readonly readProfile?: (profileId: string) => PlayerProfile | null
  readonly interactionMode?: (mapSlug: string) => string
  readonly now?: () => number
}

const repositoryOf = (dependencies: OnboardingEncounterJoinDependencies): OnboardingRepository =>
  dependencies.repository ?? createSqliteOnboardingRepository()

export const listOnboardedPartyCandidates = (
  dependencies: OnboardingEncounterJoinDependencies = {},
): readonly OnboardedPartyCandidate[] => {
  const repository = repositoryOf(dependencies)
  const sheetRepository = dependencies.sheetRepository
    ?? createSqliteSheetRepository<Record<string, unknown>>(repository.database)
  const readProfile = dependencies.readProfile ?? (id => readPlayerProfile(id as never))
  const seenTrainers = new Set<string>()
  const candidates: OnboardedPartyCandidate[] = []
  for (const completion of repository.listCompletions()) {
    const trainerSlug = String(completion.refs.trainerSlug ?? '')
    if (!trainerSlug || seenTrainers.has(trainerSlug)) continue
    seenTrainers.add(trainerSlug)
    const slot = repository.getSlot(completion.slotId)
    if (!slot) continue
    const trainer = sheetRepository.getByRef('trainer', trainerSlug)
    const pokemonSlugs = Array.isArray(completion.refs.pokemonSlugs)
      ? (completion.refs.pokemonSlugs as string[])
      : []
    const profile = readProfile(slot.profileId)
    const linked = profile !== null
      && profile.linkedCharacters.some(ref => ref.sheetKind === 'trainer' && ref.sheetSlug === trainerSlug)
    const pokemonPresent = pokemonSlugs.every(slug => sheetRepository.getByRef('pokemon', slug) !== null)
    candidates.push({
      completionRecordId: completion.completionId,
      trainerSlug,
      trainerName: trainer ? String((trainer.sheet as Record<string, unknown>).name ?? trainerSlug) : trainerSlug,
      pokemonSlugs,
      profileId: slot.profileId,
      kind: completion.refs.kind === 'intake' ? 'intake' : 'guided',
      ready: trainer !== null && pokemonPresent && linked && completion.refs.profileLinksApplied === true,
      completedAt: completion.createdAt,
    })
  }
  return candidates
}

export interface EncounterJoinEligibility {
  readonly mapSlug: string
  readonly interactionMode: string
  readonly eligible: boolean
  readonly reason: string | null
  readonly sides: readonly { readonly id: string, readonly label: string }[]
  readonly mapRevision: number
}

export const onboardingEncounterEligibilityUseCase = (
  input: { readonly role: AuthRole, readonly mapSlug: unknown },
  dependencies: OnboardingEncounterJoinDependencies = {},
): EncounterJoinEligibility => {
  if (input.role !== 'gm') throw new OnboardingUseCaseError(403, 'GM role required')
  const repository = repositoryOf(dependencies)
  const mapRepository = dependencies.mapRepository
    ?? createSqliteMapRepository<TabletopMap>(repository.database)
  const mapSlug = String(input.mapSlug ?? '').trim()
  const map = mapRepository.getBySlug(mapSlug)
  if (!map) throw new OnboardingUseCaseError(404, `Map ${mapSlug} not found`)
  const interactionMode = dependencies.interactionMode?.(mapSlug)
    ?? getMapInteractionModeUseCase({ role: input.role, slug: mapSlug }).interactionMode
  const sides = Object.values((map as unknown as Record<string, any>).encounterState?.sides ?? {})
    .map((side: any) => ({ id: String(side.id), label: String(side.label ?? side.id) }))
  const eligible = interactionMode === MAP_INTERACTION_MODES.SETUP_EDIT && sides.length > 0
  return {
    mapSlug,
    interactionMode,
    eligible,
    reason: eligible
      ? null
      : interactionMode !== MAP_INTERACTION_MODES.SETUP_EDIT
        ? 'The scene is live. Join through the in-play send-out and token tools, or switch the map to setup mode first.'
        : 'Configure encounter sides before adding a party.',
    sides,
    mapRevision: Number(map.revision ?? 0),
  }
}

export interface JoinOnboardedPartyInput {
  readonly role: AuthRole
  readonly trainerSlug: unknown
  readonly mapSlug: unknown
  readonly sideId: unknown
  readonly operationId: string
}

export interface JoinOnboardedPartyResult {
  readonly ok: true
  readonly mapSlug: string
  readonly mapRevision: number
  readonly placementIds: readonly string[]
}

export const joinOnboardedPartyUseCase = (
  input: JoinOnboardedPartyInput,
  dependencies: OnboardingEncounterJoinDependencies = {},
): JoinOnboardedPartyResult => {
  if (input.role !== 'gm') throw new OnboardingUseCaseError(403, 'GM role required')
  const repository = repositoryOf(dependencies)
  const trainerSlug = String(input.trainerSlug ?? '').trim()
  const mapSlug = String(input.mapSlug ?? '').trim()
  const sideId = String(input.sideId ?? '').trim()

  const payloadHash = onboardingPayloadHash({ trainerSlug, mapSlug, sideId })
  const existing = repository.findOperation(input.operationId)
  if (existing) {
    if (existing.payloadHash === payloadHash) return existing.result as unknown as JoinOnboardedPartyResult
    throw new OnboardingUseCaseError(409, `Operation ${input.operationId} was already recorded with different material`)
  }

  const candidate = listOnboardedPartyCandidates(dependencies)
    .find(entry => entry.trainerSlug === trainerSlug)
  if (!candidate) throw new OnboardingUseCaseError(404, `No completed onboarding package exists for trainer ${trainerSlug}`)
  if (!candidate.ready) {
    throw new OnboardingUseCaseError(409, 'The package is not ready: sheets or profile links are missing; repair through intake first')
  }

  const eligibility = onboardingEncounterEligibilityUseCase({ role: input.role, mapSlug }, dependencies)
  if (!eligibility.eligible) throw new OnboardingUseCaseError(409, eligibility.reason ?? 'Encounter is not eligible')
  if (!eligibility.sides.some(side => side.id === sideId)) {
    throw new OnboardingUseCaseError(409, `Side ${sideId} does not exist on ${mapSlug}`)
  }

  const mapRepository = dependencies.mapRepository
    ?? createSqliteMapRepository<TabletopMap>(repository.database)
  const map = mapRepository.getBySlug(mapSlug)! as unknown as Record<string, any>

  const occupied = new Set<string>(
    (map.placements ?? []).map((placement: any) => `${placement.position?.x},${placement.position?.z}`),
  )
  const alreadyPlaced = new Set<string>(
    (map.placements ?? []).map((placement: any) => `${placement.sheetKind}:${placement.sheetSlug}`),
  )
  const dimensions = map.dimensions ?? { x: 8, z: 8 }
  const nextFreeCell = (): { x: number, y: number, z: number } => {
    for (let z = 0; z < Number(dimensions.z ?? 8); z += 1) {
      for (let x = 0; x < Number(dimensions.x ?? 8); x += 1) {
        if (!occupied.has(`${x},${z}`)) {
          occupied.add(`${x},${z}`)
          return { x, y: 0, z }
        }
      }
    }
    throw new OnboardingUseCaseError(409, 'No free cells remain on the battlefield')
  }

  const members: { sheetKind: 'trainer' | 'pokemon', sheetSlug: string }[] = [
    { sheetKind: 'trainer', sheetSlug: trainerSlug },
    ...candidate.pokemonSlugs.map(slug => ({ sheetKind: 'pokemon' as const, sheetSlug: slug })),
  ]
  const placementIds: string[] = []
  const newPlacements = members.flatMap((member) => {
    if (alreadyPlaced.has(`${member.sheetKind}:${member.sheetSlug}`)) return []
    const placementId = `onboarded-${member.sheetKind}-${member.sheetSlug}`
    placementIds.push(placementId)
    return [{
      id: placementId,
      sheetKind: member.sheetKind,
      sheetSlug: member.sheetSlug,
      sideId,
      position: nextFreeCell(),
    }]
  })
  if (newPlacements.length === 0) {
    throw new OnboardingUseCaseError(409, 'Every member of this party is already placed on the battlefield')
  }

  const saved = saveMapUseCase({
    role: 'gm',
    slug: mapSlug,
    expectedRevision: eligibility.mapRevision,
    interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    map: { ...map, placements: [...(map.placements ?? []), ...newPlacements] } as never,
  }, { database: repository.database })

  const result: JoinOnboardedPartyResult = {
    ok: true,
    mapSlug,
    mapRevision: Number((saved.map as unknown as Record<string, unknown>).revision ?? eligibility.mapRevision + 1),
    placementIds,
  }
  repository.recordOperation({
    opId: input.operationId,
    scope: 'commit',
    payloadHash,
    result: result as unknown as Record<string, unknown>,
    now: dependencies.now?.(),
  })
  return result
}
