import type { WildGenerationExplorationRefV1 } from '#shared/gmToolkit/generation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { strongestActiveRepel } from '../itemAutomation/exploration'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../itemAutomation/registry'
import { createSqliteCampaignClockRepository } from '../../storage/campaignClockRepository'
import { createSqliteSheetRepository } from '../../storage/sheetRepository'
import type { RotomDatabase } from '../../storage/database'
import { UseCaseHttpError } from '../../utils/useCaseErrors'

export interface ActiveGenerationRouteRepel {
  readonly canonicalItemId: string
  readonly maximumAffectedWildLevel: number
  readonly startedAtCampaignMinute: number
  readonly expiresAtCampaignMinute: number
}

export const activeGenerationRouteRepel = (
  exploration: WildGenerationExplorationRefV1 | null | undefined,
  database: RotomDatabase,
): ActiveGenerationRouteRepel | null => {
  if (!exploration) return null
  const stored = createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', exploration.trainerSlug)
  if (!stored) throw new UseCaseHttpError(404, 'The route Repel Trainer is missing.')
  if (stored.revision !== exploration.trainerRevision) throw new UseCaseHttpError(409, 'The route Repel Trainer changed. Refresh before generation.')
  const clock = createSqliteCampaignClockRepository(database).get()
  if (clock.revision !== exploration.campaignClockRevision) throw new UseCaseHttpError(409, 'The campaign clock changed. Refresh before generation.')
  const trainer = { ...(structuredClone(stored.sheet) as unknown as TrainerSheet), slug: stored.slug, revision: stored.revision, updatedAt: stored.updatedAt }
  let effect
  try { effect = strongestActiveRepel(trainer.serverPrivate?.itemExploration, clock.campaignMinute) }
  catch { throw new UseCaseHttpError(409, 'The route Repel authority is malformed.') }
  if (!effect) throw new UseCaseHttpError(409, 'No active route Repel covers this encounter generation.')
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(effect.canonicalItemId)
  const reviewed = definition?.spec.effects.find(candidate => candidate.operation === 'use-repel')
  if (!definition || definition.definitionSha256 !== effect.canonicalDefinitionSha256
    || !reviewed || reviewed.maximumAffectedWildLevel !== effect.maximumAffectedWildLevel
    || effect.expiresAtCampaignMinute !== effect.startedAtCampaignMinute + reviewed.durationMinutes) {
    throw new UseCaseHttpError(409, 'The reviewed route Repel definition changed. Refresh before generation.')
  }
  return {
    canonicalItemId: effect.canonicalItemId,
    maximumAffectedWildLevel: effect.maximumAffectedWildLevel,
    startedAtCampaignMinute: effect.startedAtCampaignMinute,
    expiresAtCampaignMinute: effect.expiresAtCampaignMinute,
  }
}
