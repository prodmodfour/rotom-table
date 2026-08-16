import { describe, expect, it } from 'vitest'
import {
  emptyEncounterPresentationProjection,
  parseEncounterPresentationProjection,
  type EncounterActionOffer,
} from '../../shared/encounterPresentation'
import type { ItemRuntimeDefinition, ItemRuntimeRegistry } from '#shared/itemAutomation/spec'
import { attachEncounterItemCommandTemplate } from '../../server/domain/itemAutomation/commandTemplate'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { declareEncounterActionUseCase } from '../../server/useCases/declareEncounterAction'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import { createItemChoiceMap, createItemChoiceTargetSheet, createItemChoiceTrainerSheet } from '../fixtures/moveAutomation/itemChoices'
import { activeEquipmentState } from '../fixtures/equipment'
import {
  FORM_CHANGE_POKEMON_PLACEMENT_ID,
  createFormChangeMap,
  createFormChangePokemon,
  createFormChangeTrainer,
} from '../fixtures/itemFormChanges'

const offer = (available = true): EncounterActionOffer => ({
  schemaVersion: 1,
  offerId: 'offer:server-authorized',
  mapSlug: 'arena',
  mapRevision: 7,
  actor: {
    participantId: 'actor:one', displayName: 'Pikachu', portraitUrl: null,
    sideId: null, sideLabel: null, sideAccent: null, sheetKind: 'pokemon', statusLabels: [],
  },
  source: {
    sourceKind: 'move', canonicalId: 'Ember', instanceId: null,
    displayName: 'Ember', referenceHref: '/moves/ember',
  },
  roles: ['activated-action'],
  group: 'attack', groupOrder: 0, offerOrder: 0,
  timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
  costs: [{ kind: 'standard-action', resourceId: null, amount: 1, label: '1 Standard Action' }],
  targeting: [{
    requirementId: 'target', kind: 'participant', minSelections: 1, maxSelections: 1,
    rangeLabel: 'Range 4', relationshipLabel: null, requiresLineOfSight: true,
    requiresSpatialInput: false,
  }],
  usage: { frequencyLabel: 'At-Will', remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
  availability: available
    ? { status: 'available', reasons: [] }
    : {
        status: 'unavailable',
        reasons: [{ code: 'usage.scene-exhausted', label: 'Already used this scene', sources: [], diagnosticDetail: null }],
      },
  presentation: { label: 'Ember', description: null, iconKey: 'source.move', tone: 'neutral' },
  intent: { actionId: 'move.declare', input: 'choices' },
})
const projection = (candidate = offer()) => parseEncounterPresentationProjection({
  ...emptyEncounterPresentationProjection({ mapSlug: 'arena', mapRevision: 7, audience: 'actor-owner' }),
  offers: [candidate],
})
const intent = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  intentId: 'intent:one',
  offerId: 'offer:server-authorized',
  mapSlug: 'arena',
  baseRevision: 7,
  actorParticipantId: 'actor:one',
  actionId: 'move.declare',
  selections: [],
  ...overrides,
})

describe('generic encounter action declaration authorization', () => {
  it('returns only the exact current server offer', () => {
    const result = declareEncounterActionUseCase({ role: 'player', intent: intent() }, {
      loadProjection: () => projection(),
    })
    expect(result.offerId).toBe('offer:server-authorized')
    expect(Object.isFrozen(result)).toBe(true)
  })

  it.each([
    ['stale revision', { baseRevision: 6 }],
    ['spoofed actor', { actorParticipantId: 'actor:other' }],
    ['spoofed action', { actionId: 'system.delete' }],
    ['unknown offer', { offerId: 'offer:unknown' }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => declareEncounterActionUseCase({ role: 'player', intent: intent(overrides) }, {
      loadProjection: () => projection(),
    })).toThrow()
  })

  it('attaches a private revision-bound command template only to an authorized item offer', () => {
    const map = createItemChoiceMap()
    const pokemon = createItemChoiceTargetSheet()
    const trainer = createItemChoiceTrainerSheet()
    const itemProjection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4, pokemonSheets: [pokemon], trainerSheets: [trainer], generatedAt: 100,
    })
    const itemOffer = itemProjection.offers.find(candidate => candidate.source.sourceKind === 'item' && candidate.source.canonicalId === 'Potion')!
    const result = declareEncounterActionUseCase({
      role: 'gm',
      intent: {
        schemaVersion: 1,
        intentId: 'intent:item-potion',
        offerId: itemOffer.offerId,
        mapSlug: map.slug,
        baseRevision: 4,
        actorParticipantId: itemOffer.actor.participantId,
        actionId: itemOffer.intent.actionId,
        selections: [],
      },
    }, {
      loadProjection: () => itemProjection,
      loadItemAuthority: () => ({ map, mapRevision: 4, pokemonSheets: [pokemon], trainerSheets: [trainer] }),
    })
    expect(result.itemCommand).toMatchObject({
      operationId: 'template:item-operation',
      offerId: itemOffer.offerId,
      sourceInstanceId: itemOffer.source.instanceId,
      actorSheet: { kind: 'trainer', slug: trainer.slug, expectedRevision: 3 },
      source: { kind: 'trainer', slug: trainer.slug, section: 'medicalKit', rowId: 'private-potion-row', expectedRevision: 3 },
    })
    expect(result.itemCommand).not.toHaveProperty('canonicalItemId')
    expect(result.itemCommand?.readSet).toEqual(expect.arrayContaining([
      { kind: 'sheet', sheetKind: 'trainer', id: trainer.slug, revision: 3 },
      { kind: 'sheet', sheetKind: 'pokemon', id: pokemon.slug, revision: 2 },
    ]))
  })

  it('attaches a bounded Mega Evolution command without exposing equipment or authority provenance', () => {
    const map = createFormChangeMap()
    const pokemon = createFormChangePokemon()
    const trainer = createFormChangeTrainer()
    const itemProjection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 7, pokemonSheets: [pokemon], trainerSheets: [trainer], generatedAt: 5_200,
    })
    const itemOffer = itemProjection.offers.find(candidate => candidate.intent.actionId === 'item.form-change.mega-evolve')!
    const result = declareEncounterActionUseCase({
      role: 'gm',
      intent: {
        schemaVersion: 1,
        intentId: 'intent:mega-evolution',
        offerId: itemOffer.offerId,
        mapSlug: map.slug,
        baseRevision: 7,
        actorParticipantId: itemOffer.actor.participantId,
        actionId: itemOffer.intent.actionId,
        selections: [{ choiceId: 'target', optionIds: [FORM_CHANGE_POKEMON_PLACEMENT_ID] }],
      },
    }, {
      loadProjection: () => itemProjection,
      loadItemAuthority: () => ({ map, mapRevision: 7, pokemonSheets: [pokemon], trainerSheets: [trainer] }),
    })
    expect(result.itemFormChangeCommand).toMatchObject({
      operationId: 'template:item-form-change',
      offerId: itemOffer.offerId,
      mapSlug: map.slug,
      baseRevision: 7,
      actorPlacementId: itemOffer.actor.participantId,
      targetPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
      abilityOptionId: null,
      readSet: [
        { kind: 'map', sheetKind: null, id: map.slug, revision: 7 },
        { kind: 'sheet', sheetKind: 'pokemon', id: pokemon.slug, revision: 4 },
        { kind: 'sheet', sheetKind: 'trainer', id: trainer.slug, revision: 3 },
      ],
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(pokemon.equipmentState!.instances[0]!.instanceId)
    expect(serialized).not.toContain(trainer.equipmentState!.instances[0]!.instanceId)
    expect(serialized).not.toContain('formRecordSha256')
    expect(serialized).not.toContain('canonicalRecordSha256')
  })

  it('binds Wonder Launcher delivery opaquely without exposing whole-item identity', () => {
    const map = createItemChoiceMap()
    const pokemon = createItemChoiceTargetSheet()
    const trainer = createItemChoiceTrainerSheet()
    trainer.skills = { ...trainer.skills, medicineEd: { rankBonus: 3 } }
    trainer.inventory!.medicalKit!.push({ id: 'x-attack-row', name: 'X Attack', qty: 1 })
    trainer.equipmentState = activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: trainer.slug, slotId: 'mainHand', additionalSlotIds: ['offHand'],
      canonicalItemId: 'Wonder Launcher',
    })
    const itemProjection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4, pokemonSheets: [pokemon], trainerSheets: [trainer], generatedAt: 100,
    })
    const itemOffer = itemProjection.offers.find(candidate => candidate.intent.actionId.startsWith('item.use.wonder-launcher:'))!
    const result = declareEncounterActionUseCase({
      role: 'gm',
      intent: {
        schemaVersion: 1, intentId: 'intent:wonder-launcher', offerId: itemOffer.offerId,
        mapSlug: map.slug, baseRevision: 4, actorParticipantId: itemOffer.actor.participantId,
        actionId: itemOffer.intent.actionId, selections: [],
      },
    }, {
      loadProjection: () => itemProjection,
      loadItemAuthority: () => ({ map, mapRevision: 4, pokemonSheets: [pokemon], trainerSheets: [trainer] }),
    })
    expect(result.itemCommand?.delivery).toMatchObject({
      kind: 'wonder-launcher', equipmentBindingId: expect.stringMatching(/^equipment-delivery:v1:[a-f0-9]{32}$/),
    })
    expect(JSON.stringify(result)).not.toContain('equipped-item:v1:')
    expect(JSON.stringify(result)).not.toContain('equipmentInstanceId')
  })

  it('adds campaign-clock read authority only for a reviewed daily item duration', () => {
    const map = createItemChoiceMap()
    const pokemon = createItemChoiceTargetSheet()
    const trainer = createItemChoiceTrainerSheet()
    const itemProjection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4, pokemonSheets: [pokemon], trainerSheets: [trainer], generatedAt: 100,
    })
    const potionOffer = itemProjection.offers.find(candidate => candidate.source.sourceKind === 'item'
      && candidate.source.canonicalId === 'Potion')!
    const base = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Potion')
    const definition: ItemRuntimeDefinition = {
      canonicalId: base.canonicalId,
      definitionSha256: 'd'.repeat(64),
      spec: { ...base.spec, contexts: ['encounter'], duration: { kind: 'daily', amount: 2 } },
    }
    const registry: ItemRuntimeRegistry = {
      definitions: [definition], aliases: new Map(),
      resolve: value => value === definition.canonicalId ? definition : null,
      require: value => value === definition.canonicalId ? definition : (() => { throw new Error('missing') })(),
    }
    const daily = attachEncounterItemCommandTemplate({
      offer: potionOffer, map, mapRevision: 4, pokemonSheets: [pokemon], trainerSheets: [trainer],
      campaignClock: { revision: 9 }, registry,
    })
    expect(daily.itemCommand?.readSet).toContainEqual({ kind: 'campaign-clock', id: 'campaign', revision: 9 })
    expect(attachEncounterItemCommandTemplate({
      offer: potionOffer, map, mapRevision: 4, pokemonSheets: [pokemon], trainerSheets: [trainer], registry,
    }).itemCommand).toBeUndefined()
  })

  it('rejects an unavailable offer with its safe server reason', () => {
    expect(() => declareEncounterActionUseCase({ role: 'gm', intent: intent() }, {
      loadProjection: () => projection(offer(false)),
    })).toThrow('Already used this scene')
  })
})
