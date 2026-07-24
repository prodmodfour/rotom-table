import { createHash } from 'node:crypto'
import abilityCatalogJson from '../../../data/reference/abilities.json'
import capabilityCatalogJson from '../../../data/ability-automation/capabilities.json'
import {
  ABILITY_AUTOMATION_CAPABILITY_LIMITS,
} from '#shared/abilityAutomation/capabilities'
import {
  ABILITY_ENCOUNTER_EVENT_KINDS,
  ABILITY_EVENT_CHECKPOINTS,
} from '#shared/abilityAutomation/events'
import {
  ABILITY_RULESET_PROVENANCE,
} from '#shared/abilityAutomation/ruleset'
import {
  ABILITY_SPEC_LIMITS,
  ABILITY_SPEC_PHASES,
  parseAbilitySpecEnvelope,
  type AbilitySpecCostDeclaration,
  type AbilitySpecEffectOperation,
  type AbilitySpecJsonObject,
  type AbilitySpecModeDeclaration,
  type AbilitySpecPhase,
  type AbilitySpecPhaseBlock,
  type AbilitySpecPrecondition,
  type AbilitySpecPresentationMetadata,
  type AbilitySpecSubscription,
  type AbilitySpecTargetingDeclaration,
  type AbilitySpecV1,
} from '#shared/abilityAutomation/spec'
import {
  cloneStrictJson,
  deepFreezeStrictJson,
  isPlainJsonObject,
} from '#shared/automation/strictJson'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { REGISTERED_ABILITY_HANDLER_REGISTRY } from './handlers/registry'
import type {
  AbilitySpecExtensionFamily,
  AbilitySpecExtensionReference,
  AbilitySpecExtensionRegistry,
} from './extensionRegistry'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from './sharedKernelExtensions'

export const ABILITY_SPEC_DEFINITION_HASH_VERSION = 1 as const

export const ABILITY_SPEC_DEFINITION_LIMITS = Object.freeze({
  capabilityIds: 64,
  extensionReferences: 256,
})

export interface AbilitySpecRulesetVersion {
  readonly rulesetId: string
  readonly canonicalizationVersion: number
  readonly sourceDataSha256: string
}

export interface AbilitySpecHandlerReference {
  readonly id: string
  readonly version: number
}

export interface AbilitySpecHandlerReferenceRegistry {
  readonly resolve: (id: string) => AbilitySpecHandlerReference | null
}

export interface ValidatedAbilitySpecSubscription extends Omit<AbilitySpecSubscription, 'predicate'> {
  readonly predicate: AbilitySpecJsonObject | null
}

export interface ValidatedAbilitySpecTargetingDeclaration
  extends Omit<AbilitySpecTargetingDeclaration, 'selector' | 'predicate'> {
  readonly selector: AbilitySpecJsonObject | null
  readonly predicate: AbilitySpecJsonObject | null
}

export interface ValidatedAbilitySpecPrecondition extends Omit<AbilitySpecPrecondition, 'predicate'> {
  readonly predicate: AbilitySpecJsonObject
}

export interface ValidatedAbilitySpecCostDeclaration extends Omit<AbilitySpecCostDeclaration, 'cost'> {
  readonly cost: AbilitySpecJsonObject
}

export interface ValidatedAbilitySpecPhaseBlock extends Omit<AbilitySpecPhaseBlock, 'operations'> {
  readonly operations: readonly AbilitySpecEffectOperation[]
}

export interface ValidatedAbilitySpec extends Omit<
  AbilitySpecV1,
  'subscriptions' | 'targeting' | 'preconditions' | 'costs' | 'phases' | 'presentation'
> {
  readonly subscriptions: readonly ValidatedAbilitySpecSubscription[]
  readonly targeting: readonly ValidatedAbilitySpecTargetingDeclaration[]
  readonly preconditions: readonly ValidatedAbilitySpecPrecondition[]
  readonly costs: readonly ValidatedAbilitySpecCostDeclaration[]
  readonly phases: readonly ValidatedAbilitySpecPhaseBlock[]
  readonly presentation: AbilitySpecPresentationMetadata
}

export interface ValidatedAbilitySpecDefinition {
  readonly spec: ValidatedAbilitySpec
  readonly capabilityIds: readonly string[]
  readonly rulesetVersion: AbilitySpecRulesetVersion
  readonly extensionReferences: readonly AbilitySpecExtensionReference[]
  readonly registeredHandler: AbilitySpecHandlerReference | null
  readonly canonicalJson: string
  readonly definitionHash: string
}

export interface ValidateAbilitySpecOptions {
  readonly capabilityIds?: readonly string[]
  readonly knownCapabilities?: ReadonlyMap<string, readonly string[]>
  readonly knownCanonicalIds?: ReadonlySet<string>
  readonly rulesetVersion?: AbilitySpecRulesetVersion
  readonly extensionRegistry?: AbilitySpecExtensionRegistry
  readonly handlerRegistry?: AbilitySpecHandlerReferenceRegistry
}

export type AbilitySpecDefinitionValidationCode =
  | 'invalid-definition'
  | 'invalid-ruleset-version'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'invalid-mode'
  | 'invalid-phase-order'
  | 'unknown-extension'
  | 'invalid-extension'
  | 'unknown-capability'
  | 'missing-capability-dependency'
  | 'unknown-handler'
  | 'unknown-canonical-id'

export class AbilitySpecDefinitionValidationError extends Error {
  readonly code: AbilitySpecDefinitionValidationCode
  readonly path: string

  constructor(code: AbilitySpecDefinitionValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilitySpecDefinitionValidationError'
    this.code = code
    this.path = path
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const PHASE_INDEX = new Map<string, number>(ABILITY_SPEC_PHASES.map((phase, index) => [phase, index]))
const DEFAULT_CANONICAL_IDS = new Set(Object.keys(abilityCatalogJson))
const DEFAULT_CAPABILITIES = new Map<string, readonly string[]>(
  capabilityCatalogJson.capabilities.map(capability => [capability.code, capability.dependencies]),
)
export const DEFAULT_ABILITY_SPEC_RULESET_VERSION: AbilitySpecRulesetVersion = Object.freeze({
  rulesetId: ABILITY_RULESET_PROVENANCE.rulesetId,
  canonicalizationVersion: ABILITY_RULESET_PROVENANCE.canonicalization.version,
  sourceDataSha256: ABILITY_RULESET_PROVENANCE.sourceData.sha256,
})

const fail = (
  code: AbilitySpecDefinitionValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilitySpecDefinitionValidationError(code, path, detail)
}

const sortedStrings = (values: readonly string[]): string[] => [...values].sort((left, right) => (
  left < right ? -1 : left > right ? 1 : 0
))

const normalizeRulesetVersion = (value: AbilitySpecRulesetVersion): AbilitySpecRulesetVersion => {
  const path = 'rulesetVersion'
  const detached = cloneStrictJson(value, path, {
    limits: {
      depth: 1,
      nodes: 4,
      objectFields: 3,
      arrayEntries: 0,
      stringLength: ABILITY_SPEC_LIMITS.identifierLength,
      objectKeyLength: ABILITY_SPEC_LIMITS.identifierLength,
    },
    rootLabel: 'ability ruleset version',
    valueLabel: 'ability ruleset versions',
    failNotJson: (failurePath, detail) => fail('invalid-ruleset-version', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(detached)) {
    return fail('invalid-ruleset-version', path, 'must be a plain object.')
  }
  const fields = ['rulesetId', 'canonicalizationVersion', 'sourceDataSha256'] as const
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(detached, field))
  const unknown = Object.keys(detached).filter(field => !(fields as readonly string[]).includes(field))
  if (missing.length || unknown.length) {
    fail('invalid-ruleset-version', path, 'must contain exactly the supported provenance fields.')
  }
  const rulesetId = detached.rulesetId
  const canonicalizationVersion = detached.canonicalizationVersion
  const sourceDataSha256 = detached.sourceDataSha256
  if (
    typeof rulesetId !== 'string'
    || rulesetId.length === 0
    || rulesetId.trim() !== rulesetId
    || CONTROL_CHARACTER_PATTERN.test(rulesetId)
  ) {
    fail('invalid-ruleset-version', `${path}.rulesetId`, 'must be a bounded trimmed identifier.')
  }
  if (
    !Number.isSafeInteger(canonicalizationVersion)
    || Number(canonicalizationVersion) < 1
  ) {
    fail('invalid-ruleset-version', `${path}.canonicalizationVersion`, 'must be a positive safe integer.')
  }
  if (
    typeof sourceDataSha256 !== 'string'
    || !SHA256_PATTERN.test(sourceDataSha256)
  ) {
    fail('invalid-ruleset-version', `${path}.sourceDataSha256`, 'must be a lowercase SHA-256 digest.')
  }
  return Object.freeze({
    rulesetId: rulesetId as string,
    canonicalizationVersion: Number(canonicalizationVersion),
    sourceDataSha256: sourceDataSha256 as string,
  })
}

const normalizeCapabilities = (
  values: readonly string[] | undefined,
  knownCapabilities: ReadonlyMap<string, readonly string[]>,
): readonly string[] => {
  const path = 'capabilityIds'
  const detached = cloneStrictJson(values ?? [], path, {
    limits: {
      depth: 1,
      nodes: ABILITY_SPEC_DEFINITION_LIMITS.capabilityIds + 1,
      objectFields: 0,
      arrayEntries: ABILITY_SPEC_DEFINITION_LIMITS.capabilityIds,
      stringLength: ABILITY_AUTOMATION_CAPABILITY_LIMITS.identifierLength,
      objectKeyLength: ABILITY_AUTOMATION_CAPABILITY_LIMITS.identifierLength,
    },
    rootLabel: 'ability capability IDs',
    valueLabel: 'ability capability ID lists',
    failNotJson: (failurePath, detail) => fail('invalid-definition', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!Array.isArray(detached)) return fail('invalid-definition', path, 'must be an array.')
  const capabilityIds = detached.map((value, index) => {
    const entryPath = `${path}[${index}]`
    if (typeof value !== 'string' || !STABLE_ID_PATTERN.test(value)) {
      return fail('invalid-definition', entryPath, 'must be a lowercase stable identifier.')
    }
    if (!knownCapabilities.has(value)) {
      fail('unknown-capability', entryPath, `${value} is not in the ability capability catalog.`)
    }
    return value
  })
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    fail('duplicate-id', path, 'must not contain duplicate capability IDs.')
  }
  const selected = new Set(capabilityIds)
  for (const capabilityId of capabilityIds) {
    for (const dependency of knownCapabilities.get(capabilityId) ?? []) {
      if (!selected.has(dependency)) {
        fail(
          'missing-capability-dependency',
          path,
          `${capabilityId} requires capability ${dependency}.`,
        )
      }
    }
  }
  return Object.freeze(sortedStrings(capabilityIds))
}

const normalizeHandlerReference = (
  id: string | null,
  registry: AbilitySpecHandlerReferenceRegistry,
): AbilitySpecHandlerReference | null => {
  if (id === null) return null
  const reference = registry.resolve(id)
  if (!reference || reference.id !== id) {
    return fail('unknown-handler', 'abilitySpec.registeredHandlerId', `handler ${id} is not registered.`)
  }
  if (!STABLE_ID_PATTERN.test(reference.id) || !Number.isSafeInteger(reference.version) || reference.version < 1) {
    fail('unknown-handler', 'abilitySpec.registeredHandlerId', `handler ${id} has invalid metadata.`)
  }
  return Object.freeze({ id: reference.id, version: reference.version })
}

interface ExtensionValidationState {
  readonly registry: AbilitySpecExtensionRegistry
  readonly used: Map<string, AbilitySpecExtensionReference>
}

const extensionKey = (reference: AbilitySpecExtensionReference): string => (
  `${reference.family}:${reference.kind}`
)

const cloneExtensionOutput = (value: unknown, path: string): AbilitySpecJsonObject => {
  const detached = cloneStrictJson(value, path, {
    limits: {
      depth: ABILITY_SPEC_LIMITS.jsonDepth,
      nodes: ABILITY_SPEC_LIMITS.jsonNodes,
      objectFields: ABILITY_SPEC_LIMITS.jsonObjectFields,
      arrayEntries: ABILITY_SPEC_LIMITS.jsonArrayEntries,
      stringLength: ABILITY_SPEC_LIMITS.jsonStringLength,
      objectKeyLength: ABILITY_SPEC_LIMITS.identifierLength,
    },
    rootLabel: 'ability extension data',
    valueLabel: 'AbilitySpec extension nodes',
    failNotJson: (failurePath, detail) => fail('invalid-extension', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(detached)) return fail('invalid-extension', path, 'must parse to an object.')
  return detached as AbilitySpecJsonObject
}

const parseExtension = (
  family: AbilitySpecExtensionFamily,
  value: AbilitySpecJsonObject,
  path: string,
  state: ExtensionValidationState,
  phase: AbilitySpecPhase | null = null,
): AbilitySpecJsonObject => {
  const kind = value.kind
  if (typeof kind !== 'string' || !STABLE_ID_PATTERN.test(kind)) {
    return fail('invalid-extension', `${path}.kind`, 'must be a lowercase stable identifier.')
  }
  const extension = state.registry.resolve(family, kind)
  if (!extension) {
    return fail('unknown-extension', `${path}.kind`, `${family} extension ${kind} is not registered.`)
  }
  let parsed: AbilitySpecJsonObject
  try {
    parsed = cloneExtensionOutput(extension.parse(value, path, { family, phase }), path)
  }
  catch (error) {
    if (error instanceof AbilitySpecDefinitionValidationError) throw error
    return fail('invalid-extension', path, `${family} extension ${kind} rejected its node.`)
  }
  if (parsed.kind !== kind) {
    fail('invalid-extension', `${path}.kind`, 'the extension parser cannot change its registered kind.')
  }
  const reference = Object.freeze({
    family: extension.family,
    kind: extension.kind,
    version: extension.version,
  })
  state.used.set(extensionKey(reference), reference)
  return deepFreezeStrictJson(parsed)
}

const ABILITY_EVENT_KIND_SET = new Set<string>(ABILITY_ENCOUNTER_EVENT_KINDS)
const ABILITY_EVENT_CHECKPOINT_SET = new Set<string>(ABILITY_EVENT_CHECKPOINTS)

const validateModes = (
  modes: readonly AbilitySpecModeDeclaration[],
  subscriptions: readonly AbilitySpecSubscription[],
  costs: readonly AbilitySpecCostDeclaration[],
  phases: readonly AbilitySpecPhaseBlock[],
  hasHandler: boolean,
): void => {
  const modesById = new Map(modes.map(mode => [mode.id, mode]))
  for (const subscription of subscriptions) {
    if (!ABILITY_EVENT_KIND_SET.has(subscription.eventKind)) {
      fail(
        'invalid-definition',
        `abilitySpec.subscriptions.${subscription.id}.eventKind`,
        'must use a closed ability encounter-event kind.',
      )
    }
    if (!ABILITY_EVENT_CHECKPOINT_SET.has(subscription.checkpoint)) {
      fail(
        'invalid-definition',
        `abilitySpec.subscriptions.${subscription.id}.checkpoint`,
        'must use a closed ability event checkpoint.',
      )
    }
    if (modesById.get(subscription.modeId)?.kind !== 'triggered') {
      fail(
        'invalid-mode',
        `abilitySpec.subscriptions.${subscription.id}.modeId`,
        'subscriptions must belong to a triggered mode.',
      )
    }
  }
  for (const mode of modes) {
    const modeSubscriptions = subscriptions.filter(subscription => subscription.modeId === mode.id)
    if (mode.kind === 'triggered' && modeSubscriptions.length === 0) {
      fail('invalid-mode', `abilitySpec.modes.${mode.id}`, 'a triggered mode requires a subscription.')
    }
    if (mode.kind !== 'triggered' && modeSubscriptions.length > 0) {
      fail('invalid-mode', `abilitySpec.modes.${mode.id}`, 'only triggered modes may subscribe.')
    }
    if (!hasHandler && !phases.some(phase => phase.modeId === mode.id && phase.operations.length > 0)) {
      fail('invalid-mode', `abilitySpec.modes.${mode.id}`, 'must contain an operation or use a handler.')
    }
    if ((mode.kind === 'static' || mode.kind === 'configuration')
      && costs.some(cost => cost.modeId === mode.id)) {
      fail('invalid-mode', `abilitySpec.modes.${mode.id}`, 'a static or configuration mode cannot spend resources.')
    }
  }
  for (const cost of costs) {
    if (cost.phase !== 'reserve' && cost.phase !== 'pay') {
      fail('invalid-definition', `abilitySpec.costs.${cost.id}.phase`, 'costs must use reserve or pay.')
    }
  }
}

const validateTargeting = (targeting: readonly AbilitySpecTargetingDeclaration[]): void => {
  for (const declaration of targeting) {
    const path = `abilitySpec.targeting.${declaration.id}`
    if (
      (declaration.kind === 'none' || declaration.kind === 'self')
      && (declaration.minSelections !== 0 || declaration.maxSelections !== 0)
    ) {
      fail('invalid-definition', path, `${declaration.kind} targeting cannot accept selections.`)
    }
    if (
      declaration.kind !== 'none'
      && declaration.kind !== 'self'
      && declaration.maxSelections === 0
    ) {
      fail('invalid-definition', path, `${declaration.kind} targeting must allow a selection.`)
    }
  }
}

const validatePhaseOrder = (
  modes: readonly AbilitySpecModeDeclaration[],
  phases: readonly AbilitySpecPhaseBlock[],
): void => {
  const modeIndex = new Map(modes.map((mode, index) => [mode.id, index]))
  let previousModeIndex = -1
  let previousPhaseIndex = -1
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index]!
    const currentModeIndex = modeIndex.get(phase.modeId)!
    const currentPhaseIndex = PHASE_INDEX.get(phase.phase)!
    if (
      currentModeIndex < previousModeIndex
      || (currentModeIndex === previousModeIndex && currentPhaseIndex <= previousPhaseIndex)
    ) {
      fail(
        'invalid-phase-order',
        `abilitySpec.phases[${index}]`,
        'phase blocks must follow mode declaration and canonical phase order without duplicates.',
      )
    }
    previousModeIndex = currentModeIndex
    previousPhaseIndex = currentPhaseIndex
  }
}

const extensionReferences = (
  state: ExtensionValidationState,
): readonly AbilitySpecExtensionReference[] => Object.freeze(
  [...state.used.values()].sort((left, right) => {
    const leftKey = extensionKey(left)
    const rightKey = extensionKey(right)
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  }),
)

const normalizeSpec = (
  spec: AbilitySpecV1,
  extensionRegistry: AbilitySpecExtensionRegistry,
  knownCanonicalIds: ReadonlySet<string>,
  hasHandler: boolean,
): { readonly spec: ValidatedAbilitySpec; readonly extensionReferences: readonly AbilitySpecExtensionReference[] } => {
  if (!knownCanonicalIds.has(spec.canonicalId)) {
    fail('unknown-canonical-id', 'abilitySpec.canonicalId', `${spec.canonicalId} is not canonical.`)
  }
  if (spec.presentation.displayName !== spec.canonicalId) {
    fail('invalid-definition', 'abilitySpec.presentation.displayName', 'must match the canonical ability ID.')
  }
  validateModes(spec.modes, spec.subscriptions, spec.costs, spec.phases, hasHandler)
  validateTargeting(spec.targeting)
  validatePhaseOrder(spec.modes, spec.phases)

  const state: ExtensionValidationState = { registry: extensionRegistry, used: new Map() }
  const subscriptions = spec.subscriptions.map((subscription, index) => ({
    ...subscription,
    predicate: subscription.predicate === null
      ? null
      : parseExtension('predicate', subscription.predicate, `abilitySpec.subscriptions[${index}].predicate`, state),
  }))
  const targeting = spec.targeting.map((declaration, index) => ({
    ...declaration,
    selector: declaration.selector === null
      ? null
      : parseExtension('selector', declaration.selector, `abilitySpec.targeting[${index}].selector`, state),
    predicate: declaration.predicate === null
      ? null
      : parseExtension('predicate', declaration.predicate, `abilitySpec.targeting[${index}].predicate`, state),
  }))
  const preconditions = spec.preconditions.map((precondition, index) => ({
    ...precondition,
    predicate: parseExtension('predicate', precondition.predicate, `abilitySpec.preconditions[${index}].predicate`, state),
  }))
  const costs = spec.costs.map((cost, index) => ({
    ...cost,
    cost: parseExtension('cost', cost.cost, `abilitySpec.costs[${index}].cost`, state),
  }))
  const phases = spec.phases.map((phase, phaseIndex) => ({
    ...phase,
    operations: phase.operations.map((operation, operationIndex) => parseExtension(
      'operation',
      operation,
      `abilitySpec.phases[${phaseIndex}].operations[${operationIndex}]`,
      state,
      phase.phase,
    )),
  }))

  return deepFreezeStrictJson({
    spec: {
      ...spec,
      subscriptions,
      targeting,
      preconditions,
      costs,
      phases,
      presentation: {
        ...spec.presentation,
        tags: sortedStrings(spec.presentation.tags),
      },
    },
    extensionReferences: extensionReferences(state),
  })
}

/**
 * Validate all AbilitySpec extension nodes and mode invariants, normalize only
 * set-like metadata, and hash semantic order with frozen ability provenance.
 */
export const validateAbilitySpec = (
  input: unknown,
  options: ValidateAbilitySpecOptions = {},
): ValidatedAbilitySpecDefinition => {
  const handlerRegistry = options.handlerRegistry ?? REGISTERED_ABILITY_HANDLER_REGISTRY
  const envelope = parseAbilitySpecEnvelope(input)
  const registeredHandler = normalizeHandlerReference(envelope.registeredHandlerId, handlerRegistry)
  const normalized = normalizeSpec(
    envelope,
    options.extensionRegistry ?? ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY,
    options.knownCanonicalIds ?? DEFAULT_CANONICAL_IDS,
    registeredHandler !== null,
  )
  const capabilityIds = normalizeCapabilities(
    options.capabilityIds,
    options.knownCapabilities ?? DEFAULT_CAPABILITIES,
  )
  const rulesetVersion = normalizeRulesetVersion(
    options.rulesetVersion ?? DEFAULT_ABILITY_SPEC_RULESET_VERSION,
  )
  if (normalized.extensionReferences.length > ABILITY_SPEC_DEFINITION_LIMITS.extensionReferences) {
    fail(
      'limit-exceeded',
      'extensionReferences',
      `must contain at most ${ABILITY_SPEC_DEFINITION_LIMITS.extensionReferences} entries.`,
    )
  }

  const canonicalJson = stableJsonStringify({
    definitionHashVersion: ABILITY_SPEC_DEFINITION_HASH_VERSION,
    rulesetVersion,
    capabilityIds,
    extensionReferences: normalized.extensionReferences,
    ...(registeredHandler ? { registeredHandler } : {}),
    spec: normalized.spec,
  }, {
    path: 'abilitySpecDefinition',
    limits: {
      maxDepth: ABILITY_SPEC_LIMITS.jsonDepth + 4,
      maxNodes: ABILITY_SPEC_LIMITS.jsonNodes + 1_024,
      maxObjectFields: ABILITY_SPEC_LIMITS.jsonObjectFields,
      maxArrayEntries: ABILITY_SPEC_LIMITS.jsonArrayEntries,
      maxStringLength: ABILITY_SPEC_LIMITS.jsonStringLength,
    },
  })
  const definitionHash = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')

  return deepFreezeStrictJson({
    spec: normalized.spec,
    capabilityIds,
    rulesetVersion,
    extensionReferences: normalized.extensionReferences,
    registeredHandler,
    canonicalJson,
    definitionHash,
  })
}
