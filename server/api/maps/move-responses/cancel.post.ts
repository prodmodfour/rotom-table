import { MOVE_RESPONSE_COMMAND_TYPES } from '#shared/moveAutomation/responseCommands'
import { createMoveResponseRoute } from '../../../livePlay/moveResponseRoute'
import { replayMoveResponseCommandUseCase } from '../../../useCases/resumePendingMoveResolution'
import { cancelPendingMoveResolutionUseCase } from '../../../useCases/terminatePendingMoveResolution'

export default createMoveResponseRoute({
  expectedType: MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL,
  gmOnly: true,
  replay: ({ role, command }) => replayMoveResponseCommandUseCase({ role, command }),
  execute: cancelPendingMoveResolutionUseCase,
})
