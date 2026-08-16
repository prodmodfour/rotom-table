import { describe, expect, it } from 'vitest'
import { assertItemRuntimePlanConformance, ItemRuntimeConformanceError } from '../../server/domain/itemAutomation/conformance'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import type { ItemOperationPlanV1 } from '#shared/itemAutomation/operations'
import type { ItemOperationCompensationV1 } from '../../server/storage/itemOperationRepository'

const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Potion')
const plan = (): ItemOperationPlanV1 => ({
  schemaVersion: 1, operationId: 'op_item_conformance_0001', canonicalItemId: 'Potion',
  canonicalDefinitionSha256: definition.definitionSha256,
  readSet: [
    { kind: 'encounter', id: 'arena', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
  ],
  operations: [
    { operationId: 'inventory.consume', ordinal: 0, kind: 'inventory',
      aggregate: { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 }, subjectId: 'potion-row',
      payload: { action: 'consume', quantity: 1, sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row' }, label: 'Consume Potion' },
    { operationId: 'target.heal', ordinal: 1, kind: 'hp',
      aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 }, subjectId: 'pikachu-placement',
      payload: {
        action: 'heal', calculationKind: 'fixed', currentHp: 1, fullFormulaMaximumHp: 20,
        effectiveMaximumHp: 20, injuries: 0, requestedHealing: 20, effectiveHealing: 19,
        overheal: 1, resultingHp: 20, roll: null,
        cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve',
      }, label: 'Heal target' },
    { operationId: 'encounter.spend-action', ordinal: 2, kind: 'resource',
      aggregate: { kind: 'encounter', id: 'arena', revision: 4 }, subjectId: 'ash-placement',
      payload: { action: 'spend', resourceId: 'standard', amount: 1 }, label: 'Spend action' },
  ],
  receiptFacts: [],
})
const compensation = (): ItemOperationCompensationV1 => ({
  schemaVersion: 1,
  map: { slug: 'arena', beforeRevision: 4, afterRevision: 5, beforeMap: { revision: 4 }, afterMap: { revision: 5 } },
  sheets: [
    { kind: 'trainer', slug: 'ash', beforeRevision: 3, afterRevision: 4, beforeSheet: { revision: 3, qty: 2 }, afterSheet: { revision: 4, qty: 1 } },
    { kind: 'pokemon', slug: 'pikachu', beforeRevision: 2, afterRevision: 3, beforeSheet: { revision: 2, hp: 1 }, afterSheet: { revision: 3, hp: 21 } },
  ],
  groupInventory: null,
})

describe('item runtime presentation and reducer conformance guard', () => {
  it('accepts the exact reviewed runtime vocabulary and write set', () => {
    expect(() => assertItemRuntimePlanConformance({ definition, plan: plan(), compensation: compensation() })).not.toThrow()
  })

  it.each([
    ['identity-drift', () => ({ ...plan(), canonicalDefinitionSha256: 'f'.repeat(64) })],
    ['operation-drift', () => ({ ...plan(), operations: plan().operations.map((op, index) => index === 1 ? { ...op, ordinal: 4 } : op) })],
    ['payload-drift', () => ({ ...plan(), operations: plan().operations.map((op, index) => index === 1 ? { ...op, payload: { ...op.payload, clientHealing: 999 } } : op) })],
  ] as const)('fails closed on %s', (code, mutate) => {
    expect(() => assertItemRuntimePlanConformance({ definition, plan: mutate(), compensation: compensation() }))
      .toThrow(ItemRuntimeConformanceError)
    try { assertItemRuntimePlanConformance({ definition, plan: mutate(), compensation: compensation() }) }
    catch (error) { expect((error as ItemRuntimeConformanceError).code).toBe(code) }
  })

  it('rejects forged revival results and accepts exact structured consciousness evidence', () => {
    const reviveDefinition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Revive')
    const candidate = structuredClone(plan())
    candidate.canonicalItemId = reviveDefinition.canonicalId
    candidate.canonicalDefinitionSha256 = reviveDefinition.definitionSha256
    candidate.operations[1] = {
      operationId: 'target.revive', ordinal: 1, kind: 'hp',
      aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
      subjectId: 'pikachu-placement', label: 'Revive target',
      payload: {
        action: 'revive', calculationKind: 'fixed', currentHp: 0,
        fullFormulaMaximumHp: 27, effectiveMaximumHp: 27, injuries: 0,
        requestedHp: 20, resultingHp: 20, capReducedAmount: 0,
        cap: 'injury-adjusted-effective-maximum-hp', targetKind: 'pokemon',
        faintedState: 'require-and-clear',
      },
    }
    expect(() => assertItemRuntimePlanConformance({
      definition: reviveDefinition, plan: candidate, compensation: compensation(),
    })).not.toThrow()
    candidate.operations[1]!.payload.resultingHp = 21
    expect(() => assertItemRuntimePlanConformance({
      definition: reviveDefinition, plan: candidate, compensation: compensation(),
    })).toThrow('invalid resolved revival payload')
  })

  it('rejects forged condition removals and accepts exact canonical condition evidence', () => {
    const conditionDefinition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Full Heal')
    const candidate = structuredClone(plan())
    candidate.canonicalItemId = conditionDefinition.canonicalId
    candidate.canonicalDefinitionSha256 = conditionDefinition.definitionSha256
    candidate.operations[1] = {
      operationId: 'target.conditions', ordinal: 1, kind: 'condition',
      aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
      subjectId: 'pikachu-placement', label: 'Cure conditions',
      payload: {
        action: 'remove', mode: 'persistent', selection: 'all-applicable',
        currentConditions: ['Burned', 'Confused', 'Slowed'],
        removedConditionIds: ['Burned'], removedEntries: ['Burned'],
        resultingConditions: ['Confused', 'Slowed'],
      },
    }
    expect(() => assertItemRuntimePlanConformance({
      definition: conditionDefinition, plan: candidate, compensation: compensation(),
    })).not.toThrow()
    candidate.operations[1]!.payload = {
      ...candidate.operations[1]!.payload,
      removedConditionIds: ['Slowed'], removedEntries: ['Slowed'],
      resultingConditions: ['Burned', 'Confused'],
    }
    expect(() => assertItemRuntimePlanConformance({
      definition: conditionDefinition, plan: candidate, compensation: compensation(),
    })).toThrow('inconsistent authoritative condition evidence')
  })

  it('accepts exact X-Item stage/effect evidence and rejects forged results or source attribution', () => {
    const stageDefinition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('X Attack')
    const stagePlan = structuredClone(plan())
    stagePlan.canonicalItemId = stageDefinition.canonicalId
    stagePlan.canonicalDefinitionSha256 = stageDefinition.definitionSha256
    stagePlan.operations[1] = {
      operationId: 'target.stage', ordinal: 1, kind: 'stage',
      aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
      subjectId: 'pikachu-placement', label: 'Raise Attack',
      payload: {
        action: 'modify', stat: 'atk', previous: 5, requestedDelta: 2,
        appliedDelta: 1, current: 6, minimum: -6, maximum: 6, capped: true,
      },
    }
    expect(() => assertItemRuntimePlanConformance({
      definition: stageDefinition, plan: stagePlan, compensation: compensation(),
    })).not.toThrow()
    stagePlan.operations[1]!.payload.appliedDelta = 2
    expect(() => assertItemRuntimePlanConformance({
      definition: stageDefinition, plan: stagePlan, compensation: compensation(),
    })).toThrow('invalid resolved stage payload')

    const effectDefinition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Dire Hit')
    const effectPlan = structuredClone(plan())
    effectPlan.canonicalItemId = effectDefinition.canonicalId
    effectPlan.canonicalDefinitionSha256 = effectDefinition.definitionSha256
    effectPlan.operations[1] = {
      operationId: 'target.effect', ordinal: 1, kind: 'effect',
      aggregate: { kind: 'encounter', id: 'arena', revision: 4 },
      subjectId: 'pikachu-placement', label: 'Apply Dire Hit', payload: {
        action: 'apply-temporary-combat-effect', family: 'critical-range', amount: 2,
        duration: { kind: 'encounter', amount: null }, stackPolicy: 'replace', switchPolicy: 'expire',
        effect: {
          id: 'item.effect.critical-range.0123456789abcdef01234567', kind: 'capability',
          source: { operationId: 'item.use.0123456789abcdef01234567', moveId: 'item.dire-hit', placementId: 'ash-placement' },
          affected: { placementIds: ['pikachu-placement'], sideIds: [], cells: [] },
          createdRound: 1, createdTurn: 0, duration: { kind: 'encounter', remaining: null },
          stacks: 1, charges: null, stackPolicy: { kind: 'replace', maxStacks: null },
          chargePolicy: { kind: 'none', amount: null }, tags: ['item-combat-effect', 'item-family.critical-range'],
          payload: { capabilityId: 'item.dire-hit.critical-range', action: 'grant', value: 2 },
          dispel: { policy: 'matching-tags', tags: ['item-combat-effect'] },
          transferPolicy: 'expire', suppression: { sources: [] },
        },
      },
    }
    const effectCompensation = compensation()
    effectCompensation.sheets = [effectCompensation.sheets[0]!]
    expect(() => assertItemRuntimePlanConformance({
      definition: effectDefinition, plan: effectPlan, compensation: effectCompensation,
    })).not.toThrow()
    ;(effectPlan.operations[1]!.payload.effect as Record<string, unknown>).transferPolicy = 'retain'
    expect(() => assertItemRuntimePlanConformance({
      definition: effectDefinition, plan: effectPlan, compensation: effectCompensation,
    })).toThrow('invalid temporary combat-effect payload')
  })

  it('accepts exact Digestion Buff evidence and rejects forged Snack mechanics', () => {
    const snack = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Leftovers')
    const candidate = structuredClone(plan())
    candidate.canonicalItemId = snack.canonicalId
    candidate.canonicalDefinitionSha256 = snack.definitionSha256
    candidate.operations[1] = {
      operationId: 'target.digestion', ordinal: 1, kind: 'inventory',
      aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
      subjectId: 'pikachu-placement', label: 'Store Digestion Buff',
      payload: {
        action: 'store-digestion-buff', canonicalItemId: 'Leftovers', buffKind: 'turn-start-heal',
        amount: 1, denominator: 16, requiredPokemonType: null,
      },
    }
    expect(() => assertItemRuntimePlanConformance({
      definition: snack, plan: candidate, compensation: compensation(),
    })).not.toThrow()
    candidate.operations[1]!.payload.denominator = 8
    expect(() => assertItemRuntimePlanConformance({
      definition: snack, plan: candidate, compensation: compensation(),
    })).toThrow('invalid Digestion Buff payload')
  })

  it('accepts exact permanent-advancement evidence and rejects malformed choices, preview, or provenance', () => {
    const ppUp = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('PP Up')
    const candidate = structuredClone(plan())
    candidate.canonicalItemId = ppUp.canonicalId
    candidate.canonicalDefinitionSha256 = ppUp.definitionSha256
    candidate.operations[1] = {
      operationId: 'target.permanent', ordinal: 1, kind: 'campaign-fact',
      aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
      subjectId: 'pikachu', label: 'Apply PP Up', payload: {
        action: 'apply-permanent-advancement', advancementKind: 'pp-up',
        canonicalItemId: 'PP Up', canonicalDefinitionSha256: ppUp.definitionSha256,
        sourceOperationId: candidate.operationId, appliedAt: 1234,
        selectedChoices: [{
          choiceId: 'permanent-move',
          optionIds: ['move-choice:v1:11111111111111111111111111111111'],
        }],
        application: {
          sourceOperationId: candidate.operationId, canonicalItemId: 'PP Up',
          canonicalDefinitionSha256: ppUp.definitionSha256, kind: 'pp-up', stat: null,
          moveName: 'Spark', moveListIndex: 0, previousFrequency: 'EOT',
          resultingFrequency: 'At-Will', previousLevel: null, resultingLevel: null,
          appliedAt: 1234,
        },
        previewFacts: [{ label: 'Spark', value: 'EOT → At-Will', tone: 'positive' }],
      },
    }
    expect(() => assertItemRuntimePlanConformance({
      definition: ppUp, plan: candidate, compensation: compensation(),
    })).not.toThrow()

    const malformedChoice = structuredClone(candidate)
    ;(malformedChoice.operations[1]!.payload.selectedChoices as any[])[0]!.extra = true
    expect(() => assertItemRuntimePlanConformance({
      definition: ppUp, plan: malformedChoice, compensation: compensation(),
    })).toThrow('invalid permanent advancement payload')

    const malformedPreview = structuredClone(candidate)
    ;(malformedPreview.operations[1]!.payload.previewFacts as any[])[0]!.privateDigest = 'secret'
    expect(() => assertItemRuntimePlanConformance({
      definition: ppUp, plan: malformedPreview, compensation: compensation(),
    })).toThrow('invalid permanent advancement payload')

    const malformedProvenance = structuredClone(candidate)
    ;(malformedProvenance.operations[1]!.payload.application as Record<string, unknown>).moveListIndex = null
    expect(() => assertItemRuntimePlanConformance({
      definition: ppUp, plan: malformedProvenance, compensation: compensation(),
    })).toThrow('malformed permanent advancement provenance')
  })

  it('keeps operation and compensation conformance invariant across bounded deterministic quantities', () => {
    let state = 0x8f21_9ab3
    const next = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    for (let index = 0; index < 256; index += 1) {
      const quantity = (next() % 99) + 1
      const candidate = structuredClone(plan())
      candidate.operations[0]!.payload.quantity = quantity
      expect(() => assertItemRuntimePlanConformance({
        definition, plan: candidate, compensation: compensation(),
      })).not.toThrow()
      candidate.operations[0]!.payload.quantity = -(quantity)
      expect(() => assertItemRuntimePlanConformance({
        definition, plan: candidate, compensation: compensation(),
      })).toThrow(ItemRuntimeConformanceError)
    }
  })

  it('rejects compensation evidence that omits or adds an aggregate', () => {
    expect(() => assertItemRuntimePlanConformance({
      definition, plan: plan(), compensation: { ...compensation(), map: null },
    })).toThrow('write set does not exactly match')
  })
})
