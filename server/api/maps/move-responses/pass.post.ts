import { MOVE_RESPONSE_COMMAND_TYPES } from '#shared/moveAutomation/responseCommands'
import { createMoveResponseRoute } from '../../../livePlay/moveResponseRoute'

export default createMoveResponseRoute({
  expectedType: MOVE_RESPONSE_COMMAND_TYPES.PASS,
})
