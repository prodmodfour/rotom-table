import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import {
  executeLivePlayTerrainCommandUseCase,
  type LivePlayTerrainCommandResponse,
} from '../../../useCases/applyLivePlayTerrainCommand'

type BuildTerrainVoxelBody = Record<string, unknown>

const bodyField = (body: BuildTerrainVoxelBody, key: string): unknown => body[key]

const routeResponse = (response: LivePlayTerrainCommandResponse) => {
  if (!response.result.ok) return response.result
  return {
    ...response.result,
    ...(response.path === undefined ? {} : { path: response.path }),
    ...(response.map === undefined ? {} : { map: response.map }),
    ...(response.voxels === undefined ? {} : { voxels: response.voxels }),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<BuildTerrainVoxelBody>(event)

  try {
    const response = await executeLivePlayTerrainCommandUseCase({
      role,
      command: body,
      clientId: normalizeRealtimeClientId(bodyField(body, 'clientId')),
      expectedType: LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
    })
    return routeResponse(response)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
