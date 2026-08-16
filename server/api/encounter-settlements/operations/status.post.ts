import { defineEventHandler } from 'h3'
import { getEncounterSettlementOperationStatus } from '../../../useCases/getEncounterSettlementOperationStatus'
import { requireAuthRole } from '../../../utils/auth'
import { badRequest, expectRecord, readObjectBody } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  const body = await readObjectBody<Record<string, unknown>>(event)
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'command')) {
    badRequest('Settlement recovery accepts exactly one command field.')
  }
  const command = expectRecord(body.command, 'command')
  try {
    return getEncounterSettlementOperationStatus({
      role,
      principalKey: 'role:gm',
      command,
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
