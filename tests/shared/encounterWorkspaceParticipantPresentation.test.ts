import { describe, expect, it } from 'vitest'
import type { AcceptedEncounterPresentation } from '../../shared/encounterPresentation/contracts'
import type { EncounterWorkspaceParticipant } from '../../shared/encounterWorkspace/model'
import {
  acceptedParticipantPresentationStates,
  groupEncounterWorkspaceParticipants,
  workspaceParticipantSummary,
} from '../../shared/encounterWorkspace/participantPresentation'

const participant = (id: string, patch: Partial<EncounterWorkspaceParticipant> = {}): EncounterWorkspaceParticipant => ({
  participantId: id,
  kind: 'pokemon',
  sheetSlug: id,
  displayName: id,
  roleLabel: 'Rattata',
  portraitUrl: null,
  side: { id: 'wild', label: 'Wild pack', symbol: '▲', color: '#8f6c4b' },
  onMap: true,
  reserve: false,
  hidden: false,
  currentTurn: false,
  controlled: false,
  initiative: 10,
  position: { x: 1, y: 0, z: 1 },
  footprint: { base: 1, clearance: 1 },
  hp: { current: 12, maximum: 20, temporary: 2 },
  injuries: 1,
  conditions: ['Poisoned'],
  resources: [{ id: 'movement', label: 'Movement', current: 3, maximum: 5 }],
  fainted: false,
  ...patch,
})

const accepted = (input: {
  id: string
  participantId: string
  correction?: boolean
}): AcceptedEncounterPresentation => ({
  schemaVersion: 1,
  presentationId: input.id,
  operationId: `operation:${input.id}`,
  mapSlug: 'arena',
  previousRevision: 1,
  revision: 2,
  source: { sourceKind: 'system', canonicalId: 'encounter', instanceId: null, displayName: 'Encounter', referenceHref: null },
  actor: null,
  affectedParticipants: [{
    participantId: input.participantId,
    displayName: input.participantId,
    portraitUrl: null,
    sideId: 'wild',
    sideLabel: 'Wild pack',
    sideAccent: null,
    sheetKind: 'pokemon',
    statusLabels: [],
  }],
  outcomes: [{ outcomeId: `outcome:${input.id}`, kind: 'hit', participantId: input.participantId, label: 'Lost 5 HP', tone: 'danger', preventedBy: [] }],
  changes: [],
  explanations: [],
  causal: { groupId: `group:${input.id}`, parentPresentationId: null, depth: 0, sequence: 0 },
  headline: { label: 'Damage resolved', description: null, iconKey: null, tone: 'danger' },
  splash: null,
  vfx: [],
  announcements: [],
  history: [],
  correction: input.correction
    ? { correctionId: `correction:${input.id}`, correctsPresentationId: 'accepted:prior', reasonLabel: 'GM correction', rollbackChangeIds: [] }
    : null,
})

describe('encounter participant presentation', () => {
  it('maps complete participant anatomy without mutating workspace facts', () => {
    const source = participant('wild:one', { currentTurn: true, controlled: true })
    const summary = workspaceParticipantSummary(source)
    expect(summary).toMatchObject({
      id: 'wild:one',
      name: 'wild:one',
      role: 'Rattata',
      side: { id: 'wild', label: 'Wild pack', symbol: '▲' },
      hp: { current: 12, maximum: 20, temporary: 2 },
      injuries: 1,
      conditions: ['Poisoned'],
      resources: [{ id: 'movement', current: 3, maximum: 5 }],
      currentTurn: true,
      controlled: true,
    })
    expect(source.hp).toEqual({ current: 12, maximum: 20, temporary: 2 })
  })

  it('groups eligible wild participants for presentation while preserving individual identities and expansion data', () => {
    const values = [
      participant('wild:one'),
      participant('wild:two'),
      participant('wild:three'),
      participant('hero:one', { controlled: true, side: { id: 'heroes', label: 'Heroes', symbol: '◆' } }),
      participant('current:one', { currentTurn: true }),
    ]
    const groups = groupEncounterWorkspaceParticipants(values)
    const wild = groups.find(group => group.kind === 'wild-group')
    expect(wild).toMatchObject({ label: 'Rattata ×3', participantIds: ['wild:one', 'wild:three', 'wild:two'] })
    expect(wild?.participants).toHaveLength(3)
    expect(groups.filter(group => group.kind === 'individual').flatMap(group => group.participantIds).sort()).toEqual(['current:one', 'hero:one'])
    expect(groups.flatMap(group => group.participantIds).sort()).toEqual(values.map(value => value.participantId).sort())
  })

  it('derives accepted and corrected visual states only from authoritative presentations', () => {
    const states = acceptedParticipantPresentationStates([
      accepted({ id: 'accepted:one', participantId: 'wild:one' }),
      accepted({ id: 'accepted:correction', participantId: 'wild:two', correction: true }),
    ])
    expect(states.get('wild:one')).toMatchObject({ state: 'accepted', labels: ['Lost 5 HP'] })
    expect(states.get('wild:two')).toMatchObject({ state: 'corrected', presentationId: 'accepted:correction' })
    expect(states.has('hidden:one')).toBe(false)
  })
})
