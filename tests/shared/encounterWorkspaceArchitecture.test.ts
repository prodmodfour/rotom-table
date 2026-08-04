import { describe, expect, it } from 'vitest'
import type { AcceptedEncounterPresentation, EncounterPendingInteractionView } from '../../shared/encounterPresentation/contracts'
import {
  createEncounterAcceptedQueue,
  nextEncounterAcceptedPresentation,
  reduceEncounterAcceptedQueue,
} from '../../shared/encounterWorkspace/acceptedQueue'
import {
  encounterWorkspaceAdoptionCursor,
  parseEncounterWorkspaceDeepLink,
  planEncounterWorkspaceAdoption,
  reconcileEncounterWorkspaceDeepLink,
  serializeEncounterWorkspaceDeepLink,
} from '../../shared/encounterWorkspace/adoption'
import {
  arbitrateEncounterWorkspaceFocus,
  resolveEncounterWorkspacePriority,
} from '../../shared/encounterWorkspace/decisionPriority'
import type { EncounterWorkspaceViewModel } from '../../shared/encounterWorkspace/model'
import {
  DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES,
  encounterWorkspacePreferenceAttributes,
  loadEncounterWorkspacePreferences,
  parseEncounterWorkspacePreferences,
  saveEncounterWorkspacePreferences,
} from '../../shared/encounterWorkspace/preferences'
import {
  emptyEncounterWorkspaceSelection,
  reduceEncounterWorkspaceSelection,
} from '../../shared/encounterWorkspace/selection'
import {
  EncounterWorkspaceTransitionError,
  createEncounterWorkspaceMachine,
  transitionEncounterWorkspace,
} from '../../shared/encounterWorkspace/stateMachine'

const participant = (participantId: string, controlled = false) => ({
  participantId,
  displayName: participantId,
  kind: 'pokemon' as const,
  sheetSlug: participantId,
  sideId: 'heroes',
  sideLabel: 'Heroes',
  sideSymbol: '◆',
  sideAccent: '#123456',
  portraitUrl: null,
  controlled,
  currentTurn: participantId === 'actor:one',
  initiative: 12,
  position: { x: 1, y: 0, z: 1 },
  footprint: { base: 1, clearance: 1 },
  hp: { current: 10, maximum: 10, temporary: 0, state: 'healthy' as const },
  injuries: 0,
  conditions: [],
  resources: [],
  movement: [],
})

const workspaceFixture = (patch: Partial<EncounterWorkspaceViewModel> = {}): EncounterWorkspaceViewModel => ({
  schemaVersion: 1,
  source: {
    workspaceId: 'workspace:arena:7:gm',
    encounterId: 'arena',
    encounterRevision: null,
    mapSlug: 'arena',
    mapRevision: 7,
    presentationProjectionId: 'projection:7',
    generatedAt: 100,
  },
  viewer: {
    audience: 'gm',
    controlledParticipantIds: ['actor:one'],
    canUseDirector: true,
    canUseExactGeometry: true,
    canInspectDiagnostics: false,
  },
  system: {
    interactionMode: 'live-play',
    connection: 'connected',
    commandsBlocked: false,
    blockingMessage: null,
    replayGap: false,
  },
  scene: { active: true, name: 'Arena', startedAt: 1 },
  turn: {
    round: 2,
    currentParticipantId: 'actor:one',
    currentEntryIndex: 0,
    entries: [{ participantId: 'actor:one', initiative: 12, state: 'current', delayed: false }],
  },
  sides: [{ sideId: 'heroes', label: 'Heroes', status: 'active', symbol: '◆', accent: '#123456', participantIds: ['actor:one', 'target:one'], hiddenParticipantCount: 0 }],
  participants: [participant('actor:one', true), participant('target:one')],
  teams: [],
  environment: [],
  objectives: [],
  clocks: [],
  phase: null,
  stakes: null,
  director: null,
  offers: [],
  passives: [],
  affordances: [],
  pending: [],
  accepted: [],
  diagnostics: [],
  mapBackedLimitations: ['objectives', 'phases', 'stakes', 'notes', 'waves'],
  ...patch,
})

const accepted = (id: string, revision: number, sequence = 0): AcceptedEncounterPresentation => ({
  schemaVersion: 1,
  presentationId: id,
  operationId: `operation:${id}`,
  mapSlug: 'arena',
  previousRevision: Math.max(0, revision - 1),
  revision,
  source: { sourceKind: 'system', canonicalId: 'encounter', instanceId: null, displayName: 'Encounter', referenceHref: null },
  actor: null,
  affectedParticipants: [],
  outcomes: [],
  changes: [],
  explanations: [],
  causal: { groupId: `group:${id}`, parentPresentationId: null, depth: 0, sequence },
  headline: { label: `Result ${id}`, description: null, iconKey: null, tone: 'neutral' },
  splash: null,
  vfx: [],
  announcements: [],
  history: [],
  correction: null,
})

const authorizedPending = (id = 'pending:one'): EncounterPendingInteractionView => ({
  schemaVersion: 1,
  interactionId: id,
  mapSlug: 'arena',
  mapRevision: 7,
  projection: 'gm',
  status: 'pending',
  source: null,
  actor: null,
  prompt: 'Choose',
  announcement: { announcementId: `announce:${id}`, priority: 'assertive', message: 'Choose', dedupeKey: `choose:${id}` },
  responseIdentity: { interactionId: id, resolutionId: 'resolution:one', windowId: 'window:one', retryKey: 'retry:one' },
  choices: [],
  allowPass: true,
  allowCancel: true,
  expiresAt: null,
  recoveryActions: [],
})

describe('encounter workspace state machine and selection', () => {
  it('keeps current, selected, inspected, preview, tactical, and focus-origin state distinct', () => {
    const workspace = workspaceFixture()
    const visible = new Set(workspace.participants.map(value => value.participantId))
    let state = reduceEncounterWorkspaceSelection(emptyEncounterWorkspaceSelection(), {
      type: 'workspace-adopted', workspace,
    })
    state = reduceEncounterWorkspaceSelection(state, { type: 'actor-selected', participantId: 'target:one' }, visible)
    state = reduceEncounterWorkspaceSelection(state, { type: 'participant-inspected', participantId: 'actor:one' }, visible)
    state = reduceEncounterWorkspaceSelection(state, { type: 'target-previewed', participantIds: ['target:one'] }, visible)
    state = reduceEncounterWorkspaceSelection(state, {
      type: 'tactical-focus-opened',
      focus: { originKind: 'action', originId: 'offer:one', participantIds: ['target:one'], cells: [{ x: 2, y: 0, z: 1 }], mode: 'split' },
    }, visible)
    state = reduceEncounterWorkspaceSelection(state, { type: 'focus-origin-set', origin: { kind: 'action', id: 'button:offer' } }, visible)
    expect(state).toMatchObject({
      currentActorId: 'actor:one',
      selectedActorId: 'target:one',
      inspectedParticipantId: 'actor:one',
      targetPreviewParticipantIds: ['target:one'],
      tacticalFocus: { originId: 'offer:one', mode: 'split' },
      focusOrigin: { id: 'button:offer' },
    })
    expect(() => reduceEncounterWorkspaceSelection(state, { type: 'actor-selected', participantId: 'hidden:one' }, visible)).toThrow('not visible')
  })

  it('follows observe, choose, target, resolve, wait, and recovery transitions deterministically', () => {
    let state = createEncounterWorkspaceMachine(7)
    state = transitionEncounterWorkspace(state, { type: 'actor-selected', participantId: 'actor:one', focusOriginId: 'actor-button' })
    expect(state.phase).toBe('choose')
    state = transitionEncounterWorkspace(state, { type: 'action-chosen', offerId: 'offer:one', actorParticipantId: 'actor:one', targetMode: 'participant' })
    expect(state.phase).toBe('target')
    state = transitionEncounterWorkspace(state, { type: 'intent-submitted' })
    expect(state.phase).toBe('resolve')
    state = transitionEncounterWorkspace(state, { type: 'pending-received', interactionId: 'pending:one' })
    expect(state.phase).toBe('wait')
    state = transitionEncounterWorkspace(state, { type: 'accepted-received', presentationId: 'accepted:one' })
    state = transitionEncounterWorkspace(state, { type: 'presentation-settled' })
    expect(state.phase).toBe('observe')
    state = transitionEncounterWorkspace(state, { type: 'system-blocked', reason: 'reconnecting' })
    expect(state.phase).toBe('recover')
    expect(() => transitionEncounterWorkspace(state, { type: 'actor-selected', participantId: 'actor:one' })).toThrow(EncounterWorkspaceTransitionError)
    state = transitionEncounterWorkspace(state, { type: 'system-recovered', mapRevision: 8, currentActorId: 'target:one' })
    expect(state).toMatchObject({ phase: 'observe', mapRevision: 8, actorParticipantId: 'target:one' })
    expect(state.sequence).toBe(8)
  })

  it('rejects stale workspace adoption and makes replay gaps blocking recovery', () => {
    const state = createEncounterWorkspaceMachine(7)
    expect(() => transitionEncounterWorkspace(state, {
      type: 'workspace-adopted', mapRevision: 6, currentActorId: null, commandsBlocked: false, replayGap: false, primaryInteractionId: null,
    })).toThrow('stale')
    expect(transitionEncounterWorkspace(state, {
      type: 'workspace-adopted', mapRevision: 8, currentActorId: 'actor:one', commandsBlocked: true, replayGap: true, primaryInteractionId: null,
    })).toMatchObject({ phase: 'recover', recoveryReason: 'reconciling', mapRevision: 8 })
  })

  it('preserves state-machine invariants across a deterministic generated revision property', () => {
    for (let revision = 0; revision < 128; revision += 1) {
      const events = [
        { type: 'actor-selected', participantId: `actor:${revision}` } as const,
        { type: 'action-chosen', offerId: `offer:${revision}`, actorParticipantId: `actor:${revision}`, targetMode: revision % 2 === 0 ? 'participant' as const : null },
        { type: 'intent-submitted' } as const,
        { type: 'accepted-received', presentationId: `accepted:${revision}` } as const,
        { type: 'presentation-settled' } as const,
      ]
      let left = createEncounterWorkspaceMachine(revision)
      let right = createEncounterWorkspaceMachine(revision)
      for (const event of events) {
        left = transitionEncounterWorkspace(left, event)
        right = transitionEncounterWorkspace(right, event)
        expect(left).toEqual(right)
        expect(left.sequence).toBeGreaterThanOrEqual(1)
        expect(left.mapRevision).toBe(revision)
        expect(['observe', 'choose', 'target', 'wait', 'resolve', 'recover']).toContain(left.phase)
        if (left.phase === 'target') expect(left.targetMode).not.toBeNull()
        if (left.phase === 'recover') expect(left.recoveryReason).not.toBeNull()
      }
      expect(left).toMatchObject({ phase: 'observe', actionOfferId: null, acceptedPresentationId: null })
    }
  })
})

describe('encounter decision priority and focus arbitration', () => {
  it('prioritizes system recovery, authorized decisions, targeting, accepted results, actions, then turn state', () => {
    const machine = createEncounterWorkspaceMachine(7)
    expect(resolveEncounterWorkspacePriority(workspaceFixture(), machine).kind).toBe('current-actor')
    const choosing = transitionEncounterWorkspace(machine, { type: 'actor-selected', participantId: 'actor:one' })
    expect(resolveEncounterWorkspacePriority(workspaceFixture(), choosing).kind).toBe('action-choice')
    const targeting = transitionEncounterWorkspace(choosing, { type: 'action-chosen', offerId: 'offer:one', actorParticipantId: 'actor:one', targetMode: 'tactical' })
    expect(resolveEncounterWorkspacePriority(workspaceFixture(), targeting).kind).toBe('targeting')
    expect(resolveEncounterWorkspacePriority(workspaceFixture({ pending: [authorizedPending()] }), targeting).kind).toBe('authorized-decision')
    expect(resolveEncounterWorkspacePriority(workspaceFixture({ system: { ...workspaceFixture().system, commandsBlocked: true } }), targeting).kind).toBe('system-recovery')
  })

  it('moves focus once for a new primary decision and restores its origin after settlement', () => {
    const idle = resolveEncounterWorkspacePriority(workspaceFixture(), createEncounterWorkspaceMachine(7))
    const decision = resolveEncounterWorkspacePriority(workspaceFixture({ pending: [authorizedPending()] }), createEncounterWorkspaceMachine(7))
    expect(arbitrateEncounterWorkspaceFocus({ previous: idle, next: decision, focusOriginId: 'open-actions' })).toMatchObject({ moveFocus: true, reason: 'new-primary-decision' })
    expect(arbitrateEncounterWorkspaceFocus({ previous: decision, next: decision, focusOriginId: 'open-actions' })).toMatchObject({ moveFocus: false, reason: 'stable-primary' })
    expect(arbitrateEncounterWorkspaceFocus({ previous: decision, next: idle, focusOriginId: 'open-actions' })).toMatchObject({ moveFocus: true, restoreOriginId: 'open-actions' })
  })
})

describe('accepted queue, adoption, deep links, and preferences', () => {
  it('deduplicates local/realtime deliveries and preserves revision/causal order', () => {
    let state = createEncounterAcceptedQueue('arena', 7)
    state = reduceEncounterAcceptedQueue(state, { type: 'delivered', presentation: accepted('accepted:two', 9, 1), source: 'realtime' })
    state = reduceEncounterAcceptedQueue(state, { type: 'delivered', presentation: accepted('accepted:one', 8), source: 'local-http' })
    state = reduceEncounterAcceptedQueue(state, { type: 'delivered', presentation: accepted('accepted:one', 8), source: 'realtime' })
    expect(state.entries.map(entry => entry.presentation.presentationId)).toEqual(['accepted:one', 'accepted:two'])
    expect(state.entries[0]).toMatchObject({ deliverySource: 'local-http', firstDeliverySequence: 2, lastDeliverySequence: 3 })
    expect(nextEncounterAcceptedPresentation(state)?.presentationId).toBe('accepted:one')
    state = reduceEncounterAcceptedQueue(state, { type: 'settled', presentationId: 'accepted:one' })
    expect(nextEncounterAcceptedPresentation(state)?.presentationId).toBe('accepted:two')
    expect(() => reduceEncounterAcceptedQueue(state, {
      type: 'delivered', presentation: { ...accepted('accepted:one', 8), operationId: 'changed' }, source: 'replay',
    })).toThrow('changed across deliveries')
  })

  it('replaces history after a replay gap while preserving settlement for surviving identities', () => {
    let state = createEncounterAcceptedQueue('arena', 7)
    state = reduceEncounterAcceptedQueue(state, { type: 'delivered', presentation: accepted('accepted:one', 8), source: 'realtime' })
    state = reduceEncounterAcceptedQueue(state, { type: 'settled', presentationId: 'accepted:one' })
    state = reduceEncounterAcceptedQueue(state, {
      type: 'snapshot-adopted', mapSlug: 'arena', mapRevision: 9, presentations: [accepted('accepted:one', 8), accepted('accepted:two', 9)], replace: true,
    })
    expect(state.entries.map(entry => [entry.presentation.presentationId, entry.settled])).toEqual([
      ['accepted:one', true], ['accepted:two', false],
    ])
  })

  it('plans exact duplicate, projection-only, newer, replay-gap, and mismatched-map adoption', () => {
    const currentWorkspace = workspaceFixture()
    const cursor = encounterWorkspaceAdoptionCursor(currentWorkspace, ['intent:one'])
    expect(planEncounterWorkspaceAdoption({ current: cursor, incoming: currentWorkspace, source: 'tab-echo', echoedIntentIds: ['intent:one'] })).toMatchObject({
      kind: 'ignore', reason: 'exact-duplicate', settlePendingIntentIds: ['intent:one'],
    })
    expect(planEncounterWorkspaceAdoption({
      current: cursor,
      incoming: workspaceFixture({ source: { ...currentWorkspace.source, presentationProjectionId: 'projection:owner' } }),
      source: 'reconnect',
    })).toMatchObject({ kind: 'adopt', reason: 'projection-changed', replaceAcceptedHistory: false })
    expect(planEncounterWorkspaceAdoption({
      current: cursor,
      incoming: workspaceFixture({ source: { ...currentWorkspace.source, mapRevision: 8 } }),
      source: 'reconnect',
    })).toMatchObject({ kind: 'adopt', reason: 'newer-authority' })
    expect(planEncounterWorkspaceAdoption({
      current: cursor,
      incoming: workspaceFixture({ system: { ...currentWorkspace.system, replayGap: true, commandsBlocked: true } }),
      source: 'replay-gap',
    })).toMatchObject({ kind: 'adopt', reason: 'replay-gap-replacement', clearOptimisticOutbox: true })
    expect(planEncounterWorkspaceAdoption({
      current: cursor,
      incoming: workspaceFixture({ source: { ...currentWorkspace.source, mapSlug: 'other' } }),
      source: 'back-forward',
    })).toMatchObject({ kind: 'reject', reason: 'map-mismatch' })
  })

  it('round-trips and authorization-reconciles deep links without revealing hidden identities', () => {
    const raw = new URLSearchParams('participant=actor%3Aone&decision=pending%3Aone&history=accepted%3Aone&tactical=1')
    const link = parseEncounterWorkspaceDeepLink(raw)
    expect(serializeEncounterWorkspaceDeepLink(link).toString()).toBe(raw.toString())
    const workspace = workspaceFixture({ pending: [authorizedPending()], accepted: [accepted('accepted:one', 7)] })
    expect(reconcileEncounterWorkspaceDeepLink(link, workspace)).toMatchObject({ ...link, rejectedKeys: [] })
    const rejected = reconcileEncounterWorkspaceDeepLink(parseEncounterWorkspaceDeepLink(new URLSearchParams('participant=hidden%3Aone&decision=private%3Aone&tactical=1')), workspaceFixture({ viewer: { ...workspace.viewer, canUseExactGeometry: false } }))
    expect(rejected).toMatchObject({ participantId: null, interactionId: null, tactical: false })
    expect(rejected.rejectedKeys).toEqual(['participant', 'decision', 'tactical'])
  })

  it('persists only bounded versioned presentation preferences and safely defaults malformed storage', () => {
    const parsed = parseEncounterWorkspacePreferences({
      ...DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES,
      density: 'compact',
      layout: 'table-display',
      rosterWidthPx: 9999,
      secretMapState: { hp: 1 },
    })
    expect(parsed.density).toBe('compact')
    expect(parsed.rosterWidthPx).toBe(DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES.rosterWidthPx)
    expect(parsed).not.toHaveProperty('secretMapState')
    expect(encounterWorkspacePreferenceAttributes(parsed)).toMatchObject({
      'data-rt-density': 'compact',
      'data-rt-layout': 'table-display',
    })
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
    expect(saveEncounterWorkspacePreferences(storage, parsed)).toBe(true)
    expect(loadEncounterWorkspacePreferences(storage)).toEqual(parsed)
    values.set('rotom-table:encounter-workspace-preferences:v1', '{broken')
    expect(loadEncounterWorkspacePreferences(storage)).toEqual(DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES)
  })
})
