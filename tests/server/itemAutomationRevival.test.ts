import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { previewItemRevival } from '../../server/domain/itemAutomation/revival'
import { planDeterministicItemOperation } from '../../server/domain/itemAutomation/planner'
import { reduceItemOperationPlan } from '../../server/domain/itemAutomation/reducer'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { TabletopMap } from '~/types/map'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'

const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3,
  inventory: { medicalKit: [{ id: 'revive-row', name: 'Revive', qty: 2 }] },
})
const pokemon = (input: {
  readonly currentHp?: number
  readonly injuries?: number
  readonly conditions?: readonly string[]
} = {}): CharacterSheet => ({
  slug: 'fixture-fainted', nickname: 'Fainted Target', species: 'Fixture Species', level: 10, revision: 2,
  stats: { hp: { added: 10 } },
  combat: {
    currentHp: input.currentHp ?? 0,
    injuries: input.injuries ?? 0,
    conditions: [...(input.conditions ?? ['Fainted'])],
  },
})
const map = (): TabletopMap => ({
  schemaVersion: 2, slug: 'arena', name: 'Arena', revision: 4,
  dimensions: { x: 5, y: 3, z: 5 }, voxels: [], createdAt: 1, updatedAt: 10,
  placements: [
    { id: 'ash-placement', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 1, y: 0, z: 1 } },
    { id: 'target-placement', sheetKind: 'pokemon', sheetSlug: 'fixture-fainted', position: { x: 2, y: 0, z: 1 } },
  ],
  encounterState: {
    ...createEmptyEncounterState(),
    history: { ...createEmptyEncounterState().history, faintedPlacementIds: ['target-placement'] },
    turnResources: { 'ash-placement': createEncounterTurnResourceLedger({ placementId: 'ash-placement', round: 1 }) },
  },
  initiative: { activeId: 'ash-placement', round: 1 },
})
const command = (): UseItemCommandV1 => ({
  schemaVersion: 1, operationId: 'op_item_revive_plan01', context: 'encounter', offerId: 'offer:item:revive',
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:revive-row', actorParticipantId: 'ash-placement',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'revive-row', expectedRevision: 3 },
  targetIds: ['target-placement'], choices: [{ choiceId: 'target', optionIds: ['target-placement'] }],
  readSet: [
    { kind: 'map', id: 'arena', revision: 4 }, { kind: 'encounter', id: 'arena', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'fixture-fainted', revision: 2 },
  ],
})

const revivalEffect = () => {
  const effect = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Revive').spec.effects[0]
  if (!effect || effect.operation !== 'revive') throw new Error('Revive registry fixture is unavailable.')
  return effect
}

describe('authoritative item revival', () => {
  it('previews fixed revival against authoritative faint and clears only Fainted on reduction', () => {
    const target = pokemon({ currentHp: -12, conditions: ['Fainted', 'Slowed'] })
    target.combat!.statusAfflictions = 'Fainted; Slowed'
    const preview = previewItemRevival({ revival: revivalEffect().revival, sheetKind: 'pokemon', sheet: target })
    expect(preview).toMatchObject({
      calculationKind: 'fixed', currentHp: -12, requestedHp: 20, resultingHp: 20,
      capReducedAmount: 0, clearsFainted: true,
    })
    const plan = planDeterministicItemOperation({
      command: command(), definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Revive'),
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'revive-row',
        instanceId: command().sourceInstanceId, canonicalItemId: 'Revive', displayLabel: 'Revive',
        quantity: 2, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{ participantId: 'target-placement', sheetKind: 'pokemon', sheetSlug: 'fixture-fainted', revision: 2, sheet: target }],
      actorSheet: trainer(),
    })
    expect(plan.operations.find(operation => operation.kind === 'hp')?.payload).toMatchObject({
      action: 'revive', calculationKind: 'fixed', currentHp: -12, requestedHp: 20,
      resultingHp: 20, targetKind: 'pokemon', faintedState: 'require-and-clear',
    })
    expect(plan.receiptFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Revived at 20 HP; Fainted cleared.' }),
    ]))
    const reduced = reduceItemOperationPlan({
      plan, map: map(), sheets: new Map([['trainer:ash', trainer()], ['pokemon:fixture-fainted', target]]),
      groupInventory: null,
    })
    expect((reduced.sheets.get('pokemon:fixture-fainted') as CharacterSheet).combat).toMatchObject({
      currentHp: 20, conditions: ['Slowed'],
    })
    expect((reduced.sheets.get('pokemon:fixture-fainted') as CharacterSheet).combat?.statusAfflictions).toBeUndefined()
    expect(reduced.map?.encounterState?.turnResources['target-placement']?.oncePerTurnFlags)
      .toEqual([expect.objectContaining({ id: 'item.restorative.target-next-turn-forfeit' })])
    // Scene KO history remains immutable evidence; current fainted presentation
    // must use the now-positive HP and cleared Fainted condition.
    expect(reduced.map?.encounterState?.history.faintedPlacementIds).toEqual(['target-placement'])
  })

  it('accepts non-positive HP as authoritative Fainted even before a retained condition is normalized', () => {
    const target = pokemon({ currentHp: 0, conditions: [] })
    expect(previewItemRevival({ revival: revivalEffect().revival, sheetKind: 'pokemon', sheet: target }))
      .toMatchObject({ currentHp: 0, resultingHp: 20, clearsFainted: true })
  })

  it('uses the full formula maximum for relative revival and caps resulting HP after Injuries', () => {
    const relative = {
      amount: {
        kind: 'maximum-relative' as const, basis: 'full-formula-maximum-hp' as const,
        numerator: 1, denominator: 2, rounding: 'down' as const, minimum: 1,
      },
      cap: 'injury-adjusted-effective-maximum-hp' as const,
      targetKind: 'pokemon' as const,
      faintedState: 'require-and-clear' as const,
    }
    const target = pokemon({ injuries: 8 })
    // Formula max is 50; half is 25, while eight Injuries cap effective max at 10.
    expect(previewItemRevival({ revival: relative, sheetKind: 'pokemon', sheet: target })).toMatchObject({
      fullFormulaMaximumHp: 50, effectiveMaximumHp: 10, requestedHp: 25,
      resultingHp: 10, capReducedAmount: 15,
    })
  })

  it('rejects conscious, Trainer, and zero-cap targets', () => {
    expect(() => previewItemRevival({
      revival: revivalEffect().revival, sheetKind: 'pokemon',
      sheet: pokemon({ currentHp: 1, conditions: [] }),
    })).toThrow('Fainted Pokémon')
    expect(() => previewItemRevival({
      revival: revivalEffect().revival, sheetKind: 'trainer',
      sheet: { ...trainer(), currentHp: 0, conditions: ['Fainted'] },
    })).toThrow('Pokémon only')
    expect(() => previewItemRevival({
      revival: revivalEffect().revival, sheetKind: 'pokemon',
      sheet: pokemon({ injuries: 10 }),
    })).toThrow('no positive HP capacity')
  })

  it('fails closed rather than partially reviving one endpoint of an effective As One pair', () => {
    const owner = pokemon({ currentHp: 0, conditions: ['Fainted'] })
    owner.slug = 'calyrex'
    owner.capabilities = { other: ['As One'] }
    const mount = pokemon({ currentHp: 0, conditions: ['Fainted'] })
    mount.slug = 'glastrier'
    const sourceMap = map()
    sourceMap.placements[1] = {
      ...sourceMap.placements[1]!, sheetSlug: 'calyrex', id: 'target-placement',
    }
    sourceMap.placements.push({
      id: 'mount-placement', sheetKind: 'pokemon', sheetSlug: 'glastrier', position: { x: 3, y: 0, z: 1 },
    })
    const source = resolveEffectiveCapabilities({
      map: sourceMap, placement: sourceMap.placements[1]!, sheet: owner,
    }).instances.find(instance => instance.canonicalId === 'As One' && instance.effective)!
    sourceMap.encounterState = {
      ...sourceMap.encounterState!,
      capabilityRuntime: {
        ...sourceMap.encounterState!.capabilityRuntime!,
        links: [{
          id: 'as-one-link', kind: 'as-one-mount', ownerPlacementId: 'target-placement',
          participantPlacementIds: ['mount-placement'], capabilityInstanceId: source.instanceId,
          canonicalId: 'As One', configurationId: null, establishedAt: 10,
          sourceOperationId: 'as-one-source-operation',
        }],
      },
    }
    const asOneCommand = command()
    asOneCommand.readSet = [
      ...asOneCommand.readSet.filter(ref => ref.kind !== 'sheet' || ref.id !== 'fixture-fainted'),
      { kind: 'sheet', sheetKind: 'pokemon', id: 'calyrex', revision: 2 },
      { kind: 'sheet', sheetKind: 'pokemon', id: 'glastrier', revision: 2 },
    ]
    const plan = planDeterministicItemOperation({
      command: asOneCommand, definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Revive'),
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'revive-row',
        instanceId: command().sourceInstanceId, canonicalItemId: 'Revive', displayLabel: 'Revive',
        quantity: 2, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{ participantId: 'target-placement', sheetKind: 'pokemon', sheetSlug: 'calyrex', revision: 2, sheet: owner }],
      actorSheet: trainer(),
    })
    expect(() => reduceItemOperationPlan({
      plan, map: sourceMap,
      sheets: new Map([['trainer:ash', trainer()], ['pokemon:calyrex', owner], ['pokemon:glastrier', mount]]),
      groupInventory: null,
    })).toThrow('cross-capability HP state')
    expect(owner.combat?.currentHp).toBe(0)
    expect(mount.combat?.currentHp).toBe(0)
  })

  it('rejects stale or forged revival payloads before any sheet changes', () => {
    const target = pokemon()
    const plan = planDeterministicItemOperation({
      command: command(), definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Revive'),
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'revive-row',
        instanceId: command().sourceInstanceId, canonicalItemId: 'Revive', displayLabel: 'Revive',
        quantity: 2, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{ participantId: 'target-placement', sheetKind: 'pokemon', sheetSlug: 'fixture-fainted', revision: 2, sheet: target }],
      actorSheet: trainer(),
    })
    const forged = structuredClone(plan)
    const hp = forged.operations.find(operation => operation.kind === 'hp')!
    hp.payload.resultingHp = 999
    expect(() => reduceItemOperationPlan({
      plan: forged, map: map(), sheets: new Map([['trainer:ash', trainer()], ['pokemon:fixture-fainted', target]]),
      groupInventory: null,
    })).toThrow('revival resolution does not match authoritative target state')
    expect(target.combat?.currentHp).toBe(0)
    expect(target.combat?.conditions).toContain('Fainted')
  })
})
