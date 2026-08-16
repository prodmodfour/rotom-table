import type { AuthRole } from '#shared/auth'
import {
  EncounterSettlementCommitCommandParseError,
  parseEncounterSettlementCommitCommand,
  type EncounterSettlementCommitCommand,
} from '#shared/encounterSettlement/atomicCommit'
import type { FinishEncounterView } from '#shared/encounterSettlement/finish'
import type { PlayerProfile } from '#shared/playerProfiles'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteEncounterSettlementRepository } from '../storage/encounterSettlementRepository'
import { CommitEncounterSettlementUseCaseError, commitEncounterSettlement } from './commitEncounterSettlement'
import {
  finishEncounterAcceptedView,
  prepareFinishEncounter,
  PrepareFinishEncounterUseCaseError,
  rebuildPreparedFinishEncounter,
  type PreparedFinishEncounter,
} from './prepareFinishEncounter'

export interface FinishEncounterInput {
  readonly role: AuthRole
  readonly principalKey: string
  readonly command: unknown
}

export interface FinishEncounterDependencies {
  readonly database?: RotomDatabase
  readonly playerProfiles?: readonly PlayerProfile[]
}

const parseCommand = (value: unknown): EncounterSettlementCommitCommand => {
  try { return parseEncounterSettlementCommitCommand(value) }
  catch (error) {
    if (error instanceof EncounterSettlementCommitCommandParseError) {
      throw new CommitEncounterSettlementUseCaseError(400, 'Invalid encounter settlement commit command.')
    }
    throw error
  }
}

export const finishEncounter = (
  input: FinishEncounterInput,
  dependencies: FinishEncounterDependencies = {},
): FinishEncounterView => {
  if (input.role !== 'gm') {
    throw new CommitEncounterSettlementUseCaseError(403, 'Only the GM may commit encounter settlement.')
  }
  const command = parseCommand(input.command)
  const database = dependencies.database ?? getRotomDatabase()
  const repository = createSqliteEncounterSettlementRepository(database)
  const accepted = repository.getOperation(command.operationId)
  let prepared: PreparedFinishEncounter

  if (accepted) {
    if (accepted.principalKey !== input.principalKey
      || accepted.command.settlementId !== command.settlementId
      || accepted.command.expectedSettlementRevision !== command.expectedSettlementRevision
      || accepted.command.planDefinitionSha256 !== command.planDefinitionSha256
      || accepted.command.confirmed !== command.confirmed) {
      throw new CommitEncounterSettlementUseCaseError(409, 'Encounter settlement operation identity is already bound to another command.')
    }
    if (!accepted.plan) {
      throw new PrepareFinishEncounterUseCaseError(409, 'The selected settlement preview is unavailable or stale.')
    }
    const settlement = repository.get(accepted.settlementId)
    if (!settlement) {
      throw new PrepareFinishEncounterUseCaseError(409, 'The accepted settlement is unavailable.')
    }
    prepared = {
      ...prepareFinishEncounter(
        { role: input.role, encounterId: settlement.encounter.encounterId },
        { database, playerProfiles: dependencies.playerProfiles },
      ),
      plan: accepted.plan,
    }
  }
  else {
    prepared = rebuildPreparedFinishEncounter(
      { role: input.role, command },
      { database, playerProfiles: dependencies.playerProfiles },
    )
  }

  const response = commitEncounterSettlement({
    role: input.role,
    principalKey: input.principalKey,
    command,
  }, {
    database,
    repository,
    loadPreparedPlan: () => prepared.plan,
    loadCurrentAuthority: () => {
      const current = rebuildPreparedFinishEncounter(
        { role: input.role, command },
        { database, playerProfiles: dependencies.playerProfiles },
      )
      if (!current.authority) {
        throw new PrepareFinishEncounterUseCaseError(409, 'The selected settlement preview is unavailable or stale.')
      }
      return current.authority
    },
  })

  return finishEncounterAcceptedView({
    preview: prepared.view,
    response: {
      completedAtCampaignMinute: response.completedAtCampaignMinute,
      changedSheetCount: response.changedSheetCount,
      changedGroupCount: response.changedGroupCount,
      historyFactCount: response.historyFactCount,
      attentionSourceCount: response.attentionSourceCount,
      replayed: response.replayed,
    },
  })
}
