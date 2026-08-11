import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  type LivePlayCommandEnvelope,
  type LivePlayPatch,
} from '../../shared/livePlayCommands'
import { LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION, type LiveTableSnapshot } from '../../shared/liveTableSnapshot'
import { parseEncounterPresentationProjection } from '../../shared/encounterPresentation'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import { acceptedEncounterPresentationFromLivePlayCommand } from '../../server/domain/encounterPresentation/acceptedAdapters'
import { buildMapBackedEncounterWorkspace } from '../../server/domain/encounterWorkspace/mapAdapter'
import { projectMapBackedEncounterWorkspace } from '../../server/domain/encounterWorkspace/projection'
import { loadEncounterWorkspaceUseCase } from '../../server/useCases/loadEncounterWorkspace'
import type { PlayerProfile } from '../../shared/playerProfiles'
import { createEncounterDocument, parseEncounterDocument } from '../../shared/encounterDocuments/model'
import performanceBudgets from '../../data/encounter-workspace/performance-budgets.json'
import {
  ITEM_CHOICE_ACTOR_ID,
  ITEM_CHOICE_TARGET_ID,
  createItemChoiceMap,
  createItemChoiceTargetSheet,
  createItemChoiceTrainerSheet,
} from '../fixtures/moveAutomation/itemChoices'

const snapshotFixture = (): LiveTableSnapshot => {
  const map = {
    ...createItemChoiceMap(),
    activeScene: { name: 'Fixture duel', startedAt: 100 },
    initiative: {
      activeId: ITEM_CHOICE_ACTOR_ID,
      round: 2,
      manualOrderIds: [ITEM_CHOICE_ACTOR_ID, ITEM_CHOICE_TARGET_ID],
    },
    fieldEffects: { weather: [{ kind: 'rainy' as const, rounds: 3 }], terrains: [], rooms: [] },
    hazards: [{ kind: 'spikes' as const, x: 3, y: 0, z: 3, layer: 1 }],
    placements: createItemChoiceMap().placements.map((placement, index) => ({
      ...placement,
      initiative: index === 0 ? 18 : 12,
    })),
  }
  const trainer = { ...createItemChoiceTrainerSheet(), currentHp: 48, currentInjuries: 1, ap: { left: 4 } }
  const pokemon = createItemChoiceTargetSheet()
  const projection = buildEncounterPresentationProjection({
    role: 'gm',
    map,
    mapRevision: 4,
    pokemonSheets: [pokemon],
    trainerSheets: [trainer],
    generatedAt: 500,
  })
  return {
    schemaVersion: LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION,
    map,
    mapRevision: 4,
    interactionMode: 'live-play',
    interactionModeUpdatedAt: 400,
    pokemonSheets: [pokemon],
    trainerSheets: [trainer],
    encounterPresentation: projection,
  }
}

const acceptedHpChange = () => {
  const command = {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId: 'op_workspace_hp',
    mapSlug: 'durable-item-choice-arena',
    baseRevision: 4,
    type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
    scopes: [{ kind: 'token', placementId: ITEM_CHOICE_TARGET_ID, field: 'hp' }],
    payload: { placementId: ITEM_CHOICE_TARGET_ID, amount: -5 },
  } as LivePlayCommandEnvelope
  const patch = {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    type: LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
    mapSlug: command.mapSlug,
    revision: 5,
    scopes: command.scopes,
    payload: { placementId: ITEM_CHOICE_TARGET_ID, previous: 60, current: 55 },
  } as LivePlayPatch
  return acceptedEncounterPresentationFromLivePlayCommand({
    command,
    result: createLivePlayAcceptedResult({
      opId: command.opId,
      mapSlug: command.mapSlug,
      previousRevision: 4,
      revision: 5,
      patches: [patch],
    }),
    occurredAt: 500,
  })
}

describe('map-backed encounter workspace projection', () => {
  it('adapts current map, sheets, sides, initiative, scene, environment, and presentation facts', () => {
    const snapshot = snapshotFixture()
    const workspace = buildMapBackedEncounterWorkspace({
      snapshot,
      options: {
        audience: 'gm',
        controlledParticipantIds: [ITEM_CHOICE_ACTOR_ID, ITEM_CHOICE_TARGET_ID],
      },
    })
    expect(workspace).toMatchObject({
      schemaVersion: 1,
      source: { mapSlug: snapshot.map.slug, mapRevision: 4, generatedAt: 500 },
      viewer: { audience: 'gm', canUseDirector: true, canUseExactGeometry: true },
      scene: { active: true, name: 'Fixture duel', startedAt: 100 },
      turn: { round: 2, currentParticipantId: ITEM_CHOICE_ACTOR_ID },
      mapBackedLimitations: ['objectives', 'phases', 'stakes', 'notes', 'waves'],
    })
    expect(workspace.turn.entries.map(entry => [entry.participantId, entry.state])).toEqual([
      [ITEM_CHOICE_ACTOR_ID, 'current'],
      [ITEM_CHOICE_TARGET_ID, 'upcoming'],
    ])
    expect(workspace.sides.map(side => side.label)).toEqual(['Foes', 'Heroes'])
    expect(workspace.sides.every(side => side.symbol.length > 0)).toBe(true)
    expect(workspace.environment.map(entry => entry.kind)).toEqual(['hazard', 'weather'])
    expect(workspace.participants.find(value => value.participantId === ITEM_CHOICE_ACTOR_ID)).toMatchObject({
      displayName: 'Item Choice Trainer',
      kind: 'trainer',
      controlled: true,
      currentTurn: true,
      position: { x: 1, y: 0, z: 1 },
      footprint: { base: expect.any(Number), clearance: expect.any(Number) },
      hp: { current: 48, temporary: 0 },
      injuries: 1,
    })
    expect(workspace.offers.length).toBeGreaterThan(0)
    expect(workspace.objectives).toEqual([])
  })

  it('builds distinct GM, player-owner, public, and diagnostic structures', () => {
    const snapshot = snapshotFixture()
    const visible = [ITEM_CHOICE_ACTOR_ID, ITEM_CHOICE_TARGET_ID]
    const gm = projectMapBackedEncounterWorkspace({
      snapshot,
      policy: { audience: 'gm', hiddenParticipantCountsBySide: { foes: 2 } },
    })
    const player = projectMapBackedEncounterWorkspace({
      snapshot,
      policy: {
        audience: 'player-owner',
        visibleParticipantIds: visible,
        controlledParticipantIds: [ITEM_CHOICE_ACTOR_ID],
        canUseExactGeometry: true,
      },
    })
    const publicView = projectMapBackedEncounterWorkspace({
      snapshot,
      policy: { audience: 'public', visibleParticipantIds: visible, canUseExactGeometry: false },
    })
    const diagnostic = projectMapBackedEncounterWorkspace({
      snapshot,
      policy: { audience: 'diagnostic', hiddenParticipantCountsBySide: { foes: 2 } },
    })

    expect(gm.viewer).toMatchObject({ audience: 'gm', canUseDirector: true, canInspectDiagnostics: false })
    expect(gm.sides.find(side => side.sideId === 'foes')?.hiddenParticipantCount).toBe(2)
    expect(player.viewer.controlledParticipantIds).toEqual([ITEM_CHOICE_ACTOR_ID])
    expect(player.offers.length).toBeGreaterThan(0)
    expect(player.offers.every(offer => offer.actor.participantId === ITEM_CHOICE_ACTOR_ID)).toBe(true)
    expect(player.participants.find(value => value.participantId === ITEM_CHOICE_TARGET_ID)?.controlled).toBe(false)
    expect(publicView.viewer).toMatchObject({ audience: 'public', canUseDirector: false, canUseExactGeometry: false })
    expect(publicView.offers).toEqual([])
    expect(publicView.participants.every(participant => participant.position === null && participant.footprint === null)).toBe(true)
    expect(publicView.sides.every(side => side.hiddenParticipantCount === null)).toBe(true)
    expect(diagnostic.viewer).toMatchObject({ audience: 'diagnostic', canUseDirector: true, canInspectDiagnostics: true })
  })

  it('projects one private decision differently to GM, authorized responder, owner spectator, and public clients', () => {
    const base = snapshotFixture()
    const interactionId = 'pending:private-counter'
    const snapshot: LiveTableSnapshot = {
      ...base,
      encounterPresentation: parseEncounterPresentationProjection({
        ...base.encounterPresentation,
        pending: [{
          schemaVersion: 1,
          projection: 'gm',
          interactionId,
          mapSlug: base.map.slug,
          mapRevision: base.mapRevision,
          status: 'pending',
          source: {
            sourceKind: 'ability', canonicalId: 'private-counter', instanceId: null,
            displayName: 'Private Counter', referenceHref: null,
          },
          actor: base.encounterPresentation.offers[0]?.actor ?? null,
          prompt: 'Choose a private counter.',
          choices: [{
            schemaVersion: 1,
            choiceOfferId: 'choice-offer:private-counter',
            interactionId,
            mapSlug: base.map.slug,
            mapRevision: base.mapRevision,
            choiceId: 'counter',
            kind: 'branch',
            prompt: 'Choose a counter.',
            helpText: null,
            cardinality: { minimum: 1, maximum: 1 },
            ordering: 'server',
            options: [{
              optionId: 'option:secret-counter',
              label: 'Secret Counter Pattern',
              description: 'Owner-private mechanics.',
              disabled: false,
              unavailableReason: null,
              preview: { kind: 'none' },
            }],
            defaultOptionIds: [],
            requiresConfirmation: true,
            allowPass: true,
            allowCancel: false,
            expiresAt: null,
          }],
          responseIdentity: {
            interactionId,
            resolutionId: 'resolution:private-counter',
            windowId: 'counter',
            retryKey: 'retry:private-counter',
          },
          allowPass: true,
          allowCancel: true,
          expiresAt: null,
          recoveryActions: [],
          announcement: {
            announcementId: 'announcement:private-counter',
            priority: 'assertive',
            message: 'Choose a private counter.',
            dedupeKey: interactionId,
          },
        }],
      }),
    }
    const visible = [ITEM_CHOICE_ACTOR_ID, ITEM_CHOICE_TARGET_ID]
    const privatePending = snapshot.encounterPresentation.pending[0]
    if (!privatePending || privatePending.projection === 'public') throw new Error('Fixture pending view must be authorized.')
    const responderSnapshot: LiveTableSnapshot = {
      ...snapshot,
      encounterPresentation: parseEncounterPresentationProjection({
        ...snapshot.encounterPresentation,
        audience: 'responder-owner',
        pending: [{ ...privatePending, projection: 'responder-owner' }],
      }),
    }
    const gm = projectMapBackedEncounterWorkspace({ snapshot, policy: { audience: 'gm' } })
    const responder = projectMapBackedEncounterWorkspace({
      snapshot: responderSnapshot,
      policy: {
        audience: 'player-owner',
        ownerPresentationAudience: 'responder-owner',
        visibleParticipantIds: visible,
        controlledParticipantIds: [ITEM_CHOICE_ACTOR_ID],
        authorizedInteractionIds: [interactionId],
      },
    })
    const ownerSpectator = projectMapBackedEncounterWorkspace({
      snapshot: responderSnapshot,
      policy: {
        audience: 'player-owner',
        ownerPresentationAudience: 'actor-owner',
        visibleParticipantIds: visible,
        controlledParticipantIds: [ITEM_CHOICE_ACTOR_ID],
      },
    })
    const publicView = projectMapBackedEncounterWorkspace({
      snapshot,
      policy: { audience: 'public', visibleParticipantIds: visible },
    })

    expect(gm.pending[0]).toMatchObject({ projection: 'gm', choices: [{ kind: 'branch' }] })
    expect(responder.pending[0]).toMatchObject({ projection: 'responder-owner', choices: [{ kind: 'branch' }] })
    expect(JSON.stringify(responder.pending[0])).toContain('Secret Counter Pattern')
    expect(ownerSpectator.pending[0]).toMatchObject({ projection: 'public', outstandingChoiceCount: 1 })
    expect(publicView.pending[0]).toMatchObject({ projection: 'public', outstandingChoiceCount: 1 })
    expect(JSON.stringify(ownerSpectator.pending[0])).not.toContain('Secret Counter Pattern')
    expect(JSON.stringify(publicView.pending[0])).not.toContain('Secret Counter Pattern')
    expect(ownerSpectator.pending[0]).not.toHaveProperty('responseIdentity')
    expect(publicView.pending[0]).not.toHaveProperty('responseIdentity')
  })

  it('projects Trainer teams and reserve identities only to authorized owner/Director audiences', () => {
    const base = snapshotFixture()
    const snapshot: LiveTableSnapshot = {
      ...base,
      map: {
        ...base.map,
        placements: base.map.placements.map(placement => placement.id === ITEM_CHOICE_TARGET_ID
          ? { ...placement, sideId: 'heroes' }
          : placement),
      },
      pokemonSheets: [...base.pokemonSheets, {
        slug: 'reserve-eevee', nickname: 'Reserve Eevee', species: 'Eevee', level: 10, revision: 1,
      }],
      trainerSheets: base.trainerSheets.map(sheet => ({
        ...sheet,
        currentTeam: ['item-choice-target-sheet', 'reserve-eevee'],
        boxedPokemon: ['reserve-eevee'],
      })),
    }
    const gm = projectMapBackedEncounterWorkspace({ snapshot, policy: { audience: 'gm' } })
    const owner = projectMapBackedEncounterWorkspace({
      snapshot,
      policy: {
        audience: 'player-owner',
        visibleParticipantIds: [ITEM_CHOICE_ACTOR_ID, ITEM_CHOICE_TARGET_ID],
        controlledParticipantIds: [ITEM_CHOICE_ACTOR_ID],
      },
    })
    const publicView = projectMapBackedEncounterWorkspace({
      snapshot,
      policy: { audience: 'public', visibleParticipantIds: [ITEM_CHOICE_ACTOR_ID, ITEM_CHOICE_TARGET_ID] },
    })
    expect(gm.teams).toEqual([expect.objectContaining({
      trainerParticipantId: ITEM_CHOICE_ACTOR_ID,
      sideId: 'heroes',
      activeParticipantIds: [ITEM_CHOICE_TARGET_ID],
      reserves: [expect.objectContaining({ displayName: 'Reserve Eevee', location: 'party' })],
    })])
    expect(owner.teams).toEqual(gm.teams)
    expect(publicView.teams).toEqual([])
    expect(JSON.stringify(publicView)).not.toContain('Reserve Eevee')
  })

  it('requires explicit visibility for non-GM viewers and rejects control outside visibility', () => {
    const snapshot = snapshotFixture()
    expect(() => projectMapBackedEncounterWorkspace({ snapshot, policy: { audience: 'public' } })).toThrow(
      'requires an explicit visible participant set',
    )
    expect(() => projectMapBackedEncounterWorkspace({
      snapshot,
      policy: {
        audience: 'player-owner',
        visibleParticipantIds: [ITEM_CHOICE_TARGET_ID],
        controlledParticipantIds: [ITEM_CHOICE_ACTOR_ID],
      },
    })).toThrow('must be visible')
    expect(() => projectMapBackedEncounterWorkspace({
      snapshot,
      policy: {
        audience: 'public',
        visibleParticipantIds: [ITEM_CHOICE_TARGET_ID],
        hiddenParticipantCountsBySide: { heroes: 1 },
      },
    })).toThrow('GM/diagnostic-only')
  })

  it('redacts accepted facts and copy when a projected event references a hidden participant', () => {
    const snapshot = snapshotFixture()
    const accepted = acceptedHpChange()
    const withAccepted: LiveTableSnapshot = {
      ...snapshot,
      map: { ...snapshot.map, revision: 5 },
      mapRevision: 5,
      encounterPresentation: parseEncounterPresentationProjection({
        ...snapshot.encounterPresentation,
        mapRevision: 5,
        offers: [],
        passives: [],
        affordances: [],
        pending: [],
        accepted: [accepted],
      }),
    }
    const publicView = projectMapBackedEncounterWorkspace({
      snapshot: withAccepted,
      policy: {
        audience: 'public',
        visibleParticipantIds: [ITEM_CHOICE_ACTOR_ID],
        canUseExactGeometry: false,
      },
    })
    expect(publicView.participants.map(participant => participant.participantId)).toEqual([ITEM_CHOICE_ACTOR_ID])
    expect(publicView.accepted).toHaveLength(1)
    expect(publicView.accepted[0]?.headline.label).toBe('Encounter state changed.')
    expect(JSON.stringify(publicView.accepted[0])).not.toContain(ITEM_CHOICE_TARGET_ID)
    expect(JSON.stringify(publicView.accepted[0])).not.toContain('current: 55')
  })

  it('loads a role-aware player workspace with profile-owned control and a public mode with no control', () => {
    const snapshot = snapshotFixture()
    const profile = {
      schemaVersion: 1,
      id: 'profile_workspace1',
      displayName: 'Workspace Player',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'item-choice-trainer' }],
    } as PlayerProfile
    const player = loadEncounterWorkspaceUseCase({
      role: 'player', slug: snapshot.map.slug, playerProfile: profile,
    }, { loadSnapshot: () => snapshot })
    const publicView = loadEncounterWorkspaceUseCase({
      role: 'player', slug: snapshot.map.slug, playerProfile: profile, audience: 'public',
    }, { loadSnapshot: () => snapshot })
    expect(player.viewer).toMatchObject({ audience: 'player-owner', controlledParticipantIds: [ITEM_CHOICE_ACTOR_ID] })
    expect(player.participants.find(value => value.participantId === ITEM_CHOICE_ACTOR_ID)?.controlled).toBe(true)
    expect(player.offers.every(offer => offer.actor.participantId === ITEM_CHOICE_ACTOR_ID)).toBe(true)
    expect(publicView.viewer).toMatchObject({ audience: 'public', controlledParticipantIds: [], canUseExactGeometry: false })
    expect(publicView.offers).toEqual([])
    expect(publicView.participants.every(value => value.position === null && value.footprint === null)).toBe(true)
  })

  it('projects hidden participants, reserves, and waves only to Director authority', () => {
    const snapshot = snapshotFixture()
    const base = createEncounterDocument({
      encounterId: 'fixture-encounter',
      name: 'Hidden fixture',
      linkedMapSlug: snapshot.map.slug,
      recipe: 'ambush',
      now: 100,
    })
    const encounter = parseEncounterDocument({
      ...base,
      hiddenParticipantIds: [ITEM_CHOICE_TARGET_ID],
      reserves: [],
      waves: [{
        waveId: 'wave-one', label: 'Ambushers', status: 'ready',
        participantIds: [ITEM_CHOICE_TARGET_ID], reserveIds: [], revealOnDeploy: true,
      }],
      objectives: [
        { objectiveId: 'public-goal', label: 'Reach the gate', visibility: 'public', status: 'active', progress: 1, maximum: 3 },
        { objectiveId: 'secret-goal', label: 'Capture the witness', visibility: 'gm', status: 'active', progress: null, maximum: null },
      ],
      clocks: [
        { clockId: 'public-clock', label: 'Gate closes', visibility: 'public', status: 'active', progress: 1, maximum: 4 },
        { clockId: 'secret-clock', label: 'Ambush springs', visibility: 'gm', status: 'active', progress: 2, maximum: 3 },
      ],
      phases: [{ phaseId: 'public-phase', label: 'Pursuit', visibility: 'public', status: 'active', summary: 'Reach the gate.' }],
      activePhaseId: 'public-phase',
      stakes: { public: 'The gate may close.', gm: 'The witness will escape.' },
      notes: 'Private witness route.',
    })
    const profile = {
      schemaVersion: 1,
      id: 'profile_hidden_workspace',
      displayName: 'Workspace Player',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'item-choice-trainer' }],
    } as PlayerProfile
    const dependencies = {
      loadSnapshot: () => snapshot,
      loadEncounterDocument: () => encounter,
      findEncounterDocumentByMap: () => null,
    }
    const gm = loadEncounterWorkspaceUseCase({ role: 'gm', slug: encounter.encounterId }, dependencies)
    const player = loadEncounterWorkspaceUseCase({ role: 'player', slug: encounter.encounterId, playerProfile: profile }, dependencies)

    expect(gm.source).toMatchObject({ encounterId: encounter.encounterId, encounterRevision: 0 })
    expect(gm.participants.find(participant => participant.participantId === ITEM_CHOICE_TARGET_ID)?.hidden).toBe(true)
    expect(gm.director?.waves[0]?.participantIds).toEqual([ITEM_CHOICE_TARGET_ID])
    expect(gm.sides.reduce((total, side) => total + (side.hiddenParticipantCount ?? 0), 0)).toBe(1)
    expect(player.participants.map(participant => participant.participantId)).not.toContain(ITEM_CHOICE_TARGET_ID)
    expect(player.director).toBeNull()
    expect(player.objectives.map(objective => objective.objectiveId)).toEqual(['public-goal'])
    expect(player.clocks.map(clock => clock.clockId)).toEqual(['public-clock'])
    expect(player.phase?.phaseId).toBe('public-phase')
    expect(player.stakes).toBe('The gate may close.')
    expect(player.mapBackedLimitations).toEqual([])
    expect(JSON.stringify(player)).not.toContain('secret-goal')
    expect(JSON.stringify(player)).not.toContain('Ambush springs')
    expect(JSON.stringify(player)).not.toContain('Private witness route')
    expect(JSON.stringify(player)).not.toContain('wave-one')
    expect(JSON.stringify(player)).not.toContain(ITEM_CHOICE_TARGET_ID)
  })

  it('keeps a 256-participant map adapter projection inside the reviewed p95 budget', () => {
    const base = snapshotFixture()
    const placement = base.map.placements[1]!
    const placements = [base.map.placements[0]!, ...Array.from({ length: 255 }, (_, index) => ({
      ...placement,
      id: `scale-participant-${index}`,
      position: { x: index % 16, y: 0, z: Math.floor(index / 16) },
      initiative: 255 - index,
    }))]
    const snapshot: LiveTableSnapshot = {
      ...base,
      map: {
        ...base.map,
        dimensions: { x: 20, y: 2, z: 20 },
        placements,
        initiative: {
          ...base.map.initiative,
          activeId: placements[0]!.id,
          manualOrderIds: placements.map(value => value.id),
        },
      },
    }
    for (let index = 0; index < performanceBudgets.measurement.warmupRuns; index += 1) {
      projectMapBackedEncounterWorkspace({ snapshot, policy: { audience: 'gm' } })
    }
    const samples = Array.from({ length: performanceBudgets.measurement.measuredRuns }, () => {
      const startedAt = performance.now()
      const projected = projectMapBackedEncounterWorkspace({ snapshot, policy: { audience: 'gm' } })
      expect(projected.participants).toHaveLength(256)
      return performance.now() - startedAt
    }).sort((left, right) => left - right)
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!
    expect(p95).toBeLessThanOrEqual(performanceBudgets.runtime.adapterP95Ms)
  })

  it('blocks commands structurally during replay-gap reconciliation', () => {
    const workspace = projectMapBackedEncounterWorkspace({
      snapshot: snapshotFixture(),
      policy: { audience: 'gm' },
      connection: 'reconciling',
      replayGap: true,
    })
    expect(workspace.system).toMatchObject({
      connection: 'reconciling',
      replayGap: true,
      commandsBlocked: true,
    })
    expect(workspace.system.blockingMessage).toContain('authoritative encounter')
  })
})
