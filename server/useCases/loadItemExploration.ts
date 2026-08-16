import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import {
  parseItemExplorationEncounterState,
  projectItemExplorationState,
  type ItemExplorationProjectionV1,
} from '#shared/itemAutomation/exploration'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LoadItemExplorationUseCaseError extends UseCaseHttpError<403 | 404 | 409> {}

export interface LoadTrainerItemExplorationInput {
  readonly kind: 'trainer'
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly trainerSlug: string
}

export interface LoadMapItemExplorationInput {
  readonly kind: 'map'
  readonly role: AuthRole
  readonly mapSlug: string
}

export type LoadItemExplorationInput = LoadTrainerItemExplorationInput | LoadMapItemExplorationInput

export interface TrainerItemExplorationAuthorityV1 {
  readonly schemaVersion: 1
  readonly kind: 'trainer'
  readonly trainerSlug: string
  readonly trainerRevision: number
  readonly campaignClockRevision: number
  readonly campaignMinute: number
  readonly generatedAt: number
  readonly projection: ItemExplorationProjectionV1
  readonly permissions: {
    readonly canResolveChecks: boolean
    readonly canCancelOwnLure: boolean
    readonly canSettleEncounter: boolean
    readonly canAdjudicateLureLoss: boolean
  }
}

export interface MapItemExplorationAuthorityV1 {
  readonly schemaVersion: 1
  readonly kind: 'map'
  readonly mapSlug: string
  readonly mapRevision: number
  readonly generatedAt: number
  readonly repelPositioning: readonly {
    readonly decisionId: string
    readonly itemLabel: string
    readonly sourcePlacementId: string
    readonly sourceLabel: string
    readonly sourcePosition: Readonly<{ x: number, y: number, z: number }>
    readonly targetPlacementId: string
    readonly targetLabel: string
    readonly targetPosition: Readonly<{ x: number, y: number, z: number }>
    readonly destinationBounds: Readonly<{
      x: readonly [number, number]
      y: readonly [number, number]
      z: readonly [number, number]
    }>
    readonly maximumAffectedWildLevel: number
    readonly prompt: string
  }[]
}

export type ItemExplorationAuthorityV1 = TrainerItemExplorationAuthorityV1 | MapItemExplorationAuthorityV1

export interface LoadItemExplorationDependencies {
  readonly database?: RotomDatabase
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef'> & { readonly database?: RotomDatabase }
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug'> & { readonly database?: RotomDatabase }
  readonly campaignClockRepository?: CampaignClockRepository
  readonly now?: () => number
}

const fail = (statusCode: 403 | 404 | 409, message: string): never => {
  throw new LoadItemExplorationUseCaseError(statusCode, message)
}

const databaseFrom = (dependencies: LoadItemExplorationDependencies): RotomDatabase => {
  const candidates = [
    dependencies.sheetRepository?.database,
    dependencies.mapRepository?.database,
    dependencies.campaignClockRepository?.database,
  ].filter((entry): entry is RotomDatabase => Boolean(entry))
  const database = dependencies.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) {
    throw new Error('Item exploration projection repositories must share one RotomDatabase.')
  }
  return database
}

const trainerSheet = (stored: NonNullable<ReturnType<NonNullable<LoadItemExplorationDependencies['sheetRepository']>['getByRef']>>): TrainerSheet => ({
  ...(structuredClone(stored.sheet) as unknown as TrainerSheet),
  slug: stored.slug,
  revision: stored.revision,
  updatedAt: stored.updatedAt,
})

const sheetLabel = (
  repository: NonNullable<LoadItemExplorationDependencies['sheetRepository']>,
  placement: TabletopMap['placements'][number],
): string => {
  const stored = repository.getByRef(placement.sheetKind, placement.sheetSlug)
  if (!stored) return placement.sheetSlug
  const sheet = stored.sheet as unknown as CharacterSheet | TrainerSheet
  return placement.sheetKind === 'pokemon'
    ? (sheet as CharacterSheet).nickname || (sheet as CharacterSheet).species || placement.sheetSlug
    : (sheet as TrainerSheet).name || placement.sheetSlug
}

export const loadItemExplorationUseCase = (
  input: LoadItemExplorationInput,
  dependencies: LoadItemExplorationDependencies = {},
): ItemExplorationAuthorityV1 => {
  const database = databaseFrom(dependencies)
  const sheets = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const generatedAt = dependencies.now?.() ?? Date.now()
  if (input.kind === 'trainer') {
    const stored = sheets.getByRef('trainer', input.trainerSlug)
      ?? fail(404, `Trainer sheet ${input.trainerSlug} was not found.`)
    const trainer = trainerSheet(stored)
    if (input.role === 'player' && !playerProfileCanControlTokenSheet(
      input.playerProfile,
      'trainer',
      input.trainerSlug,
      { linkedTrainerSheets: [trainer] },
    )) fail(403, 'The selected player profile does not control this Trainer exploration state.')
    const clockRepository = dependencies.campaignClockRepository ?? createSqliteCampaignClockRepository(database)
    const clock = clockRepository.get()
    const occultEducationRank = resolveTrainerSkills(trainer)
      .find(skill => skill.key === 'occultEd')?.rankValue ?? 0
    let projection: ItemExplorationProjectionV1
    try {
      projection = projectItemExplorationState({
        state: trainer.serverPrivate?.itemExploration,
        campaignMinute: clock.campaignMinute,
        occultEducationRank,
      })
    }
    catch {
      return fail(409, 'Trainer exploration state is malformed and cannot be projected safely.')
    }
    return Object.freeze({
      schemaVersion: 1,
      kind: 'trainer',
      trainerSlug: trainer.slug,
      trainerRevision: normalizeRevision(trainer.revision),
      campaignClockRevision: clock.revision,
      campaignMinute: clock.campaignMinute,
      generatedAt,
      projection,
      permissions: {
        canResolveChecks: true,
        canCancelOwnLure: true,
        canSettleEncounter: input.role === 'gm',
        canAdjudicateLureLoss: input.role === 'gm',
      },
    })
  }

  if (input.role !== 'gm') fail(403, 'Only a GM may view pending direct Repel positioning.')
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const map = mapRepository.getBySlug(input.mapSlug) ?? fail(404, `Map ${input.mapSlug} was not found.`)
  let decisions
  try {
    decisions = parseItemExplorationEncounterState(map.encounterState?.itemExploration).repelPositioning
  }
  catch {
    return fail(409, 'Map exploration state is malformed and cannot be projected safely.')
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: 'map',
    mapSlug: map.slug,
    mapRevision: normalizeRevision(map.revision),
    generatedAt,
    repelPositioning: Object.freeze(decisions.map(decision => {
      const source = map.placements.find(placement => placement.id === decision.sourcePlacementId)
      const target = map.placements.find(placement => placement.id === decision.targetPlacementId)
      if (!source || !target) return fail(409, 'Pending direct Repel participants are unavailable.')
      return Object.freeze({
        decisionId: decision.decisionId,
        itemLabel: decision.canonicalItemId,
        sourcePlacementId: source.id,
        sourceLabel: sheetLabel(sheets, source),
        sourcePosition: Object.freeze({ ...source.position }),
        targetPlacementId: target.id,
        targetLabel: sheetLabel(sheets, target),
        targetPosition: Object.freeze({ ...target.position }),
        destinationBounds: Object.freeze({
          x: Object.freeze([0, map.dimensions.x - 1] as const),
          y: Object.freeze([0, map.dimensions.y - 1] as const),
          z: Object.freeze([0, map.dimensions.z - 1] as const),
        }),
        maximumAffectedWildLevel: decision.maximumAffectedWildLevel,
        prompt: 'Choose one legal Shift endpoint farther from the source. The server revalidates movement capability, path, terrain, collision, and bounds before acceptance.',
      })
    })),
  })
}
