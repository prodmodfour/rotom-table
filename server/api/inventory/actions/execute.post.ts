import { defineEventHandler } from 'h3'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { executeGroupInventoryActionUseCase } from '../../../useCases/executeGroupInventoryAction'
import { executeTrainerInventoryActionUseCase } from '../../../useCases/executeTrainerInventoryAction'
import { requireAuthRole } from '../../../utils/auth'
import { badRequest, expectSlug, readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { projectGroupInventoryForPlayer } from '../../../utils/groupInventoryPrivacy'
import {
  projectSheetEquipmentContributions,
  redactSheetRecordForPlayer,
} from '../../../utils/sheetPrivacy'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

interface InventoryActionBody {
  readonly trainerSlug?: unknown
  readonly groupSlug?: unknown
  readonly declaration?: unknown
  readonly profileId?: unknown
  readonly clientId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<InventoryActionBody>(event)
  const allowed = new Set(['trainerSlug', 'groupSlug', 'declaration', 'profileId', 'clientId'])
  const hasTrainer = Object.hasOwn(body, 'trainerSlug')
  const hasGroup = Object.hasOwn(body, 'groupSlug')
  if (Object.keys(body).some(key => !allowed.has(key))
    || hasTrainer === hasGroup || !Object.hasOwn(body, 'declaration')) {
    badRequest('Inventory action request must contain exactly one trainerSlug or groupSlug plus declaration, profileId, and clientId.')
  }
  if (body.profileId !== undefined && typeof body.profileId !== 'string') badRequest('profileId must be a string when provided.')
  if (body.clientId !== undefined && typeof body.clientId !== 'string') badRequest('clientId must be a string when provided.')
  try {
    const playerProfile = role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null
    const common = {
      role,
      playerProfile,
      declaration: body.declaration,
      clientId: normalizeRealtimeClientId(body.clientId),
    }
    const executed = hasTrainer
      ? executeTrainerInventoryActionUseCase({
          ...common,
          trainerSlug: expectSlug(body.trainerSlug, 'trainerSlug'),
        })
      : executeGroupInventoryActionUseCase({
          ...common,
          groupSlug: expectSlug(body.groupSlug, 'groupSlug'),
        })
    return {
      result: executed.result,
      sheets: executed.sheets.map(sheet => ({
        kind: sheet.kind,
        slug: sheet.slug,
        revision: sheet.revision,
        updatedAt: sheet.updatedAt,
        sheet: role === 'player'
          ? redactSheetRecordForPlayer(sheet.kind, sheet.sheet)
          : projectSheetEquipmentContributions(sheet.kind, sheet.sheet),
      })),
      groupInventories: role === 'player'
        ? executed.groupInventories.map(projectGroupInventoryForPlayer)
        : executed.groupInventories,
    }
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
