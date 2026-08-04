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
    expect(projection.offers.every(offer => offer.mapRevision === projection.mapRevision)).toBe(true)
    expect(projection.audience).toBe('gm')
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
