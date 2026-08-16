import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_MAP_COMMAND_TYPE_VALUES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  type LivePlayCommandEnvelope,
  type LivePlayPatch,
} from '../../shared/livePlayCommands'
import type { PendingMoveResponseWindowList } from '../../shared/moveAutomation/responseViews'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import {
  acceptedEncounterPresentationFromLivePlayCommand,
} from '../../server/domain/encounterPresentation/acceptedAdapters'
import {
  pendingEncounterInteractionFromAbilityView,
  pendingEncounterInteractionsFromMoveResponses,
} from '../../server/domain/encounterPresentation/pendingAdapters'
import {
  createItemChoiceMap,
  createItemChoiceTargetSheet,
  createItemChoiceTrainerSheet,
  ITEM_CHOICE_ACTOR_ID,
  ITEM_CHOICE_TARGET_ID,
} from '../fixtures/moveAutomation/itemChoices'
import { activeEquipmentState, activePokemonHeldEquipmentState } from '../fixtures/equipment'

describe('server encounter presentation projection', () => {
  it('projects cross-source actions, passives, inventory affordances, and GM management offers', () => {
    const projection = buildEncounterPresentationProjection({
      role: 'gm',
      map: createItemChoiceMap(),
      mapRevision: 4,
      pokemonSheets: [createItemChoiceTargetSheet()],
      trainerSheets: [createItemChoiceTrainerSheet()],
      generatedAt: 100,
    })
    const kinds = new Set(projection.offers.map(offer => offer.source.sourceKind))
    expect(kinds).toContain('move')
    expect(kinds).toContain('maneuver')
    expect(kinds).toContain('movement')
    expect(kinds).toContain('initiative')
    expect(kinds).toContain('field-effect')
    expect(projection.affordances.some(affordance => affordance.source.sourceKind === 'item')).toBe(true)
    const potion = projection.offers.find(offer => offer.source.sourceKind === 'item' && offer.source.canonicalId === 'Potion')
    expect(potion).toMatchObject({
      group: 'inventory',
      availability: { status: 'available' },
      intent: { input: 'choices' },
      sourceContextLabel: 'Item Choice Trainer · Medical Kit',
      costs: expect.arrayContaining([
        expect.objectContaining({ kind: 'standard-action', amount: 1, label: '1 Standard Action' }),
        expect.objectContaining({ kind: 'item', amount: 1, label: 'Consume 1 Potion' }),
      ]),
      source: { instanceId: 'item-instance:trainer:item-choice-trainer:medicalKit:private-potion-row' },
    })
    expect(potion?.costs.some(cost => cost.resourceId === 'item.restorative.target-next-turn-forfeit')).toBe(false)
    expect(potion?.selectionOptions?.find(option => option.value === ITEM_CHOICE_TARGET_ID)).toMatchObject({
      kind: 'participant', disabled: false, unavailableReason: null,
      description: expect.stringMatching(/HP restored.*Target forfeits next Standard \+ Shift/),
      costs: expect.arrayContaining([expect.objectContaining({
        kind: 'resource', label: 'Target forfeits next Standard + Shift',
      })]),
    })
    expect(potion?.selectionOptions?.find(option => option.value === ITEM_CHOICE_ACTOR_ID)).toMatchObject({
      disabled: true,
      unavailableReason: { code: 'target.invalid' },
      costs: expect.arrayContaining([expect.objectContaining({ kind: 'full-action', label: '1 Full Action' })]),
    })
    expect(projection.affordances.find(affordance => affordance.source.canonicalId === 'Potion')?.linkedOfferId)
      .toBe(potion?.offerId)
    expect(projection.offers.every(offer => offer.mapRevision === projection.mapRevision)).toBe(true)
    expect(projection.audience).toBe('gm')
  })

  it('keeps legal and full-HP restorative targets together with exact disabled copy', () => {
    const map = createItemChoiceMap()
    map.placements.push({
      id: 'item-choice-full-target', sheetKind: 'pokemon', sheetSlug: 'item-choice-full-sheet',
      position: { x: 3, y: 0, z: 1 }, sideId: 'foes',
    })
    const damaged = createItemChoiceTargetSheet()
    const full = {
      ...createItemChoiceTargetSheet(),
      slug: 'item-choice-full-sheet',
      nickname: 'Full Target',
      equipmentState: activePokemonHeldEquipmentState({
        ownerSlug: 'item-choice-full-sheet', canonicalItemIds: [],
      }),
      combat: { ...createItemChoiceTargetSheet().combat, currentHp: 78 },
    }
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4, pokemonSheets: [damaged, full],
      trainerSheets: [createItemChoiceTrainerSheet()], generatedAt: 100,
    })
    const potion = projection.offers.find(offer => offer.source.canonicalId === 'Potion')
    expect(potion?.availability.status).toBe('available')
    expect(potion?.selectionOptions?.find(option => option.value === ITEM_CHOICE_TARGET_ID)).toMatchObject({ disabled: false })
    expect(potion?.selectionOptions?.find(option => option.value === 'item-choice-full-target')).toMatchObject({
      disabled: true,
      description: expect.stringMatching(/78\/78 HP.*At full HP\./),
      unavailableReason: { code: 'target.invalid' },
    })
  })

  it('projects exact curable-condition previews and disables condition items with no applicable target', () => {
    const trainer = createItemChoiceTrainerSheet()
    trainer.inventory!.medicalKit!.push({ id: 'full-heal-row', name: 'Full Heal', qty: 1 })
    const poisoned = createItemChoiceTargetSheet()
    poisoned.combat = { ...poisoned.combat, conditions: ['Badly Poisoned', 'Confused', 'Slowed'] }
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map: createItemChoiceMap(), mapRevision: 4,
      pokemonSheets: [poisoned], trainerSheets: [trainer], generatedAt: 100,
    })
    const antidote = projection.offers.find(offer => offer.source.canonicalId === 'Antidote')
    expect(antidote?.availability).toMatchObject({ status: 'available' })
    expect(antidote?.selectionOptions?.find(option => option.value === ITEM_CHOICE_TARGET_ID)).toMatchObject({
      disabled: false,
      description: expect.stringContaining('Cures: Badly Poisoned'),
    })
    const fullHeal = projection.offers.find(offer => offer.source.canonicalId === 'Full Heal')
    const fullHealTarget = fullHeal?.selectionOptions?.find(option => option.value === ITEM_CHOICE_TARGET_ID)
    expect(fullHealTarget?.description).toContain('Cures: Badly Poisoned')
    expect(fullHealTarget?.description).not.toContain('Confused')
    expect(fullHealTarget?.description).not.toContain('Slowed')

    poisoned.combat = { ...poisoned.combat, conditions: ['Confused', 'Slowed'] }
    const unavailable = buildEncounterPresentationProjection({
      role: 'gm', map: createItemChoiceMap(), mapRevision: 4,
      pokemonSheets: [poisoned], trainerSheets: [trainer], generatedAt: 100,
    })
    const unavailableAntidote = unavailable.offers.find(offer => offer.source.canonicalId === 'Antidote')
    expect(unavailableAntidote?.availability).toMatchObject({ status: 'unavailable', reasons: [{ code: 'target.invalid' }] })
    expect(unavailableAntidote?.selectionOptions?.find(option => option.value === ITEM_CHOICE_TARGET_ID)).toMatchObject({
      disabled: true,
      description: expect.stringContaining('No condition is within this item’s reviewed cure scope.'),
      unavailableReason: { code: 'target.invalid' },
    })
  })

  it('projects the Medic Training exception from canonical edge identity', () => {
    const trainer = createItemChoiceTrainerSheet()
    trainer.edges = [{ name: 'Medic Training' }]
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map: createItemChoiceMap(), mapRevision: 4,
      pokemonSheets: [createItemChoiceTargetSheet()], trainerSheets: [trainer], generatedAt: 100,
    })
    const potion = projection.offers.find(offer => offer.source.canonicalId === 'Potion')!
    expect(potion.costs.some(cost => cost.label.includes('forfeits next'))).toBe(false)
    const target = potion.selectionOptions?.find(option => option.value === ITEM_CHOICE_TARGET_ID)
    expect(target?.description).not.toContain('forfeits next')
    expect(target?.costs?.some(cost => cost.resourceId === 'item.restorative.target-next-turn-forfeit')).toBe(false)
  })

  it('projects native Wonder Launcher X-Item delivery with AP, range, and no target forfeiture', () => {
    const trainer = createItemChoiceTrainerSheet()
    trainer.skills = { ...trainer.skills, medicineEd: { rankBonus: 3 } }
    trainer.inventory!.medicalKit!.push({ id: 'x-attack-row', name: 'X Attack', qty: 1 })
    trainer.equipmentState = activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: trainer.slug, slotId: 'mainHand', additionalSlotIds: ['offHand'],
      canonicalItemId: 'Wonder Launcher',
    })
    const map = createItemChoiceMap()
    map.placements.push({
      id: 'far-pokemon', sheetKind: 'pokemon', sheetSlug: 'far-pokemon-sheet',
      position: { x: 20, y: 0, z: 1 }, sideId: 'foes',
    })
    const far = {
      ...createItemChoiceTargetSheet(),
      slug: 'far-pokemon-sheet',
      nickname: 'Far Target',
      equipmentState: activePokemonHeldEquipmentState({
        ownerSlug: 'far-pokemon-sheet', canonicalItemIds: [],
      }),
    }
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 4,
      pokemonSheets: [createItemChoiceTargetSheet(), far], trainerSheets: [trainer], generatedAt: 100,
    })
    const launcher = projection.offers.find(offer => offer.intent.actionId.startsWith('item.use.wonder-launcher:'))
    expect(launcher).toMatchObject({
      source: { canonicalId: 'X Attack' },
      timing: { kind: 'standard' },
      availability: { status: 'available' },
      targeting: [{ rangeLabel: '8 m' }],
      costs: expect.arrayContaining([
        expect.objectContaining({ kind: 'action-points', amount: 1, label: '1 AP to activate Wonder Launcher' }),
        expect.objectContaining({ kind: 'item', amount: 1, label: 'Consume 1 X Attack' }),
      ]),
    })
    const nearTarget = launcher?.selectionOptions?.find(option => option.value === ITEM_CHOICE_TARGET_ID)
    expect(nearTarget).toMatchObject({ disabled: false, description: expect.stringContaining('target keeps its actions') })
    expect(nearTarget?.costs?.some(cost => cost.resourceId === 'item.restorative.target-next-turn-forfeit')).toBe(false)
    expect(launcher?.selectionOptions?.find(option => option.value === 'far-pokemon')).toMatchObject({
      disabled: true, unavailableReason: { code: 'target.out-of-range' },
    })
    expect(projection.offers.some(offer => offer.intent.actionId === 'equipment.action:equipment.wonder-launcher.apply')).toBe(false)
    expect(JSON.stringify(launcher)).not.toContain('equipped-item:v1:')
  })

  it('projects authoritative revival previews only for Fainted Pokémon targets', () => {
    const trainer = createItemChoiceTrainerSheet()
    trainer.inventory!.medicalKit!.push({ id: 'revive-row', name: 'Revive', qty: 1 })
    const conscious = createItemChoiceTargetSheet()
    const unavailable = buildEncounterPresentationProjection({
      role: 'gm', map: createItemChoiceMap(), mapRevision: 4,
      pokemonSheets: [conscious], trainerSheets: [trainer], generatedAt: 100,
    })
    const unavailableRevive = unavailable.offers.find(offer => offer.source.canonicalId === 'Revive')
    expect(unavailableRevive?.availability).toMatchObject({
      status: 'unavailable', reasons: [{ code: 'target.invalid' }],
    })
    expect(unavailableRevive?.selectionOptions?.find(option => option.value === ITEM_CHOICE_TARGET_ID)).toMatchObject({
      disabled: true,
      description: expect.stringContaining('Target is not Fainted.'),
      unavailableReason: { code: 'target.invalid' },
    })

    const fainted = createItemChoiceTargetSheet()
    fainted.combat = { ...fainted.combat, currentHp: 0, conditions: ['Fainted', 'Slowed'] }
    const available = buildEncounterPresentationProjection({
      role: 'gm', map: createItemChoiceMap(), mapRevision: 4,
      pokemonSheets: [fainted], trainerSheets: [trainer], generatedAt: 100,
    })
    const availableRevive = available.offers.find(offer => offer.source.canonicalId === 'Revive')
    expect(availableRevive?.availability).toMatchObject({ status: 'available' })
    expect(availableRevive?.selectionOptions?.find(option => option.value === ITEM_CHOICE_TARGET_ID)).toMatchObject({
      disabled: false,
      description: expect.stringMatching(/Revives at 20 HP.*Target forfeits next Standard \+ Shift/),
    })
  })

  it('fails item actions closed for legacy rows without stable identity while retaining an explicit affordance', () => {
    const trainer = createItemChoiceTrainerSheet()
    delete trainer.inventory?.medicalKit?.[0]?.id
    const projection = buildEncounterPresentationProjection({
      role: 'gm',
      map: createItemChoiceMap(),
      mapRevision: 4,
      pokemonSheets: [createItemChoiceTargetSheet()],
      trainerSheets: [trainer],
      generatedAt: 100,
    })
    expect(projection.offers.some(offer => offer.source.sourceKind === 'item' && offer.source.canonicalId === 'Potion')).toBe(false)
    expect(projection.affordances.find(affordance => affordance.source.canonicalId === 'Potion')).toMatchObject({
      linkedOfferId: null,
      availability: { status: 'unavailable', reasons: [{ code: 'action.parameters-required' }] },
    })
  })

  it('adopts current role-projected identities for accepted participant references', () => {
    const map = createItemChoiceMap()
    const command = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: 'op_identity1',
      mapSlug: map.slug,
      baseRevision: 3,
      type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      scopes: [{ kind: 'token', placementId: ITEM_CHOICE_ACTOR_ID, field: 'position' }],
      payload: { placementId: ITEM_CHOICE_ACTOR_ID, position: { x: 2, y: 0, z: 1 } },
    } as LivePlayCommandEnvelope
    const accepted = acceptedEncounterPresentationFromLivePlayCommand({
      command,
      result: createLivePlayAcceptedResult({
        opId: command.opId,
        mapSlug: map.slug,
        previousRevision: 3,
        revision: 4,
        patches: [],
      }),
    })
    expect(accepted.actor).toMatchObject({
      participantId: ITEM_CHOICE_ACTOR_ID,
      displayName: ITEM_CHOICE_ACTOR_ID,
      sheetKind: null,
    })

    const projection = buildEncounterPresentationProjection({
      role: 'gm',
      map,
      mapRevision: 4,
      pokemonSheets: [createItemChoiceTargetSheet()],
      trainerSheets: [createItemChoiceTrainerSheet()],
      generatedAt: 100,
    }, { acceptedPresentations: [accepted] })

    expect(projection.accepted[0]?.actor).toMatchObject({
      participantId: ITEM_CHOICE_ACTOR_ID,
      displayName: 'Item Choice Trainer',
      sheetKind: 'trainer',
      sideId: 'heroes',
    })
  })

  it('adapts every accepted live-play command type without source-specific presentation parsing', () => {
    for (const [index, type] of LIVE_PLAY_MAP_COMMAND_TYPE_VALUES.entries()) {
      const command = {
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        opId: `op_inventory${index}`,
        mapSlug: 'arena',
        baseRevision: index,
        type,
        scopes: [],
        payload: {
          placementId: ITEM_CHOICE_ACTOR_ID,
          moveName: 'Ember',
          abilityName: 'Static',
          maneuverName: 'Push',
          orderName: 'Agility Training',
          pokeballName: 'Poké Ball',
        },
      } as unknown as LivePlayCommandEnvelope
      const result = createLivePlayAcceptedResult({
        opId: command.opId,
        mapSlug: command.mapSlug,
        previousRevision: index,
        revision: index + 1,
        patches: [],
      })
      const presentation = acceptedEncounterPresentationFromLivePlayCommand({ command, result })
      expect(presentation.operationId).toBe(command.opId)
      expect(presentation.source.canonicalId).not.toBe('')
      expect(presentation.outcomes.length).toBeGreaterThan(0)
      expect(presentation.history.length).toBeGreaterThan(0)
      expect(presentation.announcements.length).toBeGreaterThan(0)
    }
  })

  it('adapts an accepted command to bounded generic outcome, change, VFX, history, and announcement facts', () => {
    const command = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: 'op_abcdefgh',
      mapSlug: 'arena',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      scopes: [{ kind: 'token', placementId: ITEM_CHOICE_TARGET_ID, field: 'hp' }],
      payload: { placementId: ITEM_CHOICE_TARGET_ID, amount: -5 },
    } as LivePlayCommandEnvelope
    const patch = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      type: LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
      mapSlug: 'arena',
      revision: 5,
      scopes: command.scopes,
      payload: {
        placementId: ITEM_CHOICE_TARGET_ID,
        previous: 60,
        current: 55,
      },
    } as LivePlayPatch
    const result = createLivePlayAcceptedResult({
      opId: command.opId,
      mapSlug: command.mapSlug,
      previousRevision: 4,
      revision: 5,
      patches: [patch],
    })
    const presentation = acceptedEncounterPresentationFromLivePlayCommand({
      command,
      result,
      occurredAt: 500,
    })
    expect(presentation.operationId).toBe(command.opId)
    expect(presentation.changes).toHaveLength(1)
    expect(presentation.changes[0]).toMatchObject({ kind: 'hp', participantId: ITEM_CHOICE_TARGET_ID })
    expect(presentation.outcomes).not.toHaveLength(0)
    expect(presentation.vfx).not.toHaveLength(0)
    expect(presentation.announcements[0]?.dedupeKey).toBe(`accepted:${command.opId}`)
    expect(presentation.history[0]?.occurredAt).toBe(500)
  })

  it('projects an authorized pending Ability without leaking its source to a responder', () => {
    const pending = pendingEncounterInteractionFromAbilityView({
      view: {
        schemaVersion: 1,
        kind: 'ability-pending-responder-view',
        resolutionId: 'resolution:ability',
        mapSlug: 'arena',
        revision: 4,
        expiresAt: 900,
        status: 'pending',
        window: {
          windowId: 'window:ability',
          phase: 'pre-effect',
          promptKey: 'ability.choose-response',
          options: [{ id: 'option:accept', presentationKey: 'Accept' }],
          allowPass: true,
        },
      },
      mapRevision: 4,
      participants: [],
    })
    expect(pending.projection).toBe('responder-owner')
    if (pending.projection === 'public') throw new Error('Expected an authorized Ability pending view.')
    expect(pending.source).toBeNull()
    expect(pending.actor).toBeNull()
    expect(pending.choices[0]?.options[0]?.optionId).toBe('option:accept')
    expect(JSON.stringify(pending)).not.toContain('canonicalId')
  })

  it('projects authorized pending move options through the generic choice/response identity', () => {
    const summary = {
      schemaVersion: 1 as const,
      resolutionId: 'resolution:ember',
      actorPlacementId: ITEM_CHOICE_ACTOR_ID,
      canonicalMoveId: 'Ember',
      phase: 'pre-hit' as const,
      status: 'pending' as const,
      outstandingWindowCount: 1,
      createdAt: 100,
      updatedAt: 101,
    }
    const authorized: PendingMoveResponseWindowList = {
      schemaVersion: 1,
      mapSlug: 'arena',
      windows: [{
        schemaVersion: 1,
        resolution: summary,
        window: {
          windowId: 'window:ember',
          kind: 'choice',
          phase: 'pre-hit',
          reasonCode: 'move.choose-branch',
          promptKey: 'move.choose-branch',
          options: [{ id: 'branch:yes', labelKey: 'Yes' }, { id: 'branch:no', labelKey: 'No' }],
          allowPass: true,
          priority: null,
        },
      }],
    }
    const [pending] = pendingEncounterInteractionsFromMoveResponses({
      mapSlug: 'arena',
      mapRevision: 4,
      summaries: [summary],
      authorized,
      participants: [],
      gm: true,
    })
    expect(pending?.projection).toBe('gm')
    if (!pending || pending.projection === 'public') throw new Error('Expected an authorized pending view.')
    expect(pending.choices[0]?.options.map(option => option.optionId)).toEqual(['branch:yes', 'branch:no'])
    expect(pending.responseIdentity).toMatchObject({
      resolutionId: summary.resolutionId,
      windowId: 'window:ember',
    })
    expect(pending.recoveryActions.map(action => action.action)).toEqual(['force-pass', 'cancel'])
  })
})
