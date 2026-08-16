import { defineEventHandler } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { manageItemExtendedActionUseCase } from '../../useCases/manageItemExtendedAction'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import {
  projectSheetEquipmentContributions,
  redactSheetRecordForPlayer,
} from '../../utils/sheetPrivacy'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  const allowedFields = new Set(['command', 'profileId', 'clientId'])
  if (Object.keys(body).some(key => !allowedFields.has(key)) || !Object.hasOwn(body, 'command')) {
    badRequest('Item Extended Action request must contain only command, profileId, and clientId.')
  }
  if (body.profileId !== undefined && typeof body.profileId !== 'string') badRequest('profileId must be a string when provided.')
  if (body.clientId !== undefined && typeof body.clientId !== 'string') badRequest('clientId must be a string when provided.')
  try {
    const response = manageItemExtendedActionUseCase({
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
    }
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
