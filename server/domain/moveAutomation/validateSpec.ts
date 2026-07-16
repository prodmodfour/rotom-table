import { createHash } from 'node:crypto'
import capabilityCatalogJson from '../../../data/move-automation/capabilities.json'
import {
  MOVE_AUTOMATION_CAPABILITY_LIMITS,
} from '#shared/moveAutomation/capabilities'
import {
  MOVE_EFFECT_OPERATION_LIMITS,
  MOVE_EFFECT_RECIPIENT_SCOPED_BRANCH_SELECTOR_KINDS,
  moveEffectBranchPaths,
  parseMoveEffectOperation,
  type MoveBranchEffectOperation,
  type MoveEffectBranchPath,
  type MoveEffectOperation,
  type MoveEffectRecipientSelectorKind,
} from '#shared/moveAutomation/effects'
import {
  MOVE_RULE_AST_LIMITS,
} from '#shared/moveAutomation/ast'
import {
  parseMovePredicate,
  type MovePredicate,
} from '#shared/moveAutomation/predicates'
import {
  MOVE_RULESET_PROVENANCE,
} from '#shared/moveAutomation/ruleset'
import {
  parseMoveSelector,
  type MoveSelector,
} from '#shared/moveAutomation/selectors'
import {
  MoveResourceCostValidationError,
  validateMoveResourceCostCombination,
} from '#shared/moveAutomation/resourceCosts'
import {
  MOVE_SPEC_LIMITS,
  MOVE_SPEC_PHASES,
  parseMoveSpec,
  type MoveSpec,
  type MoveSpecCostDeclaration,
  type MoveSpecPhase,
  type MoveSpecPresentationMetadata,
  type MoveSpecTargetingKind,
} from '#shared/moveAutomation/spec'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
  type RegisteredMoveHandlerReference,
  type RegisteredMoveHandlerRegistry,
} from './handlers/registry'
import {
  parseMoveAutomationTargetPredicateDeclaration,
  type MoveAutomationTargetPredicateDeclaration,
} from './predicates/target'
import {
  stableJsonStringify,
  type StableJsonStringifyOptions,
} from './stableJson'
import { POKEMON_TYPES } from '~/utils/typeChart'

export const MOVE_SPEC_DEFINITION_HASH_VERSION = 1 as const

export const MOVE_SPEC_DEFINITION_LIMITS = Object.freeze({
  capabilityIds: 64,
  operations: MOVE_EFFECT_OPERATION_LIMITS.operations,
  ruleAstNodes: MOVE_RULE_AST_LIMITS.nodes,
})

export interface MoveSpecRulesetVersion {
  readonly rulesetId: string
  readonly canonicalizationVersion: number
  readonly sourceDataSha256: string
}

export interface ValidatedMoveSpecTargetingDeclaration {
  readonly kind: MoveSpecTargetingKind
  readonly minTargets: number
  readonly maxTargets: number
  readonly selector: MoveSelector | null
  readonly predicate?: MoveAutomationTargetPredicateDeclaration | null
}

export interface ValidatedMoveSpecPrecondition {
  readonly id: string
  readonly predicate: MovePredicate
  readonly failureReasonCode: string
}

export interface ValidatedMoveSpecPhaseBlock {
  readonly phase: MoveSpecPhase
  readonly operations: readonly MoveEffectOperation[]
}

export interface ValidatedMoveSpec {
  readonly schemaVersion: MoveSpec['schemaVersion']
  readonly canonicalId: string
  readonly version: number
  readonly targeting: ValidatedMoveSpecTargetingDeclaration
  readonly preconditions: readonly ValidatedMoveSpecPrecondition[]
  readonly costs: readonly MoveSpecCostDeclaration[]
  readonly phases: readonly ValidatedMoveSpecPhaseBlock[]
  readonly registeredHandlerId: string | null
  readonly presentation: MoveSpecPresentationMetadata
}

export interface ValidateMoveSpecOptions {
  /** Reviewed capability tags supplied by the manifest/registry boundary. */
  readonly capabilityIds?: readonly string[]
  /** Dependency injection seam for catalog validation tests and migrations. */
  readonly knownCapabilityIds?: ReadonlySet<string>
  readonly rulesetVersion?: MoveSpecRulesetVersion
  /** Server-owned handler metadata; callbacks never enter the spec or hash material. */
  readonly handlerRegistry?: RegisteredMoveHandlerRegistry
}

export interface ValidatedMoveSpecDefinition {
  readonly spec: ValidatedMoveSpec
  readonly capabilityIds: readonly string[]
  readonly rulesetVersion: MoveSpecRulesetVersion
  readonly registeredHandler: RegisteredMoveHandlerReference | null
  /** Canonical hash material, including hash format and ruleset provenance. */
  readonly canonicalJson: string
  readonly definitionHash: string
}

export type MoveSpecDefinitionValidationCode =
  | 'invalid-definition'
  | 'invalid-ruleset-version'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'phase-mismatch'
  | 'unknown-reference'
  | 'invalid-reference-order'
  | 'unknown-capability'
  | 'unknown-handler'

export class MoveSpecDefinitionValidationError extends Error {
  readonly code: MoveSpecDefinitionValidationCode
  readonly path: string

  constructor(code: MoveSpecDefinitionValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MoveSpecDefinitionValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const PHASE_INDEX = new Map<string, number>(
  MOVE_SPEC_PHASES.map((phase, index) => [phase, index]),
)
const DEFAULT_CAPABILITY_IDS = new Set<string>(
  capabilityCatalogJson.capabilities.map(capability => capability.code),
)
const CANONICAL_TYPE_IDS = new Set<string>(POKEMON_TYPES.map(type => type.toLowerCase()))

export const DEFAULT_MOVE_SPEC_RULESET_VERSION: MoveSpecRulesetVersion = Object.freeze({
  rulesetId: MOVE_RULESET_PROVENANCE.rulesetId,
  canonicalizationVersion: MOVE_RULESET_PROVENANCE.canonicalization.version,
  sourceDataSha256: MOVE_RULESET_PROVENANCE.sourceData.sha256,
})

const fail = (
  code: MoveSpecDefinitionValidationCode,
  path: string,
  message: string,
): never => {
  throw new MoveSpecDefinitionValidationError(code, path, message)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const sortedStrings = (values: readonly string[]): string[] =>
  [...values].sort((left, right) => left === right ? 0 : left < right ? -1 : 1)

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const strictJsonClone = (
  value: unknown,
  path: string,
  limits: StableJsonStringifyOptions['limits'],
): unknown => JSON.parse(stableJsonStringify(value, { path, limits })) as unknown

/**
 * Fill syntax-only defaults before the strict shared envelope parser runs.
 * No mechanic-bearing value is inferred: operation order, predicates, costs,
 * and targeting declarations remain exactly as authored.
 */
const applyMoveSpecDefaultsAndPhaseOrder = (value: unknown): unknown => {
  if (!isPlainRecord(value)) return value
  const root: UnknownRecord = { ...value }

  if (!hasOwn(root, 'preconditions')) root.preconditions = []
  if (!hasOwn(root, 'costs')) root.costs = []
  if (!hasOwn(root, 'phases')) root.phases = []
  if (!hasOwn(root, 'registeredHandlerId')) root.registeredHandlerId = null

  if (isPlainRecord(root.targeting) && !hasOwn(root.targeting, 'selector')) {
    root.targeting = { ...root.targeting, selector: null }
  }

  if (isPlainRecord(root.presentation)) {
    root.presentation = {
      ...root.presentation,
      ...(!hasOwn(root.presentation, 'vfxKey') ? { vfxKey: null } : {}),
      ...(!hasOwn(root.presentation, 'tags') ? { tags: [] } : {}),
    }
  }

  if (Array.isArray(root.phases)) {
    root.phases = root.phases
      .map((block, sourceIndex) => {
        if (!isPlainRecord(block)) return { block, sourceIndex, phaseIndex: Number.MAX_SAFE_INTEGER }
        const normalizedBlock = hasOwn(block, 'operations')
          ? block
          : { ...block, operations: [] }
        return {
          block: normalizedBlock,
          sourceIndex,
          phaseIndex: typeof normalizedBlock.phase === 'string'
            ? PHASE_INDEX.get(normalizedBlock.phase) ?? Number.MAX_SAFE_INTEGER
            : Number.MAX_SAFE_INTEGER,
        }
      })
      .sort((left, right) => left.phaseIndex - right.phaseIndex || left.sourceIndex - right.sourceIndex)
      .map(({ block }) => block)
  }

  return root
}

const normalizeCapabilityIds = (
  value: readonly string[] | undefined,
  knownCapabilityIds: ReadonlySet<string>,
): readonly string[] => {
  const detached = strictJsonClone(value ?? [], 'capabilityIds', {
    maxDepth: 1,
    maxNodes: MOVE_SPEC_DEFINITION_LIMITS.capabilityIds + 1,
    maxObjectFields: 0,
    maxArrayEntries: MOVE_SPEC_DEFINITION_LIMITS.capabilityIds,
    maxStringLength: MOVE_AUTOMATION_CAPABILITY_LIMITS.identifierLength,
  })
  if (!Array.isArray(detached)) {
    return fail('invalid-definition', 'capabilityIds', 'must be an array.')
  }
  if (detached.length > MOVE_SPEC_DEFINITION_LIMITS.capabilityIds) {
    fail(
      'limit-exceeded',
      'capabilityIds',
      `must contain at most ${MOVE_SPEC_DEFINITION_LIMITS.capabilityIds} entries.`,
    )
  }

  const capabilityIds = detached.map((capabilityId, index) => {
    const path = `capabilityIds[${index}]`
    if (
      typeof capabilityId !== 'string'
      || capabilityId.length === 0
      || capabilityId.trim() !== capabilityId
      || CONTROL_CHARACTER_PATTERN.test(capabilityId)
      || !STABLE_ID_PATTERN.test(capabilityId)
    ) {
      return fail('invalid-definition', path, 'must be a lowercase stable identifier.')
    }
    if (!knownCapabilityIds.has(capabilityId)) {
      fail('unknown-capability', path, `${capabilityId} is not in the capability catalog.`)
    }
    return capabilityId
  })

  if (new Set(capabilityIds).size !== capabilityIds.length) {
    fail('duplicate-id', 'capabilityIds', 'must not contain duplicate capability IDs.')
  }
  return Object.freeze(sortedStrings(capabilityIds))
}

const normalizeRulesetVersion = (
  value: MoveSpecRulesetVersion,
): MoveSpecRulesetVersion => {
  const path = 'rulesetVersion'
  const detached = strictJsonClone(value, path, {
    maxDepth: 1,
    maxNodes: 4,
    maxObjectFields: 3,
    maxArrayEntries: 0,
    maxStringLength: MOVE_SPEC_LIMITS.identifierLength,
  })
  if (!isPlainRecord(detached)) {
    return fail('invalid-ruleset-version', path, 'must be an object.')
  }
  const expectedKeys = ['rulesetId', 'canonicalizationVersion', 'sourceDataSha256']
  const actualKeys = Object.keys(detached)
  const missing = expectedKeys.filter(key => !hasOwn(detached, key))
  const unknown = actualKeys.filter(key => !expectedKeys.includes(key))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'invalid-ruleset-version',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
  const rulesetId = detached.rulesetId
  const canonicalizationVersion = detached.canonicalizationVersion
  const sourceDataSha256 = detached.sourceDataSha256
  if (typeof rulesetId !== 'string') {
    return fail('invalid-ruleset-version', `${path}.rulesetId`, 'must be a bounded, trimmed identifier.')
  }
  if (
    rulesetId.length === 0
    || rulesetId.trim() !== rulesetId
    || CONTROL_CHARACTER_PATTERN.test(rulesetId)
  ) {
    fail('invalid-ruleset-version', `${path}.rulesetId`, 'must be a bounded, trimmed identifier.')
  }
  if (
    !Number.isSafeInteger(canonicalizationVersion)
    || Number(canonicalizationVersion) < 1
  ) {
    fail(
      'invalid-ruleset-version',
      `${path}.canonicalizationVersion`,
      'must be a positive safe integer.',
    )
  }
  if (typeof sourceDataSha256 !== 'string') {
    return fail(
      'invalid-ruleset-version',
      `${path}.sourceDataSha256`,
      'must be a lowercase SHA-256 digest.',
    )
  }
  if (!SHA256_PATTERN.test(sourceDataSha256)) {
    fail(
      'invalid-ruleset-version',
      `${path}.sourceDataSha256`,
      'must be a lowercase SHA-256 digest.',
    )
  }

  return Object.freeze({
    rulesetId,
    canonicalizationVersion: Number(canonicalizationVersion),
    sourceDataSha256,
  })
}

const countTaggedAstNodes = (value: unknown): number => {
  if (Array.isArray(value)) {
    let total = 0
    for (const entry of value) total += countTaggedAstNodes(entry)
    return total
  }
  if (!isPlainRecord(value)) return 0
  let total = typeof value.kind === 'string' ? 1 : 0
  for (const child of Object.values(value)) total += countTaggedAstNodes(child)
  return total
}

const parseRules = (spec: MoveSpec): Pick<
  ValidatedMoveSpec,
  'targeting' | 'preconditions'
> => {
  const selector = spec.targeting.selector === null
    ? null
    : parseMoveSelector(spec.targeting.selector, 'spec.targeting.selector')
  const hasTargetPredicate = Object.prototype.hasOwnProperty.call(
    spec.targeting,
    'predicate',
  )
  if (hasTargetPredicate && spec.targeting.kind !== 'area') {
    fail(
      'invalid-definition',
      'spec.targeting.predicate',
      'target predicates are supported only for geometric area targeting.',
    )
  }
  const targetPredicate = spec.targeting.predicate === null
    ? null
    : spec.targeting.predicate === undefined
      ? undefined
      : parseMoveAutomationTargetPredicateDeclaration(spec.targeting.predicate)
  const preconditions = spec.preconditions.map((precondition, index) => ({
    ...precondition,
    predicate: parseMovePredicate(
      precondition.predicate,
      `spec.preconditions[${index}].predicate`,
    ),
  }))
  const ruleAstNodes = countTaggedAstNodes(selector)
    + preconditions.reduce(
      (total, precondition) => total + countTaggedAstNodes(precondition.predicate),
      0,
    )
  if (ruleAstNodes > MOVE_SPEC_DEFINITION_LIMITS.ruleAstNodes) {
    fail(
      'limit-exceeded',
      'spec.rules',
      `selectors and predicates must contain at most ${MOVE_SPEC_DEFINITION_LIMITS.ruleAstNodes} AST nodes in total.`,
    )
  }

  return {
    targeting: {
      kind: spec.targeting.kind,
      minTargets: spec.targeting.minTargets,
      maxTargets: spec.targeting.maxTargets,
      selector,
      ...(hasTargetPredicate ? { predicate: targetPredicate ?? null } : {}),
    },
    preconditions,
  }
}

const parseOperations = (
  spec: MoveSpec,
): readonly ValidatedMoveSpecPhaseBlock[] => {
  const phases = spec.phases.map((phaseBlock, phaseIndex) => ({
    phase: phaseBlock.phase,
    operations: phaseBlock.operations.map((operation, operationIndex) => {
      const path = `spec.phases[${phaseIndex}].operations[${operationIndex}]`
      const parsed = parseMoveEffectOperation(operation, path)
      if (parsed.phase !== phaseBlock.phase) {
        fail(
          'phase-mismatch',
          `${path}.phase`,
          `operation phase ${parsed.phase} does not match containing phase ${phaseBlock.phase}.`,
        )
      }
      return parsed
    }),
  }))
  validateMoveSpecOperationSequence(phases.flatMap((phaseBlock, phaseIndex) => (
    phaseBlock.operations.map((operation, operationIndex) => ({
      operation,
      path: `spec.phases[${phaseIndex}].operations[${operationIndex}]`,
    }))
  )))
  return phases
}

export interface MoveSpecOperationSequenceEntry {
  readonly operation: MoveEffectOperation
  readonly path: string
}

interface IndexedOperation extends MoveSpecOperationSequenceEntry {
  readonly index: number
}

interface IndexedBranchPath {
  readonly branch: MoveEffectBranchPath
  readonly path: string
}

const indexedBranchPaths = (
  operation: MoveBranchEffectOperation,
  operationPath: string,
): readonly IndexedBranchPath[] => {
  const branches = moveEffectBranchPaths(operation.payload)
  let paths: readonly string[]
  switch (operation.payload.kind) {
    case 'predicate':
      paths = [`${operationPath}.payload.whenTrue`, `${operationPath}.payload.whenFalse`]
      break
    case 'relationship':
      paths = [
        `${operationPath}.payload.branches.self`,
        `${operationPath}.payload.branches.ally`,
        `${operationPath}.payload.branches.enemy`,
        `${operationPath}.payload.branches.unknown`,
      ]
      break
    case 'check':
      paths = [
        `${operationPath}.payload.branches.success`,
        `${operationPath}.payload.branches.failure`,
      ]
      break
    case 'choice':
      paths = [
        ...operation.payload.options.map((_, index) => `${operationPath}.payload.options[${index}]`),
        ...(operation.payload.pass ? [`${operationPath}.payload.pass`] : []),
      ]
      break
  }
  return branches.map((branch, index) => ({ branch, path: paths[index]! }))
}

const RECIPIENT_SCOPED_BRANCH_SELECTORS = new Set<string>(
  MOVE_EFFECT_RECIPIENT_SCOPED_BRANCH_SELECTOR_KINDS,
)

/**
 * Validate aggregate bounds, identities, and backward references for the exact
 * operation order an interpreter will execute. Handler output is checked with
 * this same boundary after it is merged with static spec operations.
 */
export const validateMoveSpecOperationSequence = (
  entries: readonly MoveSpecOperationSequenceEntry[],
  aggregatePath = 'spec.phases',
): void => {
  if (entries.length > MOVE_SPEC_DEFINITION_LIMITS.operations) {
    fail(
      'limit-exceeded',
      aggregatePath,
      `must contain at most ${MOVE_SPEC_DEFINITION_LIMITS.operations} operations in total.`,
    )
  }
  const indexed: IndexedOperation[] = entries.map((entry, index) => ({ ...entry, index }))
  const operationIndexById = new Map<string, number>()
  const rollIndexById = new Map<string, number>()
  const reservedRollIds = new Set<string>()
  const requestIndexById = new Map<string, number>()
  const checkIndexById = new Map<string, number>()
  const branchIndexBySelectionId = new Map<string, number>()
  const branchControllerByOperationId = new Map<string, string>()

  const reserveRollId = (rollId: string, path: string): void => {
    if (reservedRollIds.has(rollId)) {
      fail('duplicate-id', path, `roll ID ${rollId} is duplicated.`)
    }
    reservedRollIds.add(rollId)
  }

  const reserveRequestId = (requestId: string, index: number, path: string): void => {
    if (requestIndexById.has(requestId)) {
      fail('duplicate-id', path, `request ID ${requestId} is duplicated.`)
    }
    requestIndexById.set(requestId, index)
  }

  indexed.forEach(({ operation, index, path }) => {
    if (operationIndexById.has(operation.id)) {
      fail('duplicate-id', `${path}.id`, `operation ID ${operation.id} is duplicated.`)
    }
    operationIndexById.set(operation.id, index)

    if (operation.kind === 'roll') {
      reserveRollId(operation.payload.rollId, `${path}.payload.rollId`)
      rollIndexById.set(operation.payload.rollId, index)
    }
    if (operation.kind === 'multi-hit') {
      if (operation.payload.count.kind !== 'fixed') {
        reserveRollId(operation.payload.count.rollId, `${path}.payload.count.rollId`)
      }
      if (operation.payload.accuracy.kind !== 'automatic') {
        reserveRollId(operation.payload.accuracy.rollId, `${path}.payload.accuracy.rollId`)
      }
      if (operation.payload.critical.kind === 'per-hit') {
        reserveRollId(operation.payload.critical.rollId, `${path}.payload.critical.rollId`)
      }
    }
    if (operation.kind === 'check') {
      if (checkIndexById.has(operation.payload.checkId)) {
        fail(
          'duplicate-id',
          `${path}.payload.checkId`,
          `check ID ${operation.payload.checkId} is duplicated.`,
        )
      }
      checkIndexById.set(operation.payload.checkId, index)
      const rolls = operation.payload.kind === 'opposed'
        ? [
            { roll: operation.payload.actorRoll, path: `${path}.payload.actorRoll` },
            { roll: operation.payload.targetRoll, path: `${path}.payload.targetRoll` },
          ]
        : [{ roll: operation.payload.roll, path: `${path}.payload.roll` }]
      for (const entry of rolls) {
        reserveRollId(entry.roll.rollId, `${entry.path}.rollId`)
        if (entry.roll.source.kind === 'choice') {
          reserveRequestId(
            entry.roll.source.requestId,
            index,
            `${entry.path}.source.requestId`,
          )
        }
        if (entry.roll.resourceReroll) {
          reserveRequestId(
            entry.roll.resourceReroll.requestId,
            index,
            `${entry.path}.resourceReroll.requestId`,
          )
        }
      }
    }
    if (operation.kind === 'branch') {
      if (branchIndexBySelectionId.has(operation.payload.selectionId)) {
        fail(
          'duplicate-id',
          `${path}.payload.selectionId`,
          `branch selection ID ${operation.payload.selectionId} is duplicated.`,
        )
      }
      branchIndexBySelectionId.set(operation.payload.selectionId, index)
      if (operation.payload.kind === 'choice') {
        reserveRequestId(
          operation.payload.requestId,
          index,
          `${path}.payload.requestId`,
        )
      }
    }

    if (
      operation.kind === 'movement-request'
      || operation.kind === 'switch-request'
      || operation.kind === 'choice-request'
      || operation.kind === 'reaction-request'
    ) {
      reserveRequestId(operation.payload.requestId, index, `${path}.payload.requestId`)
    }
    if (operation.kind === 'hazard' && operation.payload.action === 'add' && operation.payload.cellSelection) {
      reserveRequestId(
        operation.payload.cellSelection.requestId,
        index,
        `${path}.payload.cellSelection.requestId`,
      )
    }
  })

  const hazardCellChoiceEntries = indexed.filter(({ operation }) => (
    operation.kind === 'hazard'
    && operation.payload.action === 'add'
    && operation.payload.cellSelection !== undefined
  ))
  if (hazardCellChoiceEntries.length > 1) {
    fail(
      'invalid-definition',
      hazardCellChoiceEntries[1]!.path,
      'a MoveSpec may contain at most one durable hazard-cell selection.',
    )
  }
  for (const { operation, path } of hazardCellChoiceEntries) {
    if (operation.kind !== 'hazard' || operation.payload.action !== 'add') continue
    if (operation.phase !== 'schedule') {
      fail(
        'invalid-definition',
        `${path}.phase`,
        'a durable hazard-cell selection must execute in the schedule phase.',
      )
    }
    if (operation.recipients.kind !== 'none') {
      fail(
        'invalid-definition',
        `${path}.recipients`,
        'a durable hazard-cell selection must use the mechanics-free none recipient set.',
      )
    }
  }
  if (hazardCellChoiceEntries.length > 0 && requestIndexById.size > 1) {
    fail(
      'invalid-definition',
      hazardCellChoiceEntries[0]!.path,
      'a durable hazard-cell selection cannot coexist with another response request.',
    )
  }

  const movementChoiceEntries = indexed.filter(({ operation }) => (
    operation.kind === 'movement-request' && operation.payload.choice !== undefined
  ))
  if (movementChoiceEntries.length > 1) {
    fail(
      'invalid-definition',
      movementChoiceEntries[1]!.path,
      'a MoveSpec may contain at most one durable movement choice.',
    )
  }
  for (const { operation, path } of movementChoiceEntries) {
    if (operation.kind !== 'movement-request' || !operation.payload.choice) continue
    if (operation.phase !== 'movement') {
      fail(
        'invalid-definition',
        `${path}.phase`,
        'a durable movement choice must execute in the movement phase.',
      )
    }
    if (operation.recipients.kind !== 'actor') {
      fail(
        'invalid-definition',
        `${path}.recipients`,
        'a durable movement choice must belong to the authoritative actor.',
      )
    }
    if (operation.payload.mode !== 'voluntary') {
      fail(
        'invalid-definition',
        `${path}.payload.mode`,
        'durable movement choices currently support reviewed voluntary movement only.',
      )
    }
    if (
      typeof operation.payload.distance !== 'number'
      || operation.payload.distance <= 0
      || operation.payload.destinationSetId === null
    ) {
      fail(
        'invalid-definition',
        `${path}.payload`,
        'a durable movement choice requires a positive distance and destination set ID.',
      )
    }
  }

  const switchEntries = indexed.filter(({ operation }) => (
    operation.kind === 'switch-request'
  ))
  if (switchEntries.length > 1) {
    fail(
      'invalid-definition',
      switchEntries[1]!.path,
      'a MoveSpec may contain at most one durable switch request.',
    )
  }
  for (const { operation, path } of switchEntries) {
    if (operation.kind !== 'switch-request') continue
    if (operation.phase !== 'movement') {
      fail(
        'invalid-definition',
        `${path}.phase`,
        'a durable switch request must execute in the movement phase.',
      )
    }
    if (operation.recipients.kind !== 'actor') {
      fail(
        'invalid-definition',
        `${path}.recipients`,
        'a durable switch request must belong to the authoritative actor.',
      )
    }
  }
  if (switchEntries.length > 0 && movementChoiceEntries.length > 0) {
    fail(
      'invalid-definition',
      switchEntries[0]!.path,
      'a durable switch and movement choice cannot coexist in one MoveSpec.',
    )
  }

  const displacementEntries = indexed.filter(({ operation }) => (
    operation.kind === 'movement-request' && operation.payload.displacement !== undefined
  ))
  for (const { operation, path } of displacementEntries) {
    if (operation.kind !== 'movement-request' || !operation.payload.displacement) continue
    if (operation.phase !== 'movement') {
      fail(
        'invalid-definition',
        `${path}.phase`,
        'spatial displacement must execute in the movement phase.',
      )
    }
    if (operation.recipients.kind === 'none') {
      fail(
        'invalid-definition',
        `${path}.recipients`,
        'spatial displacement must resolve at least one authoritative recipient selector.',
      )
    }
    if (operation.payload.mode !== 'forced' && operation.payload.mode !== 'voluntary') {
      fail(
        'invalid-definition',
        `${path}.payload.mode`,
        'spatial displacement supports forced or voluntary movement only.',
      )
    }
    if (operation.payload.distance === null || operation.payload.destinationSetId !== null) {
      fail(
        'invalid-definition',
        `${path}.payload`,
        'spatial displacement requires a distance and a server-derived destination.',
      )
    }
  }

  const relocationEntries = indexed.filter(({ operation }) => (
    operation.kind === 'movement-request'
    && (operation.payload.mode === 'teleport' || operation.payload.mode === 'swap')
  ))
  for (const { operation, path } of relocationEntries) {
    if (
      operation.kind !== 'movement-request'
      || (operation.payload.mode !== 'teleport' && operation.payload.mode !== 'swap')
    ) continue
    const mode = operation.payload.mode
    if (operation.phase !== 'movement') {
      fail(
        'invalid-definition',
        `${path}.phase`,
        'teleports and swaps must execute in the movement phase.',
      )
    }
    if (
      typeof operation.payload.distance !== 'number'
      || operation.payload.distance <= 0
      || operation.payload.choice !== undefined
      || operation.payload.displacement !== undefined
    ) {
      fail(
        'invalid-definition',
        `${path}.payload`,
        'teleports and swaps require a positive reviewed range and no displacement or inline choice mechanics.',
      )
    }
    if (
      mode === 'teleport'
      && (
        operation.recipients.kind !== 'actor'
        || operation.payload.destinationSetId === null
      )
    ) {
      fail(
        'invalid-definition',
        `${path}.payload`,
        'a teleport must address the actor and reference one server-owned destination set.',
      )
    }
    if (
      mode === 'swap'
      && (
        operation.recipients.kind !== 'actor-and-attacked-targets'
        || operation.payload.destinationSetId !== null
      )
    ) {
      fail(
        'invalid-definition',
        `${path}.payload`,
        'a position swap must address the actor and attacked target and derive both destinations from their authoritative origins.',
      )
    }
  }

  const multiHitEntries = indexed.filter(({ operation }) => operation.kind === 'multi-hit')
  if (multiHitEntries.length > 1) {
    fail(
      'invalid-definition',
      multiHitEntries[1]!.path,
      'an immediate MoveSpec may contain at most one multi-hit operation.',
    )
  }
  if (multiHitEntries.length === 1) {
    const overlapping = indexed.find(({ operation }) => (
      operation.kind === 'damage'
      || operation.kind === 'direct-hp'
      || operation.kind === 'heal'
      || operation.kind === 'condition'
      || operation.kind === 'combat-stage'
    ))
    if (overlapping) {
      fail(
        'invalid-definition',
        overlapping.path,
        'top-level core effects cannot overlap a pre-reduced multi-hit operation; use its bounded after-each/after-all effects.',
      )
    }
  }

  const assertPriorReference = (
    referenceId: string,
    currentIndex: number,
    path: string,
    indexes: ReadonlyMap<string, number>,
    label: string,
  ): void => {
    const referencedIndex = indexes.get(referenceId)
    if (referencedIndex === undefined) {
      return fail('unknown-reference', path, `${label} ${referenceId} does not resolve.`)
    }
    if (referencedIndex >= currentIndex) {
      fail(
        'invalid-reference-order',
        path,
        `${label} ${referenceId} must refer to an earlier operation.`,
      )
    }
  }

  const assertPriorAccuracyRollReference = (options: {
    readonly rollId: string
    readonly currentIndex: number
    readonly path: string
    readonly effectRecipientKind: MoveEffectRecipientSelectorKind
    readonly label: string
  }): void => {
    assertPriorReference(
      options.rollId,
      options.currentIndex,
      options.path,
      rollIndexById,
      'roll ID',
    )
    const referencedIndex = rollIndexById.get(options.rollId)!
    const referenced = indexed[referencedIndex]?.operation
    if (!referenced || referenced.kind !== 'roll') {
      return fail(
        'invalid-definition',
        options.path,
        `${options.rollId} must identify an earlier roll operation.`,
      )
    }
    const formula = referenced.payload.formula
    if (
      formula.kind !== 'dice'
      || formula.count !== 1
      || formula.sides !== 20
      || formula.modifier !== 0
    ) {
      fail(
        'invalid-definition',
        options.path,
        `roll ${options.rollId} must be an unmodified authoritative d20.`,
      )
    }
    if (
      referenced.recipients.kind !== 'attacked-targets'
      || options.effectRecipientKind !== 'hit-targets'
    ) {
      fail(
        'invalid-definition',
        options.path,
        `${options.label} must narrow an attacked-targets roll to hit-targets.`,
      )
    }
  }

  const assertPriorDamageReference = (
    referenceId: string,
    currentIndex: number,
    path: string,
  ): void => {
    assertPriorReference(
      referenceId,
      currentIndex,
      path,
      operationIndexById,
      'damage operation ID',
    )
    const referencedIndex = operationIndexById.get(referenceId)!
    if (indexed[referencedIndex]?.operation.kind !== 'damage') {
      fail(
        'invalid-definition',
        path,
        `${referenceId} must identify an earlier damage operation.`,
      )
    }
  }

  const assertPriorHpLossReference = (
    referenceId: string,
    pool: 'hit-points' | 'temporary-hit-points',
    currentIndex: number,
    path: string,
  ): void => {
    assertPriorReference(
      referenceId,
      currentIndex,
      path,
      operationIndexById,
      'direct HP operation ID',
    )
    const referencedIndex = operationIndexById.get(referenceId)!
    const referenced = indexed[referencedIndex]?.operation
    if (!referenced || referenced.kind !== 'direct-hp') {
      return fail(
        'invalid-definition',
        path,
        `${referenceId} must identify an earlier direct HP operation.`,
      )
    }
    if (referenced.payload.pool !== pool) {
      fail(
        'invalid-definition',
        `${path.replace(/\.hpOperationId$/, '')}.pool`,
        `must match source operation ${referenceId} pool ${referenced.payload.pool}.`,
      )
    }
  }

  indexed.forEach(({ operation, index, path }) => {
    if (operation.source.kind === 'operation') {
      assertPriorReference(
        operation.source.id,
        index,
        `${path}.source.id`,
        operationIndexById,
        'operation ID',
      )
    }
    if (operation.kind === 'branch') {
      if (operation.payload.kind === 'check') {
        assertPriorReference(
          operation.payload.checkId,
          index,
          `${path}.payload.checkId`,
          checkIndexById,
          'check ID',
        )
        const checkIndex = checkIndexById.get(operation.payload.checkId)!
        const candidateCheckOperation = indexed[checkIndex]?.operation
        const checkOperation = candidateCheckOperation?.kind === 'check'
          ? candidateCheckOperation
          : fail(
              'invalid-definition',
              `${path}.payload.checkId`,
              `${operation.payload.checkId} must identify an earlier check operation.`,
            )
        if (checkOperation.recipients.kind !== operation.recipients.kind) {
          fail(
            'invalid-definition',
            `${path}.recipients.kind`,
            'a check-result branch must use the same authoritative recipient selector as its check.',
          )
        }
        for (const outcome of ['success', 'failure'] as const) {
          if (operation.payload.branches[outcome].id !== checkOperation.payload.branches[outcome]) {
            fail(
              'invalid-definition',
              `${path}.payload.branches.${outcome}.id`,
              `must match check ${operation.payload.checkId} ${outcome} branch ID ${checkOperation.payload.branches[outcome]}.`,
            )
          }
        }
      }
      for (const branchEntry of indexedBranchPaths(operation, path)) {
        for (const [referenceIndex, operationId] of branchEntry.branch.operationIds.entries()) {
          const referencePath = `${branchEntry.path}.operationIds[${referenceIndex}]`
          const controlledIndex = operationIndexById.get(operationId) ?? fail(
            'unknown-reference',
            referencePath,
            `branch operation ID ${operationId} does not resolve.`,
          )
          if (controlledIndex <= index) {
            fail(
              'invalid-reference-order',
              referencePath,
              `branch operation ID ${operationId} must refer to a later operation.`,
            )
          }
          const controlled = indexed[controlledIndex]?.operation
          if (!controlled || controlled.kind === 'branch') {
            fail(
              'invalid-definition',
              referencePath,
              'a branch cannot control another branch operation.',
            )
          }
          if (
            operation.payload.scope === 'recipient'
            && !RECIPIENT_SCOPED_BRANCH_SELECTORS.has(controlled.recipients.kind)
          ) {
            fail(
              'invalid-definition',
              referencePath,
              `recipient-scoped branch ${operation.payload.selectionId} can control only target-derived recipient operations.`,
            )
          }
          const existingController = branchControllerByOperationId.get(operationId)
          if (existingController && existingController !== operation.payload.selectionId) {
            fail(
              'invalid-definition',
              referencePath,
              `operation ${operationId} is already controlled by branch ${existingController}.`,
            )
          }
          branchControllerByOperationId.set(operationId, operation.payload.selectionId)
        }
      }
    }
    if (operation.kind === 'direct-hp' || operation.kind === 'heal') {
      if (operation.kind === 'direct-hp' && operation.payload.accuracyRollId) {
        assertPriorAccuracyRollReference({
          rollId: operation.payload.accuracyRollId,
          currentIndex: index,
          path: `${path}.payload.accuracyRollId`,
          effectRecipientKind: operation.recipients.kind,
          label: 'accuracy-gated direct HP',
        })
      }
      const calculation = operation.payload.calculation
      if (calculation?.kind === 'damage-dealt') {
        assertPriorDamageReference(
          calculation.damageOperationId,
          index,
          `${path}.payload.calculation.damageOperationId`,
        )
      }
      if (calculation?.kind === 'hp-lost') {
        assertPriorHpLossReference(
          calculation.hpOperationId,
          calculation.pool,
          index,
          `${path}.payload.calculation.hpOperationId`,
        )
      }
      if (operation.kind === 'direct-hp' && operation.payload.cost?.timing === 'damage') {
        const referencePath = `${path}.payload.cost.damageOperationId`
        const damageOperationId = operation.payload.cost.damageOperationId
          ?? fail(
            'invalid-definition',
            referencePath,
            'damage timing requires a damage operation ID.',
          )
        assertPriorDamageReference(damageOperationId, index, referencePath)
      }
    }
    if (operation.kind === 'condition' && operation.payload.randomChoice) {
      const referencePath = `${path}.payload.randomChoice.rollId`
      const rollId = operation.payload.randomChoice.rollId
      assertPriorReference(rollId, index, referencePath, rollIndexById, 'roll ID')
      const referencedIndex = rollIndexById.get(rollId)!
      const referenced = indexed[referencedIndex]?.operation
      if (!referenced || referenced.kind !== 'roll') {
        return fail('invalid-definition', referencePath, `${rollId} must identify an earlier roll operation.`)
      }
      const choiceCount = operation.payload.randomChoice.conditionIds.length
      const formula = referenced.payload.formula
      const exactChoiceRange = formula.kind === 'uniform-integer'
        ? formula.minimum === 1 && formula.maximum === choiceCount
        : formula.kind === 'dice'
          && formula.count === 1
          && formula.sides === choiceCount
          && formula.modifier === 0
      if (!exactChoiceRange) {
        fail(
          'invalid-definition',
          referencePath,
          `roll ${rollId} must resolve exactly the one-based range 1 through ${choiceCount}.`,
        )
      }
      if (
        referenced.recipients.kind !== 'none'
        && referenced.recipients.kind !== operation.recipients.kind
      ) {
        fail(
          'invalid-definition',
          referencePath,
          'a per-recipient condition choice must use the same authoritative recipient selector as its roll.',
        )
      }
    }
    if (operation.kind === 'condition' && operation.payload.accuracyRollTrigger) {
      const referencePath = `${path}.payload.accuracyRollTrigger.rollId`
      const rollId = operation.payload.accuracyRollTrigger.rollId
      assertPriorAccuracyRollReference({
        rollId,
        currentIndex: index,
        path: referencePath,
        effectRecipientKind: operation.recipients.kind,
        label: 'an accuracy-triggered condition',
      })
      const linkedDamage = indexed.find(entry => (
        entry.index < index
        && entry.operation.kind === 'damage'
        && entry.operation.payload.accuracyRollId === rollId
      ))
      if (!linkedDamage) {
        fail(
          'invalid-definition',
          referencePath,
          `roll ${rollId} must be the accuracy roll of an earlier damage operation.`,
        )
      }
    }
    const damage = operation.kind === 'damage'
      ? operation.payload
      : operation.kind === 'multi-hit'
        ? operation.payload.damage
        : null
    if (!damage) return
    const damagePath = operation.kind === 'multi-hit'
      ? `${path}.payload.damage`
      : `${path}.payload`
    if (
      typeof damage.moveType === 'string'
      && !CANONICAL_TYPE_IDS.has(damage.moveType)
    ) {
      fail(
        'invalid-definition',
        `${damagePath}.moveType`,
        `move type ${damage.moveType} is not canonical.`,
      )
    }
    damage.typeEffectiveness?.defenderTypeOverrides.forEach((override, overrideIndex) => {
      if (CANONICAL_TYPE_IDS.has(override.defenderType)) return
      fail(
        'invalid-definition',
        `${damagePath}.typeEffectiveness.defenderTypeOverrides[${overrideIndex}].defenderType`,
        `defender type ${override.defenderType} is not canonical.`,
      )
    })
    const criticalTrigger = damage.criticalHit?.trigger
    if (operation.kind === 'multi-hit') {
      if (
        (criticalTrigger?.kind === 'range' || criticalTrigger?.kind === 'natural-rolls')
        && operation.payload.critical.kind === 'none'
      ) {
        fail(
          'invalid-definition',
          `${damagePath}.criticalHit.trigger`,
          `${criticalTrigger.kind} critical triggers require an accuracy or per-hit critical roll.`,
        )
      }
      return
    }
    if (
      (criticalTrigger?.kind === 'range' || criticalTrigger?.kind === 'natural-rolls')
      && damage.criticalRollId === null
      && damage.accuracyRollId === null
    ) {
      fail(
        'invalid-definition',
        `${damagePath}.criticalHit.trigger`,
        `${criticalTrigger.kind} critical triggers require an accuracyRollId or criticalRollId.`,
      )
    }
    if (damage.accuracyRollId !== null) {
      assertPriorReference(
        damage.accuracyRollId,
        index,
        `${damagePath}.accuracyRollId`,
        rollIndexById,
        'roll ID',
      )
    }
    if (damage.criticalRollId !== null) {
      assertPriorReference(
        damage.criticalRollId,
        index,
        `${damagePath}.criticalRollId`,
        rollIndexById,
        'roll ID',
      )
    }
  })
}

const validateResourceCostCombinations = (
  costs: readonly MoveSpecCostDeclaration[],
): void => {
  try {
    validateMoveResourceCostCombination(
      costs.map(declaration => declaration.cost),
      'spec.costs',
    )
  }
  catch (error) {
    if (error instanceof MoveResourceCostValidationError) {
      fail(
        error.code === 'duplicate-resource-cost' ? 'duplicate-id' : 'invalid-definition',
        error.path,
        error.message.slice(error.path.length + 2),
      )
    }
    throw error
  }
}

const normalizeSpec = (input: unknown): ValidatedMoveSpec => {
  const detached = strictJsonClone(input, 'spec', {
    maxDepth: MOVE_SPEC_LIMITS.jsonDepth,
    maxNodes: MOVE_SPEC_LIMITS.jsonNodes,
    maxObjectFields: MOVE_SPEC_LIMITS.jsonObjectFields,
    maxArrayEntries: MOVE_SPEC_LIMITS.jsonArrayEntries,
    maxStringLength: MOVE_SPEC_LIMITS.jsonStringLength,
  })
  const spec = parseMoveSpec(applyMoveSpecDefaultsAndPhaseOrder(detached))
  const rules = parseRules(spec)
  const phases = parseOperations(spec)
  validateResourceCostCombinations(spec.costs)
  const branchRuleAstNodes = phases.reduce((total, phase) => total + phase.operations.reduce(
    (phaseTotal, operation) => phaseTotal + (
      operation.kind === 'branch' && operation.payload.kind === 'predicate'
        ? countTaggedAstNodes(operation.payload.predicate)
        : 0
    ),
    0,
  ), 0)
  const envelopeRuleAstNodes = countTaggedAstNodes(rules.targeting.selector)
    + rules.preconditions.reduce(
      (total, precondition) => total + countTaggedAstNodes(precondition.predicate),
      0,
    )
  if (envelopeRuleAstNodes + branchRuleAstNodes > MOVE_SPEC_DEFINITION_LIMITS.ruleAstNodes) {
    fail(
      'limit-exceeded',
      'spec.rules',
      `selectors and predicates must contain at most ${MOVE_SPEC_DEFINITION_LIMITS.ruleAstNodes} AST nodes in total.`,
    )
  }

  return deepFreeze({
    schemaVersion: spec.schemaVersion,
    canonicalId: spec.canonicalId,
    version: spec.version,
    targeting: rules.targeting,
    preconditions: rules.preconditions,
    costs: spec.costs,
    phases,
    registeredHandlerId: spec.registeredHandlerId,
    presentation: {
      ...spec.presentation,
      tags: sortedStrings(spec.presentation.tags),
    },
  })
}

/**
 * Validate every executable MoveSpec node, normalize syntax-only defaults and
 * set ordering, then fingerprint canonical JSON bound to reviewed rules data.
 */
export const validateMoveSpec = (
  input: unknown,
  options: ValidateMoveSpecOptions = {},
): ValidatedMoveSpecDefinition => {
  const spec = normalizeSpec(input)
  const capabilityIds = normalizeCapabilityIds(
    options.capabilityIds,
    options.knownCapabilityIds ?? DEFAULT_CAPABILITY_IDS,
  )
  const rulesetVersion = normalizeRulesetVersion(
    options.rulesetVersion ?? DEFAULT_MOVE_SPEC_RULESET_VERSION,
  )
  const handlerRegistry = options.handlerRegistry ?? REGISTERED_MOVE_HANDLER_REGISTRY
  const registeredHandler = spec.registeredHandlerId === null
    ? null
    : handlerRegistry.resolve(spec.registeredHandlerId)
  if (spec.registeredHandlerId !== null && registeredHandler === null) {
    fail(
      'unknown-handler',
      'spec.registeredHandlerId',
      `registered handler ${spec.registeredHandlerId} does not exist.`,
    )
  }
  const registeredHandlerReference: RegisteredMoveHandlerReference | null = registeredHandler
    ? Object.freeze({ id: registeredHandler.id, version: registeredHandler.version })
    : null
  const canonicalJson = stableJsonStringify({
    definitionHashVersion: MOVE_SPEC_DEFINITION_HASH_VERSION,
    rulesetVersion,
    capabilityIds,
    ...(registeredHandlerReference ? { registeredHandler: registeredHandlerReference } : {}),
    spec,
  }, {
    path: 'moveSpecDefinition',
    limits: {
      maxDepth: MOVE_SPEC_LIMITS.jsonDepth + 2,
      maxNodes: MOVE_SPEC_LIMITS.jsonNodes + MOVE_SPEC_DEFINITION_LIMITS.capabilityIds + 18,
      maxObjectFields: MOVE_SPEC_LIMITS.jsonObjectFields,
      maxArrayEntries: MOVE_SPEC_LIMITS.jsonArrayEntries,
      maxStringLength: MOVE_SPEC_LIMITS.jsonStringLength,
    },
  })
  const definitionHash = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')

  return deepFreeze({
    spec,
    capabilityIds,
    rulesetVersion,
    registeredHandler: registeredHandlerReference,
    canonicalJson,
    definitionHash,
  })
}
