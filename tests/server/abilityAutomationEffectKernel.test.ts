import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  AbilitySharedEffectValidationError,
  isAbilitySharedEffectNode,
} from '#shared/abilityAutomation/effects'
import {
  buildAuthoritativeAbilityContext,
} from '../../server/domain/abilityAutomation/context'
import {
  planAbilitySharedEffects,
  reduceAbilitySharedCombatStageEffects,
  resolveAbilitySharedSelector,
} from '../../server/domain/abilityAutomation/effectKernel'
import type { AbilitySpecV1Runtime } from '../../server/domain/abilityAutomation/registry'
import { validateAbilitySpec } from '../../server/domain/abilityAutomation/validateSpec'
import {
  createAbilityResolutionTraceForContext,
  traceAbilityCombatStageReduction,
} from '../../server/domain/abilityAutomation/trace'
import { appendAbilityResolutionTraceEvent } from '#shared/abilityAutomation/trace'
import {
  AbilityStatePlanConflictError,
  AbilityStatePlanValidationError,
  commitAbilityStatePlan,
  createAbilityStatePlan,
  type AbilityStatePlanAtomicStore,
} from '../../server/domain/abilityAutomation/statePlan'
import { redBlueEncounterStateFixture } from '../fixtures/moveAutomation/encounterSides'

const placement = (
  id: string,
  slug: string,
  x: number,
  sideId: string,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: slug,
  position: { x, y: 0, z: 0 },
  sideId,
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'ability-kernel-arena',
  name: 'Ability Kernel Arena',
  revision: 4,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', 0, 'red'),
    placement('target-token', 'target', 1, 'blue'),
    placement('ally-token', 'ally', 2, 'red'),
  ],
  lights: [],
  initiative: { activeId: 'actor-token', round: 1 },
  encounterState: redBlueEncounterStateFixture(),
})

const sheet = (slug: string, revision: number, stages: Record<string, number> = {}): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 20,
  revision,
  movelist: [],
  abilities: [{ name: slug === 'actor' ? 'Moxie' : 'Battle Armor' }],
  stats: { atk: { stage: stages.atk ?? 0 } },
  combatStages: { acc: stages.acc ?? 0 },
  combat: { currentHp: 50 },
})

const sharedStageNode = (overrides: Record<string, unknown> = {}) => ({
  kind: 'shared-effect',
  operation: {
    id: 'operation.raise-attack',
    kind: 'combat-stage',
    source: { kind: 'ability', id: 'ability.moxie' },
    recipients: { kind: 'selected-targets' },
    reasonCode: 'ability.moxie.raise-attack',
    payload: {
      action: 'modify',
      stage: 'atk',
      selectedStage: null,
      value: 1,
      stageSource: null,
      rounding: null,
    },
    ...overrides,
  },
})

const spec = (operation: unknown = sharedStageNode()) => ({
  schemaVersion: 1,
  canonicalId: 'Moxie',
  version: 1,
  modes: [{ id: 'mode-activated', kind: 'activated' }],
  subscriptions: [],
  targeting: [{
    id: 'target-token',
    modeId: 'mode-activated',
    kind: 'token',
    minSelections: 1,
    maxSelections: 1,
    selector: { kind: 'selected-targets' },
    predicate: null,
  }],
  preconditions: [{
    id: 'precondition.constant-arithmetic',
    modeId: 'mode-activated',
    predicate: {
      kind: 'comparison',
      operator: 'equal',
      left: {
        kind: 'arithmetic',
        operator: 'add',
        operands: [{ kind: 'constant', value: 1 }, { kind: 'constant', value: 1 }],
      },
      right: { kind: 'constant', value: 2 },
    },
    failureReasonCode: 'arithmetic-failed',
  }],
  costs: [],
  phases: [{
    modeId: 'mode-activated',
    phase: 'effect',
    operations: [operation],
  }],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Moxie',
    summaryKey: 'ability.moxie.summary',
    vfxKey: null,
    tags: ['combat-stage'],
  },
})

const runtimeFixture = (operation?: unknown): AbilitySpecV1Runtime => {
  const definition = validateAbilitySpec(spec(operation), {
    capabilityIds: ['runtime.abilityspec-v1'],
  })
  return {
    canonicalId: 'Moxie',
    kind: 'abilityspec-v1',
    version: 1,
    definitionHash: definition.definitionHash,
    sourceModule: 'server/domain/abilityAutomation/specs/moxie.ts',
    definition,
  }
}

const contextFixture = (overrides: {
  readonly runtime?: AbilitySpecV1Runtime
  readonly targetStages?: Record<string, number>
} = {}) => buildAuthoritativeAbilityContext({
  map: mapFixture(),
  pokemonSheets: new Map([
    ['actor', sheet('actor', 2)],
    ['target', sheet('target', 5, overrides.targetStages)],
    ['ally', sheet('ally', 3)],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  request: {
    canonicalId: 'Moxie',
    modeId: 'mode-activated',
    actorPlacementId: 'actor-token',
    targetPlacementIds: ['target-token'],
    triggeringEvent: null,
  },
  runtime: overrides.runtime ?? runtimeFixture(),
  resolutionId: 'resolution.kernel',
  random: () => 0.5,
  time: 2_000,
})

describe('AbilitySpec shared typed effect kernel', () => {
  it('validates shared selectors, predicates/expressions, and ability-native operations', () => {
    const definition = validateAbilitySpec(spec(), {
      capabilityIds: ['runtime.abilityspec-v1'],
    })
    const node = definition.spec.phases[0]!.operations[0]!

    expect(definition.extensionReferences).toEqual([
      { family: 'operation', kind: 'shared-effect', version: 1 },
      { family: 'predicate', kind: 'comparison', version: 1 },
      { family: 'selector', kind: 'selected-targets', version: 1 },
    ])
    expect(isAbilitySharedEffectNode(node)).toBe(true)
    expect(node).toMatchObject({
      kind: 'shared-effect',
      operation: {
        kind: 'combat-stage',
        source: { kind: 'ability', id: 'ability.moxie' },
      },
    })
    expect((node.operation as Record<string, unknown>).phase).toBeUndefined()
  })

  it('rejects fake move sources, move-usage operations, and malformed shared payloads', () => {
    expect(() => validateAbilitySpec(spec(sharedStageNode({
      source: { kind: 'move', id: 'move.fake' },
    })), { capabilityIds: ['runtime.abilityspec-v1'] })).toThrowError(expect.objectContaining({
      name: 'AbilitySpecDefinitionValidationError',
      code: 'invalid-extension',
    }))

    expect(() => validateAbilitySpec(spec(sharedStageNode({
      kind: 'usage',
      payload: { action: 'spend' },
    })), { capabilityIds: ['runtime.abilityspec-v1'] })).toThrowError(expect.objectContaining({
      code: 'invalid-extension',
    }))

    expect(() => validateAbilitySpec(spec(sharedStageNode({
      payload: { action: 'modify', stage: 'atk' },
    })), { capabilityIds: ['runtime.abilityspec-v1'] })).toThrowError()
    expect(AbilitySharedEffectValidationError).toBeTypeOf('function')
  })

  it('resolves shared selector composition in authoritative map order', () => {
    const context = contextFixture()
    expect(resolveAbilitySharedSelector(context, {
      kind: 'union',
      selectors: [
        { kind: 'selected-targets' },
        { kind: 'actor' },
        { kind: 'selected-targets' },
      ],
    })).toEqual(['actor-token', 'target-token'])
    expect(resolveAbilitySharedSelector(context, {
      kind: 'difference',
      source: { kind: 'candidate-targets' },
      exclude: { kind: 'selected-targets' },
    })).toEqual(['ally-token'])
  })

  it('plans recipients without emitting a synthetic move identity', () => {
    const effects = planAbilitySharedEffects(contextFixture())

    expect(effects.operations).toEqual([expect.objectContaining({
      phase: 'effect',
      recipientIds: ['target-token'],
      operation: expect.objectContaining({
        source: { kind: 'ability', id: 'ability.moxie' },
        recipients: { kind: 'selected-targets' },
      }),
    })])
  })

  it('reuses cap-aware stage reduction and revisioned state planning', () => {
    const context = contextFixture()
    const reduction = reduceAbilitySharedCombatStageEffects({ context })

    expect(reduction.operationResults).toEqual([expect.objectContaining({
      operationId: 'operation.raise-attack',
      operationKind: 'combat-stage',
      phase: 'effect',
      recipientIds: ['target-token'],
      outcome: 'applied',
    })])
    expect(reduction.plan.changes).toHaveLength(1)
    expect(context.budget.snapshot()).toMatchObject({ operations: 1, recipients: 1 })
    expect(reduction.plan.changes[0]).toMatchObject({
      kind: 'sheet-state',
      scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'target' },
      expectedRevision: 5,
      sourceOperationId: 'operation.raise-attack',
      reasonCode: 'ability.moxie.raise-attack',
      changedFields: ['combatStages'],
      previous: { revision: 5 },
      current: {
        revision: 6,
        updatedAt: 2_000,
        stats: { atk: { stage: 1 } },
        combatStages: { acc: 0 },
      },
    })
    expect((context.targets[0]!.sheet.sheet as CharacterSheet).revision).toBe(5)
    expect((context.targets[0]!.sheet.sheet as CharacterSheet).stats?.atk?.stage).toBe(0)
    expect((context.targets[0]!.sheet.sheet as CharacterSheet).combatStages).toEqual({ acc: 0 })
  })

  it('treats capped stage writes as no-op plans', () => {
    const reduction = reduceAbilitySharedCombatStageEffects({
      context: contextFixture({ targetStages: { atk: 6 } }),
    })

    expect(reduction.operationResults[0]).toMatchObject({ outcome: 'no-op' })
    expect(reduction.plan.changes).toEqual([])
    expect(reduction.plan.expectedRevisions).toEqual([])
  })

  it('joins typed writes, complete reads, trace, and rolls into one immutable state plan', () => {
    const context = contextFixture()
    const reduction = reduceAbilitySharedCombatStageEffects({ context })
    let trace = createAbilityResolutionTraceForContext({ context })
    trace = appendAbilityResolutionTraceEvent(trace, {
      kind: 'phase-transition',
      reasonCode: 'phase.effect',
      from: null,
      to: 'effect',
    })
    trace = traceAbilityCombatStageReduction(trace, reduction)
    const plan = createAbilityStatePlan({
      context,
      stateChanges: reduction.plan,
      trace,
    })

    expect(plan.runtime).toMatchObject({
      canonicalId: 'Moxie',
      modeId: 'mode-activated',
      version: 1,
      definitionHash: context.runtime.definitionHash,
    })
    expect(plan.reads).toEqual([
      { kind: 'map', slug: 'ability-kernel-arena', revision: 4 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'actor', revision: 2 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'target', revision: 5 },
    ])
    expect(plan.stateChanges.expectedRevisions).toContainEqual({
      kind: 'sheet',
      sheetKind: 'pokemon',
      sheetSlug: 'target',
      expectedRevision: 5,
    })
    expect(plan.rollLedger).toEqual([])
    expect(plan.trace.events.at(-1)).toMatchObject({
      kind: 'operation',
      phase: 'effect',
      operationId: 'operation.raise-attack',
    })
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.reads)).toBe(true)
  })

  it('checks all reads before applying state and audit in one transaction callback', () => {
    const context = contextFixture()
    const reduction = reduceAbilitySharedCombatStageEffects({ context })
    let trace = createAbilityResolutionTraceForContext({ context })
    trace = appendAbilityResolutionTraceEvent(trace, {
      kind: 'phase-transition',
      reasonCode: 'phase.effect',
      from: null,
      to: 'effect',
    })
    const plan = createAbilityStatePlan({
      context,
      stateChanges: reduction.plan,
      trace: traceAbilityCombatStageReduction(trace, reduction),
    })
    const calls: string[] = []
    const store: AbilityStatePlanAtomicStore = {
      transaction: callback => {
        calls.push('transaction:start')
        const result = callback({
          revisionFor: read => {
            calls.push(`read:${read.kind}:${read.slug}`)
            if (read.kind === 'map') return 4
            return read.slug === 'actor' ? 2 : 5
          },
          applyStateChanges: stateChanges => {
            calls.push(`apply:${stateChanges.changes.length}`)
          },
          persistAudit: audit => {
            calls.push(`audit:${audit.resolutionId}`)
          },
        })
        calls.push('transaction:commit')
        return result
      },
    }

    commitAbilityStatePlan(plan, store)
    expect(calls).toEqual([
      'transaction:start',
      'read:map:ability-kernel-arena',
      'read:sheet:actor',
      'read:sheet:target',
      'apply:1',
      'audit:resolution.kernel',
      'transaction:commit',
    ])
  })

  it('applies nothing when any consulted revision is stale', () => {
    const context = contextFixture()
    const reduction = reduceAbilitySharedCombatStageEffects({ context })
    let trace = createAbilityResolutionTraceForContext({ context })
    trace = appendAbilityResolutionTraceEvent(trace, {
      kind: 'phase-transition',
      reasonCode: 'phase.effect',
      from: null,
      to: 'effect',
    })
    const plan = createAbilityStatePlan({
      context,
      stateChanges: reduction.plan,
      trace: traceAbilityCombatStageReduction(trace, reduction),
    })
    let applied = false
    let audited = false
    const store: AbilityStatePlanAtomicStore = {
      transaction: callback => callback({
        revisionFor: read => read.kind === 'map' ? 4 : read.slug === 'actor' ? 2 : 6,
        applyStateChanges: () => { applied = true },
        persistAudit: () => { audited = true },
      }),
    }

    expect(() => commitAbilityStatePlan(plan, store)).toThrowError(AbilityStatePlanConflictError)
    expect(applied).toBe(false)
    expect(audited).toBe(false)
  })

  it('rejects untraced rolls, mismatched runtime traces, and writes without reads', () => {
    const rollContext = contextFixture()
    rollContext.random.roll({
      rollId: 'roll.untraced',
      parentEffectId: 'operation.raise-attack',
      reason: 'Untraced',
      formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
    })
    const rollReduction = reduceAbilitySharedCombatStageEffects({ context: rollContext })
    let rollTrace = createAbilityResolutionTraceForContext({ context: rollContext })
    rollTrace = appendAbilityResolutionTraceEvent(rollTrace, {
      kind: 'phase-transition',
      reasonCode: 'phase.effect',
      from: null,
      to: 'effect',
    })
    expect(() => createAbilityStatePlan({
      context: rollContext,
      stateChanges: rollReduction.plan,
      trace: rollTrace,
    })).toThrowError(expect.objectContaining({ code: 'trace-roll-mismatch' }))

    const context = contextFixture()
    const reduction = reduceAbilitySharedCombatStageEffects({ context })
    let trace = createAbilityResolutionTraceForContext({ context })
    trace = appendAbilityResolutionTraceEvent(trace, {
      kind: 'phase-transition',
      reasonCode: 'phase.effect',
      from: null,
      to: 'effect',
    })
    trace = traceAbilityCombatStageReduction(trace, reduction)
    const mismatchedTrace = JSON.parse(JSON.stringify(trace))
    mismatchedTrace.program.definitionHash = 'f'.repeat(64)
    expect(() => createAbilityStatePlan({
      context,
      stateChanges: reduction.plan,
      trace: mismatchedTrace,
    })).toThrowError(expect.objectContaining({ code: 'runtime-mismatch' }))

    const forgedExpectations = {
      ...reduction.plan,
      expectedRevisions: [
        ...reduction.plan.expectedRevisions,
        {
          kind: 'external-resource' as const,
          resourceKind: 'group-inventory' as const,
          resourceId: 'missing',
          expectedRevision: 0,
        },
      ],
    }
    expect(() => createAbilityStatePlan({
      context,
      stateChanges: forgedExpectations,
      trace,
    })).toThrowError(AbilityStatePlanValidationError)
  })
})
