import { defineEventHandler } from 'h3'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { executeEquipmentOperation } from '../../useCases/executeEquipmentOperation'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import {
  projectSheetEquipmentContributions,
  redactSheetRecordForPlayer,
} from '../../utils/sheetPrivacy'
import { projectGroupInventoryForPlayer } from '../../utils/groupInventoryPrivacy'

interface EquipmentOperationBody {
  readonly command?: unknown
  readonly profileId?: unknown
  readonly clientId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<EquipmentOperationBody>(event)
  const allowedFields = new Set(['command', 'profileId', 'clientId'])
  if (Object.keys(body).some(key => !allowedFields.has(key)) || !Object.hasOwn(body, 'command')) {
    badRequest('Equipment operation request must contain only command, profileId, and clientId.')
  }
  if (body.profileId !== undefined && typeof body.profileId !== 'string') badRequest('profileId must be a string when provided.')
  if (body.clientId !== undefined && typeof body.clientId !== 'string') badRequest('clientId must be a string when provided.')
  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(body.profileId)
      : null
    const executed = executeEquipmentOperation({
      role,
      playerProfile,
      command: body.command,
      clientId: normalizeRealtimeClientId(body.clientId),
    })
    return {
      result: role === 'player'
        ? { ...executed.result, equippedInstanceId: null }
        : executed.result,
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
