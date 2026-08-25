import type { EncounterSettlementCommitCommand, EncounterSettlementCommitResult } from '#shared/encounterSettlement/atomicCommit'
import type { EncounterSettlementAtomicCommitPlan } from '../encounterSettlement/atomicCommit'
import {
  acceptBattleContestSettlementCoordination,
  battleContestSettlementDefinitionSha256,
  createPreparedBattleContestSettlementCoordination,
  parseBattleContestSettlementCoordination,
  type BattleContestSettlementCoordinationV1,
  type BattleContestSettlementSheetWriteV1,
} from '#shared/contests/battleSettlement'
import {
  contestPerformerIsPokemon,
  parseContestDocument,
  type ContestDocumentV1,
  type ContestSettlementV1,
} from '#shared/contests/document'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

export type BattleContestSettlementErrorCode =
  | 'battle-contest.settlement-stage-mismatch'
  | 'battle-contest.settlement-blocked'
  | 'battle-contest.settlement-source-mismatch'
  | 'battle-contest.settlement-orphaned'
  | 'battle-contest.settlement-retry-conflict'

export class BattleContestSettlementError extends Error {
  constructor(readonly code: BattleContestSettlementErrorCode, message: string) {
    super(message)
    this.name = 'BattleContestSettlementError'
  }
}

const fail = (code: BattleContestSettlementErrorCode, message: string): never => {
  throw new BattleContestSettlementError(code, message)
}

export const battleContestRewardDefinitionSha256 = (input: {
  readonly contestId: string
  readonly battleContestLinkId: string
  readonly settlement: ContestSettlementV1
}): string => battleContestSettlementDefinitionSha256({
  contestId: input.contestId,
  battleContestLinkId: input.battleContestLinkId,
  settlementId: input.settlement.settlementId,
  entries: input.settlement.entries,
  money: input.settlement.money,
  items: input.settlement.items,
  attentionItemIds: input.settlement.attentionItemIds,
})

const battleSettlementAuthority = (documentInput: ContestDocumentV1): {
  readonly document: ContestDocumentV1
  readonly settlement: ContestSettlementV1
  readonly binding: NonNullable<NonNullable<ContestDocumentV1['battle']>['encounter']>
} => {
  const document = parseContestDocument(documentInput)
  const settlement = document.settlement
  const binding = document.battle?.encounter
  if (document.variantId !== 'battle' || !['settling', 'completed'].includes(document.stage) || !settlement || !binding) {
    return fail('battle-contest.settlement-stage-mismatch', 'Combined settlement requires one ended, linked Battle Contest with a reward package.')
  }
  return { document, settlement, binding }
}

export const planBattleContestSettlementCoordination = (input: {
  readonly document: ContestDocumentV1
  readonly preparedByContestOperationId: string
  readonly encounterCommand: EncounterSettlementCommitCommand
  readonly encounterPlan: EncounterSettlementAtomicCommitPlan
}): BattleContestSettlementCoordinationV1 => {
  const { document, settlement, binding } = battleSettlementAuthority(input.document)
  if (document.stage !== 'settling' || settlement.status !== 'preview' || settlement.battleCoordination !== null) {
    return fail('battle-contest.settlement-stage-mismatch', 'Battle settlement preparation must begin from one unbound preview.')
  }
  const command = input.encounterCommand, plan = input.encounterPlan
  if (command.operationId !== plan.operationId
    || command.settlementId !== plan.settlementId
    || command.expectedSettlementRevision !== plan.expectedSettlementRevision
    || command.planDefinitionSha256 !== plan.planDefinitionSha256
    || plan.encounterWrite.encounterId !== binding.link.encounterId
    || plan.settlementWrite.nextDocument.encounter.encounterId !== binding.link.encounterId
    || plan.settlementWrite.nextDocument.encounter.linkedMapSlug !== binding.link.linkedMapSlug
    || (plan.mapWrite !== null && plan.mapWrite.mapSlug !== binding.link.linkedMapSlug)) {
    return fail('battle-contest.settlement-source-mismatch', 'Encounter settlement preview does not bind the immutable Battle Contest link and exact atomic plan.')
  }
  return createPreparedBattleContestSettlementCoordination({
    contestId: document.contestId,
    battleContestLinkId: binding.link.linkId,
    encounterId: binding.link.encounterId,
    mapSlug: binding.link.linkedMapSlug,
    encounterSettlementId: command.settlementId,
    encounterSettlementOperationId: command.operationId,
    expectedEncounterSettlementRevision: command.expectedSettlementRevision,
    encounterPlanDefinitionSha256: command.planDefinitionSha256,
    contestRewardDefinitionSha256: battleContestRewardDefinitionSha256({
      contestId: document.contestId,
      battleContestLinkId: binding.link.linkId,
      settlement,
    }),
    preparedByContestOperationId: input.preparedByContestOperationId,
  })
}

export const encounterSettlementCommandForBattleCoordination = (
  coordinationInput: BattleContestSettlementCoordinationV1,
): EncounterSettlementCommitCommand => {
  const coordination = parseBattleContestSettlementCoordination(coordinationInput)
  if (coordination.status !== 'prepared') {
    return fail('battle-contest.settlement-stage-mismatch', 'Only prepared Battle settlement evidence can authorize an Encounter settlement commit.')
  }
  return Object.freeze({
    schemaVersion: 1,
    operationId: coordination.encounterSettlementOperationId,
    settlementId: coordination.encounterSettlementId,
    expectedSettlementRevision: coordination.expectedEncounterSettlementRevision,
    planDefinitionSha256: coordination.encounterPlanDefinitionSha256,
    confirmed: true,
  })
}

export const assertBattleContestRewardsUnapplied = (input: {
  readonly document: ContestDocumentV1
  readonly readSheet: (kind: 'trainer' | 'pokemon', slug: string) => TrainerSheet | CharacterSheet | null
}): void => {
  const { document, settlement } = battleSettlementAuthority(input.document)
  if (document.stage !== 'settling' || settlement.status !== 'preview') return fail('battle-contest.settlement-stage-mismatch', 'Battle rewards can be checked only from a settlement preview.')
  for (const entry of settlement.entries) {
    const trainer = input.readSheet('trainer', entry.trainerSheetSlug) as TrainerSheet | null
    if (!trainer) return fail('battle-contest.settlement-source-mismatch', `Trainer sheet ${entry.trainerSheetSlug} is unavailable before combined settlement.`)
    const resultId = `${document.contestId}:result:${entry.contestantId}`
    if ((trainer.contestResults ?? []).some(result => result.resultId === resultId)) {
      return fail('battle-contest.settlement-orphaned', 'A Battle Contest result already exists without the accepted combined settlement receipt.')
    }
    const contestant = document.contestants.find(row => row.contestantId === entry.contestantId)!
    for (const performer of contestant.performers.filter(contestPerformerIsPokemon)) {
      const pokemon = input.readSheet('pokemon', performer.pokemonSheetSlug) as CharacterSheet | null
      if (!pokemon) return fail('battle-contest.settlement-source-mismatch', `Pokémon sheet ${performer.pokemonSheetSlug} is unavailable before combined settlement.`)
      const ribbonId = `${document.contestId}:ribbon:${performer.pokemonSheetSlug}`
      if ((pokemon.contestRibbons ?? []).some(ribbon => ribbon.ribbonId === ribbonId)) {
        return fail('battle-contest.settlement-orphaned', 'A Battle Contest Ribbon already exists without the accepted combined settlement receipt.')
      }
    }
  }
}

export const completeBattleContestSettlementCoordination = (input: {
  readonly document: ContestDocumentV1
  readonly acceptedByContestOperationId: string
  readonly encounterPlan: EncounterSettlementAtomicCommitPlan
  readonly encounterResult: EncounterSettlementCommitResult
  readonly contestSheetWrites: readonly BattleContestSettlementSheetWriteV1[]
}): BattleContestSettlementCoordinationV1 => {
  const { document, settlement, binding } = battleSettlementAuthority(input.document)
  const prepared = settlement.battleCoordination
    ? parseBattleContestSettlementCoordination(settlement.battleCoordination)
    : fail('battle-contest.settlement-source-mismatch', 'Battle settlement has no exact prepared Encounter coordination evidence.')
  const result = input.encounterResult
  if (prepared.status !== 'prepared'
    || prepared.contestId !== document.contestId
    || prepared.battleContestLinkId !== binding.link.linkId
    || prepared.encounterId !== result.encounterId
    || prepared.mapSlug !== result.mapSlug
    || prepared.encounterSettlementId !== result.settlementId
    || prepared.encounterSettlementOperationId !== result.operationId
    || prepared.encounterPlanDefinitionSha256 !== input.encounterPlan.planDefinitionSha256
    || prepared.contestRewardDefinitionSha256 !== battleContestRewardDefinitionSha256({
      contestId: document.contestId,
      battleContestLinkId: binding.link.linkId,
      settlement,
    })) {
    return fail('battle-contest.settlement-source-mismatch', 'Accepted Encounter settlement result does not match the exact prepared combined boundary.')
  }
  return acceptBattleContestSettlementCoordination({
    prepared,
    acceptedByContestOperationId: input.acceptedByContestOperationId,
    encounterResultDefinitionSha256: battleContestSettlementDefinitionSha256(result),
    encounterSettlementRevision: result.settlementRevision,
    encounterDocumentRevision: result.encounterRevision,
    encounterMapRevision: result.mapRevision,
    contestSheetWrites: input.contestSheetWrites,
  })
}

export const assertBattleContestSettlementExactRetry = (input: {
  readonly document: ContestDocumentV1
  readonly contestOperationId: string
  readonly encounterOperation: {
    readonly operationId: string
    readonly settlementId: string
    readonly planDefinitionSha256: string
    readonly result: EncounterSettlementCommitResult
  } | null
}): void => {
  if (input.document.variantId !== 'battle') return
  const settlement = input.document.settlement
  const coordination = settlement?.battleCoordination
  if (input.document.stage !== 'completed' || settlement?.status !== 'committed' || !coordination) {
    return fail('battle-contest.settlement-orphaned', 'Accepted Battle settlement retry has no terminal combined receipt.')
  }
  const receipt = parseBattleContestSettlementCoordination(coordination)
  const operation = input.encounterOperation
  if (receipt.status !== 'accepted'
    || settlement.committedOperationId !== input.contestOperationId
    || receipt.acceptedByContestOperationId !== input.contestOperationId
    || !operation
    || operation.operationId !== receipt.encounterSettlementOperationId
    || operation.settlementId !== receipt.encounterSettlementId
    || operation.planDefinitionSha256 !== receipt.encounterPlanDefinitionSha256
    || battleContestSettlementDefinitionSha256(operation.result) !== receipt.encounterResultDefinitionSha256
    || operation.result.settlementRevision !== receipt.encounterSettlementRevision
    || operation.result.encounterRevision !== receipt.encounterDocumentRevision
    || operation.result.mapRevision !== receipt.encounterMapRevision) {
    return fail('battle-contest.settlement-retry-conflict', 'Battle settlement retry no longer matches both durable operation journals and the combined receipt.')
  }
}
