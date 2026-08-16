import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../../utils/http'
import { throwUseCaseHttpError } from '../../../../utils/useCaseHttp'
import {
  executeLivePlayEncounterLifecycleCommandUseCase,
  type LivePlayEncounterLifecycleCommandResponse,
} from '../../../../useCases/applyLivePlayEncounterLifecycleCommand'

type Body = Record<string, unknown>
const responsePayload = (response: LivePlayEncounterLifecycleCommandResponse) => response.result.ok
  ? {
      ...response.result,
      ...(response.path === undefined ? {} : { path: response.path }),
      ...(response.map === undefined ? {} : { map: response.map }),
      ...(response.sheetUpdates === undefined ? {} : { sheetUpdates: response.sheetUpdates }),
    }
  : response.result

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Body>(event)
  try {
    return responsePayload(await executeLivePlayEncounterLifecycleCommandUseCase({
      role,
      command: body,
      clientId: normalizeRealtimeClientId(body.clientId),
      expectedType: LIVE_PLAY_COMMAND_TYPES.DISMISS_ENCOUNTER_EFFECT,
    }))
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
