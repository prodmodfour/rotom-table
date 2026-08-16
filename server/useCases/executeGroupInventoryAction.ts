import { createHash } from 'node:crypto'
import type { AuthRole } from '#shared/auth'
import {
  INVENTORY_ACTION_SCHEMA_VERSION,
  parseInventoryActionDeclaration,
  validateInventoryActionDeclarationAgainstOffer,
  type InventoryActionDeclarationV1,
  type InventoryActionExecutionResultV1,
} from '#shared/itemAutomation/inventoryActions'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TrainerSheet } from '~/types/trainerSheet'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteInventoryActionOperationRepository,
  inventoryActionDeclarationSha256,
  type InventoryActionAcceptedResourcesV1,
  type InventoryActionDownstreamCommandV1,
  type InventoryActionOperationRepository,
  type InventoryActionTransferToGroupCommandV1,
  type InventoryActionTransferToTrainerCommandV1,
  type StoredInventoryActionOperation,
} from '../storage/inventoryActionOperationRepository'
import type { PersistedSheet } from '../storage/sheetRepository'
import {
  parseInventoryActionStackOperationCommand,
  parseInventoryStackEvidenceRow,
  type InventoryActionStackOperationCommandV1,
} from '../domain/itemAutomation/inventoryStackOperations'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { executeInventoryStackOperationUseCase } from './executeInventoryStackOperation'
import { loadGroupInventoryActionAuthority } from './loadGroupInventoryActions'
import {
  transferGroupInventoryToTrainerUseCase,
  type TransferGroupInventoryToTrainerResult,
} from './transferGroupInventoryToTrainer'
import {
  transferTrainerInventoryToGroupUseCase,
  type TransferTrainerInventoryToGroupResult,
} from './transferTrainerInventoryToGroup'

export class ExecuteGroupInventoryActionUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface ExecuteGroupInventoryActionInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly groupSlug: string
  readonly declaration: unknown
  readonly clientId?: unknown
}

export interface ExecuteGroupInventoryActionDependencies {
  readonly database?: RotomDatabase
  readonly operationRepository?: InventoryActionOperationRepository
  readonly now?: () => number
}

export interface ExecuteGroupInventoryActionResult {
  readonly result: InventoryActionExecutionResultV1
  readonly sheets: readonly PersistedSheet[]
  readonly groupInventories: readonly GroupInventoryDocument[]
}

const fail = (statusCode: 400 | 403 | 404 | 409, message: string): never => {
  throw new ExecuteGroupInventoryActionUseCaseError(statusCode, message)
}
const digest32 = (...parts: readonly string[]): string => createHash('sha256')
  .update(parts.join('\u001f'))
  .digest('hex')
  .slice(0, 32)
const principalKey = (input: Pick<ExecuteGroupInventoryActionInput, 'role' | 'playerProfile'>): string => input.role === 'gm'
  ? 'role:gm'
  : `profile:${input.playerProfile?.id ?? 'missing'}`
const executionResult = (
  declaration: InventoryActionDeclarationV1,
  exactReplay: boolean,
  message: string,
): InventoryActionExecutionResultV1 => Object.freeze({
  schemaVersion: INVENTORY_ACTION_SCHEMA_VERSION,
  operationId: declaration.operationId,
  action: declaration.action,
  exactReplay,
  message,
})
const replayResult = (accepted: InventoryActionAcceptedResourcesV1): ExecuteGroupInventoryActionResult => Object.freeze({
  result: Object.freeze({
    ...accepted.result,
    exactReplay: true,
    message: 'The original accepted inventory action was recovered without changing inventory twice.',
  }),
  sheets: accepted.sheets,
  groupInventories: accepted.groupInventories,
})
const commandGroupSlug = (command: InventoryActionDownstreamCommandV1): string | null => {
  if (command.kind === 'transfer-to-group' || command.kind === 'transfer-to-trainer') return command.groupSlug
  if (command.kind === 'inventory-stack-operation' && command.containerKind === 'group') return command.containerSlug
  return null
}
const assertReplayAuthority = (input: {
  readonly stored: StoredInventoryActionOperation
  readonly declarationSha256: string
  readonly principal: string
  readonly groupSlug: string
}): void => {
  if (input.stored.declarationSha256 !== input.declarationSha256) {
    fail(409, 'Inventory action operation ID was reused with changed input.')
  }
  if (input.stored.principalKey !== input.principal) fail(403, 'Inventory action replay belongs to a different principal.')
  if (commandGroupSlug(input.stored.downstreamCommand) !== input.groupSlug) {
    fail(409, 'Inventory action replay belongs to a different group inventory.')
  }
}
const persistedTransferSheet = (
  result: TransferTrainerInventoryToGroupResult | TransferGroupInventoryToTrainerResult,
): PersistedSheet => {
  const sheet = result.trainerSheet.sheet
  const revision = Number(sheet.revision ?? -1)
  const updatedAt = Number(sheet.updatedAt ?? -1)
  if (!Number.isSafeInteger(revision) || revision < 0
    || !Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    return fail(409, 'Accepted transfer returned invalid Trainer sheet authority.')
  }
  return Object.freeze({
    kind: 'trainer' as const,
    slug: result.trainerSheet.slug,
    revision,
    updatedAt,
    sheet,
  })
}

const acceptTransfer = (input: {
  readonly stored: StoredInventoryActionOperation
  readonly result: TransferTrainerInventoryToGroupResult | TransferGroupInventoryToTrainerResult
  readonly message: string
  readonly repository: InventoryActionOperationRepository
  readonly now: () => number
}): void => {
  input.repository.accept(input.stored.declaration.operationId, Object.freeze({
    result: executionResult(input.stored.declaration, false, input.message),
    sheets: Object.freeze([persistedTransferSheet(input.result)]),
    groupInventories: Object.freeze([input.result.groupInventory]),
  }), input.now())
}

const executePending = (input: {
  readonly stored: StoredInventoryActionOperation
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly clientId?: unknown
  readonly database: RotomDatabase
  readonly repository: InventoryActionOperationRepository
  readonly now: () => number
}): ExecuteGroupInventoryActionResult => {
  const { stored, repository } = input
  if (stored.status === 'accepted' && stored.accepted) return replayResult(stored.accepted)
  const command = stored.downstreamCommand
  if (command.kind === 'inventory-stack-operation') {
    executeInventoryStackOperationUseCase({
      role: input.role,
      playerProfile: input.playerProfile,
      command,
      clientId: input.clientId,
    }, {
      database: input.database,
      now: input.now,
      onAcceptedInTransaction: executed => repository.accept(stored.declaration.operationId, Object.freeze({
        result: executionResult(stored.declaration, false, stored.declaration.action === 'split'
          ? 'Selected quantity was separated into a new shared stack.'
          : stored.declaration.action === 'merge'
            ? 'Whole shared stack merged into the selected current row.'
            : 'Selected shared quantity was permanently discarded.'),
        sheets: executed.sheets,
        groupInventories: executed.groupInventories,
      }), input.now()),
    })
    const committed = repository.find(stored.declaration.operationId)
    if (committed?.status !== 'accepted' || !committed.accepted) {
      return fail(409, 'Accepted shared inventory stack receipt is unavailable.')
    }
    return committed.accepted
  }
  if (command.kind !== 'transfer-to-group' && command.kind !== 'transfer-to-trainer') {
    return fail(409, 'Stored group inventory action does not use the inventory-transfer handoff.')
  }
  if (command.kind === 'transfer-to-group') {
    transferTrainerInventoryToGroupUseCase({
      role: input.role,
      playerProfile: input.playerProfile,
      trainerSlug: command.trainerSlug,
      trainerRevision: command.trainerRevision,
      groupSlug: command.groupSlug,
      groupRevision: command.groupRevision,
      section: command.section,
      trainerItemId: command.trainerItemId,
      quantity: command.quantity,
      clientId: input.clientId,
    }, {
      database: input.database,
      now: input.now,
      onAcceptedInTransaction: result => acceptTransfer({
        stored,
        result,
        message: 'Selected quantity moved from Trainer inventory into group inventory.',
        repository,
        now: input.now,
      }),
    })
  }
  else {
    transferGroupInventoryToTrainerUseCase({
      role: input.role,
      playerProfile: input.playerProfile,
      groupSlug: command.groupSlug,
      groupRevision: command.groupRevision,
      trainerSlug: command.trainerSlug,
      trainerRevision: command.trainerRevision,
      section: command.section,
      itemId: command.itemId,
      quantity: command.quantity,
      clientId: input.clientId,
    }, {
      database: input.database,
      now: input.now,
      onAcceptedInTransaction: result => acceptTransfer({
        stored,
        result,
        message: 'Selected quantity moved from group inventory into Trainer inventory.',
        repository,
        now: input.now,
      }),
    })
  }
  const committed = repository.find(stored.declaration.operationId)
  if (committed?.status !== 'accepted' || !committed.accepted) {
    return fail(409, 'Accepted inventory transfer receipt is unavailable.')
  }
  return committed.accepted
}

export const executeGroupInventoryActionUseCase = (
  input: ExecuteGroupInventoryActionInput,
  dependencies: ExecuteGroupInventoryActionDependencies = {},
): ExecuteGroupInventoryActionResult => {
  let declaration: InventoryActionDeclarationV1
  try { declaration = parseInventoryActionDeclaration(input.declaration) }
  catch (error) { return fail(400, error instanceof Error ? error.message : 'Invalid inventory action declaration.') }
  if (!['transfer', 'split', 'merge', 'discard'].includes(declaration.action)) {
    return fail(400, 'This group inventory action must use its existing owning workflow.')
  }

  const database = dependencies.database ?? dependencies.operationRepository?.database ?? getRotomDatabase()
  if (dependencies.operationRepository?.database && dependencies.operationRepository.database !== database) {
    throw new Error('Inventory action operation repository must use one RotomDatabase.')
  }
  const repository = dependencies.operationRepository ?? createSqliteInventoryActionOperationRepository(database)
  const now = dependencies.now ?? Date.now
  const declarationSha256 = inventoryActionDeclarationSha256(declaration)
  const principal = principalKey(input)
  const existing = repository.find(declaration.operationId)
  if (existing) {
    assertReplayAuthority({ stored: existing, declarationSha256, principal, groupSlug: input.groupSlug })
    return executePending({
      stored: existing,
      role: input.role,
      playerProfile: input.playerProfile,
      clientId: input.clientId,
      database,
      repository,
      now,
    })
  }

  let authority
  try {
    authority = loadGroupInventoryActionAuthority({
      role: input.role,
      playerProfile: input.playerProfile,
      groupSlug: input.groupSlug,
    }, { database, now })
  }
  catch (error) {
    if (error instanceof UseCaseHttpError) throw error
    return fail(409, error instanceof Error ? error.message : 'Group inventory action authority is unavailable.')
  }
  const offer = authority.projection.offers.find(candidate => candidate.offerId === declaration.offerId)
    ?? fail(409, 'Inventory action offer is unavailable or stale. Refresh before retrying.')
  try { validateInventoryActionDeclarationAgainstOffer(offer, declaration) }
  catch (error) { return fail(409, error instanceof Error ? error.message : 'Inventory action declaration is stale.') }
  const binding = authority.bindings.get(offer.offerId)
    ?? fail(409, 'Inventory action binding is unavailable. Refresh before retrying.')
  const destination = declaration.destinationId
    ? binding.destinationBindings.get(declaration.destinationId)
    : null
  if (declaration.destinationId && !destination) return fail(409, 'Inventory action destination is unavailable or stale.')
  const sourceRowId = binding.sourceRow.id?.trim()
  if (!sourceRowId) return fail(409, 'Inventory source identity is unavailable. Save and refresh before retrying.')

  let downstreamCommand: InventoryActionTransferToGroupCommandV1 | InventoryActionTransferToTrainerCommandV1 | InventoryActionStackOperationCommandV1
  let trainer: TrainerSheet | undefined
  if (binding.direction === 'group-stack') {
    const destinationRow = declaration.action === 'merge' ? destination?.inventoryRow : null
    if (!['split', 'merge', 'discard'].includes(declaration.action)
      || (declaration.action === 'merge' && !destinationRow)) {
      return fail(409, 'Shared inventory stack destination is unavailable or stale.')
    }
    downstreamCommand = parseInventoryActionStackOperationCommand({
      schemaVersion: 1,
      kind: 'inventory-stack-operation',
      action: declaration.action,
      containerKind: 'group',
      containerSlug: binding.groupInventory.slug,
      expectedRevision: binding.groupInventory.revision,
      section: binding.section,
      sourceRowId,
      sourceRowBefore: parseInventoryStackEvidenceRow(binding.sourceRow, binding.section),
      destinationRowId: destinationRow?.id?.trim() ?? null,
      destinationRowBefore: destinationRow ? parseInventoryStackEvidenceRow(destinationRow, binding.section) : null,
      splitRowId: declaration.action === 'split'
        ? `group-item-split-${digest32('inventory-stack-row', declaration.operationId)}`
        : null,
      quantity: declaration.quantity,
    })
  }
  else if (binding.direction === 'group-to-trainer') {
    trainer = destination?.trainerSheet
    if (!trainer) return fail(409, 'Trainer inventory destination is unavailable or stale.')
    downstreamCommand = Object.freeze({
      schemaVersion: 1,
      kind: 'transfer-to-trainer',
      groupSlug: binding.groupInventory.slug,
      groupRevision: binding.groupInventory.revision,
      trainerSlug: trainer.slug,
      trainerRevision: Number(trainer.revision ?? -1),
      section: binding.section,
      itemId: sourceRowId,
      itemLabel: binding.offer.source.itemLabel,
      quantity: declaration.quantity,
    })
  }
  else {
    trainer = binding.trainerSheet
    if (!trainer || !destination?.groupInventory) {
      return fail(409, 'Group inventory destination is unavailable or stale.')
    }
    downstreamCommand = Object.freeze({
      schemaVersion: 1,
      kind: 'transfer-to-group',
      trainerSlug: trainer.slug,
      trainerRevision: Number(trainer.revision ?? -1),
      groupSlug: destination.groupInventory.slug,
      groupRevision: destination.groupInventory.revision,
      section: binding.section,
      trainerItemId: sourceRowId,
      itemLabel: binding.offer.source.itemLabel,
      quantity: declaration.quantity,
    })
  }
  if (downstreamCommand.kind !== 'inventory-stack-operation'
    && (!Number.isSafeInteger(downstreamCommand.trainerRevision) || downstreamCommand.trainerRevision < 0)) {
    return fail(409, 'Trainer inventory revision is unavailable or stale.')
  }
  const adapterScopeSlug = trainer?.slug ?? input.groupSlug

  let pending: StoredInventoryActionOperation
  try {
    pending = repository.insertPending({
      declarationSha256,
      principalKey: principal,
      trainerSlug: adapterScopeSlug,
      declaration,
      downstreamCommand,
      createdAt: now(),
    })
  }
  catch (error) {
    const raced = repository.find(declaration.operationId)
    if (!raced) throw error
    assertReplayAuthority({ stored: raced, declarationSha256, principal, groupSlug: input.groupSlug })
    pending = raced
  }
  return executePending({
    stored: pending,
    role: input.role,
    playerProfile: input.playerProfile,
    clientId: input.clientId,
    database,
    repository,
    now,
  })
}
