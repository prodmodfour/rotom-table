import { describe, expect, it } from 'vitest'
import type { AbilitySpecJsonObject } from '#shared/abilityAutomation/spec'
import {
  createAbilitySpecExtensionRegistry,
  type AbilitySpecExtensionFamily,
  type RegisteredAbilitySpecExtension,
} from '../../server/domain/abilityAutomation/extensionRegistry'
import {
  ABILITY_SPEC_DEFINITION_HASH_VERSION,
  AbilitySpecDefinitionValidationError,
  DEFAULT_ABILITY_SPEC_RULESET_VERSION,
  validateAbilitySpec,
  type AbilitySpecDefinitionValidationCode,
  type ValidateAbilitySpecOptions,
} from '../../server/domain/abilityAutomation/validateSpec'

const exactParser = (fields: readonly string[]) => (
  value: AbilitySpecJsonObject,
): AbilitySpecJsonObject => {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new Error('invalid extension shape')
  }
  return value
}

const extension = (
  family: AbilitySpecExtensionFamily,
  kind: string,
  version: number,
  fields: readonly string[],
): RegisteredAbilitySpecExtension => ({
  family,
  kind,
  version,
  parse: exactParser(fields),
})

const extensionRegistry = (operationVersion = 1) => createAbilitySpecExtensionRegistry([
  extension('selector', 'self', 1, ['kind']),
  extension('predicate', 'constant', 1, ['kind', 'value']),
  extension('cost', 'scene-use', 1, ['amount', 'kind']),
  extension('operation', 'marker', operationVersion, ['id', 'kind', 'steps']),
])

const knownCapabilities = new Map<string, readonly string[]>([
  ['foundation.one', []],
  ['foundation.two', ['foundation.one']],
])

const validSpec = () => ({
  schemaVersion: 1,
  canonicalId: 'Healer',
  version: 1,
  modes: [{ id: 'mode-activated', kind: 'activated' }],
  subscriptions: [],
  targeting: [{
    id: 'target-self',
    modeId: 'mode-activated',
    kind: 'self',
    minSelections: 0,
    maxSelections: 0,
    selector: { kind: 'self' },
    predicate: null,
  }],
  preconditions: [{
    id: 'precondition-ready',
    modeId: 'mode-activated',
    predicate: { kind: 'constant', value: true },
    failureReasonCode: 'ability-not-ready',
  }],
  costs: [{
    id: 'cost-scene',
    modeId: 'mode-activated',
    phase: 'pay',
    cost: { kind: 'scene-use', amount: 1 },
  }],
  phases: [
    { modeId: 'mode-activated', phase: 'pay', operations: [] },
    {
      modeId: 'mode-activated',
      phase: 'effect',
      operations: [{ kind: 'marker', id: 'marker-healed', steps: ['second', 'first'] }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Healer',
    summaryKey: 'ability.healer.summary',
    vfxKey: null,
    tags: ['utility', 'activated'],
  },
})

const validOptions = (): ValidateAbilitySpecOptions => ({
  capabilityIds: ['foundation.two', 'foundation.one'],
  knownCapabilities,
  extensionRegistry: extensionRegistry(),
})

const expectDefinitionError = (
  callback: () => unknown,
  code: AbilitySpecDefinitionValidationCode,
  path?: string,
): AbilitySpecDefinitionValidationError => {
  try {
    callback()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilitySpecDefinitionValidationError)
    expect((error as AbilitySpecDefinitionValidationError).code).toBe(code)
    if (path) expect((error as AbilitySpecDefinitionValidationError).path).toBe(path)
    return error as AbilitySpecDefinitionValidationError
  }
}

describe('AbilitySpec definition validation and hashing', () => {
  it('validates closed extensions and binds provenance, capabilities, and versions into a hash', () => {
    const definition = validateAbilitySpec(validSpec(), validOptions())

    expect(ABILITY_SPEC_DEFINITION_HASH_VERSION).toBe(1)
    expect(definition.rulesetVersion).toEqual(DEFAULT_ABILITY_SPEC_RULESET_VERSION)
    expect(definition.capabilityIds).toEqual(['foundation.one', 'foundation.two'])
    expect(definition.extensionReferences).toEqual([
      { family: 'cost', kind: 'scene-use', version: 1 },
      { family: 'operation', kind: 'marker', version: 1 },
      { family: 'predicate', kind: 'constant', version: 1 },
      { family: 'selector', kind: 'self', version: 1 },
    ])
    expect(definition.definitionHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.parse(definition.canonicalJson)).toMatchObject({
      definitionHashVersion: 1,
      rulesetVersion: DEFAULT_ABILITY_SPEC_RULESET_VERSION,
      capabilityIds: ['foundation.one', 'foundation.two'],
    })
  })

  it('normalizes only set-like metadata and preserves mechanic-bearing order', () => {
    const source = validSpec()
    const first = validateAbilitySpec(source, validOptions())

    const reorderedSets = validSpec()
    reorderedSets.presentation.tags.reverse()
    const second = validateAbilitySpec(reorderedSets, {
      ...validOptions(),
      capabilityIds: ['foundation.one', 'foundation.two'],
    })

    expect(first.spec.presentation.tags).toEqual(['activated', 'utility'])
    expect(first.spec.phases.map(phase => phase.phase)).toEqual(['pay', 'effect'])
    expect(first.spec.phases[1]!.operations[0]!.steps).toEqual(['second', 'first'])
    expect(second.definitionHash).toBe(first.definitionHash)

    const changedOrder = validSpec()
    changedOrder.phases[1]!.operations = [
      { kind: 'marker', id: 'marker-first', steps: ['first'] },
      { kind: 'marker', id: 'marker-second', steps: ['second'] },
    ]
    const forward = validateAbilitySpec(changedOrder, validOptions())
    changedOrder.phases[1]!.operations.reverse()
    const reversed = validateAbilitySpec(changedOrder, validOptions())
    expect(reversed.definitionHash).not.toBe(forward.definitionHash)
  })

  it('changes the hash when rules provenance, extension versions, or handler versions change', () => {
    const base = validateAbilitySpec(validSpec(), validOptions())
    const provenance = validateAbilitySpec(validSpec(), {
      ...validOptions(),
      rulesetVersion: {
        ...DEFAULT_ABILITY_SPEC_RULESET_VERSION,
        sourceDataSha256: 'b'.repeat(64),
      },
    })
    const extensionVersion = validateAbilitySpec(validSpec(), {
      ...validOptions(),
      extensionRegistry: extensionRegistry(2),
    })

    const handlerSpec = validSpec()
    ;(handlerSpec as { registeredHandlerId: string | null }).registeredHandlerId = 'healer-handler'
    const handlerOne = validateAbilitySpec(handlerSpec, {
      ...validOptions(),
      handlerRegistry: { resolve: id => ({ id, version: 1 }) },
    })
    const handlerTwo = validateAbilitySpec(handlerSpec, {
      ...validOptions(),
      handlerRegistry: { resolve: id => ({ id, version: 2 }) },
    })

    expect(provenance.definitionHash).not.toBe(base.definitionHash)
    expect(extensionVersion.definitionHash).not.toBe(base.definitionHash)
    expect(handlerTwo.definitionHash).not.toBe(handlerOne.definitionHash)
  })

  it('rejects unknown or malformed extensions rather than accepting arbitrary objects', () => {
    const unknown = validSpec()
    unknown.phases[1]!.operations[0]!.kind = 'execute-prose'
    expectDefinitionError(
      () => validateAbilitySpec(unknown, validOptions()),
      'unknown-extension',
      'abilitySpec.phases[1].operations[0].kind',
    )

    const malformed = validSpec()
    ;(malformed.phases[1]!.operations[0] as Record<string, unknown>).payload = 'arbitrary'
    expectDefinitionError(
      () => validateAbilitySpec(malformed, validOptions()),
      'invalid-extension',
      'abilitySpec.phases[1].operations[0]',
    )
  })

  it('accepts only closed ability event kinds and checkpoints for subscriptions', () => {
    const triggered = {
      ...validSpec(),
      modes: [{ id: 'mode-activated', kind: 'triggered' }],
      subscriptions: [{
        id: 'subscription-action',
        modeId: 'mode-activated',
        eventKind: 'action',
        checkpoint: 'after-commit',
        response: 'optional',
        priority: 1,
        oncePerCausalChain: false,
        predicate: null,
      }],
    }
    expect(validateAbilitySpec(triggered, validOptions()).spec.subscriptions).toHaveLength(1)

    const unknownEvent = structuredClone(triggered)
    unknownEvent.subscriptions[0]!.eventKind = 'creature.fainted'
    expectDefinitionError(
      () => validateAbilitySpec(unknownEvent, validOptions()),
      'invalid-definition',
      'abilitySpec.subscriptions.subscription-action.eventKind',
    )

    const unknownCheckpoint = structuredClone(triggered)
    unknownCheckpoint.subscriptions[0]!.checkpoint = 'after-client-animation'
    expectDefinitionError(
      () => validateAbilitySpec(unknownCheckpoint, validOptions()),
      'invalid-definition',
      'abilitySpec.subscriptions.subscription-action.checkpoint',
    )
  })

  it('enforces mode, targeting, cost-phase, phase-order, canonical identity, and handler invariants', () => {
    const triggered = validSpec()
    triggered.modes[0]!.kind = 'triggered'
    expectDefinitionError(
      () => validateAbilitySpec(triggered, validOptions()),
      'invalid-mode',
      'abilitySpec.modes.mode-activated',
    )

    const staticCost = validSpec()
    staticCost.modes[0]!.kind = 'static'
    expectDefinitionError(
      () => validateAbilitySpec(staticCost, validOptions()),
      'invalid-mode',
      'abilitySpec.modes.mode-activated',
    )

    const selections = validSpec()
    selections.targeting[0]!.maxSelections = 1
    expectDefinitionError(
      () => validateAbilitySpec(selections, validOptions()),
      'invalid-definition',
      'abilitySpec.targeting.target-self',
    )

    const costPhase = validSpec()
    costPhase.costs[0]!.phase = 'effect'
    expectDefinitionError(
      () => validateAbilitySpec(costPhase, validOptions()),
      'invalid-definition',
      'abilitySpec.costs.cost-scene.phase',
    )

    const phaseOrder = validSpec()
    phaseOrder.phases.reverse()
    expectDefinitionError(
      () => validateAbilitySpec(phaseOrder, validOptions()),
      'invalid-phase-order',
      'abilitySpec.phases[1]',
    )

    const unknownCanonical = validSpec()
    unknownCanonical.canonicalId = 'Homebrew Healer'
    unknownCanonical.presentation.displayName = 'Homebrew Healer'
    expectDefinitionError(
      () => validateAbilitySpec(unknownCanonical, validOptions()),
      'unknown-canonical-id',
      'abilitySpec.canonicalId',
    )

    const unknownHandler = validSpec()
    ;(unknownHandler as { registeredHandlerId: string | null }).registeredHandlerId = 'missing-handler'
    expectDefinitionError(
      () => validateAbilitySpec(unknownHandler, validOptions()),
      'unknown-handler',
      'abilitySpec.registeredHandlerId',
    )
  })

  it('requires capability dependency closure and rejects duplicates', () => {
    expectDefinitionError(
      () => validateAbilitySpec(validSpec(), {
        ...validOptions(),
        capabilityIds: ['foundation.two'],
      }),
      'missing-capability-dependency',
      'capabilityIds',
    )
    expectDefinitionError(
      () => validateAbilitySpec(validSpec(), {
        ...validOptions(),
        capabilityIds: ['foundation.one', 'foundation.one'],
      }),
      'duplicate-id',
      'capabilityIds',
    )
  })

  it('returns detached deeply frozen definitions', () => {
    const source = validSpec()
    const definition = validateAbilitySpec(source, validOptions())
    source.phases[1]!.operations[0]!.steps[0] = 'changed'

    expect(definition.spec.phases[1]!.operations[0]!.steps).toEqual(['second', 'first'])
    expect(Object.isFrozen(definition)).toBe(true)
    expect(Object.isFrozen(definition.spec)).toBe(true)
    expect(Object.isFrozen(definition.spec.phases[1]!.operations[0])).toBe(true)
    expect(Object.isFrozen(definition.extensionReferences)).toBe(true)
  })
})
