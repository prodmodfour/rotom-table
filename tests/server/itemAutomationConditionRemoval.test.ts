import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  previewItemConditionRemoval,
  resolveItemConditionRemoval,
} from '../../server/domain/itemAutomation/conditionRemoval'
import { buildItemPendingDecision } from '../../server/domain/itemAutomation/pending'
import { planDeterministicItemOperation } from '../../server/domain/itemAutomation/planner'
import { parseItemSpec, type ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'

const pokemon = (conditions: readonly string[]): CharacterSheet => ({
  slug: 'condition-target', nickname: 'Condition Target', species: 'Fixture Species', level: 10,
  combat: { currentHp: 20, conditions: [...conditions] },
})

const trainer = (conditions: readonly string[]): TrainerSheet => ({
  slug: 'trainer-condition-target', name: 'Trainer Target', level: 10,
  currentHp: 20, conditions: [...conditions],
})

describe('authoritative item condition removal', () => {
  it('matches canonical listed aliases and removes all matching instances only', () => {
    const sheet = pokemon(['Badly Poisoned', 'Confused', 'Tripped'])
    const preview = previewItemConditionRemoval({
      spec: { mode: 'listed', conditionIds: ['Poisoned', 'Badly Poisoned'], selection: 'all-applicable' },
      sheetKind: 'pokemon', sheet,
    })
    expect(preview).toMatchObject({
      removableConditionIds: ['Badly Poisoned'], removableLabels: ['Badly Poisoned'],
      removableEntryCount: 1, hasApplicableCondition: true,
    })
    const result = resolveItemConditionRemoval({
      spec: { mode: 'listed', conditionIds: ['Poisoned', 'Badly Poisoned'], selection: 'all-applicable' },
      sheetKind: 'pokemon', sheet,
    })
    expect(result.removedEntries).toEqual(['Badly Poisoned'])
    expect(result.resultingConditions).toEqual(['Confused', 'Tripped'])
  })

  it('removes every applicable persistent condition while retaining volatile and Other conditions', () => {
    const result = resolveItemConditionRemoval({
      spec: { mode: 'persistent', conditionIds: [], selection: 'all-applicable' },
      sheetKind: 'trainer', sheet: trainer(['Burned', 'Paralysis', 'Confused', 'Fainted', 'Tripped']),
    })
    expect(result.removedConditionIds).toEqual(['Burned', 'Paralysis'])
    expect(result.resultingConditions).toEqual(['Confused', 'Fainted', 'Tripped'])
  })

  it('removes every volatile or all Status Affliction without curing Other conditions', () => {
    const sheet = pokemon(['Poisoned', 'Bad Sleep', 'Confused', 'Disabled: Tackle', 'Fainted', 'Slowed'])
    const volatile = resolveItemConditionRemoval({
      spec: { mode: 'volatile', conditionIds: [], selection: 'all-applicable' },
      sheetKind: 'pokemon', sheet,
    })
    expect(volatile.removedConditionIds).toEqual(['Bad Sleep', 'Confused', 'Disabled'])
    expect(volatile.resultingConditions).toEqual(['Poisoned', 'Fainted', 'Slowed'])

    const allStatus = resolveItemConditionRemoval({
      spec: { mode: 'all-status', conditionIds: [], selection: 'all-applicable' },
      sheetKind: 'pokemon', sheet,
    })
    expect(allStatus.resultingConditions).toEqual(['Fainted', 'Slowed'])
  })

  it('supports an exact canonical choose-one option and rejects stale or client-invented choices', () => {
    const spec = { mode: 'listed', conditionIds: ['Burned', 'Paralysis', 'Poisoned'], selection: 'choose-one' } as const
    const sheet = pokemon(['Burned', 'Paralysis'])
    expect(previewItemConditionRemoval({ spec, sheetKind: 'pokemon', sheet }).description)
      .toBe('Choose one to cure: Burned, Paralysis')
    expect(resolveItemConditionRemoval({
      spec, sheetKind: 'pokemon', sheet, selectedConditionIds: ['Burned'],
    }).resultingConditions).toEqual(['Paralysis'])
    expect(() => resolveItemConditionRemoval({
      spec, sheetKind: 'pokemon', sheet, selectedConditionIds: ['Poisoned'],
    })).toThrow('incomplete or no longer authorized')
    expect(() => resolveItemConditionRemoval({
      spec, sheetKind: 'pokemon', sheet, selectedConditionIds: ['Fainted'],
    })).toThrow('incomplete or no longer authorized')
  })

  it('derives chosen-condition options from the authoritative target and binds only the persisted option', () => {
    const base = {
      schemaVersion: 1 as const,
      canonicalId: 'Fixture Cure', aliases: [], implementationState: 'native' as const,
      contexts: ['encounter' as const], roles: ['usable' as const], timing: 'standard' as const,
      costs: [{ kind: 'action' as const, resourceId: 'standard', amount: 1, label: '1 Standard Action' }],
      prerequisites: [],
      targets: [{ targetId: 'target', kind: 'participant' as const, minimum: 1, maximum: 1, relationship: 'any' as const, rangeMeters: null, requiresLineOfSight: false }],
      choices: [{ choiceId: 'condition:cure', kind: 'condition' as const, minimum: 1, maximum: 1, optionSource: 'authority' as const, options: [], privateTo: 'actor-owner' as const }],
      consumption: { phase: 'accepted-use' as const, quantity: 1, reserveWhilePending: true, refundableOnCancel: true, reusable: false },
      effects: [{ effectId: 'cure', operation: 'remove-conditions' as const, conditionIds: ['Burned', 'Paralysis'], mode: 'listed' as const, selection: 'choose-one' as const }],
      duration: { kind: 'instant' as const, amount: null },
      privacy: { sourceInventory: 'actor-owner' as const, choices: 'actor-owner' as const, outcome: 'public' as const },
      presentation: { label: 'Fixture Cure', description: 'Choose a condition.', unavailableReason: null },
      evidence: { canonicalCatalogSha256: 'a'.repeat(64), canonicalRecordSha256: 'b'.repeat(64), canonicalEffectSha256: 'c'.repeat(64), reviewId: 'fixture-cure-v1', status: 'reviewed' as const },
      registeredHandlerId: 'item.native.v1' as const,
    }
    const definition: ItemRuntimeDefinition = {
      canonicalId: base.canonicalId, definitionSha256: 'd'.repeat(64), spec: parseItemSpec(base),
    }
    const command: UseItemCommandV1 = {
      schemaVersion: 1, operationId: 'op_chosen_condition_0001', context: 'encounter', offerId: 'offer:fixture-cure',
      sourceInstanceId: 'item-instance:trainer:ash:medicalKit:cure-row', actorParticipantId: 'ash-placement',
      actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
      source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'cure-row', expectedRevision: 3 },
      targetIds: ['target-placement'], choices: [],
      readSet: [
        { kind: 'map', id: 'arena', revision: 4 }, { kind: 'encounter', id: 'arena', revision: 4 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'condition-target', revision: 2 },
      ],
    }
    const targetSheet = { ...pokemon(['Burned', 'Paralysis', 'Confused']), revision: 2 }
    const preview = previewItemConditionRemoval({ spec: definition.spec.effects[0] as never, sheetKind: 'pokemon', sheet: targetSheet })
    const pending = buildItemPendingDecision({
      command, definition,
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'cure-row',
        instanceId: command.sourceInstanceId, canonicalItemId: definition.canonicalId,
        displayLabel: definition.canonicalId, quantity: 1, revision: 3,
        ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      legalTargets: [{
        targetId: 'target', participantId: 'target-placement', label: 'Condition Target',
        sheetKind: 'pokemon', sheetSlug: 'condition-target', description: preview.description,
        healingPreview: null, conditionRemovalPreview: preview, revivalPreview: null,
      }],
    })
    expect(pending.choices).toEqual(expect.arrayContaining([expect.objectContaining({
      choiceId: 'condition:cure', kind: 'condition',
      options: [{ optionId: 'Burned', label: 'Burned' }, { optionId: 'Paralysis', label: 'Paralysis' }],
    })]))
    const selectedCommand = { ...command, choices: [{ choiceId: 'condition:cure', optionIds: ['Paralysis'] }] }
    const plan = planDeterministicItemOperation({
      command: selectedCommand, definition,
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'cure-row',
        instanceId: command.sourceInstanceId, canonicalItemId: definition.canonicalId,
        displayLabel: definition.canonicalId, quantity: 1, revision: 3,
        ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{ participantId: 'target-placement', sheetKind: 'pokemon', sheetSlug: 'condition-target', revision: 2, sheet: targetSheet }],
      actorSheet: trainer([]),
    })
    expect(plan.operations.find(operation => operation.kind === 'condition')?.payload).toMatchObject({
      selection: 'choose-one', removedConditionIds: ['Paralysis'], removedEntries: ['Paralysis'],
      resultingConditions: ['Burned', 'Confused'],
    })
  })

  it('fails closed when no condition is applicable or a reviewed listed identity is unknown', () => {
    const preview = previewItemConditionRemoval({
      spec: { mode: 'listed', conditionIds: ['Burned'], selection: 'all-applicable' },
      sheetKind: 'pokemon', sheet: pokemon(['Confused']),
    })
    expect(preview).toMatchObject({ hasApplicableCondition: false, description: 'No applicable condition to cure' })
    expect(() => resolveItemConditionRemoval({
      spec: { mode: 'listed', conditionIds: ['Burned'], selection: 'all-applicable' },
      sheetKind: 'pokemon', sheet: pokemon(['Confused']),
    })).toThrow('no applicable condition')
    expect(() => previewItemConditionRemoval({
      spec: { mode: 'listed', conditionIds: ['Not Canonical'], selection: 'all-applicable' },
      sheetKind: 'pokemon', sheet: pokemon(['Burned']),
    })).toThrow('not canonical')
  })
})
