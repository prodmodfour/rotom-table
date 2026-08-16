import { createHash } from 'node:crypto'
import type { AuthRole } from '#shared/auth'
import {
  INVENTORY_ACTION_SCHEMA_VERSION,
  parseInventoryActionDeclaration,
  validateInventoryActionDeclarationAgainstOffer,
  type InventoryActionDeclarationV1,
  type InventoryActionExecutionResultV1,
} from '#shared/itemAutomation/inventoryActions'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import { parseEquipmentOperationCommand } from '#shared/itemAutomation/equipmentOperations'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteInventoryActionOperationRepository,
  inventoryActionDeclarationSha256,
  type InventoryActionAcceptedResourcesV1,
  type InventoryActionDownstreamCommandV1,
  type InventoryActionEquipmentCommandV1,
  type InventoryActionOperationRepository,
  type InventoryActionTransferToGroupCommandV1,
  type StoredInventoryActionOperation,
} from '../storage/inventoryActionOperationRepository'
import {
  equipmentConfigurationDefinitionSha256 as currentEquipmentConfigurationDefinitionSha256,
  equipmentDefinitionSha256 as currentEquipmentDefinitionSha256,
} from '../domain/itemAutomation/equipmentDefinitionRegistry'
import type { PersistedSheet } from '../storage/sheetRepository'
import {
  parseInventoryActionStackOperationCommand,
  parseInventoryStackEvidenceRow,
  type InventoryActionStackOperationCommandV1,
} from '../domain/itemAutomation/inventoryStackOperations'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { executeEquipmentOperation } from './executeEquipmentOperation'
import { executeInventoryStackOperationUseCase } from './executeInventoryStackOperation'
import { loadTrainerInventoryActionAuthority } from './loadTrainerInventoryActions'
import { transferTrainerInventoryToGroupUseCase, type TransferTrainerInventoryToGroupResult } from './transferTrainerInventoryToGroup'

export class ExecuteTrainerInventoryActionUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface ExecuteTrainerInventoryActionInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly trainerSlug: string
  readonly declaration: unknown
  readonly clientId?: unknown
}

export interface ExecuteTrainerInventoryActionDependencies {
  readonly database?: RotomDatabase
  readonly operationRepository?: InventoryActionOperationRepository
  readonly equipmentDefinitionSha256?: (canonicalItemId: string) => string | null
  readonly equipmentConfigurationDefinitionSha256?: (canonicalItemId: string) => string | null
  readonly now?: () => number
}

export interface ExecuteTrainerInventoryActionResult {
  readonly result: InventoryActionExecutionResultV1
  readonly sheets: readonly PersistedSheet[]
  readonly groupInventories: readonly GroupInventoryDocument[]
}

const fail = (statusCode: 400 | 403 | 404 | 409, message: string): never => {
  throw new ExecuteTrainerInventoryActionUseCaseError(statusCode, message)
}
const digest32 = (...parts: readonly string[]): string => createHash('sha256')
  .update(parts.join('\u001f'))
  .digest('hex')
  .slice(0, 32)
const downstreamEquipmentOperationId = (operationId: string): string => (
  `equipment-operation:v1:${digest32('inventory-action', operationId)}`
)
const principalKey = (input: Pick<ExecuteTrainerInventoryActionInput, 'role' | 'playerProfile'>): string => input.role === 'gm'
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
const replayResult = (accepted: InventoryActionAcceptedResourcesV1): ExecuteTrainerInventoryActionResult => Object.freeze({
  result: Object.freeze({
    ...accepted.result,
    exactReplay: true,
    message: 'The original accepted inventory action was recovered without moving the item twice.',
  }),
  sheets: accepted.sheets,
  groupInventories: accepted.groupInventories,
})
const assertReplayAuthority = (input: {
  readonly stored: StoredInventoryActionOperation
  readonly declarationSha256: string
  readonly principal: string
  readonly trainerSlug: string
}): void => {
  if (input.stored.declarationSha256 !== input.declarationSha256) {
    fail(409, 'Inventory action operation ID was reused with changed input.')
  }
  if (input.stored.principalKey !== input.principal) fail(403, 'Inventory action replay belongs to a different principal.')
  if (input.stored.trainerSlug !== input.trainerSlug) fail(409, 'Inventory action replay belongs to a different Trainer.')
}
const persistedTransferSheet = (result: TransferTrainerInventoryToGroupResult): PersistedSheet => {
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

const executePending = (input: {
  readonly stored: StoredInventoryActionOperation
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly clientId?: unknown
  readonly database: RotomDatabase
  readonly repository: InventoryActionOperationRepository
  readonly equipmentDefinitionSha256: (canonicalItemId: string) => string | null
  readonly equipmentConfigurationDefinitionSha256: (canonicalItemId: string) => string | null
  readonly now: () => number
}): ExecuteTrainerInventoryActionResult => {
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
          ? 'Selected quantity was separated into a new stack.'
          : stored.declaration.action === 'merge'
            ? 'Whole stack merged into the selected current row.'
            : 'Selected quantity was permanently discarded.'),
        sheets: executed.sheets,
        groupInventories: executed.groupInventories,
      }), input.now()),
    })
    const committed = repository.find(stored.declaration.operationId)
    if (committed?.status !== 'accepted' || !committed.accepted) {
      return fail(409, 'Accepted inventory stack receipt is unavailable.')
    }
    return committed.accepted
  }
  if (command.kind === 'transfer-to-group') {
    let accepted: InventoryActionAcceptedResourcesV1 | null = null
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
      onAcceptedInTransaction: (result) => {
        accepted = Object.freeze({
          result: executionResult(stored.declaration, false, 'Selected quantity moved into group inventory.'),
          sheets: Object.freeze([persistedTransferSheet(result)]),
          groupInventories: Object.freeze([result.groupInventory]),
        })
        repository.accept(stored.declaration.operationId, accepted, input.now())
      },
    })
    const committed = repository.find(stored.declaration.operationId)
    if (!accepted || committed?.status !== 'accepted' || !committed.accepted) {
      return fail(409, 'Accepted inventory transfer receipt is unavailable.')
    }
    return committed.accepted
  }

  if (command.kind !== 'equipment-operation'
    || input.equipmentDefinitionSha256(command.canonicalItemId) !== command.equipmentDefinitionSha256
    || input.equipmentConfigurationDefinitionSha256(command.canonicalItemId) !== command.configurationDefinitionSha256) {
    return fail(409, 'Equipment definition authority changed after inventory action declaration. Refresh before retrying.')
  }
  const equipmentCommand = parseEquipmentOperationCommand(command.command)
  const executed = executeEquipmentOperation({
    role: input.role,
    playerProfile: input.playerProfile,
    command: equipmentCommand,
    clientId: input.clientId,
  }, { database: input.database, now: input.now })
  const accepted: InventoryActionAcceptedResourcesV1 = Object.freeze({
    result: executionResult(
      stored.declaration,
      executed.result.exactReplay,
      executed.result.exactReplay
        ? 'The original accepted equipment move was recovered without moving the item twice.'
        : stored.declaration.action === 'give'
          ? 'Whole item moved into the selected Pokémon’s held-item custody.'
          : 'Whole item moved into Trainer equipment custody.',
    ),
    sheets: executed.sheets,
    groupInventories: executed.groupInventories,
  })
  return repository.accept(stored.declaration.operationId, accepted, input.now()).accepted
    ?? fail(409, 'Accepted inventory action receipt is unavailable.')
}

export const executeTrainerInventoryActionUseCase = (
  input: ExecuteTrainerInventoryActionInput,
  dependencies: ExecuteTrainerInventoryActionDependencies = {},
): ExecuteTrainerInventoryActionResult => {
  let declaration: InventoryActionDeclarationV1
  try { declaration = parseInventoryActionDeclaration(input.declaration) }
  catch (error) { return fail(400, error instanceof Error ? error.message : 'Invalid inventory action declaration.') }
  if (!['equip', 'give', 'transfer', 'split', 'merge', 'discard'].includes(declaration.action)) {
    return fail(400, 'This inventory action must use its existing owning workflow.')
  }

  const database = dependencies.database ?? dependencies.operationRepository?.database ?? getRotomDatabase()
  if (dependencies.operationRepository?.database && dependencies.operationRepository.database !== database) {
    throw new Error('Inventory action operation repository must use one RotomDatabase.')
  }
  const repository = dependencies.operationRepository ?? createSqliteInventoryActionOperationRepository(database)
  const resolveEquipmentDefinitionSha256 = dependencies.equipmentDefinitionSha256 ?? currentEquipmentDefinitionSha256
  const resolveEquipmentConfigurationDefinitionSha256 = dependencies.equipmentConfigurationDefinitionSha256
    ?? currentEquipmentConfigurationDefinitionSha256
  const now = dependencies.now ?? Date.now
  const declarationSha256 = inventoryActionDeclarationSha256(declaration)
  const principal = principalKey(input)
  const existing = repository.find(declaration.operationId)
  if (existing) {
    assertReplayAuthority({ stored: existing, declarationSha256, principal, trainerSlug: input.trainerSlug })
    return executePending({
      stored: existing,
      role: input.role,
      playerProfile: input.playerProfile,
      clientId: input.clientId,
      database,
      repository,
      equipmentDefinitionSha256: resolveEquipmentDefinitionSha256,
      equipmentConfigurationDefinitionSha256: resolveEquipmentConfigurationDefinitionSha256,
      now,
    })
  }

  let authority
  try {
    authority = loadTrainerInventoryActionAuthority({
      role: input.role,
      playerProfile: input.playerProfile,
      trainerSlug: input.trainerSlug,
    }, { database, now })
  }
  catch (error) {
    if (error instanceof UseCaseHttpError) throw error
    return fail(409, error instanceof Error ? error.message : 'Inventory action authority is unavailable.')
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
  const rowId = binding.sourceEntry.id?.trim()
  if (!rowId) return fail(409, 'Inventory source identity is unavailable. Save and refresh before retrying.')

  let downstreamCommand: InventoryActionDownstreamCommandV1
  if (declaration.action === 'split' || declaration.action === 'merge' || declaration.action === 'discard') {
    const destinationRow = declaration.action === 'merge' ? destination?.inventoryRow : null
    if (declaration.action === 'merge' && !destinationRow) {
      return fail(409, 'Inventory merge destination is unavailable or stale.')
    }
    downstreamCommand = parseInventoryActionStackOperationCommand({
      schemaVersion: 1,
      kind: 'inventory-stack-operation',
      action: declaration.action,
      containerKind: 'trainer',
      containerSlug: input.trainerSlug,
      expectedRevision: binding.itemOffer.actor.revision,
      section: binding.itemOffer.source.section,
      sourceRowId: rowId,
      sourceRowBefore: parseInventoryStackEvidenceRow(binding.sourceEntry, binding.itemOffer.source.section),
      destinationRowId: destinationRow?.id?.trim() ?? null,
      destinationRowBefore: destinationRow
        ? parseInventoryStackEvidenceRow(destinationRow, binding.itemOffer.source.section)
        : null,
      splitRowId: declaration.action === 'split'
        ? `item-split-${digest32('inventory-stack-row', declaration.operationId)}`
        : null,
      quantity: declaration.quantity,
    } satisfies InventoryActionStackOperationCommandV1)
  }
  else if (declaration.action === 'equip' || declaration.action === 'give') {
    if (!destination?.slotIds?.length || !destination.equipmentState) {
      return fail(409, 'Equipment destination authority is unavailable or stale.')
    }
    const ownerKind = declaration.action === 'equip' ? 'trainer' as const : 'pokemon' as const
    const ownerSlug = declaration.action === 'equip' ? input.trainerSlug : destination.pokemonSheet?.slug
    const ownerRevision = declaration.action === 'equip'
      ? binding.itemOffer.actor.revision
      : Number(destination.pokemonSheet?.revision ?? -1)
    if (!ownerSlug || !Number.isSafeInteger(ownerRevision) || ownerRevision < 0) {
      return fail(409, 'Equipment destination sheet is unavailable or stale.')
    }
    const canonicalItemId = binding.itemOffer.source.canonicalId
    const definitionSha256 = canonicalItemId ? resolveEquipmentDefinitionSha256(canonicalItemId) : null
    if (!canonicalItemId || !definitionSha256) {
      return fail(409, 'Equipment definition authority is unavailable or stale.')
    }
    const equipmentCommand = parseEquipmentOperationCommand({
      schemaVersion: 1,
      operationId: downstreamEquipmentOperationId(declaration.operationId),
      commandKind: declaration.action,
      actorProfileId: input.playerProfile?.id ?? null,
      source: {
        kind: 'inventory',
        containerKind: 'trainer',
        containerSlug: input.trainerSlug,
        section: binding.itemOffer.source.section,
        rowId,
        sourceInstanceId: itemInventoryInstanceId({
          containerKind: 'trainer',
          containerSlug: input.trainerSlug,
          section: binding.itemOffer.source.section,
          rowId,
        }),
        expectedRevision: binding.itemOffer.actor.revision,
      },
      destination: {
        kind: 'equipment',
        ownerKind,
        ownerSlug,
        slotIds: destination.slotIds,
        expectedSheetRevision: ownerRevision,
        expectedEquipmentRevision: destination.equipmentState.revision,
      },
      replacedInstanceId: null,
      swapReturnDestination: null,
      configuration: destination.configuration ?? null,
    })
    downstreamCommand = Object.freeze({
      schemaVersion: 1,
      kind: 'equipment-operation',
      canonicalItemId,
      equipmentDefinitionSha256: definitionSha256,
      configurationDefinitionSha256: resolveEquipmentConfigurationDefinitionSha256(canonicalItemId),
      command: equipmentCommand,
    } satisfies InventoryActionEquipmentCommandV1)
  }
  else {
    if (!destination || destination.kind !== 'group-inventory' || !destination.groupInventory) {
      return fail(409, 'Group inventory destination is unavailable or stale.')
    }
    downstreamCommand = Object.freeze({
      schemaVersion: 1,
      kind: 'transfer-to-group',
      trainerSlug: input.trainerSlug,
      trainerRevision: binding.itemOffer.actor.revision,
      groupSlug: destination.groupInventory.slug,
      groupRevision: destination.groupInventory.revision,
      section: binding.itemOffer.source.section,
      trainerItemId: rowId,
      itemLabel: binding.itemOffer.source.displayName,
      quantity: declaration.quantity,
    } satisfies InventoryActionTransferToGroupCommandV1)
  }

  let pending: StoredInventoryActionOperation
  try {
    pending = repository.insertPending({
      declarationSha256,
      principalKey: principal,
      trainerSlug: input.trainerSlug,
      declaration,
      downstreamCommand,
      createdAt: now(),
    })
  }
  catch (error) {
    const raced = repository.find(declaration.operationId)
    if (!raced) throw error
    assertReplayAuthority({ stored: raced, declarationSha256, principal, trainerSlug: input.trainerSlug })
    pending = raced
  }
  return executePending({
    stored: pending,
    role: input.role,
    playerProfile: input.playerProfile,
    clientId: input.clientId,
    database,
    repository,
    equipmentDefinitionSha256: resolveEquipmentDefinitionSha256,
    equipmentConfigurationDefinitionSha256: resolveEquipmentConfigurationDefinitionSha256,
    now,
  })
}
