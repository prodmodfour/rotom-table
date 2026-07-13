import { MOVE_RESPONSE_COMMAND_TYPES } from '#shared/moveAutomation/responseCommands'
import { createMoveResponseRoute } from '../../../livePlay/moveResponseRoute'
import {
  replayMoveResponseCommandUseCase,
  resumePendingMoveResolutionUseCase,
} from '../../../useCases/resumePendingMoveResolution'

export default createMoveResponseRoute({
  expectedType: MOVE_RESPONSE_COMMAND_TYPES.REACT,
  replay: ({ role, command }) => replayMoveResponseCommandUseCase({ role, command }),
  execute: resumePendingMoveResolutionUseCase,
})
