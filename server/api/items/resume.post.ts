import { defineEventHandler } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { resumeItemOperationUseCase } from '../../useCases/resumeItemOperation'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import {
  projectSheetEquipmentContributions,
  redactSheetRecordForPlayer,
} from '../../utils/sheetPrivacy'
import { projectGroupInventoryForPlayer } from '../../utils/groupInventoryPrivacy'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  const allowed = new Set(['command', 'profileId', 'clientId'])
  if (!Object.hasOwn(body, 'command') || Object.keys(body).some(key => !allowed.has(key))) {
    badRequest('Item resume request must contain only command, profileId, and clientId.')
  }
  if (body.profileId !== undefined && typeof body.profileId !== 'string') badRequest('profileId must be a string when provided.')
  if (body.clientId !== undefined && typeof body.clientId !== 'string') badRequest('clientId must be a string when provided.')
  try {
    const response = resumeItemOperationUseCase({
      role,
      playerProfile: role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null,
      command: body.command,
      clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
    })
    return {
      ...response,
      sheets: response.sheets.map(sheet => ({
        ...sheet,
        sheet: role === 'player'
          ? redactSheetRecordForPlayer(sheet.kind, sheet.sheet)
          : projectSheetEquipmentContributions(sheet.kind, sheet.sheet),
      })),
      ...(response.groupInventory ? {
        groupInventory: role === 'player'
          ? projectGroupInventoryForPlayer(response.groupInventory)
          : response.groupInventory,
      } : {}),
    }
  }
  catch (error) { throwUseCaseHttpError(error) }
})
